import sodium from 'libsodium-wrappers';
import { createHash } from 'node:crypto';
import { encryptionKey, encryptionKeyPrevious, encryptionMode, ENCRYPTION_MODES } from '#constants';

/**
 * Letter encryption primitives, shared by both modes.
 *
 * The shapes here are the ones the browser-side (e2e) design uses, so that
 * switching modes later re-wraps content keys and never re-encrypts bodies:
 * - a random 32-byte content key per letter, used with XChaCha20-Poly1305
 *   (libsodium `crypto_aead_xchacha20poly1305_ietf`, no associated data) for
 *   the body, the relay note, and every
 *   attachment, each with its own nonce;
 * - the content key wrapped once per reader. In `server` mode the only
 *   reader is the server itself (wrapped with ENCRYPTION_KEY); in `e2e` mode
 *   readers are users and groups (sealed to their public keys).
 *
 * Everything is base64 in the database. Call `await ready` once at boot.
 */

export const ready = sodium.ready;

/** True when the browser holds the keys and the server only stores ciphertext. */
export const isE2E = () => encryptionMode === 'e2e';

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
	if (encryptionMode === 'server') {
		masterKey();
	}
	// Checked in every mode: after a switch to end-to-end the server still opens
	// the letters that wait for readers who have no keys yet.
	previousKey();
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
	if (bytes.length !== sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES) {
		throw new Error(
			'ENCRYPTION_KEY must be the base64 of 32 random bytes; run `npm run keygen` and put the output in .env.'
		);
	}
	cachedMaster = bytes;
	return cachedMaster;
}

const labelOf = (key) => createHash('sha256').update(key).digest('hex').slice(0, 12);

let cachedPrevious;

/**
 * The key that ENCRYPTION_KEY replaced (ENCRYPTION_KEY_PREVIOUS), or null.
 * Only ever used to open what it wrapped; nothing new is written with it.
 */
export function previousKey() {
	if (cachedPrevious !== undefined) {
		return cachedPrevious;
	}
	if (!encryptionKeyPrevious) {
		cachedPrevious = null;
		return null;
	}
	let bytes;
	try {
		bytes = decode(encryptionKeyPrevious);
	} catch {
		bytes = new Uint8Array(0);
	}
	if (bytes.length !== sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES) {
		throw new Error(
			'ENCRYPTION_KEY_PREVIOUS must be the base64 of 32 bytes: the old ENCRYPTION_KEY.'
		);
	}
	if (encryptionKey && encode(bytes) === encode(decode(encryptionKey))) {
		throw new Error(
			'ENCRYPTION_KEY_PREVIOUS is the same as ENCRYPTION_KEY. Put the NEW key (npm run keygen) in ENCRYPTION_KEY and the old one in ENCRYPTION_KEY_PREVIOUS.'
		);
	}
	cachedPrevious = bytes;
	return cachedPrevious;
}

/** The label of ENCRYPTION_KEY_PREVIOUS, or null. */
export function previousKeyLabel() {
	const key = previousKey();
	return key ? labelOf(key) : null;
}

/** Short fingerprint of the server key, stored beside each server envelope. */
export function masterKeyLabel() {
	return labelOf(masterKey());
}

export function generateContentKey() {
	return sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
}

/**
 * Encrypt bytes or a string with a content key.
 * @param {Uint8Array|Buffer|string} plain
 * @param {Uint8Array} key
 * @returns {{ciphertext: string, nonce: string}} base64
 */
export function encrypt(plain, key) {
	const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
	const bytes = typeof plain === 'string' ? sodium.from_string(plain) : plain;
	const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
		bytes,
		null,
		null,
		nonce,
		key
	);
	return { ciphertext: encode(ciphertext), nonce: encode(nonce) };
}

/**
 * @returns {Buffer} the plaintext bytes
 * @throws when the key or nonce is wrong (libsodium reports "wrong secret key")
 */
export function decrypt(ciphertext, nonce, key) {
	return Buffer.from(
		sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
			null,
			decode(ciphertext),
			null,
			decode(nonce),
			key
		)
	);
}

export const decryptString = (ciphertext, nonce, key) =>
	decrypt(ciphertext, nonce, key).toString('utf8');

/** Wrap a content key with the server key: base64(nonce || box). */
export function wrapForServer(contentKey) {
	const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
	const box = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
		contentKey,
		null,
		null,
		nonce,
		masterKey()
	);
	const out = new Uint8Array(nonce.length + box.length);
	out.set(nonce, 0);
	out.set(box, nonce.length);
	return encode(out);
}

function unwrapWith(wrapped, key) {
	const bytes = decode(wrapped);
	const n = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
	return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
		null,
		bytes.subarray(n),
		null,
		bytes.subarray(0, n),
		key
	);
}

/**
 * Which server key wrapped an envelope with this label: 'current', 'previous',
 * or null for a key this server does not have. An envelope from before labels
 * existed (null) is taken to be the current key's.
 */
export function serverKeyNamed(label) {
	if (!label || label === masterKeyLabel()) {
		return 'current';
	}
	return label === previousKeyLabel() ? 'previous' : null;
}

/**
 * Open a content key the server wrapped.
 * @param {string} wrapped
 * @param {string|null} [label] the envelope's keyLabel; says which key wrapped it
 * @throws {Error} when the label names a key this server does not have, or the key does not open it
 */
export function unwrapForServer(wrapped, label = null) {
	const which = serverKeyNamed(label);
	if (which === null) {
		throw new Error(
			'wrapped with a different ENCRYPTION_KEY (' +
				label +
				'). If the key was changed, put the old one in ENCRYPTION_KEY_PREVIOUS and run npm run encryption:rekey.'
		);
	}
	return unwrapWith(wrapped, which === 'previous' ? previousKey() : masterKey());
}

/**
 * The cipher used before 2026-09-13 (libsodium `crypto_secretbox`, which is
 * XSalsa20-Poly1305). Kept only so the conversion migration can read and,
 * on rollback, write the old format; nothing else may use it.
 */
export const legacy = {
	encrypt(plain, key) {
		const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
		const bytes = typeof plain === 'string' ? sodium.from_string(plain) : plain;
		return {
			ciphertext: encode(sodium.crypto_secretbox_easy(bytes, nonce, key)),
			nonce: encode(nonce)
		};
	},
	decrypt(ciphertext, nonce, key) {
		return Buffer.from(sodium.crypto_secretbox_open_easy(decode(ciphertext), decode(nonce), key));
	},
	wrapForServer(contentKey) {
		const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
		const box = sodium.crypto_secretbox_easy(contentKey, nonce, masterKey());
		const out = new Uint8Array(nonce.length + box.length);
		out.set(nonce, 0);
		out.set(box, nonce.length);
		return encode(out);
	},
	unwrapForServer(wrapped) {
		const bytes = decode(wrapped);
		const n = sodium.crypto_secretbox_NONCEBYTES;
		return sodium.crypto_secretbox_open_easy(bytes.subarray(n), bytes.subarray(0, n), masterKey());
	}
};

/**
 * The agreed shape for key-derivation parameters stored beside a wrapped
 * key: an object naming the KDF, e.g.
 * { "kdf": "argon2id", "alg": 2, "opslimit": 2, "memlimit": 67108864 }.
 * The server never derives keys; it only checks the shape so two clients
 * cannot write something the other cannot read.
 */
export function isKdfParams(value) {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		typeof value.kdf === 'string' &&
		value.kdf.trim() !== ''
	);
}

export const KDF_PARAMS_HINT =
	'must be an object naming the KDF, e.g. { "kdf": "argon2id", "alg": 2, "opslimit": 2, "memlimit": 67108864 }.';

/** Is this a plausible base64 X25519 public key? */
export function isPublicKey(value) {
	try {
		return typeof value === 'string' && decode(value).length === sodium.crypto_box_PUBLICKEYBYTES;
	} catch {
		return false;
	}
}

/** Random bytes, base64. */
export function randomToken(bytes = 32) {
	return encode(sodium.randombytes_buf(bytes));
}

/** SHA-256 hex of a base64 value, for storing challenges and secrets. */
export function fingerprint(base64) {
	return createHash('sha256').update(String(base64)).digest('hex');
}

/** Seal bytes to an X25519 public key (for e2e readers). */
export function sealTo(publicKey, bytes) {
	return encode(sodium.crypto_box_seal(bytes, decode(publicKey)));
}

/** Open a sealed box with a keypair (tests and tooling only; the API never holds private keys). */
export function openSealed(sealed, publicKey, privateKey) {
	return sodium.crypto_box_seal_open(decode(sealed), decode(publicKey), decode(privateKey));
}

/** A fresh X25519 keypair as base64 (tests and tooling only). */
export function keypair() {
	const kp = sodium.crypto_box_keypair();
	return { publicKey: encode(kp.publicKey), privateKey: encode(kp.privateKey) };
}
