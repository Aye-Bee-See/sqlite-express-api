import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	get,
	post,
	put,
	del,
	login,
	makeFixtures,
	makeUser,
	User,
	Chapter
} from './helpers.js';
import Invitation from '../database/models/invitation.model.js';
import AuditLog from '../database/models/audit-log.model.js';

let f;
let admin;
let member; // member of the active fixture group
let alice;
let outsider; // member of another active group
let otherGroup;

const account = (username, extra = {}) => ({
	username,
	password: 'longenough',
	email: username + '@example.com',
	...extra
});

async function invite(body, who = member) {
	const res = await post('/invitation/invitation', body, who);
	assert.equal(res.status, 201, JSON.stringify(res.body));
	return res.body.data;
}

before(async () => {
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
	member = { token: f.chapter.token };
	alice = { token: f.alice.token };
	otherGroup = await Chapter.createChapter({
		name: 'Other Group',
		location: {},
		accountStatus: 'active'
	});
	const made = await makeUser({ role: 'chapter', username: 'outsider' });
	await User.update({ chapterId: otherGroup.id }, { where: { id: made.id } });
	outsider = { token: made.token };
});
after(stopServer);

test('a member of an active group invites a new group; the token is shown once', async () => {
	const created = await invite({
		kind: 'group',
		inviteeName: 'Riverside ABC',
		inviteeEmail: 'riverside@example.com',
		note: 'Met at the bookfair; two of us know them'
	});
	assert.match(created.token, /^[0-9A-HJKMNP-TV-Z]{24}$/, 'readable token');
	assert.equal(created.kind, 'group');
	assert.equal(created.chapterId, f.group.id, 'the inviting group is the one that vouches');
	assert.equal(created.state, 'pending');
	assert.equal(created.tokenHash, undefined, 'the hash never leaves the server');
	const days = (new Date(created.expiresAt) - Date.now()) / 86400000;
	assert.ok(days > 13.9 && days < 14.1, 'fourteen days by default');

	const listed = await get('/invitation/invitations', member);
	assert.equal(listed.status, 200);
	assert.equal(listed.body.total, 1);
	assert.equal(listed.body.data[0].token, undefined, 'never shown again');
	assert.equal(listed.body.data[0].tokenHash, undefined);
	assert.equal(listed.body.data[0].note, 'Met at the bookfair; two of us know them');

	const stored = await Invitation.scope('withHash').findByPk(created.id);
	assert.notEqual(stored.tokenHash, created.token);
	assert.ok(await AuditLog.findOne({ where: { action: 'invitation.create' } }));
});

test('who may invite, and for whom', async () => {
	const body = { kind: 'group', inviteeName: 'X' };
	assert.equal((await post('/invitation/invitation', body)).status, 401);
	assert.equal((await post('/invitation/invitation', body, alice)).status, 403, 'writers cannot');
	assert.equal(
		(await post('/invitation/invitation', { ...body, chapter: otherGroup.id }, member)).status,
		403,
		'a group invites on its own behalf only'
	);

	const pending = await Chapter.createChapter({ name: 'Not Yet', location: {} });
	const waiting = await makeUser({ role: 'chapter', username: 'waiting' });
	await User.update({ chapterId: pending.id }, { where: { id: waiting.id } });
	assert.equal(
		(await post('/invitation/invitation', body, { token: waiting.token })).status,
		403,
		'a group that is not active cannot vouch'
	);
	assert.equal(
		(await post('/invitation/invitation', { ...body, chapter: pending.id }, admin)).status,
		409,
		'nor can an admin make it vouch'
	);

	assert.equal(
		(await post('/invitation/invitation', { kind: 'friend', inviteeName: 'X' }, member)).status,
		400
	);
	assert.equal((await post('/invitation/invitation', { kind: 'group' }, member)).status, 400);
	assert.equal(
		(await post('/invitation/invitation', { ...body, inviteeEmail: 'not-an-email' }, member))
			.status,
		400
	);
	assert.equal(
		(await post('/invitation/invitation', { kind: 'member', inviteeName: 'X' }, admin)).status,
		400,
		'an admin names the group a member joins'
	);
	const byAdmin = await invite({ kind: 'group', inviteeName: 'Founding Group' }, admin);
	assert.equal(byAdmin.chapterId, null, 'an admin may invite with nobody vouching');
});

test('the token shows its holder what it is for, and nothing private', async () => {
	const created = await invite({
		kind: 'group',
		inviteeName: 'Hillside ABC',
		inviteeEmail: 'hill@example.com',
		note: 'private note'
	});
	const res = await get('/invitation/invitation?token=' + created.token);
	assert.equal(res.status, 200);
	assert.deepEqual(res.body.data.chapter, { id: f.group.id, name: 'Fixture Group' });
	assert.equal(res.body.data.kind, 'group');
	assert.equal(res.body.data.inviteeName, 'Hillside ABC');
	assert.equal(res.body.data.activation, 'admin_review');
	assert.ok(res.body.data.groupFields.includes('name'));
	assert.ok(!res.body.data.groupFields.includes('accountStatus'));
	assert.equal(JSON.stringify(res.body).includes('private note'), false);
	assert.equal(JSON.stringify(res.body).includes('hill@example.com'), false);

	// Lower case and padded, as someone typing it in would.
	const typed = await get('/invitation/invitation?token=%20' + created.token.toLowerCase());
	assert.equal(typed.status, 200);
	assert.equal((await get('/invitation/invitation?token=NOPE')).status, 404);
	assert.equal((await get('/invitation/invitation')).status, 404);
});

test('accepting a group invitation creates the group, vouched for, and its first account', async () => {
	const created = await invite({ kind: 'group', inviteeName: 'Lakeside ABC' });
	const res = await post('/invitation/accept', {
		token: created.token,
		...account('lakeside'),
		name: 'Sam',
		group: {
			name: 'Lakeside ABC',
			location: { city: 'Lakeside' },
			country: 'Canada',
			about: 'Letter nights every month',
			services: ['letter_writing_nights'],
			networkRole: 'collecting'
		}
	});
	assert.equal(res.status, 201, JSON.stringify(res.body));
	assert.equal(res.body.data.user.role, 'chapter');
	assert.equal(res.body.data.user.password, undefined);
	assert.equal(res.body.data.activation, 'admin_review');
	assert.equal(res.body.data.chapter.accountStatus, 'pending');

	const group = await Chapter.findByPk(res.body.data.chapter.id);
	assert.equal(group.vouchedBy, f.group.id);
	assert.equal(group.recordStatus, 'pending', 'not in the public directory until approved');
	assert.equal(group.country, 'Canada');
	assert.equal(res.body.data.user.chapterId, group.id);

	const row = await Invitation.findByPk(created.id);
	assert.equal(row.status, 'accepted');
	assert.equal(row.acceptedUser, res.body.data.user.id);
	assert.equal(row.createdChapter, group.id);

	// They can sign in, but a pending group cannot act, and is not listed.
	const token = await login('lakeside', 'longenough');
	const tryInvite = await post(
		'/invitation/invitation',
		{ kind: 'member', inviteeName: 'Friend' },
		{ token }
	);
	assert.equal(tryInvite.status, 403);
	const publicList = await get('/chapter/chapters?page_size=100');
	assert.ok(!publicList.body.data.some((c) => c.id === group.id));
	const summary = await get('/moderation/summary', admin);
	assert.ok(summary.body.data.groups.pendingApproval >= 1, 'admins see it waiting');

	// An admin approves with the ordinary group update.
	const approved = await put(
		'/chapter/chapter',
		{ id: group.id, accountStatus: 'active', recordStatus: 'published' },
		admin
	);
	assert.equal(approved.status, 200, JSON.stringify(approved.body));
	const nowActs = await post(
		'/invitation/invitation',
		{ kind: 'member', inviteeName: 'Friend' },
		{ token }
	);
	assert.equal(nowActs.status, 201);

	// Used once.
	const again = await post('/invitation/accept', {
		token: created.token,
		...account('lakeside2'),
		group: { name: 'Again', location: {} }
	});
	assert.equal(again.status, 410);
	assert.equal((await get('/invitation/invitation?token=' + created.token)).status, 410);
});

test('a member invitation adds an account to the inviting group, active at once', async () => {
	const created = await invite({ kind: 'member', inviteeName: 'Jo' });
	const info = await get('/invitation/invitation?token=' + created.token);
	assert.equal(info.body.data.activation, 'immediate');
	assert.equal(info.body.data.groupFields, undefined);

	const withGroup = await post('/invitation/accept', {
		token: created.token,
		...account('jojo'),
		group: { name: 'Sneaky', location: {} }
	});
	assert.equal(withGroup.status, 400, 'a member invitation cannot found a group');

	const res = await post('/invitation/accept', { token: created.token, ...account('jojo') });
	assert.equal(res.status, 201, JSON.stringify(res.body));
	assert.equal(res.body.data.user.chapterId, f.group.id);
	assert.equal(res.body.data.user.role, 'chapter');
	assert.equal(res.body.data.activation, 'immediate');
	const token = await login('jojo', 'longenough');
	assert.equal((await get('/invitation/invitations', { token })).status, 200, 'acts for the group');
});

test('a failed acceptance leaves nothing behind and the invitation usable', async () => {
	const created = await invite({ kind: 'group', inviteeName: 'Careful ABC' });
	const groups = await Chapter.count();
	const users = await User.count();
	const group = { name: 'Careful ABC', location: {} };

	const cases = [
		[{ ...account('careful'), password: 'short', group }, 'a weak password'],
		[{ ...account('careful'), email: 'nope', group }, 'a bad email'],
		[{ ...account('alice'), group }, 'a username that is taken'],
		[{ ...account('careful') }, 'no group at all'],
		[{ ...account('careful'), group: { location: {} } }, 'a group without a name'],
		[
			{ ...account('careful'), group: { ...group, accountStatus: 'active' } },
			'a self-approved group'
		],
		[{ ...account('careful'), group: { ...group, vouchedBy: otherGroup.id } }, 'a chosen voucher'],
		[
			{ ...account('careful'), group: { ...group, services: ['teleportation'] } },
			'an unknown service'
		]
	];
	for (const [body, what] of cases) {
		const res = await post('/invitation/accept', { token: created.token, ...body });
		assert.equal(res.status, 400, what + ': ' + JSON.stringify(res.body));
	}
	assert.equal(await Chapter.count(), groups, 'no group was left behind');
	assert.equal(await User.count(), users, 'no account was left behind');
	assert.equal((await Invitation.findByPk(created.id)).status, 'pending');

	const ok = await post('/invitation/accept', {
		token: created.token,
		...account('careful'),
		group
	});
	assert.equal(ok.status, 201, JSON.stringify(ok.body));
});

test('two acceptances of one invitation: one account', async () => {
	const created = await invite({ kind: 'member', inviteeName: 'Twin' });
	const results = await Promise.all([
		post('/invitation/accept', { token: created.token, ...account('twin1') }),
		post('/invitation/accept', { token: created.token, ...account('twin2') })
	]);
	assert.deepEqual(results.map((r) => r.status).sort(), [201, 410]);
	assert.equal(await User.count({ where: { username: ['twin1', 'twin2'] } }), 1);
});

test('invitations expire, can be renewed, and can be withdrawn', async () => {
	const created = await invite({ kind: 'member', inviteeName: 'Late' });
	await Invitation.update(
		{ expiresAt: new Date(Date.now() - 1000) },
		{ where: { id: created.id } }
	);
	assert.equal((await get('/invitation/invitation?token=' + created.token)).status, 410);
	assert.equal(
		(await post('/invitation/accept', { token: created.token, ...account('late') })).status,
		410
	);
	const listed = await get('/invitation/invitations?kind=member&status=pending', member);
	assert.equal(listed.body.data.find((i) => i.id === created.id).state, 'expired');

	const renewed = await put('/invitation/invitation', { id: created.id }, member);
	assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
	assert.notEqual(renewed.body.data.token, created.token);
	assert.equal(renewed.body.data.state, 'pending');
	assert.equal(
		(await get('/invitation/invitation?token=' + created.token)).status,
		404,
		'old token'
	);
	assert.equal((await get('/invitation/invitation?token=' + renewed.body.data.token)).status, 200);

	const withdrawn = await del('/invitation/invitation', { id: created.id }, member);
	assert.equal(withdrawn.status, 200);
	assert.equal(withdrawn.body.data.state, 'revoked');
	assert.equal((await get('/invitation/invitation?token=' + renewed.body.data.token)).status, 410);
	assert.equal((await put('/invitation/invitation', { id: created.id }, member)).status, 409);
	assert.equal((await del('/invitation/invitation', { id: created.id }, member)).status, 409);
	assert.equal((await del('/invitation/invitation', { id: 999999 }, member)).status, 404);
});

test("a group manages its own invitations only; admins see everyone's", async () => {
	const created = await invite({ kind: 'member', inviteeName: 'Ours' });
	assert.equal((await put('/invitation/invitation', { id: created.id }, outsider)).status, 403);
	assert.equal((await del('/invitation/invitation', { id: created.id }, outsider)).status, 403);
	const theirs = await get('/invitation/invitations?page_size=100', outsider);
	assert.ok(!theirs.body.data.some((i) => i.id === created.id));
	assert.equal((await get('/invitation/invitations', alice)).status, 403);

	const all = await get('/invitation/invitations?page_size=100', admin);
	assert.ok(all.body.data.some((i) => i.id === created.id));
	const filtered = await get('/invitation/invitations?chapter=' + otherGroup.id, admin);
	assert.ok(filtered.body.data.every((i) => i.chapterId === otherGroup.id));
	assert.equal((await get('/invitation/invitations?status=lost', admin)).status, 400);
	assert.equal((await del('/invitation/invitation', { id: created.id }, admin)).status, 200);
});

test('an invitation is only as good as the group behind it', async () => {
	const created = await invite({ kind: 'group', inviteeName: 'Orphaned ABC' }, outsider);
	await Chapter.update({ accountStatus: 'suspended' }, { where: { id: otherGroup.id } });
	assert.equal((await get('/invitation/invitation?token=' + created.token)).status, 410);
	const res = await post('/invitation/accept', {
		token: created.token,
		...account('orphaned'),
		group: { name: 'Orphaned ABC', location: {} }
	});
	assert.equal(res.status, 410);
	assert.equal(await User.count({ where: { username: 'orphaned' } }), 0);
	await Chapter.update({ accountStatus: 'active' }, { where: { id: otherGroup.id } });
	assert.equal((await get('/invitation/invitation?token=' + created.token)).status, 200);
});

test('an invitee may set up their encryption keys in the same step', async () => {
	const client = await import('./e2e-client.js');
	await client.ready;
	const { fields } = client.accountKeys('longenough', 'RECOVERY-CODE');
	const created = await invite({ kind: 'member', inviteeName: 'Keyed' });
	const res = await post('/invitation/accept', {
		token: created.token,
		...account('keyed'),
		...fields
	});
	assert.equal(res.status, 201, JSON.stringify(res.body));
	assert.equal(res.body.data.user.publicKey, fields.publicKey);
	assert.equal(
		res.body.data.user.wrappedPrivateKey,
		undefined,
		'wrapped keys stay out of user records'
	);
	const bundle = await get('/auth/keys', { token: await login('keyed', 'longenough') });
	assert.equal(bundle.body.data.wrappedPrivateKey, fields.wrappedPrivateKey);

	const halfKeys = await invite({ kind: 'member', inviteeName: 'Half' });
	const bad = await post('/invitation/accept', {
		token: halfKeys.token,
		...account('halfkeys'),
		publicKey: fields.publicKey,
		wrappedPrivateKey: 'x'
	});
	assert.equal(bad.status, 400, 'the same key rules as registration');
});
