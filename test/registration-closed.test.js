process.env.OPEN_REGISTRATION = 'false';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, post, makeFixtures, User } = await import('./helpers.js');

let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
});
after(stopServer);

test('with registration closed (the default), the front door is an invite code', async () => {
	const walkIn = await post('/auth/user', {
		username: 'stranger',
		email: 's@example.com',
		password: 'a long enough password'
	});
	assert.equal(walkIn.status, 403, JSON.stringify(walkIn.body));
	assert.match(walkIn.body.info, /invite code/);
	assert.equal(await User.count({ where: { username: 'stranger' } }), 0);
	// A superadmin still creates accounts; a chapter's code still opens the door.
	const byAdmin = await post(
		'/auth/user',
		{ username: 'made', email: 'm@example.com', password: 'a long enough password' },
		f.admin
	);
	assert.equal(byAdmin.status, 201, JSON.stringify(byAdmin.body));
	const { codes } = (await post('/auth/invite-codes', { count: 1 }, f.chapter)).body.data;
	const joined = await post('/auth/join', {
		code: codes[0],
		username: 'invited',
		password: 'a long enough password'
	});
	assert.equal(joined.status, 201, JSON.stringify(joined.body));
});
