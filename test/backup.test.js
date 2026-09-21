import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
	mkdtempSync,
	rmSync,
	readFileSync,
	writeFileSync,
	existsSync,
	readdirSync,
	statSync
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Sequelize } from 'sequelize';

// A database on disk with an attachment: what a backup is for.
const dir = mkdtempSync(join(tmpdir(), 'abc-backup-'));
process.env.DOTENV_CONFIG_PATH = '/dev/null';
process.env.JWT_SECRET = 'test-secret-that-must-not-be-backed-up';
process.env.DB_STORAGE = join(dir, 'live.sqlite');
process.env.DB_RESET = 'false';
process.env.DB_SEED = 'false';
process.env.DB_LOGGING = 'false';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_MODE = 'server';
process.env.ENCRYPTION_KEY = 'dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktdGVzdCE=';
process.env.UPLOAD_DIR = join(dir, 'uploads');
process.env.BACKUP_DIR = join(dir, 'backups');

const archive = await import('../services/backup-archive.js');
await archive.ready();
const keys = archive.generateKeypair();
const stranger = archive.generateKeypair();
process.env.BACKUP_PUBLIC_KEY = keys.publicKey;

const db = await import('../database/sql-database.js');
const {
	scheduleBackups,
	runBackup,
	verifyBackup,
	restoreBackup,
	decryptBackup,
	describeBackup,
	backupStatus,
	listBackups
} = await import('../database/backup.js');
await db.ready;
after(async () => {
	await db.sequelize.close();
	rmSync(dir, { recursive: true, force: true });
});

const privateKey = archive.parseKey(keys.privateKey, 'key');
const quiet = { log: () => {} };
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300 * 1024, 0x41)]);
let letter;
let attachment;

test('set the scene: a writer, a letter, and a scan', async () => {
	const { User, Prison, Prisoner, Message, Attachment } = db;
	const user = await User.createUser({
		username: 'backedup',
		password: 'a-password-in-the-database',
		email: 'backedup@example.com',
		role: 'user'
	});
	const prison = await Prison.createPrison({
		prisonName: 'Backup Prison',
		address: { street: '1 Main' }
	});
	const prisoner = await Prisoner.createPrisoner({
		birthName: 'Kept Safe',
		prison: prison.id,
		inmateID: 'B-1'
	});
	letter = await Message.createLetter({
		user: user.id,
		prisoner: prisoner.id,
		sender: 'user',
		messageText: 'Words worth keeping'
	});
	attachment = await Attachment.attach({
		message: letter.id,
		buffer: PDF,
		mimeType: 'application/pdf',
		originalName: 'scan.pdf',
		uploadedBy: user.id
	});
	assert.ok(attachment.id);
});

test('a backup is one encrypted file the server cannot open, holding the database and the files', async () => {
	const made = await runBackup({ ...quiet, now: new Date('2026-09-21T10:00:00Z') });
	assert.match(made.file, /abc-backup-20260921T100000Z\.abcbak$/);
	assert.deepEqual([made.users, made.letters, made.attachments, made.missing], [1, 1, 1, []]);
	assert.equal(statSync(made.file).mode & 0o777, 0o600);

	// Nothing readable in it: not a username, not the SQLite signature, not the scan.
	const bytes = readFileSync(made.file);
	for (const secret of [
		'backedup',
		'SQLite format 3',
		'AAAAAAAAAAAAAAAA',
		'test-secret-that-must-not',
		'dGVzdC1rZXk'
	]) {
		assert.ok(!bytes.includes(secret), secret + ' is readable in the backup');
	}
	// No working files are left beside it.
	assert.deepEqual(readdirSync(process.env.BACKUP_DIR), ['abc-backup-20260921T100000Z.abcbak']);

	// Anyone can see when it was made and for which key; only the key opens it.
	const header = await describeBackup(made.file);
	assert.equal(header.recipient, archive.fingerprint(archive.parseKey(keys.publicKey, 'key')));
	assert.equal(header.createdAt, '2026-09-21T10:00:00.000Z');

	const checked = await verifyBackup(made.file, privateKey);
	assert.deepEqual(
		[
			checked.users,
			checked.letters,
			checked.attachments,
			checked.attachmentsWithoutFile,
			checked.danglingReferences
		],
		[1, 1, 1, [], 0]
	);
	assert.equal(checked.encryptionMode, 'server');
	assert.ok(checked.lastMigration);
});

test('a restore goes into a new directory and is the same database with the same files', async () => {
	const [newest] = await listBackups();
	const to = join(dir, 'restored');
	const result = await restoreBackup(newest.file, privateKey, to);
	assert.equal(result.letters, 1);

	const restored = new Sequelize({
		dialect: 'sqlite',
		storage: join(to, 'database.sqlite'),
		logging: false
	});
	const [[user]] = await restored.query("SELECT username FROM User WHERE username = 'backedup'");
	assert.equal(user.username, 'backedup');
	const [[file]] = await restored.query('SELECT storedName FROM Attachments');
	await restored.close();
	const original = readFileSync(join(process.env.UPLOAD_DIR, file.storedName));
	assert.ok(readFileSync(join(to, 'uploads', file.storedName)).equals(original));
	// The keys that open the letters are kept apart from the backup, on purpose.
	assert.deepEqual(readdirSync(to).sort(), ['database.sqlite', 'manifest.json', 'uploads']);
	assert.ok(!readFileSync(join(to, 'manifest.json'), 'utf8').includes('dGVzdC1rZXk'));

	// It never writes over anything.
	await assert.rejects(restoreBackup(newest.file, privateKey, to), /not empty/);
});

test('decrypted, it is an ordinary tar archive', async () => {
	const [newest] = await listBackups();
	const out = join(dir, 'plain.tar');
	await decryptBackup(newest.file, privateKey, out);
	const tar = readFileSync(out);
	assert.equal(tar.toString('utf8', 0, 15), 'database.sqlite');
	assert.equal(tar.toString('utf8', 257, 262), 'ustar');
	assert.equal(tar.length % 512, 0);
	await assert.rejects(decryptBackup(newest.file, privateKey, out), /EEXIST/);
});

test('the wrong key, a changed byte, and a file cut short are each refused', async () => {
	const [newest] = await listBackups();
	await assert.rejects(
		verifyBackup(newest.file, archive.parseKey(stranger.privateKey, 'key')),
		/does not open this backup/
	);
	const good = readFileSync(newest.file);

	const flipped = Buffer.from(good);
	flipped[flipped.length - 100] ^= 1;
	const tampered = join(dir, 'tampered.abcbak');
	writeFileSync(tampered, flipped);
	await assert.rejects(verifyBackup(tampered, privateKey), /damaged or was changed/);

	// Cut exactly between two chunks: every chunk left still verifies, and it is still noticed.
	const headerLength = good.readUInt32BE(8);
	let at = 12 + headerLength;
	at += 4 + good.readUInt32BE(at);
	assert.ok(at < good.length, 'the scan makes the backup more than one chunk long');
	const cut = join(dir, 'cut.abcbak');
	writeFileSync(cut, good.subarray(0, at));
	await assert.rejects(verifyBackup(cut, privateKey), /cut short/);

	writeFileSync(join(dir, 'not.abcbak'), 'hello');
	await assert.rejects(
		verifyBackup(join(dir, 'not.abcbak'), privateKey),
		/not a backup|middle of a record/
	);
	// Nothing in the clear is left in the temporary directory by a failed or a good verify.
	assert.deepEqual(
		readdirSync(tmpdir()).filter((name) => name.startsWith('abc-backup-verify-')),
		[]
	);
});

test('a file that went missing is reported, and the backup is still made', async () => {
	const stored = (await db.Attachment.scope('withStoredName').findByPk(attachment.id)).storedName;
	const path = join(process.env.UPLOAD_DIR, stored);
	const bytes = readFileSync(path);
	rmSync(path);
	try {
		const made = await runBackup({ ...quiet, now: new Date('2026-09-21T11:00:00Z') });
		assert.deepEqual(made.missing, [stored]);
		const checked = await verifyBackup(made.file, privateKey);
		assert.deepEqual(checked.attachmentsWithoutFile, [stored]);
	} finally {
		writeFileSync(path, bytes);
	}
});

test('old backups are removed, the newest are kept, and the status says how old the newest is', async () => {
	await runBackup({ ...quiet, keep: 2, now: new Date('2026-09-21T12:00:00Z') });
	assert.deepEqual(
		(await listBackups()).map((b) => b.name),
		['abc-backup-20260921T120000Z.abcbak', 'abc-backup-20260921T110000Z.abcbak']
	);
	const status = await backupStatus({ now: new Date('2026-09-21T18:00:00Z') });
	assert.deepEqual(
		[status.configured, status.count, status.newest.name, status.ageHours],
		[true, 2, 'abc-backup-20260921T120000Z.abcbak', 6]
	);
});

test('without a public key there is no backup, and the error says what to do', async () => {
	await assert.rejects(
		runBackup({ ...quiet, publicKey: '' }),
		/BACKUP_PUBLIC_KEY is not set.*backup:keygen/
	);
	await assert.rejects(runBackup({ ...quiet, publicKey: 'not-a-key' }), /base64 of a 32-byte key/);
	assert.ok(!existsSync(join(process.env.BACKUP_DIR, '.work')));
	assert.deepEqual(
		readdirSync(process.env.BACKUP_DIR).filter((name) => name.startsWith('.')),
		[]
	);
});

test('a backup made while letters are being written is consistent', async () => {
	const { Message } = db;
	const writing = (async () => {
		for (let i = 0; i < 25; i += 1) {
			await Message.createLetter({
				user: letter.user,
				prisoner: letter.prisoner,
				sender: 'user',
				messageText: 'Written during the backup ' + i
			});
		}
	})();
	const made = await runBackup({ ...quiet, now: new Date('2026-09-21T13:00:00Z') });
	await writing;
	const checked = await verifyBackup(made.file, privateKey);
	assert.equal(checked.danglingReferences, 0);
	assert.ok(checked.letters >= 1 && checked.letters <= 26, 'a moment in time: ' + checked.letters);
});

test('the server makes one by itself when the newest is older than BACKUP_EVERY_HOURS, and only then', async () => {
	assert.equal(scheduleBackups({ ...quiet, everyHours: 0 }), null, 'off unless asked for');
	const before = (await listBackups()).length;
	// The newest is from "13:00 on 21 September 2026": older than an hour whenever this runs.
	const timer = scheduleBackups({ ...quiet, everyHours: 1 });
	try {
		for (let i = 0; i < 100 && (await listBackups()).length === before; i += 1) {
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		assert.equal((await listBackups()).length, before + 1);
	} finally {
		clearInterval(timer);
	}
	// A restart a minute later finds a fresh one and makes nothing.
	const again = scheduleBackups({ ...quiet, everyHours: 1 });
	await new Promise((resolve) => setTimeout(resolve, 150));
	clearInterval(again);
	assert.equal((await listBackups()).length, before + 1);
});
