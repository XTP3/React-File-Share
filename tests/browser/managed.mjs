import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const binary = path.resolve(option('--binary', '../../v2/Back-End/file-share'));
const www = path.resolve(option('--www-dir', '../../v2/Back-End/www'));
const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const database = `rfs_browser_${randomUUID().replaceAll('-', '')}`;
assert.match(database, /^rfs_browser_[a-f0-9]{32}$/);
const mongo = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
const root = await mkdtemp(path.join(tmpdir(), 'rfs-browser-'));
let backend, test, interrupted = false;
const log = [];
function stop() { interrupted = true; test?.kill('SIGTERM'); backend?.kill('SIGTERM'); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}
try {
  await mongo.connect();
  const db = mongo.db(database);
  assert.equal((await db.listCollections().toArray()).length, 0, 'Fixture namespace must be empty');
  await db.collection('browser_fixture_marker').insertOne({ _id: database });
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const isolatedWWW = path.join(root, 'www');
  await cp(www, isolatedWWW, { recursive: true });
  const configPath = path.join(root, 'Config.json');
  const uploads = path.join(root, 'uploads'); await mkdir(uploads);
  const databaseURI = uri.replace(/(mongodb(?:\+srv)?:\/\/[^/]+)(?:\/[^?]*)?(.*)/, `$1/${database}$2`);
  await writeFile(configPath, JSON.stringify({ DATABASE_URL: databaseURI, HTTP_PORT: port, HTTPS_PORT: 0, JWT_SECRET_KEY: 'synthetic-browser-fixture-key-no-user-data', JWT_EXPIRATION: '1h', BCRYPT_SALT_ROUNDS: 4, ACCOUNT_CREATION_CODE: 'browser-fixture-code', MAX_UPLOAD_SIZE: 10485760, DATE_LANGUAGE: 'en-US', DATE_TIMEZONE_REGION: 'UTC' }));
  backend = spawn(binary, ['--config', configPath, '--uploads-dir', uploads, '--www-dir', isolatedWWW, '--http-port', String(port), '--https-port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  backend.stdout.on('data', chunk => log.push(chunk.toString())); backend.stderr.on('data', chunk => log.push(chunk.toString()));
  let spawnError; backend.on('error', error => { spawnError = error; });
  const baseURL = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  while (true) {
    if (spawnError) throw spawnError;
    if (backend.exitCode !== null) throw new Error(`Backend exited: ${log.join('')}`);
    try { assert.equal((await fetch(`${baseURL}/api/v2/config`)).status, 200); break; }
    catch { if (Date.now() > deadline) throw new Error(`Backend readiness timeout: ${log.join('')}`); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok((await readFile(path.join(www, 'index.html'), 'utf8')).includes('<html'), 'Production frontend build must exist');
  console.log('Running browser suite against disposable real-service fixture');
  test = spawn(process.execPath, [new URL('./run.mjs', import.meta.url).pathname], { stdio: 'inherit', env: { ...process.env, BASE_URL: baseURL, CREATION_CODE: 'browser-fixture-code', TEST_WWW_DIR: isolatedWWW } });
  const exitCode = await new Promise((resolve, reject) => { test.once('error', reject); test.once('exit', code => resolve(code ?? 1)); });
  process.exitCode = interrupted ? 130 : exitCode;
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  await terminate(test); await terminate(backend);
  if (mongo.topology?.isConnected()) {
    const db = mongo.db(database);
    if (await db.collection('browser_fixture_marker').findOne({ _id: database })) await db.dropDatabase();
  }
  await mongo.close();
  await rm(root, { recursive: true, force: true });
}
