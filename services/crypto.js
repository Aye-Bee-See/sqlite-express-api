import sodium from 'libsodium-wrappers';
import { createHash } from 'node:crypto';
import { encryptionKey, encryptionMode, ENCRYPTION_MODES } from '#constants';

/**
 * Letter encryption primitives, shared by both modes.
 *
 * The shapes here are the ones the browser-side (e2e) design uses, so that
 * switching modes later re-wraps content keys and never re-encrypts bodies:
 * - a random 32-byte content key per letter, used with XChaCha20-Poly1305
 *   (libsodium `crypto_secretbox`) for the body, the relay note, and every
 *   attachment, each with its own nonce;
 * - the content key wrapped once per reader. In `server` mode the only
 *   reader is the server itself (wrapped with ENCRYPTION_KEY); in `e2e` mode
 *   readers are users and groups (sealed to their public keys).
 *
 * Everything is base64 in the database. Call `await ready` once at boot.
 */

export const ready = sodium.ready;

const B64 = () => sodium.base64_variants.ORIGINAL;

export const encode = (bytes) => sodium.to_base64(bytes, B64());
export const decode = (text) => sodium.from_base64(text, B64());

/** Throws with a plain explanation when the configuration cannot work. */
export function assertConfigured() {
	if (!ENCRYPTION_MODES.includes(encryptionMode)) {
		throw new Error(
			'ENCRYPTION_MODE must be one of ' +
				ENCRYPTION_MODES.join(', ') +
				' (got "' +
				encryptionMode +
				'").'
		);
	}
	if (encryptionMode === 'e2e') {
		throw new Error('ENCRYPTION_MODE=e2e is not implemented yet; use server.');
	}
	masterKey();
}

let cachedMaster;

/** The 32-byte server key from ENCRYPTION_KEY. */
export function masterKey() {
	if (cachedMaster) {
		return cachedMaster;
	}
	let bytes;
	try {
		bytes = encryptionKey ? decode(encryptionKey) : new Uint8Array(0);
	} catch {
		bytes = new Uint8Array(0);
	}
	if (bytes.length !== sodium.crypto_secretbox_KEYBYTES) {
		throw new Error(
			'ENCRYPTION_KEY must be the base64 of 32 random bytes; run `npm run keygen` and put the output in .env.'
		);
	}
	cachedMaster = bytes;
	return cachedMaster;
}

/** Short fingerprint of the server key, stored beside each server envelope. */
export function masterKeyLabel() {
	return createHash('sha256').update(masterKey()).digest('hex').slice(0, 12);
}

export function generateContentKey() {
	return sodium.crypto_secretbox_keygen();
}

/**
 * Encrypt bytes or a string with a content key.
 * @param {Uint8Array|Buffer|string} plain
 * @param {Uint8Array} key
 * @returns {{ciphertext: string, nonce: string}} base64
 */
export function encrypt(plain, key) {
	const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
	const bytes = typeof plain === 'string' ? sodium.from_string(plain) : plain;
	const ciphertext = sodium.crypto_secretbox_easy(bytes, nonce, key);
	return { ciphertext: encode(ciphertext), nonce: encode(nonce) };
}

/**
 * @returns {Buffer} the plaintext bytes
 * @throws when the key or nonce is wrong (libsodium reports "wrong secret key")
 */
export function decrypt(ciphertext, nonce, key) {
	return Buffer.from(sodium.crypto_secretbox_open_easy(decode(ciphertext), decode(nonce), key));
}

export const decryptString = (ciphertext, nonce, key) =>
	decrypt(ciphertext, nonce, key).toString('utf8');

/** Wrap a content key with the server key: base64(nonce || box). */
export function wrapForServer(contentKey) {
	const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
	const box = sodium.crypto_secretbox_easy(contentKey, nonce, masterKey());
	const out = new Uint8Array(nonce.length + box.length);
	out.set(nonce, 0);
	out.set(box, nonce.length);
	return encode(out);
}

export function unwrapForServer(wrapped) {
	const bytes = decode(wrapped);
	const n = sodium.crypto_secretbox_NONCEBYTES;
	return sodium.crypto_secretbox_open_easy(bytes.subarray(n), bytes.subarray(0, n), masterKey());
}

/** Seal bytes to an X25519 public key (for e2e readers). */
export function sealTo(publicKey, bytes) {
	return encode(sodium.crypto_box_seal(bytes, decode(publicKey)));
}
