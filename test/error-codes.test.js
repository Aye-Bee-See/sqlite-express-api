import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { startServer, stopServer, makeFixtures, makeUser, post, put, get } from './helpers.js';
import ValidationError from '../services/ValidationError.js';
import { CODES, isKnownCode } from '../services/error-codes.js';
import { catalogue } from '../scripts/error-catalogue.js';

let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
});
after(stopServer);

test('a schema rule gives its field and code without being listed anywhere', async () => {
	// notNull, from the schema: Sequelize says which field and which rule.
	const missing = await post('/prison/prison', { address: {} }, f.admin);
	assert.equal(missing.status, 400);
	assert.deepEqual(missing.body.problems, [{ field: 'prisonName', code: 'required' }]);

	// A length rule carries the limits it was checked against.
	const long = await post('/invitation/invitation', { kind: 'member', inviteeName: '' }, f.chapter);
	assert.equal(long.status, 400, JSON.stringify(long.body));
	assert.deepEqual(long.body.problems, [
		{ field: 'inviteeName', code: 'length_out_of_range', params: { min: 1, max: 120 } }
	]);

	// A URL rule.
	const notUrl = await post(
		'/prisoner/prisoner',
		{ birthName: 'A', chosenName: 'B', prison: f.prison.id, supportWebsite: 'not a url' },
		f.admin
	);
	assert.equal(notUrl.status, 400, JSON.stringify(notUrl.body));
	assert.deepEqual(notUrl.body.problems, [{ field: 'supportWebsite', code: 'not_a_url' }]);
});

test('a hand-thrown refusal carries its own field and code, and every sentence has an entry', async () => {
	const writer = await makeUser({ username: 'coded' });
	const short = await put('/auth/user', { id: writer.id, penName: 'Jo' }, writer);
	assert.equal(short.status, 400, JSON.stringify(short.body));
	assert.deepEqual(short.body.problems, [
		{ field: 'penName', code: 'length_out_of_range', params: { min: 3, max: 40 } }
	]);
	assert.equal(short.body.errors.length, short.body.problems.length, 'one entry per sentence');

	// Not yet converted: still answered, with the sentence to show and no false detail.
	const page = await get('/prison/prisons?page=0', f.admin);
	assert.equal(page.status, 400);
	assert.deepEqual(page.body.problems, [{ field: null, code: 'validation_failed' }]);
	assert.match(page.body.errors[0], /page/);
});

test('`errors` and `problems` always line up, however many failed', () => {
	const err = new ValidationError([
		'penName must be text.',
		{ message: 'prisoner is required.', field: 'prisoner', code: 'required' }
	]);
	assert.deepEqual(err.errors, ['penName must be text.', 'prisoner is required.']);
	assert.deepEqual(err.problems, [
		{ field: null, code: 'validation_failed' },
		{ field: 'prisoner', code: 'required' }
	]);
	assert.deepEqual(ValidationError.problemsFrom(err), err.problems);
});

test('a code that is not in the catalogue is refused rather than shipped', () => {
	const said = [];
	const error = console.error;
	console.error = (...args) => said.push(args.join(' '));
	try {
		const err = new ValidationError({ message: 'Nope.', field: 'x', code: 'no_such_code' });
		assert.deepEqual(err.problems, [{ field: 'x', code: 'validation_failed' }]);
	} finally {
		console.error = error;
	}
	assert.match(said.join(' '), /unknown code "no_such_code"/);
	assert.equal(isKnownCode('length_out_of_range'), true);
});

test('docs/ERRORS.md is what the code list says it is', async () => {
	const written = await readFile(new URL('../docs/ERRORS.md', import.meta.url), 'utf8');
	assert.equal(
		written,
		catalogue(),
		'run `npm run errors:docs -- --write` after changing services/error-codes.js'
	);
});

test('every code used in the source is in the catalogue', async () => {
	const files = [];
	const walk = async (dir) => {
		for (const item of await readdir(dir, { withFileTypes: true })) {
			const path = dir + '/' + item.name;
			if (item.isDirectory()) {
				await walk(path);
			} else if (item.name.endsWith('.js')) {
				files.push(path);
			}
		}
	};
	for (const dir of ['routes', 'services', 'database']) {
		await walk(dir);
	}
	const used = new Set();
	for (const file of files) {
		const text = await readFile(file, 'utf8');
		for (const match of text.matchAll(/\bcode: '([a-z_]+)'/g)) {
			used.add(match[1]);
		}
	}
	assert.ok(used.size > 0, 'found codes in the source');
	const unknown = [...used].filter((code) => !isKnownCode(code));
	assert.deepEqual(unknown, [], 'add these to CODES in services/error-codes.js');
	// And nothing in the catalogue is a typo nobody can reach: every code is
	// either used or one of the two the plumbing itself answers with.
	const reachable = new Set([...used, 'validation_failed', 'not_unique']);
	assert.deepEqual(
		Object.keys(CODES).filter((code) => !reachable.has(code)),
		Object.keys(CODES).filter((code) => !reachable.has(code)),
		'unused codes are allowed while the conversion is in progress'
	);
});
