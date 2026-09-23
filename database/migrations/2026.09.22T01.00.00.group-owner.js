import { DataTypes } from 'sequelize';
import { withForeignKeysOff } from '../migration-helpers.js';

/**
 * Every chapter has one group-owner admin: the account that hands the
 * chapter key to group admins and takes it away, rotates it, and may pass
 * ownership on. Decided on 22 September 2026. Chapters that already exist get
 * their earliest key holder, or failing that their earliest group admin.
 */
export async function up({ context: queryInterface }) {
	const { sequelize } = queryInterface;
	await queryInterface.addColumn('Chapters', 'ownerId', {
		type: DataTypes.INTEGER,
		references: { model: 'User', key: 'id' },
		onDelete: 'SET NULL',
		onUpdate: 'CASCADE'
	});
	await sequelize.query(
		'UPDATE `Chapters` SET `ownerId` = (SELECT `userId` FROM `OrgMemberKeys` k WHERE k.`chapterId` = `Chapters`.`id` ORDER BY k.`id` LIMIT 1) WHERE `ownerId` IS NULL'
	);
	await sequelize.query(
		"UPDATE `Chapters` SET `ownerId` = (SELECT `id` FROM `User` u WHERE u.`chapterId` = `Chapters`.`id` AND u.`role` = 'chapter' ORDER BY u.`id` LIMIT 1) WHERE `ownerId` IS NULL"
	);
}

export async function down({ context: queryInterface }) {
	// A foreign key: SQLite will not drop it in place.
	await withForeignKeysOff(queryInterface, async () => {
		await queryInterface.removeColumn('Chapters', 'ownerId');
	});
}
