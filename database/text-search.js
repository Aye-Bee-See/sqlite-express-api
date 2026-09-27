import { Op, fn, col, where } from 'sequelize';

/**
 * A search for text a person typed, as a plain substring: `%` and `_` are
 * characters to find, not wildcards. SQLite's LIKE has no escape character
 * unless the query names one and Sequelize cannot, so `?q=%` used to match
 * every record; instr() matches the text as it is.
 *
 * Case is folded for ASCII letters only, on both sides, which is what LIKE did:
 * SQLite's lower() leaves other scripts alone, so a Greek or Cyrillic search
 * still matches exactly, as before.
 * @param {string} table the model name the query aliases its table as
 * @param {string[]} fields columns to look in, any of which may match
 * @param {string} term
 * @returns {object} a where-clause fragment
 */
export function containsText(table, fields, term) {
	const needle = term.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
	return {
		[Op.or]: fields.map((field) =>
			where(fn('instr', fn('lower', col(table + '.' + field)), needle), Op.gt, 0)
		)
	};
}
