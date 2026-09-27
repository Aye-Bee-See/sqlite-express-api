#!/usr/bin/env node
/**
 * Print docs/ERRORS.md from the one list of codes (services/error-codes.js), so
 * the catalogue clients translate from cannot drift away from what the API
 * answers.
 *
 *   npm run errors:docs            prints it
 *   npm run errors:docs -- --write writes docs/ERRORS.md
 *
 * `test/error-codes.test.js` fails when the file is not what this prints.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CODES, REFUSAL_FAMILIES } from '#services/error-codes.js';

export function catalogue() {
	const rows = Object.entries(CODES).map(
		([code, entry]) =>
			'| `' +
			code +
			'` | ' +
			entry.meaning +
			' | ' +
			(entry.params.length === 0 ? '—' : entry.params.map((p) => '`' + p + '`').join(', ')) +
			' |'
	);
	return (
		'# Error codes\n' +
		'\n' +
		'Generated from `services/error-codes.js` by `npm run errors:docs -- --write`. Do not edit by hand.\n' +
		'\n' +
		'A refused request answers in English and always will. `errors` holds the sentences; `problems` holds\n' +
		'the same failures in the form a client translates from, one entry per sentence and in the same order:\n' +
		'\n' +
		'```json\n' +
		'{\n' +
		'\t"success": false,\n' +
		'\t"errors": ["penName must be between 3 and 40 characters."],\n' +
		'\t"problems": [\n' +
		'\t\t{ "field": "penName", "code": "length_out_of_range", "params": { "min": 3, "max": 40 } }\n' +
		'\t]\n' +
		'}\n' +
		'```\n' +
		'\n' +
		'- **`field`** is the name of the field in the request, or `null` when the failure is about the request as a whole.\n' +
		'- **`code`** is one of the codes below, and never changes meaning. A code a client does not know yet is\n' +
		'  shown as the English sentence from `errors`.\n' +
		'- **`params`** carries limits and names to interpolate, never the value that was sent: a password or a\n' +
		"  letter's text must not come back in an error body.\n" +
		'- **`validation_failed`** means the API has no more specific code for that refusal yet. Show the sentence.\n' +
		'  Codes are added over time and never removed, so this one appears less as the API grows.\n' +
		'\n' +
		'| Code | What it means | `params` |\n' +
		'| --- | --- | --- |\n' +
		rows.join('\n') +
		'\n' +
		'\n' +
		'## Refusals that are not about a field\n' +
		'\n' +
		'A `403`, `404`, `409`, `410` or `422` where the request was well formed and the answer is still no\n' +
		'carries `name`, often `condition`, and a `code` composed from the two:\n' +
		'\n' +
		'```\n' +
		'code = family + ("." + condition, when the refusal has one)\n' +
		'```\n' +
		'\n' +
		'`family` is the error name in snake_case with `Error` dropped, so `InviteCodeError` + `used` is\n' +
		'`invite_code.used`, and `NotFoundError` on its own is `not_found`. **Match the whole code, or just the\n' +
		'family before the dot**: a refusal may grow a finer `condition` later, and a build that matched the\n' +
		'family keeps working. `name` and `condition` are still sent and are not going away.\n' +
		'\n' +
		'A `5xx` is a fault rather than a refusal and carries no `code`.\n' +
		'\n' +
		'| Family | What a refusal in it means |\n' +
		'| --- | --- |\n' +
		Object.entries(REFUSAL_FAMILIES)
			.map(([family, meaning]) => '| `' + family + '` | ' + meaning + ' |')
			.join('\n') +
		'\n'
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const text = catalogue();
	if (process.argv.includes('--write')) {
		const path = fileURLToPath(new URL('../docs/ERRORS.md', import.meta.url));
		writeFileSync(path, text);
		console.log('Wrote ' + path);
	} else {
		process.stdout.write(text);
	}
}
