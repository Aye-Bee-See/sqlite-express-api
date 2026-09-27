/**
 * What a write changed, for the audit log and the history endpoints.
 *
 * An audit entry used to record the fields a request *sent* (`{ fields: … }`),
 * which answers "what was asked for" and not "what changed": a request that
 * re-sends a facility's whole profile looks like a rewrite even when one word
 * moved. `changesBetween` compares the row as it was against what was asked
 * and keeps only the fields that actually differ, each with its old and new
 * value, so a record's history reads as a sequence of changes.
 *
 * Values are stored as they are, because a history nobody can read the old
 * value in is not much of a history — capped per value, since `charges` and
 * `bio` are free text and an audit row should not become a copy of the record.
 */

/** Longest value kept per side of a change. */
const MAX_VALUE = 1000;

function trim(value) {
	if (typeof value !== 'string' || value.length <= MAX_VALUE) {
		return value;
	}
	return value.slice(0, MAX_VALUE) + '…';
}

/** Compare as the database would: two dates for one instant are one value. */
function same(before, after) {
	if (before instanceof Date || after instanceof Date) {
		const at = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());
		const a = at(before);
		const b = at(after);
		if (!Number.isNaN(a) && !Number.isNaN(b)) {
			return a === b;
		}
	}
	// Everything else, including arrays and objects, by value.
	return JSON.stringify(before ?? null) === JSON.stringify(after ?? null);
}

/**
 * The fields that differ, old and new.
 * @param {object|null} before the row as it was (a model instance or a plain object)
 * @param {object} after what the request asked for
 * @param {string[]} [only] fields to consider; by default every key of `after`
 * @returns {object|null} `{ field: { from, to } }`, or null when nothing changed
 */
export function changesBetween(before, after, only) {
	const fields = (only ?? Object.keys(after ?? {})).filter((f) => f !== 'id');
	const was = before && typeof before.get === 'function' ? before.get({ plain: true }) : before;
	const changes = {};
	for (const field of fields) {
		if (!(field in (after ?? {}))) {
			continue;
		}
		const from = was ? was[field] : undefined;
		const to = after[field];
		if (!same(from, to)) {
			changes[field] = { from: trim(from ?? null), to: trim(to ?? null) };
		}
	}
	return Object.keys(changes).length > 0 ? changes : null;
}
