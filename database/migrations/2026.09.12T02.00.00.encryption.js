import { DataTypes } from 'sequelize';
import { readFile, writeFile } from 'node:fs/promises';
import * as crypto from '#services/crypto.js';
import { storedPath } from '#services/files.js';
import { withForeignKeysOff } from '../migration-helpers.js';

/**
 * Encryption at rest in the end-to-end shape: each letter gets a random
 * content key; the body, relay note, and attachment files are encrypted
 * with it; the key is wrapped per reader in LetterKeys. In `server` mode
 * the one reader is the server (ENCRYPTION_KEY). Existing plaintext rows and
 * files are converted here, so ENCRYPTION_KEY must be set when this runs.
 */

function ref(table, onDelete) {
	return { references: { model: table, key: 'id' }, onDelete, onUpdate: 'CASCADE' };
}

async function encryptFile(storedName, key) {
	const path = storedPath(storedName);
	let plain;
	try {
		plain = await readFile(path);
	} catch (err) {
		if (err.code === 'ENOENT') {
			return null;
		}
		throw err;
	}
	const { ciphertext, nonce } = crypto.encrypt(plain, key);
	await writeFile(path, Buffer.from(crypto.decode(ciphertext)));
	return nonce;
}

async function decryptFile(storedName, nonce, key) {
	const path = storedPath(storedName);
	let stored;
	try {
		stored = await readFile(path);
	} catch (err) {
		if (err.code === 'ENOENT') {
			return;
		}
		throw err;
	}
	await writeFile(path, crypto.decrypt(crypto.encode(stored), nonce, key));
}

export async function up({ context: queryInterface }) {
	await crypto.ready;
	crypto.assertConfigured();
	const { sequelize } = queryInterface;

	await queryInterface.addColumn('Messages', 'ciphertext', { type: DataTypes.TEXT });
	await queryInterface.addColumn('Messages', 'nonce', { type: DataTypes.STRING });
	await queryInterface.addColumn('Messages', 'relayNoteCiphertext', { type: DataTypes.TEXT });
	await queryInterface.addColumn('Messages', 'relayNoteNonce', { type: DataTypes.STRING });
	await queryInterface.addColumn('Attachments', 'nonce', { type: DataTypes.STRING });

	await queryInterface.createTable('LetterKeys', {
		id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
		message: { type: DataTypes.INTEGER, allowNull: false, ...ref('Messages', 'CASCADE') },
		readerType: { type: DataTypes.STRING, allowNull: false },
		readerId: { type: DataTypes.INTEGER },
		wrappedKey: { type: DataTypes.TEXT, allowNull: false },
		keyLabel: { type: DataTypes.STRING },
		createdAt: { type: DataTypes.DATE, allowNull: false },
		updatedAt: { type: DataTypes.DATE, allowNull: false }
	});
	await queryInterface.addIndex('LetterKeys', ['message', 'readerType', 'readerId'], {
		unique: true,
		name: 'letter_keys_reader_unique'
	});

	// Convert every existing letter and its files.
	const [messages] = await sequelize.query(
		'SELECT `id`, `messageText`, `relayNote` FROM `Messages` ORDER BY `id`'
	);
	const [attachments] = await sequelize.query(
		'SELECT `id`, `message`, `storedName` FROM `Attachments` ORDER BY `id`'
	);
	const now = new Date();
	for (const row of messages) {
		const key = crypto.generateContentKey();
		const body = row.messageText === null ? null : crypto.encrypt(String(row.messageText), key);
		const note = row.relayNote ? crypto.encrypt(String(row.relayNote), key) : null;
		await sequelize.query(
			'UPDATE `Messages` SET `ciphertext` = ?, `nonce` = ?, `relayNoteCiphertext` = ?, `relayNoteNonce` = ? WHERE `id` = ?',
			{
				replacements: [
					body ? body.ciphertext : null,
					body ? body.nonce : null,
					note ? note.ciphertext : null,
					note ? note.nonce : null,
					row.id
				]
			}
		);
		await queryInterface.bulkInsert('LetterKeys', [
			{
				message: row.id,
				readerType: 'server',
				readerId: null,
				wrappedKey: crypto.wrapForServer(key),
				keyLabel: crypto.masterKeyLabel(),
				createdAt: now,
				updatedAt: now
			}
		]);
		for (const file of attachments.filter((a) => a.message === row.id)) {
			const nonce = await encryptFile(file.storedName, key);
			if (nonce) {
				await sequelize.query('UPDATE `Attachments` SET `nonce` = ? WHERE `id` = ?', {
					replacements: [nonce, file.id]
				});
			}
		}
	}

	// Removing a column rebuilds the table; keep the rows that reference it.
	await withForeignKeysOff(queryInterface, async () => {
		await queryInterface.removeColumn('Messages', 'messageText');
		await queryInterface.removeColumn('Messages', 'relayNote');
	});
}

export async function down({ context: queryInterface }) {
	await crypto.ready;
	crypto.assertConfigured();
	const { sequelize } = queryInterface;

	await queryInterface.addColumn('Messages', 'messageText', { type: DataTypes.STRING });
	await queryInterface.addColumn('Messages', 'relayNote', { type: DataTypes.TEXT });

	const [keys] = await sequelize.query(
		"SELECT `message`, `wrappedKey` FROM `LetterKeys` WHERE `readerType` = 'server'"
	);
	const [messages] = await sequelize.query(
		'SELECT `id`, `ciphertext`, `nonce`, `relayNoteCiphertext`, `relayNoteNonce` FROM `Messages`'
	);
	const [attachments] = await sequelize.query(
		'SELECT `id`, `message`, `storedName`, `nonce` FROM `Attachments`'
	);
	const keyFor = new Map(keys.map((k) => [k.message, crypto.unwrapForServer(k.wrappedKey)]));
	for (const row of messages) {
		const key = keyFor.get(row.id);
		if (!key) {
			continue;
		}
		const text = row.ciphertext ? crypto.decryptString(row.ciphertext, row.nonce, key) : null;
		const note = row.relayNoteCiphertext
			? crypto.decryptString(row.relayNoteCiphertext, row.relayNoteNonce, key)
			: null;
		await sequelize.query(
			'UPDATE `Messages` SET `messageText` = ?, `relayNote` = ? WHERE `id` = ?',
			{
				replacements: [text, note, row.id]
			}
		);
		for (const file of attachments.filter((a) => a.message === row.id && a.nonce)) {
			await decryptFile(file.storedName, file.nonce, key);
		}
	}

	await queryInterface.removeIndex('LetterKeys', 'letter_keys_reader_unique');
	await queryInterface.dropTable('LetterKeys');
	await withForeignKeysOff(queryInterface, async () => {
		await queryInterface.removeColumn('Attachments', 'nonce');
		for (const column of ['relayNoteNonce', 'relayNoteCiphertext', 'nonce', 'ciphertext']) {
			await queryInterface.removeColumn('Messages', column);
		}
	});
}
