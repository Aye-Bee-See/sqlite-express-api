/**
 * One queue for everything that depends on a group's key staying put while
 * it works: rotations, and the writes that are checked against the key
 * version and then stored (a managed writer's group-sealed key, removing a
 * key holder). Run through here, a check and its write cannot straddle a
 * rotation, and two removals cannot both see "one holder to spare".
 *
 * In-process is enough: the API is a single Node process on SQLite, which
 * has one writer anyway, and an in-memory database (tests) has a single
 * connection that cannot nest transactions. A multi-process deployment
 * would need a database-level lock instead.
 *
 * @template T
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
let queue = Promise.resolve();
export function withGroupKeyLock(work) {
	const run = queue.then(work, work);
	queue = run.catch(() => {});
	return run;
}
