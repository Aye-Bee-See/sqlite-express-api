process.env.RATE_LIMIT_ENABLED = 'true';
process.env.RATE_LIMIT_LOGIN_FAILURES_PER_USER = '3';
process.env.RATE_LIMIT_LOGIN_PER_IP = '1000';
process.env.RATE_LIMIT_RECOVER_START_PER_USER = '2';
process.env.RATE_LIMIT_RECOVER_START_PER_IP = '1000';
process.env.RATE_LIMIT_RECOVER_FINISH_PER_USER = '2';
process.env.RATE_LIMIT_RECOVER_FINISH_PER_IP = '1000';

const { test, before, after, beforeEach } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, get, post, makeUser } = await import('./helpers.js');
const { reset } = await import('../routes/services/ratelimit.services.js');

// The per-username limits count a username that is text. Sent as a list, it was
// not counted at all, and the lookup still found the account (`IN ('alice')`):
// guesses without limit. Sent as an object, it reached the database as an
// operator and answered 500. A username is text, or the request is refused.
let victim;
before(async () => {
	await startServer();
	victim = await makeUser({ username: 'guessme', password: 'the right password' });
});
after(stopServer);
beforeEach(reset);

const refusedAsText = (res, what) => {
	assert.equal(res.status, 400, what + ': ' + JSON.stringify(res.body));
	assert.deepEqual(res.body.problems, [
		{ field: 'username', code: 'wrong_type', params: { expected: 'text' } }
	]);
};

test('sign-in: a list or an object for username is refused, not counted apart', async () => {
	for (const username of [['guessme'], { $ne: null }, 42]) {
		refusedAsText(
			await post('/auth/login', { username, password: 'a wrong guess' }),
			'login ' + JSON.stringify(username)
		);
	}
	// And the plain form is still counted as it always was.
	for (let i = 0; i < 3; i++) {
		assert.equal((await post('/auth/login', { username: 'guessme', password: 'no' })).status, 401);
	}
	assert.equal((await post('/auth/login', { username: 'guessme', password: 'no' })).status, 429);
	void victim;
});

test('recovery: the same, whether it comes in the query or the body', async () => {
	refusedAsText(await get('/auth/recover?username=guessme&username=guessme'), 'repeated query');
	// (`?username[a]=` is not an object here: Express 5 reads the query without
	// brackets, so that is a parameter named `username[a]`, and no username at all.)
	for (const username of [['guessme'], { a: 1 }]) {
		refusedAsText(
			await post('/auth/recover', { username, challenge: 'x', password: 'whatever1' }),
			'finish ' + JSON.stringify(username)
		);
	}
});

test('the login parameters lookup takes a username as text too', async () => {
	refusedAsText(await get('/auth/login-params?username=a&username=b'), 'login params');
	assert.equal((await get('/auth/login-params?username=guessme')).status, 200);
});
