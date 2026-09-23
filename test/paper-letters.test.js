import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	makeFixtures,
	get,
	post,
	put,
	del,
	upload,
	Prison,
	Prisoner,
	Chapter,
	Message
} from './helpers.js';
import Notification from '../database/models/notification.model.js';
import MessageStatus from '../database/models/message-status.model.js';

const PNG = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.alloc(64, 0)
]);
const photo = { name: 'letter.png', type: 'image/png', bytes: PNG };

let f;
let noRelayPrisoner;
before(async () => {
	await startServer();
	f = await makeFixtures();
	await Prison.addRelay(f.group.id, f.prison.id);
	const noRelay = await Prison.createPrison({ prisonName: 'Nobody Relays', address: {} });
	noRelayPrisoner = await Prisoner.createPrisoner({
		birthName: 'Far Away',
		prison: noRelay.id,
		inmateID: 'FA-1'
	});
});
after(stopServer);

const paper = (extra = {}) => ({ sender: 'user', prisoner: f.prisoner1.id, paper: true, ...extra });

test('a writer logs a paper letter: no text, starts printed, the group is told, and the photo may follow', async () => {
	const res = await post('/messaging/message', paper(), f.alice);
	assert.equal(res.status, 201, JSON.stringify(res.body));
	const letter = res.body.data;
	assert.deepEqual(
		[letter.paper, letter.status, letter.relayChapter, letter.messageText ?? null],
		[true, 'printed', f.group.id, null]
	);
	const history = await MessageStatus.findAll({ where: { message: letter.id } });
	assert.deepEqual(
		history.map((h) => [h.fromStatus, h.toStatus]),
		[[null, 'printed']]
	);
	// Not in the print queue; in the pile to be mailed, marked as paper.
	const queue = await get(
		'/messaging/messages?relayChapter=' + f.group.id + '&status=queued',
		f.chapter
	);
	assert.ok(!queue.body.data.some((m) => m.id === letter.id));
	const pile = await get(
		'/messaging/messages?relayChapter=' + f.group.id + '&status=printed',
		f.chapter
	);
	assert.deepEqual(
		pile.body.data.filter((m) => m.id === letter.id).map((m) => m.paper),
		[true]
	);
	const told = await Notification.findOne({ where: { userId: f.chapter.id, message: letter.id } });
	assert.equal(told.event, 'letter.queued');
	assert.deepEqual(told.detail, { paper: true });

	// The photo of the page may be added while the letter waits to be mailed.
	const added = await upload(
		'/messaging/attachment',
		{ fields: { message: letter.id }, file: photo },
		f.alice
	);
	assert.equal(added.status, 201, JSON.stringify(added.body));
	// The writer cannot edit or delete it (it is printed), and paper cannot be unset.
	assert.equal(
		(await put('/messaging/message', { id: letter.id, messageText: 'x' }, f.alice)).status,
		403
	);
	assert.equal((await del('/messaging/message', { id: letter.id }, f.alice)).status, 403);
	await put('/messaging/message', { id: letter.id, paper: false, keep: true }, f.alice);
	assert.equal((await Message.findByPk(letter.id)).paper, true);

	// Mailed with the night's batch; then its files are fixed like any mailed letter's.
	const mailed = await put(
		'/messaging/status/batch',
		{ ids: [letter.id], status: 'mailed' },
		f.chapter
	);
	assert.equal(mailed.status, 200, JSON.stringify(mailed.body));
	const late = await upload(
		'/messaging/attachment',
		{ fields: { message: letter.id }, file: photo },
		f.alice
	);
	assert.equal(late.status, 403);
	assert.equal(
		(await del('/messaging/attachment', { id: added.body.data.id }, f.alice)).status,
		403
	);
	const group = await Chapter.findByPk(f.group.id);
	assert.equal(group.lettersCounted, 1, 'a paper letter counts once it is mailed');
});

test('a group admin logs a paper letter for a managed writer, or under the anonymous writer', async () => {
	const forWriter = await post(
		'/messaging/message',
		paper({ user: f.writer.id, messageText: 'Transcribed: two pages, in Spanish' }),
		f.chapter
	);
	assert.equal(forWriter.status, 201, JSON.stringify(forWriter.body));
	assert.deepEqual(
		[forWriter.body.data.user, forWriter.body.data.status, forWriter.body.data.messageText],
		[f.writer.id, 'printed', 'Transcribed: two pages, in Spanish']
	);
	const anonymous = await post('/messaging/message', paper(), f.chapter);
	assert.equal(anonymous.status, 201, JSON.stringify(anonymous.body));
	assert.equal(anonymous.body.data.status, 'printed');
	assert.notEqual(anonymous.body.data.user, f.chapter.id);
});

test('what a paper letter cannot be: a reply, a letter nobody mails, or a flag that is not a boolean', async () => {
	const reply = await post(
		'/messaging/message',
		{
			sender: 'prisoner',
			prisoner: f.prisoner1.id,
			user: f.writer.id,
			paper: true,
			messageText: 'hi'
		},
		f.chapter
	);
	assert.equal(reply.status, 400, JSON.stringify(reply.body));
	assert.match(reply.body.errors[0], /a reply is recorded as received/);
	const nobody = await post('/messaging/message', paper({ prisoner: noRelayPrisoner.id }), f.alice);
	assert.equal(nobody.status, 400, JSON.stringify(nobody.body));
	assert.match(nobody.body.errors[0], /one a group mails/);
	const text = await post('/messaging/message', paper({ paper: 'yes' }), f.alice);
	assert.equal(text.status, 400);
	assert.match(text.body.errors[0], /paper must be true or false/);
	// false is the ordinary letter.
	const typed = await post(
		'/messaging/message',
		paper({ paper: false, messageText: 'Dear friend' }),
		f.alice
	);
	assert.equal(typed.status, 201);
	assert.deepEqual([typed.body.data.paper, typed.body.data.status], [false, 'queued']);
});

test('a retry under the same key gets the same paper letter; a typed letter under it is another', async () => {
	const keyed = (who, key) => ({ ...who, headers: { 'Idempotency-Key': key } });
	const first = await post('/messaging/message', paper(), keyed(f.alice, 'paper-night-1'));
	const again = await post('/messaging/message', paper(), keyed(f.alice, 'paper-night-1'));
	assert.equal(first.status, 201);
	assert.equal(again.status, 201);
	assert.equal(again.body.data.id, first.body.data.id);
	const typed = await post(
		'/messaging/message',
		paper({ paper: false, messageText: 'Dear friend' }),
		keyed(f.alice, 'paper-night-1')
	);
	assert.equal(typed.status, 422, 'the key belongs to a different request');
});
