import { sequelize } from './connection.js';
import * as Models from '#models/all.model.js';
import * as crypto from '#services/crypto.js';
import { Op } from 'sequelize';

/**
 * Prepare a server-mode database for ENCRYPTION_MODE=e2e.
 *
 * For every letter with a server envelope, unwrap the content key with
 * ENCRYPTION_KEY and seal it to each permitted reader that already has a
 * public key: the writer, the relay group, and the group managing the
 * writer. Bodies and files are untouched. Letters whose readers have no
 * keys yet are reported and left as they are; run again after those
 * accounts set up keys (or let `catchUpReader` do it when they do).
 *
 * `--drop-server-keys` deletes the server's copy only for letters every
 * required reader can open. `--drop-all-server-keys` is the final cut-off:
 * it deletes the rest too, and readers who never set up keys lose those
 * letters for good.
 *
 * Usage: node database/rewrap-e2e.js [--drop-server-keys | --drop-all-server-keys] [--dry-run]
 */

/** Can this process still open server envelopes? False once ENCRYPTION_KEY is gone. */
function serverKeyAvailable() {
	try {
		crypto.masterKey();
		return true;
	} catch {
		return false;
	}
}

/**
 * Seal one server-held letter to every permitted reader that has a public
 * key and no envelope yet.
 * @param {object} row the letter's server envelope
 * @param {{dryRun: boolean}} options
 * @returns {Promise<{message: number, sealed: number, missing: string[], writerOnly: boolean}|null>} null when the letter is gone
 */
async function sealToReaders(row, { dryRun }) {
	const { Message, LetterKey, User, Chapter } = Models;
	const message = await Message.findByPk(row.message);
	if (!message) {
		return null;
	}
	const contentKey = crypto.unwrapForServer(row.wrappedKey, row.keyLabel);
	const writer = await User.findByPk(message.user, {
		attributes: ['id', 'publicKey', 'managedBy', 'anonymousForChapter']
	});
	const readers = [];
	const missing = [];
	if (writer && !writer.anonymousForChapter) {
		if (writer.publicKey) {
			readers.push({ readerType: 'user', readerId: writer.id, publicKey: writer.publicKey });
		} else {
			missing.push('user ' + writer.id);
		}
	}
	const chapterIds = new Set();
	if (message.relayChapter) {
		chapterIds.add(message.relayChapter);
	}
	if (writer && writer.managedBy) {
		chapterIds.add(writer.managedBy);
	}
	for (const chapterId of chapterIds) {
		const chapter = await Chapter.findByPk(chapterId, {
			attributes: ['id', 'publicKey', 'keyVersion']
		});
		if (chapter && chapter.publicKey) {
			readers.push({
				readerType: 'chapter',
				readerId: chapter.id,
				publicKey: chapter.publicKey,
				keyVersion: chapter.keyVersion
			});
		} else {
			missing.push('chapter ' + chapterId);
		}
	}
	let sealed = 0;
	for (const reader of readers) {
		const exists = await LetterKey.findOne({
			where: { message: message.id, readerType: reader.readerType, readerId: reader.readerId }
		});
		if (exists) {
			continue;
		}
		if (!dryRun) {
			await LetterKey.create({
				message: message.id,
				readerType: reader.readerType,
				readerId: reader.readerId,
				wrappedKey: crypto.sealTo(reader.publicKey, contentKey),
				keyLabel: null,
				keyVersion: reader.keyVersion ?? null
			});
		}
		sealed += 1;
	}
	return {
		message: message.id,
		sealed,
		missing,
		// Only the writer can open this letter after the switch; a relay can
		// still be added by forwarding, but nobody else can print it.
		writerOnly: chapterIds.size === 0 && Boolean(writer) && !writer.anonymousForChapter
	};
}

/**
 * @param {{dropServerKeys?: boolean, dropAllServerKeys?: boolean, dryRun?: boolean, log?: Function}} options
 *   `dropServerKeys`: delete the server's copy of letters every required reader can now open.
 *   `dropAllServerKeys`: also delete it for letters that still wait for a reader; those readers lose the letter for good.
 */
export async function rewrapForE2E({
	dropServerKeys = false,
	dropAllServerKeys = false,
	dryRun = false,
	log = console.log
} = {}) {
	await crypto.ready;
	crypto.masterKey();
	const { LetterKey } = Models;
	const serverRows = await LetterKey.findAll({ where: { readerType: 'server' } });
	const report = {
		letters: serverRows.length,
		sealed: 0,
		skipped: [],
		dropped: 0,
		abandoned: [],
		writerOnly: []
	};
	const dropping = dropServerKeys || dropAllServerKeys;
	for (const row of serverRows) {
		const result = await sealToReaders(row, { dryRun });
		if (!result) {
			continue;
		}
		report.sealed += result.sealed;
		const covered = result.missing.length === 0;
		if (!covered) {
			report.skipped.push({ message: result.message, missing: result.missing });
		} else if (result.writerOnly) {
			report.writerOnly.push(result.message);
		}
		if ((covered && dropping) || dropAllServerKeys) {
			if (!covered) {
				report.abandoned.push({ message: result.message, missing: result.missing });
			}
			if (!dryRun) {
				await row.destroy();
			}
			report.dropped += 1;
		}
	}
	log(
		'Re-wrapped ' +
			report.sealed +
			' envelope(s) across ' +
			report.letters +
			' letter(s); ' +
			report.skipped.length +
			' letter(s) still need reader keys' +
			(dropping
				? '; ' + (dryRun ? 'would drop ' : 'dropped ') + report.dropped + ' server envelope(s).'
				: '.')
	);
	if (report.writerOnly.length > 0) {
		log(
			'  ' +
				report.writerOnly.length +
				' letter(s) have no relay or managing group and will be readable by the writer only: ' +
				report.writerOnly.join(', ')
		);
	}
	for (const item of report.skipped) {
		log(
			'  letter ' +
				item.message +
				': no public key for ' +
				item.missing.join(', ') +
				(dropAllServerKeys
					? (dryRun ? ' (would be' : ' (now') + ' unreadable to them for good)'
					: '')
		);
	}
	return report;
}

/**
 * A reader has just got keys: seal to them every letter the server still
 * holds a key for and they are a reader of. This is what lets the switch
 * happen without waiting for everybody: a straggler's old letters wait
 * under the server's key and become theirs the day they turn up.
 *
 * In e2e mode the server's copy of a letter is dropped as soon as every
 * required reader has their own. Does nothing, quietly, when
 * ENCRYPTION_KEY is no longer configured: then there is nothing the server
 * could open.
 *
 * @param {{readerType: 'user'|'chapter', readerId: number}} reader
 * @returns {Promise<{letters: number, sealed: number, dropped: number}|null>} null when the server key is gone
 */
export async function catchUpReader({ readerType, readerId }) {
	await crypto.ready;
	if (!serverKeyAvailable()) {
		return null;
	}
	const { Message, LetterKey, User } = Models;
	let where;
	if (readerType === 'user') {
		where = { user: readerId };
	} else {
		const managed = await User.findAll({ where: { managedBy: readerId }, attributes: ['id'] });
		where = {
			[Op.or]: [{ relayChapter: readerId }, { user: managed.map((writer) => writer.id) }]
		};
	}
	const messages = await Message.unscoped().findAll({ where, attributes: ['id'], hooks: false });
	const report = { letters: 0, sealed: 0, dropped: 0 };
	if (messages.length === 0) {
		return report;
	}
	const serverRows = await LetterKey.findAll({
		where: { readerType: 'server', message: messages.map((message) => message.id) }
	});
	for (const row of serverRows) {
		const result = await sealToReaders(row, { dryRun: false });
		if (!result) {
			continue;
		}
		report.letters += 1;
		report.sealed += result.sealed;
		// Let go of the server's copy only when every reader's envelope is good: a
		// group envelope sealed to a key that was rotated away meanwhile is not.
		if (
			crypto.isE2E() &&
			result.missing.length === 0 &&
			(await LetterKey.staleGroupEnvelopes(row.message)).length === 0
		) {
			await row.destroy();
			report.dropped += 1;
		}
	}
	return report;
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
	const args = new Set(process.argv.slice(2));
	const db = await import('./sql-database.js');
	await db.ready;
	await rewrapForE2E({
		dropServerKeys: args.has('--drop-server-keys'),
		dropAllServerKeys: args.has('--drop-all-server-keys'),
		dryRun: args.has('--dry-run')
	});
	await sequelize.close();
}
