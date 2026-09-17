import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, get, post, put, makeFixtures, Prison } from './helpers.js';
import { MAIL_RULES, MAIL_RULE_CATEGORIES, MAIL_RULE_TAGS } from '../database/mail-rules.js';

let f;
let admin;
let chapter;
let alice;
let strict; // a facility with several rules
let open; // a facility with none

before(async () => {
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
	chapter = { token: f.chapter.token };
	alice = { token: f.alice.token };
	strict = await Prison.createPrison({
		prisonName: 'Strict Facility',
		address: {},
		mailRules: ['no_polaroids', 'ink_blue_or_black', 'return_address_required'],
		pageLimit: 5,
		photoLimit: 3,
		mailLanguages: ['en', 'es']
	});
	open = await Prison.createPrison({ prisonName: 'Open Facility', address: {} });
});
after(stopServer);

test('the vocabulary is public, complete, and well formed', async () => {
	const res = await get('/prison/mail-rules');
	assert.equal(res.status, 200);
	assert.equal((await get('/prison/mail-rules', alice)).status, 200);
	assert.equal(
		(await get('/prison/mail-rules', { token: 'garbage' })).status,
		401,
		'a bad token is rejected on public routes, not treated as anonymous'
	);
	const { categories, rules, conflicts, parameters } = res.body.data;
	assert.deepEqual(categories, MAIL_RULE_CATEGORIES);
	assert.equal(rules.length, MAIL_RULES.length);
	assert.deepEqual(Object.keys(parameters).sort(), ['mailLanguages', 'pageLimit', 'photoLimit']);
	assert.ok(conflicts.every((pair) => pair.length === 2));

	assert.equal(new Set(MAIL_RULE_TAGS).size, MAIL_RULE_TAGS.length, 'tags are unique');
	for (const rule of rules) {
		assert.match(rule.tag, /^[a-z]+(_[a-z]+)*$/, rule.tag + ' is snake case');
		assert.ok(categories.includes(rule.category), rule.tag + ' has a known category');
		assert.ok(rule.label && rule.description, rule.tag + ' has default wording');
	}
	for (const tag of conflicts.flat()) {
		assert.ok(MAIL_RULE_TAGS.includes(tag));
	}
});

test('facility reads carry the tags and the typed limits, with or without a token', async () => {
	for (const who of [{}, alice, admin]) {
		const res = await get('/prison/prison?id=' + strict.id, who);
		assert.equal(res.status, 200);
		assert.deepEqual(res.body.data.mailRules, [
			'no_polaroids',
			'ink_blue_or_black',
			'return_address_required'
		]);
		assert.equal(res.body.data.pageLimit, 5);
		assert.equal(res.body.data.photoLimit, 3);
		assert.deepEqual(res.body.data.mailLanguages, ['en', 'es']);
	}
	const bare = (await get('/prison/prison?id=' + open.id)).body.data;
	assert.deepEqual(bare.mailRules, []);
	assert.equal(bare.pageLimit, null);
	assert.equal(bare.photoLimit, null);
	assert.equal(bare.mailLanguages, null);

	const listed = (await get('/prison/prisons?page_size=100')).body.data;
	assert.deepEqual(listed.find((p) => p.id === strict.id).mailRules.length, 3);
});

test('the old rule endpoints are gone', async () => {
	assert.equal((await get('/rule/rules')).status, 404);
	assert.equal((await put('/prison/rule', { rule: 1, prison: strict.id }, admin)).status, 404);
	const full = await get('/prison/prison?id=' + strict.id + '&full=true', admin);
	assert.equal(full.body.data.rules, undefined);
});

test('staff set rules through the ordinary facility create and update', async () => {
	const created = await post(
		'/prison/prison',
		{ prisonName: 'Tagged', address: {}, mailRules: ['postcards_only'], pageLimit: 2 },
		chapter
	);
	assert.equal(created.status, 201, JSON.stringify(created.body));
	assert.deepEqual(created.body.data.mailRules, ['postcards_only']);
	assert.equal(created.body.data.pageLimit, 2);

	const id = created.body.data.id;
	const updated = await put(
		'/prison/prison',
		{ id, mailRules: ['postcards_only', 'no_stickers_or_labels'], mailLanguages: ['ru'] },
		admin
	);
	assert.equal(updated.status, 200, JSON.stringify(updated.body));
	const read = (await get('/prison/prison?id=' + id)).body.data;
	assert.deepEqual(read.mailRules, ['postcards_only', 'no_stickers_or_labels']);
	assert.deepEqual(read.mailLanguages, ['ru']);
	assert.equal(read.pageLimit, 2, 'fields that were not sent are kept');

	const cleared = await put('/prison/prison', { id, mailRules: [], pageLimit: null }, admin);
	assert.equal(cleared.status, 200);
	const after = (await get('/prison/prison?id=' + id)).body.data;
	assert.deepEqual(after.mailRules, []);
	assert.equal(after.pageLimit, null);

	assert.equal(
		(await put('/prison/prison', { id, mailRules: ['no_maps'] }, alice)).status,
		403,
		'writers cannot'
	);
});

test('free text, duplicates, conflicts, and bad limits are refused', async () => {
	const id = open.id;
	const attempt = async (fields) => await put('/prison/prison', { id, ...fields }, admin);
	const cases = [
		[{ mailRules: ['No pictures'] }, /Unknown mail rule "No pictures"/],
		[{ mailRules: 'no_photos' }, /must be an array/],
		[{ mailRules: ['no_maps', 'no_maps'] }, /more than once/],
		[{ mailRules: ['typed_letters_allowed', 'handwritten_only'] }, /cannot hold both/],
		[{ pageLimit: 0 }, /pageLimit must be a whole number of at least 1/],
		[{ pageLimit: 2.5 }, /pageLimit must be a whole number/],
		[{ photoLimit: -1 }, /photoLimit must be a whole number/],
		[{ mailLanguages: ['English'] }, /two-letter ISO 639-1/],
		[{ mailLanguages: ['EN'] }, /two-letter ISO 639-1/],
		[{ mailLanguages: 'en' }, /two-letter ISO 639-1/],
		[{ mailLanguages: ['en', 'en'] }, /more than once/]
	];
	for (const [fields, message] of cases) {
		const res = await attempt(fields);
		assert.equal(res.status, 400, JSON.stringify(fields));
		assert.match(res.body.errors.join(' '), message, JSON.stringify(fields));
	}
	const unchanged = (await get('/prison/prison?id=' + id)).body.data;
	assert.deepEqual(unchanged.mailRules, []);
});

test('a facility that takes no photos cannot state a photo limit', async () => {
	const both = await post(
		'/prison/prison',
		{ prisonName: 'Both', address: {}, mailRules: ['no_photos'], photoLimit: 5 },
		admin
	);
	assert.equal(both.status, 400);
	assert.match(both.body.errors[0], /photoLimit cannot be set on a facility tagged no_photos/);

	// The same across two requests: the stored half counts.
	const tagOnLimited = await put(
		'/prison/prison',
		{ id: strict.id, mailRules: ['no_photos'] },
		admin
	);
	assert.equal(tagOnLimited.status, 400);
	const together = await put(
		'/prison/prison',
		{ id: strict.id, mailRules: ['no_photos'], photoLimit: null },
		admin
	);
	assert.equal(together.status, 200);
	const limitOnTagged = await put('/prison/prison', { id: strict.id, photoLimit: 2 }, admin);
	assert.equal(limitOnTagged.status, 400);

	// Put it back for the tests below.
	const restored = await put(
		'/prison/prison',
		{
			id: strict.id,
			mailRules: ['no_polaroids', 'ink_blue_or_black', 'return_address_required'],
			photoLimit: 3
		},
		admin
	);
	assert.equal(restored.status, 200);
});

test('two partial updates cannot combine into no_photos with a photo limit', async () => {
	for (let round = 0; round < 5; round += 1) {
		const fresh = await Prison.createPrison({ prisonName: 'Race ' + round, address: {} });
		const results = await Promise.all([
			put('/prison/prison', { id: fresh.id, mailRules: ['no_photos'] }, admin),
			put('/prison/prison', { id: fresh.id, photoLimit: 3 }, admin)
		]);
		assert.deepEqual(
			results.map((r) => r.status).sort(),
			[200, 400],
			'one of the two is refused: ' + JSON.stringify(results.map((r) => r.body))
		);
		const stored = await Prison.findByPk(fresh.id);
		assert.ok(!Prison.photoRulesClash(stored), JSON.stringify(stored));
	}
	// A guarded update of a facility that does not exist is still a 404, not a 400.
	assert.equal((await put('/prison/prison', { id: 999999, photoLimit: 3 }, admin)).status, 404);
	assert.equal(
		(await put('/prison/prison', { id: 999999, mailRules: ['no_photos'] }, admin)).status,
		404
	);
});

test('a proposed new facility gets the photo rule check straight away', async () => {
	const res = await post(
		'/moderation/submission',
		{
			resource: 'prison',
			fields: { prisonName: 'Proposed', address: {}, mailRules: ['no_photos'], photoLimit: 5 }
		},
		alice
	);
	assert.equal(res.status, 400, JSON.stringify(res.body));
	assert.match(
		res.body.errors.join(' '),
		/photoLimit cannot be set on a facility tagged no_photos/
	);
});

test('lists filter by tag and by language', async () => {
	const ids = async (query) =>
		(await get('/prison/prisons?page_size=100&' + query)).body.data.map((p) => p.id);

	const polaroids = await ids('mailRule=no_polaroids');
	assert.ok(polaroids.includes(strict.id));
	assert.ok(!polaroids.includes(open.id));
	assert.deepEqual(await ids('mailRule=digital_mail_only'), []);

	const french = await ids('language=fr');
	assert.ok(french.includes(open.id), 'no restriction accepts any language');
	assert.ok(!french.includes(strict.id));
	const spanish = await ids('language=es');
	assert.ok(spanish.includes(strict.id) && spanish.includes(open.id));

	const combined = await ids('mailRule=no_polaroids&language=es&q=strict');
	assert.deepEqual(combined, [strict.id]);

	const unknown = await get('/prison/prisons?mailRule=no_fun');
	assert.equal(unknown.status, 400);
	assert.match(unknown.body.errors[0], /mailRule must be one of/);
	const injected = await get("/prison/prisons?language=e'--");
	assert.equal(injected.status, 400);
	assert.match(injected.body.errors[0], /two-letter ISO 639-1/);
	const both = await get('/prison/prisons?language=english&sort=sideways');
	assert.equal(both.body.errors.length, 2, 'reported together with other bad parameters');
});

test('anyone signed in can propose rule changes; approval applies them', async () => {
	const proposed = await post(
		'/moderation/submission',
		{
			resource: 'prison',
			target: open.id,
			fields: { mailRules: ['no_greeting_cards', 'plain_paper'], pageLimit: 10 },
			note: 'From the facility handbook, page 12'
		},
		alice
	);
	assert.equal(proposed.status, 201, JSON.stringify(proposed.body));

	// A free-text rule never reaches the queue, for an edit or for a new facility.
	const bad = await post(
		'/moderation/submission',
		{ resource: 'prison', target: open.id, fields: { mailRules: ['be nice'] } },
		alice
	);
	assert.equal(bad.status, 400);
	assert.match(bad.body.errors.join(' '), /Unknown mail rule "be nice"/);
	// The photo rule is checked against the stored half of the facility.
	const clash = await post(
		'/moderation/submission',
		{ resource: 'prison', target: strict.id, fields: { mailRules: ['no_photos'] } },
		alice
	);
	assert.equal(clash.status, 400, JSON.stringify(clash.body));
	assert.match(
		clash.body.errors.join(' '),
		/photoLimit cannot be set on a facility tagged no_photos/
	);
	const newRecord = await post(
		'/moderation/submission',
		{ resource: 'prison', fields: { prisonName: 'Proposed', address: {}, mailRules: ['be nice'] } },
		alice
	);
	assert.equal(newRecord.status, 400, 'a proposed new facility is validated straight away');

	const before = (await get('/prison/prison?id=' + open.id)).body.data;
	assert.deepEqual(before.mailRules, [], 'nothing changes until review');

	const approved = await put('/moderation/approve', { id: proposed.body.data.id }, admin);
	assert.equal(approved.status, 200, JSON.stringify(approved.body));
	const after = (await get('/prison/prison?id=' + open.id)).body.data;
	assert.deepEqual(after.mailRules, ['no_greeting_cards', 'plain_paper']);
	assert.equal(after.pageLimit, 10);
});

test('the seeded facilities pass the same validation', async () => {
	const { readFileSync } = await import('node:fs');
	const { seeds } = JSON.parse(
		readFileSync(new URL('../database/seeds/prisonSeed.json', import.meta.url), 'utf8')
	);
	assert.ok(seeds.some((row) => row.mailRules.length > 0));
	for (const row of seeds) {
		await Prison.build(row).validate();
		assert.ok(!(row.mailRules.includes('no_photos') && row.photoLimit != null), row.prisonName);
	}
});
