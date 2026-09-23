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
	User,
	Chapter
} from './helpers.js';
import PenName from '../database/models/pen-name.model.js';

let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
});
after(stopServer);

test('a pen name is chosen at sign-up, site-unique whatever the case or spacing, and shown on the account', async () => {
	const free = await get('/auth/pen-name-available?name=James%20Hollow');
	assert.equal(free.status, 200, JSON.stringify(free.body));
	assert.deepEqual(free.body.data, {
		available: true,
		name: 'James Hollow',
		reason: null,
		twoParts: true
	});
	const made = await post(
		'/auth/user',
		{
			username: 'jamesh',
			email: 'j@example.com',
			password: 'a long enough password',
			penName: 'James  Hollow'
		},
		f.admin
	);
	assert.equal(made.status, 201, JSON.stringify(made.body));
	assert.equal(made.body.data.penName, 'James Hollow', 'one space between words');
	const taken = await get('/auth/pen-name-available?name=JAMES%20HOLLOW');
	assert.equal(taken.body.data.available, false);
	assert.match(taken.body.data.reason, /taken/);
	const again = await post(
		'/auth/user',
		{
			username: 'other',
			email: 'o@example.com',
			password: 'a long enough password',
			penName: 'james hollow'
		},
		f.admin
	);
	assert.equal(again.status, 400, JSON.stringify(again.body));
	assert.match(again.body.errors[0], /taken/);
	assert.equal(await User.count({ where: { username: 'other' } }), 0, 'nothing was made');
	const single = await get('/auth/pen-name-available?name=Hollow');
	assert.deepEqual([single.body.data.available, single.body.data.twoParts], [true, false]);
});

test('the shape of a pen name', async () => {
	for (const [name, why] of [
		['Jo', /between 3 and 40/],
		['x'.repeat(41), /between 3 and 40/],
		['123 Main', /starts with a letter/],
		['James <b>', /letters, digits/],
		['writer@home', /letters, digits/]
	]) {
		const check = await get('/auth/pen-name-available?name=' + encodeURIComponent(name));
		assert.equal(check.body.data.available, false, name);
		assert.match(check.body.data.reason, why);
	}
	assert.equal(
		(await get('/auth/pen-name-available?name=' + encodeURIComponent("Zoë O'Brien-Núñez"))).body
			.data.available,
		true
	);
	assert.equal(
		(await get('/auth/pen-name-available?name=' + encodeURIComponent('Лена Иванова'))).body.data
			.available,
		true
	);
	const bad = await post(
		'/auth/user',
		{ username: 'shape', email: 's@example.com', password: 'a long enough password', penName: 42 },
		f.admin
	);
	assert.equal(bad.status, 400);
	assert.match(bad.body.errors[0], /must be text/);
});

test('a pen name can change; old names are kept for ever, come back to their owner, and never go to anyone else', async () => {
	const who = await makeUser({ username: 'renamer' });
	assert.equal((await put('/auth/user', { id: who.id, penName: 'First Name' }, who)).status, 200);
	assert.equal((await put('/auth/user', { id: who.id, penName: 'Second Name' }, who)).status, 200);
	assert.equal((await User.findByPk(who.id)).penName, 'Second Name');
	const history = await get('/auth/pen-name', who);
	assert.equal(history.status, 200, JSON.stringify(history.body));
	assert.equal(history.body.data.penName, 'Second Name');
	assert.deepEqual(
		history.body.data.names.map((n) => [n.name, n.current]),
		[
			['Second Name', true],
			['First Name', false]
		]
	);
	// Somebody else cannot take the old name; its owner can return to it.
	assert.equal(
		(await get('/auth/pen-name-available?name=first%20name')).body.data.available,
		false
	);
	assert.equal(
		(await get('/auth/pen-name-available?name=first%20name', who)).body.data.available,
		true,
		'their own old name'
	);
	const stranger = await makeUser({ username: 'stranger' });
	const grab = await put('/auth/user', { id: stranger.id, penName: 'First Name' }, stranger);
	assert.equal(grab.status, 400, JSON.stringify(grab.body));
	assert.equal((await put('/auth/user', { id: who.id, penName: 'first name' }, who)).status, 200);
	assert.equal(
		(await User.findByPk(who.id)).penName,
		'First Name',
		'the spelling it was first given'
	);
	const back = await get('/auth/pen-name', who);
	assert.deepEqual(
		back.body.data.names.map((n) => [n.name, n.current]),
		[
			['First Name', true],
			['Second Name', false]
		]
	);
	// Setting the same name again is not a change.
	await put('/auth/user', { id: who.id, penName: 'First Name' }, who);
	assert.equal(await PenName.count({ where: { userId: who.id } }), 2);
	// The column is never written around the history.
	await put('/auth/user', { id: who.id, name: 'Display' }, who);
	assert.equal((await User.findByPk(who.id)).penName, 'First Name');
});

test('a group gives its managed writers a pen name, and a newcomer joins with one', async () => {
	const writer = await post('/auth/writer', { name: 'Sam', penName: 'Sam Rivers' }, f.chapter);
	assert.equal(writer.status, 201, JSON.stringify(writer.body));
	assert.equal(writer.body.data.penName, 'Sam Rivers');
	const renamed = await put(
		'/auth/user',
		{ id: writer.body.data.id, penName: 'Sam Brook' },
		f.chapter
	);
	assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
	assert.equal((await User.findByPk(writer.body.data.id)).penName, 'Sam Brook');
	// Not somebody else's writer, and not a writer's own pen name by another writer.
	assert.equal(
		(await put('/auth/user', { id: writer.body.data.id, penName: 'X Y' }, f.alice)).status,
		403
	);
	const { codes } = (await post('/auth/invite-codes', { count: 1 }, f.chapter)).body.data;
	const joined = await post('/auth/join', {
		code: codes[0],
		username: 'joiner',
		password: 'a long enough password',
		penName: 'Sam Rivers'
	});
	assert.equal(joined.status, 400, 'the writer used it once: never given out again');
	const ok = await post('/auth/join', {
		code: codes[0],
		username: 'joiner',
		password: 'a long enough password',
		penName: 'River Song'
	});
	assert.equal(ok.status, 201, JSON.stringify(ok.body));
	assert.equal(ok.body.data.user.penName, 'River Song');
	assert.equal(await Chapter.count(), await Chapter.count());
});
