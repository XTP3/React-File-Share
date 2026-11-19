// Fixtures reproduce Mongoose v1 BSON shapes without installing archived v1.
import { MongoClient, ObjectId, Double, BSON } from 'mongodb';
import { readFile, writeFile, mkdir, link, readdir } from 'node:fs/promises';
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
    // A non-v2 document in the same Mongo collection used to become a blank
    // collection with whole-library statistics when its absent ID became "".
    const collections = [
      { _id: new ObjectId(), ownerID: accounts[0].uniqueID, legacyOnly: { preserve: true } },
      ...['', '   ', 'all', 'uncollected', 'a/b'].map(id => ({ _id: new ObjectId(), ownerID: accounts[0].uniqueID, id, title: '', legacyOnly: true })),
      { _id: new ObjectId(), ownerID: accounts[0].uniqueID, id: 42, title: 'Wrong ID type' },
      { _id: new ObjectId(), ownerID: accounts[0].uniqueID, id: 'fixture-recoverable-title', title: '', unknownLegacy: { retained: true } },
    ];
    await db.collection('collections').insertMany(collections);
    await db.collection('collection_memberships').insertOne({ ownerID: accounts[0].uniqueID,
      collectionId: 'fixture-recoverable-title', fileId: 'legacy-text-id' });
    // Existing deployments can have unique indexes even though the archived
    // Mongoose schemas do not declare them. Preserve both kinds and their names.
    await db.collection('users').createIndex({ username: 1 }, { unique: true, background: true });
    await db.collection('users').createIndex({ uniqueID: 1 }, { name: 'legacy_user_identity' });
    await db.collection('files').createIndex({ uniqueID: 1 }, { unique: true, background: true });
    await db.collection('files').createIndex({ uploaderID: 1, fileName: 1, _id: 1 }, { name: 'legacy_file_names' });
    const indexes = {};
    for (const collection of ['users', 'files']) {
      indexes[collection] = (await db.collection(collection).listIndexes().toArray()).map(canonical);
    }
    await writeFile(path.join(root, accounts[0].uniqueID, 'untracked.bin'), Buffer.from('untracked-fixture'));
    await writeFile(path.join(root, 'expected-bson.json'), JSON.stringify({
      users: users.map(canonical), files: files.map(canonical), collections: collections.map(canonical), indexes,
    }));
    console.log(JSON.stringify({ accounts, files: files.map(f => ({ ...f, _id: f._id.toHexString() })) }));
  } else if (action === 'verify') {
    const expected = JSON.parse(await readFile(path.join(root, 'expected-bson.json')));
    for (const collection of ['users', 'files']) {
      const indexes = await db.collection(collection).listIndexes().toArray();
      for (const original of expected.indexes[collection]) {
        const before = BSON.EJSON.parse(original, { relaxed: false });
        const after = indexes.find(index => index.name === before.name);
        if (!after || canonical(after) !== original) {
          throw new Error(`Legacy index changed: ${collection}.${before.name}`);
        }
      }
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
    // Recovery tests rename a valid ID explicitly, then restore the original
    // title. Unknown fields, malformed records, and BSON types stay intact.
    for (const original of expected.collections) {
      const before = BSON.EJSON.parse(original, { relaxed: false });
      const after = await db.collection('collections').findOne({ _id: before._id }, { promoteValues: false });
      if (!after) throw new Error('Original collection document was removed');
      for (const key of Object.keys(before)) {
        if (canonical(after[key]) !== canonical(before[key])) throw new Error(`Original collection field changed: ${key}`);
      }
    }
    console.log(JSON.stringify({ preserved: true }));
  } else if (action === 'restore-collection-title') {
    await db.collection('collections').updateOne({ ownerID: accounts[0].uniqueID, id: 'fixture-recoverable-title' }, { $set: { title: '' } });
    console.log(JSON.stringify({ restored: true }));
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
  } else if (action === 'many-targets') {
    const ids = Array.from({length: 1025}, (_, i) => 'bulk-upload-' + i);
    await db.collection('collections').insertMany(ids.map(id => ({id, ownerID: accounts[0].uniqueID, title: id})));
    console.log(JSON.stringify(ids));
  } else if (action === 'remove-many-targets') {
    await db.collection('collections').deleteMany({ownerID: accounts[0].uniqueID, id: /^bulk-upload-[0-9]+$/});
  } else if (action === 'upload-counts') {
    const counts = {};
    for (const name of ['files', 'collection_memberships', 'storage_operations']) {
      counts[name] = await db.collection(name).countDocuments();
    }
    console.log(JSON.stringify(counts));
  } else if (action === 'reject-target' || action === 'restore-targets') {
    await db.command({ collMod: 'collection_memberships', validator: action === 'reject-target'
      ? { collectionId: { $ne: process.argv[5] } } : {}, validationLevel: 'strict', validationAction: 'error' });
  } else if (action === 'upload-journals') {
    for (const state of ['intent', 'committed', 'legacy']) {
      const id = 'recovery-' + state;
      const stageDir = path.join('.staging', id);
      const stage = path.join(stageDir, '0');
      const owner = accounts[0].uniqueID;
      const file = { _id: new ObjectId(), uploaderID: owner, uniqueID: id, fileName: id + '.txt',
        fileType: 'text/plain', fileSize: 5, timeOfUpload: Date.now() };
      await mkdir(path.join(root, stageDir));
      await writeFile(path.join(root, stage), 'bytes');
      await link(path.join(root, stage), path.join(root, owner, file.fileName));
      await db.collection('files').insertOne(file);
      const targets = state === 'legacy' ? ['first'] : ['first', 'second'];
      const intended = targets.map(collectionId => ({ _id: new ObjectId(), fileId: id, collectionId, ownerID: owner }));
      const unrelated = [
        { fileId: id, collectionId: 'separate', ownerID: owner },
        { fileId: id, collectionId: 'first', ownerID: accounts[2].uniqueID },
      ];
      await db.collection('collection_memberships').insertMany([...intended, ...unrelated]);
      await db.collection('storage_operations').insertOne({
        _id: id, kind: 'upload', state: state === 'legacy' ? 'intent' : state,
        stageDir, stages: [stage], files: [file],
        ...(state === 'legacy' ? { collection: 'first' } : { membershipIds: intended.map(m => m._id) }),
      });
    }
  } else if (action === 'check-upload-journals') {
    const owner = accounts[0].uniqueID;
    const others = accounts[2].uniqueID;
    const names = await readdir(path.join(root, owner));
    const members = db.collection('collection_memberships');
    for (const state of ['intent', 'legacy', 'committed']) {
      const id = 'recovery-' + state;
      const file = await db.collection('files').findOne({ uniqueID: id });
      if ((state === 'committed') !== Boolean(file) || Boolean(file) !== names.includes(id + '.txt')) {
        throw new Error('Recovered file bytes or metadata differ for ' + state);
      }
      const links = await members.find({ fileId: id }).toArray();
      if (links.length !== (state === 'committed' ? 4 : 2)
          || !links.some(m => m.ownerID === owner && m.collectionId === 'separate')
          || !links.some(m => m.ownerID === others && m.collectionId === 'first')) {
        throw new Error('Recovery removed an unrelated membership or retained partial writes for ' + state);
      }
      await members.deleteMany({ fileId: id });
    }
    if ((await readdir(path.join(root, '.staging'))).length || await db.collection('storage_operations').countDocuments()) {
      throw new Error('Recovery left staging or journal');
    }
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
