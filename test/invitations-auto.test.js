process.env.INVITATION_AUTO_ACTIVATE = 'true';
process.env.INVITATION_DAYS = '3';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, get, post, login, makeFixtures, Chapter } = await import(
	'./helpers.js'
);

let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
});
after(stopServer);

test('with INVITATION_AUTO_ACTIVATE a vouched group is active and listed at once', async () => {
	const created = await post(
		'/invitation/invitation',
		{ kind: 'group', inviteeName: 'Trusted ABC' },
		{ token: f.chapter.token }
	);
	assert.equal(created.status, 201);
	const days = (new Date(created.body.data.expiresAt) - Date.now()) / 86400000;
	assert.ok(days > 2.9 && days < 3.1, 'INVITATION_DAYS sets the lifetime');

	const info = await get('/invitation/invitation?token=' + created.body.data.token);
	assert.equal(info.body.data.activation, 'immediate');

	const res = await post('/invitation/accept', {
		token: created.body.data.token,
		username: 'trusted',
		password: 'longenough',
		email: 'trusted@example.com',
		group: { name: 'Trusted ABC', location: {} }
	});
	assert.equal(res.status, 201, JSON.stringify(res.body));
	assert.equal(res.body.data.activation, 'immediate');
	const group = await Chapter.findByPk(res.body.data.chapter.id);
	assert.equal(group.accountStatus, 'active');
	assert.equal(group.recordStatus, 'published');
	assert.equal(group.vouchedBy, f.group.id);

	const token = await login('trusted', 'longenough');
	const acts = await post(
		'/invitation/invitation',
		{ kind: 'member', inviteeName: 'First member' },
		{ token }
	);
	assert.equal(acts.status, 201, 'the new group can act straight away');
});

test("an admin's own invitation needs no second approval, even with nobody vouching", async () => {
	// Only an admin can invite without a vouching group, so an admin has already decided.
	const created = await post(
		'/invitation/invitation',
		{ kind: 'group', inviteeName: 'Founding ABC' },
		{ token: f.admin.token }
	);
	assert.equal(created.body.data.chapterId, null);
	const info = await get('/invitation/invitation?token=' + created.body.data.token);
	assert.equal(info.body.data.activation, 'immediate');
	const res = await post('/invitation/accept', {
		token: created.body.data.token,
		username: 'founding',
		password: 'longenough',
		email: 'founding@example.com',
		group: { name: 'Founding ABC', location: {} }
	});
	assert.equal(res.status, 201, JSON.stringify(res.body));
	const group = await Chapter.findByPk(res.body.data.chapter.id);
	assert.equal(group.accountStatus, 'active');
	assert.equal(group.vouchedBy, null);

	// Nobody but an admin can produce one: a group that tries to drop its vouch is refused.
	const asGroup = await post(
		'/invitation/invitation',
		{ kind: 'group', inviteeName: 'Sneaky ABC', chapter: null },
		{ token: f.chapter.token }
	);
	assert.equal(asGroup.status, 403);
});
