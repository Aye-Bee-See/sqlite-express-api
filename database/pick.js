/**
 * The named fields of a request body that were actually sent, and nothing
 * else. Every model write goes through this: a body is never spread into a
 * create or an update, so a client cannot reach a column by naming it.
 * @param {object} source
 * @param {string[]} fields
 * @returns {object}
 */
export default function pick(source, fields) {
	const out = {};
	for (const f of fields) {
		if (Object.hasOwn(source, f) && source[f] !== undefined) {
			out[f] = source[f];
		}
	}
	return out;
}

/**
 * Update one row by id with only the allowed fields; `options.where` adds
 * conditions the row must still meet (a conditional update). With nothing to write,
 * reports whether the row exists (so the caller's 404 stays truthful) and
 * changes nothing.
 * @returns {Promise<[number]>} Sequelize's affected-row count
 */
export async function updateById(model, id, values, { where: expect = {}, ...options } = {}) {
	// `where` adds conditions the row must still meet (what the caller checked),
	// so that a check and its write cannot be separated by another request.
	if (Object.keys(values).length === 0) {
		return [await model.count({ where: { ...expect, id } })];
	}
	const [count] = await model.update(values, { ...options, where: { ...expect, id } });
	return [count];
}
