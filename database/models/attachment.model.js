import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import { readFile } from 'node:fs/promises';
import { removeFile, storeFile, storedPath } from '#services/files.js';
import LetterKey from '#models/letter-key.model.js';
import * as crypto from '#services/crypto.js';

/**
 * A file attached to a message. Rows hide `storedName` by default; use the
 * `withStoredName` scope (or Attachment.withFile) when serving the bytes.
 */
export default class Attachment extends Model {
	static init(sequelize) {
		return super.init(Schemas.attachment, {
			sequelize,
			modelName: 'Attachment',
			tableName: 'Attachments',
			// Clients need the nonce only when they decrypt the file themselves.
			defaultScope: {
				attributes: { exclude: crypto.isE2E() ? ['storedName'] : ['storedName', 'nonce'] }
			},
			scopes: { withStoredName: {} }
		});
	}

	static associate(models) {
		this.belongsTo(models.Message, {
			as: 'message_details',
			foreignKey: 'message',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.User, {
			as: 'uploaded_by',
			foreignKey: 'uploadedBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
	}

	/**
	 * Store the bytes and create the row.
	 * @param {{message: number, buffer: Buffer, mimeType: string, originalName?: string, uploadedBy?: number|null}} file
	 * @returns {Promise<Attachment>} the row without storedName
	 */
	static async attach({
		message,
		buffer,
		mimeType,
		originalName,
		uploadedBy = null,
		nonce: given
	}) {
		let bytes = buffer;
		let nonce = given || null;
		if (!crypto.isE2E()) {
			const key = await LetterKey.contentKeyFor(message);
			const encrypted = crypto.encrypt(buffer, key);
			bytes = Buffer.from(crypto.decode(encrypted.ciphertext));
			nonce = encrypted.nonce;
		}
		const storedName = await storeFile(bytes, mimeType);
		try {
			const row = await this.create({
				message,
				storedName,
				originalName: originalName || null,
				mimeType,
				size: buffer.length,
				uploadedBy,
				nonce
			});
			return await this.findByPk(row.id);
		} catch (err) {
			await removeFile(storedName);
			throw err;
		}
	}

	/**
	 * The decrypted bytes of an attachment.
	 * @param {Attachment} row loaded with withFile()
	 * @returns {Promise<Buffer|null>} null when the file is missing from disk
	 */
	static async readBytes(row) {
		let stored;
		try {
			stored = await readFile(storedPath(row.storedName));
		} catch (err) {
			if (err.code === 'ENOENT') {
				return null;
			}
			throw err;
		}
		if (crypto.isE2E()) {
			// Ciphertext in, ciphertext out; the browser holds the content key.
			return stored;
		}
		const key = await LetterKey.contentKeyFor(row.message);
		return crypto.decrypt(crypto.encode(stored), row.nonce, key);
	}

	/** One attachment including its stored file name, or null. */
	static async withFile(id) {
		return await this.scope('withStoredName').findByPk(id);
	}

	/** Attachments of one message, oldest first. */
	static async listForMessage(messageId) {
		return await this.findAll({ where: { message: messageId }, order: [['id', 'ASC']] });
	}

	/** Delete one attachment and its file. */
	static async remove(id) {
		const row = await this.withFile(id);
		if (!row) {
			return 0;
		}
		await row.destroy();
		await removeFile(row.storedName);
		return 1;
	}

	/**
	 * Delete every attachment of the given messages, files included. Called
	 * before the messages themselves go, since the database cascade cannot
	 * unlink files.
	 * @param {number[]} messageIds
	 * @returns {Promise<number>} rows removed
	 */
	/**
	 * The stored file names of these messages' attachments, read before a delete
	 * whose cascade removes the rows; pass them to removeFiles() once it succeeds.
	 * @returns {Promise<string[]>}
	 */
	static async storedNamesFor(messageIds, options = {}) {
		if (messageIds.length === 0) {
			return [];
		}
		const rows = await this.scope('withStoredName').findAll({
			where: { message: messageIds },
			attributes: ['id', 'storedName'],
			...options
		});
		return rows.map((row) => row.storedName);
	}

	static async removeFiles(storedNames) {
		for (const name of storedNames) {
			await removeFile(name);
		}
	}

	static async purgeForMessages(messageIds) {
		if (messageIds.length === 0) {
			return 0;
		}
		const rows = await this.scope('withStoredName').findAll({ where: { message: messageIds } });
		for (const row of rows) {
			await row.destroy();
			await removeFile(row.storedName);
		}
		return rows.length;
	}
}
