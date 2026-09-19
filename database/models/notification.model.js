import { Model, Op } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import { notificationDays } from '#constants';

/**
 * An account's feed of things that happened to their letters and
 * proposals. A push only rings the bell; this is where a client finds out
 * what for, over its own connection. Entries carry ids and states, never
 * letter content or names.
 */
export default class Notification extends Model {
	static init(sequelize) {
		return super.init(Schemas.notification, {
			sequelize,
			modelName: 'Notification',
			tableName: 'Notifications'
		});
	}

	static associate(models) {
		this.belongsTo(models.User, {
			as: 'recipient',
			foreignKey: 'userId',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.Chat, { foreignKey: 'chat', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
		this.belongsTo(models.Message, {
			foreignKey: 'message',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.Submission, {
			foreignKey: 'submission',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
	}

	/** One entry per recipient. */
	static async record(
		userIds,
		{ event, chat = null, message = null, submission = null, detail = null }
	) {
		return await this.bulkCreate(
			userIds.map((userId) => ({ userId, event, chat, message, submission, detail })),
			{ validate: true }
		);
	}

	/**
	 * @param {number} userId
	 * @param {{since?: number, unread?: boolean, limit?: number, offset?: number}} options `since`: entries with a greater id
	 */
	static async feed(userId, { since, unread = false, limit, offset = 0 } = {}) {
		const where = { userId };
		if (since !== undefined) {
			where.id = { [Op.gt]: since };
		}
		if (unread) {
			where.readAt = null;
		}
		return await this.findAndCountAll({ where, limit, offset, order: [['id', 'DESC']] });
	}

	static async unreadCount(userId) {
		return await this.count({ where: { userId, readAt: null } });
	}

	/**
	 * @param {number} userId
	 * @param {{ids?: number[], upTo?: number}} which these entries, or everything up to an id; neither means all
	 * @returns {Promise<number>} entries newly marked
	 */
	static async markRead(userId, { ids, upTo } = {}) {
		const where = { userId, readAt: null };
		if (ids) {
			where.id = ids;
		} else if (upTo !== undefined) {
			where.id = { [Op.lte]: upTo };
		}
		const [count] = await this.update({ readAt: new Date() }, { where });
		return count;
	}

	/** Old entries go; the feed is a doorbell log, not a record. */
	static async sweep(now = Date.now()) {
		return await this.destroy({
			where: { createdAt: { [Op.lt]: new Date(now - notificationDays * 24 * 60 * 60 * 1000) } }
		});
	}
}
