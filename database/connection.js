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
	logging: dbLogging ? console.log : false,
	// A transaction that reads and then writes must take the write lock when it
	// begins. SQLite's default (deferred) takes it at the first write, and if
	// another connection wrote in between, the write fails at once with
	// SQLITE_BUSY whatever the busy timeout says.
	transactionType: 'IMMEDIATE'
});

/** How long a statement waits for a lock before giving up, in milliseconds. */
export const BUSY_TIMEOUT_MS = 5000;

/**
 * Every connection waits for a lock instead of failing at once.
 *
 * A file database gets a second connection for each transaction (group key
 * rotation, facility writes), and SQLite allows one writer at a time. With
 * no busy timeout, a write that arrives while a transaction holds the lock
 * is refused immediately with SQLITE_BUSY. Sequelize's SQLite driver runs no
 * connection hooks, so the timeout is applied where connections are made.
 */
const connect = sequelize.connectionManager.getConnection.bind(sequelize.connectionManager);
const configured = new WeakSet();
sequelize.connectionManager.getConnection = async (options) => {
	const connection = await connect(options);
	if (!configured.has(connection)) {
		configured.add(connection);
		connection.configure('busyTimeout', BUSY_TIMEOUT_MS);
	}
	return connection;
};

/**
 * Write-ahead logging, for a database on disk. In the default rollback
 * mode a committing transaction locks every reader out; in WAL mode readers
 * carry on while one writer works. The setting is stored in the file, so it
 * is applied once and stays. It adds two files beside the database
 * (`-wal`, `-shm`): copy all three together, or back up with
 * `sqlite3 database.sqlite ".backup copy.sqlite"`.
 * @returns {Promise<string>} the journal mode in effect
 */
export async function enableWriteAheadLog() {
	if (dbStorage === ':memory:') {
		return 'memory';
	}
	const [[row]] = await sequelize.query('PRAGMA journal_mode = WAL');
	return row.journal_mode;
}

export { Sequelize };
