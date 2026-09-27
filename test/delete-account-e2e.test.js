process.env.ENCRYPTION_MODE = 'e2e';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, put, del, makeFixtures, makeUser, User, Chapter } = await import(
	'./helpers.js'
);
const { default: OrgMemberKey } = await import('#models/org-member-key.model.js');
const client = await import('./e2e-client.js');

let f;
let holder;
let second;
let groupKeys;
const bytes = (b64) => Buffer.from(b64, 'base64');

before(async () => {
	await client.ready;
	await startServer();
	f = await makeFixtures();
	holder = { token: f.chapter.token, id: f.chapter.id, password: f.chapter.password };
	const mine = client.accountKeys(holder.password, 'RECOVERY');
	assert.equal((await put('/auth/keys', mine.fields, holder)).status, 200);
	groupKeys = client.keypair();
	const boot = await put(
		'/auth/chapter-keys',
		{
			chapter: f.group.id,
			publicKey: groupKeys.publicKey,
			wrappedOrgPrivateKey: client.seal(mine.fields.publicKey, bytes(groupKeys.privateKey))
		},
		holder
	);
	assert.equal(boot.status, 200, JSON.stringify(boot.body));
	const account = await makeUser({ role: 'chapter', username: 'secondmember' });
	await User.update({ chapterId: f.group.id }, { where: { id: account.id } });
	second = {
		token: account.token,
		id: account.id,
		password: account.password,
		keys: client.accountKeys(account.password, 'R2')
	};
	assert.equal((await put('/auth/keys', second.keys.fields, second)).status, 200);
});
after(stopServer);

test('a group-owner admin hands ownership on, and the last key holder hands the key on, before either can leave', async () => {
	// The owner of a chapter with other group admins cannot leave first.
	const owner = await del('/auth/user', { id: holder.id, password: holder.password }, holder);
	assert.equal(owner.status, 409, JSON.stringify(owner.body));
	assert.equal(owner.body.name, 'AccountDeleteError');
	assert.equal(owner.body.condition, 'group_owner');
	assert.match(owner.body.error, /group-owner admin/);

	// Ownership goes to someone who holds the key, so it is handed over first (a
	// keyless owner could not hand it on, and the chapter would be stranded).
	const wrapped = client.seal(second.keys.fields.publicKey, bytes(groupKeys.privateKey));
	const keyless = await put(
		'/auth/chapter-owner',
		{ chapter: f.group.id, user: second.id },
		holder
	);
	assert.equal(keyless.status, 409, JSON.stringify(keyless.body));
	assert.equal(keyless.body.code, 'owner.no_key');
	const handed = await put(
		'/auth/member-key',
		{ chapter: f.group.id, user: second.id, keyVersion: 1, wrappedOrgPrivateKey: wrapped },
		holder
	);
	assert.equal(handed.status, 200, JSON.stringify(handed.body));
	const transfer = await put(
		'/auth/chapter-owner',
		{ chapter: f.group.id, user: second.id },
		holder
	);
	assert.equal(transfer.status, 200, JSON.stringify(transfer.body));
	assert.deepEqual([transfer.body.data.owner, transfer.body.data.holdsGroupKey], [second.id, true]);

	// Only the owner hands keys now, so the old owner cannot.
	const byOldOwner = await put(
		'/auth/member-key',
		{ chapter: f.group.id, user: second.id, keyVersion: 1, wrappedOrgPrivateKey: wrapped },
		holder
	);
	assert.equal(byOldOwner.status, 403);

	// Now both hold it, and both leave at the same moment: each must not count the
	// other as the one who stays.
	const results = await Promise.all([
		del('/auth/user', { id: holder.id, password: holder.password }, holder),
		del('/auth/user', { id: second.id, password: second.password }, second)
	]);
	assert.deepEqual(
		results.map((r) => r.status).sort(),
		[200, 409],
		JSON.stringify(results.map((r) => r.body))
	);
	// The old owner left; the new owner, with other group admins gone, could leave too now.
	assert.equal(await User.count({ where: { id: holder.id } }), 0);
	assert.equal(
		await OrgMemberKey.count({ where: { chapterId: f.group.id } }),
		1,
		'the group keeps a holder'
	);
});

test('the last holder of a group key cannot leave, or the group could never read its letters', async () => {
	// A group with one group admin, who made its key: nobody to hand ownership to,
	// and nobody else holding the key.
	const group = await Chapter.createChapter({
		name: 'One Admin',
		location: {},
		accountStatus: 'active'
	});
	const account = await makeUser({ role: 'chapter', username: 'onlyadmin' });
	await User.update({ chapterId: group.id }, { where: { id: account.id } });
	const only = { token: account.token, id: account.id, password: account.password };
	const keys = client.accountKeys(only.password, 'R3');
	assert.equal((await put('/auth/keys', keys.fields, only)).status, 200);
	const theirs = client.keypair();
	const made = await put(
		'/auth/chapter-keys',
		{
			chapter: group.id,
			publicKey: theirs.publicKey,
			wrappedOrgPrivateKey: client.seal(keys.fields.publicKey, bytes(theirs.privateKey))
		},
		only
	);
	assert.equal(made.status, 200, JSON.stringify(made.body));
	const leave = await del('/auth/user', { id: only.id, password: only.password }, only);
	assert.equal(leave.status, 409, JSON.stringify(leave.body));
	assert.equal(leave.body.condition, 'last_key_holder');
	assert.match(leave.body.error, /last holder/);
	assert.equal(await User.count({ where: { id: only.id } }), 1);
});
