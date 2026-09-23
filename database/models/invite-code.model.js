import { Model, Op } from 'sequelize';
import { createHash, randomBytes } from 'node:crypto';
import Schemas from '#schemas/all.schema.js';
import { inviteCodes as settings } from '#constants';
import ValidationError from '#services/ValidationError.js';
import { HttpError } from '#services/HttpError.js';
import { createSerialQueue } from '#services/serial.js';

/**
 * Invite codes, the way writers join (decided 22 September 2026).
 *
 * A chapter's group admin issues a batch of codes and prints them as slips.
 * A newcomer registers with one; the account is theirs from the first minute
 * and remembers the chapter that sponsored it. The chapter sees counts ("17 of
 * 20 in use"), never which account used which slip: the code row learns only
 * that it was used, and when.
 *
 * The quota: a chapter may have at most INVITE_CODES_OUTSTANDING unused,
 * unexpired, uncancelled codes at a time. A used code frees its slot at once;
 * an unused one counts until it expires (INVITE_CODE_DAYS) or is cancelled, so
 * a chapter cannot print fifty and hand them out freely.
 *
 * A code is 12 characters of Crockford base32 (60 bits), shown as
 * XXXX-XXXX-XXXX: shorter than a claim token, because it unlocks no key and can
 * only be tried against the server, which limits tries by address.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 12;
const oneBatchAtATime = createSerialQueue();

/** Upper case, dashes and spaces gone, and Crockford's look-alikes folded (O to 0, I and L to 1). */
export function normalizeCode(code) {
	return String(code).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

export function hashCode(code) {
	return createHash('sha256')
		.update('invite:' + normalizeCode(code))
		.digest('hex');
}

function newCode() {
	const bytes = randomBytes(CODE_LENGTH);
	let out = '';
	for (const b of bytes) {
		out += ALPHABET[b % 32];
	}
	return out.replace(/(.{4})(?=.)/g, '$1-');
}

export default class InviteCode extends Model {
	static init(sequelize) {
		return super.init(Schemas.inviteCode, {
			sequelize,
			modelName: 'InviteCode',
			tableName: 'InviteCodes'
		});
	}

	static associate(models) {
		this.belongsTo(models.Chapter, {
			as: 'chapter_details',
			foreignKey: 'chapterId',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.User, {
			as: 'issuer',
			foreignKey: 'createdBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
	}

	/** The where of "still usable": unused, uncancelled, not yet expired. */
	static #live(now = new Date()) {
		return { usedAt: null, cancelledAt: null, expiresAt: { [Op.gt]: now } };
	}

	/** How many of a chapter's codes count against its quota right now. */
	static async outstanding(chapterId, now = new Date()) {
		return await this.count({ where: { chapterId, ...InviteCode.#live(now) } });
	}

	/**
	 * Issue a batch. The quota is checked and the rows written one batch at a
	 * time, so two group admins printing at once cannot both squeeze under it.
	 * @returns {Promise<{batch: string, label: string|null, expiresAt: Date, codes: string[], outstanding: number}>}
	 *   the plain codes, shown once
	 * @throws {ValidationError} bad count, label, or days; {HttpError} 409 over the quota
	 */
	static async issue({ chapterId, count, label, days, createdBy = null, now = new Date() }) {
		const n = Number(count);
		if (!Number.isInteger(n) || n < 1 || n > settings.batchMax) {
			throw new ValidationError(
				'count must be a whole number from 1 to ' + settings.batchMax + '.'
			);
		}
		const life = days === undefined || days === null ? settings.days : Number(days);
		if (!Number.isInteger(life) || life < 1 || life > settings.days) {
			throw new ValidationError('days must be a whole number from 1 to ' + settings.days + '.');
		}
		const clean = label === undefined || label === null ? null : String(label).trim() || null;
		if (clean && clean.length > 80) {
			throw new ValidationError('label can be at most 80 characters.');
		}
		return await oneBatchAtATime(async () => {
			const outstanding = await this.outstanding(chapterId, now);
			if (outstanding + n > settings.outstanding) {
				throw new HttpError(
					409,
					'This chapter has ' +
						outstanding +
						' unused invite code(s) and may have at most ' +
						settings.outstanding +
						'. Used codes free their slot at once; unused ones count until they expire or are cancelled (DELETE /auth/invite-codes).',
					'InviteQuotaError'
				);
			}
			const batch = randomBytes(6).toString('base64url');
			const expiresAt = new Date(now.getTime() + life * 24 * 60 * 60 * 1000);
			const codes = Array.from({ length: n }, newCode);
			await this.bulkCreate(
				codes.map((code) => ({
					chapterId,
					batch,
					label: clean,
					tokenHash: hashCode(code),
					expiresAt,
					createdBy
				})),
				{ validate: true }
			);
			return { batch, label: clean, expiresAt, codes, outstanding: outstanding + n };
		});
	}

	/**
	 * A chapter's batches with counts, newest first. Never the codes, never who
	 * used them.
	 * @returns {Promise<{batch: string, label: string|null, createdAt: Date, expiresAt: Date, total: number, used: number, cancelled: number, unused: number}[]>}
	 */
	static async batches(chapterId, now = new Date()) {
		const rows = await this.findAll({ where: { chapterId }, order: [['id', 'DESC']] });
		const seen = new Map();
		for (const row of rows) {
			if (!seen.has(row.batch)) {
				seen.set(row.batch, {
					batch: row.batch,
					label: row.label,
					createdAt: row.createdAt,
					expiresAt: row.expiresAt,
					total: 0,
					used: 0,
					cancelled: 0,
					expired: 0,
					unused: 0
				});
			}
			const entry = seen.get(row.batch);
			entry.total += 1;
			if (row.usedAt) {
				entry.used += 1;
			} else if (row.cancelledAt) {
				entry.cancelled += 1;
			} else if (row.expiresAt.getTime() <= now.getTime()) {
				entry.expired += 1;
			} else {
				entry.unused += 1;
			}
		}
		return [...seen.values()];
	}

	/**
	 * Cancel a chapter's unused codes: one batch, or all of them.
	 * @returns {Promise<number>} codes cancelled
	 */
	static async cancel(chapterId, { batch = null } = {}) {
		const [count] = await this.update(
			{ cancelledAt: new Date() },
			{
				where: { chapterId, ...InviteCode.#live(), ...(batch ? { batch } : {}) }
			}
		);
		return count;
	}

	/**
	 * @returns {Promise<{record: InviteCode|null, state: 'valid'|'used'|'cancelled'|'expired'|'unknown'}>}
	 */
	static async lookup(code) {
		if (typeof code !== 'string' || normalizeCode(code).length !== CODE_LENGTH) {
			return { record: null, state: 'unknown' };
		}
		const record = await this.findOne({ where: { tokenHash: hashCode(code) } });
		if (!record) {
			return { record: null, state: 'unknown' };
		}
		if (record.usedAt) {
			return { record, state: 'used' };
		}
		if (record.cancelledAt) {
			return { record, state: 'cancelled' };
		}
		if (record.expiresAt.getTime() <= Date.now()) {
			return { record, state: 'expired' };
		}
		return { record, state: 'valid' };
	}

	/**
	 * Spend a code, only if it is still unspent: two joins with one code cannot
	 * both win. Called inside the transaction that makes the account, so the code
	 * is spent exactly when the account exists.
	 */
	static async consume(id, { transaction } = {}) {
		const [count] = await this.update(
			{ usedAt: new Date() },
			{ where: { id, ...InviteCode.#live() }, transaction }
		);
		return count === 1;
	}
}
