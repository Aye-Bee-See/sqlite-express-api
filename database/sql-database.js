import { Sequelize } from 'sequelize';
import * as Models from '#models/all.model.js';
import { dbReset, dbSeed, dbLogging } from '#constants';

import { createSeeds } from './seeds/all.seeds.js';
import { ensureAdmin } from './bootstrap-admin.js';

/**
 * SQLite through Sequelize. The database is a single file, `database.sqlite`,
 * resolved relative to the process working directory, so start the server
 * from the repository root.
 *
 * Environment (see .env.example):
 * - DB_RESET=true   drop and recreate every table on boot (default: keep data)
 * - DB_SEED=false   skip loading the seed files (default: seed empty tables)
 * - DB_LOGGING=true print every SQL statement (default: quiet)
 */
const config = {
	dialect: 'sqlite',
	storage: 'database.sqlite',
	logging: dbLogging ? console.log : false
};

export const sequelize = new Sequelize(config);

export const Chat = Models.Chat.init(sequelize, Sequelize);
export const Message = Models.Message.init(sequelize, Sequelize);
export const Prison = Models.Prison.init(sequelize, Sequelize);
export const Prisoner = Models.Prisoner.init(sequelize, Sequelize);
export const Rule = Models.Rule.init(sequelize, Sequelize);
export const User = Models.User.init(sequelize, Sequelize);
export const Chapter = Models.Chapter.init(sequelize, Sequelize);

Prisoner.associate(Models);
Prison.associate(Models);
Message.associate(Models);
User.associate(Models);
Chat.associate(Models);
Rule.associate(Models);
Chapter.associate(Models);

/**
 * Create tables (dropping them first when DB_RESET is set), load seed data
 * unless DB_SEED is false, then make sure an admin account exists.
 * Resolves once the database is ready to serve requests.
 */
export const ready = (async () => {
	if (dbReset) {
		console.warn('DB_RESET is set: dropping and recreating every table.');
	}
	await sequelize.sync({ force: dbReset });
	if (dbSeed) {
		await createSeeds();
	} else {
		console.log('DB_SEED is false: skipping seed data.');
	}
	await ensureAdmin();
	console.log('Database ready.');
})().catch((err) => {
	console.error('Database setup failed:', err);
});
