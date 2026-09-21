import { sequelize } from './connection.js';
import * as crypto from '#services/crypto.js';

/**
 * Change ENCRYPTION_KEY without losing a letter, and without stopping the API.
 *
 * The server key wraps one small thing per letter: that letter's own key (a
 * `server` row in LetterKeys; letters and attachments are encrypted with the
 * letter's key, not with the server's). Changing the server key therefore means
 * opening each of those rows with the old key and wrapping it again with the
 * new one. The letters themselves are not touched.
 *
 *   1. npm run keygen                       a new key
 *   2. in .env: ENCRYPTION_KEY_PREVIOUS=<the old ENCRYPTION_KEY>
 *               ENCRYPTION_KEY=<the new one>        then restart the API
 *      New letters use the new key; old ones stay readable, because every row
 *      says which key wrapped it (keyLabel).
 *   3. npm run encryption:rekey             (add -- --dry-run to look first)
 *   4. when it says nothing is left: remove ENCRYPTION_KEY_PREVIOUS, restart.
 *
 * Rows are moved in batches, each batch one transaction, each row only if it
 * still carries the label it was read with. Stopping it, or running it twice,
 * or running it beside the API, does no harm: what is done stays done, and the
 * rest is found again by its label.
 *
 * **Backups made before step 3 still need the old key.** Keep it, somewhere
 * safe and away from the backups, for as long as you keep those.
 */

const BATCH = 500;

const sqlDate = (date) => date.toISOString().replace('T', ' ').replace('Z', ' +00:00');

/**
 * @param {{dryRun?: boolean, batch?: number, log?: Function}} [options]
 * @returns {Promise<{current: string, previous: string|null, already: number, rewrapped: number, unreadable: {label: string|null, rows: number, reason: 'unknown_key'|'does_not_open'}[], dryRun: boolean}>}
 *   `unreadable`: rows left exactly as they were. `unknown_key`: labelled for a key
 *   this server was not given. `does_not_open`: labelled for a key it has, which
 *   does not open it (damaged, or wrapped with another key than it says).
 */
export async function rekeyServerEnvelopes({
	dryRun = false,
	batch = BATCH,
	log = console.log
} = {}) {
	await crypto.ready;
	const current = crypto.masterKeyLabel();
	const previous = crypto.previousKeyLabel();
	const report = { current, previous, already: 0, rewrapped: 0, unreadable: [], dryRun };
	const cannot = (label, reason) => {
		const entry = report.unreadable.find((u) => u.label === label && u.reason === reason);
		if (entry) {
			entry.rows += 1;
		} else {
			report.unreadable.push({ label, rows: 1, reason });
		}
	};

	const [[{ n: already }]] = await sequelize.query(
		"SELECT COUNT(*) AS n FROM `LetterKeys` WHERE `readerType` = 'server' AND `keyLabel` = :current",
		{ replacements: { current } }
	);
	report.already = Number(already);

	// One audit entry for the run, written in the first batch's transaction and
	// brought up to date in each later one: a run that is stopped half way has
	// recorded exactly what it committed.
	let auditId = null;
	const recordProgress = async (transaction) => {
		const details = JSON.stringify({ rewrapped: report.rewrapped, to: current });
		if (auditId === null) {
			await sequelize.query(
				"INSERT INTO `AuditLogs` (`actor`, `action`, `resource`, `targetId`, `details`, `createdAt`) VALUES (NULL, 'encryption.rekey', 'message', NULL, :details, :now)",
				{ replacements: { details, now: sqlDate(new Date()) }, transaction }
			);
			const [[row]] = await sequelize.query('SELECT last_insert_rowid() AS id', { transaction });
			auditId = row.id;
		} else {
			await sequelize.query('UPDATE `AuditLogs` SET `details` = :details WHERE `id` = :id', {
				replacements: { details, id: auditId },
				transaction
			});
		}
	};

	// By id, so that a row which cannot be moved is passed once and not met again.
	let after = 0;
	for (;;) {
		const [rows] = await sequelize.query(
			"SELECT `id`, `wrappedKey`, `keyLabel` FROM `LetterKeys` WHERE `readerType` = 'server' AND `id` > :after AND (`keyLabel` IS NULL OR `keyLabel` != :current) ORDER BY `id` LIMIT :batch",
			{ replacements: { after, current, batch } }
		);
		if (rows.length === 0) {
			break;
		}
		after = rows[rows.length - 1].id;

		// Opened first, in a dry run as well: a preview that counted a row it could not
		// open as movable would promise a clean run that then is not one.
		const movable = [];
		for (const row of rows) {
			if (crypto.serverKeyNamed(row.keyLabel) === null) {
				cannot(row.keyLabel, 'unknown_key');
				continue;
			}
			try {
				movable.push({ row, contentKey: crypto.unwrapForServer(row.wrappedKey, row.keyLabel) });
			} catch {
				cannot(row.keyLabel, 'does_not_open');
			}
		}
		if (dryRun) {
			report.rewrapped += movable.length;
			continue;
		}
		if (movable.length === 0) {
			continue;
		}
		await sequelize.transaction(async (transaction) => {
			let moved = 0;
			for (const { row, contentKey } of movable) {
				const [, meta] = await sequelize.query(
					'UPDATE `LetterKeys` SET `wrappedKey` = :wrapped, `keyLabel` = :current, `updatedAt` = :now WHERE `id` = :id AND `keyLabel` IS :label',
					{
						replacements: {
							wrapped: crypto.wrapForServer(contentKey),
							current,
							now: sqlDate(new Date()),
							id: row.id,
							label: row.keyLabel
						},
						transaction
					}
				);
				moved += meta && meta.changes === 0 ? 0 : 1;
			}
			if (moved > 0) {
				report.rewrapped += moved;
				await recordProgress(transaction);
			}
		});
	}

	log(
		(dryRun ? 'Rekey (dry run): would move ' : 'Rekey: moved ') +
			report.rewrapped +
			' letter key(s) to ENCRYPTION_KEY ' +
			current +
			'; ' +
			report.already +
			' were there already.'
	);
	const count = (reason) =>
		report.unreadable.filter((u) => u.reason === reason).reduce((sum, u) => sum + u.rows, 0);
	const labels = (reason) =>
		report.unreadable
			.filter((u) => u.reason === reason)
			.map((u) => (u.label || 'no label') + ': ' + u.rows)
			.join(', ');
	if (count('unknown_key') > 0) {
		log(
			count('unknown_key') +
				' letter key(s) were wrapped with a key this server was not given (' +
				labels('unknown_key') +
				'). They are untouched. Put that key in ENCRYPTION_KEY_PREVIOUS and run this again.'
		);
	}
	if (count('does_not_open') > 0) {
		log(
			count('does_not_open') +
				' letter key(s) are labelled for a key this server has, and that key does not open them (' +
				labels('does_not_open') +
				'). They are untouched. Another key will not help: the rows are damaged or mislabelled; restore them from a backup.'
		);
	}
	if (report.unreadable.length === 0 && !dryRun && previous) {
		log(
			'Nothing is left under the previous key: remove ENCRYPTION_KEY_PREVIOUS from .env and restart the API. Keep the old key for as long as you keep backups made before today.'
		);
	}
	return report;
}
