import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startServer, stopServer, get, put, login, makeFixtures } from './helpers.js';
import SessionRun, { TOKEN_LIFETIME_MS } from '../database/models/session-run.model.js';

let f;
const me = (token) => get('/auth/user?id=' + f.alice.id, { token });
const issuedOf = (token) => jwt.decode(token).issued;
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** A correctly signed token for alice, as another database with the same secret would issue. */
function foreignToken(issued) {
	return jwt.sign({ id: f.alice.id, issued, jti: 'foreign-' + issued }, 'test-secret', {
		expiresIn: '1w'
	});
}

before(async () => {
	await startServer();
	f = await makeFixtures();
});
after(stopServer);
beforeEach(tick);

test('a login is remembered, and its token survives a restart', async () => {
	const token = await login('alice', f.alice.password);
	assert.equal((await me(token)).status, 200);
	const runs = await SessionRun.findAll({ raw: true });
	assert.equal(runs.length, 1, 'every login of this process belongs to one run');
	assert.ok(runs[0].startedAt <= issuedOf(token) && issuedOf(token) <= runs[0].lastIssuedAt);

	SessionRun.forget();
	assert.equal((await me(token)).status, 200, 'the database still remembers issuing it');

	const afterRestart = await login('alice', f.alice.password);
	assert.equal((await me(afterRestart)).status, 200);
	assert.equal((await me(token)).status, 200);
	assert.equal(await SessionRun.count(), 2, 'a restarted process starts its own run');
});

test('a token the database never issued is refused, whatever it is signed with', async () => {
	// The case seen on Android: same JWT_SECRET, same user id, a database that was reset since.
	const beforeAnyRun = foreignToken(Date.now() - 60 * 60 * 1000);
	assert.equal((await me(beforeAnyRun)).status, 401);

	// In the future of every run.
	assert.equal((await me(foreignToken(Date.now() + 1000))).status, 401);

	// Between two runs: issued while this database, as far as it knows, issued nothing.
	const runs = await SessionRun.findAll({ raw: true, order: [['startedAt', 'ASC']] });
	const gap = Math.floor((runs[0].lastIssuedAt + runs[1].startedAt) / 2);
	assert.ok(runs[0].lastIssuedAt < gap && gap < runs[1].startedAt, 'the test needs a gap');
	assert.equal((await me(foreignToken(gap))).status, 401);

	// The same hand-made token inside a run passes: the check is about time, nothing else.
	assert.equal((await me(foreignToken(runs[1].startedAt))).status, 200);
});

test('after a restore from backup, tokens issued since the backup are refused', async () => {
	const beforeBackup = await login('alice', f.alice.password);
	const backup = await SessionRun.findAll({ raw: true });
	await tick();
	const afterBackup = await login('alice', f.alice.password);
	assert.equal((await me(afterBackup)).status, 200);

	// Restore: the table is as the backup had it, and the process starts again.
	await SessionRun.destroy({ where: {} });
	await SessionRun.bulkCreate(backup);
	SessionRun.forget();

	assert.equal((await me(beforeBackup)).status, 200, 'the backup knows this login');
	assert.equal((await me(afterBackup)).status, 401, 'it never saw this one');

	await tick();
	const fresh = await login('alice', f.alice.password);
	assert.equal((await me(fresh)).status, 200);
	assert.equal((await me(afterBackup)).status, 401, 'and a new run does not reach back over it');
});

test('a reset database refuses every earlier token', async () => {
	const token = await login('alice', f.alice.password);
	await SessionRun.destroy({ where: {} }); // what DB_RESET leaves: no runs at all
	SessionRun.forget();
	assert.equal((await me(token)).status, 401);
	assert.equal((await me(await login('alice', f.alice.password))).status, 200);
});

test('the token handed back after a password change is remembered too', async () => {
	const token = await login('bob', f.bob.password);
	await tick();
	const changed = await put('/auth/user', { id: f.bob.id, password: 'a-new-password' }, { token });
	assert.equal(changed.status, 200, JSON.stringify(changed.body));
	const fresh = changed.body.data.token.token;
	SessionRun.forget();
	assert.equal((await get('/auth/user?id=' + f.bob.id, { token: fresh })).status, 200);
});

test('logins at the same moment share one run', async () => {
	await SessionRun.destroy({ where: {} });
	SessionRun.forget();
	const tokens = await Promise.all([1, 2, 3, 4].map(() => login('alice', f.alice.password)));
	assert.equal(await SessionRun.count(), 1);
	for (const token of tokens) {
		assert.equal((await me(token)).status, 200);
	}
});

test('runs too old to matter are swept, the current one never', async () => {
	await SessionRun.destroy({ where: {} });
	SessionRun.forget();
	const token = await login('alice', f.alice.password);
	const old = Date.now() - TOKEN_LIFETIME_MS - 1000;
	await SessionRun.bulkCreate([
		{ startedAt: 0, lastIssuedAt: old },
		{ startedAt: old, lastIssuedAt: Date.now() - 1000 }
	]);
	assert.equal(await SessionRun.sweep(), 1);
	assert.equal(await SessionRun.count(), 2);
	// Far in the future, everything but this process's own run goes.
	assert.equal(await SessionRun.sweep(Date.now() + 2 * TOKEN_LIFETIME_MS), 1);
	assert.equal((await me(token)).status, 200);
});
