/**
 * The audit log is read by action (GET /moderation/audit?action=, the list of
 * actions the retention run sorts into its two windows) and deleted by action
 * and age (the retention run). With no index on either, each of those read the
 * whole table. One index on the pair serves all three: equality on action,
 * then a range on createdAt.
 *
 * Named after 2026.09.28T00.00.00.drop-photo-url.js, which was dated a day
 * early and sets the order everything after it must follow.
 */
export async function up({ context: queryInterface }) {
	await queryInterface.addIndex('AuditLogs', ['action', 'createdAt'], {
		name: 'audit_logs_action_created_at'
	});
}

export async function down({ context: queryInterface }) {
	await queryInterface.removeIndex('AuditLogs', 'audit_logs_action_created_at');
}
