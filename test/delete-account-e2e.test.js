process.env.ENCRYPTION_MODE = 'e2e';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, put, del, makeFixtures, makeUser, User } = await import(
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

	const transfer = await put(
		'/auth/chapter-owner',
		{ chapter: f.group.id, user: second.id },
		holder
	);
	assert.equal(transfer.status, 200, JSON.stringify(transfer.body));
	assert.deepEqual(
		[transfer.body.data.owner, transfer.body.data.holdsGroupKey],
		[second.id, false]
	);

	// No longer the owner, still the only one who can open the chapter's key.
	const stuck = await del('/auth/user', { id: holder.id, password: holder.password }, holder);
	assert.equal(stuck.status, 409, JSON.stringify(stuck.body));
	assert.match(stuck.body.error, /last holder/);
	assert.equal(await User.count({ where: { id: holder.id } }), 1);

	// Only the owner hands keys now, so the old owner cannot; the new owner does.
	const wrapped = client.seal(second.keys.fields.publicKey, bytes(groupKeys.privateKey));
	const byOldOwner = await put(
		'/auth/member-key',
		{ chapter: f.group.id, user: second.id, keyVersion: 1, wrappedOrgPrivateKey: wrapped },
		holder
	);
	assert.equal(byOldOwner.status, 403);
	const handed = await put(
		'/auth/member-key',
		{ chapter: f.group.id, user: second.id, keyVersion: 1, wrappedOrgPrivateKey: wrapped },
		second
	);
	assert.equal(handed.status, 200, JSON.stringify(handed.body));

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
