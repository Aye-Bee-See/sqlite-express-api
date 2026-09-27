import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeFixtures, get, post, put, upload } from './helpers.js';

// Sequelize writes a lookup's value into the SQL text, and SQLite stops reading
// at a NUL: the quoted value was left open, and every endpoint that looked a
// record up answered 500 to `?id=%00`. A NUL is refused before any route runs.
let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
});
after(stopServer);

const refused = (res, field, what) => {
	assert.equal(res.status, 400, what + ': ' + JSON.stringify(res.body));
	assert.deepEqual(res.body.problems, [
		{ field, code: 'wrong_type', params: { expected: 'text without NUL characters' } }
	]);
};

test('a NUL in a query parameter is a 400, on every lookup that was a 500', async () => {
	for (const path of [
		'/prisoner/prisoner?id=%00',
		'/prisoner/prisoner?id=1%00',
		'/prison/prison?id=%00',
		'/chapter/chapter?id=%00',
		'/prisoner/history?id=%00',
		'/prisoner/photo?prisoner=%00',
		'/chat/chat?id=%00',
		'/messaging/message?id=%00',
		'/auth/user?id=%00'
	]) {
		refused(await get(path, f.admin), path.includes('photo') ? 'prisoner' : 'id', path);
	}
	refused(await get('/prisoner/prisoners?q=a%00b'), 'q', 'a search');
});

test('in a JSON body, however deep, and in a multipart field', async () => {
	refused(
		await put('/prisoner/prisoner', { id: f.prisoner1.id, interests: ['ok', 'b\u0000d'] }, f.admin),
		'interests.1',
		'nested'
	);
	refused(await post('/auth/login', { username: 'x\u0000', password: 'y' }), 'username', 'sign-in');
	// A key rotation parses its own (larger) body, after the app-wide check.
	refused(
		await post('/auth/chapter-rotation', { chapter: '1\u0000' }, f.chapter),
		'chapter',
		'rotation'
	);
	const file = { name: 'p.png', type: 'image/png', bytes: Buffer.from('not checked') };
	refused(
		await upload(
			'/prisoner/photo',
			{ fields: { prisoner: '1\u0000' }, file, field: 'photo' },
			f.admin
		),
		'prisoner',
		'multipart'
	);
});

test('everything else is untouched', async () => {
	assert.equal((await get('/prisoner/prisoner?id=' + f.prisoner1.id)).status, 200);
	assert.equal((await get('/prisoner/prisoners?q=one')).status, 200);
});
