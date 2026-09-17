import { DataTypes } from 'sequelize';

/**
 * Group key rotation: a version counter on each group's keypair
 * (Chapters.keyVersion; 0 means no key yet) and, on every envelope sealed to
 * a group, the version it was sealed to (LetterKeys.keyVersion), so a letter
 * sealed to a key that has since been rotated away can be refused.
 */

export async function up({ context: queryInterface }) {
	await queryInterface.addColumn('Chapters', 'keyVersion', {
		type: DataTypes.INTEGER,
		allowNull: false,
		defaultValue: 0
	});
	await queryInterface.addColumn('Chapters', 'keyRotatedAt', { type: DataTypes.DATE });
	await queryInterface.addColumn('LetterKeys', 'keyVersion', { type: DataTypes.INTEGER });
	await queryInterface.sequelize.query(
		'UPDATE `Chapters` SET `keyVersion` = 1 WHERE `publicKey` IS NOT NULL'
	);
	await queryInterface.sequelize.query(
		"UPDATE `LetterKeys` SET `keyVersion` = 1 WHERE `readerType` = 'chapter'"
	);
}

export async function down({ context: queryInterface }) {
	const { withForeignKeysOff } = await import('../migration-helpers.js');
	await withForeignKeysOff(queryInterface, async () => {
		await queryInterface.removeColumn('LetterKeys', 'keyVersion');
		await queryInterface.removeColumn('Chapters', 'keyRotatedAt');
		await queryInterface.removeColumn('Chapters', 'keyVersion');
	});
}
