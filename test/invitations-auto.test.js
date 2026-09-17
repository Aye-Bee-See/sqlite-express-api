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
