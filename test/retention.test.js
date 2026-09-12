process.env.RETENTION_MAX_DAYS = '365';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { readdirSync } = await import('node:fs');
const {
	startServer,
	stopServer,
	get,
	post,
	put,
	upload,
	makeFixtures,
	makeUser,
	Message,
	Chat,
	User,
	uploadDir
} = await import('./helpers.js');
const { runRetention, windowFor } = await import('../database/retention.js');

let f;
let admin;
let alice;
let chapter;
const DAY = 24 * 60 * 60 * 1000;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(20, 0x41)]);

before(async () => {
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
	alice = { token: f.alice.token };
	chapter = { token: f.chapter.token };
	const { Prison } = await import('./helpers.js');
	await Prison.addRelay(f.group.id, f.prison.id);
});
after(stopServer);

/** A mailed letter from `who` whose mailing happened `daysAgo` days ago. */
async function mailed(who, prisoner, daysAgo, text = 'Letter') {
	const { id } = (
		await post('/messaging/message', { messageText: text, sender: 'user', prisoner }, who)
	).body.data;
	await put('/messaging/status', { id, status: 'printed' }, admin);
	await put('/messaging/status', { id, status: 'mailed' }, admin);
	await Message.update(
		{ statusChangedAt: new Date(Date.now() - daysAgo * DAY) },
		{ where: { id } }
	);
	return id;
}

test('the window comes from the writer, the site default, and the cap', () => {
	assert.equal(windowFor({ retentionDays: null }), 90);
	assert.equal(windowFor({ retentionDays: 10 }), 10);
	assert.equal(windowFor({ retentionDays: 0 }), 365, 'forever is capped when a maximum is set');
	assert.equal(windowFor({ retentionDays: 1000 }), 365);
	assert.equal(windowFor(null), 90);
});

test('GET /messaging/retention explains the rules to the caller', async () => {
	const res = await get('/messaging/retention', alice);
	assert.equal(res.status, 200);
	assert.deepEqual(res.body.data, {
		defaultDays: 90,
		maxDays: 365,
		chosenDays: null,
		effectiveDays: 90,
		coversReplies: true
	});
	assert.equal((await put('/auth/user', { id: f.alice.id, retentionDays: 30 }, alice)).status, 200);
	assert.equal((await get('/messaging/retention', alice)).body.data.effectiveDays, 30);
	assert.equal((await put('/auth/user', { id: f.alice.id, retentionDays: -1 }, alice)).status, 400);
	assert.equal(
		(await put('/auth/user', { id: f.alice.id, retentionDays: 1.5 }, alice)).status,
		400
	);
	const over = await put('/auth/user', { id: f.alice.id, retentionDays: 400 }, alice);
	assert.equal(over.status, 400);
	assert.match(over.body.errors[0], /site maximum of 365/);
	assert.equal(
		(await put('/auth/user', { id: f.alice.id, retentionDays: 0 }, alice)).status,
		400,
		'forever is not allowed under a cap'
	);
	assert.equal(
		(await put('/auth/user', { id: f.alice.id, retentionDays: null }, alice)).status,
		200
	);
	assert.equal((await get('/messaging/retention', alice)).body.data.chosenDays, null);
});

test('mailed letters and replies past the writer window are purged with their files and empty chats', async () => {
	await put('/auth/user', { id: f.alice.id, retentionDays: 30 }, alice);
	const old = await mailed(alice, f.prisoner1.id, 31, 'Old');
	const fresh = await mailed(alice, f.prisoner1.id, 29, 'Fresh');
	const queued = (
		await post(
			'/messaging/message',
			{ messageText: 'Still queued', sender: 'user', prisoner: f.prisoner1.id },
			alice
		)
	).body.data.id;
	const reply = (
		await post(
			'/messaging/message',
			{ messageText: 'Reply', sender: 'prisoner', prisoner: f.prisoner1.id, user: f.alice.id },
			chapter
		)
	).body.data.id;
	await Message.update(
		{ statusChangedAt: new Date(Date.now() - 40 * DAY) },
		{ where: { id: reply } }
	);
	const oldFile = (
		await upload(
			'/messaging/attachment',
			{ fields: { message: old }, file: { name: 'a.pdf', type: 'application/pdf', bytes: PDF } },
			admin
		)
	).body.data;
	assert.ok(oldFile.id);
	const filesBefore = readdirSync(uploadDir).length;

	// Bob's letter in its own chat, older than the default, gets the chat removed too.
	const bobOld = await mailed({ token: f.bob.token }, f.prisoner2.id, 91, 'Bob old');
	const bobChat = (await Message.findByPk(bobOld)).chat;

	const dry = await runRetention({ dryRun: true, log: () => {} });
	assert.equal(dry.letters, 2);
	assert.equal(dry.replies, 1);
	assert.equal(dry.attachments, 1);
	assert.ok(await Message.findByPk(old), 'a dry run deletes nothing');

	const logs = [];
	const report = await runRetention({ log: (l) => logs.push(l) });
	assert.equal(report.letters, 2);
	assert.equal(report.replies, 1);
	assert.equal(report.attachments, 1);
	assert.equal(report.chats, 1);
	assert.equal(await Message.findByPk(old), null);
	assert.equal(await Message.findByPk(reply), null);
	assert.equal(await Message.findByPk(bobOld), null);
	assert.ok(await Message.findByPk(fresh), 'inside the window');
	assert.ok(await Message.findByPk(queued), 'never mailed');
	assert.equal(await Chat.findByPk(bobChat), null, 'emptied chat removed');
	assert.equal(readdirSync(uploadDir).length, filesBefore - 1, 'file removed from disk');
	assert.ok(
		logs[0].startsWith(
			'Retention: deleted 2 letter(s), 1 reply(ies), 1 attachment(s), 1 emptied chat(s)'
		)
	);
	const audit = await get('/moderation/audit?action=retention.run', admin);
	assert.equal(audit.body.data.length, 1);
	assert.deepEqual(audit.body.data[0].details, {
		letters: 2,
		replies: 1,
		attachments: 1,
		chats: 1
	});
	assert.equal(audit.body.data[0].actor, null);
	assert.equal((await runRetention({ log: () => {} })).letters, 0, 'idempotent');
});

test('a pinned letter survives, and pinning is allowed after mailing', async () => {
	const id = await mailed(alice, f.prisoner1.id, 100, 'Keepsake');
	assert.equal(
		(await put('/messaging/message', { id, messageText: 'x' }, alice)).status,
		403,
		'other edits stay locked'
	);
	const pin = await put('/messaging/message', { id, keep: true }, alice);
	assert.equal(pin.status, 200);
	assert.equal(
		(await put('/messaging/message', { id, keep: true }, { token: f.bob.token })).status,
		403
	);
	await runRetention({ log: () => {} });
	assert.ok(await Message.findByPk(id));
	assert.equal((await get('/messaging/message?id=' + id, alice)).body.data.keep, true);
	assert.equal((await put('/messaging/message', { id, keep: false }, alice)).status, 200);
	await runRetention({ log: () => {} });
	assert.equal(await Message.findByPk(id), null);
});

test('a managing group sets the window for its unclaimed and anonymous writers', async () => {
	const anon = (
		await post(
			'/messaging/message',
			{ messageText: 'Anon', sender: 'user', prisoner: f.prisoner1.id },
			chapter
		)
	).body.data;
	const set = await put('/auth/user', { id: f.writer.id, retentionDays: 7 }, chapter);
	assert.equal(set.status, 200);
	assert.equal((await put('/auth/user', { id: anon.user, retentionDays: 7 }, chapter)).status, 200);
	assert.equal(
		(await put('/auth/user', { id: f.alice.id, retentionDays: 7 }, chapter)).status,
		403,
		'not an independent writer'
	);
	assert.equal((await User.findByPk(f.writer.id)).retentionDays, 7);

	const held = await mailed(chapter, f.prisoner1.id, 8, 'Held');
	await Message.update({ user: f.writer.id }, { where: { id: held } });
	const other = await makeUser({ username: 'observer' });
	void other;
	const report = await runRetention({ log: () => {} });
	assert.ok(report.letters >= 1);
	assert.equal(await Message.findByPk(held), null);
});
