import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	get,
	post,
	put,
	makeFixtures,
	Prison,
	Prisoner,
	Chapter
} from './helpers.js';

let f;
let admin;
let chapter;
let user;
let draftPrison;
let draftPrisoner;
let pendingChapter;
before(async () => {
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
	chapter = { token: f.chapter.token };
	user = { token: f.alice.token };
	draftPrison = await Prison.createPrison({
		prisonName: 'Draft Prison',
		address: {},
		recordStatus: 'draft'
	});
	draftPrisoner = await Prisoner.createPrisoner({
		birthName: 'Draft Person',
		prison: f.prison.id,
		recordStatus: 'draft'
	});
	pendingChapter = await Chapter.createChapter({
		name: 'Pending Chapter',
		location: {},
		recordStatus: 'pending'
	});
	await put('/prison/rule', { rule: f.rule.id, prison: f.prison.id }, admin);
	await put('/prison/rule', { rule: f.rule.id, prison: draftPrison.id }, admin);
});
after(stopServer);

test('directory lists and single records are readable without a token', async () => {
	for (const path of [
		'/prison/prisons',
		'/prison/prison?id=' + f.prison.id,
		'/prisoner/prisoners',
		'/prisoner/prisoner?id=' + f.prisoner1.id,
		'/prisoner/prisoners?prison=' + f.prison.id,
		'/rule/rules',
		'/rule/rule?id=' + f.rule.id,
		'/rule/rules?prison=' + f.prison.id,
		'/chapter/chapters'
	]) {
		const res = await get(path);
		assert.equal(res.status, 200, path);
		assert.equal(res.body.success, true, path);
	}
});

test('a bad token on a public route is rejected, not treated as anonymous', async () => {
	assert.equal((await get('/prison/prisons', { token: 'garbage' })).status, 401);
});

test('writes still need a token and the right role', async () => {
	assert.equal((await post('/prison/prison', { prisonName: 'X', address: {} })).status, 401);
	assert.equal((await put('/prison/prison', { id: f.prison.id, prisonName: 'X' })).status, 401);
	assert.equal((await post('/prison/prison', { prisonName: 'X', address: {} }, user)).status, 403);
});

test('new records default to published; staff may set draft or pending; bad values are rejected', async () => {
	const created = await post('/prison/prison', { prisonName: 'Default', address: {} }, chapter);
	assert.equal(created.status, 201);
	assert.equal(created.body.data.recordStatus, 'published');
	const draft = await post(
		'/prison/prison',
		{ prisonName: 'Explicit draft', address: {}, recordStatus: 'draft' },
		chapter
	);
	assert.equal(draft.status, 201);
	assert.equal(draft.body.data.recordStatus, 'draft');
	const bad = await post(
		'/prison/prison',
		{ prisonName: 'Bad', address: {}, recordStatus: 'hidden' },
		admin
	);
	assert.equal(bad.status, 400);
	assert.deepEqual(bad.body.errors, ['Record status must be draft, pending, or published.']);
	assert.equal(
		(await put('/prison/prison', { id: draft.body.data.id, recordStatus: 'published' }, admin))
			.status,
		200
	);
});

test('anonymous and user-role callers see only published records', async () => {
	for (const who of [{}, user]) {
		const prisons = await get('/prison/prisons?page_size=100', who);
		assert.ok(prisons.body.data.every((p) => p.recordStatus === 'published'));
		assert.ok(!prisons.body.data.some((p) => p.id === draftPrison.id));
		assert.equal((await get('/prison/prison?id=' + draftPrison.id, who)).status, 404);

		const prisoners = await get('/prisoner/prisoners?page_size=100', who);
		assert.ok(!prisoners.body.data.some((p) => p.id === draftPrisoner.id));
		assert.equal((await get('/prisoner/prisoner?id=' + draftPrisoner.id, who)).status, 404);

		const chapters = await get('/chapter/chapters?page_size=100', who);
		assert.ok(!chapters.body.data.some((c) => c.id === pendingChapter.id));
		assert.equal((await get('/chapter/chapter?id=' + pendingChapter.id, who)).status, 404);

		// A draft prison's dependents are hidden too.
		assert.equal((await get('/prisoner/prisoners?prison=' + draftPrison.id, who)).status, 404);
		assert.equal((await get('/rule/rules?prison=' + draftPrison.id, who)).status, 404);

		// The recordStatus filter is ignored for non-staff.
		const filtered = await get('/prison/prisons?recordStatus=draft&page_size=100', who);
		assert.equal(filtered.status, 200);
		assert.ok(filtered.body.data.every((p) => p.recordStatus === 'published'));
	}
});

test('embedded records are filtered for non-staff and complete for staff', async () => {
	const anon = await get('/prison/prison?id=' + f.prison.id + '&full=true');
	assert.ok(anon.body.data.prisoners.every((p) => p.recordStatus === 'published'));
	assert.ok(!anon.body.data.prisoners.some((p) => p.id === draftPrisoner.id));
	assert.equal(anon.body.data.rules.length, 1);

	const staff = await get('/prison/prison?id=' + f.prison.id + '&full=true', admin);
	assert.ok(staff.body.data.prisoners.some((p) => p.id === draftPrisoner.id));

	const ruleAnon = await get('/rule/rule?id=' + f.rule.id + '&full=true');
	assert.deepEqual(
		ruleAnon.body.data.prisons.map((p) => p.id),
		[f.prison.id]
	);
	const ruleStaff = await get('/rule/rule?id=' + f.rule.id + '&full=true', admin);
	assert.deepEqual(
		ruleStaff.body.data.prisons.map((p) => p.id).sort(),
		[f.prison.id, draftPrison.id].sort()
	);
});

test('chats are embedded in prisoner reads for admins only', async () => {
	await post(
		'/messaging/message',
		{ messageText: 'private', sender: 'user', prisoner: f.prisoner1.id, user: f.alice.id },
		user
	);
	for (const who of [{}, user]) {
		const res = await get('/prisoner/prisoners?prison=' + f.prison.id + '&full=true', who);
		assert.equal(res.status, 200);
		assert.ok(res.body.data.every((p) => p.chats === undefined));
		assert.ok(res.body.data.every((p) => p.prison_details.id === f.prison.id));
	}
	const staff = await get('/prisoner/prisoners?prison=' + f.prison.id + '&full=true', chapter);
	assert.ok(staff.body.data.every((p) => p.chats === undefined));
	const adminRead = await get('/prisoner/prisoners?prison=' + f.prison.id + '&full=true', admin);
	const one = adminRead.body.data.find((p) => p.id === f.prisoner1.id);
	assert.equal(one.chats.length, 1);
});

test('staff see every status and can filter by one', async () => {
	for (const who of [admin, chapter]) {
		const all = await get('/prison/prisons?page_size=100', who);
		assert.ok(all.body.data.some((p) => p.id === draftPrison.id));
		assert.equal((await get('/prison/prison?id=' + draftPrison.id, who)).status, 200);
		const drafts = await get('/prison/prisons?recordStatus=draft&page_size=100', who);
		assert.ok(drafts.body.data.length >= 1);
		assert.ok(drafts.body.data.every((p) => p.recordStatus === 'draft'));
		const pending = await get('/chapter/chapters?recordStatus=pending', who);
		assert.deepEqual(
			pending.body.data.map((c) => c.id),
			[pendingChapter.id]
		);
		const bad = await get('/prison/prisons?recordStatus=hidden', who);
		assert.equal(bad.status, 400);
		assert.ok(bad.body.errors[0].startsWith('recordStatus must be one of'));
	}
});

test('list responses carry total, page, and page_size', async () => {
	const res = await get('/prison/prisons?page=2&page_size=1');
	assert.equal(res.status, 200);
	assert.equal(res.body.page, 2);
	assert.equal(res.body.page_size, 1);
	assert.equal(res.body.data.length, 1);
	const publishedCount = await Prison.count({ where: { recordStatus: 'published' } });
	assert.equal(res.body.total, publishedCount);

	const staffTotal = (await get('/prison/prisons?page_size=1', admin)).body.total;
	assert.equal(staffTotal, await Prison.count());
	assert.ok(staffTotal > publishedCount);

	const defaults = await get('/chapter/chapters');
	assert.equal(defaults.body.page, 1);
	assert.equal(defaults.body.page_size, 10);
	assert.equal(typeof defaults.body.total, 'number');
});

test('totals are present on the other paginated lists too', async () => {
	const cases = [
		['/auth/users?page_size=2', admin],
		['/chat/chats?page_size=1', admin],
		['/messaging/messages?page_size=1', admin],
		['/prisoner/prisoners?prison=' + f.prison.id + '&page_size=1', {}],
		['/rule/rules?page_size=1', {}],
		['/rule/rules?prison=' + f.prison.id, {}]
	];
	for (const [path, who] of cases) {
		const res = await get(path, who);
		assert.equal(res.status, 200, path);
		assert.equal(typeof res.body.total, 'number', path);
		assert.ok(res.body.total >= res.body.data.length, path);
		assert.equal(res.body.page, 1, path);
	}
	const users = await get('/auth/users?page_size=2', admin);
	assert.equal(users.body.total, 5);
	assert.ok(!JSON.stringify(users.body).includes('$2b$'));
});

test('prisoner list rows carry a facility summary without full=true', async () => {
	const res = await get('/prisoner/prisoners?page_size=100');
	assert.equal(res.status, 200);
	const row = res.body.data.find((p) => p.id === f.prisoner1.id);
	assert.deepEqual(Object.keys(row.prison_details).sort(), [
		'country',
		'id',
		'prisonName',
		'routing'
	]);
	assert.equal(row.prison_details.prisonName, 'Test Prison');
	assert.equal(row.support_groups, undefined, 'the light shape stops at the facility');
	const full = await get('/prisoner/prisoners?full=true&page_size=100');
	const fullRow = full.body.data.find((p) => p.id === f.prisoner1.id);
	assert.ok(Array.isArray(fullRow.support_groups));
	assert.ok('address' in fullRow.prison_details, 'full keeps the complete facility');

	// A prisoner whose facility is not published: anonymous callers get null, staff get the name.
	const hidden = await Prison.createPrison({
		prisonName: 'Hidden',
		address: {},
		recordStatus: 'draft'
	});
	const held = await Prisoner.createPrisoner({ birthName: 'In Hidden', prison: hidden.id });
	const anon = (await get('/prisoner/prisoners?page_size=100')).body.data.find(
		(p) => p.id === held.id
	);
	assert.equal(anon.prison_details, null);
	const staff = (await get('/prisoner/prisoners?page_size=100', chapter)).body.data.find(
		(p) => p.id === held.id
	);
	assert.equal(staff.prison_details.prisonName, 'Hidden');
	const byPrison = await get('/prisoner/prisoners?prison=' + f.prison.id + '&page_size=100');
	assert.ok(byPrison.body.data.every((p) => p.prison_details.id === f.prison.id));
});
