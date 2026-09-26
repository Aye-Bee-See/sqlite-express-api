// Limits on what a signed-in account may write. Set small here; the defaults
// (constants.js) sit above a busy letter night. The public-endpoint limits have
// their own file, ratelimit.test.js; these numbers are set before the API is
// imported, because constants.js reads the environment once.
process.env.RATE_LIMIT_ENABLED = 'true';
process.env.RATE_LIMIT_LETTERS_PER_USER = '3';
process.env.RATE_LIMIT_ATTACHMENTS_PER_USER = '2';
process.env.RATE_LIMIT_SUBMISSIONS_PER_USER = '2';
process.env.RATE_LIMIT_WRITERS_PER_USER = '2';
process.env.RATE_LIMIT_INVITES_PER_USER = '2';
process.env.RATE_LIMIT_ROTATIONS_PER_USER = '1';
process.env.RATE_LIMIT_DEVICES_PER_USER = '2';
process.env.RATE_LIMIT_REGISTER_PER_IP = '3';
// The sign-in limits must not be what stops these tests.
process.env.RATE_LIMIT_LOGIN_PER_IP = '10000';
process.env.RATE_LIMIT_LOGIN_FAILURES_PER_USER = '10000';

const { test, before, after, beforeEach } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, makeFixtures, makeUser, post, upload } = await import(
	'./helpers.js'
);
const { reset } = await import('../routes/services/ratelimit.services.js');

let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
});
after(stopServer);
beforeEach(reset);

/** A PNG the upload check accepts: the magic bytes and some padding. */
const PNG = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.alloc(64, 0)
]);
const scan = () => ({ name: 'scan.png', type: 'image/png', bytes: PNG });

const letter = (text = 'Hello') => ({
	messageText: text,
	sender: 'user',
	prisoner: f.prisoner1.id
});

/** The shape every refusal has: 429, RateLimitError, and how long to wait. */
function assertRefused(res, what) {
	assert.equal(res.status, 429, what + ': ' + JSON.stringify(res.body));
	assert.equal(res.body.name, 'RateLimitError');
	assert.match(res.body.info, /Try again in \d+ minute/);
	assert.ok(Number(res.headers.get('retry-after')) > 0, 'Retry-After in seconds');
}

test('a writer may send so many letters an hour, and the next is refused', async () => {
	const writer = await makeUser({ username: 'prolific' });
	for (let i = 0; i < 3; i++) {
		assert.equal((await post('/messaging/message', letter('One ' + i), writer)).status, 201);
	}
	assertRefused(await post('/messaging/message', letter('Too many'), writer), 'fourth letter');
	// The limit is per account, so nobody else is caught by it.
	assert.equal((await post('/messaging/message', letter(), f.alice)).status, 201);
});

test('staff are counted too: a stolen group token is exactly what the limit is for', async () => {
	for (let i = 0; i < 3; i++) {
		assert.equal(
			(await post('/messaging/message', { ...letter('Group ' + i), user: f.writer.id }, f.chapter))
				.status,
			201
		);
	}
	assertRefused(
		await post('/messaging/message', { ...letter(), user: f.writer.id }, f.chapter),
		'group letter'
	);
});

test('attachments are counted before the file is read', async () => {
	const writer = await makeUser({ username: 'uploader' });
	const sent = await post('/messaging/message', letter('With files'), writer);
	const message = sent.body.data.id;
	for (let i = 0; i < 2; i++) {
		const res = await upload(
			'/messaging/attachment',
			{ fields: { message: String(message) }, file: scan() },
			writer
		);
		assert.equal(res.status, 201, JSON.stringify(res.body));
	}
	assertRefused(
		await upload(
			'/messaging/attachment',
			{ fields: { message: String(message) }, file: scan() },
			writer
		),
		'third attachment'
	);
});

test('proposed directory changes, writer accounts, and devices each have their own count', async () => {
	for (let i = 0; i < 2; i++) {
		assert.equal(
			(
				await post(
					'/moderation/submission',
					{ resource: 'prisoner', target: f.prisoner1.id, fields: { bio: 'Note ' + i } },
					f.chapter
				)
			).status,
			201
		);
	}
	assertRefused(
		await post(
			'/moderation/submission',
			{ resource: 'prisoner', target: f.prisoner1.id, fields: { bio: 'Again' } },
			f.chapter
		),
		'third proposal'
	);
	// A separate bucket: the group can still make writers after filling that one.
	for (let i = 0; i < 2; i++) {
		assert.equal((await post('/auth/writer', { name: 'Writer ' + i }, f.chapter)).status, 201);
	}
	assertRefused(await post('/auth/writer', { name: 'One more' }, f.chapter), 'third writer');

	const phone = await makeUser({ username: 'phoneowner' });
	for (let i = 0; i < 2; i++) {
		assert.equal(
			(
				await post(
					'/auth/device',
					{ token: 'phone-push-token-0123456789abcdef-' + i, platform: 'android' },
					phone
				)
			).status,
			201
		);
	}
	assertRefused(
		await post(
			'/auth/device',
			{ token: 'phone-push-token-0123456789abcdef-3', platform: 'android' },
			phone
		),
		'third device'
	);
});

test('invitations and invite codes share one count: both hand out a credential', async () => {
	assert.equal((await post('/auth/invite-codes', { count: 1 }, f.chapter)).status, 201);
	assert.equal(
		(await post('/invitation/invitation', { kind: 'member', inviteeName: 'Sam' }, f.chapter))
			.status,
		201
	);
	assertRefused(
		await post('/invitation/invitation', { kind: 'member', inviteeName: 'Kim' }, f.chapter),
		'third credential'
	);
	assertRefused(await post('/auth/invite-codes', { count: 1 }, f.chapter), 'another batch');
});

test('a refused request is counted, so a bad body cannot buy extra tries', async () => {
	// A rotation may carry 32 MB, so it is refused before that body is parsed.
	const first = await post('/auth/chapter-rotation', { chapter: f.group.id }, f.chapter);
	assert.ok(first.status >= 400 && first.status < 500, 'a bad rotation is the caller’s fault');
	assertRefused(
		await post('/auth/chapter-rotation', { chapter: f.group.id }, f.chapter),
		'second rotation'
	);
});

test('sign-ups are counted per address, and an admin making accounts is not', async () => {
	for (let i = 0; i < 3; i++) {
		const res = await post('/auth/user', {
			username: 'signup' + i,
			email: 'signup' + i + '@example.com',
			password: 'a long enough password'
		});
		assert.equal(res.status, 201, JSON.stringify(res.body));
	}
	assertRefused(
		await post('/auth/user', {
			username: 'signup4',
			email: 'signup4@example.com',
			password: 'a long enough password'
		}),
		'fourth sign-up'
	);
	// Same address, but a signed-in admin: this is account administration, not sign-up.
	assert.equal(
		(
			await post(
				'/auth/user',
				{
					username: 'madebyadmin',
					email: 'madebyadmin@example.com',
					password: 'a long enough password'
				},
				f.admin
			)
		).status,
		201
	);
});
