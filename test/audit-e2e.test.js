process.env.ENCRYPTION_MODE = 'e2e';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, get, post, put, makeFixtures, makeUser, User, Chapter } =
	await import('./helpers.js');
const client = await import('./e2e-client.js');

/**
 * The end-to-end findings of the September 2026 audit, one test each.
 */

let f;
let holder; // the fixture member, who holds the group key
let second; // a member of the same group who was never given it
let secondKeys;
let groupKeys;

const bytes = (b64) => Buffer.from(b64, 'base64');

before(async () => {
	await client.ready;
	await startServer();
	f = await makeFixtures();
	holder = { token: f.chapter.token };
	const m = client.accountKeys(f.chapter.password, 'RECOVERY');
	assert.equal((await put('/auth/keys', m.fields, holder)).status, 200);
	groupKeys = client.keypair();
	const boot = await put(
		'/auth/chapter-keys',
		{
			chapter: f.group.id,
			publicKey: groupKeys.publicKey,
			wrappedOrgPrivateKey: client.seal(m.fields.publicKey, bytes(groupKeys.privateKey))
		},
		holder
	);
	assert.equal(boot.status, 200, JSON.stringify(boot.body));

	const account = await makeUser({ role: 'chapter', username: 'newmember' });
	await User.update({ chapterId: f.group.id }, { where: { id: account.id } });
	second = { token: account.token, id: account.id };
	secondKeys = client.accountKeys(account.password, 'RECOVERY-2');
	assert.equal((await put('/auth/keys', secondKeys.fields, second)).status, 200);
});
after(stopServer);

const firstKeysFor = (writerId) => {
	const keys = client.keypair();
	return {
		id: writerId,
		publicKey: keys.publicKey,
		orgWrappedPrivateKey: client.seal(groupKeys.publicKey, bytes(keys.privateKey)),
		orgKeyVersion: 1
	};
};

test('only a member who holds the group key can give a writer their first keys', async () => {
	// Whoever makes the keypair knows its private half, and the writer's history is sealed to it next.
	const refused = await put('/auth/user', firstKeysFor(f.writer.id), second);
	assert.equal(refused.status, 403, JSON.stringify(refused.body));
	assert.equal((await User.findByPk(f.writer.id)).publicKey, null);
	const ok = await put('/auth/user', firstKeysFor(f.writer.id), holder);
	assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test("the group's sealed copy of a writer's key cannot be emptied", async () => {
	const res = await put('/auth/user', { id: f.writer.id, orgWrappedPrivateKey: '' }, holder);
	assert.equal(res.status, 400, JSON.stringify(res.body));
	const stored = await User.scope('withKeys').findByPk(f.writer.id);
	assert.ok(stored.orgWrappedPrivateKey);
});

test('an admin cannot move a keyed writer to a group that cannot open their key', async () => {
	const other = await Chapter.createChapter({
		name: 'Other Group',
		location: {},
		accountStatus: 'active'
	});
	const res = await put('/auth/user', { id: f.writer.id, managedBy: other.id }, f.admin);
	assert.equal(res.status, 409, JSON.stringify(res.body));
	assert.equal((await User.findByPk(f.writer.id)).managedBy, f.group.id);
});

test('a new account has all of its first keys or none', async () => {
	const lonely = await post('/auth/user', {
		username: 'halfkeyed',
		password: 'longenough',
		email: 'halfkeyed@example.com',
		publicKey: client.keypair().publicKey
	});
	assert.equal(lonely.status, 400, JSON.stringify(lonely.body));
	assert.match(lonely.body.errors[0], /wrappedPrivateKey/);
	assert.equal(await User.count({ where: { username: 'halfkeyed' } }), 0);
});

test('a member key wrapped from a rotated-away group key is refused', async () => {
	const body = {
		chapter: f.group.id,
		user: second.id,
		wrappedOrgPrivateKey: client.seal(secondKeys.fields.publicKey, bytes(groupKeys.privateKey))
	};
	const stale = await put('/auth/member-key', { ...body, keyVersion: 0 }, holder);
	assert.equal(stale.status, 409, JSON.stringify(stale.body));
	assert.equal(stale.body.name, 'KeyVersionError');
	const ok = await put('/auth/member-key', { ...body, keyVersion: 1 }, holder);
	assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test('an account demoted from its group stops being handed the group key', async () => {
	const before = await get('/auth/keys', second);
	assert.ok(before.body.data.orgKey.wrappedOrgPrivateKey);
	await User.update({ role: 'user' }, { where: { id: second.id } });
	const afterwards = await get('/auth/keys', second);
	assert.equal(afterwards.status, 200);
	assert.equal(afterwards.body.data.orgKey, null);
});

test('a group that is not active sets up and changes no group keys', async () => {
	await Chapter.update({ accountStatus: 'suspended' }, { where: { id: f.group.id } });
	const res = await get('/auth/member-keys?chapter=' + f.group.id, holder);
	assert.equal(res.status, 403, JSON.stringify(res.body));
	await Chapter.update({ accountStatus: 'active' }, { where: { id: f.group.id } });
	assert.equal((await get('/auth/member-keys?chapter=' + f.group.id, holder)).status, 200);
});
