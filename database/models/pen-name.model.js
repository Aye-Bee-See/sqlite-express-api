import { Model, Op } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import ValidationError from '#services/ValidationError.js';
import { HttpError } from '#services/HttpError.js';
import { inTransaction } from '#services/serial.js';
import { penNameLimits } from '#constants';

/**
 * Pen names (decided 22 September 2026). Every account may have one: the
 * site-unique name its letters are signed with, two parts encouraged ("James
 * Hollow"), chosen at sign-up, changeable. Old names are kept for ever and
 * never given to anyone else, so a reply addressed to a name someone used
 * last year still finds them.
 */
const MIN = 3;
const MAX = 40;
const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * DAY_MS;

export default class PenName extends Model {
	static init(sequelize) {
		return super.init(Schemas.penName, {
			sequelize,
			modelName: 'PenName',
			tableName: 'PenNames'
		});
	}

	static associate(models) {
		// The history outlives the account: a deleted writer's names stay taken (tombstones).
		this.belongsTo(models.User, {
			as: 'owner',
			foreignKey: 'userId',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
	}

	/** One space between words, trimmed, as shown. */
	static clean(name) {
		return String(name ?? '')
			.normalize('NFKC')
			.trim()
			.replace(/\s+/g, ' ');
	}

	/** The name folded for uniqueness: "James Hollow", "james  hollow", and "JAMES HOLLOW" are one name. */
	static keyOf(name) {
		return PenName.clean(name).toLowerCase();
	}

	/**
	 * The shape of a pen name: 3 to 40 characters of letters (any script),
	 * digits, spaces, hyphens, apostrophes, and dots, starting with a letter.
	 * @throws {ValidationError}
	 */
	static check(name) {
		if (typeof name !== 'string') {
			throw new ValidationError('penName must be text.');
		}
		const clean = PenName.clean(name);
		if (clean.length < MIN || clean.length > MAX) {
			throw new ValidationError('penName must be between ' + MIN + ' and ' + MAX + ' characters.');
		}
		if (!/^\p{L}[\p{L}\p{M}\p{N} .'’-]*$/u.test(clean)) {
			throw new ValidationError(
				'penName may hold letters, digits, spaces, hyphens, apostrophes, and dots, and starts with a letter.'
			);
		}
		return clean;
	}

	/**
	 * Is this name free? A name is taken by whoever has ever used it, unless
	 * that is the asking account itself (which may return to an old name).
	 * @returns {Promise<{available: boolean, name: string, reason: string|null, twoParts: boolean}>}
	 */
	static async availability(name, { forUser = null } = {}) {
		let clean;
		try {
			clean = PenName.check(name);
		} catch (err) {
			return { available: false, name: PenName.clean(name), reason: err.message, twoParts: false };
		}
		const holder = await this.findOne({ where: { nameKey: PenName.keyOf(clean) } });
		const twoParts = clean.includes(' ');
		if (holder && (forUser === null || String(holder.userId) !== String(forUser))) {
			return {
				available: false,
				name: clean,
				reason: 'That pen name is taken (names once used are never given out again).',
				twoParts
			};
		}
		return { available: true, name: clean, reason: null, twoParts };
	}

	/**
	 * Make `name` the account's current pen name, retiring the one before. An
	 * old name of the same account comes back into use; anyone else's, ever, is
	 * refused.
	 * @returns {Promise<string>} the name as stored
	 * @throws {ValidationError} shape, or taken
	 */
	static async claim(userId, name, { transaction, enforce = false, now = new Date() } = {}) {
		if (!transaction) {
			// Read, retire, insert are one step: inTransaction runs one transaction at a
			// time, so two renames cannot both see a free name or leave two current rows.
			return await inTransaction(this.sequelize, (t) =>
				PenName.claim(userId, name, { transaction: t, enforce, now })
			);
		}
		const clean = PenName.check(name);
		const key = PenName.keyOf(clean);
		const holder = await this.findOne({ where: { nameKey: key }, transaction });
		if (holder && String(holder.userId) !== String(userId)) {
			throw new ValidationError(
				'That pen name is taken (names once used are never given out again).'
			);
		}
		if (holder && holder.retiredAt === null) {
			return holder.name; // already the current name
		}
		if (enforce) {
			// The limits are read and the rename written in one transaction, so two
			// renames at once cannot both find the last one of the year unspent.
			await PenName.refuseOverLimit(userId, { returning: Boolean(holder), now, transaction });
		}
		await this.update(
			{ retiredAt: new Date() },
			{ where: { userId, retiredAt: null }, transaction }
		);
		if (holder) {
			// Back to an old name, in the spelling it was first given (and printed).
			await holder.update({ retiredAt: null, claimedAt: now }, { transaction });
			return holder.name;
		} else {
			try {
				await this.create({ userId, name: clean, nameKey: key, claimedAt: now }, { transaction });
			} catch (err) {
				if (err && err.name === 'SequelizeUniqueConstraintError') {
					throw new ValidationError(
						'That pen name is taken (names once used are never given out again).'
					);
				}
				throw err;
			}
		}
		return clean;
	}

	/**
	 * Has this account used this name before? Taking such a name back takes
	 * nothing from the shared namespace, so it does not spend a new name.
	 * A name that cannot be a pen name at all is refused where shape is checked.
	 */
	static async usedBefore(userId, name) {
		let key;
		try {
			key = PenName.keyOf(PenName.check(name));
		} catch {
			return false;
		}
		const holder = await this.findOne({ where: { nameKey: key } });
		return Boolean(holder) && String(holder.userId) === String(userId);
	}

	/**
	 * What the limits leave this account today (README, "Pen names"):
	 * `changeAllowedAt` is when the next change of any kind may happen, and
	 * `newNamesLeft` how many brand-new names are left in the rolling year.
	 * Going back to one of the account's own old names spends the cooldown but
	 * not a new name. An account that has never had a pen name may take one at
	 * once: the first name is not a change.
	 * @returns {Promise<{changeAllowedAt: string|null, newNamesLeft: number, newNamesWindowEnds: string|null, cooldownDays: number, newPerYear: number}>}
	 */
	static async changeStatus(userId, { now = new Date(), transaction } = {}) {
		const rows = await this.findAll({
			where: { userId },
			order: [['id', 'ASC']],
			transaction
		});
		const shape = {
			changeAllowedAt: null,
			newNamesLeft: penNameLimits.newPerYear,
			newNamesWindowEnds: null,
			cooldownDays: penNameLimits.cooldownDays,
			newPerYear: penNameLimits.newPerYear
		};
		if (rows.length === 0) {
			return shape;
		}
		const current = rows.find((row) => row.retiredAt === null) ?? null;
		// claimedAt is when the name became current; createdAt covers rows written
		// before the column existed, where the two are the same thing.
		const since = current ? (current.claimedAt ?? current.createdAt) : null;
		const windowStart = new Date(now.getTime() - YEAR_MS);
		// The first name ever is the one chosen at sign-up, not a change.
		const counted = rows.slice(1).filter((row) => row.createdAt >= windowStart);
		return {
			...shape,
			changeAllowedAt: since
				? new Date(since.getTime() + penNameLimits.cooldownDays * DAY_MS).toISOString()
				: null,
			newNamesLeft: Math.max(0, penNameLimits.newPerYear - counted.length),
			newNamesWindowEnds: counted.length
				? new Date(counted[0].createdAt.getTime() + YEAR_MS).toISOString()
				: null
		};
	}

	/**
	 * A 409 a client can word itself: `condition` is `cooldown` or `new_names`.
	 * @returns {HttpError}
	 */
	static limitError(condition, message) {
		const err = new HttpError(409, message, 'PenNameLimitError');
		err.condition = condition;
		return err;
	}

	/**
	 * Refuse a change the limits do not allow. `returning` says the account is
	 * going back to a name it has used before, which takes nothing from the
	 * shared namespace and so does not spend a new name.
	 * The dates are in the message; a client that wants them as fields reads
	 * `GET /auth/pen-name`, which answers the same status before anyone types.
	 * @throws {HttpError} 409 PenNameLimitError
	 */
	static async refuseOverLimit(userId, { returning = false, now = new Date(), transaction } = {}) {
		const status = await PenName.changeStatus(userId, { now, transaction });
		if (status.changeAllowedAt && new Date(status.changeAllowedAt) > now) {
			throw PenName.limitError(
				'cooldown',
				'A pen name may be changed once every ' +
					penNameLimits.cooldownDays +
					' days: this one may change again on ' +
					status.changeAllowedAt.slice(0, 10) +
					'. Letters already posted carry the old name, so it stays yours either way.'
			);
		}
		if (!returning && status.newNamesLeft < 1) {
			throw PenName.limitError(
				'new_names',
				'This account has taken its ' +
					penNameLimits.newPerYear +
					' new pen name(s) for the year' +
					(status.newNamesWindowEnds
						? ' and may take another on ' + status.newNamesWindowEnds.slice(0, 10)
						: '') +
					'. A name this account has used before may still be taken back, since nobody else can have it.'
			);
		}
	}

	/** Every name the account has used, current first. */
	static async namesOf(userId) {
		const rows = await this.findAll({ where: { userId }, order: [['id', 'DESC']] });
		return rows
			.sort((a, b) => (a.retiredAt === null ? -1 : b.retiredAt === null ? 1 : b.id - a.id))
			.map((row) => ({ name: row.name, current: row.retiredAt === null, since: row.createdAt }));
	}

	/**
	 * Accounts among `userIds` (every account when null) whose current or former pen name contains `q`.
	 * @returns {Promise<Map<number, {name: string, current: boolean}>>} best match per account
	 */
	static async search(q, userIds) {
		const key = PenName.keyOf(q);
		if (key.length < 2 || (userIds !== null && userIds.length === 0)) {
			return new Map();
		}
		const rows = await this.findAll({
			where: {
				...(userIds === null ? {} : { userId: userIds }),
				nameKey: { [Op.like]: '%' + key.replace(/[%_]/g, '') + '%' }
			},
			order: [
				['userId', 'ASC'],
				['retiredAt', 'DESC']
			]
		});
		const best = new Map();
		for (const row of rows) {
			const current = row.retiredAt === null;
			if (!best.has(row.userId) || (current && !best.get(row.userId).current)) {
				best.set(row.userId, { name: row.name, current });
			}
		}
		return best;
	}
}
