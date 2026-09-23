import { createHmac } from 'node:crypto';
import { secretOrKey } from '#constants';
import ValidationError from '#services/ValidationError.js';
import { HttpError } from '#services/HttpError.js';

/**
 * How an account proves who it is.
 *
 * `plain`: the password itself is sent to POST /auth/login and checked against
 * a bcrypt hash. The server sees the one secret every key of the account is
 * derived from.
 *
 * `split`: the device runs the slow derivation once and derives two values from
 * the result (libsodium crypto_kdf, contexts "abcwrap_" and "abcauth_"): the
 * wrap key locks the private key and never leaves the device; the auth key is
 * sent as the password. The server still hashes and compares; it never sees
 * anything that opens a letter. Once an account is `split` it never goes back.
 *
 * The server derives nothing. Its part is: hand out the salt before sign-in
 * (login-params), insist that a `split` password has the shape of an auth key,
 * and refuse a `split` account a plain password ever after.
 */

export const AUTH_SCHEMES = ['plain', 'split'];

/** What every client derives with; handed out for usernames that do not exist. */
export const DEFAULT_KDF_PARAMS = {
	kdf: 'argon2id',
	alg: 2,
	opslimit: 2,
	memlimit: 67108864
};

/** Set to refuse making any more `plain` accounts through the API. The bootstrap admin is exempt. */
export const requireSplitAuth = ['1', 'true', 'yes'].includes(
	String(process.env.REQUIRE_SPLIT_AUTH || '').toLowerCase()
);

/** 32 bytes as standard base64 with padding: 44 characters, nothing else. */
export function isAuthKey(value) {
	return (
		typeof value === 'string' &&
		/^[A-Za-z0-9+/]{43}=$/.test(value) &&
		Buffer.from(value, 'base64').length === 32
	);
}

/**
 * The scheme a request asks for. Absent means `plain`, so that nothing built
 * before this changes; a client that has moved says so on every request that
 * sets a password.
 * @throws {ValidationError}
 */
export function schemeFrom(body) {
	const scheme = body && body.authScheme !== undefined ? body.authScheme : 'plain';
	if (!AUTH_SCHEMES.includes(scheme)) {
		throw new ValidationError('authScheme must be one of ' + AUTH_SCHEMES.join(', ') + '.');
	}
	if (scheme === 'plain' && requireSplitAuth) {
		throw new ValidationError(
			'This server only makes accounts whose password never reaches it: send authScheme "split" (see the README, Signing in).'
		);
	}
	return scheme;
}

/**
 * Is this password right for the scheme? A split password is an auth key and
 * nothing else; its strength was the client's to judge. A plain password has
 * the rules the model applies.
 * @throws {ValidationError}
 */
export function checkPassword(scheme, password) {
	if (scheme === 'split' && !isAuthKey(password)) {
		throw new ValidationError(
			'With authScheme "split", password is the auth key: 32 bytes as base64 (44 characters), derived on the device. Never the password itself.'
		);
	}
}

/**
 * A split account's auth key is derived from the same salt and recipe as its
 * wrap key, so the two travel together: a split password always comes with the
 * key set-up fields.
 * @throws {ValidationError}
 */
export function requireKeysForSplit(scheme, fields) {
	if (scheme !== 'split') {
		return;
	}
	if (!fields || fields.kdfSalt === undefined || fields.kdfParams === undefined) {
		throw new ValidationError(
			'authScheme "split" needs kdfSalt and kdfParams (the auth key is derived from them, as the wrap key is).'
		);
	}
}

/**
 * A split account never goes back to plain: that would have the real password
 * sent again. (An admin resetting a keyless account is the one exception, and a
 * split account is never keyless.)
 * @throws {HttpError} 409
 */
export function refuseDowngrade(storedScheme, requestedScheme) {
	if (storedScheme === 'split' && requestedScheme !== 'split') {
		throw new HttpError(
			409,
			'This account signs in with authScheme "split" and cannot go back to sending its password; send authScheme "split" with an auth key.',
			'AuthSchemeError'
		);
	}
}

/**
 * The salt handed out for a username that has no account (or no salt): the same
 * every time for the same name, and different for different names, so that the
 * answer for a stranger is indistinguishable from the answer for a member.
 */
export function fakeSalt(username) {
	const name = String(username || '')
		.normalize('NFKC')
		.trim()
		.toLowerCase();
	return createHmac('sha256', 'login-params:' + secretOrKey)
		.update(name)
		.digest()
		.subarray(0, 16)
		.toString('base64');
}
