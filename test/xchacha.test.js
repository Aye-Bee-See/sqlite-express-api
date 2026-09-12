import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import {
	startServer,
	stopServer,
	get,
	getBytes,
	makeFixtures,
	sequelize,
	LetterKey,
	Message,
	Chat,
	Attachment,
	uploadDir
} from './helpers.js';
import * as crypto from '../services/crypto.js';
import { createMigrator } from '../database/migrate.js';

const MIGRATION = '2026.09.13T02.00.00.xchacha.js';
let f;
let alice;

before(async () => {
	await startServer();
	f = await makeFixtures();
	alice = { token: f.alice.token };
});
after(stopServer);

test('the cipher is XChaCha20-Poly1305, not secretbox', async () => {
	await crypto.ready;
	const key = crypto.generateContentKey();
	const { ciphertext, nonce } = crypto.encrypt('hello', key);
	assert.throws(() => crypto.legacy.decrypt(ciphertext, nonce, key), 'secretbox cannot open it');
	assert.equal(crypto.decryptString(ciphertext, nonce, key), 'hello');
	const old = crypto.legacy.encrypt('hello', key);
	assert.throws(
		() => crypto.decrypt(old.ciphertext, old.nonce, key),
		'and the new cipher cannot open secretbox output'
	);
});

test('the migration converts secretbox-era letters, notes, files, and envelopes, both ways', async () => {
	// Write a letter the way the pre-correction code did: legacy cipher throughout.
	const key = crypto.generateContentKey();
	const body = crypto.legacy.encrypt('From the old days', key);
	const note = crypto.legacy.encrypt('old note', key);
	const [chatRow] = await Chat.findOrCreateChat(f.alice.id, f.prisoner1.id);
	const chat = chatRow.id;
	await sequelize.query(
		"INSERT INTO Messages (chat, sender, prisoner, user, status, ciphertext, nonce, relayNoteCiphertext, relayNoteNonce, createdAt, updatedAt) VALUES (?, 'user', ?, ?, 'queued', ?, ?, ?, ?, datetime(), datetime())",
		{
			replacements: [
				chat,
				f.prisoner1.id,
				f.alice.id,
				body.ciphertext,
				body.nonce,
				note.ciphertext,
				note.nonce
			]
		}
	);
	const [[{ id: messageId }]] = await sequelize.query('SELECT last_insert_rowid() AS id');
	await LetterKey.create({
		message: messageId,
		readerType: 'server',
		readerId: null,
		wrappedKey: crypto.legacy.wrapForServer(key),
		keyLabel: crypto.masterKeyLabel()
	});
	const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(40, 0x41)]);
	const file = crypto.legacy.encrypt(pdf, key);
	writeFileSync(uploadDir + '/old.pdf', Buffer.from(crypto.decode(file.ciphertext)));
	await Attachment.create({
		message: messageId,
		storedName: 'old.pdf',
		originalName: 'old.pdf',
		mimeType: 'application/pdf',
		size: pdf.length,
		nonce: file.nonce
	});

	// Before conversion the API cannot read it (wrong cipher).
	assert.equal((await get('/messaging/message?id=' + messageId, alice)).status, 500);

	const migrator = createMigrator(sequelize, { quiet: true });
	// Forget that the migration ran (the rows above are pre-migration data), then apply it.
	await sequelize.query('DELETE FROM SequelizeMeta WHERE name = ?', { replacements: [MIGRATION] });
	await migrator.up({ to: MIGRATION });

	const read = await get('/messaging/message?id=' + messageId, alice);
	assert.equal(read.status, 200, JSON.stringify(read.body));
	assert.equal(read.body.data.messageText, 'From the old days');
	assert.equal(read.body.data.relayNote, 'old note');
	const [[row]] = await sequelize.query(
		'SELECT ciphertext, nonce FROM Messages WHERE id = ' + messageId
	);
	assert.notEqual(row.ciphertext, body.ciphertext, 'ciphertext was rewritten');
	const att = await Attachment.findOne({ where: { message: messageId } });
	const dl = await getBytes('/messaging/attachment?id=' + att.id, alice);
	assert.equal(dl.status, 200);
	assert.ok(dl.bytes.equals(pdf), 'the file decrypts under the new cipher');
	assert.ok(
		!readFileSync(uploadDir + '/old.pdf').equals(Buffer.from(crypto.decode(file.ciphertext))),
		'the file on disk was rewritten'
	);

	// Rolling back restores secretbox output that the new cipher cannot read; re-applying fixes it again.
	await migrator.down({ to: MIGRATION });
	const [[legacyRow]] = await sequelize.query(
		'SELECT ciphertext, nonce FROM Messages WHERE id = ' + messageId
	);
	const legacyKey = crypto.legacy.unwrapForServer(
		(await LetterKey.findOne({ where: { message: messageId, readerType: 'server' } })).wrappedKey
	);
	assert.equal(
		crypto.legacy.decrypt(legacyRow.ciphertext, legacyRow.nonce, legacyKey).toString(),
		'From the old days'
	);
	await migrator.up({ to: MIGRATION });
	assert.equal(
		(await get('/messaging/message?id=' + messageId, alice)).body.data.messageText,
		'From the old days'
	);
	assert.ok(await Message.findByPk(messageId));
});
