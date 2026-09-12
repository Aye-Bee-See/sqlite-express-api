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
	Prisoner,
	Prison,
	Chapter
} from './helpers.js';

let f;
let admin;
let chapter;
let alice;
let bob;

before(async () => {
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
	chapter = { token: f.chapter.token };
	alice = { token: f.alice.token };
	bob = { token: f.bob.token };
});
after(stopServer);

const propose = (body, who = alice) => post('/moderation/submission', body, who);

// ---- filing ---------------------------------------------------------------

test('any signed-in account can propose a change to an existing record', async () => {
	const res = await propose({
		resource: 'prisoner',
		target: f.prisoner1.id,
		fields: { chosenName: 'One Renamed', interests: ['chess'] },
		evidence: 'Letter from their lawyer, 2026-09-01',
		note: 'Name changed legally.'
	});
	assert.equal(res.status, 201);
	const s = res.body.data;
	assert.equal(s.kind, 'update');
	assert.equal(s.resource, 'prisoner');
	assert.equal(s.targetId, f.prisoner1.id);
	assert.equal(s.status, 'pending');
	assert.deepEqual(s.payload, { chosenName: 'One Renamed', interests: ['chess'] });
	assert.equal(s.submitter.id, f.alice.id);
	assert.equal(s.submitter.password, undefined);
	assert.equal(s.reviewer, null);
	assert.equal(res.body.info, 'Thanks. Your proposal is waiting for review.');
});

test('proposals are validated: resource, fields, reviewer-only fields, target', async () => {
	const bad = await propose({ resource: 'rule', fields: { title: 'x' } });
	assert.equal(bad.status, 400);
	assert.match(bad.body.errors[0], /resource must be one of/);
	const empty = await propose({ resource: 'prison', target: f.prison.id, fields: {} });
	assert.equal(empty.status, 400);
	const notObject = await propose({ resource: 'prison', target: f.prison.id, fields: 'x' });
	assert.equal(notObject.status, 400);
	const internal = await propose({
		resource: 'prisoner',
		target: f.prisoner1.id,
		fields: { verificationNotes: 'trust me', recordStatus: 'published' }
	});
	assert.equal(internal.status, 400);
	assert.match(internal.body.errors[0], /cannot be proposed.*verificationNotes/);
	const missing = await propose({ resource: 'prisoner', target: 999999, fields: { bio: 'x' } });
	assert.equal(missing.status, 404);
	assert.equal(
		(await post('/moderation/submission', { resource: 'prison', fields: { prisonName: 'x' } }))
			.status,
		401
	);
});

test('a proposal without a target is a new record', async () => {
	const res = await propose(
		{
			resource: 'prison',
			fields: {
				prisonName: 'Proposed Facility',
				address: { city: 'Somewhere' },
				country: 'Canada'
			},
			evidence: 'https://example.org/facility'
		},
		bob
	);
	assert.equal(res.status, 201);
	assert.equal(res.body.data.kind, 'create');
	assert.equal(res.body.data.targetId, null);
});

// ---- listing and reading --------------------------------------------------

test('admins see the pending queue; submitters see their own proposals', async () => {
	const queue = await get('/moderation/submissions', admin);
	assert.equal(queue.status, 200);
	assert.ok(queue.body.data.length >= 2);
	assert.ok(queue.body.data.every((s) => s.status === 'pending'));
	assert.equal(typeof queue.body.total, 'number');
	const prisons = await get('/moderation/submissions?resource=prison', admin);
	assert.ok(prisons.body.data.every((s) => s.resource === 'prison'));
	assert.equal((await get('/moderation/submissions?resource=rule', admin)).status, 400);
	assert.equal((await get('/moderation/submissions?status=lost', admin)).status, 400);
	const byBob = await get('/moderation/submissions?submittedBy=' + f.bob.id, admin);
	assert.ok(byBob.body.data.every((s) => s.submittedBy === f.bob.id));

	const mine = await get('/moderation/submissions', alice);
	assert.ok(mine.body.data.length >= 1);
	assert.ok(mine.body.data.every((s) => s.submittedBy === f.alice.id));
	const bobsView = await get('/moderation/submissions?submittedBy=' + f.alice.id, bob);
	assert.ok(
		bobsView.body.data.every((s) => s.submittedBy === f.bob.id),
		'cannot widen to others'
	);
});

test('reading one proposal shows the current values it would change', async () => {
	const id = (await get('/moderation/submissions?resource=prisoner', admin)).body.data[0].id;
	const res = await get('/moderation/submission?id=' + id, admin);
	assert.equal(res.status, 200);
	assert.equal(res.body.data.current.chosenName, 'One');
	assert.ok('interests' in res.body.data.current);
	assert.equal((await get('/moderation/submission?id=' + id, alice)).status, 200);
	assert.equal((await get('/moderation/submission?id=' + id, bob)).status, 403);
	assert.equal((await get('/moderation/submission?id=' + id, chapter)).status, 403);
	assert.equal((await get('/moderation/submission?id=999999', admin)).status, 404);
});

test('a submitter can revise a pending proposal', async () => {
	const { id } = (
		await propose({ resource: 'prisoner', target: f.prisoner2.id, fields: { bio: 'Draft bio' } })
	).body.data;
	const res = await put(
		'/moderation/submission',
		{ id, fields: { bio: 'Better bio' }, note: 'Fixed typo' },
		alice
	);
	assert.equal(res.status, 200);
	assert.deepEqual(res.body.data.payload, { bio: 'Better bio' });
	assert.equal(res.body.data.note, 'Fixed typo');
	assert.equal(
		(await put('/moderation/submission', { id, fields: { bio: 'x' } }, bob)).status,
		403
	);
	assert.equal(
		(await put('/moderation/submission', { id, fields: { recordStatus: 'draft' } }, alice)).status,
		400
	);
	await del('/moderation/submission', { id }, alice);
	assert.equal((await put('/moderation/submission', { id, note: 'late' }, alice)).status, 409);
});

// ---- review ---------------------------------------------------------------

test('approving applies the proposal, with optional reviewer edits, and records it', async () => {
	const id = (await get('/moderation/submissions?resource=prisoner', admin)).body.data[0].id;
	assert.equal((await put('/moderation/approve', { id }, chapter)).status, 403);
	const res = await put(
		'/moderation/approve',
		{
			id,
			fields: { verifiedAt: '2026-09-12T00:00:00.000Z', verifiedBy: f.group.id },
			decisionNote: 'Confirmed with counsel'
		},
		admin
	);
	assert.equal(res.status, 200);
	const s = res.body.data;
	assert.equal(s.status, 'approved');
	assert.equal(s.reviewer.id, f.admin.id);
	assert.ok(s.reviewedAt);
	assert.equal(s.decisionNote, 'Confirmed with counsel');
	assert.equal(s.appliedChanges.chosenName, 'One Renamed');
	assert.equal(s.appliedChanges.verifiedBy, f.group.id);
	const prisoner = await Prisoner.findByPk(f.prisoner1.id);
	assert.equal(prisoner.chosenName, 'One Renamed');
	assert.deepEqual(prisoner.interests, ['chess']);
	assert.equal(prisoner.verifiedBy, f.group.id);
	assert.equal((await put('/moderation/approve', { id }, admin)).status, 409);
	assert.equal((await put('/moderation/approve', { id: 999999 }, admin)).status, 404);
});

test('approving a new-record proposal creates it as published and links the id', async () => {
	const id = (await get('/moderation/submissions?resource=prison', admin)).body.data[0].id;
	const res = await put('/moderation/approve', { id }, admin);
	assert.equal(res.status, 200);
	assert.ok(res.body.data.targetId);
	const prison = await Prison.findByPk(res.body.data.targetId);
	assert.equal(prison.prisonName, 'Proposed Facility');
	assert.equal(prison.recordStatus, 'published');
	assert.equal(prison.country, 'Canada');
	const asDraft = (
		await propose({ resource: 'chapter', fields: { name: 'New Group', location: {} } }, bob)
	).body.data;
	const draft = await put(
		'/moderation/approve',
		{ id: asDraft.id, fields: { recordStatus: 'draft' } },
		admin
	);
	assert.equal((await Chapter.findByPk(draft.body.data.targetId)).recordStatus, 'draft');
});

test('an invalid proposal fails validation on approval and stays pending', async () => {
	const { id } = (
		await propose({ resource: 'prisoner', target: f.prisoner2.id, fields: { status: 'flying' } })
	).body.data;
	const res = await put('/moderation/approve', { id }, admin);
	assert.equal(res.status, 400);
	assert.ok(Array.isArray(res.body.errors));
	assert.equal((await get('/moderation/submission?id=' + id, admin)).body.data.status, 'pending');
	const rejected = await put(
		'/moderation/reject',
		{ id, decisionNote: 'Not a real status' },
		admin
	);
	assert.equal(rejected.status, 200);
	assert.equal(rejected.body.data.status, 'rejected');
	assert.equal(rejected.body.data.decisionNote, 'Not a real status');
});

test('rejecting needs a reason; withdrawing is for the submitter or an admin', async () => {
	const { id } = (
		await propose({ resource: 'prison', target: f.prison.id, fields: { notes: 'Slow mail' } })
	).body.data;
	const noReason = await put('/moderation/reject', { id }, admin);
	assert.equal(noReason.status, 400);
	assert.match(noReason.body.errors[0], /decisionNote is required/);
	assert.equal((await put('/moderation/reject', { id, decisionNote: 'x' }, alice)).status, 403);
	assert.equal((await del('/moderation/submission', { id }, bob)).status, 403);
	const withdrawn = await del('/moderation/submission', { id }, alice);
	assert.equal(withdrawn.status, 200);
	assert.equal(withdrawn.body.data.status, 'withdrawn');
	assert.equal((await del('/moderation/submission', { id }, alice)).status, 409);
	assert.equal((await put('/moderation/reject', { id, decisionNote: 'x' }, admin)).status, 409);
	const gone = await get('/moderation/submissions', admin);
	assert.ok(!gone.body.data.some((s) => s.id === id), 'not in the pending queue');
	const all = await get('/moderation/submissions?status=all&page_size=100', admin);
	assert.ok(all.body.data.some((s) => s.id === id));
});

// ---- audit log and summary ------------------------------------------------

test('the audit log records moderation decisions and staff writes', async () => {
	await put('/prison/prison', { id: f.prison.id, notes: 'Edited directly' }, chapter);
	const sent = await post(
		'/messaging/message',
		{ messageText: 'Hi', sender: 'user', prisoner: f.prisoner1.id },
		alice
	);
	await put('/messaging/status', { id: sent.body.data.id, status: 'printed' }, admin);

	assert.equal((await get('/moderation/audit', chapter)).status, 403);
	const log = await get('/moderation/audit?page_size=100', admin);
	assert.equal(log.status, 200);
	const actions = log.body.data.map((e) => e.action);
	for (const expected of [
		'submission.create',
		'submission.approve',
		'submission.reject',
		'submission.withdraw',
		'submission.update',
		'prisoner.update',
		'prison.create',
		'prison.update',
		'letter.status'
	]) {
		assert.ok(actions.includes(expected), 'logged ' + expected);
	}
	assert.equal(log.body.data[0].action, 'letter.status', 'newest first');
	assert.deepEqual(log.body.data[0].details, { from: 'queued', to: 'printed' });
	assert.equal(log.body.data[0].actor_details.username, 'admin');

	const direct = log.body.data.find(
		(e) => e.action === 'prison.update' && e.actor === f.chapter.id
	);
	assert.ok(direct);
	assert.equal(direct.targetId, f.prison.id);
	assert.deepEqual(direct.details.fields, { id: f.prison.id, notes: 'Edited directly' });

	const viaSubmission = log.body.data.find((e) => e.action === 'prisoner.update');
	assert.ok(viaSubmission.details.viaSubmission);

	const filtered = await get('/moderation/audit?resource=prison&target=' + f.prison.id, admin);
	assert.ok(filtered.body.data.every((e) => e.resource === 'prison' && e.targetId === f.prison.id));
	const byActor = await get('/moderation/audit?actor=' + f.alice.id, admin);
	assert.ok(byActor.body.data.every((e) => e.actor === f.alice.id));
	assert.ok(byActor.body.data.some((e) => e.action === 'submission.create'));
	const byAction = await get('/moderation/audit?action=submission.approve', admin);
	assert.ok(byAction.body.data.length >= 2);
});

test('the summary counts pending work, record statuses, and stale verifications', async () => {
	assert.equal((await get('/moderation/summary', chapter)).status, 403);
	const res = await get('/moderation/summary', admin);
	assert.equal(res.status, 200);
	const s = res.body.data;
	assert.equal(typeof s.pendingSubmissions.prisoner, 'number');
	assert.ok(s.records.prisoner.published >= 2);
	assert.ok(s.records.chapter.draft >= 1);
	assert.ok(s.staleVerification.prison >= 1);
	assert.ok(s.resources.prisoner.submittable.includes('bio'));
	assert.ok(!s.resources.prisoner.submittable.includes('verificationNotes'));

	// prisoner1 was verified today by the approval above; prisoner2 never was.
	const stale = await get('/prisoner/prisoners?stale=true&page_size=100', chapter);
	assert.ok(stale.body.data.some((p) => p.id === f.prisoner2.id));
	assert.ok(!stale.body.data.some((p) => p.id === f.prisoner1.id));
	assert.equal(s.staleVerification.prisoner, stale.body.total);
	const stalePrisons = await get('/prison/prisons?stale=true&page_size=100', admin);
	assert.ok(stalePrisons.body.data.some((p) => p.id === f.prison.id));
	const old = await makeUser({ role: 'user', username: 'nobody' });
	assert.equal((await get('/prisoner/prisoners?stale=maybe', { token: old.token })).status, 400);
});
