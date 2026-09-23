import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	get,
	post,
	put,
	del,
	makeFixtures,
	makeUser,
	User,
	Chapter,
	Prison,
	Prisoner
} from './helpers.js';

let f;
let admin;
let chapter;
let alice;
let pendingGroup;
let pendingMember;

before(async () => {
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
	chapter = { token: f.chapter.token };
	alice = { token: f.alice.token };
	pendingGroup = await Chapter.createChapter({ name: 'New Collective', location: {} });
	const member = await makeUser({ role: 'chapter', username: 'newmember' });
	await User.update({ chapterId: pendingGroup.id }, { where: { id: member.id } });
	pendingMember = { token: member.token, id: member.id };
});
after(stopServer);

// ---- fields ---------------------------------------------------------------

test('groups carry a network role and an account status with defaults', async () => {
	assert.equal(pendingGroup.networkRole, 'collecting');
	assert.equal(pendingGroup.accountStatus, 'pending');
	const res = await post(
		'/chapter/chapter',
		{ name: 'Relay Hub', location: {}, networkRole: 'relay', accountStatus: 'active' },
		admin
	);
	assert.equal(res.status, 201);
	assert.equal(res.body.data.networkRole, 'relay');
	assert.equal(res.body.data.accountStatus, 'active');
	const badRole = await post(
		'/chapter/chapter',
		{ name: 'X', location: {}, networkRole: 'hub' },
		admin
	);
	assert.equal(badRole.status, 400);
	assert.match(badRole.body.errors[0], /Network role must be one of/);
	const badStatus = await post(
		'/chapter/chapter',
		{ name: 'X', location: {}, accountStatus: 'gone' },
		admin
	);
	assert.equal(badStatus.status, 400);
	const pub = await get('/chapter/chapter?id=' + res.body.data.id);
	assert.equal(pub.body.data.networkRole, 'relay');
});

test('only an admin sets account status; a chapter-created group starts pending', async () => {
	const own = await post('/chapter/chapter', { name: 'Sister Group', location: {} }, chapter);
	assert.equal(own.status, 201);
	assert.equal(own.body.data.accountStatus, 'pending');
	const sneaky = await post(
		'/chapter/chapter',
		{ name: 'X', location: {}, accountStatus: 'active' },
		chapter
	);
	assert.equal(sneaky.status, 403);
	const viaUpdate = await put(
		'/chapter/chapter',
		{ id: own.body.data.id, accountStatus: 'active' },
		chapter
	);
	assert.equal(viaUpdate.status, 403);
	assert.match(viaUpdate.body.info, /Only an admin/);
	const other = await put(
		'/chapter/chapter',
		{ id: own.body.data.id, networkRole: 'both' },
		chapter
	);
	assert.equal(other.status, 403, 'not their own group');
	assert.match(other.body.info, /only edit its own record/);
	assert.equal((await del('/chapter/chapter', { id: own.body.data.id }, chapter)).status, 403);
	const role = await put('/chapter/chapter', { id: f.group.id, networkRole: 'both' }, chapter);
	assert.equal(role.status, 200, 'a group may change its own network role');
	assert.equal((await Chapter.findByPk(f.group.id)).networkRole, 'both');
	const activate = await put(
		'/chapter/chapter',
		{ id: own.body.data.id, accountStatus: 'active' },
		admin
	);
	assert.equal(activate.status, 200);
	assert.equal((await Chapter.findByPk(own.body.data.id)).accountStatus, 'active');
	const proposed = await post(
		'/moderation/submission',
		{ resource: 'chapter', target: own.body.data.id, fields: { accountStatus: 'suspended' } },
		chapter
	);
	assert.equal(proposed.status, 400, 'account status is reviewer-only in moderation');
});

// ---- what a pending group can and cannot do -------------------------------

test('a pending group account can read but not act', async () => {
	assert.equal((await get('/prison/prisons', pendingMember)).status, 200);
	// Directory writes are superadmins' now; a group proposes, and a pending group not even that.
	assert.equal(
		(await put('/prison/prison', { id: f.prison.id, notes: 'x' }, pendingMember)).status,
		403
	);
	const write = await post(
		'/moderation/submission',
		{ resource: 'prison', target: f.prison.id, fields: { notes: 'x' } },
		pendingMember
	);
	assert.equal(write.status, 403);
	assert.match(write.body.info, /waiting for network approval/);
	const link = await put(
		'/prison/relay',
		{ prison: f.prison.id, chapter: pendingGroup.id },
		pendingMember
	);
	assert.equal(link.status, 403);
	assert.match(link.body.info, /waiting for network approval/);
	const writer = await post('/auth/writer', { name: 'Someone' }, pendingMember);
	assert.equal(writer.status, 403);
	assert.match(writer.body.info, /waiting for network approval/);
	assert.deepEqual((await get('/chat/chats', pendingMember)).body.data, []);
	assert.deepEqual((await get('/messaging/messages', pendingMember)).body.data, []);
	const letter = await post(
		'/messaging/message',
		{ messageText: 'Hello', sender: 'user', prisoner: f.prisoner1.id },
		pendingMember
	);
	assert.equal(letter.status, 403);
	assert.match(letter.body.info, /waiting for network approval/);

	await Chapter.update({ accountStatus: 'active' }, { where: { id: pendingGroup.id } });
	assert.equal(
		(
			await post(
				'/moderation/submission',
				{ resource: 'prison', target: f.prison.id, fields: { notes: 'now allowed' } },
				pendingMember
			)
		).status,
		201
	);
	assert.equal((await post('/auth/writer', { name: 'Someone' }, pendingMember)).status, 201);

	await Chapter.update({ accountStatus: 'suspended' }, { where: { id: pendingGroup.id } });
	const suspended = await post(
		'/moderation/submission',
		{ resource: 'prison', target: f.prison.id, fields: { notes: 'x' } },
		pendingMember
	);
	assert.equal(suspended.status, 403);
	assert.match(suspended.body.info, /suspended/);
	await Chapter.update({ accountStatus: 'pending' }, { where: { id: pendingGroup.id } });
});

test('a group without any chapter record is refused with the older message', async () => {
	const orphan = await makeUser({ role: 'chapter', username: 'orphan' });
	const res = await post(
		'/moderation/submission',
		{ resource: 'prison', target: f.prison.id, fields: { notes: 'x' } },
		{ token: orphan.token }
	);
	assert.equal(res.status, 403);
	assert.match(res.body.info, /not a member of a group yet/);
});

// ---- relay availability ---------------------------------------------------

test('only active groups count as relay groups', async () => {
	const prison = await Prison.createPrison({ prisonName: 'Two Relay Prison', address: {} });
	await Prison.addRelay(f.group.id, prison.id);
	await Prison.addRelay(pendingGroup.id, prison.id);
	const prisoner = await Prisoner.createPrisoner({ birthName: 'R', prison: prison.id });
	const letter = await post(
		'/messaging/message',
		{ messageText: 'Hi', sender: 'user', prisoner: prisoner.id },
		alice
	);
	assert.equal(letter.status, 201);
	assert.equal(letter.body.data.relayChapter, f.group.id, 'the pending group is not a candidate');
	const explicit = await post(
		'/messaging/message',
		{ messageText: 'Hi', sender: 'user', prisoner: prisoner.id, relayChapter: pendingGroup.id },
		alice
	);
	assert.equal(explicit.status, 400);

	const onlyPending = await Prison.createPrison({ prisonName: 'Pending Only', address: {} });
	await Prison.addRelay(pendingGroup.id, onlyPending.id);
	const withRelay = await get('/prison/prisons?relay=true&page_size=100');
	assert.ok(withRelay.body.data.some((p) => p.id === prison.id));
	assert.ok(!withRelay.body.data.some((p) => p.id === onlyPending.id));
	assert.ok(!withRelay.body.data.some((p) => p.id === f.prison.id));
	const without = await get('/prison/prisons?relay=false&page_size=100');
	assert.ok(without.body.data.some((p) => p.id === onlyPending.id));
	assert.ok(without.body.data.some((p) => p.id === f.prison.id));
	assert.ok(!without.body.data.some((p) => p.id === prison.id));
	const searched = await get('/prison/prisons?relay=true&q=Two&page_size=100');
	assert.deepEqual(
		searched.body.data.map((p) => p.id),
		[prison.id]
	);
	assert.equal((await get('/prison/prisons?relay=maybe')).status, 400);
});

// ---- group filters --------------------------------------------------------

test('groups filter by network role and account status', async () => {
	await Chapter.createChapter({
		name: 'Both Ways',
		location: {},
		networkRole: 'both',
		accountStatus: 'active'
	});
	const relay = await get('/chapter/chapters?networkRole=relay&page_size=100');
	assert.equal(relay.status, 200);
	assert.ok(relay.body.data.every((c) => ['relay', 'both'].includes(c.networkRole)));
	assert.ok(relay.body.data.some((c) => c.name === 'Both Ways'));
	assert.ok(relay.body.data.some((c) => c.name === 'Relay Hub'));
	const collecting = await get('/chapter/chapters?networkRole=collecting&page_size=100');
	assert.ok(collecting.body.data.every((c) => ['collecting', 'both'].includes(c.networkRole)));
	assert.ok(collecting.body.data.some((c) => c.name === 'Both Ways'));
	assert.ok(!collecting.body.data.some((c) => c.name === 'Relay Hub'));
	assert.equal((await get('/chapter/chapters?networkRole=both')).status, 400);
	const pending = await get('/chapter/chapters?accountStatus=pending&page_size=100');
	assert.ok(pending.body.data.every((c) => c.accountStatus === 'pending'));
	assert.ok(pending.body.data.some((c) => c.id === pendingGroup.id));
	const combined = await get('/chapter/chapters?networkRole=collecting&q=Both&page_size=100');
	assert.deepEqual(
		combined.body.data.map((c) => c.name),
		['Both Ways']
	);

	const summary = await get('/moderation/summary', admin);
	assert.ok(summary.body.data.groups.pendingApproval >= 1);
	assert.equal(typeof summary.body.data.groups.suspended, 'number');
});

test('a pending group is told why on every write path, and cannot manage its writers', async () => {
	// Set up while active: a writer and a relayed letter.
	await Chapter.update({ accountStatus: 'active' }, { where: { id: pendingGroup.id } });
	const writer = (await post('/auth/writer', { name: 'Held Writer' }, pendingMember)).body.data;
	const relayPrison = await Prison.createPrison({ prisonName: 'Held Prison', address: {} });
	await Prison.addRelay(pendingGroup.id, relayPrison.id);
	const held = await Prisoner.createPrisoner({ birthName: 'Held', prison: relayPrison.id });
	const letter = (
		await post(
			'/messaging/message',
			{ messageText: 'Held', sender: 'user', prisoner: held.id },
			alice
		)
	).body.data;
	assert.equal(letter.relayChapter, pendingGroup.id);
	await Chapter.update({ accountStatus: 'pending' }, { where: { id: pendingGroup.id } });

	for (const res of [
		await put('/auth/user', { id: writer.id, name: 'Renamed' }, pendingMember),
		await get('/auth/user?id=' + writer.id, pendingMember),
		await put('/messaging/status', { id: letter.id, status: 'printed' }, pendingMember),
		await put('/messaging/message', { id: letter.id, messageText: 'x' }, pendingMember),
		await get('/messaging/message?id=' + letter.id, pendingMember),
		await get('/chat/chat?id=' + letter.chat, pendingMember),
		await put('/chat/chat', { id: letter.chat, prisoner: held.id }, pendingMember)
	]) {
		assert.equal(res.status, 403);
		assert.match(res.body.info, /waiting for network approval/);
	}
	const gone = await del('/auth/user', { id: writer.id }, pendingMember);
	assert.equal(gone.status, 403);
	assert.match(gone.body.info, /waiting for network approval/);
	assert.ok(await User.findByPk(writer.id), 'nothing was deleted');
	assert.equal(
		(await put('/messaging/status', { id: letter.id, status: 'printed' }, admin)).status,
		200
	);
});
