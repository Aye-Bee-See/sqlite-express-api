/**
 * Shared test harness.
 *
 * Each test file runs in its own process (node --test), so each gets its own
 * in-memory SQLite database. Environment is pinned here BEFORE the app is
 * imported, because constants.js reads process.env at import time and dotenv
 * does not override variables that are already set.
 */
process.env.JWT_SECRET = 'test-secret';
process.env.DB_STORAGE = ':memory:';
process.env.DB_RESET = 'true';
process.env.DB_SEED = 'false';
process.env.DB_LOGGING = 'false';
process.env.ADMIN_USERNAME = '';
process.env.ADMIN_PASSWORD = '';
process.env.ADMIN_EMAIL = '';
process.env.CORS_ORIGIN = 'http://localhost:3001';
process.env.NODE_ENV = 'test';

const { createApp, ready } = await import('../app.js');
const db = await import('../database/sql-database.js');

export const { User, Prison, Prisoner, Rule, Chapter, Chat, Message, ClaimToken, sequelize } = db;

let server;
let baseUrl;

/**
 * Wait for the database, bind the app to an ephemeral port, and return the
 * base URL. Call once per test file (top level) and pair with stopServer().
 */
export async function startServer() {
	await ready;
	const app = createApp();
	await new Promise((resolve) => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	baseUrl = 'http://127.0.0.1:' + server.address().port;
	return baseUrl;
}

/** Base URL of the running test server (after startServer). */
export function baseUrlOf() {
	return baseUrl;
}

export async function stopServer() {
	if (server) {
		await new Promise((resolve) => server.close(resolve));
		server = undefined;
	}
	await sequelize.close();
}

/**
 * Send a request and parse the response.
 * @param {string} method
 * @param {string} path e.g. '/prison/prisons?page_size=2'
 * @param {{token?: string, body?: object, headers?: object}} [options]
 * @returns {Promise<{status: number, body: any, headers: Headers}>}
 */
export async function api(method, path, options = {}) {
	const headers = { ...(options.headers || {}) };
	let body;
	if (options.body !== undefined) {
		headers['Content-Type'] = 'application/json';
		body = JSON.stringify(options.body);
	}
	if (options.token) {
		headers['Authorization'] = 'Bearer ' + options.token;
	}
	const res = await fetch(baseUrl + path, { method, headers, body });
	const text = await res.text();
	let parsed = text;
	try {
		parsed = JSON.parse(text);
	} catch {
		// leave as text (e.g. an empty body)
	}
	return { status: res.status, body: parsed, headers: res.headers };
}

export const get = (path, o) => api('GET', path, o);
export const post = (path, body, o = {}) => api('POST', path, { ...o, body });
export const put = (path, body, o = {}) => api('PUT', path, { ...o, body });
export const del = (path, body, o = {}) => api('DELETE', path, { ...o, body });

/**
 * Log in and return the token.
 */
export async function login(username, password) {
	const res = await post('/auth/login', { username, password });
	if (res.status !== 200) {
		throw new Error('login failed for ' + username + ': ' + JSON.stringify(res.body));
	}
	return res.body.data.token.token;
}

let counter = 0;

/**
 * Create a user directly through the model (password gets hashed by the hook)
 * and log them in. Returns { user, token, password }.
 * @param {{role?: string, username?: string, password?: string, email?: string, name?: string}} [overrides]
 */
export async function makeUser(overrides = {}) {
	counter += 1;
	const password = overrides.password || 'password' + counter;
	const username = overrides.username || (overrides.role || 'user') + counter;
	const user = await User.createUser({
		username,
		password,
		email: overrides.email || username + '@example.com',
		role: overrides.role || 'user',
		name: overrides.name,
		bio: overrides.bio
	});
	const token = await login(username, password);
	return { user, token, password, id: user.id };
}

/**
 * A standard cast: an admin; a group (Chapter record) with one chapter-role
 * member account and one unclaimed managed writer; alice and bob, two
 * independent users; one prison with two prisoners; one rule. Chats and
 * messages are left to each test.
 */
export async function makeFixtures() {
	const admin = await makeUser({ role: 'admin', username: 'admin' });
	const group = await Chapter.createChapter({ name: 'Fixture Group', location: {} });
	const chapter = await makeUser({ role: 'chapter', username: 'chapter' });
	await User.update({ chapterId: group.id }, { where: { id: chapter.id } });
	chapter.user = await User.findByPk(chapter.id);
	const writer = await User.createManagedWriter({ name: 'Managed Writer', chapterId: group.id });
	const alice = await makeUser({ role: 'user', username: 'alice' });
	const bob = await makeUser({ role: 'user', username: 'bob' });
	const prison = await Prison.createPrison({
		prisonName: 'Test Prison',
		address: { street: '1 Main' }
	});
	const prisoner1 = await Prisoner.createPrisoner({
		birthName: 'Prisoner One',
		chosenName: 'One',
		prison: prison.id,
		inmateID: 'P-1',
		status: 'incarcerated'
	});
	const prisoner2 = await Prisoner.createPrisoner({
		birthName: 'Prisoner Two',
		chosenName: 'Two',
		prison: prison.id,
		inmateID: 'P-2'
	});
	const rule = await Rule.createRule({ title: 'No pictures', description: 'Text only' });
	return { admin, group, chapter, writer, alice, bob, prison, prisoner1, prisoner2, rule };
}
