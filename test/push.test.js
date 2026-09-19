import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
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
	Prison
} from './helpers.js';
import Device from '../database/models/device.model.js';
import Notification from '../database/models/notification.model.js';
import * as push from '../services/push.js';

let f;
let admin;
let alice;
let bob;
let member;
let sent; // what the stand-in push service was asked to deliver

const tokenFor = (name) => name + '-push-token-0123456789abcdef';

/**
 * Everything the API would put on the wire for a push, as text, to search
 * for leaks. The device token is left out: it is the delivery address, and
 * in this test it is named after its owner.
 */
const wire = () =>
	JSON.stringify(sent.map((device) => ({ ...push.fcmMessage(device).message, token: undefined })));

before(async () => {
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
	alice = { token: f.alice.token };
	bob = { token: f.bob.token };
	member = { token: f.chapter.token };
	await Prison.addRelay(f.group.id, f.prison.id);
	push.use({
		name: 'fcm',
		async send(device) {
			sent.push({ platform: device.platform, token: device.token, provider: device.provider });
			return device.token.startsWith('dead')
				? { ok: false, gone: true, error: 'UNREGISTERED' }
				: { ok: true, gone: false };
		}
	});
});
after(async () => {
	push.reset();
	await stopServer();
});
beforeEach(() => {
	sent = [];
});

test('a device registers, is listed without its token, and can be muted, renamed, and removed', async () => {
	assert.equal(
		(await post('/auth/device', { token: tokenFor('x'), platform: 'android' })).status,
		401
	);
	const res = await post(
		'/auth/device',
		{ token: tokenFor('alice-phone'), platform: 'android', label: 'Pixel' },
		alice
	);
	assert.equal(res.status, 201, JSON.stringify(res.body));
	assert.equal(res.body.data.created, true);
	assert.equal(res.body.data.deliverable, true);
	assert.equal(res.body.data.provider, 'fcm');
	assert.equal(res.body.data.token, undefined, 'the token is a capability; it is never echoed');
	assert.equal(res.body.data.sessionId, undefined);

	// Registering again refreshes; nothing doubles.
	const again = await post(
		'/auth/device',
		{ token: tokenFor('alice-phone'), platform: 'android' },
		alice
	);
	assert.equal(again.body.data.created, false);
	assert.equal(again.body.data.label, 'Pixel');
	assert.equal(await Device.count({ where: { userId: f.alice.id } }), 1);

	const listed = await get('/auth/devices', alice);
	assert.equal(listed.body.data.length, 1);
	assert.equal(JSON.stringify(listed.body).includes(tokenFor('alice-phone')), false);
	assert.deepEqual((await get('/auth/devices', bob)).body.data, [], "nobody else's devices");

	const id = listed.body.data[0].id;
	const muted = await put('/auth/device', { id, muted: true, label: 'Old Pixel' }, alice);
	assert.equal(muted.status, 200);
	assert.equal(muted.body.data.muted, true);
	assert.equal(muted.body.data.label, 'Old Pixel');
	assert.equal((await put('/auth/device', { id, muted: false }, bob)).status, 404, 'only your own');
	assert.equal((await put('/auth/device', { id, muted: 'yes' }, alice)).status, 400);
	assert.equal((await del('/auth/device', { id }, bob)).status, 404);
	assert.equal((await del('/auth/device', {}, alice)).status, 400);
	assert.equal((await del('/auth/device', { id }, alice)).status, 200);
	assert.equal(await Device.count({ where: { userId: f.alice.id } }), 0);

	for (const body of [
		{ platform: 'android' },
		{ token: 'short', platform: 'android' },
		{ token: tokenFor('x'), platform: 'toaster' },
		{ token: tokenFor('x'), platform: 'android', provider: 'carrier-pigeon' }
	]) {
		assert.equal((await post('/auth/device', body, alice)).status, 400, JSON.stringify(body));
	}
});

test('a reply rings the writer, and the push says nothing at all', async () => {
	await post('/auth/device', { token: tokenFor('alice-android'), platform: 'android' }, alice);
	await post('/auth/device', { token: tokenFor('alice-iphone'), platform: 'ios' }, alice);
	await post('/auth/device', { token: tokenFor('member-phone'), platform: 'android' }, member);

	// Alice writes; the group that relays is told a letter is waiting, and she is not told about her own.
	const letter = await post(
		'/messaging/message',
		{ sender: 'user', prisoner: f.prisoner1.id, messageText: 'A very private sentence.' },
		alice
	);
	assert.equal(letter.status, 201, JSON.stringify(letter.body));
	await push.idle();
	assert.deepEqual(
		sent.map((d) => d.token),
		[tokenFor('member-phone')]
	);

	sent = [];
	const reply = await post(
		'/messaging/message',
		{
			sender: 'prisoner',
			prisoner: f.prisoner1.id,
			user: f.alice.id,
			messageText: 'The reply, which is nobody else’s business.'
		},
		member
	);
	assert.equal(reply.status, 201, JSON.stringify(reply.body));
	await push.idle();
	assert.deepEqual(
		sent.map((d) => d.token).sort(),
		[tokenFor('alice-android'), tokenFor('alice-iphone')].sort()
	);

	// What would go to Google and Apple: "sync", and for iOS a bland alert. No text, names, or ids.
	const android = push.fcmMessage(sent.find((d) => d.platform === 'android')).message;
	assert.deepEqual(android.data, { type: 'sync' });
	assert.equal(android.notification, undefined, 'no visible text for Android; the app words it');
	assert.equal(android.android.priority, 'high');
	const ios = push.fcmMessage(sent.find((d) => d.platform === 'ios')).message;
	assert.deepEqual(ios.data, { type: 'sync' });
	assert.deepEqual(ios.apns.payload.aps.alert, {
		title: 'New activity',
		body: 'Open the app to see it.'
	});
	assert.equal(ios.apns.payload.aps['mutable-content'], 1);
	for (const secret of [
		'private',
		'business',
		'Test Prison',
		'alice',
		'Fixture Group',
		'chat',
		'message'
	]) {
		assert.equal(wire().includes(secret), false, 'leaked: ' + secret);
	}
});

test('the feed says what happened, to the right person, without letter text', async () => {
	const feed = await get('/auth/notifications', alice);
	assert.equal(feed.status, 200, JSON.stringify(feed.body));
	assert.equal(feed.body.unread, 1);
	assert.equal(feed.body.total, 1);
	const [entry] = feed.body.data;
	assert.equal(entry.event, 'letter.reply');
	assert.ok(entry.chat && entry.message);
	assert.equal(entry.readAt, null);
	assert.equal(JSON.stringify(feed.body).includes('business'), false);

	const groupFeed = await get('/auth/notifications', member);
	assert.deepEqual(
		groupFeed.body.data.map((n) => n.event),
		['letter.queued']
	);
	assert.deepEqual((await get('/auth/notifications', bob)).body.data, []);
	assert.equal((await get('/auth/notifications')).status, 401);

	// Status changes tell the writer, with the new status, and not the member who made them.
	sent = [];
	const letterId = groupFeed.body.data[0].message;
	assert.equal(
		(await put('/messaging/status', { id: letterId, status: 'printed' }, member)).status,
		200
	);
	await push.idle();
	assert.ok(sent.every((d) => d.token.startsWith('alice')));
	const after = await get('/auth/notifications?since=' + entry.id, alice);
	assert.deepEqual(
		after.body.data.map((n) => [n.event, n.detail]),
		[['letter.status', { status: 'printed' }]]
	);
	assert.equal(after.body.unread, 2);

	// Reading.
	const one = await put('/auth/notifications/read', { ids: [entry.id] }, alice);
	assert.deepEqual(one.body.data, { marked: 1, unread: 1 });
	assert.equal(
		(await put('/auth/notifications/read', { ids: [entry.id] }, bob)).body.data.marked,
		0
	);
	assert.equal((await get('/auth/notifications?unread=true', alice)).body.data.length, 1);
	const rest = await put('/auth/notifications/read', {}, alice);
	assert.deepEqual(rest.body.data, { marked: 1, unread: 0 });
	assert.equal((await put('/auth/notifications/read', { ids: 'all' }, alice)).status, 400);
	assert.equal((await get('/auth/notifications?since=soon', alice)).status, 400);
});

test('a moderation decision tells the person who proposed it', async () => {
	const proposed = await post(
		'/moderation/submission',
		{ resource: 'prison', target: f.prison.id, fields: { notes: 'Mail is slow in winter' } },
		bob
	);
	assert.equal(proposed.status, 201);
	await put('/moderation/approve', { id: proposed.body.data.id }, admin);
	const feed = await get('/auth/notifications', bob);
	assert.deepEqual(
		feed.body.data.map((n) => [n.event, n.submission, n.detail]),
		[['submission.decided', proposed.body.data.id, { status: 'approved', resource: 'prison' }]]
	);
});

test('muted devices, unclaimed writers, and the person who acted are left alone', async () => {
	const devices = (await get('/auth/devices', alice)).body.data;
	await put(
		'/auth/device',
		{ id: devices.find((d) => d.platform === 'ios').id, muted: true },
		alice
	);
	sent = [];
	await post(
		'/messaging/message',
		{ sender: 'prisoner', prisoner: f.prisoner1.id, user: f.alice.id, messageText: 'Second reply' },
		member
	);
	await push.idle();
	assert.deepEqual(
		sent.map((d) => d.platform),
		['android'],
		'the muted phone stays quiet; the feed still has the entry'
	);

	// A reply for an unclaimed writer has nobody to tell: that account cannot sign in.
	const before = await Notification.count();
	await post(
		'/messaging/message',
		{ sender: 'user', prisoner: f.prisoner2.id, user: f.writer.id, messageText: 'For them' },
		member
	);
	await post(
		'/messaging/message',
		{ sender: 'prisoner', prisoner: f.prisoner2.id, user: f.writer.id, messageText: 'Their reply' },
		member
	);
	await push.idle();
	assert.equal(await Notification.count({ where: { userId: f.writer.id } }), 0);
	assert.equal(
		await Notification.count(),
		before,
		'and the member who recorded both is not told either'
	);
});

test('a dead token is forgotten; a phone that changes hands stops ringing for its last owner', async () => {
	await post(
		'/auth/device',
		{ token: 'dead-' + tokenFor('alice-old'), platform: 'android' },
		alice
	);
	sent = [];
	await post(
		'/messaging/message',
		{ sender: 'prisoner', prisoner: f.prisoner1.id, user: f.alice.id, messageText: 'Third reply' },
		member
	);
	await push.idle();
	assert.ok(sent.some((d) => d.token.startsWith('dead-')));
	assert.equal(
		await Device.scope('withToken').count({ where: { token: 'dead-' + tokenFor('alice-old') } }),
		0
	);

	// Bob signs in on Alice's Android phone: same push token, new owner.
	const moved = await post(
		'/auth/device',
		{ token: tokenFor('alice-android'), platform: 'android' },
		bob
	);
	assert.equal(moved.body.data.created, false);
	assert.equal(moved.body.data.userId, f.bob.id);
	sent = [];
	await post(
		'/messaging/message',
		{ sender: 'prisoner', prisoner: f.prisoner1.id, user: f.alice.id, messageText: 'Fourth reply' },
		member
	);
	await push.idle();
	assert.ok(
		!sent.some((d) => d.token === tokenFor('alice-android')),
		"Alice's reply does not ring Bob's phone"
	);
});

test('signing out stops the pushes: one device, or all of them', async () => {
	const carol = await makeUser({ role: 'user', username: 'carol' });
	const phone = { token: await login('carol', carol.password) };
	const tablet = { token: await login('carol', carol.password) };
	await post('/auth/device', { token: tokenFor('carol-phone'), platform: 'android' }, phone);
	await post('/auth/device', { token: tokenFor('carol-tablet'), platform: 'android' }, tablet);
	assert.equal(await Device.count({ where: { userId: carol.id } }), 2);

	assert.equal((await post('/auth/logout', {}, phone)).status, 200);
	const left = await Device.scope('withToken').findAll({ where: { userId: carol.id } });
	assert.deepEqual(
		left.map((d) => d.token),
		[tokenFor('carol-tablet')],
		'only the device that signed out'
	);

	await post('/auth/device', { token: tokenFor('carol-laptop'), platform: 'web' }, tablet);
	assert.equal((await post('/auth/logout', { everywhere: true }, tablet)).status, 200);
	assert.equal(await Device.count({ where: { userId: carol.id } }), 0);

	// An admin revoking sessions, and a password change, do the same.
	const dave = await makeUser({ role: 'user', username: 'dave' });
	await post(
		'/auth/device',
		{ token: tokenFor('dave-phone'), platform: 'ios' },
		{ token: dave.token }
	);
	assert.equal((await post('/auth/revoke', { user: dave.id }, admin)).status, 200);
	assert.equal(await Device.count({ where: { userId: dave.id } }), 0);

	// Deleting the account takes its devices and feed with it.
	await post('/auth/device', { token: tokenFor('bob-second'), platform: 'android' }, bob);
	await User.destroy({ where: { id: f.bob.id }, force: true }).catch(() => {});
});

test('with no push service configured, devices still register and nothing is sent', async () => {
	push.reset();
	assert.deepEqual((await get('/health')).body.push, []);
	const res = await post(
		'/auth/device',
		{ token: tokenFor('alice-spare'), platform: 'android' },
		alice
	);
	assert.equal(res.status, 201);
	assert.equal(res.body.data.deliverable, false);
	sent = [];
	const reply = await post(
		'/messaging/message',
		{ sender: 'prisoner', prisoner: f.prisoner1.id, user: f.alice.id, messageText: 'Fifth reply' },
		member
	);
	assert.equal(reply.status, 201, 'a letter never waits on, or fails with, the doorbell');
	await push.idle();
	assert.deepEqual(sent, []);
	assert.ok(
		(await get('/auth/notifications?unread=true', alice)).body.data.length >= 1,
		'the feed still works'
	);
});

test('the FCM provider signs in with the service account and sends the documented request', async () => {
	const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const serviceAccount = {
		project_id: 'abc-test',
		client_email: 'push@abc-test.iam.gserviceaccount.com',
		private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
	};
	const calls = [];
	let sendStatus = 200;
	let sendBody = { name: 'projects/abc-test/messages/1' };
	const fakeFetch = async (url, init) => {
		calls.push({ url, init });
		if (url === 'https://oauth2.googleapis.com/token') {
			return {
				ok: true,
				status: 200,
				json: async () => ({ access_token: 'ya29.test', expires_in: 3600 })
			};
		}
		return { ok: sendStatus === 200, status: sendStatus, json: async () => sendBody };
	};
	const provider = push.createFcmProvider({ serviceAccount, fetch: fakeFetch });
	const device = { provider: 'fcm', platform: 'android', token: tokenFor('real') };

	assert.deepEqual(await provider.send(device), { ok: true, gone: false });
	const [auth, send] = calls;
	assert.equal(auth.url, 'https://oauth2.googleapis.com/token');
	const form = new URLSearchParams(auth.init.body);
	assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
	const claims = jwt.verify(
		form.get('assertion'),
		publicKey.export({ type: 'spki', format: 'pem' }),
		{
			algorithms: ['RS256']
		}
	);
	assert.equal(claims.iss, serviceAccount.client_email);
	assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
	assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
	assert.equal(send.url, 'https://fcm.googleapis.com/v1/projects/abc-test/messages:send');
	assert.equal(send.init.headers.Authorization, 'Bearer ya29.test');
	assert.deepEqual(JSON.parse(send.init.body), push.fcmMessage(device));

	// The access token is reused, not fetched for every push.
	await provider.send(device);
	assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1);

	// Only UNREGISTERED forgets a device; a payload or key problem must not wipe tokens.
	sendStatus = 404;
	sendBody = {
		error: {
			status: 'NOT_FOUND',
			details: [
				{
					'@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
					errorCode: 'UNREGISTERED'
				}
			]
		}
	};
	assert.deepEqual(await provider.send(device), { ok: false, gone: true, error: 'UNREGISTERED' });
	sendStatus = 400;
	sendBody = {
		error: { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'INVALID_ARGUMENT' }] }
	};
	assert.deepEqual(await provider.send(device), {
		ok: false,
		gone: false,
		error: 'INVALID_ARGUMENT'
	});
	sendStatus = 403;
	sendBody = {
		error: { status: 'PERMISSION_DENIED', details: [{ errorCode: 'SENDER_ID_MISMATCH' }] }
	};
	assert.equal((await provider.send(device)).gone, false);
});

test('old feed entries are swept', async () => {
	const stale = await Notification.create({ userId: f.alice.id, event: 'letter.reply' });
	await Notification.update(
		{ createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
		{ where: { id: stale.id }, silent: true }
	);
	const before = await Notification.count({ where: { userId: f.alice.id } });
	assert.equal(await Notification.sweep(), 1);
	assert.equal(await Notification.count({ where: { userId: f.alice.id } }), before - 1);
});
