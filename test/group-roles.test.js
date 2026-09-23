process.env.ENCRYPTION_MODE = 'e2e';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, get, post, put, del, makeFixtures, makeUser, User, Chapter } =
	await import('./helpers.js');
const { default: OrgMemberKey } = await import('#models/org-member-key.model.js');
const { default: Notification } = await import('#models/notification.model.js');
const { default: AuditLog } = await import('#models/audit-log.model.js');
const client = await import('./e2e-client.js');

let f;
let owner; // the fixture group admin, who sets the chapter key
let second; // another group admin of the fixture chapter
let third;
let groupKeys;
const bytes = (b64) => Buffer.from(b64, 'base64');

/** A group admin of the fixture chapter with their own keys set. */
async function groupAdmin(username) {
	const account = await makeUser({ role: 'chapter', username });
	await User.update({ chapterId: f.group.id }, { where: { id: account.id } });
	const keys = client.accountKeys(account.password, 'R-' + username);
	const me = { token: account.token, id: account.id, password: account.password, keys };
	assert.equal((await put('/auth/keys', keys.fields, me)).status, 200);
	return me;
}
const wrappedFor = (who) => client.seal(who.keys.fields.publicKey, bytes(groupKeys.privateKey));
const told = async (userId, event) =>
	await Notification.findAll({ where: { userId, event }, order: [['id', 'ASC']] });

before(async () => {
	await client.ready;
	await startServer();
	f = await makeFixtures();
	const keys = client.accountKeys(f.chapter.password, 'RECOVERY');
	owner = { token: f.chapter.token, id: f.chapter.id, password: f.chapter.password, keys };
	assert.equal((await put('/auth/keys', keys.fields, owner)).status, 200);
	second = await groupAdmin('secondadmin');
	third = await groupAdmin('thirdadmin');
	groupKeys = client.keypair();
});
after(stopServer);

test('a superadmin cannot make a chapter key; the group admin who does becomes the group-owner admin, and everyone is told', async () => {
	const body = {
		chapter: f.group.id,
		publicKey: groupKeys.publicKey,
		wrappedOrgPrivateKey: client.seal(owner.keys.fields.publicKey, bytes(groupKeys.privateKey))
	};
	const bySuperadmin = await put('/auth/chapter-keys', { ...body, user: owner.id }, f.admin);
	assert.equal(bySuperadmin.status, 403, JSON.stringify(bySuperadmin.body));
	assert.match(bySuperadmin.body.info, /superadmin cannot/);
	assert.equal((await Chapter.findByPk(f.group.id)).publicKey, null);

	const set = await put('/auth/chapter-keys', body, owner);
	assert.equal(set.status, 200, JSON.stringify(set.body));
	assert.equal(set.body.data.owner, owner.id);
	assert.equal((await Chapter.findByPk(f.group.id)).ownerId, owner.id);
	for (const who of [second, third]) {
		assert.deepEqual((await told(who.id, 'group.key')).at(-1).detail, {
			action: 'set',
			member: owner.id,
			keyVersion: 1
		});
		assert.deepEqual((await told(who.id, 'group.owner')).at(-1).detail, {
			owner: owner.id,
			by: 'first key'
		});
	}
	assert.equal((await told(owner.id, 'group.key')).length, 0, 'not the actor');
	// The audit log names the owner; the key bundle says so to them.
	assert.equal(
		(await AuditLog.findOne({ where: { action: 'chapter.keys' }, order: [['id', 'DESC']] })).details
			.owner,
		owner.id
	);
	const bundle = (await get('/auth/keys', owner)).body.data.orgKey;
	assert.deepEqual([bundle.owner, bundle.isOwner], [owner.id, true]);
	assert.equal((await get('/auth/keys', second)).body.data.orgKey.isOwner, false);
});

test('group admins with keys and no copy of the chapter key are listed as waiting, and the chapter is told when one arrives', async () => {
	const list = await get('/auth/member-keys?chapter=' + f.group.id, second);
	assert.equal(list.status, 200);
	assert.equal(list.body.data.owner, owner.id);
	assert.deepEqual(list.body.data.waiting.sort(), [second.id, third.id].sort());
	// A newcomer who sets their keys up after the chapter has its key: the chapter hears at once.
	const fourth = await makeUser({ role: 'chapter', username: 'fourthadmin' });
	await User.update({ chapterId: f.group.id }, { where: { id: fourth.id } });
	const keys = client.accountKeys(fourth.password, 'R4');
	const res = await put('/auth/keys', keys.fields, { token: fourth.token });
	assert.equal(res.status, 200);
	assert.equal(res.body.data.waitingForGroupKey, true);
	assert.deepEqual((await told(owner.id, 'group.waiting')).at(-1).detail, { member: fourth.id });
	assert.ok(
		(await told(second.id, 'group.waiting')).length > 0,
		'every group admin, not only the owner'
	);
});

test('only the group-owner admin hands the key over, takes it away, or rotates; a holder who is not the owner cannot', async () => {
	// The owner hands the key to second.
	const handed = await put(
		'/auth/member-key',
		{
			chapter: f.group.id,
			user: second.id,
			keyVersion: 1,
			wrappedOrgPrivateKey: wrappedFor(second)
		},
		owner
	);
	assert.equal(handed.status, 200, JSON.stringify(handed.body));
	assert.deepEqual((await told(third.id, 'group.key')).at(-1).detail, {
		action: 'handed',
		member: second.id
	});
	// Second holds it now and still cannot manage anyone.
	const byHolder = await put(
		'/auth/member-key',
		{ chapter: f.group.id, user: third.id, keyVersion: 1, wrappedOrgPrivateKey: wrappedFor(third) },
		second
	);
	assert.equal(byHolder.status, 403, JSON.stringify(byHolder.body));
	assert.match(byHolder.body.info, /group-owner admin/);
	assert.equal(
		(await del('/auth/member-key', { chapter: f.group.id, user: owner.id }, second)).status,
		403
	);
	assert.equal((await get('/auth/chapter-rotation?chapter=' + f.group.id, second)).status, 403);
	// Nor can a superadmin.
	assert.equal(
		(
			await put(
				'/auth/member-key',
				{ chapter: f.group.id, user: third.id, wrappedOrgPrivateKey: wrappedFor(third) },
				f.admin
			)
		).status,
		403
	);
	assert.equal(
		(await del('/auth/member-key', { chapter: f.group.id, user: second.id }, f.admin)).status,
		403
	);
	assert.equal(await OrgMemberKey.count({ where: { chapterId: f.group.id } }), 2);
	// The owner takes it away again; second is told as well as everyone else.
	const removed = await del('/auth/member-key', { chapter: f.group.id, user: second.id }, owner);
	assert.equal(removed.status, 200, JSON.stringify(removed.body));
	assert.deepEqual((await told(second.id, 'group.key')).at(-1).detail, {
		action: 'removed',
		member: second.id
	});
});

test('ownership passes to one other group admin, by the owner or by a superadmin, and everyone is told', async () => {
	// Not to a writer, not to a member of another chapter, not to the owner themselves.
	assert.equal(
		(await put('/auth/chapter-owner', { chapter: f.group.id, user: f.alice.id }, owner)).status,
		400
	);
	assert.equal(
		(await put('/auth/chapter-owner', { chapter: f.group.id, user: owner.id }, owner)).status,
		409
	);
	// Not by a group admin who is not the owner.
	assert.equal(
		(await put('/auth/chapter-owner', { chapter: f.group.id, user: third.id }, second)).status,
		403
	);

	const byOwner = await put('/auth/chapter-owner', { chapter: f.group.id, user: second.id }, owner);
	assert.equal(byOwner.status, 200, JSON.stringify(byOwner.body));
	assert.deepEqual([byOwner.body.data.owner, byOwner.body.data.previous], [second.id, owner.id]);
	assert.equal((await Chapter.findByPk(f.group.id)).ownerId, second.id);
	assert.deepEqual((await told(third.id, 'group.owner')).at(-1).detail, {
		owner: second.id,
		previous: owner.id,
		by: 'owner'
	});
	assert.deepEqual(
		(await told(owner.id, 'group.owner')).at(-1).detail.owner,
		second.id,
		'the old owner is told too'
	);
	// The old owner manages nothing now; the new one does, and holds no key until handed it.
	assert.equal(
		(
			await put(
				'/auth/member-key',
				{
					chapter: f.group.id,
					user: third.id,
					keyVersion: 1,
					wrappedOrgPrivateKey: wrappedFor(third)
				},
				owner
			)
		).status,
		403
	);
	assert.equal((await get('/auth/keys', second)).body.data.orgKey.isOwner, true);
	assert.equal(
		await OrgMemberKey.count({ where: { chapterId: f.group.id, userId: second.id } }),
		0
	);

	// A superadmin moves it back, whatever the owner thinks: the remedy for a rogue or vanished owner.
	const bySuperadmin = await put(
		'/auth/chapter-owner',
		{ chapter: f.group.id, user: owner.id },
		f.admin
	);
	assert.equal(bySuperadmin.status, 200, JSON.stringify(bySuperadmin.body));
	assert.equal(
		(await AuditLog.findOne({ where: { action: 'chapter.owner' }, order: [['id', 'DESC']] }))
			.details.by,
		'superadmin'
	);
	assert.deepEqual((await told(second.id, 'group.owner')).at(-1).detail, {
		owner: owner.id,
		previous: second.id,
		by: 'superadmin'
	});

	// Two transfers at once, each conditional on the owner it read: one wins.
	const results = await Promise.all([
		put('/auth/chapter-owner', { chapter: f.group.id, user: second.id }, f.admin),
		put('/auth/chapter-owner', { chapter: f.group.id, user: third.id }, f.admin)
	]);
	assert.deepEqual(
		results.map((r) => r.status).sort(),
		[200, 409],
		JSON.stringify(results.map((r) => r.body))
	);
});

test('an owner moved out of the chapter, or made a writer, owns it no more', async () => {
	assert.equal(
		(await put('/auth/chapter-owner', { chapter: f.group.id, user: owner.id }, f.admin)).status,
		200
	);
	assert.equal((await Chapter.findByPk(f.group.id)).ownerId, owner.id);
	const other = await Chapter.createChapter({
		name: 'Other',
		location: {},
		accountStatus: 'active'
	});
	assert.equal(
		(await put('/auth/user', { id: owner.id, chapterId: other.id }, f.admin)).status,
		200
	);
	assert.equal((await Chapter.findByPk(f.group.id)).ownerId, null);
	assert.equal(
		(await put('/auth/user', { id: owner.id, chapterId: f.group.id }, f.admin)).status,
		200
	);
	// The chapter has a key and no owner: the superadmin names one.
	assert.equal(
		(await put('/auth/chapter-owner', { chapter: f.group.id, user: owner.id }, f.admin)).status,
		200
	);
	assert.equal((await put('/auth/user', { id: owner.id, role: 'user' }, f.admin)).status, 200);
	assert.equal((await Chapter.findByPk(f.group.id)).ownerId, null);
	await User.update({ role: 'chapter' }, { where: { id: owner.id } });
	await Chapter.setOwner(f.group.id, owner.id, null);
});

test('a chapter that joins by invitation gets its founder as group-owner admin', async () => {
	const invite = await post(
		'/invitation/invitation',
		{ kind: 'group', inviteeName: 'Founder' },
		owner
	);
	assert.equal(invite.status, 201, JSON.stringify(invite.body));
	const keys = client.splitKeys('founder password 1', 'RF');
	const accepted = await post('/invitation/accept', {
		token: invite.body.data.token,
		username: 'founder',
		email: 'founder@example.com',
		password: keys.authKey,
		group: { name: 'Founded Group', location: {} },
		...keys.fields
	});
	assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
	const chapter = await Chapter.findByPk(accepted.body.data.chapter.id);
	assert.equal(chapter.ownerId, accepted.body.data.user.id);
});
