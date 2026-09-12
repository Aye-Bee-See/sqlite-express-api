import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import * as crypto from '#services/crypto.js';
import { HttpError } from '#services/HttpError.js';
import { encryptionMode } from '#constants';

const CIPHER_COLUMNS = ['ciphertext', 'nonce', 'relayNoteCiphertext', 'relayNoteNonce'];

/**
 * Content-key envelopes, plus the server-mode helpers that encrypt and
 * decrypt message fields with them. Message hooks and the Attachment model
 * call these; nothing else touches ciphertext directly.
 */
export default class LetterKey extends Model {
	static init(sequelize) {
		return super.init(Schemas.letterKey, {
			sequelize,
			modelName: 'LetterKey',
			tableName: 'LetterKeys',
			indexes: [{ unique: true, fields: ['message', 'readerType', 'readerId'] }]
		});
	}

	static associate(models) {
		this.belongsTo(models.Message, {
			as: 'message_details',
			foreignKey: 'message',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
	}

	/** Store the server envelope for a freshly created letter. */
	static async issueServerKey(messageId, contentKey) {
		return await this.create({
			message: messageId,
			readerType: 'server',
			readerId: null,
			wrappedKey: crypto.wrapForServer(contentKey),
			keyLabel: crypto.masterKeyLabel()
		});
	}

	/**
	 * Server envelopes for many messages.
	 * @returns {Promise<Map<number, Uint8Array>>} message id -> content key
	 */
	static async contentKeysFor(messageIds) {
		const ids = [...new Set(messageIds.map(Number))];
		if (ids.length === 0) {
			return new Map();
		}
		const rows = await this.findAll({ where: { message: ids, readerType: 'server' } });
		const keys = new Map();
		for (const row of rows) {
			if (row.keyLabel && row.keyLabel !== crypto.masterKeyLabel()) {
				throw new HttpError(
					500,
					'Letter ' +
						row.message +
						' was encrypted with a different ENCRYPTION_KEY (' +
						row.keyLabel +
						').',
					'EncryptionKeyError'
				);
			}
			keys.set(row.message, crypto.unwrapForServer(row.wrappedKey));
		}
		return keys;
	}

	/** The content key of one message. */
	static async contentKeyFor(messageId) {
		const key = (await this.contentKeysFor([messageId])).get(Number(messageId));
		if (!key) {
			throw new HttpError(
				500,
				'Letter ' + messageId + ' has no server envelope.',
				'EncryptionKeyError'
			);
		}
		return key;
	}

	/**
	 * Encrypt the plain fields of a message into their ciphertext columns.
	 * @param {Uint8Array} key
	 * @param {{messageText?: string|null, relayNote?: string|null}} fields
	 * @returns {object} ciphertext/nonce columns to write (null pairs for empty values)
	 */
	static encryptFields(key, fields) {
		const out = {};
		if (fields.messageText !== undefined) {
			const pair =
				fields.messageText === null ? null : crypto.encrypt(String(fields.messageText), key);
			out.ciphertext = pair ? pair.ciphertext : null;
			out.nonce = pair ? pair.nonce : null;
		}
		if (fields.relayNote !== undefined) {
			const pair =
				fields.relayNote === null || fields.relayNote === ''
					? null
					: crypto.encrypt(String(fields.relayNote), key);
			out.relayNoteCiphertext = pair ? pair.ciphertext : null;
			out.relayNoteNonce = pair ? pair.nonce : null;
		}
		return out;
	}

	/**
	 * In server mode clients never see ciphertext, embedded rows included
	 * (nested rows are serialised without the model's toJSON), so drop the
	 * columns from a row that is about to be sent.
	 */
	static stripCipher(row) {
		if (encryptionMode === 'server' && row && row.dataValues) {
			for (const column of CIPHER_COLUMNS) {
				delete row.dataValues[column];
			}
		}
		return row;
	}

	/**
	 * Decrypt message rows in place (sets the virtual messageText and
	 * relayNote, and in server mode drops the ciphertext columns from the
	 * row). Rows without ciphertext are left with null text.
	 * @param {import('sequelize').Model[]} rows
	 */
	static async decryptRows(rows) {
		const withText = rows.filter((r) => r && r.getDataValue('ciphertext') !== undefined);
		if (withText.length === 0) {
			return rows;
		}
		const keys = await this.contentKeysFor(withText.map((r) => r.id));
		for (const row of withText) {
			const key = keys.get(row.id);
			const ciphertext = row.getDataValue('ciphertext');
			const nonce = row.getDataValue('nonce');
			row.setDataValue(
				'messageText',
				key && ciphertext ? crypto.decryptString(ciphertext, nonce, key) : null
			);
			const noteCipher = row.getDataValue('relayNoteCiphertext');
			row.setDataValue(
				'relayNote',
				key && noteCipher
					? crypto.decryptString(noteCipher, row.getDataValue('relayNoteNonce'), key)
					: null
			);
			LetterKey.stripCipher(row);
		}
		return rows;
	}
}
