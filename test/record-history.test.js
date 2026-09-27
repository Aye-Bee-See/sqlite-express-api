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
	Chapter,
	User
} from './helpers.js';

let f;
let owner;
before(async () => {
	await startServer();
	f = await makeFixtures();
	owner = await makeUser({ role: 'chapter', username: 'historyowner' });
	await User.update({ chapterId: f.group.id }, { where: { id: owner.id } });
	await Chapter.update({ ownerId: owner.id }, { where: { id: f.group.id } });
});
after(stopServer);

test('a record says what changed, when, and who did it', async () => {
	const made = await post(
		'/prison/prison',
		{ prisonName: 'History Prison', address: { street: '1 Old Road' }, country: 'United States' },
		f.admin
	);
	assert.equal(made.status, 201, JSON.stringify(made.body));
	const id = made.body.data.id;

	assert.equal(
		(await put('/prison/prison', { id, prisonName: 'History Facility' }, f.admin)).status,
		200
	);

	const history = await get('/prison/history?id=' + id, f.admin);
	assert.equal(history.status, 200, JSON.stringify(history.body));
	const [newest, oldest] = history.body.data;

	// Newest first, and the change carries both sides.
	assert.equal(newest.action, 'prison.update');
	assert.deepEqual(newest.changes, {
		prisonName: { from: 'History Prison', to: 'History Facility' }
	});
	assert.equal(newest.actor.username, 'admin');
	assert.equal(newest.actor.role, 'admin');
	assert.ok(newest.at, 'and when');

	assert.equal(oldest.action, 'prison.create');
	assert.equal(history.body.total, 2);
});

test('an edit that changes nothing leaves no change behind', async () => {
	const made = await post(
		'/prison/prison',
		{ prisonName: 'Unchanged Prison', address: { street: '2 Same Street' } },
		f.admin
	);
	const id = made.body.data.id;
	// The same values again: a client re-sending a whole form.
	await put(
		'/prison/prison',
		{ id, prisonName: 'Unchanged Prison', address: { street: '2 Same Street' } },
		f.admin
	);
	const history = await get('/prison/history?id=' + id, f.admin);
	const update = history.body.data.find((e) => e.action === 'prison.update');
	assert.ok(update, 'the write is still recorded');
	assert.equal(update.changes, undefined, 'but nothing is listed as changed');
});

test("a proposal's approval shows in the record's own history, with the old values", async () => {
	const proposed = await post(
		'/moderation/submission',
		{ resource: 'prisoner', target: f.prisoner1.id, fields: { bio: 'Proposed by a group' } },
		f.chapter
	);
	assert.equal(proposed.status, 201, JSON.stringify(proposed.body));
	const approved = await put('/moderation/approve', { id: proposed.body.data.id }, f.admin);
	assert.equal(approved.status, 200, JSON.stringify(approved.body));

	const history = await get('/prisoner/history?id=' + f.prisoner1.id, f.admin);
	assert.equal(history.status, 200);
	const entry = history.body.data.find((e) => e.details && e.details.viaSubmission);
	assert.ok(entry, 'the record, not only the submission, records the change');
	assert.equal(entry.changes.bio.to, 'Proposed by a group');
	assert.equal(entry.changes.bio.from, f.prisoner1.bio ?? null);
	assert.equal(entry.actor.username, 'admin', 'the reviewer who applied it');
});

test('history is staff only, and a record that does not exist is a 404', async () => {
	// A group admin of an active group may read it: they propose the changes.
	assert.equal((await get('/prison/history?id=' + f.prison.id, f.chapter)).status, 200);
	assert.equal((await get('/prison/history?id=' + f.prison.id, owner)).status, 200);
	// A writer may not, and neither may a visitor.
	assert.equal((await get('/prison/history?id=' + f.prison.id, f.alice)).status, 403);
	assert.equal((await get('/prison/history?id=' + f.prison.id)).status, 401);
	assert.equal((await get('/prison/history?id=999999', f.admin)).status, 404);
});

test('every kind of record has one, and it is paginated', async () => {
	for (const path of [
		'/prisoner/history?id=' + f.prisoner1.id,
		'/prison/history?id=' + f.prison.id,
		'/chapter/history?id=' + f.group.id
	]) {
		const res = await get(path, f.admin);
		assert.equal(res.status, 200, path + ': ' + JSON.stringify(res.body));
		assert.ok(Array.isArray(res.body.data), path);
		assert.equal(typeof res.body.total, 'number', path);
	}
	// Six edits, read two at a time.
	for (let i = 0; i < 6; i++) {
		await put('/chapter/chapter', { id: f.group.id, about: 'Version ' + i }, f.admin);
	}
	const page1 = await get('/chapter/history?id=' + f.group.id + '&page_size=2', f.admin);
	const page2 = await get('/chapter/history?id=' + f.group.id + '&page_size=2&page=2', f.admin);
	assert.equal(page1.body.data.length, 2);
	assert.equal(page2.body.data.length, 2);
	assert.notEqual(page1.body.data[0].id, page2.body.data[0].id);
	assert.ok(page1.body.total >= 6);
	assert.equal(page1.body.data[0].changes.about.to, 'Version 5', 'newest first');
});
