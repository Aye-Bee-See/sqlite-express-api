import { Op } from 'sequelize';
import AuditLog from '#models/audit-log.model.js';
import { auditKeepDays, auditSecurityKeepDays } from '#constants';

/**
 * How long audit entries are kept. The log is append-only and nothing ever
 * removed it, so it grew for the life of the deployment: a busy letter night
 * writes an entry per status change, and the oldest entries are the least
 * useful. Two windows, because two kinds of entry answer different questions:
 *
 * - **Security**: who got access, who changed it, who decided something about
 *   somebody, and what was destroyed. These are the entries an investigation
 *   after the fact needs, so they are kept for two years.
 * - **Routine**: the day-to-day of running a directory and mailing letters.
 *   Useful for weeks, not years, and kept for 180 days.
 *
 * Both windows are settings (`AUDIT_SECURITY_KEEP_DAYS`, `AUDIT_KEEP_DAYS`);
 * `0` keeps that kind for ever. A deployment under a legal obligation to keep
 * records, or one that would rather hold nothing, sets its own numbers.
 */

/**
 * An action is security-relevant when it is about an account, a key, an
 * invitation, a decision made about somebody, or something destroyed.
 * Anything not named here is routine, so a new routine action needs no change
 * and a new access-related one must be added (the test lists every action the
 * code writes, and fails on one this file has never heard of).
 */
const SECURITY_PREFIXES = [
	'user.', // updates by staff, sign-outs, revocations, recovery, keys, pen name overrides
	'writer.', // a managed writer made, and the hand-over when it is claimed
	'invitation.',
	'chapter.keys',
	// Handing a group's key to a member, and taking it back: the most
	// access-shaped events there are. `chapter.keys` does not cover them, because
	// the action is written `chapter.member-key` (found 27 September, while
	// listing the classification for the owner).
	'chapter.member-key',
	'chapter.owner',
	'submission.approve',
	'submission.reject',
	// The only record that a deletion happened at all. Letters, attachments and
	// their files go with it, so a run that removed three hundred letters should
	// not age out sooner than deleting one record does.
	'retention.run',
	// A group deciding not to send somebody's letter.
	'letter.decline'
];

/** Actions kept for the longer window, whatever else they are. */
export function isSecurityAction(action) {
	const name = String(action ?? '');
	// Destroying a record is the thing most worth being able to look up later.
	return name.endsWith('.delete') || SECURITY_PREFIXES.some((prefix) => name.startsWith(prefix));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The two windows in force, as days; null means keep for ever. */
export function auditWindows() {
	return {
		routine: auditKeepDays === 0 ? null : auditKeepDays,
		security: auditSecurityKeepDays === 0 ? null : auditSecurityKeepDays
	};
}

/**
 * Which of the actions in the log are security-relevant. Read from the log
 * itself rather than from a list of what the code writes today, so an entry
 * written by an older version is sorted the same way.
 * @returns {Promise<{security: string[], routine: string[]}>}
 */
async function actionsInLog() {
	const rows = await AuditLog.findAll({ attributes: ['action'], group: ['action'], raw: true });
	const security = [];
	const routine = [];
	for (const { action } of rows) {
		(isSecurityAction(action) ? security : routine).push(action);
	}
	return { security, routine };
}

/**
 * Delete audit entries older than their window.
 * @param {{dryRun?: boolean, now?: Date, batchSize?: number}} options
 * @returns {Promise<{routine: number, security: number}>} how many went, or would
 */
/**
 * How many entries one statement deletes. Each batch is its own write, so the
 * lock is let go between them and a letter sent during a large first purge
 * waits for one batch, not for all of them.
 */
const PURGE_BATCH = 1000;

/** Delete the matching entries a batch at a time; the total deleted. */
async function destroyInBatches(where, batchSize) {
	let total = 0;
	for (;;) {
		const rows = await AuditLog.findAll({
			attributes: ['id'],
			where,
			order: [['id', 'ASC']],
			limit: batchSize,
			raw: true
		});
		if (rows.length === 0) {
			return total;
		}
		total += await AuditLog.destroy({ where: { id: rows.map((row) => row.id) } });
		if (rows.length < batchSize) {
			return total;
		}
	}
}

export async function purgeAuditLogs({
	dryRun = false,
	now = new Date(),
	batchSize = PURGE_BATCH
} = {}) {
	const windows = auditWindows();
	const report = { routine: 0, security: 0 };
	if (windows.routine === null && windows.security === null) {
		return report;
	}
	const { security, routine } = await actionsInLog();
	for (const [kind, actions] of [
		['routine', routine],
		['security', security]
	]) {
		const days = windows[kind];
		if (days === null || actions.length === 0) {
			continue;
		}
		const where = {
			action: actions,
			createdAt: { [Op.lt]: new Date(now.getTime() - days * DAY_MS) }
		};
		report[kind] = dryRun
			? await AuditLog.count({ where })
			: await destroyInBatches(where, batchSize);
	}
	return report;
}
