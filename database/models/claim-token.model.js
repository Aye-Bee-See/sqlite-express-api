import { Model, Op } from 'sequelize';
import { createHash, randomBytes } from 'node:crypto';
import Schemas from '#schemas/all.schema.js';

/** Token lifetime, matching the front-end copy ("valid for 72 hours"). */
export const CLAIM_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

/** Crockford-style base32 alphabet: no I, L, O, or U, so tokens read aloud well. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encode(bytes) {
	let out = '';
	for (const b of bytes) {
		out += ALPHABET[b % 32];
	}
	return out;
}

export function hashToken(token) {
	return createHash('sha256').update(String(token).trim().toUpperCase()).digest('hex');
}

export default class ClaimToken extends Model {
	static init(sequelize) {
		return super.init(Schemas.claimToken, {
			sequelize,
			modelName: 'ClaimToken',
			tableName: 'ClaimTokens'
		});
	}

	static associate(models) {
		this.belongsTo(models.User, {
			as: 'writer',
			foreignKey: 'userId',
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

	/**
	 * Issue a fresh token for a writer, replacing any unused one.
	 * @param {number} userId the managed writer
	 * @param {number|null} createdBy the account that generated it
	 * @returns {Promise<{token: string, expiresAt: Date}>} plaintext token, shown once
	 */
	static async issue(userId, createdBy = null) {
		await this.destroy({ where: { userId, usedAt: null } });
		const token = encode(randomBytes(24));
		const expiresAt = new Date(Date.now() + CLAIM_TOKEN_TTL_MS);
		await this.create({ userId, tokenHash: hashToken(token), expiresAt, createdBy });
		return { token, expiresAt };
	}

	/**
	 * Revoke the writer's unused token, if any.
	 * @returns {Promise<number>} tokens removed
	 */
	static async revoke(userId) {
		return await this.destroy({ where: { userId, usedAt: null } });
	}

	/**
	 * The live (unused, unexpired) token record for a writer, or null.
	 */
	static async activeFor(userId) {
		return await this.findOne({
			where: { userId, usedAt: null, expiresAt: { [Op.gt]: new Date() } }
		});
	}

	/**
	 * Look up a plaintext token.
	 * @returns {Promise<{record: ClaimToken|null, state: 'valid'|'used'|'expired'|'unknown'}>}
	 */
	static async lookup(token) {
		if (typeof token !== 'string' || token.trim() === '') {
			return { record: null, state: 'unknown' };
		}
		const record = await this.findOne({ where: { tokenHash: hashToken(token) } });
		if (!record) {
			return { record: null, state: 'unknown' };
		}
		if (record.usedAt) {
			return { record, state: 'used' };
		}
		if (record.expiresAt.getTime() <= Date.now()) {
			return { record, state: 'expired' };
		}
		return { record, state: 'valid' };
	}
}
