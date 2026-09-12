import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	get,
	post,
	put,
	makeFixtures,
	LetterKey,
	Prison
} from './helpers.js';
import * as client from './e2e-client.js';
import { rewrapForE2E } from '../database/rewrap-e2e.js';

let f;
let alice;
let member;
let aliceKeys;
let groupKeys;

before(async () => {
	await client.ready;
	await startServer();
	f = await makeFixtures();
	alice = { token: f.alice.token };
	member = { token: f.chapter.token };
	await Prison.addRelay(f.group.id, f.prison.id);
	const a = client.accountKeys(f.alice.password, 'RECOVERY');
	aliceKeys = { publicKey: a.fields.publicKey, privateKey: a.privateKey };
	assert.equal((await put('/auth/keys', a.fields, alice)).status, 200);
	const m = client.accountKeys(f.chapter.password, 'RECOVERY');
	assert.equal((await put('/auth/keys', m.fields, member)).status, 200);
	groupKeys = client.keypair();
	const boot = await put(
		'/auth/chapter-keys',
		{
			chapter: f.group.id,
			publicKey: groupKeys.publicKey,
			wrappedOrgPrivateKey: client.seal(
				m.fields.publicKey,
				Buffer.from(groupKeys.privateKey, 'base64')
			)
		},
		member
	);
	assert.equal(boot.status, 200);
});
after(stopServer);

test('server-mode letters are re-wrapped to readers who have keys; the rest are reported', async () => {
	const ready = (
		await post(
			'/messaging/message',
			{ messageText: 'Ready to switch', sender: 'user', prisoner: f.prisoner1.id },
			alice
		)
	).body.data;
	const stuck = (
		await post(
			'/messaging/message',
			{ messageText: 'Bob has no keys', sender: 'user', prisoner: f.prisoner1.id },
			{ token: f.bob.token }
		)
	).body.data;
	assert.equal(ready.relayChapter, f.group.id);

	const logged = [];
	const dry = await rewrapForE2E({ dryRun: true, log: (l) => logged.push(l) });
	assert.equal(dry.sealed, 3, 'alice + group for the ready letter, group for the stuck one');
	assert.equal(
		await LetterKey.count({ where: { readerType: ['user', 'chapter'] } }),
		0,
		'dry run writes nothing'
	);

	const report = await rewrapForE2E({ log: (l) => logged.push(l) });
	assert.equal(report.sealed, 3);
	assert.deepEqual(report.skipped, [{ message: stuck.id, missing: ['user ' + f.bob.id] }]);
	assert.equal(report.dropped, 0);
	// Server mode still serves the letter as plaintext while the server envelope stays.
	assert.equal(
		(await get('/messaging/message?id=' + ready.id, alice)).body.data.messageText,
		'Ready to switch'
	);

	const dropped = await rewrapForE2E({ dropServerKeys: true, log: () => {} });
	assert.equal(dropped.sealed, 0, 'idempotent');
	assert.equal(dropped.dropped, 1);
	assert.equal(await LetterKey.count({ where: { message: ready.id, readerType: 'server' } }), 0);
	assert.equal(
		await LetterKey.count({ where: { message: stuck.id, readerType: 'server' } }),
		1,
		'kept until bob has keys'
	);
	assert.ok(logged.some((l) => l.includes('no public key for user ' + f.bob.id)));

	// The sealed envelopes open with the readers' private keys and decrypt the body.
	const [[row]] = await (
		await import('./helpers.js')
	).sequelize.query('SELECT ciphertext, nonce FROM Messages WHERE id = ' + ready.id);
	const forAlice = await LetterKey.findOne({
		where: { message: ready.id, readerType: 'user', readerId: f.alice.id }
	});
	const forGroup = await LetterKey.findOne({
		where: { message: ready.id, readerType: 'chapter', readerId: f.group.id }
	});
	const crypto = await import('../services/crypto.js');
	const k1 = client.open(forAlice.wrappedKey, aliceKeys.publicKey, aliceKeys.privateKey);
	const k2 = client.open(forGroup.wrappedKey, groupKeys.publicKey, groupKeys.privateKey);
	assert.equal(crypto.decryptString(row.ciphertext, row.nonce, k1), 'Ready to switch');
	assert.equal(crypto.decryptString(row.ciphertext, row.nonce, k2), 'Ready to switch');

	// Running again is idempotent.
	const again = await rewrapForE2E({ log: () => {} });
	assert.equal(again.sealed, 0);
	// Server mode still serves the letter as plaintext meanwhile.
	// Without its server envelope the letter is unreadable to server mode: the switch is due.
	assert.equal((await get('/messaging/message?id=' + ready.id, alice)).body.data.messageText, null);
	assert.equal(
		(
			await post(
				'/messaging/envelope',
				{ message: ready.id, readerType: 'user', readerId: f.alice.id, wrappedKey: 'x' },
				alice
			)
		).status,
		409
	);
});
