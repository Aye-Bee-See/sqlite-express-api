import { DataTypes } from 'sequelize';
import { withForeignKeysOff } from '../migration-helpers.js';

/**
 * Directory fields for the public site: prisoner profile details,
 * facility routing and verification, group profile details, group
 * membership for accounts, and two link tables (prisoner <-> supporting
 * group, prison <-> relay group).
 */

function ref(table, onDelete) {
	return { references: { model: table, key: 'id' }, onDelete, onUpdate: 'CASCADE' };
}

const timestamps = {
	createdAt: { type: DataTypes.DATE, allowNull: false },
	updatedAt: { type: DataTypes.DATE, allowNull: false }
};

const PRISONER_COLUMNS = {
	aliases: { type: DataTypes.JSON },
	country: { type: DataTypes.STRING },
	interests: { type: DataTypes.JSON },
	photoUrl: { type: DataTypes.STRING },
	supportWebsite: { type: DataTypes.STRING },
	donationInfo: { type: DataTypes.TEXT },
	detainedSince: { type: DataTypes.DATE },
	sentence: { type: DataTypes.STRING },
	charges: { type: DataTypes.TEXT },
	statusNotice: { type: DataTypes.STRING },
	estimatedRelease: { type: DataTypes.STRING },
	featured: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
	verifiedBy: { type: DataTypes.INTEGER, ...ref('Chapters', 'SET NULL') },
	verifiedAt: { type: DataTypes.DATE },
	verificationNotes: { type: DataTypes.TEXT }
};

const PRISON_COLUMNS = {
	country: { type: DataTypes.STRING },
	routing: { type: DataTypes.STRING },
	scanService: { type: DataTypes.TEXT },
	notes: { type: DataTypes.TEXT },
	verifiedBy: { type: DataTypes.INTEGER, ...ref('Chapters', 'SET NULL') },
	verifiedAt: { type: DataTypes.DATE },
	verificationNotes: { type: DataTypes.TEXT }
};

const CHAPTER_COLUMNS = {
	subregion: { type: DataTypes.STRING },
	country: { type: DataTypes.STRING },
	about: { type: DataTypes.TEXT },
	website: { type: DataTypes.STRING },
	email: { type: DataTypes.STRING },
	socialLinks: { type: DataTypes.JSON },
	services: { type: DataTypes.JSON },
	announcement: { type: DataTypes.TEXT },
	vouchedBy: { type: DataTypes.INTEGER, ...ref('Chapters', 'SET NULL') }
};

const USER_COLUMNS = {
	chapterId: { type: DataTypes.INTEGER, ...ref('Chapters', 'SET NULL') }
};

const ADDITIONS = [
	['Prisoners', PRISONER_COLUMNS],
	['Prisons', PRISON_COLUMNS],
	['Chapters', CHAPTER_COLUMNS],
	['User', USER_COLUMNS]
];

export async function up({ context: queryInterface }) {
	for (const [table, columns] of ADDITIONS) {
		for (const [name, definition] of Object.entries(columns)) {
			await queryInterface.addColumn(table, name, definition);
		}
	}

	await queryInterface.createTable('PrisonerSupport', {
		...timestamps,
		prisoner: {
			type: DataTypes.INTEGER,
			allowNull: false,
			primaryKey: true,
			...ref('Prisoners', 'CASCADE')
		},
		chapter: {
			type: DataTypes.INTEGER,
			allowNull: false,
			primaryKey: true,
			...ref('Chapters', 'CASCADE')
		},
		description: { type: DataTypes.TEXT }
	});

	await queryInterface.createTable('PrisonRelay', {
		...timestamps,
		prison: {
			type: DataTypes.INTEGER,
			allowNull: false,
			primaryKey: true,
			...ref('Prisons', 'CASCADE')
		},
		chapter: {
			type: DataTypes.INTEGER,
			allowNull: false,
			primaryKey: true,
			...ref('Chapters', 'CASCADE')
		}
	});
}

export async function down({ context: queryInterface }) {
	await queryInterface.dropTable('PrisonRelay');
	await queryInterface.dropTable('PrisonerSupport');
	// removeColumn rebuilds the table: see withForeignKeysOff.
	await withForeignKeysOff(queryInterface, async () => {
		for (const [table, columns] of [...ADDITIONS].reverse()) {
			for (const name of Object.keys(columns).reverse()) {
				await queryInterface.removeColumn(table, name);
			}
		}
	});
}
