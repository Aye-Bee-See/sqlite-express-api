import { DataTypes } from 'sequelize';

/**
 * Moderation: proposed directory changes (Submissions) and an append-only
 * record of staff actions (AuditLogs).
 */

function ref(table, onDelete) {
	return { references: { model: table, key: 'id' }, onDelete, onUpdate: 'CASCADE' };
}

const timestamps = {
	createdAt: { type: DataTypes.DATE, allowNull: false },
	updatedAt: { type: DataTypes.DATE, allowNull: false }
};

export async function up({ context: queryInterface }) {
	await queryInterface.createTable('Submissions', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		resource: { type: DataTypes.STRING, allowNull: false },
		kind: { type: DataTypes.STRING, allowNull: false },
		targetId: { type: DataTypes.INTEGER },
		payload: { type: DataTypes.JSON, allowNull: false },
		evidence: { type: DataTypes.TEXT },
		note: { type: DataTypes.TEXT },
		status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
		submittedBy: { type: DataTypes.INTEGER, ...ref('User', 'SET NULL') },
		reviewedBy: { type: DataTypes.INTEGER, ...ref('User', 'SET NULL') },
		reviewedAt: { type: DataTypes.DATE },
		decisionNote: { type: DataTypes.TEXT },
		appliedChanges: { type: DataTypes.JSON },
		...timestamps
	});
	await queryInterface.addIndex('Submissions', ['status', 'resource'], {
		name: 'submissions_status_resource'
	});
	await queryInterface.addIndex('Submissions', ['submittedBy'], {
		name: 'submissions_submitted_by'
	});

	await queryInterface.createTable('AuditLogs', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		actor: { type: DataTypes.INTEGER, ...ref('User', 'SET NULL') },
		action: { type: DataTypes.STRING, allowNull: false },
		resource: { type: DataTypes.STRING, allowNull: false },
		targetId: { type: DataTypes.INTEGER },
		details: { type: DataTypes.JSON },
		createdAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.addIndex('AuditLogs', ['resource', 'targetId'], {
		name: 'audit_logs_resource_target'
	});
	await queryInterface.addIndex('AuditLogs', ['actor'], { name: 'audit_logs_actor' });
}

export async function down({ context: queryInterface }) {
	await queryInterface.dropTable('AuditLogs');
	await queryInterface.dropTable('Submissions');
}
