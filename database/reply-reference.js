/**
 * The reply reference: nine digits, the last a check digit (Luhn), printed in
 * a footer on every letter so that a prisoner can write it at the top of
 * their reply and the volunteer who opens the envelope finds the right
 * thread. Digits only, because it is copied by hand by people writing in
 * many alphabets, and the check digit turns a slip of the pen into "check the
 * number" instead of a stranger's inbox. Random, not consecutive: a number
 * says nothing about how many letters the network has sent.
 */
import { randomInt } from 'node:crypto';

export const REFERENCE_LENGTH = 9;

/** Digits only: spaces, dashes, and dots dropped. */
export function normalizeReference(value) {
	return String(value ?? '').replace(/[\s.\-–]/g, '');
}

function luhnCheckDigit(digits) {
	let sum = 0;
	let double = true; // the check digit is at the end, so the digit before it doubles
	for (let i = digits.length - 1; i >= 0; i -= 1) {
		let d = Number(digits[i]);
		if (double) {
			d *= 2;
			if (d > 9) {
				d -= 9;
			}
		}
		sum += d;
		double = !double;
	}
	return String((10 - (sum % 10)) % 10);
}

/** Nine digits that pass the check, as stored. */
export function newReference() {
	let body = '';
	for (let i = 0; i < REFERENCE_LENGTH - 1; i += 1) {
		body += String(randomInt(0, 10));
	}
	return body + luhnCheckDigit(body);
}

/** Is this nine digits whose last digit checks? Typos, swaps, and short strings are not. */
export function isReference(value) {
	const digits = normalizeReference(value);
	if (!/^[0-9]{9}$/.test(digits)) {
		return false;
	}
	return luhnCheckDigit(digits.slice(0, -1)) === digits[digits.length - 1];
}

/** `482719356` as `4827-1935-6`, the way it is printed and read aloud. */
export function formatReference(digits) {
	if (typeof digits !== 'string' || digits.length !== REFERENCE_LENGTH) {
		return digits ?? null;
	}
	return digits.slice(0, 4) + '-' + digits.slice(4, 8) + '-' + digits.slice(8);
}
