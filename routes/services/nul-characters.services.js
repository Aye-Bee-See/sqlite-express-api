import ValidationError from '#services/ValidationError.js';

/** Where a NUL character sits in a parsed request, at most a few of them. */
function nulPaths(value, path, found, depth = 0) {
	if (found.length >= 5 || depth > 20) {
		return found;
	}
	if (typeof value === 'string') {
		if (value.includes('\u0000')) {
			found.push(path);
		}
	} else if (Array.isArray(value)) {
		value.forEach((item, i) => nulPaths(item, path + '.' + i, found, depth + 1));
	} else if (value && typeof value === 'object') {
		for (const [key, item] of Object.entries(value)) {
			const at = path ? path + '.' + key : key;
			if (key.includes('\u0000')) {
				found.push(at);
			}
			nulPaths(item, at, found, depth + 1);
		}
	}
	return found;
}

/**
 * Middleware: no NUL character anywhere in the query or the body. Nothing this
 * API takes can hold one (ciphertext travels as base64), and Sequelize writes a
 * lookup's value into the SQL text, where SQLite stops reading at a NUL: the
 * quoted value is left open and the query fails, so `?id=%00` answered 500 on
 * every endpoint that looks a record up. Runs after each body parser, including
 * the ones a route runs itself (multipart uploads, a key rotation).
 */
export function noNulCharacters(req, res, next) {
	const found = [...nulPaths(req.query, '', []), ...nulPaths(req.body, '', [])];
	if (found.length === 0) {
		return next();
	}
	const problems = [];
	for (const field of new Set(found)) {
		problems.push({
			message: (field || 'The request') + ' contains a NUL character, which nothing here can hold.',
			field: field || null,
			code: 'wrong_type',
			params: { expected: 'text without NUL characters' }
		});
	}
	return next(new ValidationError(problems));
}
