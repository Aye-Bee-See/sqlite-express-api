import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	makeFixtures,
	makeUser,
	agePenNames,
	get,
	post,
	put,
	del,
	User
} from './helpers.js';
import PenName from '../database/models/pen-name.model.js';
import AuditLog from '../database/models/audit-log.model.js';

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
	// Each change here would otherwise wait out the cooldown (its own test below).
	await agePenNames(who.id, 400);
	assert.equal((await put('/auth/user', { id: who.id, penName: 'Second Name' }, who)).status, 200);
	await agePenNames(who.id, 400);
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
	await agePenNames(who.id, 400);
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
	assert.equal((await User.findByPk(ok.body.data.user.id)).sponsoredBy, f.group.id);
});

test("a deleted account's names stay taken for ever, and two renames at once leave one current name", async () => {
	const leaver = await makeUser({ username: 'leaving', password: 'a long enough password' });
	await put('/auth/user', { id: leaver.id, penName: 'Gone Writer' }, leaver);
	const gone = await del(
		'/auth/user',
		{ id: leaver.id, password: 'a long enough password' },
		leaver
	);
	assert.equal(gone.status, 200, JSON.stringify(gone.body));
	const tomb = await PenName.findOne({ where: { nameKey: 'gone writer' } });
	assert.ok(tomb, 'the row outlives the account');
	assert.equal(tomb.userId, null);
	assert.equal(
		(await get('/auth/pen-name-available?name=gone%20writer')).body.data.available,
		false
	);
	const newcomer = await makeUser({ username: 'newcomer' });
	assert.equal(
		(await put('/auth/user', { id: newcomer.id, penName: 'Gone Writer' }, newcomer)).status,
		400
	);

	const racer = await makeUser({ username: 'racer' });
	const results = await Promise.all(
		['Race One', 'Race Two', 'Race Three'].map((penName) =>
			put('/auth/user', { id: racer.id, penName }, racer)
		)
	);
	assert.deepEqual(
		results.map((r) => r.status).sort(),
		[200, 409, 409],
		'the first name lands; the other two wait out the cooldown'
	);
	const current = await PenName.findAll({ where: { userId: racer.id, retiredAt: null } });
	assert.equal(current.length, 1, 'one current name');
	assert.equal(
		(await User.findByPk(racer.id)).penName,
		current[0].name,
		'the column names the current row'
	);
	assert.equal(
		await PenName.count({ where: { userId: racer.id } }),
		1,
		'a refused rename takes no name'
	);
	// Two accounts racing for one name: one gets it.
	const a = await makeUser({ username: 'racer-a' });
	const b = await makeUser({ username: 'racer-b' });
	const race = await Promise.all([
		put('/auth/user', { id: a.id, penName: 'Contested Name' }, a),
		put('/auth/user', { id: b.id, penName: 'Contested Name' }, b)
	]);
	assert.deepEqual(race.map((r) => r.status).sort(), [200, 400]);
	assert.equal(await PenName.count({ where: { nameKey: 'contested name' } }), 1);
});

test('a pen name changes at most once every 90 days, and takes at most two new names a year', async () => {
	const who = await makeUser({ username: 'restless' });
	// The name chosen first is not a change: it may be taken at once.
	assert.equal((await put('/auth/user', { id: who.id, penName: 'Ada Vale' }, who)).status, 200);
	const soon = await put('/auth/user', { id: who.id, penName: 'Ada Ridge' }, who);
	assert.equal(soon.status, 409, JSON.stringify(soon.body));
	assert.equal(soon.body.name, 'PenNameLimitError');
	assert.equal(soon.body.condition, 'cooldown');
	assert.match(soon.body.error, /once every 90 days/);
	assert.equal((await User.findByPk(who.id)).penName, 'Ada Vale', 'nothing changed');
	assert.equal(await PenName.count({ where: { userId: who.id } }), 1);

	// What the client shows before anyone types.
	const status = await get('/auth/pen-name', who);
	assert.equal(status.body.data.cooldownDays, 90);
	assert.equal(status.body.data.newPerYear, 2);
	assert.equal(status.body.data.newNamesLeft, 2, 'the name chosen at sign-up is not a change');
	assert.ok(new Date(status.body.data.changeAllowedAt) > new Date());

	// Past the cooldown, two new names are allowed, and the third is not.
	await agePenNames(who.id, 91);
	assert.equal((await put('/auth/user', { id: who.id, penName: 'Ada Ridge' }, who)).status, 200);
	await agePenNames(who.id, 91);
	assert.equal((await put('/auth/user', { id: who.id, penName: 'Ada Marsh' }, who)).status, 200);
	const spent = await get('/auth/pen-name', who);
	assert.equal(spent.body.data.newNamesLeft, 0);
	assert.ok(spent.body.data.newNamesWindowEnds, 'when a new name comes back');
	await agePenNames(who.id, 91);
	const fourth = await put('/auth/user', { id: who.id, penName: 'Ada Fell' }, who);
	assert.equal(fourth.status, 409, JSON.stringify(fourth.body));
	assert.equal(fourth.body.condition, 'new_names');
	assert.match(fourth.body.error, /2 new pen name\(s\) for the year/);
	assert.equal((await User.findByPk(who.id)).penName, 'Ada Marsh');
	assert.equal(
		(await get('/auth/pen-name-available?name=Ada%20Fell')).body.data.available,
		true,
		'a name that was refused was never taken'
	);

	// A name this account has used before takes nothing from anyone: allowed.
	assert.equal((await put('/auth/user', { id: who.id, penName: 'Ada Vale' }, who)).status, 200);
	assert.equal((await User.findByPk(who.id)).penName, 'Ada Vale');
	// Still one change at a time, even going back.
	const hurried = await put('/auth/user', { id: who.id, penName: 'Ada Ridge' }, who);
	assert.equal(hurried.status, 409);
	assert.match(hurried.body.error, /once every 90 days/);
});

test('staff rename past the limits: an admin for anyone, a group for the writers it looks after', async () => {
	const who = await makeUser({ username: 'harassed' });
	assert.equal((await put('/auth/user', { id: who.id, penName: 'Kit Marlow' }, who)).status, 200);
	assert.equal(
		(await put('/auth/user', { id: who.id, penName: 'Kit Sparrow' }, who)).status,
		409,
		'the writer waits'
	);
	const byAdmin = await put('/auth/user', { id: who.id, penName: 'Kit Sparrow' }, f.admin);
	assert.equal(byAdmin.status, 200, JSON.stringify(byAdmin.body));
	assert.equal((await User.findByPk(who.id)).penName, 'Kit Sparrow');
	assert.equal(
		(await AuditLog.count({ where: { action: 'user.penName', targetId: who.id } })) > 0,
		true,
		'an override is written down'
	);

	// A group renames one of its own unclaimed writers, twice over.
	const writer = await post('/auth/writer', { name: 'Robin', penName: 'Robin Ash' }, f.chapter);
	const id = writer.body.data.id;
	assert.equal((await put('/auth/user', { id, penName: 'Robin Birch' }, f.chapter)).status, 200);
	assert.equal((await put('/auth/user', { id, penName: 'Robin Cedar' }, f.chapter)).status, 200);
	assert.equal((await User.findByPk(id)).penName, 'Robin Cedar');
});
