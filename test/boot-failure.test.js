import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Start the real server as a child process; resolves when it exits. */
function boot(env, { stopAfter, onPort, patience = 20_000 } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['index.js'], {
			cwd: root,
			env: {
				PATH: process.env.PATH,
				DOTENV_CONFIG_PATH: '/dev/null',
				JWT_SECRET: 'test-secret',
				ENCRYPTION_KEY: 'dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktdGVzdCE=',
				DB_SEED: 'false',
				DB_LOGGING: 'false',
				NODE_ENV: 'test',
				...env
			}
		});
		let output = '';
		child.stdout.on('data', (chunk) => {
			output += chunk;
			const port = onPort && /running on port: (\d+)/.exec(output);
			if (port) {
				onPort(Number(port[1]));
				onPort = null;
			}
			if (stopAfter && output.includes(stopAfter)) {
				stopAfter = null;
				child.kill('SIGTERM');
			}
		});
		child.stderr.on('data', (chunk) => (output += chunk));
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			reject(new Error('the server neither stopped nor failed:\n' + output));
		}, patience);
		child.on('exit', (code, signal) => {
			clearTimeout(timer);
			resolve({ code, signal, output });
		});
	});
}

test('a server that cannot prepare its database stops, instead of reporting healthy', async () => {
	// A path under a plain file: no directory can be made there, so the database cannot open.
	const dir = mkdtempSync(join(tmpdir(), 'abc-boot-'));
	writeFileSync(join(dir, 'not-a-directory'), '');
	try {
		const { code, output } = await boot({
			DB_STORAGE: join(dir, 'not-a-directory', 'database.sqlite')
		});
		assert.equal(code, 1, output);
		assert.match(output, /Database setup failed/);
		assert.doesNotMatch(output, /Ready to serve requests/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('SIGTERM lets the server finish and leave cleanly', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'abc-boot-'));
	try {
		const { code, output } = await boot(
			{ DB_STORAGE: join(dir, 'database.sqlite') },
			{ stopAfter: 'Ready to serve requests.' }
		);
		assert.equal(code, 0, output);
		assert.match(output, /SIGTERM received/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('a failed boot stops even while a request is still open', async () => {
	// Connections are accepted before the database is ready. One that never ends
	// must not keep alive a server that has no database.
	const dir = mkdtempSync(join(tmpdir(), 'abc-boot-'));
	writeFileSync(join(dir, 'not-a-directory'), '');
	const sockets = [];
	try {
		const { code, output } = await boot(
			{ DB_STORAGE: join(dir, 'not-a-directory', 'database.sqlite'), PORT: '0' },
			{
				onPort: (port) => {
					// Half a request: headers begun, never finished.
					const socket = connect(port, '127.0.0.1', () =>
						socket.write('POST /auth/login HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\n{')
					);
					socket.on('error', () => {});
					sockets.push(socket);
				}
			}
		);
		assert.equal(code, 1, output);
	} finally {
		sockets.forEach((socket) => socket.destroy());
		rmSync(dir, { recursive: true, force: true });
	}
});

for (const storage of ['a file', ':memory:']) {
	test('a fresh seeded start on ' + storage + ' becomes ready', async () => {
		// New developer set-ups and CI-like starts: every table made, every seed loaded,
		// forty letters saved with their threads and keys. It hung from #101 to this fix,
		// and no test started the server this way.
		const dir = mkdtempSync(join(tmpdir(), 'abc-boot-'));
		try {
			const { code, output } = await boot(
				{
					DB_STORAGE: storage === ':memory:' ? ':memory:' : join(dir, 'database.sqlite'),
					UPLOAD_DIR: join(dir, 'uploads'),
					DB_RESET: 'true',
					DB_SEED: 'true'
				},
				{ stopAfter: 'Ready to serve requests.', patience: 60_000 }
			);
			assert.equal(code, 0, output);
			assert.match(output, /messages: 40 seeded/, output);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
}
