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
	 * One record's history, newest first: every entry whose resource and target
	 * are this record. An entry written against another resource (a moderation
	 * decision, say) is not here — the paths that change a record through a
	 * proposal write a second entry against the record itself, so that a record's
	 * history is complete without joining through JSON.
	 * @param {string} resource 'prisoner', 'prison', 'chapter'
	 * @param {number|string} targetId
	 * @param {{limit?: number, offset?: number}} [options]
	 */
	static async forRecord(resource, targetId, { limit, offset = 0, actions = null } = {}) {
		return await this.findAndCountAll({
			where: { resource, targetId: Number(targetId), ...(actions ? { action: actions } : {}) },
			limit,
			offset,
			order: [['id', 'DESC']],
			include: [{ association: 'actor_details', attributes: ['id', 'username', 'name', 'role'] }]
		});
	}

	/**
	 * An entry as a history reads it: when, what, who, and what changed. The
	 * actor is null for an entry the server wrote itself (a retention run) or one
	 * whose account has since been deleted — the log keeps the action, not the name.
	 */
	static asHistory(row) {
		const details = row.details && typeof row.details === 'object' ? { ...row.details } : null;
		const changes = details && details.changes ? details.changes : null;
		if (details) {
			delete details.changes;
		}
		return {
			id: row.id,
			at: row.createdAt,
			action: row.action,
			actor: row.actor_details
				? {
						id: row.actor_details.id,
						username: row.actor_details.username,
						name: row.actor_details.name,
						role: row.actor_details.role
					}
				: null,
			...(changes ? { changes } : {}),
			...(details && Object.keys(details).length > 0 ? { details } : {})
		};
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
