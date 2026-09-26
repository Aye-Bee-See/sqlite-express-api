import { DataTypes } from 'sequelize';
import { dropColumn } from '../migration-helpers.js';

/**
 * Photographs of the people in the directory, hosted here (decided 26
 * September 2026). A wall of text is not a directory anybody reads, and a
 * photo hosted somewhere else tells that host who is looking at whom.
 *
 * `photoFile` is the stored file under UPLOAD_DIR, as attachments are stored;
 * `photoCredit` is the line shown beside it (a support site, a family's
 * permission); `photoAddedAt` and `photoAddedBy` say when and by whom, so a
 * photo can be traced back to the group that put it there. The older
 * `photoUrl` column, a link to a picture hosted elsewhere, is left alone.
 */
export async function up({ context: queryInterface }) {
	await queryInterface.addColumn('Prisoners', 'photoFile', { type: DataTypes.STRING });
	await queryInterface.addColumn('Prisoners', 'photoCredit', { type: DataTypes.STRING });
	await queryInterface.addColumn('Prisoners', 'photoAddedAt', { type: DataTypes.DATE });
	await queryInterface.addColumn('Prisoners', 'photoAddedBy', {
		type: DataTypes.INTEGER,
		references: { model: 'User', key: 'id' },
		onDelete: 'SET NULL',
		onUpdate: 'CASCADE'
	});
}

export async function down({ context: queryInterface }) {
	for (const column of ['photoFile', 'photoCredit', 'photoAddedAt', 'photoAddedBy']) {
		await dropColumn(queryInterface, 'Prisoners', column);
	}
}
