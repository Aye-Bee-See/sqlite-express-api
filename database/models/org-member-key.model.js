import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';

/**
 * Per-member wrapping of a group's private key. A member joins by having an
 * existing member (or an admin bootstrapping the group) seal the group key
 * to their public key; leaving deletes the row. The server never holds the
 * group private key in the clear.
 */
export default class OrgMemberKey extends Model {
	static init(sequelize) {
		return super.init(Schemas.orgMemberKey, {
			sequelize,
			modelName: 'OrgMemberKey',
			tableName: 'OrgMemberKeys',
			indexes: [{ unique: true, fields: ['chapterId', 'userId'] }]
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
			as: 'member',
			foreignKey: 'userId',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
	}

	static async forMember(chapterId, userId) {
		return await this.findOne({ where: { chapterId, userId } });
	}

	/** Create or replace a member's wrapped group key. */
	static async put({ chapterId, userId, wrappedOrgPrivateKey, addedBy = null }) {
		const existing = await this.forMember(chapterId, userId);
		if (existing) {
			await existing.update({ wrappedOrgPrivateKey, addedBy });
			return existing;
		}
		return await this.create({ chapterId, userId, wrappedOrgPrivateKey, addedBy });
	}

	static async remove(chapterId, userId) {
		return await this.destroy({ where: { chapterId, userId } });
	}
}
