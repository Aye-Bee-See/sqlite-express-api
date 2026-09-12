import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';

/** Append-only record of staff and moderation actions. */
export default class AuditLog extends Model {
	static init(sequelize) {
		return super.init(Schemas.auditLog, {
			sequelize,
			modelName: 'AuditLog',
			tableName: 'AuditLogs',
			updatedAt: false
		});
	}

	static associate(models) {
		this.belongsTo(models.User, {
			as: 'actor_details',
			foreignKey: 'actor',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
	}

	/**
	 * Append one entry.
	 * @param {{actor?: number|null, action: string, resource: string, targetId?: number|null, details?: object|null}} entry
	 */
	static async record({ actor = null, action, resource, targetId = null, details = null }) {
		return await this.create({
			actor,
			action,
			resource,
			targetId: targetId === undefined || targetId === null ? null : Number(targetId),
			details
		});
	}

	/**
	 * Newest first, with optional exact-match filters.
	 * @param {{where?: object, limit?: number, offset?: number}} options
	 */
	static async list({ where = {}, limit, offset = 0 } = {}) {
		return await this.findAndCountAll({
			where,
			limit,
			offset,
			order: [['id', 'DESC']],
			include: [{ association: 'actor_details', attributes: ['id', 'username', 'name', 'role'] }]
		});
	}
}
