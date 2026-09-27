import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, makeFixtures, get, Prisoner } from './helpers.js';

// `q` is text to find, not a pattern. As a LIKE pattern, `?q=%` or `?q=_`
// matched every record: a search that lists the whole directory past any
// filter a client meant to apply, and every account in the admin's user search.
let f;
before(async () => {
	await startServer();
	f = await makeFixtures();
	await Prisoner.createPrisoner({
		birthName: 'Ζωή Παππά',
		chosenName: 'Ζωή',
		prison: f.prison.id,
		inmateID: 'GR-1',
		status: 'incarcerated'
	});
});
after(stopServer);

const count = async (path, who) => {
	const res = await get(path, who);
	assert.equal(res.status, 200, path + ': ' + JSON.stringify(res.body));
	return res.body.data.length;
};

test('a percent sign or an underscore finds only names that contain one', async () => {
	for (const path of ['/prisoner/prisoners', '/prison/prisons', '/chapter/chapters']) {
		for (const q of ['%', '_', '%25', '__']) {
			assert.equal(await count(path + '?q=' + encodeURIComponent(q)), 0, path + ' q=' + q);
		}
	}
	assert.equal(await count('/auth/users?q=%25', f.admin), 0, 'the user search too');
	assert.equal(await count('/auth/users?q=_', f.admin), 0);
});

test('ordinary searches find what they did', async () => {
	assert.equal(await count('/prison/prisons?q=test%20prison'), 1, 'any case, in ASCII');
	assert.equal(await count('/prisoner/prisoners?q=prisoner%20one'), 1);
	assert.equal(await count('/prisoner/prisoners?q=' + encodeURIComponent('Ζωή')), 1, 'Greek');
	assert.equal(await count('/chapter/chapters?q=fixture'), 1);
	assert.ok((await count('/auth/users?q=alice', f.admin)) >= 1);
});
