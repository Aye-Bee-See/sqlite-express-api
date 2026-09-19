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

// Server mode, before the switch: people get keys one by one, at sign-in.

let f;
let admin;
let alice;
let bob;
let member;
let aliceLetter;
let bobLetter;
let writerLetter;

const envelopesOf = async (message) =>
	(await LetterKey.findAll({ where: { message }, order: [['id', 'ASC']] })).map(
		(row) => row.readerType + (row.readerId ? ':' + row.readerId : '')
	);

before(async () => {
	await client.ready;
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
	alice = { token: f.alice.token };
	bob = { token: f.bob.token };
	member = { token: f.chapter.token };
	await Prison.addRelay(f.group.id, f.prison.id);
	const send = async (who, body) => {
		const res = await post('/messaging/message', { sender: 'user', ...body }, who);
		assert.equal(res.status, 201, JSON.stringify(res.body));
		return res.body.data;
	};
	aliceLetter = await send(alice, { messageText: 'From Alice', prisoner: f.prisoner1.id });
	bobLetter = await send(bob, { messageText: 'From Bob', prisoner: f.prisoner1.id });
	writerLetter = await send(member, {
		messageText: 'For the managed writer',
		prisoner: f.prisoner2.id,
		user: f.writer.id
	});
});
after(stopServer);

test('before anyone has keys the report says who blocks the switch', async () => {
	assert.equal((await get('/auth/encryption-readiness', alice)).status, 403);
	assert.equal((await get('/auth/encryption-readiness', member)).status, 403);
	const res = await get('/auth/encryption-readiness', admin);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	const report = res.body.data;
	assert.equal(report.mode, 'server');
	assert.equal(report.serverKeyConfigured, true);
	assert.equal(report.ready, false);
	assert.equal(report.blockers.length, 1);
	assert.match(report.blockers[0], /Fixture Group.*relays mail and has no group key/);
	assert.deepEqual(
		report.groups.withoutKey.map((g) => [g.id, g.blocksTheSwitch]),
		[[f.group.id, true]]
	);
	assert.equal(report.writers.withKeys, 0);
	assert.equal(report.writers.withoutKeysWithLetters, 2, 'alice and bob have letters at stake');
	assert.equal(report.letters.serverHeld, 3);
	assert.equal(report.letters.waitingForWriters, 3, 'alice, bob, and the managed writer');
	assert.equal(report.letters.waitingForGroups, 1);
	assert.deepEqual(report.groups.unclaimedWritersWithoutKeys, [
		{ id: f.group.id, name: 'Fixture Group', writers: 1 }
	]);
});

test("setting up keys seals the writer's existing letters to them at once", async () => {
	const keys = client.accountKeys(f.alice.password, 'RECOVERY');
	const res = await put('/auth/keys', keys.fields, alice);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	assert.deepEqual(res.body.data.caughtUp, { letters: 1, sealed: 1, dropped: 0 });
	assert.deepEqual(await envelopesOf(aliceLetter.id), ['server', 'user:' + f.alice.id]);
	assert.deepEqual(
		await envelopesOf(bobLetter.id),
		['server'],
		"nobody else's letters are touched"
	);

	// The envelope really opens, and the server's copy is kept: this is still server mode.
	const row = await LetterKey.findOne({ where: { message: aliceLetter.id, readerType: 'user' } });
	const contentKey = client.open(row.wrappedKey, keys.fields.publicKey, keys.privateKey);
	assert.equal(contentKey.length, 32);
	const read = await get('/messaging/message?id=' + aliceLetter.id, alice);
	assert.equal(read.body.data.messageText, 'From Alice');

	// Re-wrapping the private key later (a password change) is not a first set-up.
	const again = await put('/auth/keys', keys.fields, alice);
	assert.equal(again.status, 200);
	assert.equal(again.body.data.caughtUp, undefined);
});

test('a group getting its key is sealed the letters it relays and those of writers it manages', async () => {
	const m = client.accountKeys(f.chapter.password, 'RECOVERY');
	assert.equal((await put('/auth/keys', m.fields, member)).status, 200);
	const groupKeys = client.keypair();
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
	assert.equal(boot.status, 200, JSON.stringify(boot.body));
	assert.deepEqual(boot.body.data.caughtUp, { letters: 3, sealed: 3, dropped: 0 });
	const group = 'chapter:' + f.group.id;
	assert.ok((await envelopesOf(aliceLetter.id)).includes(group));
	assert.ok((await envelopesOf(bobLetter.id)).includes(group));
	assert.ok((await envelopesOf(writerLetter.id)).includes(group));
	const stamped = await LetterKey.findOne({
		where: { message: bobLetter.id, readerType: 'chapter' }
	});
	assert.equal(stamped.keyVersion, 1);

	// A group preparing an unclaimed writer counts as that writer's first keys too.
	const writerKeys = client.keypair();
	const prepared = await put(
		'/auth/user',
		{
			id: f.writer.id,
			publicKey: writerKeys.publicKey,
			orgWrappedPrivateKey: client.seal(
				groupKeys.publicKey,
				Buffer.from(writerKeys.privateKey, 'base64')
			),
			orgKeyVersion: 1
		},
		member
	);
	assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
	assert.ok((await envelopesOf(writerLetter.id)).includes('user:' + f.writer.id));
});

test('in server mode the server manages envelopes, so there is nothing for a group to fill in', async () => {
	assert.equal((await get('/messaging/envelopes/missing', member)).status, 409);
});

test('the report now says the switch can go ahead, with one writer still to come', async () => {
	const report = (await get('/auth/encryption-readiness', admin)).body.data;
	assert.equal(report.ready, true);
	assert.deepEqual(report.blockers, []);
	assert.deepEqual(report.groups.withoutKey, []);
	assert.equal(report.writers.withoutKeysWithLetters, 1, 'bob');
	assert.equal(report.letters.waitingForWriters, 1);
	assert.equal(report.letters.waitingForGroups, 0);
	assert.deepEqual(report.groups.unclaimedWritersWithoutKeys, []);
});
