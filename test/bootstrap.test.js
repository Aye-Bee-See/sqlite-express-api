import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Boots the database with ADMIN_* set, so this file cannot use helpers.js
// (which blanks those variables). Each test file is its own process, so the
// in-memory database here is independent of the others.
// Tests never read the developer's .env (it may hold real keys, such as a Firebase
// service account): point dotenv at nothing, then pin what the tests need.
process.env.DOTENV_CONFIG_PATH = '/dev/null';
process.env.JWT_SECRET = 'test-secret';
process.env.DB_STORAGE = ':memory:';
process.env.DB_RESET = 'true';
process.env.DB_SEED = 'false';
process.env.DB_LOGGING = 'false';
process.env.ADMIN_USERNAME = 'bootadmin';
process.env.ADMIN_PASSWORD = 'bootpassword';
process.env.ADMIN_EMAIL = 'boot@example.com';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_MODE = 'server';
process.env.ENCRYPTION_KEY = 'dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktdGVzdCE=';

const { ready, User, sequelize } = await import('../database/sql-database.js');
const { ensureAdmin } = await import('../database/bootstrap-admin.js');

before(() => ready);
after(() => sequelize.close());

test('the configured admin is created on boot with the admin role and a hashed password', async () => {
	const admin = await User.getUserWithPassword({ username: 'bootadmin' });
	assert.ok(admin);
	assert.equal(admin.role, 'admin');
	assert.equal(admin.email, 'boot@example.com');
	assert.equal(admin.name, 'Administrator');
	assert.ok(admin.password.startsWith('$2b$'));
});

test('running ensureAdmin again is a no-op', async () => {
	const result = await ensureAdmin();
	assert.equal(result, null);
	assert.equal(await User.count({ where: { username: 'bootadmin' } }), 1);
});

test('the default scope never selects the password hash', async () => {
	const scoped = await User.getUser({ username: 'bootadmin' });
	assert.equal(scoped.password, undefined);
	assert.equal(JSON.stringify(scoped).includes('$2b$'), false);
});
