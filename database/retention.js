import { sequelize } from './connection.js';
import * as Models from '#models/all.model.js';
import { retentionDefaultDays, retentionMaxDays } from '#constants';

/**
 * Delete letters and replies that have outlived their writer's retention
 * window. A letter counts from the moment it was mailed; a reply from the
 * moment it was recorded (both are `statusChangedAt`). Queued and printed
 * letters are never touched, nor is a letter the writer pinned with `keep`.
 *
 * The window is the writer's `retentionDays`, else the site default, capped
 * by RETENTION_MAX_DAYS when set. 0 means forever (unless a cap applies).
 * Attachments, envelopes, and history go with the letter; a chat emptied
 * by the run is removed too. Runs at boot and every few hours, and by hand
 * with `npm run retention [-- --dry-run]`.
 */

/** The window that applies to a writer, in days; null means keep forever. */
export function windowFor(writer) {
	let days =
		writer && writer.retentionDays !== null && writer.retentionDays !== undefined
			? writer.retentionDays
			: retentionDefaultDays;
	if (retentionMaxDays !== null && (days === 0 || days > retentionMaxDays)) {
		days = retentionMaxDays;
	}
	return days === 0 ? null : days;
}

export async function runRetention({ dryRun = false, now = new Date(), log = console.log } = {}) {
	const { Message, User, Chat, AuditLog, Attachment } = Models;
	const candidates = await Message.findAll({
		where: { status: ['mailed', 'received'], keep: false },
		attributes: ['id', 'user', 'chat', 'status', 'statusChangedAt', 'createdAt'],
		hooks: false
	});
	const writers = new Map();
	const report = {
		examined: candidates.length,
		letters: 0,
		replies: 0,
		attachments: 0,
		chats: 0,
		dryRun
	};
	const touchedChats = new Set();
	for (const message of candidates) {
		if (!writers.has(message.user)) {
			writers.set(
				message.user,
				await User.findByPk(message.user, { attributes: ['id', 'retentionDays'] })
			);
		}
		const days = windowFor(writers.get(message.user));
		if (days === null) {
			continue;
		}
		const since = message.statusChangedAt || message.createdAt;
		if (!since || now.getTime() - new Date(since).getTime() < days * 24 * 60 * 60 * 1000) {
			continue;
		}
		report[message.status === 'received' ? 'replies' : 'letters'] += 1;
		report.attachments += await Attachment.count({ where: { message: message.id } });
		touchedChats.add(message.chat);
		if (!dryRun) {
			await Message.deleteMessage(message.id);
		}
	}
	if (!dryRun) {
		for (const chatId of touchedChats) {
			const left = await Message.count({ where: { chat: chatId } });
			if (left === 0) {
				report.chats += await Chat.destroy({ where: { id: chatId } });
			}
		}
		if (report.letters + report.replies > 0) {
			await AuditLog.record({
				actor: null,
				action: 'retention.run',
				resource: 'message',
				targetId: null,
				details: {
					letters: report.letters,
					replies: report.replies,
					attachments: report.attachments,
					chats: report.chats
				}
			});
			// Deleted pages are reused but not returned; a seized file would still hold the bytes.
			await sequelize.query('VACUUM');
		}
	} else {
		report.chats = [...touchedChats].length;
	}
	log(
		(dryRun ? 'Retention (dry run): would delete ' : 'Retention: deleted ') +
			report.letters +
			' letter(s), ' +
			report.replies +
			' reply(ies), ' +
			report.attachments +
			' attachment(s)' +
			(dryRun ? '' : ', ' + report.chats + ' emptied chat(s)') +
			' of ' +
			report.examined +
			' examined.'
	);
	return report;
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
	const args = new Set(process.argv.slice(2));
	await import('./sql-database.js');
	await runRetention({ dryRun: args.has('--dry-run') });
	await sequelize.close();
}
