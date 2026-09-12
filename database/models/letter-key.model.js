import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import * as crypto from '#services/crypto.js';
import { HttpError } from '#services/HttpError.js';
import { encryptionMode } from '#constants';
import ValidationError from '#services/ValidationError.js';

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
		if (crypto.isE2E()) {
			for (const row of rows) {
				if (row && row.getDataValue('ciphertext') !== undefined) {
					row.setDataValue('messageText', null);
					row.setDataValue('relayNote', null);
				}
			}
			return rows;
		}
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

	// End-to-end mode

	/**
	 * Store the envelopes a client supplied for a new letter.
	 * @param {number} messageId
	 * @param {{readerType: string, readerId: number, wrappedKey: string}[]} envelopes
	 */
	static async issueEnvelopes(messageId, envelopes) {
		return await this.bulkCreate(
			envelopes.map((e) => ({
				message: messageId,
				readerType: e.readerType,
				readerId: Number(e.readerId),
				wrappedKey: e.wrappedKey,
				keyLabel: null
			}))
		);
	}

	/**
	 * Validate the shape of client-supplied envelopes against the readers a
	 * letter may have.
	 * @param {unknown} envelopes from the request body
	 * @param {{users: Set<number>, chapters: Set<number>}} allowed
	 * @param {{writer: object, relayChapter: number|null}} letter
	 * @returns {{readerType: string, readerId: number, wrappedKey: string}[]}
	 * @throws {ValidationError}
	 */
	static validateEnvelopes(envelopes, allowed, { writer, relayChapter }) {
		if (!Array.isArray(envelopes) || envelopes.length === 0) {
			throw new ValidationError(
				'envelopes must be a non-empty array of { readerType, readerId, wrappedKey }.'
			);
		}
		const seen = new Set();
		const clean = envelopes.map((e) => {
			if (!e || typeof e !== 'object' || !['user', 'chapter'].includes(e.readerType)) {
				throw new ValidationError('Each envelope needs readerType user or chapter.');
			}
			const readerId = Number(e.readerId);
			if (!Number.isInteger(readerId) || readerId <= 0) {
				throw new ValidationError('Each envelope needs a numeric readerId.');
			}
			if (typeof e.wrappedKey !== 'string' || e.wrappedKey === '') {
				throw new ValidationError('Each envelope needs a wrappedKey.');
			}
			const pool = e.readerType === 'user' ? allowed.users : allowed.chapters;
			if (!pool.has(readerId)) {
				throw new ValidationError(
					'Envelope reader ' +
						e.readerType +
						' ' +
						readerId +
						' is not a permitted reader of this letter.'
				);
			}
			const key = e.readerType + ':' + readerId;
			if (seen.has(key)) {
				throw new ValidationError('Duplicate envelope for ' + key + '.');
			}
			seen.add(key);
			return { readerType: e.readerType, readerId, wrappedKey: e.wrappedKey };
		});
		if (!writer.anonymousForChapter && !seen.has('user:' + writer.id)) {
			throw new ValidationError('The writer (user ' + writer.id + ') needs an envelope.');
		}
		if (relayChapter && !seen.has('chapter:' + relayChapter)) {
			throw new ValidationError(
				'The relay group (chapter ' + relayChapter + ') needs an envelope.'
			);
		}
		return clean;
	}

	/**
	 * Envelopes a reader may use, by message id.
	 * @param {number[]} messageIds
	 * @param {{userId: number, chapterId?: number|null, writerIds?: number[], all?: boolean}} reader
	 *   `writerIds`: managed (unclaimed) writers whose keys the chapter holds; `all`: admins see every envelope
	 * @returns {Promise<Map<number, object[]>>}
	 */
	static async envelopeMap(messageIds, reader) {
		const ids = [...new Set(messageIds.map(Number))];
		const map = new Map(ids.map((id) => [id, []]));
		if (ids.length === 0) {
			return map;
		}
		const rows = await this.findAll({
			where: { message: ids, readerType: ['user', 'chapter'] },
			order: [['id', 'ASC']]
		});
		const writers = new Set((reader.writerIds || []).map(Number));
		for (const row of rows) {
			const mine =
				reader.all ||
				(row.readerType === 'user' &&
					(row.readerId === Number(reader.userId) || writers.has(row.readerId))) ||
				(row.readerType === 'chapter' &&
					reader.chapterId &&
					row.readerId === Number(reader.chapterId));
			if (mine) {
				map.get(row.message).push({
					readerType: row.readerType,
					readerId: row.readerId,
					wrappedKey: row.wrappedKey
				});
			}
		}
		return map;
	}

	/** Attach `envelopes` to message rows (e2e mode; a no-op otherwise). */
	static async envelopesFor(rows, reader) {
		if (!crypto.isE2E() || rows.length === 0) {
			return rows;
		}
		const map = await this.envelopeMap(
			rows.map((r) => r.id),
			reader
		);
		for (const row of rows) {
			row.setDataValue('envelopes', map.get(Number(row.id)) || []);
		}
		return rows;
	}

	/** Does this reader hold an envelope (or a managed writer's) for the message? */
	static async canRead(messageId, reader) {
		// Admins see every envelope but can open none: not a reader for forwarding.
		const map = await this.envelopeMap([messageId], { ...reader, all: false });
		return (map.get(Number(messageId)) || []).length > 0;
	}
}
