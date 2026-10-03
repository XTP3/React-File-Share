// Fixtures reproduce Mongoose v1 BSON shapes without installing archived v1.
import { MongoClient, ObjectId, Double, BSON } from 'mongodb';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const [action, database, root] = process.argv.slice(2);
if (!/^rfs_integration_[a-f0-9]{32}$/.test(database || '')) {
  throw new Error('Refusing any database outside the unique integration namespace');
}
const client = new MongoClient(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017', {
  serverSelectionTimeoutMS: 10000,
});
await client.connect();
const db = client.db(database);
const accounts = JSON.parse(await readFile(new URL('./legacy-accounts.json', import.meta.url)));
const canonical = value => BSON.EJSON.stringify(value, { relaxed: false });
try {
  if (action !== 'seed') {
    const marker = await db.collection('integration_fixture_marker').findOne({ _id: database });
    if (!marker) throw new Error('Refusing fixture operation: ownership marker is missing');
  }
  if (action === 'drop') {
    await db.dropDatabase();
  } else if (action === 'seed') {
    if ((await db.listCollections().toArray()).length) throw new Error('Fixture database must be empty');
    await db.collection('integration_fixture_marker').insertOne({ _id: database });
    const users = accounts.map(a => ({
      _id: new ObjectId(), uniqueID: a.uniqueID, username: a.username, password: a.hash,
      timeOfCreation: new Double(1700000000123), __v: new Double(0),
      authorizationLevel: new Double(7), ipAddress: '192.0.2.1',
      timeOfLastLogin: new Date('2023-11-14T22:13:20Z'),
      additionalLegacyField: { keep: ['unchanged', 1], nested: true },
    }));
    await db.collection('users').insertMany(users);
    const files = [];
    const add = async (uniqueID, fileName, bytes, fileType, options = {}) => {
      const uploaderID = options.owner || accounts[0].uniqueID;
      await mkdir(path.join(root, uploaderID), { recursive: true });
      if (!options.missing) await writeFile(path.join(root, uploaderID, fileName), bytes);
      files.push({
        _id: new ObjectId(), uniqueID, uploaderID, fileName,
        fileSize: new Double(options.stale ? 999999 : bytes.length), fileType,
        timeOfUpload: new Double(options.timestamp || 1700000000123),
        timeOfUploadDate: '11/14/2023, 10:13:20 PM', __v: new Double(0),
        unknownLegacy: { nested: ['preserve', uniqueID] },
      });
    };
    await add('legacy-text-id', 'Legacy report.txt', Buffer.from('0123456789 legacy fixture\n'), 'text/plain', { stale: true });
    await add('legacy-unicode-id', 'résumé 漢字.txt', Buffer.from('unicode content'), 'text/plain');
    await add('legacy-photo-id', 'photo.JPG', Buffer.from('photo-fixture'), '', { timestamp: 1700000001123 });
    await add('legacy-gif-id', 'animation.gif', Buffer.from('GIF89a-fixture'), 'image/gif');
    await add('legacy-archive-id', 'backup.zip', Buffer.from('archive-fixture'), 'application/zip');
    await add('legacy-missing-id', 'missing.txt', Buffer.from('missing'), 'text/plain', { missing: true });
    await add('legacy-other-id', 'private.txt', Buffer.from('other-owner-only'), 'text/plain', { owner: accounts[2].uniqueID });
    await add('legacy-case-owner-id', 'case-owner-private.txt', Buffer.from('case-owner-private'), 'text/plain', { owner: 'FIXTURE-owner' });
    for (let i = 0; i < 27; i++) {
      await add(`legacy-page-${String(i).padStart(2, '0')}`, `Page ${String(i).padStart(2, '0')}.txt`,
        Buffer.from('x'.repeat(i + 1)), 'text/plain', { timestamp: 1700000010000 + i });
    }
    // Legacy duplicate references must count a physical path once.
    files.push({ ...files[0], _id: new ObjectId(), uniqueID: 'legacy-duplicate-reference' });
    await db.collection('files').insertMany(files);
    await writeFile(path.join(root, accounts[0].uniqueID, 'untracked.bin'), Buffer.from('untracked-fixture'));
    await writeFile(path.join(root, 'expected-bson.json'), JSON.stringify({
      users: users.map(canonical), files: files.map(canonical),
    }));
    console.log(JSON.stringify({ accounts, files: files.map(f => ({ ...f, _id: f._id.toHexString() })) }));
  } else if (action === 'verify') {
    const expected = JSON.parse(await readFile(path.join(root, 'expected-bson.json')));
    for (const collection of ['users', 'files']) {
      for (const original of expected[collection]) {
        const before = BSON.EJSON.parse(original, { relaxed: false });
        const after = await db.collection(collection).findOne({ _id: before._id }, { promoteValues: false });
        if (!after) throw new Error(`Missing legacy ${collection} record ${before.uniqueID}`);
        // Password changes are explicitly tested; all other original fields/types remain.
        if (collection === 'users') after.password = before.password;
        for (const key of Object.keys(before)) {
          if (canonical(after[key]) !== canonical(before[key])) {
            throw new Error(`Legacy BSON changed: ${collection}.${before.uniqueID}.${key}`);
          }
        }
      }
    }
    console.log(JSON.stringify({ preserved: true }));
  } else if (action === 'clone-file') {
    const original = await db.collection('files').findOne({ uniqueID: process.argv[5] });
    if (!original || original.uploaderID !== 'fixture-owner') throw new Error('Clone requires owned fixture file');
    const duplicate = { ...original, _id: new ObjectId(), uniqueID: 'test-reference-' + new ObjectId().toHexString() };
    await db.collection('files').insertOne(duplicate);
    console.log(JSON.stringify({ uniqueID: duplicate.uniqueID }));
  } else if (action === 'reject-file-writes' || action === 'restore-file-writes') {
    await db.command({ collMod: 'files', validator: action === 'reject-file-writes'
      ? { integrationRejectWrites: { $exists: true } } : {}, validationLevel: 'strict', validationAction: 'error' });
    console.log(JSON.stringify({ configured: true }));
  } else if (action === 'stale-delete-journal') {
    const replacement = await db.collection('files').findOne({ uniqueID: process.argv[5] });
    const state = process.argv[6];
    if (!replacement || replacement.uploaderID !== 'fixture-owner' || !['intent', 'committed'].includes(state)) {
      throw new Error('Stale journal requires owned replacement fixture and known state');
    }
    const id = 'integration-stale-' + new ObjectId().toHexString();
    await db.collection('storage_operations').insertOne({
      _id: id, kind: 'delete', state,
      original: { ...replacement, _id: new ObjectId(), uniqueID: 'removed-reference-' + id },
      path: path.join(replacement.uploaderID, replacement.fileName), trash: path.join('.trash', id), shared: false,
    });
    console.log(JSON.stringify({ configured: true }));
  } else if (action === 'counts') {
    console.log(JSON.stringify({ files: await db.collection('files').countDocuments() }));
  } else {
    throw new Error(`Unknown fixture action ${action}`);
  }
} finally {
  await client.close();
}
