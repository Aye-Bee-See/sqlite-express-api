import { Sequelize } from 'sequelize';
import { dbLogging, dbStorage } from '#constants';

/**
 * The single Sequelize connection.
 *
 * Kept separate from sql-database.js so the migration CLI can open the
 * database without triggering model initialisation, seeding, or the admin
 * bootstrap.
 *
 * SQLite through Sequelize. The database is a single file resolved relative
 * to the process working directory (start the server from the repository
 * root), or ':memory:' for a throwaway database.
 */
export const sequelize = new Sequelize({
	dialect: 'sqlite',
	storage: dbStorage,
	logging: dbLogging ? console.log : false
});

export { Sequelize };
