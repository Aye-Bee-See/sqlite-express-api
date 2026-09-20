import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';

/** Status history of a message. */
export default class MessageStatus extends Model {
	static init(sequelize) {
		return super.init(Schemas.messageStatus, {
			sequelize,
			modelName: 'MessageStatus',
			tableName: 'MessageStatuses'
		});
	}

	static associate(models) {
		this.belongsTo(models.Message, {
			as: 'message_details',
			foreignKey: 'message',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.User, {
			as: 'changed_by',
			foreignKey: 'changedBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
	}

	/** Append one history row. */
	static async record(messageId, fromStatus, toStatus, changedBy = null, { reason, note } = {}) {
		return await this.create({
			message: messageId,
			fromStatus,
			toStatus,
			changedBy,
			reason: reason ?? null,
			note: note ?? null
		});
	}

	/** History for one message, oldest first. */
	static async historyFor(messageId) {
		return await this.findAll({ where: { message: messageId }, order: [['id', 'ASC']] });
	}
}
