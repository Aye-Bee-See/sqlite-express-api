import { DataTypes } from 'sequelize';

/** Items of the front-page news feed, pulled by the server (services/news-feed.js). */
export async function up({ context: queryInterface }) {
	await queryInterface.createTable('NewsItems', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		guid: { type: DataTypes.STRING, allowNull: false, unique: true },
		title: { type: DataTypes.STRING, allowNull: false },
		url: { type: DataTypes.STRING, allowNull: false },
		date: { type: DataTypes.DATE },
		summary: { type: DataTypes.TEXT },
		fetchedAt: { type: DataTypes.DATE, allowNull: false },
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.addIndex('NewsItems', ['date'], { name: 'news_items_date' });
}

export async function down({ context: queryInterface }) {
	await queryInterface.dropTable('NewsItems');
}
