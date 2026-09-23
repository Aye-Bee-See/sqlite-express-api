import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, get, post, put, del, makeFixtures } from './helpers.js';

let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
});
after(stopServer);

const prisonBody = { prisonName: 'Gate Test', address: { street: '2 Side' } };

test('any authenticated role can read directory resources', async () => {
	for (const who of [f.alice, f.chapter, f.admin]) {
		for (const path of [
			'/prison/prisons',
			'/prisoner/prisoners',
			'/prison/mail-rules',
			'/chapter/chapters'
		]) {
			assert.equal((await get(path, { token: who.token })).status, 200, who.user.role + ' ' + path);
		}
	}
});

test('the user role cannot write directory resources', async () => {
	const t = { token: f.alice.token };
	assert.equal((await post('/prison/prison', prisonBody, t)).status, 403);
	assert.equal((await put('/prison/prison', { id: f.prison.id, prisonName: 'X' }, t)).status, 403);
	assert.equal((await del('/prison/prison', { id: f.prison.id }, t)).status, 403);
	assert.equal(
		(await post('/prisoner/prisoner', { birthName: 'Z', prison: f.prison.id }, t)).status,
		403
	);
	assert.equal(
		(await put('/prison/prison', { id: f.prison.id, mailRules: ['no_photos'] }, t)).status,
		403
	);
	assert.equal((await post('/chapter/chapter', { name: 'c', location: {} }, t)).status, 403);
	assert.equal((await del('/chapter/chapter', { id: 1 }, t)).status, 403);
});

test('a general error carries a condition only when the refusal has a code', async () => {
	const missing = await get('/prison/prison?id=999999', { token: f.alice.token });
	assert.equal(missing.status, 404);
	assert.equal(missing.body.condition, undefined, 'the general case has no code');
});

test('a 403 uses the general error shape', async () => {
	const res = await post('/prison/prison', prisonBody, { token: f.alice.token });
	assert.deepEqual(res.body, {
		success: false,
		name: 'AuthorizationError',
		info: 'Forbidden',
		status: 403
	});
});

test('only admins write directory records; a chapter proposes instead', async () => {
	const created = await post('/prison/prison', { prisonName: 'By admin', address: {} }, f.admin);
	assert.equal(created.status, 201);
	for (const call of [
		() => post('/prison/prison', { prisonName: 'By chapter', address: {} }, f.chapter),
		() => put('/prison/prison', { id: created.body.data.id, notes: 'x' }, f.chapter),
		() => del('/prison/prison', { id: created.body.data.id }, f.chapter),
		() => post('/prisoner/prisoner', { birthName: 'X', prison: created.body.data.id }, f.chapter),
		() => put('/prisoner/prisoner', { id: f.prisoner1.id, chosenName: 'X' }, f.chapter),
		() => del('/prisoner/prisoner', { id: f.prisoner1.id }, f.chapter)
	]) {
		assert.equal((await call()).status, 403);
	}
	const proposed = await post(
		'/moderation/submission',
		{ resource: 'prison', target: created.body.data.id, fields: { notes: 'Mail is slow' } },
		f.chapter
	);
	assert.equal(proposed.status, 201, JSON.stringify(proposed.body));
	assert.equal((await del('/prison/prison', { id: created.body.data.id }, f.admin)).status, 200);
});

test('listing users is admin-only', async () => {
	assert.equal((await get('/auth/users', { token: f.alice.token })).status, 403);
	assert.equal((await get('/auth/users', { token: f.chapter.token })).status, 403);
	assert.equal((await get('/auth/users', { token: f.admin.token })).status, 200);
});

test('a user may read only their own record; an admin may read anyone', async () => {
	const own = await get('/auth/user?id=' + f.alice.id, { token: f.alice.token });
	assert.equal(own.status, 200);
	assert.equal(own.body.data.username, 'alice');
	assert.equal((await get('/auth/user?username=alice', { token: f.alice.token })).status, 200);
	assert.equal(
		(await get('/auth/user?email=alice@example.com', { token: f.alice.token })).status,
		200
	);
	assert.equal((await get('/auth/user?id=' + f.bob.id, { token: f.alice.token })).status, 403);
	assert.equal((await get('/auth/user?username=bob', { token: f.alice.token })).status, 403);
	assert.equal(
		(await get('/auth/user?email=bob@example.com', { token: f.alice.token })).status,
		403
	);
	assert.equal((await get('/auth/user?id=' + f.bob.id, { token: f.admin.token })).status, 200);
});

test('a user may update and delete only their own record and may not change role', async () => {
	const a = { token: f.alice.token };
	assert.equal((await put('/auth/user', { id: f.alice.id, name: 'Alice Updated' }, a)).status, 200);
	assert.equal((await put('/auth/user', { id: f.alice.id, role: 'admin' }, a)).status, 403);
	assert.equal((await put('/auth/user', { id: f.bob.id, name: 'pwned' }, a)).status, 403);
	assert.equal((await del('/auth/user', { id: f.bob.id }, a)).status, 403);
	assert.equal((await del('/auth/user', {}, a)).status, 403);
	const stillBob = await get('/auth/user?id=' + f.bob.id, { token: f.admin.token });
	assert.equal(stillBob.body.data.name, null);
});

test('an admin may change roles', async () => {
	const res = await put('/auth/user', { id: f.bob.id, role: 'chapter' }, { token: f.admin.token });
	assert.equal(res.status, 200);
	const bob = await get('/auth/user?id=' + f.bob.id, { token: f.admin.token });
	assert.equal(bob.body.data.role, 'chapter');
	await put('/auth/user', { id: f.bob.id, role: 'user' }, { token: f.admin.token });
});
