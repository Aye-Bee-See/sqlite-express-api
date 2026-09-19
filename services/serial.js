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
