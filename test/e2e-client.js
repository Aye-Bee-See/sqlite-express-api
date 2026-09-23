/**
 * What the browser does in end-to-end mode, for the tests: keypairs, sealed
 * envelopes, XChaCha20-Poly1305 (`crypto_aead_xchacha20poly1305_ietf`) bodies, and password / recovery / claim
 * wrapping. The KDF here is scrypt from node:crypto; the server never runs
 * a KDF, it only stores the salt and parameters the client chooses.
 */
import { createHash, scryptSync, randomBytes } from 'node:crypto';
import * as crypto from '../services/crypto.js';
import sodium from 'libsodium-wrappers';

export const ready = crypto.ready;

export function keypair() {
	return crypto.keypair();
}

/** Derive a 32-byte wrapping key from a secret (password, recovery code, claim token). */
export function deriveKey(secret, saltB64, params = { N: 1024, r: 8, p: 1 }) {
	return new Uint8Array(scryptSync(String(secret), Buffer.from(saltB64, 'base64'), 32, params));
}

/** Wrap a private key under a secret: returns the fields the API stores. */
export function wrapPrivateKey(privateKeyB64, secret, prefix) {
	const salt = randomBytes(16).toString('base64');
	const params = { kdf: 'scrypt', N: 1024, r: 8, p: 1 };
	const key = deriveKey(secret, salt, params);
	const { ciphertext, nonce } = crypto.encrypt(crypto.decode(privateKeyB64), key);
	const wrapped = JSON.stringify({ ciphertext, nonce });
	return {
		[prefix + 'WrappedPrivateKey']: wrapped,
		[prefix + 'Salt']: salt,
		[prefix + 'KdfParams']: params
	};
}

export function unwrapPrivateKey(wrapped, secret, salt, params) {
	const { ciphertext, nonce } = JSON.parse(wrapped);
	return crypto.encode(crypto.decrypt(ciphertext, nonce, deriveKey(secret, salt, params)));
}

/** Registration material for a password and a recovery code. */
export function accountKeys(password, recoveryCode) {
	const kp = keypair();
	const pw = wrapPrivateKey(kp.privateKey, password, '');
	const rc = wrapPrivateKey(kp.privateKey, recoveryCode, 'recovery');
	return {
		privateKey: kp.privateKey,
		fields: {
			publicKey: kp.publicKey,
			wrappedPrivateKey: pw.WrappedPrivateKey,
			kdfSalt: pw.Salt,
			kdfParams: pw.KdfParams,
			recoveryWrappedPrivateKey: rc.recoveryWrappedPrivateKey,
			recoverySalt: rc.recoverySalt,
			recoveryKdfParams: rc.recoveryKdfParams
		}
	};
}

/**
 * The split scheme (services/auth-scheme.js): one derivation gives a wrap key,
 * which locks the private key on the device, and an auth key, which is sent as
 * the password. The master here comes from scrypt, standing in for Argon2id as
 * everywhere in this client; the two derivations below are the real ones.
 */
export function splitKeys(password, recoveryCode) {
	const kp = keypair();
	const salt = randomBytes(16).toString('base64');
	const params = { kdf: 'scrypt', N: 1024, r: 8, p: 1 };
	const master = deriveKey(password, salt, params);
	const wrapKey = sodium.crypto_kdf_derive_from_key(32, 1, 'abcwrap_', master);
	const authKey = sodium.crypto_kdf_derive_from_key(32, 2, 'abcauth_', master);
	const { ciphertext, nonce } = crypto.encrypt(crypto.decode(kp.privateKey), wrapKey);
	const rc = wrapPrivateKey(kp.privateKey, recoveryCode, 'recovery');
	return {
		privateKey: kp.privateKey,
		authKey: Buffer.from(authKey).toString('base64'),
		fields: {
			authScheme: 'split',
			publicKey: kp.publicKey,
			wrappedPrivateKey: JSON.stringify({ ciphertext, nonce }),
			kdfSalt: salt,
			kdfParams: params,
			recoveryWrappedPrivateKey: rc.recoveryWrappedPrivateKey,
			recoverySalt: rc.recoverySalt,
			recoveryKdfParams: rc.recoveryKdfParams
		}
	};
}

/** What a client does at sign-in with the answer of GET /auth/login-params. */
export function authKeyFor(password, kdfSalt, kdfParams) {
	const master = deriveKey(password, kdfSalt, kdfParams);
	return Buffer.from(sodium.crypto_kdf_derive_from_key(32, 2, 'abcauth_', master)).toString(
		'base64'
	);
}

/** Seal a content key (or any bytes) to a reader's public key. */
export function seal(publicKey, bytes) {
	return crypto.sealTo(publicKey, bytes);
}

export function open(sealed, publicKey, privateKey) {
	return crypto.openSealed(sealed, publicKey, privateKey);
}

/** Encrypt a letter for a set of readers. */
export function encryptLetter(text, readers, note) {
	const contentKey = crypto.generateContentKey();
	const body = crypto.encrypt(text, contentKey);
	// A group envelope names the version of the group key it is sealed to (1 until a rotation).
	const envelopes = readers.map((r) => ({
		readerType: r.readerType,
		readerId: r.readerId,
		wrappedKey: seal(r.publicKey, contentKey),
		...(r.readerType === 'chapter' ? { keyVersion: r.keyVersion ?? 1 } : {})
	}));
	const fields = { ciphertext: body.ciphertext, nonce: body.nonce, envelopes };
	if (note !== undefined) {
		const n = crypto.encrypt(note, contentKey);
		fields.relayNoteCiphertext = n.ciphertext;
		fields.relayNoteNonce = n.nonce;
	}
	return { contentKey, fields };
}

/** Open the caller's envelope and decrypt the body. */
export function decryptLetter(message, envelope, publicKey, privateKey) {
	const contentKey = open(envelope.wrappedKey, publicKey, privateKey);
	const text = crypto.decryptString(message.ciphertext, message.nonce, contentKey);
	const note = message.relayNoteCiphertext
		? crypto.decryptString(message.relayNoteCiphertext, message.relayNoteNonce, contentKey)
		: null;
	return { contentKey, text, note };
}

/** Encrypt file bytes with a content key: returns ciphertext bytes and the nonce. */
export function encryptFile(bytes, contentKey) {
	const { ciphertext, nonce } = crypto.encrypt(bytes, contentKey);
	return { bytes: Buffer.from(crypto.decode(ciphertext)), nonce };
}

export function decryptFile(bytes, nonce, contentKey) {
	return crypto.decrypt(crypto.encode(bytes), nonce, contentKey);
}

/** A claim token the way the group's browser makes one. */
export function claimToken() {
	const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
	let token = '';
	for (const b of randomBytes(24)) {
		token += alphabet[b % 32];
	}
	return token;
}

export function hashToken(token) {
	return createHash('sha256').update(String(token).trim().toUpperCase()).digest('hex');
}
