import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import {
	startServer,
	stopServer,
	get,
	post,
	put,
	del,
	upload,
	getBytes,
	makeFixtures,
	makeUser,
	uploadDir,
	Prison,
	Attachment
} from './helpers.js';

let f;
let admin;
let chapter;
let alice;
let bob;

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20)]);
const PNG = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.alloc(64, 0)
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0)]);
const WEBP = Buffer.concat([
	Buffer.from('RIFF'),
	Buffer.from([0, 0, 0, 0]),
	Buffer.from('WEBP'),
	Buffer.alloc(32, 0)
]);

const pdf = (name = 'scan.pdf') => ({ name, type: 'application/pdf', bytes: PDF });
const filesOnDisk = () => readdirSync(uploadDir);

before(async () => {
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
	chapter = { token: f.chapter.token };
	alice = { token: f.alice.token };
	bob = { token: f.bob.token };
	await Prison.addRelay(f.group.id, f.prison.id);
});
after(stopServer);

async function letterFrom(who, prisoner, text = 'Dear friend') {
	const res = await post(
		'/messaging/message',
		{ messageText: text, sender: 'user', prisoner },
		who
	);
	assert.equal(res.status, 201);
	return res.body.data;
}

test('upload, list, embed, and download an attachment', async () => {
	const letter = await letterFrom(alice, f.prisoner1.id);
	const res = await upload(
		'/messaging/attachment',
		{ fields: { message: letter.id }, file: pdf('my scan (1).pdf') },
		alice
	);
	assert.equal(res.status, 201);
	const a = res.body.data;
	assert.equal(a.message, letter.id);
	assert.equal(a.originalName, 'my scan (1).pdf');
	assert.equal(a.mimeType, 'application/pdf');
	assert.equal(a.size, PDF.length);
	assert.equal(a.uploadedBy, f.alice.id);
	assert.equal(a.storedName, undefined);
	assert.equal(filesOnDisk().length, 1);
	assert.ok(filesOnDisk()[0].endsWith('.pdf'));

	const list = await get('/messaging/attachments?message=' + letter.id, alice);
	assert.equal(list.status, 200);
	assert.deepEqual(
		list.body.data.map((x) => x.id),
		[a.id]
	);
	assert.ok(!JSON.stringify(list.body).includes('storedName'));

	const full = await get('/messaging/message?id=' + letter.id + '&full=true', alice);
	assert.equal(full.body.data.attachments.length, 1);
	assert.equal(full.body.data.attachments[0].id, a.id);

	const dl = await getBytes('/messaging/attachment?id=' + a.id, alice);
	assert.equal(dl.status, 200);
	assert.equal(dl.headers.get('content-type'), 'application/pdf');
	assert.equal(dl.headers.get('content-length'), String(PDF.length));
	assert.match(dl.headers.get('content-disposition'), /attachment; filename="my scan \(1\).pdf"/);
	assert.ok(dl.bytes.equals(PDF));

	// Missing file on disk is a 404, not a crash.
	const row = await Attachment.withFile(a.id);
	const { unlinkSync } = await import('node:fs');
	unlinkSync(uploadDir + '/' + row.storedName);
	assert.equal((await getBytes('/messaging/attachment?id=' + a.id, alice)).status, 404);
	await Attachment.remove(a.id);
});

test('every accepted type works and is sniffed', async () => {
	const letter = await letterFrom(alice, f.prisoner1.id);
	for (const [name, type, bytes] of [
		['a.png', 'image/png', PNG],
		['a.jpg', 'image/jpeg', JPEG],
		['a.webp', 'image/webp', WEBP]
	]) {
		const res = await upload(
			'/messaging/attachment',
			{ fields: { message: letter.id }, file: { name, type, bytes } },
			alice
		);
		assert.equal(res.status, 201, name);
		assert.equal(res.body.data.mimeType, type);
	}
	assert.equal(
		(await get('/messaging/attachments?message=' + letter.id, alice)).body.data.length,
		3
	);
});

test('uploads are validated: type, content, size, and shape', async () => {
	const letter = await letterFrom(alice, f.prisoner1.id);
	const at = (parts) => upload('/messaging/attachment', parts, alice);

	const text = await at({
		fields: { message: letter.id },
		file: { name: 'a.txt', type: 'text/plain', bytes: Buffer.from('hi') }
	});
	assert.equal(text.status, 400);
	assert.match(text.body.errors[0], /not accepted/);

	const lie = await at({
		fields: { message: letter.id },
		file: { name: 'a.pdf', type: 'application/pdf', bytes: PNG }
	});
	assert.equal(lie.status, 400);
	assert.match(lie.body.errors[0], /does not match its type/);

	const big = await at({
		fields: { message: letter.id },
		file: {
			name: 'big.pdf',
			type: 'application/pdf',
			bytes: Buffer.concat([PDF, Buffer.alloc(70 * 1024, 0x20)])
		}
	});
	assert.equal(big.status, 400);
	assert.match(big.body.errors[0], /larger than/);

	const nofile = await at({ fields: { message: letter.id } });
	assert.equal(nofile.status, 400);
	assert.match(nofile.body.errors[0], /field named "file"/);

	const nomessage = await at({ file: pdf() });
	assert.equal(nomessage.status, 400);
	assert.match(nomessage.body.errors[0], /message/);

	const wrongField = await at({ fields: { message: letter.id }, file: pdf(), field: 'scan' });
	assert.equal(wrongField.status, 400);
	assert.match(wrongField.body.errors[0], /exactly one file/);

	assert.equal((await at({ fields: { message: 999999 }, file: pdf() })).status, 404);
	assert.equal(
		(await upload('/messaging/attachment', { fields: { message: letter.id }, file: pdf() })).status,
		401
	);
	assert.equal((await get('/messaging/attachments', alice)).status, 400);
	assert.equal((await get('/messaging/attachment?id=999999', alice)).status, 404);
	assert.equal((await del('/messaging/attachment', { id: 999999 }, alice)).status, 404);
	assert.equal(filesOnDisk().length, 3, 'rejected uploads leave nothing on disk');
});

test('attachments follow the thread scope', async () => {
	const letter = await letterFrom(alice, f.prisoner1.id);
	const { id } = (
		await upload('/messaging/attachment', { fields: { message: letter.id }, file: pdf() }, alice)
	).body.data;

	// bob: nothing.
	assert.equal(
		(await upload('/messaging/attachment', { fields: { message: letter.id }, file: pdf() }, bob))
			.status,
		403
	);
	assert.equal((await get('/messaging/attachments?message=' + letter.id, bob)).status, 403);
	assert.equal((await getBytes('/messaging/attachment?id=' + id, bob)).status, 403);
	assert.equal((await del('/messaging/attachment', { id }, bob)).status, 403);

	// The relay group can read the letter's files and add a scan to the reply it records.
	assert.equal((await getBytes('/messaging/attachment?id=' + id, chapter)).status, 200);
	const reply = await post(
		'/messaging/message',
		{
			messageText: 'Scanned reply',
			sender: 'prisoner',
			prisoner: f.prisoner1.id,
			user: f.alice.id
		},
		chapter
	);
	assert.equal(reply.status, 201);
	const scan = await upload(
		'/messaging/attachment',
		{ fields: { message: reply.body.data.id }, file: pdf('reply.pdf') },
		chapter
	);
	assert.equal(scan.status, 201);
	assert.equal(scan.body.data.uploadedBy, f.chapter.id);
	// alice sees the scan on her thread.
	assert.equal(
		(await getBytes('/messaging/attachment?id=' + scan.body.data.id, alice)).status,
		200
	);
	// A group that does not relay the thread sees nothing.
	const other = await makeUser({ role: 'chapter', username: 'lonely' });
	assert.equal(
		(await getBytes('/messaging/attachment?id=' + id, { token: other.token })).status,
		403
	);
});

test('once printed, only an admin can change a letter attachments', async () => {
	const letter = await letterFrom(alice, f.prisoner1.id);
	const mine = (
		await upload('/messaging/attachment', { fields: { message: letter.id }, file: pdf() }, alice)
	).body.data;
	assert.equal(
		(await put('/messaging/status', { id: letter.id, status: 'printed' }, chapter)).status,
		200
	);

	const late = await upload(
		'/messaging/attachment',
		{ fields: { message: letter.id }, file: pdf() },
		alice
	);
	assert.equal(late.status, 403);
	assert.match(late.body.info, /can no longer be changed/);
	assert.equal((await del('/messaging/attachment', { id: mine.id }, alice)).status, 403);
	assert.equal(
		(await getBytes('/messaging/attachment?id=' + mine.id, alice)).status,
		200,
		'reading still works'
	);
	assert.equal(
		(await upload('/messaging/attachment', { fields: { message: letter.id }, file: pdf() }, admin))
			.status,
		201
	);
	assert.equal((await del('/messaging/attachment', { id: mine.id }, admin)).status, 200);
});

test('deleting an attachment, a message, or a chat removes the files', async () => {
	const before = filesOnDisk().length;
	const letter = await letterFrom(bob, f.prisoner2.id);
	const a = (
		await upload('/messaging/attachment', { fields: { message: letter.id }, file: pdf() }, bob)
	).body.data;
	const b = (
		await upload('/messaging/attachment', { fields: { message: letter.id }, file: pdf() }, bob)
	).body.data;
	assert.equal(filesOnDisk().length, before + 2);

	assert.equal((await del('/messaging/attachment', { id: a.id }, bob)).status, 200);
	assert.equal((await del('/messaging/attachment', { id: a.id }, bob)).status, 404);
	assert.equal(filesOnDisk().length, before + 1);

	assert.equal((await del('/messaging/message', { id: letter.id }, bob)).status, 200);
	assert.equal(filesOnDisk().length, before);
	assert.equal(await Attachment.findByPk(b.id), null);

	const another = await letterFrom(bob, f.prisoner2.id);
	await upload('/messaging/attachment', { fields: { message: another.id }, file: pdf() }, bob);
	assert.equal(filesOnDisk().length, before + 1);
	assert.equal((await del('/chat/chat', { id: another.chat }, bob)).status, 200);
	assert.equal(filesOnDisk().length, before);
});
