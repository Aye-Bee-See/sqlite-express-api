import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeFixtures, makeUser, put, User } from './helpers.js';

// The site needs at least one superadmin: nobody else can approve groups,
// moderate, or make another admin (#204).
let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
});
after(stopServer);

test('the only superadmin cannot demote or ban themselves', async () => {
	assert.equal(await User.count({ where: { role: 'admin' } }), 1);
	for (const role of ['user', 'chapter', 'banned']) {
		const res = await put('/auth/user', { id: f.admin.id, role }, f.admin);
		assert.equal(res.status, 409, role + ': ' + JSON.stringify(res.body));
		assert.equal(res.body.code, 'role_change.last_admin');
	}
	assert.equal((await User.findByPk(f.admin.id)).role, 'admin');
	// Anything else about the account can still change.
	assert.equal(
		(await put('/auth/user', { id: f.admin.id, name: 'Still here' }, f.admin)).status,
		200
	);
});

test('with a second superadmin, either may step down, but not both', async () => {
	const second = await makeUser({ role: 'admin' });
	const stepDown = await put('/auth/user', { id: second.id, role: 'user' }, f.admin);
	assert.equal(stepDown.status, 200, JSON.stringify(stepDown.body));
	assert.equal((await User.findByPk(second.id)).role, 'user');

	// Two admins demoting each other at once: the second write finds itself the
	// last admin, even though its own check ran while the other was still there.
	await User.update({ role: 'admin' }, { where: { id: second.id } });
	const count = User.count;
	User.count = async function (...args) {
		User.count = count;
		const others = await count.apply(this, args);
		// The other admin is demoted between this check and the write.
		await User.update({ role: 'user' }, { where: { id: second.id } });
		return others;
	};
	let res;
	try {
		res = await put('/auth/user', { id: f.admin.id, role: 'user' }, f.admin);
	} finally {
		User.count = count;
	}
	assert.equal(res.status, 409, JSON.stringify(res.body));
	assert.equal(res.body.code, 'role_change.last_admin');
	assert.equal((await User.findByPk(f.admin.id)).role, 'admin', 'the site still has its admin');
});
