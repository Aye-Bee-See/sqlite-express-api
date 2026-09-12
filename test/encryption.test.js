import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
	startServer,
	stopServer,
	get,
	post,
	put,
	upload,
	getBytes,
	makeFixtures,
	uploadDir,
	sequelize,
	LetterKey
} from './helpers.js';
import * as crypto from '../services/crypto.js';

let f;
let alice;
let admin;

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 0x41)]);

before(async () => {
	await startServer();
	f = await makeFixtures();
	alice = { token: f.alice.token };
	admin = { token: f.admin.token };
});
after(stopServer);

test('letters are stored encrypted with one server envelope each', async () => {
	const first = await post(
		'/messaging/message',
		{
			messageText: 'Plaintext secret one',
			sender: 'user',
			prisoner: f.prisoner1.id,
			relayNote: 'note one'
		},
		alice
	);
	const second = await post(
		'/messaging/message',
		{ messageText: 'Plaintext secret one', sender: 'user', prisoner: f.prisoner2.id },
		alice
	);
	assert.equal(first.status, 201);
	assert.equal(first.body.data.messageText, 'Plaintext secret one');
	assert.equal(first.body.data.relayNote, 'note one');
	assert.equal(first.body.data.ciphertext, undefined);
	assert.equal(first.body.data.nonce, undefined);

	const [rows] = await sequelize.query(
		'SELECT id, ciphertext, nonce, relayNoteCiphertext, relayNoteNonce FROM Messages WHERE id IN (' +
			first.body.data.id +
			',' +
			second.body.data.id +
			') ORDER BY id'
	);
	const dump = JSON.stringify(rows);
	assert.ok(!dump.includes('Plaintext secret'), 'no plaintext body in the table');
	assert.ok(!dump.includes('note one'), 'no plaintext relay note in the table');
	assert.notEqual(rows[0].ciphertext, rows[1].ciphertext, 'same text, different ciphertext');
	assert.equal(rows[1].relayNoteCiphertext, null);

	const keys = await LetterKey.findAll({ where: { message: rows.map((r) => r.id) } });
	assert.equal(keys.length, 2);
	assert.ok(keys.every((k) => k.readerType === 'server' && k.readerId === null));
	assert.ok(keys.every((k) => k.keyLabel === crypto.masterKeyLabel()));
	assert.notEqual(keys[0].wrappedKey, keys[1].wrappedKey);

	// Every read path decrypts: single, list, chat embed, last_message.
	const one = await get('/messaging/message?id=' + first.body.data.id + '&full=true', alice);
	assert.equal(one.body.data.messageText, 'Plaintext secret one');
	assert.equal(one.body.data.relayNote, 'note one');
	const list = await get('/messaging/messages?prisoner=' + f.prisoner1.id, alice);
	assert.ok(list.body.data.some((m) => m.messageText === 'Plaintext secret one'));
	const chat = await get('/chat/chat?id=' + first.body.data.chat + '&full=true', alice);
	assert.equal(chat.body.data.messages[0].messageText, 'Plaintext secret one');
	const chats = await get('/chat/chats', alice);
	assert.ok(chats.body.data.some((c) => c.last_message.messageText === 'Plaintext secret one'));
	assert.ok(!JSON.stringify(chat.body).includes('ciphertext'));
});

test('editing re-encrypts under the same content key', async () => {
	const { id } = (
		await post(
			'/messaging/message',
			{ messageText: 'Before', sender: 'user', prisoner: f.prisoner1.id },
			alice
		)
	).body.data;
	const [[before]] = await sequelize.query(
		'SELECT ciphertext, nonce FROM Messages WHERE id = ' + id
	);
	const res = await put(
		'/messaging/message',
		{ id, messageText: 'After', relayNote: 'Added later' },
		alice
	);
	assert.equal(res.status, 200);
	const [[after]] = await sequelize.query(
		'SELECT ciphertext, nonce, relayNoteCiphertext FROM Messages WHERE id = ' + id
	);
	assert.notEqual(after.ciphertext, before.ciphertext);
	assert.notEqual(after.nonce, before.nonce);
	assert.ok(after.relayNoteCiphertext);
	const read = await get('/messaging/message?id=' + id, alice);
	assert.equal(read.body.data.messageText, 'After');
	assert.equal(read.body.data.relayNote, 'Added later');
	assert.equal(await LetterKey.count({ where: { message: id } }), 1, 'still one envelope');

	const cleared = await put('/messaging/message', { id, relayNote: null }, alice);
	assert.equal(cleared.status, 200);
	assert.equal((await get('/messaging/message?id=' + id, alice)).body.data.relayNote, null);
});

test('attachment files on disk are ciphertext; downloads are plaintext', async () => {
	const { id } = (
		await post(
			'/messaging/message',
			{ messageText: 'With file', sender: 'user', prisoner: f.prisoner1.id },
			alice
		)
	).body.data;
	const res = await upload(
		'/messaging/attachment',
		{ fields: { message: id }, file: { name: 'scan.pdf', type: 'application/pdf', bytes: PDF } },
		alice
	);
	assert.equal(res.status, 201);
	assert.equal(res.body.data.size, PDF.length);
	assert.equal(res.body.data.nonce, undefined);
	const files = readdirSync(uploadDir);
	assert.equal(files.length, 1);
	const onDisk = readFileSync(uploadDir + '/' + files[0]);
	assert.ok(!onDisk.equals(PDF));
	assert.ok(!onDisk.includes(Buffer.from('%PDF')));
	assert.equal(onDisk.length, PDF.length + 16, 'secretbox adds a 16-byte tag');
	const dl = await getBytes('/messaging/attachment?id=' + res.body.data.id, alice);
	assert.equal(dl.status, 200);
	assert.equal(dl.headers.get('content-length'), String(PDF.length));
	assert.ok(dl.bytes.equals(PDF));
	// Admins read through the same envelope.
	assert.ok(
		(await getBytes('/messaging/attachment?id=' + res.body.data.id, admin)).bytes.equals(PDF)
	);
});

test('a letter wrapped under another key is reported, not served', async () => {
	const { id } = (
		await post(
			'/messaging/message',
			{ messageText: 'Rotated', sender: 'user', prisoner: f.prisoner2.id },
			alice
		)
	).body.data;
	await LetterKey.update({ keyLabel: 'deadbeefcafe' }, { where: { message: id } });
	const res = await get('/messaging/message?id=' + id, alice);
	assert.equal(res.status, 500);
	assert.equal(res.body.name, 'EncryptionKeyError');
	await LetterKey.update({ keyLabel: crypto.masterKeyLabel() }, { where: { message: id } });
	assert.equal((await get('/messaging/message?id=' + id, alice)).body.data.messageText, 'Rotated');
});

test('crypto primitives round-trip and refuse the wrong key', async () => {
	await crypto.ready;
	const key = crypto.generateContentKey();
	const { ciphertext, nonce } = crypto.encrypt('hello', key);
	assert.equal(crypto.decryptString(ciphertext, nonce, key), 'hello');
	assert.throws(() => crypto.decryptString(ciphertext, nonce, crypto.generateContentKey()));
	const wrapped = crypto.wrapForServer(key);
	assert.deepEqual(Buffer.from(crypto.unwrapForServer(wrapped)), Buffer.from(key));
	assert.notEqual(crypto.wrapForServer(key), wrapped, 'fresh nonce per wrap');
	assert.equal(crypto.masterKeyLabel().length, 12);
});
