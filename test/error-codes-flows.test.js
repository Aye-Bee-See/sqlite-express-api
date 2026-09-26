// Step 2 of the error-code work: the codes on the flows the Android and iOS
// agents asked for first. One test per flow, checking the field and code a
// client would key its own wording on.
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
	upload
} from './helpers.js';

let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
});
after(stopServer);

test('pen names: the availability check says why, in a code as well as a sentence', async () => {
	const writer = await makeUser({ username: 'penflow' });
	assert.equal(
		(await put('/auth/user', { id: writer.id, penName: 'Taken Name' }, writer)).status,
		200
	);

	const taken = await get('/auth/pen-name-available?name=taken%20name');
	assert.equal(taken.body.data.available, false);
	assert.equal(taken.body.data.reasonCode, 'not_unique');

	const short = await get('/auth/pen-name-available?name=Jo');
	assert.equal(short.body.data.reasonCode, 'length_out_of_range');

	const free = await get('/auth/pen-name-available?name=Quite%20Free');
	assert.deepEqual([free.body.data.available, free.body.data.reasonCode], [true, null]);
});

test('joining: a reserved username and a placeholder email say which field and why', async () => {
	const { codes } = (await post('/auth/invite-codes', { count: 2 }, f.chapter)).body.data;
	const reserved = await post('/auth/join', {
		code: codes[0],
		username: 'writer-taken',
		password: 'a long enough password',
		email: 'someone@example.com'
	});
	assert.equal(reserved.status, 400, JSON.stringify(reserved.body));
	assert.deepEqual(reserved.body.problems, [{ field: 'username', code: 'reserved_value' }]);

	const placeholder = await post('/auth/join', {
		code: codes[0],
		username: 'goodname',
		password: 'a long enough password',
		email: 'nobody@managed.example'
	});
	assert.equal(placeholder.status, 400, JSON.stringify(placeholder.body));
	assert.deepEqual(placeholder.body.problems, [{ field: 'email', code: 'reserved_value' }]);
});

test('attachments: the type and the size say what was allowed', async () => {
	const writer = await makeUser({ username: 'filer' });
	const letter = await post(
		'/messaging/message',
		{ messageText: 'With a file', sender: 'user', prisoner: f.prisoner1.id },
		writer
	);
	const message = String(letter.body.data.id);

	const wrongType = await upload(
		'/messaging/attachment',
		{
			fields: { message },
			file: { name: 'notes.txt', type: 'text/plain', bytes: Buffer.from('hi') }
		},
		writer
	);
	assert.equal(wrongType.status, 400, JSON.stringify(wrongType.body));
	assert.equal(wrongType.body.problems[0].code, 'not_allowed_value');
	assert.equal(wrongType.body.problems[0].field, 'file');
	assert.ok(
		wrongType.body.problems[0].params.allowed.includes('image/png'),
		'the list is the API’s own types'
	);

	// UPLOAD_MAX_BYTES is 64 KiB in the test helper.
	const tooBig = await upload(
		'/messaging/attachment',
		{
			fields: { message },
			file: {
				name: 'big.pdf',
				type: 'application/pdf',
				bytes: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(80 * 1024, 0x20)])
			}
		},
		writer
	);
	assert.equal(tooBig.status, 400, JSON.stringify(tooBig.body));
	assert.deepEqual(tooBig.body.problems, [
		{ field: 'file', code: 'out_of_range', params: { max: 64 * 1024 } }
	]);
});

test('letters: a paper letter with nowhere to be mailed from names the field', async () => {
	const paper = await post(
		'/messaging/message',
		{ messageText: 'By hand', sender: 'user', prisoner: f.prisoner2.id, paper: true },
		f.alice
	);
	assert.equal(paper.status, 400, JSON.stringify(paper.body));
	assert.deepEqual(paper.body.problems, [{ field: 'relayChapter', code: 'required' }]);

	const wrongShape = await post(
		'/messaging/message',
		{ messageText: 'Hm', sender: 'user', prisoner: f.prisoner2.id, paper: 'yes please' },
		f.alice
	);
	assert.equal(wrongShape.status, 400, JSON.stringify(wrongShape.body));
	assert.deepEqual(wrongShape.body.problems, [
		{ field: 'paper', code: 'wrong_type', params: { expected: 'true, false, or null' } }
	]);
});

test('group forms: a batch of invite codes says the range it takes', async () => {
	const tooMany = await post('/auth/invite-codes', { count: 500 }, f.chapter);
	assert.equal(tooMany.status, 400, JSON.stringify(tooMany.body));
	assert.equal(tooMany.body.problems[0].field, 'count');
	assert.equal(tooMany.body.problems[0].code, 'out_of_range');
	assert.equal(tooMany.body.problems[0].params.min, 1);
	assert.ok(tooMany.body.problems[0].params.max > 0);

	const longLabel = await post(
		'/auth/invite-codes',
		{ count: 1, label: 'x'.repeat(81) },
		f.chapter
	);
	assert.equal(longLabel.status, 400, JSON.stringify(longLabel.body));
	assert.deepEqual(longLabel.body.problems, [
		{ field: 'label', code: 'length_out_of_range', params: { min: 0, max: 80 } }
	]);
});
