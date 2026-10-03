/**
 * GET /auth/blocks reads one writer's group blocks at every sign-in. The only
 * index was (chapterId, userId), which SQLite cannot use to find a writer's rows,
 * so that read scanned the table. An index led by userId serves it, and its
 * newest-first order, without a sort. (Raised by Copilot on #179.)
 */
export async function up({ context: queryInterface }) {
	await queryInterface.addIndex('GroupBlocks', ['userId'], { name: 'group_blocks_user' });
}

export async function down({ context: queryInterface }) {
	await queryInterface.removeIndex('GroupBlocks', 'group_blocks_user');
}
