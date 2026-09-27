import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A database on disk, because only there do two connections wait on one lock: the
// in-memory database the other tests use has one connection, and this could not happen.
const dir = mkdtempSync(join(tmpdir(), 'abc-chat-lock-'));
process.env.DOTENV_CONFIG_PATH = '/dev/null';
process.env.JWT_SECRET = 'test-secret';
process.env.DB_STORAGE = join(dir, 'chat-lock.sqlite');
process.env.DB_RESET = 'false';
process.env.DB_SEED = 'false';
process.env.DB_LOGGING = 'false';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_MODE = 'server';
process.env.ENCRYPTION_KEY = 'dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktdGVzdCE=';
process.env.UPLOAD_DIR = join(dir, 'uploads');

const db = await import('../database/sql-database.js');
await db.ready;
after(async () => {
	await db.sequelize.close();
	rmSync(dir, { recursive: true, force: true });
});

test('new threads and letters made together all finish, and quickly', async () => {
	const { User, Prison, Prisoner, Chat, Message } = db;
	// A letter holds the write lock while it files itself under a thread. A thread
	// asked for on its own once took a queue first and then waited for that lock,
	// while the letter waited for the queue: every thread answered 500 after ten
	// seconds, and every letter behind it waited too.
	const prison = await Prison.createPrison({ prisonName: 'Lock Order', address: {} });
	const prisoners = [];
	for (let i = 0; i < 6; i += 1) {
		prisoners.push(
			await Prisoner.createPrisoner({
				birthName: 'Person ' + i,
				prison: prison.id,
				inmateID: 'L-' + i,
				status: 'incarcerated'
			})
		);
	}
	const writers = [];
	for (const name of ['lockone', 'locktwo']) {
		writers.push(
			await User.createUser({
				username: name,
				password: 'password-' + name,
				email: name + '@example.com',
				role: 'user'
			})
		);
	}
	const [letterWriter, threadWriter] = writers;

	const started = Date.now();
	const work = [];
	for (const prisoner of prisoners) {
		work.push(
			Message.createLetter({
				messageText: 'Hello',
				sender: 'user',
				user: letterWriter.id,
				prisoner: prisoner.id
			}),
			Chat.createChat({ user: threadWriter.id, prisoner: prisoner.id })
		);
	}
	const results = await Promise.allSettled(work);
	const elapsed = Date.now() - started;

	const failed = results.filter((r) => r.status === 'rejected').map((r) => String(r.reason));
	assert.deepEqual(failed, [], 'nothing failed');
	assert.ok(elapsed < 5000, 'finished in ' + elapsed + ' ms');
	assert.equal(await Chat.count({ where: { user: threadWriter.id } }), prisoners.length);
	assert.equal(await Chat.count({ where: { user: letterWriter.id } }), prisoners.length);
	assert.equal(await Message.count({ where: { user: letterWriter.id } }), prisoners.length);
});

test('two requests for the same new thread get the same one', async () => {
	const { User, Prison, Prisoner, Chat, Message } = db;
	const prison = await Prison.createPrison({ prisonName: 'Same Thread', address: {} });
	const prisoner = await Prisoner.createPrisoner({
		birthName: 'Only Person',
		prison: prison.id,
		inmateID: 'S-1',
		status: 'incarcerated'
	});
	const writer = await User.createUser({
		username: 'samethread',
		password: 'password-samethread',
		email: 'samethread@example.com',
		role: 'user'
	});
	const made = await Promise.all([
		Chat.createChat({ user: writer.id, prisoner: prisoner.id }),
		Chat.createChat({ user: writer.id, prisoner: prisoner.id }),
		Message.createLetter({
			messageText: 'Hello',
			sender: 'user',
			user: writer.id,
			prisoner: prisoner.id
		}),
		Chat.createChat({ user: writer.id, prisoner: prisoner.id })
	]);
	const ids = new Set([made[0].id, made[1].id, made[2].chat, made[3].id]);
	assert.equal(ids.size, 1, 'one thread: ' + [...ids].join(', '));
	assert.equal(await Chat.count({ where: { user: writer.id } }), 1);
});
