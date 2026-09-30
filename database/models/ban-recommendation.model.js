import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import { inTransaction } from '#services/serial.js';

/**
 * A group admin's recommendation that a writer be blocked site-wide (decided 30
 * September 2026). It waits in the moderation queue; a superadmin bans the
 * writer (the `banned` role, which ends every session at once) or dismisses it.
 * A group can only block a writer from its own letters (GroupBlock); this is the
 * way it asks for more.
 */
export default class BanRecommendation extends Model {
	static init(sequelize) {
		return super.init(Schemas.banRecommendation, {
			sequelize,
			modelName: 'BanRecommendation',
			tableName: 'BanRecommendations',
			indexes: [
				{ fields: ['status'], name: 'ban_recommendations_status' },
				{ fields: ['userId'], name: 'ban_recommendations_user' }
			]
		});
	}

	static associate(models) {
		this.belongsTo(models.User, {
			as: 'writer',
			foreignKey: 'userId',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.Chapter, {
			as: 'chapter_details',
			foreignKey: 'chapterId',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.User, {
			as: 'recommended_by',
			foreignKey: 'recommendedBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.User, {
			as: 'decided_by',
			foreignKey: 'decidedBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
	}

	/** What a list shows about the people involved. */
	static includes() {
		return [
			{ association: 'writer', attributes: ['id', 'username', 'penName', 'name', 'role'] },
			{ association: 'chapter_details', attributes: ['id', 'name'] },
			{ association: 'recommended_by', attributes: ['id', 'username', 'name'] },
			{ association: 'decided_by', attributes: ['id', 'username', 'name'] }
		];
	}

	/**
	 * Ban the writer, and settle every recommendation still pending for them: one
	 * decision answers every group that asked.
	 * @returns {Promise<number[]>} the recommendations settled
	 */
	static async ban(recommendation, { decidedBy, note }) {
		return await inTransaction(this.sequelize, async (transaction) => {
			await this.sequelize.models.User.update(
				{ role: 'banned' },
				{ where: { id: recommendation.userId }, transaction }
			);
			const pending = await this.findAll({
				where: { userId: recommendation.userId, status: 'pending' },
				attributes: ['id'],
				transaction
			});
			const ids = pending.map((row) => row.id);
			await this.update(
				{ status: 'banned', decidedBy, decidedAt: new Date(), decisionNote: note },
				{ where: { id: ids }, transaction }
			);
			return ids;
		});
	}
}
