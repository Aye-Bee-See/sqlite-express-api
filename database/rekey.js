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

/**
 * @param {{dryRun?: boolean, batch?: number, log?: Function}} [options]
 * @returns {Promise<{current: string, previous: string|null, already: number, rewrapped: number, unreadable: {label: string|null, rows: number}[], dryRun: boolean}>}
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

	const [labels] = await sequelize.query(
		"SELECT `keyLabel` AS label, COUNT(*) AS n FROM `LetterKeys` WHERE `readerType` = 'server' GROUP BY `keyLabel`"
	);
	for (const { label, n } of labels) {
		const which = crypto.serverKeyNamed(label);
		if (which === 'current' && label) {
			report.already += Number(n);
		} else if (which === null) {
			report.unreadable.push({ label, rows: Number(n) });
		}
	}

	// By id, so that a row which cannot be moved (see below) is passed once and not met again.
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
		const movable = rows.filter((row) => crypto.serverKeyNamed(row.keyLabel) !== null);
		if (dryRun) {
			report.rewrapped += movable.length;
			continue;
		}
		await sequelize.transaction(async (transaction) => {
			for (const row of movable) {
				let contentKey;
				try {
					contentKey = crypto.unwrapForServer(row.wrappedKey, row.keyLabel);
				} catch {
					// Labelled (or unlabelled) as a key we have, and that key does not open it.
					const entry = report.unreadable.find((u) => u.label === row.keyLabel);
					if (entry) {
						entry.rows += 1;
					} else {
						report.unreadable.push({ label: row.keyLabel, rows: 1 });
					}
					continue;
				}
				const [, meta] = await sequelize.query(
					'UPDATE `LetterKeys` SET `wrappedKey` = :wrapped, `keyLabel` = :current, `updatedAt` = :now WHERE `id` = :id AND `keyLabel` IS :label',
					{
						replacements: {
							wrapped: crypto.wrapForServer(contentKey),
							current,
							now: new Date().toISOString().replace('T', ' ').replace('Z', ' +00:00'),
							id: row.id,
							label: row.keyLabel
						},
						transaction
					}
				);
				report.rewrapped += meta && meta.changes === 0 ? 0 : 1;
			}
		});
	}

	if (!dryRun && report.rewrapped > 0) {
		await sequelize.getQueryInterface().bulkInsert('AuditLogs', [
			{
				actor: null,
				action: 'encryption.rekey',
				resource: 'message',
				targetId: null,
				details: JSON.stringify({ rewrapped: report.rewrapped, to: current }),
				createdAt: new Date()
			}
		]);
	}

	const lost = report.unreadable.reduce((sum, entry) => sum + entry.rows, 0);
	log(
		(dryRun ? 'Rekey (dry run): would move ' : 'Rekey: moved ') +
			report.rewrapped +
			' letter key(s) to ENCRYPTION_KEY ' +
			current +
			'; ' +
			report.already +
			' were there already.'
	);
	if (lost > 0) {
		log(
			lost +
				' letter key(s) were wrapped with a key this server does not have (' +
				report.unreadable.map((entry) => entry.label + ': ' + entry.rows).join(', ') +
				'). They are untouched. Put that key in ENCRYPTION_KEY_PREVIOUS and run this again.'
		);
	} else if (!dryRun && previous) {
		log(
			'Nothing is left under the previous key: remove ENCRYPTION_KEY_PREVIOUS from .env and restart the API. Keep the old key for as long as you keep backups made before today.'
		);
	}
	return report;
}
