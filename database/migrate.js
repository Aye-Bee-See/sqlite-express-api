import { Umzug, SequelizeStorage } from 'umzug';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Schema migrations with Umzug.
 *
 * - Migration files live in database/migrations/, named
 *   <timestamp>.<description>.js (Umzug's format, produced by migrate:create),
 *   and export async `up` and `down`
 *   functions that receive `{ context: queryInterface }`.
 * - Applied migrations are recorded in the SequelizeMeta table.
 * - This module never imports the models, so it can be used from the CLI
 *   without booting the application.
 *
 * CLI (from the repository root, reads .env like the server):
 *   npm run migrate                  apply pending migrations
 *   npm run migrate:down             revert the most recent one
 *   npm run migrate:status           list applied and pending
 *   npm run migrate:create -- --name add-something.js
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** The migration an existing sync()-built database is assumed to already have. */
export const INITIAL_MIGRATION = '2026.09.11T00.00.00.initial-schema.js';

const TEMPLATE = `// import { DataTypes } from 'sequelize';

/**
 * Describe the change here. Remove the eslint directives once the bodies are real.
 */
// eslint-disable-next-line no-unused-vars
export async function up({ context: queryInterface }) {
	// await queryInterface.addColumn('Table', 'column', { type: DataTypes.STRING });
}

// eslint-disable-next-line no-unused-vars
export async function down({ context: queryInterface }) {
	// await queryInterface.removeColumn('Table', 'column');
}
`;

/**
 * Build a migrator bound to a Sequelize instance.
 * @param {import('sequelize').Sequelize} sequelize
 * @param {{ quiet?: boolean }} [options]
 */
export function createMigrator(sequelize, { quiet = false } = {}) {
	return new Umzug({
		migrations: {
			glob: ['*.js', { cwd: migrationsDir }],
			// The project is ESM, so load migration files with import().
			resolve: ({ name, path, context }) => {
				const load = () => import(pathToFileURL(path).href);
				return {
					name,
					up: async () => (await load()).up({ context }),
					down: async () => (await load()).down({ context })
				};
			}
		},
		context: sequelize.getQueryInterface(),
		storage: new SequelizeStorage({ sequelize }),
		logger: quiet ? undefined : console,
		create: {
			folder: migrationsDir,
			template: (filepath) => [[filepath, TEMPLATE]]
		}
	});
}

/** The migrations that read or write letters with ENCRYPTION_KEY itself. */
const KEY_MIGRATIONS = ['2026.09.12T02.00.00.encryption.js', '2026.09.13T02.00.00.xchacha.js'];

/**
 * A database that still has letters to convert must be brought up to date with
 * the key it was written with, before that key is changed. Those two migrations
 * know one key (ENCRYPTION_KEY) and no labels: run with a new key in place they
 * could not open the old envelopes, or would convert them and leave them
 * labelled for the wrong key.
 * @throws {Error} naming what to do
 */
async function refuseKeyChangeBeforeKeyMigrations(sequelize, umzug) {
	if (!process.env.ENCRYPTION_KEY_PREVIOUS) {
		return;
	}
	const pending = (await umzug.pending()).map((m) => m.name);
	const waiting = KEY_MIGRATIONS.filter((name) => pending.includes(name));
	if (waiting.length === 0) {
		return;
	}
	const tables = await sequelize.getQueryInterface().showAllTables();
	if (!tables.includes('Messages')) {
		return; // a new database: nothing was ever written with any key
	}
	const [[{ n }]] = await sequelize.query('SELECT COUNT(*) AS n FROM `Messages`');
	if (Number(n) === 0) {
		return;
	}
	throw new Error(
		'This database has letters and has not yet run ' +
			waiting.join(', ') +
			', which can only read them with the key they were written with. Put the old key back in ENCRYPTION_KEY, remove ENCRYPTION_KEY_PREVIOUS, start the API once so that it catches up, and change the key after that.'
	);
}

/**
 * Bring the database up to date.
 *
 * - With `reset`, every table is dropped first and the full history is
 *   replayed (the old `sync({ force: true })` behaviour).
 * - Otherwise, a database that was created by `sequelize.sync()` before
 *   migrations existed (tables present, no SequelizeMeta entries) is adopted
 *   by recording the initial migration as applied.
 * - Then every pending migration is applied in order.
 *
 * @param {import('sequelize').Sequelize} sequelize
 * @param {{ reset?: boolean, quiet?: boolean, log?: (msg: string) => void }} [options]
 * @returns {Promise<string[]>} names of the migrations that were applied
 */
export async function runMigrations(sequelize, { reset = false, quiet = false, log } = {}) {
	const say = log || (quiet ? () => {} : console.log);
	const queryInterface = sequelize.getQueryInterface();
	const umzug = createMigrator(sequelize, { quiet: true });

	if (reset) {
		await queryInterface.dropAllTables();
	} else {
		const tables = await queryInterface.showAllTables();
		const executed = await umzug.executed();
		const looksLikeSyncBuilt = tables.includes('User') && tables.includes('Prisons');
		if (executed.length === 0 && looksLikeSyncBuilt) {
			await umzug.storage.logMigration({ name: INITIAL_MIGRATION });
			say('Existing database adopted: recorded ' + INITIAL_MIGRATION + ' as applied.');
		}
	}

	await refuseKeyChangeBeforeKeyMigrations(sequelize, umzug);
	const applied = await umzug.up();
	const names = applied.map((m) => m.name);
	if (names.length > 0) {
		say('Applied migrations: ' + names.join(', '));
	}
	return names;
}

// CLI entry point: `node database/migrate.js up|down|pending|executed|create ...`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const { sequelize } = await import('./connection.js');
	const umzug = createMigrator(sequelize);
	await umzug.runAsCLI();
	await sequelize.close();
}
