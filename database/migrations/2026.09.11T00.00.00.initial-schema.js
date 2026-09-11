import { DataTypes } from 'sequelize';

/**
 * Initial schema.
 *
 * Reproduces exactly what `sequelize.sync()` created before migrations were
 * introduced (September 2026), so an existing database can be adopted by
 * recording this migration as applied without running it. Every later
 * change to a table belongs in a new migration file, never here.
 */

const timestamps = {
	createdAt: { type: DataTypes.DATE, allowNull: false },
	updatedAt: { type: DataTypes.DATE, allowNull: false }
};

const id = { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true };

function references(table, onDelete = 'RESTRICT') {
	return { references: { model: table, key: 'id' }, onDelete, onUpdate: 'CASCADE' };
}

export async function up({ context: queryInterface }) {
	await queryInterface.createTable('User', {
		id,
		name: { type: DataTypes.STRING },
		username: { type: DataTypes.STRING, allowNull: false, unique: true },
		password: { type: DataTypes.STRING, allowNull: false },
		email: { type: DataTypes.STRING, allowNull: false, unique: true },
		bio: { type: DataTypes.TEXT },
		role: { type: DataTypes.STRING, allowNull: false },
		...timestamps
	});

	await queryInterface.createTable('Prisons', {
		id,
		prisonName: { type: DataTypes.STRING, allowNull: false },
		address: { type: DataTypes.JSON, allowNull: false },
		...timestamps
	});

	await queryInterface.createTable('Prisoners', {
		id,
		birthName: { type: DataTypes.STRING },
		chosenName: { type: DataTypes.STRING },
		prison: { type: DataTypes.INTEGER, ...references('Prisons') },
		inmateID: { type: DataTypes.STRING },
		releaseDate: { type: DataTypes.DATE },
		bio: { type: DataTypes.STRING },
		status: { type: DataTypes.STRING },
		...timestamps
	});

	await queryInterface.createTable('Chats', {
		user: { type: DataTypes.INTEGER, ...references('User') },
		prisoner: { type: DataTypes.INTEGER, ...references('Prisoners') },
		id,
		...timestamps
	});

	await queryInterface.createTable('Messages', {
		id,
		chat: { type: DataTypes.INTEGER, allowNull: false, ...references('Chats') },
		messageText: { type: DataTypes.STRING },
		sender: { type: DataTypes.STRING, allowNull: false },
		prisoner: { type: DataTypes.INTEGER, allowNull: false, ...references('Prisoners') },
		user: { type: DataTypes.INTEGER, allowNull: false, ...references('User') },
		...timestamps
	});

	await queryInterface.createTable('Rules', {
		id,
		title: { type: DataTypes.STRING },
		description: { type: DataTypes.STRING },
		...timestamps
	});

	await queryInterface.createTable('Chapters', {
		id,
		name: { type: DataTypes.STRING, allowNull: false },
		location: { type: DataTypes.JSON, allowNull: false },
		prisoners: { type: DataTypes.JSON },
		lettersSent: { type: DataTypes.STRING },
		averageTimeDays: { type: DataTypes.INTEGER },
		...timestamps
	});

	await queryInterface.createTable('RulePassthrough', {
		...timestamps,
		prison: {
			type: DataTypes.INTEGER,
			allowNull: false,
			primaryKey: true,
			...references('Prisons', 'CASCADE')
		},
		rule: {
			type: DataTypes.INTEGER,
			allowNull: false,
			primaryKey: true,
			...references('Rules', 'CASCADE')
		}
	});
}

export async function down({ context: queryInterface }) {
	for (const table of [
		'RulePassthrough',
		'Chapters',
		'Rules',
		'Messages',
		'Chats',
		'Prisoners',
		'Prisons',
		'User'
	]) {
		await queryInterface.dropTable(table);
	}
}
