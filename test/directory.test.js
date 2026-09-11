import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, get, post, put, del, makeFixtures } from './helpers.js';

let f;
let t;
before(async () => {
	await startServer();
	f = await makeFixtures();
	t = { token: f.admin.token };
});
after(stopServer);

test('prison create, read, update, delete', async () => {
	const created = await post(
		'/prison/prison',
		{ prisonName: 'Alpha', address: { street: '1' } },
		t
	);
	assert.equal(created.status, 201);
	assert.equal(created.body.name, 'prison create');
	assert.equal(created.body.info, 'Successfully created prison');
	const id = created.body.data.id;
	assert.deepEqual(Object.keys(created.body.data).sort(), [
		'address',
		'createdAt',
		'id',
		'prisonName',
		'updatedAt'
	]);

	const one = await get('/prison/prison?id=' + id, t);
	assert.equal(one.status, 200);
	assert.equal(one.body.data.prisonName, 'Alpha');

	const updated = await put('/prison/prison', { id, prisonName: 'Alpha Renamed' }, t);
	assert.equal(updated.status, 200);
	assert.deepEqual(updated.body.data.updatedRows, [1]);
	assert.equal(updated.body.data.newPrison.prisonName, 'Alpha Renamed');

	const removed = await del('/prison/prison', { id }, t);
	assert.equal(removed.status, 200);
	assert.equal(removed.body.data, 1);
	assert.equal((await get('/prison/prison?id=' + id, t)).status, 404);
});

test('missing records are 404 on read, update, and delete, with the general error shape', async () => {
	const read = await get('/prison/prison?id=999999', t);
	assert.equal(read.status, 404);
	assert.equal(read.body.name, 'NotFoundError');
	assert.equal(read.body.error, 'Prison 999999 not found');
	assert.equal((await put('/prison/prison', { id: 999999, prisonName: 'Z' }, t)).status, 404);
	assert.equal((await del('/prison/prison', { id: 999999 }, t)).status, 404);
	assert.equal((await get('/prisoner/prisoner?id=999999', t)).status, 404);
	assert.equal((await get('/rule/rule?id=999999', t)).status, 404);
	assert.equal((await get('/chapter/chapter?id=999999', t)).status, 404);
});

test('path-style ids and unknown routes are JSON 404s', async () => {
	const res = await get('/prison/prison/1', t);
	assert.equal(res.status, 404);
	assert.equal(res.body.name, 'NotFoundError');
	assert.equal(res.body.info, 'Cannot GET /prison/prison/1');
});

test('validation failures return the errors array', async () => {
	const res = await post('/prison/prison', { address: {} }, t);
	assert.equal(res.status, 400);
	assert.deepEqual(res.body, { success: false, errors: ['Prison.prisonName cannot be null'] });
});

test('pagination is validated and applied', async () => {
	for (let i = 0; i < 5; i++) {
		await post('/prison/prison', { prisonName: 'Page ' + i, address: {} }, t);
	}
	const page1 = await get('/prison/prisons?page_size=2', t);
	const page2 = await get('/prison/prisons?page=2&page_size=2', t);
	assert.equal(page1.body.data.length, 2);
	assert.equal(page2.body.data.length, 2);
	assert.notEqual(page1.body.data[0].id, page2.body.data[0].id);
	const blank = await get('/prison/prisons?page=&page_size=', t);
	assert.equal(blank.status, 200);

	const bad = await get('/prison/prisons?page=0&page_size=abc', t);
	assert.equal(bad.status, 400);
	assert.deepEqual(bad.body.errors, [
		'page must be a positive integer.',
		'page_size must be an integer between 1 and 100.'
	]);
	assert.equal((await get('/prison/prisons?page_size=101', t)).status, 400);
	assert.equal((await get('/prison/prisons?page=1.5', t)).status, 400);
});

test('prisoner status is validated on create and update', async () => {
	const bad = await post(
		'/prisoner/prisoner',
		{ birthName: 'S', prison: f.prison.id, status: 'escaped' },
		t
	);
	assert.equal(bad.status, 400);
	assert.deepEqual(bad.body.errors, ['Status must be pretrial, incarcerated, or free.']);
	const ok = await post(
		'/prisoner/prisoner',
		{ birthName: 'S', prison: f.prison.id, status: 'free' },
		t
	);
	assert.equal(ok.status, 201);
	assert.equal(
		(await put('/prisoner/prisoner', { id: ok.body.data.id, status: 'bogus' }, t)).status,
		400
	);
	assert.equal(
		(await put('/prisoner/prisoner', { id: ok.body.data.id, status: 'pretrial' }, t)).status,
		200
	);
});

test('prisoners can be listed by prison, and an unknown prison is a 404', async () => {
	const res = await get('/prisoner/prisoners?prison=' + f.prison.id, t);
	assert.equal(res.status, 200);
	assert.ok(res.body.data.length >= 2);
	assert.ok(res.body.data.every((p) => p.prison === f.prison.id));
	const missing = await get('/prisoner/prisoners?prison=999999', t);
	assert.equal(missing.status, 404);
	assert.equal(missing.body.error, 'Prison 999999 not found');
});

test('full=true embeds real related rows and no phantom columns', async () => {
	const prisoners = await get('/prisoner/prisoners?full=true&page_size=1', t);
	const row = prisoners.body.data[0];
	assert.equal(row.prison_details.id, f.prison.id);
	assert.equal(row.prisonId, undefined);

	const prison = await get('/prison/prison?id=' + f.prison.id + '&full=true', t);
	assert.ok(Array.isArray(prison.body.data.prisoners));
	assert.ok(prison.body.data.prisoners.length >= 2);
	assert.ok(Array.isArray(prison.body.data.rules));
});

test('rules attach to prisons idempotently and show up from both sides', async () => {
	const attach = await put('/prison/rule', { rule: f.rule.id, prison: f.prison.id }, t);
	assert.equal(attach.status, 200);
	assert.equal(attach.body.name, 'prison addRule');
	assert.deepEqual(
		attach.body.data.updatedRows.rules.map((r) => r.id),
		[f.rule.id]
	);
	const again = await put('/prison/rule', { rule: f.rule.id, prison: f.prison.id }, t);
	assert.equal(again.body.data.updatedRows.rules.length, 1);

	const byPrison = await get('/rule/rules?prison=' + f.prison.id, t);
	assert.deepEqual(
		byPrison.body.data.map((r) => r.id),
		[f.rule.id]
	);
	const ruleFull = await get('/rule/rule?id=' + f.rule.id + '&full=true', t);
	assert.deepEqual(
		ruleFull.body.data.prisons.map((p) => p.id),
		[f.prison.id]
	);
	const prisonFull = await get('/prison/prison?id=' + f.prison.id + '&full=true', t);
	assert.equal(prisonFull.body.data.rules[0].title, 'No pictures');

	const badRule = await put('/prison/rule', { rule: 999999, prison: f.prison.id }, t);
	assert.equal(badRule.status, 404);
	assert.equal(badRule.body.error, 'Rule 999999 not found');
});

test('deleting a rule removes its links; deleting a prison with prisoners is refused', async () => {
	const rule = await post('/rule/rule', { title: 'Temp', description: 'd' }, t);
	await put('/prison/rule', { rule: rule.body.data.id, prison: f.prison.id }, t);
	assert.equal((await del('/rule/rule', { id: rule.body.data.id }, t)).status, 200);
	const prisonFull = await get('/prison/prison?id=' + f.prison.id + '&full=true', t);
	assert.ok(!prisonFull.body.data.rules.some((r) => r.id === rule.body.data.id));

	const refused = await del('/prison/prison', { id: f.prison.id }, t);
	assert.equal(refused.status, 400);
	assert.equal(refused.body.name, 'SequelizeForeignKeyConstraintError');
	assert.equal((await get('/prison/prison?id=' + f.prison.id, t)).status, 200);
});

test('a prisoner cannot point at a nonexistent prison', async () => {
	const res = await post('/prisoner/prisoner', { birthName: 'Orphan', prison: 999999 }, t);
	assert.equal(res.status, 400);
	assert.equal(res.body.name, 'SequelizeForeignKeyConstraintError');
});

test('chapter create, list, read, update, delete', async () => {
	const created = await post(
		'/chapter/chapter',
		{ name: 'Doc Chapter', location: { city: 'X' } },
		t
	);
	assert.equal(created.status, 201);
	const id = created.body.data.id;
	const list = await get('/chapter/chapters', t);
	assert.ok(list.body.data.some((c) => c.id === id));
	assert.equal((await get('/chapter/chapter?id=' + id, t)).body.data.name, 'Doc Chapter');
	const updated = await put('/chapter/chapter', { id, lettersSent: '12', averageTimeDays: 5 }, t);
	assert.equal(updated.status, 200);
	assert.equal((await get('/chapter/chapter?id=' + id, t)).body.data.averageTimeDays, 5);
	assert.equal((await del('/chapter/chapter', { id }, t)).status, 200);
	assert.equal((await del('/chapter/chapter', { id }, t)).status, 404);
});
