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
	upload,
	baseUrlOf,
	sequelize
} from './helpers.js';
import { newPenName } from './helpers.js';
import ValidationError from '../services/ValidationError.js';

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
		penName: newPenName(),
		code: codes[0],
		username: 'writer-taken',
		password: 'a long enough password',
		email: 'someone@example.com'
	});
	assert.equal(reserved.status, 400, JSON.stringify(reserved.body));
	assert.deepEqual(reserved.body.problems, [{ field: 'username', code: 'reserved_value' }]);

	const placeholder = await post('/auth/join', {
		penName: newPenName(),
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

test('a proposal says which field inside `fields` was refused', async () => {
	const bad = await post(
		'/moderation/submission',
		{ resource: 'prisoner', target: f.prisoner1.id, fields: { status: 'flying' } },
		f.chapter
	);
	assert.equal(bad.status, 400, JSON.stringify(bad.body));
	assert.equal(bad.body.problems[0].field, 'fields.status', 'the path, as everywhere else');
	assert.equal(bad.body.problems[0].code, 'not_allowed_value');

	// A new record, validated whole: the missing name is named the same way.
	const incomplete = await post(
		'/moderation/submission',
		{ resource: 'prison', fields: { address: { city: 'Nowhere' } } },
		f.chapter
	);
	assert.equal(incomplete.status, 400, JSON.stringify(incomplete.body));
	assert.deepEqual(incomplete.body.problems, [{ field: 'fields.prisonName', code: 'required' }]);
});

test('an endpoint condition is part of the code, as the composition rule says', async () => {
	// GET /auth/user answers `condition` from how the account was asked for; the
	// code carries it too, so `code` is always family + '.' + condition.
	const res = await get('/auth/user?id=987654', f.admin);
	assert.equal(res.status, 404, JSON.stringify(res.body));
	assert.equal(res.body.condition, 'id');
	assert.equal(res.body.code, 'not_found.id');
	assert.equal(res.body.code.split('.')[0], 'not_found', 'the family a client matches on');
});

test('a body that is not JSON is a request_body refusal, and logs nothing', async () => {
	const logged = [];
	const original = console.error;
	console.error = (...args) => logged.push(args.join(' '));
	let res;
	try {
		res = await fetch(baseUrlOf() + '/auth/login', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{"username": "x", '
		});
	} finally {
		console.error = original;
	}
	const body = await res.json();
	assert.equal(res.status, 400);
	assert.equal(body.code, 'request_body.not_json');
	assert.equal(body.condition, 'not_json');
	assert.deepEqual(body.problems, [{ field: null, code: 'validation_failed' }]);
	assert.deepEqual(
		logged.filter((line) => line.includes('[errors]')),
		[],
		'no "unknown refusal family" line per malformed request'
	);
});

test('a NOT NULL the database enforces names its field, never an empty list', async () => {
	let err;
	try {
		await sequelize.query(
			"INSERT INTO `PenNames` (`userId`, `name`, `nameKey`, `createdAt`, `updatedAt`) VALUES (1, NULL, 'k', '2026-01-01', '2026-01-01')"
		);
	} catch (e) {
		err = e;
	}
	assert.ok(err, 'the database refused it');
	assert.deepEqual(ValidationError.messagesFrom(err), ['name is required.']);
	assert.deepEqual(ValidationError.problemsFrom(err), [{ field: 'name', code: 'required' }]);
});

test('every ValidationError in the code says which field and why', async () => {
	// A bare sentence answers `validation_failed` with no field, which a client
	// can only show as it is. #140 said none were left; a search that did not
	// allow for Prettier putting the sentence on the next line had missed 46.
	const { readdir, readFile } = await import('node:fs/promises');
	const sources = [];
	const walk = async (dir) => {
		for (const item of await readdir(dir, { withFileTypes: true })) {
			const full = dir + '/' + item.name;
			if (item.isDirectory()) {
				await walk(full);
			} else if (item.name.endsWith('.js')) {
				sources.push(full);
			}
		}
	};
	for (const dir of ['routes', 'services', 'database']) {
		await walk(dir);
	}
	const plain = [];
	for (const file of sources) {
		const text = await readFile(file, 'utf8');
		const lineOf = (index) => text.slice(0, index).split('\n').length;
		for (const call of text.matchAll(/new ValidationError\(\s*(\S)/g)) {
			const start = call[1];
			if (start === '{') {
				continue;
			}
			// A list built up first: every item pushed onto it must be an object.
			const list = /^(\w+)\)/.exec(text.slice(call.index + call[0].length - 1));
			const nested =
				file.endsWith('services/ValidationError.js') &&
				text.startsWith('messages.map', call.index + call[0].length - 1);
			// A list mapped straight to `{ message, field, code }` objects.
			const mapped = /^\w+\.map\(\(?\w*\)?\s*=>\s*\(\{/.test(
				text.slice(call.index + call[0].length - 1)
			);
			if (nested || mapped) {
				continue;
			}
			if (list) {
				const pushes = [...text.matchAll(new RegExp('\\b' + list[1] + '\\.push\\(\\s*(\\S)', 'g'))];
				const bad = pushes.filter((push) => push[1] !== '{');
				if (pushes.length > 0 && bad.length === 0) {
					continue;
				}
				for (const push of bad) {
					plain.push(file + ':' + lineOf(push.index));
				}
				if (pushes.length === 0) {
					plain.push(file + ':' + lineOf(call.index));
				}
				continue;
			}
			plain.push(file + ':' + lineOf(call.index));
		}
	}
	assert.deepEqual(plain, [], 'give each a field and a code (services/error-codes.js)');
});
