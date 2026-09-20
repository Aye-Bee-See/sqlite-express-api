process.env.ENCRYPTION_MODE = 'e2e';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, post, put, makeFixtures, Message, Prison, Chapter } = await import(
	'./helpers.js'
);
const client = await import('./e2e-client.js');

let f;
let member;
let groupKeys;
const bytes = (b64) => Buffer.from(b64, 'base64');

before(async () => {
	await client.ready;
	await startServer();
	f = await makeFixtures();
	member = { token: f.chapter.token };
	await Prison.addRelay(f.group.id, f.prison.id);
	const mine = client.accountKeys(f.chapter.password, 'RECOVERY');
	assert.equal((await put('/auth/keys', mine.fields, member)).status, 200);
	groupKeys = client.keypair();
	const boot = await put(
		'/auth/chapter-keys',
		{
			chapter: f.group.id,
			publicKey: groupKeys.publicKey,
			wrappedOrgPrivateKey: client.seal(mine.fields.publicKey, bytes(groupKeys.privateKey))
		},
		member
	);
	assert.equal(boot.status, 200, JSON.stringify(boot.body));
});
after(stopServer);

test('a sealed letter cannot follow someone to a facility its group does not serve: it is held for the writer', async () => {
	// Written for the group's anonymous writer, sealed to the group.
	const letter = client.encryptLetter('Sealed to the first group', [
		{ readerType: 'chapter', readerId: f.group.id, publicKey: groupKeys.publicKey, keyVersion: 1 }
	]);
	const sent = await post(
		'/messaging/message',
		{ ...letter.fields, sender: 'user', prisoner: f.prisoner1.id },
		member
	);
	assert.equal(sent.status, 201, JSON.stringify(sent.body));
	assert.equal(sent.body.data.relayChapter, f.group.id);

	const other = await Chapter.createChapter({
		name: 'Other Relay',
		location: {},
		accountStatus: 'active'
	});
	const elsewhere = await Prison.createPrison({
		prisonName: 'Elsewhere',
		address: { street: '9 Far' }
	});
	await Prison.addRelay(other.id, elsewhere.id);
	const moved = await put(
		'/prisoner/prisoner',
		{ id: f.prisoner1.id, prison: elsewhere.id },
		f.admin
	);
	assert.equal(moved.status, 200, JSON.stringify(moved.body));
	assert.deepEqual(moved.body.data.mail, {
		moved: true,
		freed: false,
		rerouted: 0,
		held: 1,
		released: 0
	});

	// The server cannot seal it to the other group, and must not hand it a letter it cannot read.
	const stored = await Message.findByPk(sent.body.data.id);
	assert.equal(stored.relayChapter, f.group.id);
	assert.equal(stored.heldReason, 'reseal_needed');
});
