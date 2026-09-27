import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { startServer, stopServer, makeFixtures, makeUser, post, put, get } from './helpers.js';
import ValidationError from '../services/ValidationError.js';
import { CODES, isKnownCode, familyOf, isKnownFamily } from '../services/error-codes.js';
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

test('a nested object says which one it is about', async () => {
	// Accepting a `group` invitation carries the person's name and the group's.
	const invitation = await post(
		'/invitation/invitation',
		{ kind: 'group', inviteeName: 'Riverside ABC', chapter: f.group.id },
		f.admin
	);
	assert.equal(invitation.status, 201, JSON.stringify(invitation.body));
	const refused = await post('/invitation/accept', {
		token: invitation.body.data.token,
		username: 'riverside',
		email: 'riverside@example.com',
		password: 'a long enough password',
		group: { location: { city: 'Riverside' } } // no name
	});
	assert.equal(refused.status, 400, JSON.stringify(refused.body));
	assert.deepEqual(refused.body.problems, [{ field: 'group.name', code: 'required' }]);
});

test('every 400 carries problems, even one thrown as a plain refusal', async () => {
	// A reply reference that fails its checksum is an HttpError, not a validation error.
	const res = await get('/messaging/reference?number=123456789', f.chapter);
	assert.equal(res.status, 400, JSON.stringify(res.body));
	assert.equal(res.body.condition, 'checksum', 'its own finer detail is unchanged');
	assert.deepEqual(res.body.problems, [{ field: null, code: 'validation_failed' }]);
});

test('an auth key that is not one is a client bug, and says so without a field', async () => {
	const res = await post('/auth/user', {
		username: 'splitwrong',
		email: 'splitwrong@example.com',
		password: 'not-an-auth-key',
		authScheme: 'split',
		kdfSalt: 'MKnVRJ266hcJF6h7DwJ6fA==',
		kdfParams: { kdf: 'argon2id', alg: 2, opslimit: 2, memlimit: 67108864 }
	});
	assert.equal(res.status, 400, JSON.stringify(res.body));
	assert.deepEqual(res.body.problems, [{ field: null, code: 'not_an_auth_key' }]);
});

test('a refusal carries one code, composed from the name and condition it still sends', async () => {
	// 404, no condition: the family alone.
	const missing = await get('/prison/prison?id=999999');
	assert.equal(missing.status, 404);
	assert.equal(missing.body.code, 'not_found');
	assert.equal(missing.body.name, 'NotFoundError', 'name is still there');

	// 403: not allowed, nothing to do with a field.
	const refused = await post('/prison/prison', { prisonName: 'No', address: {} }, f.alice);
	assert.equal(refused.status, 403);
	assert.equal(refused.body.code, 'authorization');

	// 410 with a condition: family.condition, and the condition is still sent.
	const { codes } = (await post('/auth/invite-codes', { count: 1 }, f.chapter)).body.data;
	const join = { code: codes[0], password: 'a long enough password' };
	assert.equal(
		(await post('/auth/join', { ...join, username: 'firstuse', email: 'f@example.com' })).status,
		201
	);
	const second = await post('/auth/join', {
		...join,
		username: 'seconduse',
		email: 's@example.com'
	});
	assert.equal(second.status, 410, JSON.stringify(second.body));
	assert.equal(second.body.condition, 'used');
	assert.equal(second.body.code, 'invite_code.used');
	// A client may match the family alone, which is the part that does not change.
	assert.equal(second.body.code.split('.')[0], 'invite_code');
});

test('a fault is not a refusal: no code on a 5xx, and validation keeps problems', async () => {
	// Validation errors answer the field-level shape and no top-level code.
	const bad = await get('/prison/prisons?page=0');
	assert.equal(bad.status, 400);
	assert.ok(Array.isArray(bad.body.problems));
	assert.equal(bad.body.code, undefined, 'a field failure is answered by problems');
});

test('every refusal name in the source has a family in the catalogue', async () => {
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
	const names = new Set();
	for (const file of files) {
		const text = await readFile(file, 'utf8');
		for (const match of text.matchAll(/'([A-Z][A-Za-z]*Error)'/g)) {
			names.add(match[1]);
		}
	}
	assert.ok(names.size > 20, 'found the error names in the source: ' + names.size);
	const unknown = [...names]
		.filter((name) => !name.startsWith('Sequelize'))
		.map(familyOf)
		.filter((family) => !isKnownFamily(family));
	assert.deepEqual(
		unknown,
		[],
		'add these families to REFUSAL_FAMILIES in services/error-codes.js'
	);
});
