import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeFixtures, get, Chapter, Prison } from './helpers.js';

// Routing a letter needs a facility's rules and who mails there, not every
// prisoner held at it; and a groups page needs its filter values (#205).
let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
	await Prison.addRelay(f.group.id, f.prison.id);
});
after(stopServer);

test('a plain facility read names its relay groups, without the prisoners', async () => {
	const one = await get('/prison/prison?id=' + f.prison.id);
	assert.equal(one.status, 200, JSON.stringify(one.body));
	assert.deepEqual(one.body.data.relay_groups, [
		{ id: f.group.id, name: f.group.name, accountStatus: 'active' }
	]);
	assert.equal(one.body.data.prisoners, undefined, 'no prisoners without full=true');

	const page = await get('/prison/prisons?page_size=100');
	const row = page.body.data.find((p) => p.id === f.prison.id);
	assert.deepEqual(
		row.relay_groups.map((g) => g.id),
		[f.group.id]
	);
	assert.equal(row.prisoners, undefined);

	// full=true still carries everything, as before.
	const full = await get('/prison/prison?id=' + f.prison.id + '&full=true');
	assert.ok(Array.isArray(full.body.data.prisoners));
	assert.ok(full.body.data.relay_groups.some((g) => g.id === f.group.id));
});

test('GET /chapter/filters gives the groups list its values, counted', async () => {
	await Chapter.update(
		{
			country: 'Canada',
			networkRole: 'relay',
			services: ['domestic_mailing', 'translation_assistance']
		},
		{ where: { id: f.group.id } }
	);
	const hidden = await Chapter.createChapter({
		name: 'Unlisted',
		location: {},
		country: 'Atlantis',
		recordStatus: 'pending'
	});

	const pub = await get('/chapter/filters');
	assert.equal(pub.status, 200, JSON.stringify(pub.body));
	assert.ok(pub.body.data.country.some((c) => c.value === 'Canada' && c.count >= 1));
	assert.ok(
		!pub.body.data.country.some((c) => c.value === 'Atlantis'),
		'unpublished groups are not counted'
	);
	assert.ok(pub.body.data.networkRole.some((r) => r.value === 'relay'));
	assert.ok(
		pub.body.data.services.some((s) => s.value === 'translation_assistance' && s.count >= 1)
	);
	assert.equal(pub.body.data.accountStatus, undefined, 'staff only');

	const staff = await get('/chapter/filters', f.admin);
	assert.ok(staff.body.data.country.some((c) => c.value === 'Atlantis'));
	assert.ok(Array.isArray(staff.body.data.accountStatus));
	await Chapter.destroy({ where: { id: hidden.id } });
});
