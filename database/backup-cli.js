import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sequelize } from './connection.js';
import * as archive from '#services/backup-archive.js';
import {
	runBackup,
	verifyBackup,
	restoreBackup,
	decryptBackup,
	describeBackup,
	backupStatus,
	readPrivateKey
} from './backup.js';
import { backups, dbStorage, uploadDir } from '#constants';

/**
 * Backups from the command line. Opens the database by itself (no migrations,
 * no seeding, no server), so `npm run backup` is safe beside a running API.
 *
 *   npm run backup                                       make one (on the server; cron calls this)
 *   npm run backup:status [-- --max-age-hours 26]        newest backup; exit 1 if none or too old
 *   npm run backup:keygen [-- --out <file>]              ON YOUR OWN COMPUTER: make the keypair
 *   npm run backup:verify -- <file> --key <key file>     on your own computer: open it and check everything
 *   npm run backup:restore -- <file> --key <key file> --to <new dir>
 *   npm run backup:decrypt -- <file> --key <key file> --out <file.tar>
 */

const [command = 'run', ...rest] = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i += 1) {
	if (rest[i].startsWith('--')) {
		flags[rest[i].slice(2)] = rest[i + 1];
		i += 1;
	} else {
		positional.push(rest[i]);
	}
}

const need = (value, what) => {
	if (!value) {
		throw new Error(
			'Missing ' + what + '. See the top of database/backup-cli.js for the commands.'
		);
	}
	return value;
};

const show = (what) => console.log(JSON.stringify(what, null, 2));

const commands = {
	async run() {
		await runBackup({ dir: flags.to || backups.dir });
	},

	async status() {
		const status = await backupStatus({ dir: flags.dir || backups.dir });
		show(status);
		const limit = Number(flags['max-age-hours']);
		if (!status.newest || (Number.isFinite(limit) && status.ageHours > limit)) {
			process.exitCode = 1;
		}
	},

	async keygen() {
		await archive.ready();
		const out = resolve(flags.out || 'abc-backup-private.key');
		const pair = archive.generateKeypair();
		const id = archive.fingerprint(archive.parseKey(pair.publicKey, 'The public key'));
		// 'wx': never write over a key that may be the only one that opens a year of backups.
		await writeFile(
			out,
			'# letters.support backup PRIVATE key ' +
				id +
				'. It opens every backup made for it.\n' +
				'# Keep it off the server. Keep a second copy somewhere else. Without it the backups are noise.\n' +
				pair.privateKey +
				'\n',
			{ mode: 0o600, flag: 'wx' }
		);
		console.log('Private key written to ' + out + ' (key ' + id + ').');
		console.log('Keep it OFF the server, and keep a second copy in another place.');
		console.log('\nPut this line in the .env of the server:\n');
		console.log('BACKUP_PUBLIC_KEY=' + pair.publicKey);
	},

	async info() {
		show(await describeBackup(need(positional[0], 'the backup file')));
	},

	async verify() {
		const key = await readPrivateKey(need(flags.key, '--key <private key file>'));
		const result = await verifyBackup(need(positional[0], 'the backup file'), key);
		show(result);
		if (result.attachmentsWithoutFile.length > 0) {
			console.error(
				result.attachmentsWithoutFile.length +
					' attachment(s) are in the database and have no file in the backup.'
			);
			process.exitCode = 1;
		} else {
			console.log('The backup opens, every file matches its checksum, and the database is sound.');
		}
	},

	async restore() {
		const key = await readPrivateKey(need(flags.key, '--key <private key file>'));
		const to = resolve(need(flags.to, '--to <new directory>'));
		show(await restoreBackup(need(positional[0], 'the backup file'), key, to));
		console.log('\nRestored into ' + to + '. Nothing else was touched. To put it in place:');
		console.log('  1. stop the API');
		console.log(
			'  2. move the current ' +
				dbStorage +
				' (and its -wal and -shm files) and ' +
				uploadDir +
				'/ aside'
		);
		console.log(
			'  3. copy ' +
				to +
				'/database.sqlite to ' +
				dbStorage +
				' and ' +
				to +
				'/uploads/ to ' +
				uploadDir +
				'/'
		);
		console.log(
			'  4. make sure .env has the ENCRYPTION_KEY this database was written with, and start the API'
		);
		console.log('Everyone signed in since the backup was made is signed out, by design.');
	},

	async decrypt() {
		const key = await readPrivateKey(need(flags.key, '--key <private key file>'));
		const out = await decryptBackup(
			need(positional[0], 'the backup file'),
			key,
			resolve(need(flags.out, '--out <file.tar>'))
		);
		console.log(
			'Decrypted to ' +
				out +
				'. It is the whole database in the clear: delete it when you are done.'
		);
	}
};

try {
	await need(commands[command], 'a known command (got "' + command + '")')();
} catch (err) {
	console.error('backup: ' + err.message);
	process.exitCode = 1;
} finally {
	await sequelize.close();
}
