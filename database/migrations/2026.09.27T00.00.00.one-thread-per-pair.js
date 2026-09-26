/**
 * One thread per writer and prisoner (a known quirk until now: `POST
 * /chat/chat` created a second thread for a pair, and the message endpoint
 * quietly used the oldest, so the newer one collected nothing and showed as an
 * empty thread in somebody's inbox).
 *
 * Existing duplicates are merged into the oldest thread of each pair, keeping
 * every message and notification, and a unique index then makes another one
 * impossible even from a second process.
 */
export async function up({ context: queryInterface }) {
	const { sequelize } = queryInterface;
	const [pairs] = await sequelize.query(
		'SELECT `user`, `prisoner`, MIN(`id`) AS keeper, COUNT(*) AS n ' +
			'FROM `Chats` GROUP BY `user`, `prisoner` HAVING n > 1'
	);
	for (const pair of pairs) {
		const [rows] = await sequelize.query(
			'SELECT `id` FROM `Chats` WHERE `user` = :user AND `prisoner` = :prisoner AND `id` <> :keeper',
			{ replacements: { user: pair.user, prisoner: pair.prisoner, keeper: pair.keeper } }
		);
		const duplicates = rows.map((row) => row.id);
		if (duplicates.length === 0) {
			continue;
		}
		for (const table of ['Messages', 'Notifications']) {
			const [columns] = await sequelize.query('PRAGMA table_info(`' + table + '`)');
			if (columns.some((column) => column.name === 'chat')) {
				await sequelize.query(
					'UPDATE `' + table + '` SET `chat` = :keeper WHERE `chat` IN (:duplicates)',
					{ replacements: { keeper: pair.keeper, duplicates } }
				);
			}
		}
		await sequelize.query('DELETE FROM `Chats` WHERE `id` IN (:duplicates)', {
			replacements: { duplicates }
		});
	}
	// The pair already has an index (2026.09.20T00.00.00.hot-path-indexes.js);
	// the same columns, now unique, replace it under the same name.
	await queryInterface.removeIndex('Chats', 'chats_user_prisoner');
	await queryInterface.addIndex('Chats', ['user', 'prisoner'], {
		name: 'chats_user_prisoner',
		unique: true
	});
}

export async function down({ context: queryInterface }) {
	// Back to the plain index the hot-path migration added; the merged threads
	// stay merged, which is what anyone reading them would expect.
	await queryInterface.removeIndex('Chats', 'chats_user_prisoner');
	await queryInterface.addIndex('Chats', ['user', 'prisoner'], { name: 'chats_user_prisoner' });
}
