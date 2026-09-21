import { createHash, randomBytes } from 'node:crypto';

// The server has a new key (the one the helpers pin) and still knows the old one.
const OLD_KEY = randomBytes(32);
process.env.ENCRYPTION_KEY_PREVIOUS = OLD_KEY.toString('base64');

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, makeFixtures, get, post, LetterKey, sequelize } = await import(
	'./helpers.js'
);
const crypto = await import('../services/crypto.js');
const { rekeyServerEnvelopes } = await import('../database/rekey.js');
const { default: AuditLog } = await import('../database/models/audit-log.model.js');
const { default: _sodium } = await import('libsodium-wrappers');

let f;
const labelOf = (key) => createHash('sha256').update(key).digest('hex').slice(0, 12);
const quiet = { log: () => {} };

before(async () => {
	await startServer();
	await _sodium.ready;
	f = await makeFixtures();
});
after(stopServer);

/** A letter as it was written before the key changed: its key wrapped with `key`. */
async function letterUnder(key, text) {
	const sent = await post(
		'/messaging/message',
		{ prisoner: f.prisoner1.id, messageText: text, sender: 'user' },
		f.alice
	);
	assert.equal(sent.status, 201, JSON.stringify(sent.body));
	const row = await LetterKey.findOne({
		where: { message: sent.body.data.id, readerType: 'server' }
	});
	const contentKey = crypto.unwrapForServer(row.wrappedKey, row.keyLabel);
	const nonce = _sodium.randombytes_buf(_sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
	const box = _sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
		contentKey,
		null,
		null,
		nonce,
		key
	);
	await row.update({
		wrappedKey: crypto.encode(new Uint8Array([...nonce, ...box])),
		keyLabel: labelOf(key)
	});
	return sent.body.data.id;
}

const read = async (id) => (await get('/messaging/message?id=' + id, f.alice)).body;

test('after a key change, old letters stay readable and new ones use the new key', async () => {
	assert.equal(crypto.previousKeyLabel(), labelOf(OLD_KEY));
	const old = await letterUnder(OLD_KEY, 'Written under the old key');
	assert.equal((await read(old)).data.messageText, 'Written under the old key');
	const fresh = await post(
		'/messaging/message',
		{ prisoner: f.prisoner1.id, messageText: 'Written today', sender: 'user' },
		f.alice
	);
	const row = await LetterKey.findOne({
		where: { message: fresh.body.data.id, readerType: 'server' }
	});
	assert.equal(row.keyLabel, crypto.masterKeyLabel());
});

test('rekey moves every old letter key to the new key, once, and says what it did', async () => {
	const ids = [];
	for (let i = 0; i < 5; i += 1) {
		ids.push(await letterUnder(OLD_KEY, 'Old letter ' + i));
	}
	const oldRows = await LetterKey.count({
		where: { readerType: 'server', keyLabel: labelOf(OLD_KEY) }
	});
	assert.ok(oldRows >= 5);

	// Looking first changes nothing.
	const look = await rekeyServerEnvelopes({ ...quiet, dryRun: true });
	assert.equal(look.rewrapped, oldRows);
	assert.equal(await LetterKey.count({ where: { keyLabel: labelOf(OLD_KEY) } }), oldRows);

	// In small batches, to go round the loop more than once.
	const report = await rekeyServerEnvelopes({ ...quiet, batch: 2 });
	assert.equal(report.rewrapped, oldRows);
	assert.deepEqual(report.unreadable, []);
	assert.equal(await LetterKey.count({ where: { keyLabel: labelOf(OLD_KEY) } }), 0);
	for (const [i, id] of ids.entries()) {
		assert.equal((await read(id)).data.messageText, 'Old letter ' + i);
	}
	const entry = await AuditLog.findOne({
		where: { action: 'encryption.rekey' },
		order: [['id', 'DESC']]
	});
	assert.deepEqual(entry.details, { rewrapped: oldRows, to: crypto.masterKeyLabel() });

	// Again: nothing to do, nothing done, nothing logged.
	const again = await rekeyServerEnvelopes(quiet);
	assert.equal(again.rewrapped, 0);
	assert.equal(await AuditLog.count({ where: { action: 'encryption.rekey' } }), 1);
});

test('a letter under a key nobody configured is left alone and reported, and says how to fix it', async () => {
	const lostKey = randomBytes(32);
	const id = await letterUnder(lostKey, 'Under a key that is gone');
	const before = await LetterKey.findOne({ where: { message: id, readerType: 'server' } });

	const report = await rekeyServerEnvelopes(quiet);
	assert.deepEqual(report.unreadable, [{ label: labelOf(lostKey), rows: 1 }]);
	const afterwards = await LetterKey.findOne({ where: { message: id, readerType: 'server' } });
	assert.equal(
		afterwards.wrappedKey,
		before.wrappedKey,
		'untouched: the right key may yet turn up'
	);

	const res = await read(id);
	assert.equal(res.status, 500);
	assert.equal(res.name, 'EncryptionKeyError');
	await afterwards.destroy();
});

test('a row labelled with a key we have, which that key does not open, is reported and not destroyed', async () => {
	const id = await letterUnder(OLD_KEY, 'Mislabelled');
	const row = await LetterKey.findOne({ where: { message: id, readerType: 'server' } });
	const garbage = crypto.encode(new Uint8Array(24 + 48).fill(7));
	await row.update({ wrappedKey: garbage });
	const report = await rekeyServerEnvelopes(quiet);
	assert.deepEqual(report.unreadable, [{ label: labelOf(OLD_KEY), rows: 1 }]);
	assert.equal((await row.reload()).wrappedKey, garbage);
	await sequelize.query('DELETE FROM LetterKeys WHERE id = ' + row.id);
});
