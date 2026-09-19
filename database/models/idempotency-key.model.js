import { Model, Op } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import { idempotencyDays } from '#constants';
import { HttpError } from '#services/HttpError.js';

/** How many times a claim may lose a race before the request is told to come back. */
const CLAIM_PASSES = 5;

/** A first attempt that has not finished after this long is taken to have died with its process. */
export const STALE_ATTEMPT_MS = 60 * 1000;

export default class IdempotencyKey extends Model {
	static init(sequelize) {
		return super.init(Schemas.idempotencyKey, {
			sequelize,
			modelName: 'IdempotencyKey',
			tableName: 'IdempotencyKeys'
		});
	}

	static associate(models) {
		this.belongsTo(models.User, {
			as: 'owner',
			foreignKey: 'userId',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
	}

	/**
	 * Claim a key for a first attempt. The unique index decides a race: of two
	 * requests with the same key, one inserts and the other gets the row back.
	 *
	 * Insert, or read what is there; and if what was there has just gone (its
	 * attempt failed and released the key), go round again. Every pass can lose
	 * to another request, so no insert here is ever unguarded. The loop is
	 * bounded: losing this many times in a row means a storm of identical
	 * requests, and those are told to come back.
	 * @returns {Promise<{row: IdempotencyKey, claimed: boolean}>}
	 * @throws {HttpError} 409 when the key could not be settled
	 */
	static async claim({ userId, scope, key, fingerprint }) {
		for (let pass = 0; pass < CLAIM_PASSES; pass += 1) {
			try {
				return { row: await this.create({ userId, scope, key, fingerprint }), claimed: true };
			} catch (err) {
				if (err.name !== 'SequelizeUniqueConstraintError') {
					throw err;
				}
			}
			const row = await this.findOne({ where: { userId, scope, key } });
			if (!row) {
				// Released between the failed insert and this read: try the insert again.
				continue;
			}
			if (row.state === 'processing') {
				// Take over an attempt whose process died. The condition is part of the
				// write, and the write moves updatedAt to now, so only one retry matches.
				const [count] = await this.update(
					{ fingerprint },
					{
						where: {
							id: row.id,
							state: 'processing',
							updatedAt: { [Op.lt]: new Date(Date.now() - STALE_ATTEMPT_MS) }
						}
					}
				);
				if (count === 1) {
					return { row: await this.findByPk(row.id), claimed: true };
				}
			}
			return { row, claimed: false };
		}
		throw new HttpError(
			409,
			'Several requests are using this Idempotency-Key at once; try again shortly.',
			'IdempotencyError'
		);
	}

	/** The first attempt made this. */
	static async complete(id, resourceId) {
		await this.update({ state: 'done', resourceId }, { where: { id } });
	}

	/** The first attempt made nothing: the key is free for another try. */
	static async release(id) {
		await this.destroy({ where: { id, state: 'processing' } });
	}

	static async sweep(now = Date.now()) {
		return await this.destroy({
			where: { createdAt: { [Op.lt]: new Date(now - idempotencyDays * 24 * 60 * 60 * 1000) } }
		});
	}
}
