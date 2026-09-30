import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import { HELD_WRITER_BLOCKED, QUEUED } from '#db/letter-status.js';
import { inTransaction } from '#services/serial.js';

/**
 * A writer a group will not mail letters for (decided 30 September 2026). It
 * reaches that group only: the writer may still write through any other group,
 * and only a superadmin can stop an account everywhere (the `banned` role).
 *
 * While a block stands, the writer's letters waiting in that group's queue are
 * held (`writer_blocked`), so none goes out by accident; lifting it lets them go.
 */
export default class GroupBlock extends Model {
	static init(sequelize) {
		return super.init(Schemas.groupBlock, {
			sequelize,
			modelName: 'GroupBlock',
			tableName: 'GroupBlocks',
			indexes: [
				{ unique: true, fields: ['chapterId', 'userId'], name: 'group_blocks_chapter_user' }
			]
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
			as: 'writer',
			foreignKey: 'userId',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.User, {
			as: 'blocked_by',
			foreignKey: 'blockedBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
	}

	/** Does this group refuse this writer's letters? */
	static async isBlocked(chapterId, userId, { transaction = null } = {}) {
		if (!chapterId || !userId) {
			return false;
		}
		return (await this.count({ where: { chapterId, userId }, transaction })) > 0;
	}

	/**
	 * Block a writer from a group, and hold their letters in its queue.
	 * @returns {Promise<{block: GroupBlock, held: number, created: boolean}>}
	 */
	static async block({ chapterId, userId, reason, blockedBy }) {
		return await inTransaction(this.sequelize, async (transaction) => {
			const existing = await this.findOne({ where: { chapterId, userId }, transaction });
			const block = existing
				? await existing.update({ reason, blockedBy }, { transaction })
				: await this.create({ chapterId, userId, reason, blockedBy }, { transaction });
			const [held] = await this.sequelize.models.Message.update(
				{ heldReason: HELD_WRITER_BLOCKED },
				{
					where: { relayChapter: chapterId, user: userId, status: QUEUED, heldReason: null },
					hooks: false,
					transaction
				}
			);
			return { block, held, created: !existing };
		});
	}

	/**
	 * Lift a block, and let go the letters it held.
	 * @returns {Promise<{lifted: boolean, released: number}>}
	 */
	static async lift(chapterId, userId) {
		return await inTransaction(this.sequelize, async (transaction) => {
			const lifted = await this.destroy({ where: { chapterId, userId }, transaction });
			const [released] = await this.sequelize.models.Message.update(
				{ heldReason: null },
				{
					where: { relayChapter: chapterId, user: userId, heldReason: HELD_WRITER_BLOCKED },
					hooks: false,
					transaction
				}
			);
			return { lifted: lifted > 0, released };
		});
	}
}
