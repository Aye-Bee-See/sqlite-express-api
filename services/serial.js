/**
 * A queue that runs async work one piece at a time, in this process. Used
 * where a check and the write it guards must not interleave with another
 * request's. In-process is enough for one Node process on SQLite, which has
 * a single writer anyway; a multi-process deployment would need a
 * database-level lock instead.
 * @returns {<T>(work: () => Promise<T>) => Promise<T>}
 */
export function createSerialQueue() {
	let tail = Promise.resolve();
	return function run(work) {
		const result = tail.then(work, work);
		tail = result.catch(() => {});
		return result;
	};
}

const oneTransactionAtATime = createSerialQueue();

/**
 * Run `work` in a database transaction, one transaction at a time in this
 * process. SQLite has a single writer in any case, and an in-memory
 * database (tests) has a single connection, on which a second BEGIN fails
 * with "cannot start a transaction within a transaction". Queues that call
 * this may be different ones; always take the caller's queue first and this
 * one second, so they cannot wait on each other.
 * @template T
 * @param {import('sequelize').Sequelize} sequelize
 * @param {(transaction: import('sequelize').Transaction) => Promise<T>} work
 * @returns {Promise<T>}
 */
export function inTransaction(sequelize, work) {
	return oneTransactionAtATime(() => sequelize.transaction(work));
}
