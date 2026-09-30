/**
 * Time-based one-time passwords (RFC 6238), as every authenticator app makes
 * them: HMAC-SHA1 over a 30-second counter, six digits. No dependency: the
 * algorithm is a dozen lines, and one more package on the sign-in path is one
 * more thing to trust.
 */
import { createHmac, randomBytes } from 'node:crypto';

const PERIOD_SECONDS = 30;
const DIGITS = 6;
/** How many 30-second steps either side of now a code is accepted from: a clock a little out. */
const WINDOW = 1;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 (RFC 4648, no padding): the form authenticator apps take a secret in. */
export function base32Encode(bytes) {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += BASE32[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) {
		out += BASE32[(value << (5 - bits)) & 31];
	}
	return out;
}

export function base32Decode(text) {
	const clean = String(text)
		.toUpperCase()
		.replace(/[^A-Z2-7]/g, '');
	let bits = 0;
	let value = 0;
	const out = [];
	for (const char of clean) {
		value = (value << 5) | BASE32.indexOf(char);
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}
	return Buffer.from(out);
}

/** A new secret: 20 random bytes, the length RFC 4226 recommends, in base32. */
export function newSecret() {
	return base32Encode(randomBytes(20));
}

/** The 30-second step a moment falls in. */
export function stepAt(now = Date.now()) {
	return Math.floor(now / 1000 / PERIOD_SECONDS);
}

/** The code for one step. */
export function codeAt(secret, step) {
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(step));
	const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
	const offset = hmac[hmac.length - 1] & 15;
	const number = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
	return String(number).padStart(DIGITS, '0');
}

/**
 * The step a typed code belongs to, or null. A step at or before `after` is
 * refused, so a code that was used once cannot be used again.
 * @param {string} secret base32
 * @param {string} code as typed (spaces are ignored)
 * @param {{after?: number|null, now?: number}} [options]
 * @returns {number|null}
 */
export function verify(secret, code, { after = null, now = Date.now() } = {}) {
	const typed = String(code ?? '').replace(/\s+/g, '');
	if (!/^\d{6}$/.test(typed) || !secret) {
		return null;
	}
	const current = stepAt(now);
	for (let step = current - WINDOW; step <= current + WINDOW; step += 1) {
		if (after !== null && after !== undefined && step <= after) {
			continue;
		}
		if (codeAt(secret, step) === typed) {
			return step;
		}
	}
	return null;
}

/**
 * The link an authenticator app reads, usually from a QR code the client draws:
 * the account's name under the site's.
 */
export function otpauthUri(secret, accountName, issuer = 'letters.support') {
	const label = encodeURIComponent(issuer + ':' + accountName);
	const params = new URLSearchParams({
		secret,
		issuer,
		algorithm: 'SHA1',
		digits: String(DIGITS),
		period: String(PERIOD_SECONDS)
	});
	return 'otpauth://totp/' + label + '?' + params.toString();
}
