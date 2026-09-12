import { Model, Op } from 'sequelize';
import Schemas from '#schemas/all.schema.js';

/**
 * Denylist of logged-out token ids. Rows live only until the token would
 * have expired on its own, so the table stays small.
 */
export default class RevokedToken extends Model {
	static init(sequelize) {
		return super.init(Schemas.revokedToken, {
			sequelize,
			modelName: 'RevokedToken',
			tableName: 'RevokedTokens',
			updatedAt: false
		});
	}

	static associate(models) {
		this.belongsTo(models.User, {
			as: 'user_details',
			foreignKey: 'userId',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
	}

	/** Revoke one token id until it expires. Revoking twice is fine. */
	static async revoke(jti, userId, expiresAt) {
		const [row] = await this.findOrCreate({
			where: { jti },
			defaults: { jti, userId, expiresAt }
		});
		return row;
	}

	static async isRevoked(jti) {
		return (await this.count({ where: { jti } })) > 0;
	}

	/** Drop rows for tokens that have expired anyway. */
	static async sweep(now = new Date()) {
		return await this.destroy({ where: { expiresAt: { [Op.lt]: now } } });
	}
}
