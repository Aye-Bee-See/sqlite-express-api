process.env.ENCRYPTION_MODE = 'e2e';
// ENCRYPTION_KEY stays set (the test helpers pin one): after the switch the
// server keeps it for as long as letters wait for readers who have no keys.

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const {
	startServer,
	stopServer,
	get,
	post,
	put,
	makeFixtures,
	makeUser,
	User,
	Chat,
	Message,
	LetterKey,
	Prison
} = await import('./helpers.js');
const client = await import('./e2e-client.js');
const crypto = await import('../services/crypto.js');
const { rewrapForE2E } = await import('../database/rewrap-e2e.js');

let f;
let admin;
let alice; // had letters before the switch, signs in after it
let bob; // gets a reply before he has keys
let member;
let memberKeys;
let groupKeys;
let oldLetter;

const bytes = (b64) => Buffer.from(b64, 'base64');

/** A letter as the pre-switch database holds it: the server's key, and the group's from the re-wrap. */
async function serverHeldLetter(userId, text) {
	const contentKey = crypto.generateContentKey();
	const body = crypto.encrypt(text, contentKey);
	const [chat] = await Chat.findOrCreate({
		where: { user: userId, prisoner: f.prisoner1.id },
		defaults: { user: userId, prisoner: f.prisoner1.id }
	});
	const message = await Message.create({
		chat: chat.id,
		sender: 'user',
		prisoner: f.prisoner1.id,
		user: userId,
		ciphertext: body.ciphertext,
		nonce: body.nonce,
		status: 'mailed',
		relayChapter: f.group.id,
		statusChangedAt: new Date()
	});
	await LetterKey.issueServerKey(message.id, contentKey);
	await LetterKey.create({
		message: message.id,
		readerType: 'chapter',
		readerId: f.group.id,
		wrappedKey: client.seal(groupKeys.publicKey, contentKey),
		keyVersion: 1
	});
	return message;
}

before(async () => {
	await client.ready;
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
	alice = { token: f.alice.token };
	bob = { token: f.bob.token };
	member = { token: f.chapter.token };
	await Prison.addRelay(f.group.id, f.prison.id);
	const m = client.accountKeys(f.chapter.password, 'RECOVERY');
	memberKeys = { publicKey: m.fields.publicKey, privateKey: m.privateKey };
	assert.equal((await put('/auth/keys', m.fields, member)).status, 200);
	groupKeys = client.keypair();
	const boot = await put(
		'/auth/chapter-keys',
		{
			chapter: f.group.id,
			publicKey: groupKeys.publicKey,
			wrappedOrgPrivateKey: client.seal(memberKeys.publicKey, bytes(groupKeys.privateKey))
		},
		member
	);
	assert.equal(boot.status, 200, JSON.stringify(boot.body));
	oldLetter = await serverHeldLetter(f.alice.id, 'Written before the switch');
});
after(stopServer);

test('a straggler cannot read their old letter yet, and nothing is lost', async () => {
	const read = await get('/messaging/message?id=' + oldLetter.id, alice);
	assert.equal(read.status, 200);
	assert.equal(read.body.data.messageText, null);
	assert.deepEqual(read.body.data.envelopes, [], 'no key of hers exists to seal to');
	assert.equal(
		await LetterKey.count({ where: { message: oldLetter.id, readerType: 'server' } }),
		1
	);

	const report = (await get('/auth/encryption-readiness', admin)).body.data;
	assert.equal(report.mode, 'e2e');
	assert.equal(report.ready, true, 'the group has its key; a late writer blocks nothing');
	assert.equal(report.letters.serverHeld, 1);
	assert.equal(report.letters.waitingForWriters, 1);
});

test('her first sign-in after the switch makes the old letter hers, and the server lets go of it', async () => {
	const keys = client.accountKeys(f.alice.password, 'RECOVERY');
	const res = await put('/auth/keys', keys.fields, alice);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	assert.deepEqual(res.body.data.caughtUp, { letters: 1, sealed: 1, dropped: 1 });
	assert.equal(await LetterKey.count({ where: { readerType: 'server' } }), 0);

	const read = await get('/messaging/message?id=' + oldLetter.id, alice);
	assert.equal(read.body.data.envelopes.length, 1);
	const opened = client.decryptLetter(
		read.body.data,
		read.body.data.envelopes[0],
		keys.fields.publicKey,
		keys.privateKey
	);
	assert.equal(opened.text, 'Written before the switch');
	assert.equal((await get('/auth/encryption-readiness', admin)).body.data.letters.serverHeld, 0);
});

test('a reply can be recorded for a writer who has no keys, and reaches him when he does', async () => {
	// Bob wrote through this group before the switch and has not signed in since.
	const bobsLetter = await serverHeldLetter(f.bob.id, 'Bob, before the switch');
	const reply = client.encryptLetter('A reply from inside', [
		{ readerType: 'chapter', readerId: f.group.id, publicKey: groupKeys.publicKey, keyVersion: 1 }
	]);
	const body = { sender: 'prisoner', prisoner: f.prisoner1.id, user: f.bob.id };
	const recorded = await post('/messaging/message', { ...reply.fields, ...body }, member);
	assert.equal(recorded.status, 201, JSON.stringify(recorded.body));

	// Sealing to a key that does not exist is a client bug, and a writer who has keys still needs his envelope.
	const phantom = await post(
		'/messaging/message',
		{
			...reply.fields,
			...body,
			envelopes: [
				...reply.fields.envelopes,
				{ readerType: 'user', readerId: f.bob.id, wrappedKey: 'sealed-to-nothing' }
			]
		},
		member
	);
	assert.equal(phantom.status, 400);
	assert.match(phantom.body.errors[0], /has no public key yet/);
	const forAlice = await post(
		'/messaging/message',
		{ ...reply.fields, ...body, user: f.alice.id },
		member
	);
	assert.equal(forAlice.status, 400);
	assert.match(forAlice.body.errors[0], /The writer .* needs an envelope/);

	// Bob sees that a reply exists, and cannot open it yet.
	const waiting = await get('/messaging/message?id=' + recorded.body.data.id, bob);
	assert.equal(waiting.status, 200);
	assert.deepEqual(waiting.body.data.envelopes, []);
	assert.deepEqual((await get('/messaging/envelopes/missing', member)).body.data, []);

	// He signs in and gets keys. The server catches up his old letter, the one it
	// still held a key for; it never had the reply's key, so it cannot help there...
	const keys = client.accountKeys(f.bob.password, 'RECOVERY');
	const setUp = await put('/auth/keys', keys.fields, bob);
	assert.deepEqual(setUp.body.data.caughtUp, { letters: 1, sealed: 1, dropped: 1 });
	assert.equal(await LetterKey.count({ where: { message: bobsLetter.id, readerType: 'user' } }), 1);

	// ...but the group can open it, and its client is told who is waiting.
	assert.equal((await get('/messaging/envelopes/missing', bob)).status, 403);
	assert.equal((await get('/messaging/envelopes/missing', admin)).status, 403);
	const missing = await get('/messaging/envelopes/missing', member);
	assert.equal(missing.status, 200, JSON.stringify(missing.body));
	assert.equal(missing.body.data.length, 1);
	const [item] = missing.body.data;
	assert.equal(item.message, recorded.body.data.id);
	assert.equal(item.readerType, 'user');
	assert.equal(item.readerId, f.bob.id);
	assert.equal(item.publicKey, keys.fields.publicKey);

	const contentKey = client.open(item.wrappedKey, groupKeys.publicKey, groupKeys.privateKey);
	const forwarded = await post(
		'/messaging/envelope',
		{
			message: item.message,
			readerType: item.readerType,
			readerId: item.readerId,
			wrappedKey: client.seal(item.publicKey, contentKey)
		},
		member
	);
	assert.equal(forwarded.status, 201, JSON.stringify(forwarded.body));
	assert.deepEqual((await get('/messaging/envelopes/missing', member)).body.data, []);

	const read = await get('/messaging/message?id=' + item.message, bob);
	const opened = client.decryptLetter(
		read.body.data,
		read.body.data.envelopes[0],
		keys.fields.publicKey,
		keys.privateKey
	);
	assert.equal(opened.text, 'A reply from inside');
});

test('the final cut-off drops what still waits, and says whose letters those are', async () => {
	const never = await makeUser({ role: 'user', username: 'nevercame' });
	const waiting = await serverHeldLetter(never.id, 'Nobody came back for this');

	// The ordinary drop leaves a letter that still waits for its writer.
	const gentle = await rewrapForE2E({ dropServerKeys: true, log: () => {} });
	assert.equal(gentle.dropped, 0);
	assert.equal(await LetterKey.count({ where: { message: waiting.id, readerType: 'server' } }), 1);

	const lines = [];
	const rehearsal = await rewrapForE2E({
		dropAllServerKeys: true,
		dryRun: true,
		log: (line) => lines.push(line)
	});
	assert.equal(rehearsal.dropped, 1);
	assert.deepEqual(rehearsal.abandoned, [{ message: waiting.id, missing: ['user ' + never.id] }]);
	assert.match(lines.join('\n'), /would be unreadable to them for good/);
	assert.equal(
		await LetterKey.count({ where: { readerType: 'server' } }),
		1,
		'a rehearsal deletes nothing'
	);

	const final = await rewrapForE2E({ dropAllServerKeys: true, log: () => {} });
	assert.equal(final.dropped, 1);
	assert.equal(await LetterKey.count({ where: { readerType: 'server' } }), 0);
	// The group relayed it and keeps its own envelope; only the writer's way in is gone.
	assert.equal(await LetterKey.count({ where: { message: waiting.id, readerType: 'chapter' } }), 1);
	assert.equal((await User.findByPk(never.id)).publicKey, null);
});
