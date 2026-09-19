import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import {
	startServer,
	stopServer,
	api,
	get,
	post,
	del,
	upload,
	makeFixtures,
	Message,
	Attachment,
	Prison,
	sequelize
} from './helpers.js';
import IdempotencyKey, { STALE_ATTEMPT_MS } from '../database/models/idempotency-key.model.js';
import AuditLog from '../database/models/audit-log.model.js';
import Notification from '../database/models/notification.model.js';
import * as push from '../services/push.js';

let f;
let alice;
let bob;
let member;

const keyed = (who, key) => ({ ...who, headers: { 'Idempotency-Key': key } });
const letter = (text = 'One copy, please.') => ({
	sender: 'user',
	prisoner: f.prisoner1.id,
	messageText: text
});
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

before(async () => {
	await startServer();
	f = await makeFixtures();
	alice = { token: f.alice.token };
	bob = { token: f.bob.token };
	member = { token: f.chapter.token };
	await Prison.addRelay(f.group.id, f.prison.id);
});
after(stopServer);

test('a retry with the same key gets the same letter, not a second one', async () => {
	const key = randomUUID();
	const first = await post('/messaging/message', letter(), keyed(alice, key));
	assert.equal(first.status, 201, JSON.stringify(first.body));
	assert.equal(first.headers.get('idempotent-replayed'), null);

	const retry = await post('/messaging/message', letter(), keyed(alice, key));
	assert.equal(retry.status, 201, 'the answer the first attempt would have given');
	assert.equal(retry.headers.get('idempotent-replayed'), 'true');
	assert.equal(retry.body.data.id, first.body.data.id);
	assert.equal(retry.body.data.messageText, 'One copy, please.');
	assert.equal(await Message.count({ where: { user: f.alice.id } }), 1);
	assert.equal(
		await AuditLog.count({ where: { action: 'letter.status' } }),
		0,
		'and nothing is recorded twice'
	);

	// Later the letter has moved on; a very late retry shows it as it is now.
	await api('PUT', '/messaging/status', {
		...member,
		body: { id: first.body.data.id, status: 'printed' }
	});
	const late = await post('/messaging/message', letter(), keyed(alice, key));
	assert.equal(late.body.data.id, first.body.data.id);
	assert.equal(late.body.data.status, 'printed');

	// Without a key nothing changes: two sends are two letters.
	await post('/messaging/message', letter('No key'), alice);
	await post('/messaging/message', letter('No key'), alice);
	assert.equal(await Message.count({ where: { user: f.alice.id } }), 3);
});

test('a retry rings nobody a second time', async () => {
	const rung = [];
	push.use({
		name: 'fcm',
		async send(device) {
			rung.push(device.token);
			return { ok: true, gone: false };
		}
	});
	try {
		const phone = 'member-phone-push-token-0123456789';
		await post('/auth/device', { token: phone, platform: 'android' }, member);
		const key = randomUUID();
		// A new letter tells the group that will print it: once.
		const first = await post('/messaging/message', letter('Ring once'), keyed(alice, key));
		assert.equal(first.status, 201, JSON.stringify(first.body));
		await push.idle();
		assert.deepEqual(rung, [phone]);
		const feed = () => Notification.count({ where: { message: first.body.data.id } });
		assert.equal(await feed(), 1);

		for (let attempt = 0; attempt < 3; attempt += 1) {
			const retry = await post('/messaging/message', letter('Ring once'), keyed(alice, key));
			assert.equal(retry.headers.get('idempotent-replayed'), 'true');
		}
		await push.idle();
		assert.deepEqual(rung, [phone], 'no second doorbell');
		assert.equal(await feed(), 1, 'and no second entry in the feed');
	} finally {
		push.reset();
	}
});

test('a double click: two requests at once with one key make one letter', async () => {
	const before = await Message.count();
	const key = randomUUID();
	const results = await Promise.all(
		[1, 2, 3, 4].map(() =>
			post('/messaging/message', letter('Clicked four times'), keyed(alice, key))
		)
	);
	assert.equal(await Message.count(), before + 1);
	const statuses = results.map((r) => r.status).sort();
	assert.ok(
		statuses.every((status) => status === 201 || status === 409),
		statuses.join(', ')
	);
	assert.ok(statuses.includes(201));
	const ids = new Set(results.filter((r) => r.status === 201).map((r) => r.body.data.id));
	assert.equal(ids.size, 1, 'every success is the same letter');
	for (const busy of results.filter((r) => r.status === 409)) {
		assert.equal(busy.body.name, 'IdempotencyError');
		assert.equal(busy.headers.get('retry-after'), '1');
	}
	// The ones told to wait try again and get the letter.
	const again = await post('/messaging/message', letter('Clicked four times'), keyed(alice, key));
	assert.equal(again.status, 201);
	assert.ok(ids.has(again.body.data.id));
});

test('a key reused for a different letter is refused rather than swallowing it', async () => {
	const key = randomUUID();
	const first = await post('/messaging/message', letter('The first letter'), keyed(alice, key));
	assert.equal(first.status, 201);
	const other = await post('/messaging/message', letter('A different letter'), keyed(alice, key));
	assert.equal(other.status, 422, JSON.stringify(other.body));
	assert.equal(other.body.name, 'IdempotencyError');
	const elsewhere = await post(
		'/messaging/message',
		{ ...letter('The first letter'), prisoner: f.prisoner2.id },
		keyed(alice, key)
	);
	assert.equal(elsewhere.status, 422, 'to someone else');

	// Keys are per account: Bob may use the same string.
	const bobs = await post('/messaging/message', letter('The first letter'), keyed(bob, key));
	assert.equal(bobs.status, 201);
	assert.notEqual(bobs.body.data.id, first.body.data.id);
});

test('a refused attempt frees its key, so the corrected request can use it', async () => {
	const key = randomUUID();
	const bad = await post(
		'/messaging/message',
		{ ...letter(), prisoner: 999999 },
		keyed(alice, key)
	);
	assert.ok(bad.status >= 400, String(bad.status));
	assert.equal(await IdempotencyKey.count({ where: { key } }), 0);
	const fixed = await post('/messaging/message', letter('Corrected'), keyed(alice, key));
	assert.equal(fixed.status, 201, JSON.stringify(fixed.body));

	for (const malformed of ['short', 'has a space in it', 'x'.repeat(129)]) {
		const res = await post('/messaging/message', letter(), keyed(alice, malformed));
		assert.equal(res.status, 400, malformed);
		assert.match(res.body.errors[0], /Idempotency-Key must be/);
	}
});

test('a deleted letter is not sent again by a late retry', async () => {
	const key = randomUUID();
	const first = await post('/messaging/message', letter('Thought better of it'), keyed(alice, key));
	assert.equal((await del('/messaging/message', { id: first.body.data.id }, alice)).status, 200);
	const late = await post('/messaging/message', letter('Thought better of it'), keyed(alice, key));
	assert.equal(late.status, 410, JSON.stringify(late.body));
	assert.match(late.body.error, /no longer exists; it will not be sent again/);
	assert.equal(await Message.count({ where: { id: first.body.data.id } }), 0);
});

test('an attempt whose process died can be taken over, once', async () => {
	const key = randomUUID();
	// What a crash between claiming the key and saving the letter leaves behind.
	const orphan = await IdempotencyKey.create({
		userId: f.alice.id,
		scope: 'message',
		key,
		// The same request as the retries below, as the dead attempt would have recorded it.
		fingerprint: createHash('sha256')
			.update(JSON.stringify(['user', f.prisoner1.id, f.alice.id, 'After the crash']))
			.digest('hex')
	});
	const fresh = await post('/messaging/message', letter('After the crash'), keyed(alice, key));
	assert.equal(fresh.status, 409, 'too recent to call dead');

	// Sequelize manages updatedAt itself, so age the row directly, in the format it stores.
	const then = new Date(Date.now() - STALE_ATTEMPT_MS - 1000)
		.toISOString()
		.replace('T', ' ')
		.replace('Z', ' +00:00');
	await sequelize.query('UPDATE IdempotencyKeys SET updatedAt = :then WHERE id = :id', {
		replacements: { id: orphan.id, then }
	});
	const results = await Promise.all([
		post('/messaging/message', letter('After the crash'), keyed(alice, key)),
		post('/messaging/message', letter('After the crash'), keyed(alice, key))
	]);
	assert.ok(
		results.some((r) => r.status === 201),
		results.map((r) => r.status).join(', ')
	);
	const made = new Set(results.filter((r) => r.status === 201).map((r) => r.body.data.id));
	assert.equal(made.size, 1, 'only one retry takes the dead attempt over');
});

test('attachments: a retried upload returns the file already stored', async () => {
	const sent = await post('/messaging/message', letter('With a photo'), alice);
	const key = randomUUID();
	const file = { name: 'photo.png', type: 'image/png', bytes: PNG };
	const fields = { message: sent.body.data.id };
	const first = await upload('/messaging/attachment', { fields, file }, keyed(alice, key));
	assert.equal(first.status, 201, JSON.stringify(first.body));
	const retry = await upload('/messaging/attachment', { fields, file }, keyed(alice, key));
	assert.equal(retry.status, 201);
	assert.equal(retry.headers.get('idempotent-replayed'), 'true');
	assert.equal(retry.body.data.id, first.body.data.id);
	assert.equal(await Attachment.count({ where: { message: sent.body.data.id } }), 1);

	const other = await upload(
		'/messaging/attachment',
		{ fields, file: { ...file, name: 'another.png' } },
		keyed(alice, key)
	);
	assert.equal(other.status, 422);
	// A letter key and an attachment key never collide, even with the same string.
	const sameString = await post('/messaging/message', letter('Same key string'), keyed(alice, key));
	assert.equal(sameString.status, 201);
});

test('browsers may send the header, and read the reply header', async () => {
	const preflight = await api('OPTIONS', '/messaging/message', {
		headers: {
			Origin: 'http://localhost:5173',
			'Access-Control-Request-Method': 'POST',
			'Access-Control-Request-Headers': 'idempotency-key, authorization, content-type'
		}
	});
	assert.match(preflight.headers.get('access-control-allow-headers') || '', /idempotency-key/i);
	const res = await get('/health', { headers: { Origin: 'http://localhost:5173' } });
	assert.match(res.headers.get('access-control-expose-headers') || '', /Idempotent-Replayed/);
});

test('old keys are swept', async () => {
	const row = await IdempotencyKey.create({
		userId: f.alice.id,
		scope: 'message',
		key: randomUUID(),
		fingerprint: 'x',
		state: 'done'
	});
	await IdempotencyKey.update(
		{ createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
		{ where: { id: row.id }, silent: true }
	);
	assert.equal(await IdempotencyKey.sweep(), 1);
});
