import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	startServer,
	stopServer,
	makeFixtures,
	get,
	post,
	put,
	Prison,
	Prisoner,
	Chapter
} from './helpers.js';
import { hashToken, normalizeToken } from '../database/models/claim-token.model.js';
import ClaimToken from '../database/models/claim-token.model.js';

let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
});
after(stopServer);

test('an address may carry the exact lines to print, in the order the facility says', async () => {
	const ok = await post(
		'/prison/prison',
		{
			prisonName: 'IK-13, Nizhny Tagil',
			address: {
				street: 'ul. Kulibina, d. 61',
				city: 'Nizhny Tagil, Sverdlovsk Region',
				postalCode: '622013',
				lines: [
					'622013, Россия, Свердловская обл.',
					'г. Нижний Тагил, ул. Кулибина, д. 61',
					'ИК-13'
				]
			},
			country: 'Russia'
		},
		f.admin
	);
	assert.equal(ok.status, 201, JSON.stringify(ok.body));
	const read = await get('/prison/prison?id=' + ok.body.data.id);
	assert.deepEqual(read.body.data.address.lines, [
		'622013, Россия, Свердловская обл.',
		'г. Нижний Тагил, ул. Кулибина, д. 61',
		'ИК-13'
	]);
	for (const lines of [[], [''], 'one line', ['a', 2], Array(9).fill('x')]) {
		const bad = await post(
			'/prison/prison',
			{ prisonName: 'Bad', address: { street: 'x', lines }, country: 'Nowhere' },
			f.admin
		);
		assert.equal(bad.status, 400, JSON.stringify(lines));
		assert.match(bad.body.errors[0], /address.lines/);
	}
	const notObject = await post(
		'/prison/prison',
		{ prisonName: 'Bad', address: 'PO Box 1' },
		f.admin
	);
	assert.equal(notObject.status, 400);
	// Structured fields alone are still fine.
	assert.equal(
		(await post('/prison/prison', { prisonName: 'Plain', address: { street: '1 Main' } }, f.admin))
			.status,
		201
	);
});

test('the filter values a list page needs, with counts, over what the caller may see', async () => {
	const a = await Prison.createPrison({
		prisonName: 'Filter A',
		address: {},
		country: 'Belarus',
		routing: 'relay_only'
	});
	const b = await Prison.createPrison({
		prisonName: 'Filter B',
		address: {},
		country: 'Belarus',
		routing: 'direct'
	});
	const hidden = await Prison.createPrison({
		prisonName: 'Filter C',
		address: {},
		country: 'Narnia',
		routing: 'direct',
		recordStatus: 'pending'
	});
	await Prisoner.createPrisoner({
		birthName: 'P1',
		prison: a.id,
		country: 'Belarus',
		status: 'incarcerated'
	});
	await Prisoner.createPrisoner({
		birthName: 'P2',
		prison: b.id,
		country: 'Belarus',
		status: 'pretrial'
	});
	await Prisoner.createPrisoner({
		birthName: 'P3',
		prison: hidden.id,
		country: 'Narnia',
		status: 'free',
		recordStatus: 'draft'
	});

	const pub = await get('/prisoner/filters');
	assert.equal(pub.status, 200, JSON.stringify(pub.body));
	assert.deepEqual(Object.keys(pub.body.data), ['country', 'status']);
	const country = Object.fromEntries(pub.body.data.country.map((v) => [v.value, v.count]));
	assert.equal(country.Belarus, 2);
	assert.equal(country.Narnia, undefined, 'a draft record is not counted for the public');
	const statuses = Object.fromEntries(pub.body.data.status.map((v) => [v.value, v.count]));
	assert.deepEqual(
		[statuses.incarcerated >= 1, statuses.pretrial, statuses.free],
		[true, 1, undefined]
	);
	assert.ok(pub.body.data.country.every((v) => v.value !== null));
	// Staff see the unpublished ones too, sorted by count then value.
	const staff = await get('/prisoner/filters', f.chapter);
	assert.equal(
		Object.fromEntries(staff.body.data.country.map((v) => [v.value, v.count])).Narnia,
		1
	);
	const counts = staff.body.data.country.map((v) => v.count);
	assert.deepEqual(
		counts,
		[...counts].sort((x, y) => y - x)
	);

	const prisons = await get('/prison/filters');
	assert.deepEqual(Object.keys(prisons.body.data), ['country', 'routing']);
	const routing = Object.fromEntries(prisons.body.data.routing.map((v) => [v.value, v.count]));
	assert.equal(routing.relay_only, 1);
	assert.ok(!prisons.body.data.country.some((v) => v.value === 'Narnia'));
	assert.ok(
		(await get('/prison/filters', f.admin)).body.data.country.some((v) => v.value === 'Narnia')
	);
});

test('a group page embeds where each supported prisoner is held', async () => {
	await put(
		'/prisoner/support',
		{ prisoner: f.prisoner1.id, chapter: f.group.id, description: 'Pen pals' },
		f.admin
	);
	const page = await get('/chapter/chapter?id=' + f.group.id + '&full=true');
	assert.equal(page.status, 200, JSON.stringify(page.body));
	const [supported] = page.body.data.supported_prisoners;
	assert.equal(supported.id, f.prisoner1.id);
	assert.deepEqual(supported.prison_details, {
		id: f.prison.id,
		prisonName: 'Test Prison',
		country: f.prison.country ?? null
	});
	// A facility the public may not see comes back null, not leaked.
	await Prison.update({ recordStatus: 'pending' }, { where: { id: f.prison.id } });
	const later = await get('/chapter/chapter?id=' + f.group.id + '&full=true');
	assert.equal(later.body.data.supported_prisoners.length, 1);
	assert.equal(later.body.data.supported_prisoners[0].prison_details, null);
	assert.ok(
		(await get('/chapter/chapter?id=' + f.group.id + '&full=true', f.admin)).body.data
			.supported_prisoners[0].prison_details
	);
	await Prison.update({ recordStatus: 'published' }, { where: { id: f.prison.id } });
	assert.equal(Chapter.name, 'Chapter');
});

test('a typed code is the same code however it was typed: case, dashes, spaces, and look-alikes', () => {
	const token = 'A1B2C3D4E5F6G7H8J9K0M1N2';
	for (const typed of [
		token,
		token.toLowerCase(),
		'a1b2-c3d4-e5f6-g7h8-j9k0-m1n2',
		' A1B2 C3D4 E5F6 G7H8 J9K0 M1N2 ',
		'A1B2C3D4E5F6G7H8J9K0M1N2'.replace(/0/g, 'O').replace(/1/g, 'l')
	]) {
		assert.equal(normalizeToken(typed), token, typed);
		assert.equal(hashToken(typed), hashToken(token), typed);
	}
	assert.equal(normalizeToken('ii-ll-oo'), '111100');
	assert.equal(ClaimToken.name, 'ClaimToken');
});
