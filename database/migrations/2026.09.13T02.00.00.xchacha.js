import { readFile, writeFile } from 'node:fs/promises';
import * as crypto from '#services/crypto.js';
import { storedPath } from '#services/files.js';

/**
 * Cipher correction: the code used libsodium's crypto_secretbox
 * (XSalsa20-Poly1305) while every document promised XChaCha20-Poly1305.
 * The code now uses XChaCha20-Poly1305 (crypto_aead_xchacha20poly1305_ietf).
 * This migration converts everything the server can read: letters that
 * still have a server envelope (bodies, relay notes, attachment files, and
 * the envelope itself). Letters without a server envelope were sealed by a
 * browser and cannot be converted here; the migration refuses to run while
 * any exist, since no such data exists before this release.
 */

async function convert(queryInterface, from, to) {
	await crypto.ready;
	crypto.assertConfigured();
	const { sequelize } = queryInterface;
	const [orphans] = await sequelize.query(
		"SELECT COUNT(*) AS n FROM `Messages` WHERE `id` NOT IN (SELECT `message` FROM `LetterKeys` WHERE `readerType` = 'server')"
	);
	if (Number(orphans[0].n) > 0) {
		throw new Error(
			orphans[0].n +
				' letter(s) have no server envelope and cannot be re-encrypted by the server; this cipher change must run before any end-to-end letters exist.'
		);
	}
	const [envelopes] = await sequelize.query(
		"SELECT `id`, `message`, `wrappedKey` FROM `LetterKeys` WHERE `readerType` = 'server'"
	);
	for (const env of envelopes) {
		let key;
		try {
			key = from.unwrapForServer(env.wrappedKey);
		} catch (err) {
			// Already in the cipher this is converting to? A database that still held
			// plain-text letters gets them encrypted by the migration before this one,
			// which uses today's cipher: there is nothing to convert, and nothing wrong.
			// (The two ciphers authenticate differently, so one never opens the other's.)
			try {
				to.unwrapForServer(env.wrappedKey);
			} catch {
				throw err;
			}
			continue;
		}
		const [[row]] = await sequelize.query(
			'SELECT `ciphertext`, `nonce`, `relayNoteCiphertext`, `relayNoteNonce` FROM `Messages` WHERE `id` = ?',
			{ replacements: [env.message] }
		);
		const body = row.ciphertext
			? to.encrypt(from.decrypt(row.ciphertext, row.nonce, key), key)
			: null;
		const note = row.relayNoteCiphertext
			? to.encrypt(from.decrypt(row.relayNoteCiphertext, row.relayNoteNonce, key), key)
			: null;
		await sequelize.query(
			'UPDATE `Messages` SET `ciphertext` = ?, `nonce` = ?, `relayNoteCiphertext` = ?, `relayNoteNonce` = ? WHERE `id` = ?',
			{
				replacements: [
					body ? body.ciphertext : null,
					body ? body.nonce : null,
					note ? note.ciphertext : null,
					note ? note.nonce : null,
					env.message
				]
			}
		);
		const [files] = await sequelize.query(
			'SELECT `id`, `storedName`, `nonce` FROM `Attachments` WHERE `message` = ? AND `nonce` IS NOT NULL',
			{ replacements: [env.message] }
		);
		for (const file of files) {
			let stored;
			try {
				stored = await readFile(storedPath(file.storedName));
			} catch (err) {
				if (err.code === 'ENOENT') {
					continue;
				}
				throw err;
			}
			const plain = from.decrypt(crypto.encode(stored), file.nonce, key);
			const next = to.encrypt(plain, key);
			await writeFile(storedPath(file.storedName), Buffer.from(crypto.decode(next.ciphertext)));
			await sequelize.query('UPDATE `Attachments` SET `nonce` = ? WHERE `id` = ?', {
				replacements: [next.nonce, file.id]
			});
		}
		await sequelize.query('UPDATE `LetterKeys` SET `wrappedKey` = ? WHERE `id` = ?', {
			replacements: [to.wrapForServer(key), env.id]
		});
	}
}

const current = {
	encrypt: crypto.encrypt,
	decrypt: crypto.decrypt,
	wrapForServer: crypto.wrapForServer,
	unwrapForServer: crypto.unwrapForServer
};

export async function up({ context: queryInterface }) {
	await convert(queryInterface, crypto.legacy, current);
}

export async function down({ context: queryInterface }) {
	await convert(queryInterface, current, crypto.legacy);
}
