import { sequelize } from './connection.js';
import * as Models from '#models/all.model.js';
import * as crypto from '#services/crypto.js';

/**
 * Prepare a server-mode database for ENCRYPTION_MODE=e2e.
 *
 * For every letter with a server envelope, unwrap the content key with
 * ENCRYPTION_KEY and seal it to each permitted reader that already has a
 * public key: the writer, the relay group, and the group managing the
 * writer. Bodies and files are untouched. Letters whose readers have no
 * keys yet are reported and left as they are; run again after those
 * accounts set up keys. Server envelopes are only deleted with
 * `--drop-server-keys`, and only for letters every required reader can open.
 *
 * Usage: node database/rewrap-e2e.js [--drop-server-keys] [--dry-run]
 */

export async function rewrapForE2E({
	dropServerKeys = false,
	dryRun = false,
	log = console.log
} = {}) {
	await crypto.ready;
	crypto.masterKey();
	const { Message, LetterKey, User, Chapter } = Models;
	const serverRows = await LetterKey.findAll({ where: { readerType: 'server' } });
	const report = { letters: serverRows.length, sealed: 0, skipped: [], dropped: 0, writerOnly: [] };
	for (const row of serverRows) {
		const message = await Message.findByPk(row.message);
		if (!message) {
			continue;
		}
		const contentKey = crypto.unwrapForServer(row.wrappedKey);
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
			const chapter = await Chapter.findByPk(chapterId, { attributes: ['id', 'publicKey'] });
			if (chapter && chapter.publicKey) {
				readers.push({ readerType: 'chapter', readerId: chapter.id, publicKey: chapter.publicKey });
			} else {
				missing.push('chapter ' + chapterId);
			}
		}
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
					keyLabel: null
				});
			}
			report.sealed += 1;
		}
		if (missing.length > 0) {
			report.skipped.push({ message: message.id, missing });
		} else {
			if (chapterIds.size === 0 && writer && !writer.anonymousForChapter) {
				// Only the writer can open this letter after the switch; a relay
				// can still be added by forwarding, but nobody else can print it.
				report.writerOnly.push(message.id);
			}
			if (dropServerKeys) {
				if (!dryRun) {
					await row.destroy();
				}
				report.dropped += 1;
			}
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
			(dropServerKeys
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
		log('  letter ' + item.message + ': no public key for ' + item.missing.join(', '));
	}
	return report;
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
	const args = new Set(process.argv.slice(2));
	const db = await import('./sql-database.js');
	await db.ready;
	await rewrapForE2E({
		dropServerKeys: args.has('--drop-server-keys'),
		dryRun: args.has('--dry-run')
	});
	await sequelize.close();
}
