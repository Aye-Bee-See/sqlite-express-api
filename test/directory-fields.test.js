import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, get, post, put, del, makeFixtures, Chapter } from './helpers.js';

let f;
let admin;
let user;
let group;
let draftGroup;
before(async () => {
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
	user = { token: f.alice.token };
	group = await Chapter.createChapter({
		name: 'Portland ABC',
		location: {},
		country: 'United States',
		subregion: 'Portland, OR',
		services: ['letter_collection', 'domestic_mailing']
	});
	draftGroup = await Chapter.createChapter({
		name: 'Secret Cell',
		location: {},
		recordStatus: 'draft',
		services: ['international_relay']
	});
});
after(stopServer);

test('prisoners accept the new profile fields and validate the structured ones', async () => {
	const created = await post(
		'/prisoner/prisoner',
		{
			birthName: 'Ales Bialiatski',
			chosenName: 'Ales',
			aliases: ['Алесь Бяляцкі', 'Ales Byalyatski'],
			prison: f.prison.id,
			country: 'Belarus',
			detainedSince: '2021-07-14T00:00:00.000Z',
			sentence: '10 years',
			charges: 'Tax evasion',
			estimatedRelease: '2033',
			interests: ['human rights', 'poetry'],
			supportWebsite: 'https://spring96.org/en',
			donationInfo: 'Via Viasna',
			statusNotice: 'On hunger strike',
			featured: true,
			verifiedBy: group.id,
			verifiedAt: '2026-06-12T00:00:00.000Z',
			verificationNotes: 'Confirmed by family',
			status: 'incarcerated'
		},
		admin
	);
	assert.equal(created.status, 201, JSON.stringify(created.body));
	const p = created.body.data;
	assert.deepEqual(p.aliases, ['Алесь Бяляцкі', 'Ales Byalyatski']);
	assert.deepEqual(p.interests, ['human rights', 'poetry']);
	assert.equal(p.featured, true);
	assert.equal(p.verifiedBy, group.id);
	assert.equal(p.estimatedRelease, '2033');

	const badArray = await post('/prisoner/prisoner', { birthName: 'X', interests: 'poetry' }, admin);
	assert.equal(badArray.status, 400);
	assert.deepEqual(badArray.body.errors, ['Interests must be an array of non-empty strings.']);
	const badUrl = await post(
		'/prisoner/prisoner',
		{ birthName: 'X', supportWebsite: 'not a url' },
		admin
	);
	assert.equal(badUrl.status, 400);
	assert.ok(badUrl.body.errors[0].startsWith('Support website'));
	const badVerifier = await post(
		'/prisoner/prisoner',
		{ birthName: 'X', verifiedBy: 999999 },
		admin
	);
	assert.equal(badVerifier.status, 400);
	assert.equal(badVerifier.body.name, 'SequelizeForeignKeyConstraintError');
	const defaults = await post('/prisoner/prisoner', { birthName: 'Plain' }, admin);
	assert.equal(defaults.body.data.featured, false);
});

test('verification notes are staff-only; everything else is public', async () => {
	const created = await post(
		'/prisoner/prisoner',
		{ birthName: 'Noted', prison: f.prison.id, verificationNotes: 'internal', charges: 'public' },
		admin
	);
	const id = created.body.data.id;
	for (const who of [{}, user]) {
		const one = await get('/prisoner/prisoner?id=' + id, who);
		assert.equal(one.body.data.verificationNotes, undefined);
		assert.equal(one.body.data.charges, 'public');
		const list = await get('/prisoner/prisoners?page_size=100', who);
		assert.ok(list.body.data.every((p) => p.verificationNotes === undefined));
		const embedded = await get('/prison/prison?id=' + f.prison.id + '&full=true', who);
		assert.ok(embedded.body.data.prisoners.every((p) => p.verificationNotes === undefined));
	}
	const staff = await get('/prisoner/prisoner?id=' + id, admin);
	assert.equal(staff.body.data.verificationNotes, 'internal');
	const staffEmbedded = await get('/prison/prison?id=' + f.prison.id + '&full=true', admin);
	assert.ok(staffEmbedded.body.data.prisoners.some((p) => p.verificationNotes === 'internal'));
});

test('prisoner filters: country and featured', async () => {
	await post(
		'/prisoner/prisoner',
		{ birthName: 'Mexico One', country: 'Mexico', featured: true },
		admin
	);
	const byCountry = await get('/prisoner/prisoners?country=Mexico');
	assert.equal(byCountry.body.total, 1);
	assert.equal(byCountry.body.data[0].country, 'Mexico');
	const featured = await get('/prisoner/prisoners?featured=true&page_size=100');
	assert.ok(featured.body.data.length >= 2);
	assert.ok(featured.body.data.every((p) => p.featured === true));
	const notFeatured = await get('/prisoner/prisoners?featured=false&page_size=100');
	assert.ok(notFeatured.body.data.every((p) => p.featured === false));
	const bad = await get('/prisoner/prisoners?featured=maybe');
	assert.equal(bad.status, 400);
	assert.deepEqual(bad.body.errors, ['featured must be one of true, false.']);
});

test('support groups link to prisoners with a description, from both sides', async () => {
	const linked = await put(
		'/prisoner/support',
		{
			prisoner: f.prisoner1.id,
			chapter: group.id,
			description: 'Letter collection, US Pacific Northwest'
		},
		admin
	);
	assert.equal(linked.status, 200, JSON.stringify(linked.body));
	assert.equal(linked.body.name, 'prisoner addSupport');
	const groups = linked.body.data.prisoner.support_groups;
	assert.equal(groups.length, 1);
	assert.equal(groups[0].id, group.id);
	assert.equal(groups[0].PrisonerSupport.description, 'Letter collection, US Pacific Northwest');

	// Upsert updates the description instead of duplicating.
	const again = await put(
		'/prisoner/support',
		{ prisoner: f.prisoner1.id, chapter: group.id, description: 'Updated role' },
		admin
	);
	assert.equal(again.body.data.prisoner.support_groups.length, 1);
	assert.equal(
		again.body.data.prisoner.support_groups[0].PrisonerSupport.description,
		'Updated role'
	);

	// Visible from the chapter side, publicly.
	const fromGroup = await get('/chapter/chapter?id=' + group.id + '&full=true');
	assert.deepEqual(
		fromGroup.body.data.supported_prisoners.map((p) => p.id),
		[f.prisoner1.id]
	);
	assert.ok(fromGroup.body.data.supported_prisoners[0].verificationNotes === undefined);

	// A draft group backing a prisoner is hidden from the public but visible to staff.
	await put('/prisoner/support', { prisoner: f.prisoner1.id, chapter: draftGroup.id }, admin);
	const anon = await get('/prisoner/prisoner?id=' + f.prisoner1.id + '&full=true');
	assert.deepEqual(
		anon.body.data.support_groups.map((g) => g.id),
		[group.id]
	);
	const staff = await get('/prisoner/prisoner?id=' + f.prisoner1.id + '&full=true', admin);
	assert.deepEqual(
		staff.body.data.support_groups.map((g) => g.id).sort(),
		[group.id, draftGroup.id].sort()
	);

	// Unknown ids and unlink.
	assert.equal(
		(await put('/prisoner/support', { prisoner: 999999, chapter: group.id }, admin)).status,
		404
	);
	assert.equal(
		(await put('/prisoner/support', { prisoner: f.prisoner1.id, chapter: 999999 }, admin)).status,
		404
	);
	assert.equal(
		(await put('/prisoner/support', { prisoner: f.prisoner1.id, chapter: group.id }, user)).status,
		403
	);
	const unlinked = await del(
		'/prisoner/support',
		{ prisoner: f.prisoner1.id, chapter: draftGroup.id },
		admin
	);
	assert.equal(unlinked.status, 200);
	assert.equal(unlinked.body.data, 1);
	assert.equal(
		(await del('/prisoner/support', { prisoner: f.prisoner1.id, chapter: draftGroup.id }, admin))
			.status,
		404
	);
});

test('facilities accept routing and verification fields, and filter by country and routing', async () => {
	const created = await post(
		'/prison/prison',
		{
			prisonName: 'IK-17',
			address: { city: 'Shklov' },
			country: 'Belarus',
			routing: 'relay_only',
			scanService: null,
			notes: 'Censorship delays',
			verifiedBy: group.id,
			verifiedAt: '2026-01-03T00:00:00.000Z',
			verificationNotes: 'internal'
		},
		admin
	);
	assert.equal(created.status, 201, JSON.stringify(created.body));
	assert.equal(created.body.data.routing, 'relay_only');
	const bad = await post(
		'/prison/prison',
		{ prisonName: 'X', address: {}, routing: 'pigeon' },
		admin
	);
	assert.equal(bad.status, 400);
	assert.ok(bad.body.errors[0].startsWith('Routing must be one of'));

	const byCountry = await get('/prison/prisons?country=Belarus');
	assert.equal(byCountry.body.total, 1);
	assert.equal(byCountry.body.data[0].verificationNotes, undefined);
	const byRouting = await get('/prison/prisons?routing=relay_only');
	assert.equal(byRouting.body.total, 1);
	assert.equal((await get('/prison/prisons?routing=pigeon')).status, 400);
	const staff = await get('/prison/prison?id=' + created.body.data.id, admin);
	assert.equal(staff.body.data.verificationNotes, 'internal');
});

test('relay groups attach to and detach from facilities; rules can be detached', async () => {
	const attached = await put('/prison/relay', { prison: f.prison.id, chapter: group.id }, admin);
	assert.equal(attached.status, 200, JSON.stringify(attached.body));
	assert.deepEqual(
		attached.body.data.updatedRows.relay_groups.map((g) => g.id),
		[group.id]
	);
	await put('/prison/relay', { prison: f.prison.id, chapter: draftGroup.id }, admin);
	const anon = await get('/prison/prison?id=' + f.prison.id + '&full=true');
	assert.deepEqual(
		anon.body.data.relay_groups.map((g) => g.id),
		[group.id]
	);
	const fromGroup = await get('/chapter/chapter?id=' + group.id + '&full=true');
	assert.deepEqual(
		fromGroup.body.data.relay_prisons.map((p) => p.id),
		[f.prison.id]
	);
	assert.equal(
		(await put('/prison/relay', { prison: f.prison.id, chapter: 999999 }, admin)).status,
		404
	);
	const detached = await del(
		'/prison/relay',
		{ prison: f.prison.id, chapter: draftGroup.id },
		admin
	);
	assert.equal(detached.status, 200);
	assert.equal(
		(await del('/prison/relay', { prison: f.prison.id, chapter: draftGroup.id }, admin)).status,
		404
	);

	await put('/prison/rule', { rule: f.rule.id, prison: f.prison.id }, admin);
	const ruleGone = await del('/prison/rule', { rule: f.rule.id, prison: f.prison.id }, admin);
	assert.equal(ruleGone.status, 200);
	assert.equal(ruleGone.body.name, 'prison removeRule');
	const after = await get('/prison/prison?id=' + f.prison.id + '&full=true', admin);
	assert.deepEqual(after.body.data.rules, []);
	assert.equal(
		(await del('/prison/rule', { rule: f.rule.id, prison: f.prison.id }, admin)).status,
		404
	);
	assert.equal(
		(await del('/prison/rule', { rule: 999999, prison: f.prison.id }, admin)).status,
		404
	);
});

test('groups accept profile fields, validate services and links, and filter by country and service', async () => {
	const created = await post(
		'/chapter/chapter',
		{
			name: 'Belarus ABC',
			location: { city: 'Minsk' },
			country: 'Belarus',
			subregion: 'Minsk',
			about: 'Relay group',
			website: 'https://abc.by',
			email: 'letters@abc.by',
			socialLinks: { mastodon: 'https://kolektiva.social/@abcby', x: '' },
			services: ['international_relay', 'translation_assistance'],
			announcement: 'Letter night Friday',
			vouchedBy: group.id
		},
		admin
	);
	assert.equal(created.status, 201, JSON.stringify(created.body));
	assert.deepEqual(created.body.data.services, ['international_relay', 'translation_assistance']);
	assert.equal(created.body.data.vouchedBy, group.id);

	const badService = await post(
		'/chapter/chapter',
		{ name: 'X', location: {}, services: ['pizza'] },
		admin
	);
	assert.equal(badService.status, 400);
	assert.ok(badService.body.errors[0].startsWith('Services must be an array of:'));
	const badLinks = await post(
		'/chapter/chapter',
		{ name: 'X', location: {}, socialLinks: { tiktok: 'x' } },
		admin
	);
	assert.equal(badLinks.status, 400);
	assert.ok(badLinks.body.errors[0].startsWith('Social links must be an object'));
	const badMail = await post('/chapter/chapter', { name: 'X', location: {}, email: 'nope' }, admin);
	assert.equal(badMail.status, 400);

	const byCountry = await get('/chapter/chapters?country=Belarus');
	assert.deepEqual(
		byCountry.body.data.map((c) => c.name),
		['Belarus ABC']
	);
	const byService = await get('/chapter/chapters?service=international_relay&page_size=100');
	assert.deepEqual(
		byService.body.data.map((c) => c.name),
		['Belarus ABC']
	); // the draft group also offers it but is hidden
	const staffByService = await get(
		'/chapter/chapters?service=international_relay&page_size=100',
		admin
	);
	assert.deepEqual(staffByService.body.data.map((c) => c.name).sort(), [
		'Belarus ABC',
		'Secret Cell'
	]);
	assert.equal((await get('/chapter/chapters?service=pizza')).status, 400);
});

test('an admin can put an account in a group; the member cannot change it', async () => {
	const set = await put('/auth/user', { id: f.chapter.id, chapterId: group.id }, admin);
	assert.equal(set.status, 200);
	const me = await get('/auth/user?id=' + f.chapter.id, { token: f.chapter.token });
	assert.equal(me.body.data.chapterId, group.id);
	const self = await put(
		'/auth/user',
		{ id: f.chapter.id, chapterId: draftGroup.id },
		{ token: f.chapter.token }
	);
	assert.equal(self.status, 403);
	const registered = await post('/auth/user', {
		username: 'joiner',
		password: 'longenough',
		email: 'joiner@example.com',
		chapterId: group.id
	});
	assert.equal(registered.status, 201);
	const stored = await get('/auth/user?id=' + registered.body.data.id, admin);
	assert.equal(stored.body.data.chapterId, null);
	const staffCreated = await post(
		'/auth/user',
		{
			username: 'member2',
			password: 'longenough',
			email: 'm2@example.com',
			role: 'chapter',
			chapterId: group.id
		},
		admin
	);
	assert.equal(staffCreated.body.data.chapterId, group.id);
	assert.equal(
		(await put('/auth/user', { id: f.chapter.id, chapterId: 999999 }, admin)).status,
		400
	);
});
