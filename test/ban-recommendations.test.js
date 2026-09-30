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
	User,
	Chapter
} from './helpers.js';
import Notification from '../database/models/notification.model.js';
import AuditLog from '../database/models/audit-log.model.js';

// A group admin can recommend that a writer be blocked site-wide, with a reason;
// it waits in the moderation queue and a superadmin decides (30 September 2026).
let f;
let otherAdmin;
let otherGroup;
before(async () => {
	await startServer();
	f = await makeFixtures();
	otherGroup = await Chapter.createChapter({
		name: 'Second',
		location: {},
		accountStatus: 'active'
	});
	otherAdmin = await makeUser({ role: 'chapter', username: 'secondrecomm' });
	await User.update({ chapterId: otherGroup.id }, { where: { id: otherAdmin.id } });
});
after(stopServer);

const recommend = (user, reason, who = f.chapter) =>
	post('/moderation/ban-recommendation', { user, ...(reason ? { reason } : {}) }, who);

test('a group recommends, a superadmin sees it waiting, and a ban settles every recommendation for them', async () => {
	const writer = await makeUser({ username: 'banworthy' });
	const first = await recommend(writer.id, 'Threats to a volunteer, in three letters.');
	assert.equal(first.status, 201, JSON.stringify(first.body));
	assert.equal(first.body.data.status, 'pending');
	assert.equal(first.body.data.writer.id, writer.id);
	assert.equal(first.body.data.chapter_details.id, f.group.id);
	const second = await recommend(writer.id, 'The same person wrote to us.', otherAdmin);
	assert.equal(second.status, 201);

	// The superadmins are told, and it is in the queue and the summary.
	const told = await Notification.findOne({
		where: { userId: f.admin.id, event: 'ban.recommended' }
	});
	assert.deepEqual(told.detail, { recommendation: first.body.data.id, user: writer.id });
	const queue = await get('/moderation/ban-recommendations', f.admin);
	assert.deepEqual(
		queue.body.data.map((r) => r.id).sort(),
		[first.body.data.id, second.body.data.id].sort()
	);
	assert.equal((await get('/moderation/summary', f.admin)).body.data.pendingBanRecommendations, 2);

	// One ban answers both groups, and the account is stopped at once.
	const decided = await put(
		'/moderation/ban-recommendation',
		{ id: first.body.data.id, decision: 'ban', note: 'Banned. Thank you both.' },
		f.admin
	);
	assert.equal(decided.status, 200, JSON.stringify(decided.body));
	assert.equal(decided.body.data.status, 'banned');
	assert.equal((await User.findByPk(writer.id)).role, 'banned');
	assert.equal((await get('/auth/pen-name', writer)).status, 401, 'their token stopped working');
	for (const [group, admin] of [
		[f.group.id, f.chapter],
		[otherGroup.id, otherAdmin]
	]) {
		const mine = await get('/moderation/ban-recommendations', admin);
		assert.ok(
			mine.body.data.every((r) => r.chapter_details.id === group),
			'a group sees its own'
		);
		assert.equal(mine.body.data.find((r) => r.writer.id === writer.id).status, 'banned');
		const news = await Notification.findOne({
			where: { userId: admin.id, event: 'ban.decided' },
			order: [['id', 'DESC']]
		});
		assert.equal(news.detail.decision, 'banned');
	}
	assert.ok(await AuditLog.findOne({ where: { action: 'user.ban', targetId: writer.id } }));
	assert.ok(
		await AuditLog.findOne({ where: { action: 'user.ban-recommend', targetId: writer.id } })
	);

	// Decided is decided.
	const again = await put(
		'/moderation/ban-recommendation',
		{ id: second.body.data.id, decision: 'dismiss' },
		f.admin
	);
	assert.equal(again.status, 409);
	assert.equal(again.body.code, 'ban_recommendation.decided');
});

test('a dismissal settles that one only, and the group may ask again later', async () => {
	const writer = await makeUser({ username: 'notquite' });
	const made = await recommend(writer.id, 'Rude, but maybe not a ban.');
	assert.equal((await recommend(writer.id, 'Again.')).status, 409, 'one waiting per group');
	const dismissed = await put(
		'/moderation/ban-recommendation',
		{ id: made.body.data.id, decision: 'dismiss', note: 'Block them from your group instead.' },
		f.admin
	);
	assert.equal(dismissed.status, 200, JSON.stringify(dismissed.body));
	assert.equal(dismissed.body.data.status, 'dismissed');
	assert.equal(dismissed.body.data.decisionNote, 'Block them from your group instead.');
	assert.equal((await User.findByPk(writer.id)).role, 'user');
	assert.ok(
		await AuditLog.findOne({ where: { action: 'user.ban-recommend.dismiss', targetId: writer.id } })
	);
	assert.equal((await recommend(writer.id, 'It got worse.')).status, 201);
});

test('who may: a group admin recommends, a superadmin decides; nobody else', async () => {
	const writer = await makeUser({ username: 'recommendee' });
	assert.equal((await recommend(writer.id, 'x', f.alice)).status, 403, 'a writer');
	assert.equal(
		(await recommend(writer.id, 'x', f.admin)).status,
		403,
		'a superadmin bans directly'
	);
	assert.equal((await recommend(writer.id)).status, 400, 'a reason is required');
	assert.equal((await recommend(otherAdmin.id, 'x')).status, 400, 'only writers');
	const made = await recommend(writer.id, 'Spam.');
	assert.equal(
		(
			await put(
				'/moderation/ban-recommendation',
				{ id: made.body.data.id, decision: 'ban' },
				f.chapter
			)
		).status,
		403,
		'a group admin does not decide'
	);
	assert.equal(
		(
			await put(
				'/moderation/ban-recommendation',
				{ id: made.body.data.id, decision: 'maybe' },
				f.admin
			)
		).status,
		400
	);
});
