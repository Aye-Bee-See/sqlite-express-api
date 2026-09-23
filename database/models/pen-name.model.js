import { Model, Op } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import ValidationError from '#services/ValidationError.js';
import { inTransaction } from '#services/serial.js';

/**
 * Pen names (decided 22 September 2026). Every account may have one: the
 * site-unique name its letters are signed with, two parts encouraged ("James
 * Hollow"), chosen at sign-up, changeable. Old names are kept for ever and
 * never given to anyone else, so a reply addressed to a name someone used
 * last year still finds them.
 */
const MIN = 3;
const MAX = 40;

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
	static async claim(userId, name, { transaction } = {}) {
		if (!transaction) {
			// Read, retire, insert are one step: inTransaction runs one transaction at a
			// time, so two renames cannot both see a free name or leave two current rows.
			return await inTransaction(this.sequelize, (t) =>
				PenName.claim(userId, name, { transaction: t })
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
		await this.update(
			{ retiredAt: new Date() },
			{ where: { userId, retiredAt: null }, transaction }
		);
		if (holder) {
			// Back to an old name, in the spelling it was first given (and printed).
			await holder.update({ retiredAt: null }, { transaction });
			return holder.name;
		} else {
			try {
				await this.create({ userId, name: clean, nameKey: key }, { transaction });
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
