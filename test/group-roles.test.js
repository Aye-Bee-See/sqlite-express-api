process.env.ENCRYPTION_MODE = 'e2e';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, get, post, put, del, makeFixtures, makeUser, User, Chapter } =
	await import('./helpers.js');
const { newPenName } = await import('./helpers.js');
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

	// A superadmin belongs to no group, so naming none is a 400 for them.
	const unnamed = { publicKey: body.publicKey, wrappedOrgPrivateKey: body.wrappedOrgPrivateKey };
	const nowhere = await put('/auth/chapter-keys', unnamed, f.admin);
	assert.equal(nowhere.status, 400, JSON.stringify(nowhere.body));
	assert.deepEqual(nowhere.body.problems, [{ field: 'chapter', code: 'required' }]);

	// A group admin may leave `chapter` out: it is their own group (#185).
	const set = await put('/auth/chapter-keys', unnamed, owner);
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
	assert.equal((await told(fourth.id, 'group.waiting')).length, 0, 'not told of their own waiting');
	assert.ok(
		(await told(second.id, 'group.waiting')).length > 0,
		'every group admin, not only the owner'
	);
});

test('only the group-owner admin hands the key over, takes it away, or rotates; a holder who is not the owner cannot', async () => {
	// Without saying which version of the group key it sealed, it is refused (#185).
	const unversioned = await put(
		'/auth/member-key',
		{ chapter: f.group.id, user: second.id, wrappedOrgPrivateKey: wrappedFor(second) },
		owner
	);
	assert.equal(unversioned.status, 400, JSON.stringify(unversioned.body));
	assert.deepEqual(unversioned.body.problems, [{ field: 'keyVersion', code: 'required' }]);

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

	// Not to a group admin who does not hold the chapter key: they could neither hand
	// it on, nor take it back, nor rotate it, and the chapter would be stranded.
	const keyless = await put('/auth/chapter-owner', { chapter: f.group.id, user: second.id }, owner);
	assert.equal(keyless.status, 409, JSON.stringify(keyless.body));
	assert.equal(keyless.body.code, 'owner.no_key');
	assert.match(keyless.body.error, /does not hold the chapter key/);
	assert.equal((await Chapter.findByPk(f.group.id)).ownerId, owner.id, 'nothing moved');
	const byAdmin = await put(
		'/auth/chapter-owner',
		{ chapter: f.group.id, user: second.id },
		f.admin
	);
	assert.equal(byAdmin.status, 409, 'a superadmin cannot either: ' + JSON.stringify(byAdmin.body));

	// Handed the key first, they can be made owner.
	for (const who of [second, third]) {
		const handed = await put(
			'/auth/member-key',
			{ chapter: f.group.id, user: who.id, keyVersion: 1, wrappedOrgPrivateKey: wrappedFor(who) },
			owner
		);
		assert.equal(handed.status, 200, JSON.stringify(handed.body));
	}
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
	// The old owner manages nothing now; the new one does, and holds the key.
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
		1
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

	// Two transfers at once run one after the other under the lock, each from the
	// owner the previous one left: never two answers that both claim the same "previous".
	const results = await Promise.all([
		put('/auth/chapter-owner', { chapter: f.group.id, user: second.id }, f.admin),
		put('/auth/chapter-owner', { chapter: f.group.id, user: third.id }, f.admin)
	]);
	assert.deepEqual(
		results.map((r) => r.status),
		[200, 200],
		JSON.stringify(results.map((r) => r.body))
	);
	const chain = results.map((r) => r.body.data).sort((a) => (a.previous === owner.id ? -1 : 1));
	assert.equal(chain[1].previous, chain[0].owner, 'the second transfer saw the first');
	assert.equal((await Chapter.findByPk(f.group.id)).ownerId, chain[1].owner);
});

test('an owner, or the last group admin holding the key, is not moved out or given another role until they hand it on', async () => {
	assert.equal(
		(await put('/auth/chapter-owner', { chapter: f.group.id, user: owner.id }, f.admin)).status,
		200
	);
	const other = await Chapter.createChapter({
		name: 'Other',
		location: {},
		accountStatus: 'active'
	});
	const entries = await AuditLog.count({ where: { action: 'chapter.owner' } });
	// The chapter has other group admins: ownership is passed on first, as for deleting the account.
	for (const change of [
		{ chapterId: other.id },
		{ chapterId: null },
		{ role: 'user' },
		{ role: 'admin' }
	]) {
		const res = await put('/auth/user', { id: owner.id, ...change }, f.admin);
		assert.equal(res.status, 409, JSON.stringify(change) + ' ' + JSON.stringify(res.body));
		assert.equal(res.body.name, 'RoleChangeError');
		assert.equal(res.body.condition, 'group_owner');
		assert.equal(res.body.code, 'role_change.group_owner');
		assert.match(res.body.error, /Hand ownership to another group admin first/);
	}
	const after = await User.findByPk(owner.id);
	assert.deepEqual([after.role, after.chapterId], ['chapter', f.group.id], 'nothing changed');
	assert.equal((await Chapter.findByPk(f.group.id)).ownerId, owner.id);
	assert.equal(await AuditLog.count({ where: { action: 'chapter.owner' } }), entries);
	// A change that keeps them a group admin of the chapter is no change of either.
	assert.equal(
		(await put('/auth/user', { id: owner.id, role: 'chapter', chapterId: f.group.id }, f.admin))
			.status,
		200
	);

	// A ban is not held up: it is how a rogue owner is stopped. The chapter is
	// told, its history says why, and a superadmin names the next owner.
	assert.equal((await put('/auth/user', { id: owner.id, role: 'banned' }, f.admin)).status, 200);
	assert.equal((await Chapter.findByPk(f.group.id)).ownerId, null);
	assert.deepEqual((await told(second.id, 'group.owner')).at(-1).detail, {
		owner: null,
		previous: owner.id,
		by: 'superadmin'
	});
	const lastOwnerEntry = async (chapterId) =>
		await AuditLog.findOne({
			where: { action: 'chapter.owner', resource: 'chapter', targetId: chapterId },
			order: [['id', 'DESC']]
		});
	assert.deepEqual((await lastOwnerEntry(f.group.id)).details, {
		from: owner.id,
		to: null,
		by: 'superadmin',
		reason: 'role'
	});
	assert.equal((await lastOwnerEntry(f.group.id)).actor, f.admin.id);
	await User.update({ role: 'chapter' }, { where: { id: owner.id } });
	assert.equal(
		(await put('/auth/chapter-owner', { chapter: f.group.id, user: owner.id }, f.admin)).status,
		200
	);

	// The only group admin of a chapter without a key may be moved: ownership
	// goes with nobody left to pass it to, and the history says it went.
	const lone = await makeUser({ role: 'chapter', username: 'loneowner' });
	await User.update({ chapterId: other.id }, { where: { id: lone.id } });
	await Chapter.setOwner(other.id, lone.id, null);
	assert.equal((await put('/auth/user', { id: lone.id, chapterId: null }, f.admin)).status, 200);
	assert.equal((await Chapter.findByPk(other.id)).ownerId, null);
	assert.deepEqual((await lastOwnerEntry(other.id)).details, {
		from: lone.id,
		to: null,
		by: 'superadmin',
		reason: 'moved'
	});
});

test('the only group admin of a keyed chapter cannot be made a superadmin and leave it stranded', async () => {
	// One group admin sets the key and owns the chapter: the way a group starts.
	const solo = await Chapter.createChapter({
		name: 'Solo',
		location: {},
		accountStatus: 'active'
	});
	const founder = await makeUser({ role: 'chapter', username: 'solofounder' });
	await User.update({ chapterId: solo.id }, { where: { id: founder.id } });
	const founderKeys = client.accountKeys(founder.password, 'R-solofounder');
	const first = { token: founder.token, id: founder.id, keys: founderKeys };
	assert.equal((await put('/auth/keys', founderKeys.fields, first)).status, 200);
	const soloKey = client.keypair();
	const sealedFor = (who) => client.seal(who.keys.fields.publicKey, bytes(soloKey.privateKey));
	const set = await put(
		'/auth/chapter-keys',
		{ chapter: solo.id, publicKey: soloKey.publicKey, wrappedOrgPrivateKey: sealedFor(first) },
		first
	);
	assert.equal(set.status, 200, JSON.stringify(set.body));
	assert.equal((await Chapter.findByPk(solo.id)).ownerId, founder.id);

	// Promoting them would leave the chapter with no owner and nobody able to hand the key on.
	const alone = await put('/auth/user', { id: founder.id, role: 'admin' }, f.admin);
	assert.equal(alone.status, 409, JSON.stringify(alone.body));
	assert.equal(alone.body.code, 'role_change.last_key_holder');
	assert.match(alone.body.error, /last holder of the key of Solo/);
	assert.equal((await User.findByPk(founder.id)).role, 'chapter');

	// A second group admin joins: now it is ownership that has to move first.
	const account = await makeUser({ role: 'chapter', username: 'solosecond' });
	await User.update({ chapterId: solo.id }, { where: { id: account.id } });
	const secondKeys = client.accountKeys(account.password, 'R-solosecond');
	const next = { token: account.token, id: account.id, keys: secondKeys };
	assert.equal((await put('/auth/keys', secondKeys.fields, next)).status, 200);
	assert.equal(
		(await put('/auth/user', { id: founder.id, role: 'admin' }, f.admin)).body.code,
		'role_change.group_owner'
	);

	// The founder hands the key over and passes ownership; then the promotion goes through.
	assert.equal(
		(
			await put(
				'/auth/member-key',
				{ chapter: solo.id, user: next.id, keyVersion: 1, wrappedOrgPrivateKey: sealedFor(next) },
				first
			)
		).status,
		200
	);
	assert.equal(
		(await put('/auth/chapter-owner', { chapter: solo.id, user: next.id }, first)).status,
		200
	);
	const promoted = await put('/auth/user', { id: founder.id, role: 'admin' }, f.admin);
	assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
	assert.equal((await Chapter.findByPk(solo.id)).ownerId, next.id, 'the new owner stays owner');

	// The promoted account's old copy no longer counts: the new owner is now the
	// last group admin holding the key, and cannot be moved out either.
	const moved = await put('/auth/user', { id: next.id, chapterId: null }, f.admin);
	assert.equal(moved.status, 409, JSON.stringify(moved.body));
	assert.equal(moved.body.code, 'role_change.last_key_holder');
});

test('old copies of a key held outside the group do not block deleting an account, except the last copy anywhere', async () => {
	// Two accounts that once held a chapter's key and are no longer its group admins
	// (moved or banned before the guards, as on production on 13 November).
	const gone = await Chapter.createChapter({
		name: 'Gone',
		location: {},
		accountStatus: 'active'
	});
	const keyOf = (holder) =>
		OrgMemberKey.put({
			chapterId: gone.id,
			userId: holder.id,
			wrappedOrgPrivateKey: Buffer.from('sealed for ' + holder.id).toString('base64'),
			addedBy: holder.id
		});
	const x = await makeUser({ role: 'user', username: 'formerholderx' });
	const y = await makeUser({ role: 'admin', username: 'formerholdery' });
	await keyOf(x);
	await keyOf(y);

	// Neither can hand the key on, so neither copy is in use; one may go.
	const first = await del('/auth/user', { id: x.id }, f.admin);
	assert.equal(first.status, 200, JSON.stringify(first.body));
	// The other is the only copy left anywhere: kept, because making the account a
	// group admin of the chapter again is how the chapter gets its key back.
	const last = await del('/auth/user', { id: y.id }, f.admin);
	assert.equal(last.status, 409, JSON.stringify(last.body));
	assert.equal(last.body.code, 'account_delete.last_key_holder');
	assert.match(last.body.error, /only remaining copy of the key of Gone/);
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
		penName: newPenName(),
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

test('an owner who passed the check a moment ago cannot act once ownership moved: the check is redone under the lock', async () => {
	const { withGroupKeyLock } = await import('#rtServices/groupkey.services.js');
	if ((await Chapter.findByPk(f.group.id)).ownerId !== owner.id) {
		assert.equal(
			(await put('/auth/chapter-owner', { chapter: f.group.id, user: owner.id }, f.admin)).status,
			200
		);
	}
	// Third holds no key to start with, so the refused hand-over below shows as none.
	if (await OrgMemberKey.count({ where: { chapterId: f.group.id, userId: third.id } })) {
		const taken = await del('/auth/member-key', { chapter: f.group.id, user: third.id }, owner);
		assert.equal(taken.status, 200, JSON.stringify(taken.body));
	}
	// Hold the lock every change of holders and owners takes. The requests below pass
	// their first look (owner is owner) and then queue behind it, the transfer first.
	let release;
	const holding = withGroupKeyLock(() => new Promise((resolve) => (release = resolve)));
	await new Promise((resolve) => setTimeout(resolve, 20));
	const transfer = put('/auth/chapter-owner', { chapter: f.group.id, user: second.id }, f.admin);
	await new Promise((resolve) => setTimeout(resolve, 20));
	const handOver = put(
		'/auth/member-key',
		{ chapter: f.group.id, user: third.id, keyVersion: 1, wrappedOrgPrivateKey: wrappedFor(third) },
		owner
	);
	const removal = del('/auth/member-key', { chapter: f.group.id, user: second.id }, owner);
	await new Promise((resolve) => setTimeout(resolve, 20));
	release();
	await holding;
	const [moved, handed, removed] = await Promise.all([transfer, handOver, removal]);
	assert.equal(moved.status, 200, JSON.stringify(moved.body));
	assert.equal(handed.status, 403, JSON.stringify(handed.body));
	assert.equal(removed.status, 403, JSON.stringify(removed.body));
	assert.equal(await OrgMemberKey.count({ where: { chapterId: f.group.id, userId: third.id } }), 0);
	// The old owner's rotation fails on the same ground.
	assert.equal((await get('/auth/chapter-rotation?chapter=' + f.group.id, owner)).status, 403);
	assert.equal(
		(await put('/auth/chapter-owner', { chapter: f.group.id, user: owner.id }, f.admin)).status,
		200
	);
});
