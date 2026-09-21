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
/**
 * How a statement that meets a lock waits for it: by trying again from
 * JavaScript, never by blocking inside SQLite.
 *
 * SQLite's own busy timeout waits on the thread that runs the statement, and
 * Node gives all database work four threads. A handful of writers waiting for
 * the lock would hold every thread, the transaction that *has* the lock could
 * not get one to run its next statement, and nobody would move until the
 * timeouts expired, only to start again. (A fresh seeded start, which saves
 * forty letters at once, never finished.) A refused statement has done nothing,
 * so trying it again is safe: with IMMEDIATE transactions the only statements
 * that can be refused are a BEGIN and a write outside any transaction.
 *
 * 50 tries, 50 ms apart at first and 5% further apart each time: about ten
 * seconds in all, with the gaps staying under 0.6 s.
 */
export const LOCK_RETRY = {
	max: 50,
	backoffBase: 50,
	backoffExponent: 1.05,
	match: [/SQLITE_BUSY/]
};

export const sequelize = new Sequelize({
	dialect: 'sqlite',
	storage: dbStorage,
	logging: dbLogging ? console.log : false,
	// A transaction that reads and then writes must take the write lock when it
	// begins. SQLite's default (deferred) takes it at the first write, and if
	// another connection wrote in between, the write fails with SQLITE_BUSY
	// however long anyone is prepared to wait.
	transactionType: 'IMMEDIATE',
	retry: LOCK_RETRY
});

/**
 * The driver's own wait is switched off on every connection. node-sqlite3 sets
 * a busy timeout of one second by default, and that second is spent blocking a
 * database thread (see LOCK_RETRY). Sequelize's SQLite driver runs no connection
 * hooks, so it is done where connections are handed out.
 */
const connect = sequelize.connectionManager.getConnection.bind(sequelize.connectionManager);
const configured = new WeakSet();
sequelize.connectionManager.getConnection = async (options) => {
	const connection = await connect(options);
	if (!configured.has(connection)) {
		configured.add(connection);
		connection.configure('busyTimeout', 0);
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
