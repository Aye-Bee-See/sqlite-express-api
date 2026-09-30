import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	makeFixtures,
	makeUser,
	get,
	post,
	put,
	del,
	User,
	Chapter
} from './helpers.js';
import { codeAt, stepAt } from '../services/totp.js';
import AuditLog from '../database/models/audit-log.model.js';

// A superadmin may require two-factor sign-in: for superadmins, for every
// group's admins, or for chosen groups (decided 30 September 2026). All of it
// starts off.
let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
});
after(stopServer);

/** Switch it on for an account; answers the secret. */
async function switchOn(who) {
	const { secret } = (await post('/auth/two-factor/setup', {}, who)).body.data;
	const ok = await post('/auth/two-factor/confirm', { code: codeAt(secret, stepAt()) }, who);
	assert.equal(ok.status, 200, JSON.stringify(ok.body));
	return secret;
}
const blocked = (res, what) => {
	assert.equal(res.status, 403, what + ': ' + JSON.stringify(res.body));
	assert.equal(res.body.code, 'two_factor_required.setup_required', what);
};

test('nothing is required until a superadmin says so', async () => {
	const policy = await get('/auth/two-factor/policy', f.admin);
	assert.equal(policy.status, 200, JSON.stringify(policy.body));
	assert.deepEqual(policy.body.data, { superadmins: false, allGroups: false, groups: [] });
	for (const who of [f.admin, f.chapter, f.alice]) {
		const mine = await get('/auth/two-factor', who);
		assert.deepEqual([mine.body.data.required, mine.body.data.requiredBecause], [false, []]);
	}
	assert.equal((await get('/chapter/blocks', f.chapter)).status, 200);
	// Only superadmins see or change the policy.
	assert.equal((await get('/auth/two-factor/policy', f.chapter)).status, 403);
	assert.equal((await put('/auth/two-factor/policy', { allGroups: true }, f.chapter)).status, 403);
});

test('for one group: its admins, and only they, must set it up, even in sessions they already had', async () => {
	const other = await Chapter.createChapter({
		name: 'Unrequired',
		location: {},
		accountStatus: 'active'
	});
	const otherAdmin = await makeUser({ role: 'chapter', username: 'unrequiredadm' });
	await User.update({ chapterId: other.id }, { where: { id: otherAdmin.id } });

	const on = await put('/auth/two-factor/group', { chapter: f.group.id, required: true }, f.admin);
	assert.equal(on.status, 200, JSON.stringify(on.body));
	assert.deepEqual((await get('/auth/two-factor/policy', f.admin)).body.data.groups, [
		{ id: f.group.id, name: f.group.name }
	]);
	assert.ok(
		await AuditLog.findOne({ where: { action: 'chapter.two-factor', targetId: f.group.id } })
	);

	// f.chapter signed in before this: that session now only sets it up.
	blocked(await get('/chapter/blocks', f.chapter), 'an existing session');
	const mine = await get('/auth/two-factor', f.chapter);
	assert.equal(mine.status, 200, 'where they stand still answers');
	assert.deepEqual([mine.body.data.required, mine.body.data.requiredBecause], [true, ['group']]);
	assert.equal(
		(await get('/chapter/blocks', otherAdmin)).status,
		200,
		'another group is untouched'
	);
	assert.equal((await get('/auth/pen-name', f.alice)).status, 200, 'writers are never required');

	// Signing in says so, and gives a session for setting it up.
	const signIn = await post('/auth/login', {
		username: f.chapter.user.username,
		password: f.chapter.password
	});
	assert.equal(signIn.status, 200, JSON.stringify(signIn.body));
	assert.deepEqual(signIn.body.data.twoFactor, { setupRequired: true, because: ['group'] });
	const fresh = { token: signIn.body.data.token.token };
	blocked(await get('/chapter/blocks', fresh), 'a new session');

	// Set up, and everything works again; it cannot be switched off while required.
	const secret = await switchOn(fresh);
	assert.equal((await get('/chapter/blocks', fresh)).status, 200);
	const off = await del('/auth/two-factor', { code: codeAt(secret, stepAt() + 1) }, fresh);
	assert.equal(off.status, 409, JSON.stringify(off.body));
	assert.equal(off.body.code, 'two_factor.required');

	await put('/auth/two-factor/group', { chapter: f.group.id, required: false }, f.admin);
});

test('for every group at once: all group admins; sign-out still works while setting up', async () => {
	const admin = await makeUser({ role: 'chapter', username: 'allgroupsadm' });
	await User.update({ chapterId: f.group.id }, { where: { id: admin.id } });
	assert.deepEqual((await put('/auth/two-factor/policy', { allGroups: true }, f.admin)).body.data, {
		superadmins: false,
		allGroups: true
	});
	blocked(await get('/chapter/blocks', admin), 'any group admin');
	assert.equal(
		(await get('/moderation/summary', f.admin)).status,
		200,
		'superadmins are not groups'
	);
	assert.equal((await post('/auth/logout', {}, admin)).status, 200, 'signing out works');
	await put('/auth/two-factor/policy', { allGroups: false }, f.admin);
});

test('for superadmins: the one who requires it has it on first', async () => {
	const refused = await put('/auth/two-factor/policy', { superadmins: true }, f.admin);
	assert.equal(refused.status, 409, JSON.stringify(refused.body));
	assert.equal(refused.body.code, 'two_factor.own_first');
	await switchOn(f.admin);
	const on = await put('/auth/two-factor/policy', { superadmins: true }, f.admin);
	assert.equal(on.status, 200, JSON.stringify(on.body));
	assert.ok(await AuditLog.findOne({ where: { action: 'site.two-factor-policy' } }));
	assert.equal((await get('/moderation/summary', f.admin)).status, 200, 'it is on for them');

	const second = await makeUser({ role: 'admin', username: 'secondsuper' });
	blocked(await get('/moderation/summary', second), 'another superadmin');
	assert.equal((await get('/chapter/blocks', f.chapter)).status, 200, 'groups are not superadmins');
	await put('/auth/two-factor/policy', { superadmins: false }, f.admin);
	assert.equal((await get('/moderation/summary', second)).status, 200, 'and off again');
});

test('a superadmin resets it for a lost phone; nobody else can', async () => {
	const lost = await makeUser({ username: 'lostphone' });
	await switchOn(lost);
	assert.equal((await del('/auth/two-factor/user', { user: lost.id }, f.chapter)).status, 403);
	const reset = await del('/auth/two-factor/user', { user: lost.id }, f.admin);
	assert.equal(reset.status, 200, JSON.stringify(reset.body));
	assert.equal((await get('/auth/two-factor', lost)).body.data.enabled, false);
	assert.ok(
		await AuditLog.findOne({ where: { action: 'user.two-factor.reset', targetId: lost.id } })
	);
	const signIn = await post('/auth/login', { username: 'lostphone', password: lost.password });
	assert.ok(signIn.body.data.token, 'one step again');
	assert.equal((await del('/auth/two-factor/user', { user: lost.id }, f.admin)).status, 409);
});
