import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Start the real server as a child process; resolves when it exits. */
function boot(env, { stopAfter } = {}) {
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
			if (stopAfter && output.includes(stopAfter)) {
				stopAfter = null;
				child.kill('SIGTERM');
			}
		});
		child.stderr.on('data', (chunk) => (output += chunk));
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			reject(new Error('the server neither stopped nor failed:\n' + output));
		}, 20_000);
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
