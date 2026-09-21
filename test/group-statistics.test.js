import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	makeFixtures,
	get,
	post,
	put,
	Chapter,
	Message,
	Prison,
	sequelize
} from './helpers.js';
import MessageStatus from '../database/models/message-status.model.js';
import { runRetention } from '../database/retention.js';

let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
	await Prison.addRelay(f.group.id, f.prison.id);
});
after(stopServer);

const group = async (who) => (await get('/chapter/chapter?id=' + f.group.id, who)).body.data;
const mail = async (count) => {
	const ids = [];
	for (let i = 0; i < count; i += 1) {
		const sent = await post(
			'/messaging/message',
			{ prisoner: f.prisoner1.id, messageText: 'Letter ' + i, sender: 'user' },
			f.alice
		);
		ids.push(sent.body.data.id);
	}
	for (const status of ['printed', 'mailed']) {
		const res = await put('/messaging/status/batch', { ids, status }, f.chapter);
		assert.equal(res.status, 200, JSON.stringify(res.body));
	}
	return ids;
};

test('every mailed letter is counted, one at a time or in a batch, and only when it is mailed', async () => {
	const sent = await post(
		'/messaging/message',
		{ prisoner: f.prisoner1.id, messageText: 'First', sender: 'user' },
		f.alice
	);
	await put('/messaging/status', { id: sent.body.data.id, status: 'printed' }, f.chapter);
	assert.equal((await group(f.chapter)).lettersCounted, 0, 'printed is not mailed');
	await put('/messaging/status', { id: sent.body.data.id, status: 'mailed' }, f.chapter);
	assert.equal((await group(f.chapter)).lettersCounted, 1);
	await mail(3);
	assert.equal((await group(f.chapter)).lettersCounted, 4);
	// A letter that comes back was still sent.
	await put(
		'/messaging/status',
		{ id: sent.body.data.id, status: 'returned', reason: 'refused' },
		f.chapter
	);
	assert.equal((await group(f.chapter)).lettersCounted, 4);
});

test('a small group is not put on show: nothing is public below twenty letters', async () => {
	const asStaff = await group(f.chapter);
	assert.deepEqual(
		[asStaff.lettersCounted, asStaff.lettersSentBefore, asStaff.lettersSent],
		[4, 0, null]
	);
	for (const who of [undefined, f.alice]) {
		const seen = await group(who);
		assert.equal(seen.lettersSent, null);
		assert.equal(seen.lettersCounted, undefined, 'the figure behind it is for staff');
		assert.equal(seen.lettersSentBefore, undefined);
	}
	const listed = (await get('/chapter/chapters?page_size=100')).body.data.find(
		(c) => c.id === f.group.id
	);
	assert.equal(listed.lettersCounted, undefined);
	// Nor through the facility's page.
	const prison = (await get('/prison/prison?id=' + f.prison.id + '&full=true')).body.data;
	assert.equal(prison.relay_groups[0].lettersCounted, undefined);
});

test('what a group mailed before it used the site is its own to say, and counts', async () => {
	const typed = await put('/chapter/chapter', { id: f.group.id, lettersSent: '5000' }, f.chapter);
	assert.equal(typed.status, 200);
	assert.equal((await group()).lettersSent, null, 'the public number cannot be typed');

	assert.equal(
		(await put('/chapter/chapter', { id: f.group.id, lettersSentBefore: -3 }, f.chapter)).status,
		400
	);
	const set = await put('/chapter/chapter', { id: f.group.id, lettersSentBefore: 120 }, f.chapter);
	assert.equal(set.status, 200, JSON.stringify(set.body));
	assert.equal((await group()).lettersSent, '124', '120 before, 4 here');
	await mail(2);
	assert.equal((await group()).lettersSent, '126');
	// Taken back, it is hidden again.
	await put('/chapter/chapter', { id: f.group.id, lettersSentBefore: 0 }, f.chapter);
	assert.equal((await group()).lettersSent, null);
	await put('/chapter/chapter', { id: f.group.id, lettersSentBefore: 120 }, f.chapter);
});

test('the count does not fall when retention deletes old letters', async () => {
	const before = (await group(f.chapter)).lettersCounted;
	const report = await runRetention({ now: new Date(Date.now() + 200 * 86400000), log: () => {} });
	assert.ok(report.letters > 0, 'retention removed the mailed letters');
	assert.equal((await group(f.chapter)).lettersCounted, before);
});

test('the time to mail is a median of real mailings, and says nothing when there are too few', async () => {
	const ids = await mail(5);
	// Written 2, 4, 6, 8 and 30 days before they were mailed: the median is 6, whatever the outlier.
	for (const [i, days] of [2, 4, 6, 8, 30].entries()) {
		const mailed = await MessageStatus.findOne({ where: { message: ids[i], toStatus: 'mailed' } });
		const written = new Date(mailed.createdAt.getTime() - days * 86400000);
		await sequelize.query('UPDATE Messages SET createdAt = :written WHERE id = :id', {
			replacements: {
				id: ids[i],
				written: written.toISOString().replace('T', ' ').replace('Z', ' +00:00')
			}
		});
	}
	assert.equal(await Chapter.refreshMailingTimes(), 1);
	assert.equal((await group()).averageTimeDays, 6);

	// It cannot be typed either.
	await put('/chapter/chapter', { id: f.group.id, averageTimeDays: 1 }, f.chapter);
	assert.equal((await group()).averageTimeDays, 6);

	// Four mailings say nothing; and nothing is said while the letter count is hidden.
	await Message.destroy({ where: { id: ids[0] }, force: true });
	await Chapter.refreshMailingTimes();
	assert.equal((await group()).averageTimeDays, null);
});
