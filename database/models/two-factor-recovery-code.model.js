import { Model } from 'sequelize';
import { createHash, randomBytes } from 'node:crypto';
import Schemas from '#schemas/all.schema.js';
import { normalizeToken } from '#models/claim-token.model.js';
import { inTransaction } from '#services/serial.js';

/** How many codes a set holds. */
export const RECOVERY_CODE_COUNT = 10;

/** Crockford base32, as every code a person types here (README, "Typed codes"). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Ten characters in two groups of five: 50 bits, and a code is used once. */
function newCode() {
	let out = '';
	for (const byte of randomBytes(10)) {
		out += ALPHABET[byte % 32];
	}
	return out.slice(0, 5) + '-' + out.slice(5);
}

function hashOf(code) {
	return createHash('sha256')
		.update('two-factor:' + normalizeToken(code))
		.digest('hex');
}

/**
 * Two-factor recovery codes: for signing in when the phone with the
 * authenticator app is lost. Shown once, kept only as hashes, and each works
 * once: using one deletes it, so two sign-ins with the same code cannot both pass.
 */
export default class TwoFactorRecoveryCode extends Model {
	static init(sequelize) {
		return super.init(Schemas.twoFactorRecoveryCode, {
			sequelize,
			modelName: 'TwoFactorRecoveryCode',
			tableName: 'TwoFactorRecoveryCodes',
			indexes: [{ fields: ['userId'], name: 'two_factor_recovery_codes_user' }]
		});
	}

	static associate(models) {
		this.belongsTo(models.User, {
			as: 'user',
			foreignKey: 'userId',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
	}

	/**
	 * A fresh set, replacing any before it.
	 * @returns {Promise<string[]>} the codes, the only time they are seen
	 */
	static async replaceFor(userId, { transaction = null } = {}) {
		const work = async (t) => {
			await this.destroy({ where: { userId }, transaction: t });
			const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newCode);
			await this.bulkCreate(
				codes.map((code) => ({ userId, codeHash: hashOf(code) })),
				{ transaction: t }
			);
			return codes;
		};
		return transaction ? await work(transaction) : await inTransaction(this.sequelize, work);
	}

	/** Use a code: true, and it is gone, when it was one of this account's. */
	static async use(userId, code) {
		return (await this.destroy({ where: { userId, codeHash: hashOf(code) } })) === 1;
	}

	static async left(userId) {
		return await this.count({ where: { userId } });
	}

	static async clear(userId, { transaction = null } = {}) {
		await this.destroy({ where: { userId }, transaction });
	}
}
