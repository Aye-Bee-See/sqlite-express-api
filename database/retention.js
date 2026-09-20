import { Op, literal } from 'sequelize';
import { sequelize } from './connection.js';
import * as Models from '#models/all.model.js';
import { retentionDefaultDays, retentionMaxDays } from '#constants';
import { removeFile } from '#services/files.js';
import { SETTLED_STATUSES } from '#db/letter-status.js';

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
 * with `npm run retention [-- --dry-run]` (see retention-cli.js).
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

/**
 * Delete one letter only if it is still purgeable at that instant (mailed
 * or received, and not pinned since the run started). Attachment files are
 * listed first because the database cascade removes their rows.
 * @returns {Promise<{deleted: boolean, attachments: number}>}
 */
export async function purgeIfUnpinned(messageId) {
	const { Message, Attachment } = Models;
	const files = await Attachment.scope('withStoredName').findAll({
		where: { message: messageId },
		attributes: ['id', 'storedName']
	});
	const deleted = await Message.destroy({
		where: { id: messageId, keep: false, status: SETTLED_STATUSES },
		force: true
	});
	if (deleted === 0) {
		return { deleted: false, attachments: 0 };
	}
	for (const file of files) {
		await removeFile(file.storedName);
	}
	return { deleted: true, attachments: files.length };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Writers are read in batches: SQLite limits how many values one IN list may hold. */
const WRITER_BATCH = 500;

/**
 * The shortest window any writer has, in days; null when every letter is kept
 * for ever. A writer's own setting can be shorter than the site default.
 */
async function shortestWindow(User) {
	const own = await User.min('retentionDays', { where: { retentionDays: { [Op.gt]: 0 } } });
	const windows = [windowFor(null), windowFor({ retentionDays: own ?? null })].filter(
		(days) => days !== null
	);
	return windows.length === 0 ? null : Math.min(...windows);
}

/**
 * Writers who chose "for ever" (0), when no site maximum overrides them: their
 * letters are never due, so they are not read at all.
 */
function keptForEver() {
	if (retentionMaxDays !== null) {
		return {};
	}
	// A subquery, not a list of ids: there may be many such writers.
	return {
		user: { [Op.notIn]: literal('(SELECT `id` FROM `User` WHERE `retentionDays` = 0)') }
	};
}

let running = null;

export async function runRetention(options = {}) {
	// The boot run, the timer, and a manual run in the same process never overlap.
	if (running) {
		return await running;
	}
	running = run(options).finally(() => {
		running = null;
	});
	return await running;
}

async function run({ dryRun = false, now = new Date(), log = console.log } = {}) {
	const { Message, User, Chat, AuditLog, Attachment } = Models;
	// Nothing younger than the shortest window anyone has can be due, so the
	// database leaves those rows out: the run reads the letters that may go, not
	// every letter ever mailed.
	const shortest = await shortestWindow(User);
	const cutoff = shortest === null ? null : new Date(now.getTime() - shortest * DAY_MS);
	const candidates =
		cutoff === null
			? []
			: await Message.findAll({
					where: {
						status: SETTLED_STATUSES,
						keep: false,
						...keptForEver(),
						[Op.or]: [
							{ statusChangedAt: { [Op.lte]: cutoff } },
							{ statusChangedAt: null, createdAt: { [Op.lte]: cutoff } }
						]
					},
					attributes: ['id', 'user', 'chat', 'status', 'statusChangedAt', 'createdAt'],
					hooks: false
				});
	const writers = new Map();
	const writerIds = [...new Set(candidates.map((message) => message.user))];
	for (let i = 0; i < writerIds.length; i += WRITER_BATCH) {
		const rows = await User.findAll({
			where: { id: writerIds.slice(i, i + WRITER_BATCH) },
			attributes: ['id', 'retentionDays']
		});
		for (const row of rows) {
			writers.set(row.id, row);
		}
	}
	const report = {
		examined: candidates.length,
		letters: 0,
		replies: 0,
		attachments: 0,
		chats: 0,
		dryRun
	};
	const perChat = new Map(); // chat id -> letters this run removes from it
	for (const message of candidates) {
		const days = windowFor(writers.get(message.user) || null);
		if (days === null) {
			continue;
		}
		const since = message.statusChangedAt || message.createdAt;
		if (!since || now.getTime() - new Date(since).getTime() < days * DAY_MS) {
			continue;
		}
		let removed;
		if (dryRun) {
			removed = {
				deleted: true,
				attachments: await Attachment.count({ where: { message: message.id } })
			};
		} else {
			// Re-checked at delete time: a pin or a concurrent run since the
			// snapshot means this row is no longer ours to remove.
			removed = await purgeIfUnpinned(message.id);
		}
		if (!removed.deleted) {
			continue;
		}
		report[message.status === 'received' ? 'replies' : 'letters'] += 1;
		report.attachments += removed.attachments;
		perChat.set(message.chat, (perChat.get(message.chat) || 0) + 1);
	}
	for (const [chatId, removedHere] of perChat) {
		const left = await Message.count({ where: { chat: chatId } });
		// After a real run the removed rows are gone; in a dry run they still count.
		const remaining = dryRun ? left - removedHere : left;
		if (remaining === 0) {
			report.chats += dryRun ? 1 : await Chat.destroy({ where: { id: chatId } });
		}
	}
	if (!dryRun && report.letters + report.replies > 0) {
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
		try {
			await sequelize.query('VACUUM');
		} catch (err) {
			// Another process (a manual run) may hold the file; the next run compacts.
			log('Retention: VACUUM skipped (' + err.message + ').');
		}
	}
	log(
		(dryRun ? 'Retention (dry run): would delete ' : 'Retention: deleted ') +
			report.letters +
			' letter(s), ' +
			report.replies +
			' reply(ies), ' +
			report.attachments +
			' attachment(s), ' +
			report.chats +
			' emptied chat(s) of ' +
			report.examined +
			' examined.'
	);
	return report;
}
