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
	login,
	User,
	Chapter
} from './helpers.js';
import { Op } from 'sequelize';
import InviteCode, { normalizeCode, hashCode } from '../database/models/invite-code.model.js';
import AuditLog from '../database/models/audit-log.model.js';

let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
});
after(stopServer);

const issue = (body, who = f.chapter) => post('/auth/invite-codes', body, who);
const joinWith = (code, extra = {}) =>
	post('/auth/join', {
		code,
		username: 'n' + Math.random().toString(36).slice(2, 8),
		password: 'a long enough password',
		...extra
	});

test('a group admin issues a batch of codes, shown once, and the list shows counts only', async () => {
	const res = await issue({ count: 5, label: 'Letter night, 2 October' });
	assert.equal(res.status, 201, JSON.stringify(res.body));
	const { batch, codes, expiresAt, outstanding, limit, label } = res.body.data;
	assert.equal(codes.length, 5);
	for (const code of codes) {
		assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
	}
	assert.equal(new Set(codes).size, 5);
	assert.deepEqual([outstanding, limit, label], [5, 20, 'Letter night, 2 October']);
	const days = (new Date(expiresAt) - Date.now()) / 86400000;
	assert.ok(days > 29.9 && days < 30.1, 'a month: ' + days);
	// Stored only as hashes; the slip is the only copy.
	const stored = JSON.stringify(await InviteCode.findAll());
	assert.ok(codes.every((code) => !stored.includes(code) && !stored.includes(normalizeCode(code))));

	const list = await get('/auth/invite-codes', f.chapter);
	assert.equal(list.status, 200);
	assert.deepEqual(
		{ ...list.body.data.batches.find((b) => b.batch === batch), createdAt: 0, expiresAt: 0 },
		{
			batch,
			label: 'Letter night, 2 October',
			createdAt: 0,
			expiresAt: 0,
			total: 5,
			used: 0,
			cancelled: 0,
			expired: 0,
			unused: 5
		}
	);
	assert.ok(!JSON.stringify(list.body).includes(codes[0]));
	// A writer, and a group admin of another chapter, see nothing.
	assert.equal((await get('/auth/invite-codes', f.alice)).status, 403);
	assert.equal((await issue({ count: 1 }, f.alice)).status, 403);
});

test('the batch is judged before anything is written', async () => {
	for (const body of [
		{},
		{ count: 0 },
		{ count: 51 },
		{ count: 2.5 },
		{ count: 'lots' },
		{ count: 1, days: 0 },
		{ count: 1, days: 31 },
		{ count: 1, label: 'x'.repeat(81) }
	]) {
		const res = await issue(body);
		assert.equal(res.status, 400, JSON.stringify(body));
	}
	const shorter = await issue({ count: 1, days: 3 });
	assert.equal(shorter.status, 201);
	const days = (new Date(shorter.body.data.expiresAt) - Date.now()) / 86400000;
	assert.ok(days > 2.9 && days < 3.1);
});

test('a newcomer joins with a code, the account is theirs, and the chapter learns only that a code was used', async () => {
	const { codes } = (await issue({ count: 2, label: 'Door' })).body.data;
	const info = await get('/auth/join?code=' + codes[0]);
	assert.equal(info.status, 200, JSON.stringify(info.body));
	assert.deepEqual(info.body.data.chapter, { id: f.group.id, name: 'Fixture Group' });

	// Typed from a slip: lower case, no dashes, and an O for a 0 are all the same code.
	const typed = codes[0].toLowerCase().replace(/-/g, '').replace(/0/g, 'o');
	const joined = await post('/auth/join', {
		code: typed,
		username: 'newcomer',
		password: 'a long enough password',
		name: 'Sam'
	});
	assert.equal(joined.status, 201, JSON.stringify(joined.body));
	const user = joined.body.data.user;
	assert.deepEqual(
		[
			user.username,
			user.name,
			user.role,
			user.sponsoredBy,
			user.managedBy ?? null,
			user.claimedAt ?? null
		],
		['newcomer', 'Sam', 'user', f.group.id, null, null]
	);
	assert.equal(user.password, undefined);
	assert.match(user.email, /@managed\.example$/, 'no email given: a placeholder');
	assert.equal(joined.body.data.chapter.name, 'Fixture Group');
	// Signed in at once, as themselves; nothing for the chapter to hand over.
	await login('newcomer', 'a long enough password');

	// The code is spent, and the chapter sees a count, not a name.
	assert.equal((await get('/auth/join?code=' + codes[0])).status, 410);
	assert.equal((await joinWith(codes[0])).status, 410);
	const list = (await get('/auth/invite-codes', f.chapter)).body.data;
	const door = list.batches.find((b) => b.label === 'Door');
	assert.deepEqual([door.used, door.unused], [1, 1]);
	assert.ok(!JSON.stringify(list).includes('newcomer'));
	const row = await InviteCode.findOne({ where: { batch: door.batch, usedAt: { [Op.ne]: null } } });
	assert.ok(row.usedAt);
	assert.ok(!Object.keys(row.toJSON()).some((k) => /user|account/i.test(k) && k !== 'createdBy'));
	const entry = await AuditLog.findOne({
		where: { action: 'invite-code.join' },
		order: [['id', 'DESC']]
	});
	assert.equal(entry.actor, null);
	assert.deepEqual(entry.details, { batch: door.batch });
	// The sponsor is recorded for good and cannot be changed by the person.
	await put(
		'/auth/user',
		{ id: user.id, sponsoredBy: null, email: 'sam@example.com' },
		{
			token: (
				await post('/auth/login', { username: 'newcomer', password: 'a long enough password' })
			).body.data.token.token
		}
	);
	assert.equal((await User.findByPk(user.id)).sponsoredBy, f.group.id);
});

test('unknown, cancelled, expired, and a code from a chapter that is not active are refused, by name', async () => {
	assert.equal((await get('/auth/join?code=NOPE-NOPE-NOPE')).status, 404);
	assert.equal((await get('/auth/join?code=short')).status, 404);
	assert.equal((await get('/auth/join')).status, 404);
	const { codes, batch } = (await issue({ count: 3, label: 'Fates' })).body.data;
	await InviteCode.update(
		{ expiresAt: new Date(Date.now() - 1000) },
		{ where: { tokenHash: hashCode(codes[0]) } }
	);
	const expired = await get('/auth/join?code=' + codes[0]);
	assert.equal(expired.status, 410);
	assert.equal(expired.body.info, 'Invite code expired.');
	const cancelled = await del('/auth/invite-codes', { batch }, f.chapter);
	assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
	assert.equal(cancelled.body.data.cancelled, 2, 'the expired one was not live to cancel');
	assert.equal((await get('/auth/join?code=' + codes[1])).body.info, 'Invite code cancelled.');
	assert.equal((await joinWith(codes[1])).status, 410);
	const fates = (await get('/auth/invite-codes', f.chapter)).body.data.batches.find(
		(b) => b.batch === batch
	);
	assert.deepEqual([fates.expired, fates.cancelled, fates.unused], [1, 2, 0]);

	const {
		codes: [fresh]
	} = (await issue({ count: 1 })).body.data;
	await Chapter.update({ accountStatus: 'suspended' }, { where: { id: f.group.id } });
	const inactive = await get('/auth/join?code=' + fresh);
	assert.equal(inactive.status, 410);
	assert.equal(inactive.body.info, 'The chapter that issued this invite code is not active.');
	const joinInactive = await joinWith(fresh);
	assert.equal(joinInactive.status, 410);
	assert.equal(joinInactive.body.info, 'The chapter that issued this invite code is not active.');
	await Chapter.update({ accountStatus: 'active' }, { where: { id: f.group.id } });
	assert.equal((await get('/auth/join?code=' + fresh)).status, 200);
});

test('a join that fails leaves the code usable; two joins with one code make one account', async () => {
	const { codes } = (await issue({ count: 2 })).body.data;
	const taken = await joinWith(codes[0], { username: 'alice' });
	assert.equal(taken.status, 400, JSON.stringify(taken.body));
	const reserved = await joinWith(codes[0], { username: 'anon-9' });
	assert.equal(reserved.status, 400);
	const short = await joinWith(codes[0], { password: 'short' });
	assert.equal(short.status, 400);
	assert.equal((await get('/auth/join?code=' + codes[0])).status, 200, 'still usable');

	const results = await Promise.all([
		joinWith(codes[1], { username: 'racer-a' }),
		joinWith(codes[1], { username: 'racer-b' })
	]);
	assert.deepEqual(
		results.map((r) => r.status).sort(),
		[201, 410],
		JSON.stringify(results.map((r) => r.body))
	);
	assert.equal(await User.count({ where: { username: ['racer-a', 'racer-b'] } }), 1);
});

test('the quota: unused codes count until they expire or are cancelled; used ones free their slot at once', async () => {
	await del('/auth/invite-codes', { all: true }, f.chapter);
	const state = (await get('/auth/invite-codes', f.chapter)).body.data;
	assert.equal(state.outstanding, 0);
	const twenty = await issue({ count: 20, label: 'Big night' });
	assert.equal(twenty.status, 201, JSON.stringify(twenty.body));
	const over = await issue({ count: 1 });
	assert.equal(over.status, 409, JSON.stringify(over.body));
	assert.equal(over.body.name, 'InviteQuotaError');
	assert.match(over.body.error, /20 unused/);
	// One used: one slot back.
	assert.equal((await joinWith(twenty.body.data.codes[0])).status, 201);
	assert.equal((await issue({ count: 1 })).status, 201);
	assert.equal((await issue({ count: 1 })).status, 409);
	// Cancel the big batch: room again.
	const cancelled = await del('/auth/invite-codes', { batch: twenty.body.data.batch }, f.chapter);
	assert.equal(cancelled.body.data.cancelled, 19);
	assert.equal((await issue({ count: 19 })).status, 201);
	assert.equal((await issue({ count: 1 })).status, 409);
	// Two group admins printing at once cannot both squeeze under the limit.
	await del('/auth/invite-codes', { all: true }, f.chapter);
	const other = await makeUser({ role: 'chapter', username: 'coadmin' });
	await User.update({ chapterId: f.group.id }, { where: { id: other.id } });
	const race = await Promise.all([issue({ count: 15 }), issue({ count: 15 }, other)]);
	assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
	assert.equal(await InviteCode.outstanding(f.group.id), 15);
});

test('a superadmin issues and lists for any chapter, naming it', async () => {
	assert.equal((await issue({ count: 1 }, f.admin)).status, 404, 'no chapter named');
	const res = await issue({ count: 1, chapter: f.group.id }, f.admin);
	assert.equal(res.status, 201, JSON.stringify(res.body));
	assert.equal((await get('/auth/invite-codes?chapter=' + f.group.id, f.admin)).status, 200);
	// A group admin cannot name another chapter.
	const other = await Chapter.createChapter({
		name: 'Elsewhere',
		location: {},
		accountStatus: 'active'
	});
	assert.equal((await issue({ count: 1, chapter: other.id })).status, 403);
});

test('a group admin of a chapter that is not active issues nothing', async () => {
	await Chapter.update({ accountStatus: 'pending' }, { where: { id: f.group.id } });
	assert.equal((await issue({ count: 1 })).status, 403);
	await Chapter.update({ accountStatus: 'active' }, { where: { id: f.group.id } });
});

test('a join in end-to-end mode carries the keys made on the device, under the split scheme', async () => {
	const e2e = await import('./e2e-client.js');
	await e2e.ready;
	const { codes } = (await issue({ count: 1 })).body.data;
	const { authKey, fields, privateKey } = e2e.splitKeys('a long enough password', 'RECOVERY-CODE');
	const joined = await post('/auth/join', {
		code: codes[0],
		username: 'e2ejoiner',
		password: authKey,
		...fields
	});
	assert.equal(joined.status, 201, JSON.stringify(joined.body));
	const user = joined.body.data.user;
	assert.equal(user.authScheme, 'split');
	assert.equal(user.wrappedPrivateKey, undefined, 'no key material in the answer');
	assert.equal(user.publicKey, fields.publicKey);
	const params = await get('/auth/login-params?username=e2ejoiner');
	assert.deepEqual([params.body.data.scheme, params.body.data.kdfSalt], ['split', fields.kdfSalt]);
	const token = await login('e2ejoiner', authKey);
	const bundle = await get('/auth/keys', { token });
	assert.equal(bundle.status, 200);
	assert.equal(bundle.body.data.wrappedPrivateKey, fields.wrappedPrivateKey);
	// The person, and nobody else, can open it.
	assert.equal(privateKey.length > 0, true);
	// Without keys, a split join is refused before the code is spent.
	const {
		codes: [again]
	} = (await issue({ count: 1 })).body.data;
	const bare = await post('/auth/join', {
		code: again,
		username: 'bare',
		password: authKey,
		authScheme: 'split'
	});
	assert.equal(bare.status, 400, JSON.stringify(bare.body));
	assert.equal((await get('/auth/join?code=' + again)).status, 200, 'still usable');
});
