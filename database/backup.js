import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rename, rm, stat, readFile, chmod, link } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Sequelize } from 'sequelize';
import { sequelize } from './connection.js';
import { backups, dbStorage, uploadDir, encryptionMode } from '#constants';
import * as archive from '#services/backup-archive.js';
import { storedPath } from '#services/files.js';

/**
 * Backups: one encrypted file holding a consistent copy of the database and
 * the attachment files it refers to.
 *
 * - `runBackup()` is safe while the server runs: the copy is made by SQLite
 *   itself (VACUUM INTO, one read transaction), not by copying a file that a
 *   write-ahead log is still being folded into.
 * - The file is encrypted to BACKUP_PUBLIC_KEY. This machine never has the
 *   private key, so whoever takes the server does not also take its backups.
 * - `.env` is **not** in a backup. ENCRYPTION_KEY and JWT_SECRET are kept
 *   apart, by people, on purpose: in server mode a backup plus ENCRYPTION_KEY
 *   is every letter in plain text.
 * - `verifyBackup()` and `restoreBackup()` run where the private key lives:
 *   on the owner's own machine, from a checkout of this repository.
 */

const NAME = /^abc-backup-(\d{8}T\d{6}Z)\.abcbak$/;
const stamp = (date) =>
	date
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d+Z$/, 'Z');

/** Open a database file on its own, apart from the app's connection. */
function openDatabase(path) {
	return new Sequelize({ dialect: 'sqlite', storage: path, logging: false });
}

async function one(database, sql) {
	const [rows] = await database.query(sql);
	return rows[0] ? Object.values(rows[0])[0] : null;
}

/** What a database copy holds, for the manifest and for checking a restore against it. */
async function describe(database) {
	const tables = (
		await database.query("SELECT name FROM sqlite_master WHERE type = 'table'")
	)[0].map((row) => row.name);
	const count = async (table) =>
		tables.includes(table)
			? Number(await one(database, 'SELECT COUNT(*) FROM `' + table + '`'))
			: 0;
	return {
		users: await count('User'),
		letters: await count('Messages'),
		attachments: await count('Attachments'),
		lastMigration: tables.includes('SequelizeMeta')
			? await one(database, 'SELECT name FROM `SequelizeMeta` ORDER BY name DESC LIMIT 1')
			: null
	};
}

async function storedNames(database) {
	const [tables] = await database.query(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Attachments'"
	);
	if (tables.length === 0) {
		return [];
	}
	const [rows] = await database.query('SELECT `storedName` FROM `Attachments` ORDER BY `id`');
	return rows.map((row) => row.storedName);
}

/** The archives in a directory, newest first. */
export async function listBackups(dir = backups.dir) {
	let names = [];
	try {
		names = await readdir(dir);
	} catch (err) {
		if (err.code !== 'ENOENT') {
			throw err;
		}
	}
	const found = [];
	for (const name of names
		.filter((n) => NAME.test(n))
		.sort()
		.reverse()) {
		const info = await stat(join(dir, name));
		const [, when] = NAME.exec(name);
		const at = new Date(
			when.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')
		);
		found.push({ file: join(dir, name), name, bytes: info.size, at });
	}
	return found;
}

/**
 * For monitoring and the admin summary: is there a recent backup?
 * @returns {Promise<{configured: boolean, count: number, newest: {name: string, at: Date, bytes: number}|null, ageHours: number|null}>}
 */
export async function backupStatus({ dir = backups.dir, now = new Date() } = {}) {
	const all = await listBackups(dir);
	const newest = all[0] || null;
	return {
		configured: backups.publicKey !== '',
		count: all.length,
		newest: newest ? { name: newest.name, at: newest.at, bytes: newest.bytes } : null,
		ageHours: newest ? Math.round(((now - newest.at) / 3600000) * 10) / 10 : null
	};
}

let running = null;

/**
 * Make one backup. Overlapping calls in one process share a single run.
 * @param {{dir?: string, keep?: number, publicKey?: string, now?: Date, log?: Function}} [options]
 * @returns {Promise<{file: string, bytes: number, users: number, letters: number, attachments: number, missing: string[], removed: string[]}>}
 */
export async function runBackup(options = {}) {
	if (running) {
		return await running;
	}
	running = backup(options).finally(() => {
		running = null;
	});
	return await running;
}

async function backup({
	dir = backups.dir,
	keep = backups.keep,
	publicKey = backups.publicKey,
	now = new Date(),
	log = console.log
} = {}) {
	await archive.ready();
	if (!publicKey) {
		throw new Error(
			'BACKUP_PUBLIC_KEY is not set. Run `npm run backup:keygen` on your own computer (not on the server), keep the private key file there, and put the public key in .env here.'
		);
	}
	const recipient = archive.parseKey(publicKey, 'BACKUP_PUBLIC_KEY');
	if (dbStorage === ':memory:') {
		throw new Error('An in-memory database cannot be backed up.');
	}
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const work = await mkdtemp(join(dir, '.work-'));
	try {
		// SQLite's own consistent copy: one read transaction, safe beside a running
		// server, and it never sees a half-applied write-ahead log.
		const snapshot = join(work, 'database.sqlite');
		await sequelize.query('VACUUM INTO ' + sequelize.escape(snapshot));
		await chmod(snapshot, 0o600);

		// Which files belong is asked of the copy, not of the live table: the two
		// always agree with each other, whatever was uploaded or deleted meanwhile.
		const copy = openDatabase(snapshot);
		let about;
		let names;
		try {
			about = await describe(copy);
			names = await storedNames(copy);
		} finally {
			await copy.close();
		}
		const files = [{ name: 'database.sqlite', path: snapshot, size: (await stat(snapshot)).size }];
		const missing = [];
		for (const name of names) {
			const path = storedPath(name);
			try {
				files.push({ name: 'uploads/' + name, path, size: (await stat(path)).size });
			} catch (err) {
				// Gone is one thing: reported, and the rest is still worth having. A file
				// that is there and cannot be read (permissions, a failing disk) is
				// another: a backup that quietly leaves it out would look complete.
				if (err.code !== 'ENOENT') {
					throw err;
				}
				missing.push(name);
			}
		}

		const name = 'abc-backup-' + stamp(now) + '.abcbak';
		const partial = join(work, name);
		const plain = archive.tarStream(files, {
			format: archive.FORMAT,
			createdAt: now.toISOString(),
			encryptionMode,
			...about,
			missingAttachments: missing
		});
		await pipeline(
			Readable.from(archive.seal(plain, recipient, now)),
			createWriteStream(partial, { mode: 0o600 })
		);
		// Only a finished backup ever carries the name a backup has.
		const file = join(dir, name);
		await rename(partial, file);

		const removed = [];
		for (const old of (await listBackups(dir)).slice(Math.max(keep, 1))) {
			await rm(old.file);
			removed.push(old.name);
		}
		const bytes = (await stat(file)).size;
		log(
			'Backup: ' +
				file +
				' (' +
				bytes +
				' bytes; ' +
				about.letters +
				' letter(s), ' +
				(files.length - 1) +
				' attachment file(s)' +
				(missing.length ? ', ' + missing.length + ' MISSING from ' + uploadDir : '') +
				'), for key ' +
				archive.fingerprint(recipient) +
				'.' +
				(removed.length ? ' Removed ' + removed.length + ' old backup(s).' : '')
		);
		return { file, bytes, ...about, missing, removed };
	} finally {
		await rm(work, { recursive: true, force: true });
	}
}

/** Read the private key file `npm run backup:keygen` wrote. */
export async function readPrivateKey(path) {
	await archive.ready();
	const text = (await readFile(path, 'utf8'))
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith('#'))
		.join('');
	return archive.parseKey(text, 'The private key file');
}

/**
 * Decrypt and unpack a backup into `dir`, checking every file against the manifest.
 * @returns {Promise<object>} the manifest
 */
async function unpack(file, privateKey, dir) {
	await archive.ready();
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const hashes = new Map();
	await archive.untar(archive.unseal(createReadStream(file), privateKey), async (name, size) => {
		const path = resolve(dir, name);
		if (!path.startsWith(resolve(dir) + '/')) {
			throw new Error('The archive names a file outside itself: ' + name);
		}
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });
		const out = createWriteStream(path, { mode: 0o600 });
		const hash = createHash('sha256');
		return {
			write: (piece) =>
				new Promise((done, fail) => {
					hash.update(piece);
					out.write(piece, (err) => (err ? fail(err) : done()));
				}),
			close: () =>
				new Promise((done, fail) => {
					out.end((err) => {
						hashes.set(name, { size, sha256: hash.digest('hex') });
						return err ? fail(err) : done();
					});
				})
		};
	});
	let manifest;
	try {
		manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
	} catch {
		throw new Error('The backup has no readable manifest.');
	}
	for (const listed of manifest.files) {
		const got = hashes.get(listed.name);
		if (!got || got.size !== listed.size || got.sha256 !== listed.sha256) {
			throw new Error('The backup is damaged: ' + listed.name + ' is not what the manifest says.');
		}
	}
	return manifest;
}

/** Does the unpacked copy hold together? */
async function examine(dir, manifest) {
	const database = openDatabase(join(dir, 'database.sqlite'));
	try {
		const integrity = await one(database, 'PRAGMA integrity_check');
		if (integrity !== 'ok') {
			throw new Error('The database in the backup fails its integrity check: ' + integrity);
		}
		const [dangling] = await database.query('PRAGMA foreign_key_check');
		const about = await describe(database);
		for (const key of ['users', 'letters', 'attachments', 'lastMigration']) {
			if (about[key] !== manifest[key]) {
				throw new Error(
					'The database in the backup does not match its manifest (' +
						key +
						': ' +
						about[key] +
						', manifest ' +
						manifest[key] +
						').'
				);
			}
		}
		const have = new Set(manifest.files.map((f) => f.name));
		const without = (await storedNames(database)).filter((name) => !have.has('uploads/' + name));
		return { ...about, danglingReferences: dangling.length, attachmentsWithoutFile: without };
	} finally {
		await database.close();
	}
}

/**
 * Open a backup, check all of it, and leave nothing behind.
 * @returns {Promise<object>} what it holds
 * @throws {Error} wrong key, damaged, cut short, or inconsistent
 */
export async function verifyBackup(file, privateKey) {
	const dir = await mkdtemp(join(tmpdir(), 'abc-backup-verify-'));
	try {
		const manifest = await unpack(file, privateKey, dir);
		return {
			createdAt: manifest.createdAt,
			encryptionMode: manifest.encryptionMode,
			...(await examine(dir, manifest))
		};
	} finally {
		// The unpacked copy is the whole database in the clear.
		await rm(dir, { recursive: true, force: true });
	}
}

/**
 * Unpack a backup into a new directory. It never writes over a live database:
 * putting the files in place is a deliberate, separate step (the CLI prints it).
 */
export async function restoreBackup(file, privateKey, to) {
	let existing = [];
	try {
		existing = await readdir(to);
	} catch (err) {
		if (err.code !== 'ENOENT') {
			throw err;
		}
	}
	if (existing.length > 0) {
		throw new Error(
			to + ' is not empty. Restore into a new directory; nothing is ever overwritten.'
		);
	}
	try {
		const manifest = await unpack(file, privateKey, to);
		return {
			to,
			createdAt: manifest.createdAt,
			encryptionMode: manifest.encryptionMode,
			...(await examine(to, manifest))
		};
	} catch (err) {
		await rm(to, { recursive: true, force: true });
		throw err;
	}
}

/**
 * Decrypt a backup to a plain .tar, for any tar tool. `out` appears only once the
 * whole file has verified, and is never written over. A backup that turns out to
 * be damaged half way leaves nothing behind: what had been decrypted by then is
 * the database in the clear.
 */
export async function decryptBackup(file, privateKey, out) {
	await archive.ready();
	const partial = out + '.partial-' + process.pid;
	try {
		await pipeline(
			Readable.from(archive.unseal(createReadStream(file), privateKey)),
			createWriteStream(partial, { mode: 0o600, flags: 'wx' })
		);
		// link, not rename: it refuses to replace a file that is already there.
		await link(partial, out);
	} finally {
		await rm(partial, { force: true });
	}
	return out;
}

/** When a backup was made and for which key; needs no key. */
export async function describeBackup(file) {
	await archive.ready();
	const stream = createReadStream(file);
	try {
		return await archive.readHeader(stream);
	} finally {
		stream.destroy();
	}
}

/**
 * Make backups from inside the running server (BACKUP_EVERY_HOURS), for hosts
 * where setting up cron is one thing too many. It looks once an hour whether the
 * newest backup is older than that, so a restart neither skips one nor makes an
 * extra one. Failures are logged and tried again at the next look: a backup
 * that cannot be made must never take the server down.
 * @param {{log?: Function, everyHours?: number, clock?: () => Date}} [options] `clock` is for tests
 * @returns {NodeJS.Timeout|null} the timer, or null when this is switched off
 */
export function scheduleBackups({
	log = console.log,
	everyHours = backups.everyHours,
	clock = () => new Date()
} = {}) {
	if (!everyHours) {
		return null;
	}
	if (!backups.publicKey) {
		console.warn(
			'BACKUP_EVERY_HOURS is set and BACKUP_PUBLIC_KEY is not: no backups are being made. See "Backups" in the README.'
		);
		return null;
	}
	const look = async () => {
		try {
			const now = clock();
			const { ageHours } = await backupStatus({ now });
			if (ageHours === null || ageHours >= everyHours) {
				await runBackup({ log, now });
			}
		} catch (err) {
			console.error('[backup] no backup was made', err);
		}
	};
	look();
	return setInterval(look, Math.min(everyHours, 1) * 3600000).unref();
}
