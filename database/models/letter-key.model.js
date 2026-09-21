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
			if (crypto.serverKeyNamed(row.keyLabel) === null) {
				throw new HttpError(
					500,
					'Letter ' +
						row.message +
						' was encrypted with a different ENCRYPTION_KEY (' +
						row.keyLabel +
						'). If the key was changed, put the old one in ENCRYPTION_KEY_PREVIOUS and run npm run encryption:rekey.',
					'EncryptionKeyError'
				);
			}
			keys.set(row.message, crypto.unwrapForServer(row.wrappedKey, row.keyLabel));
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
				keyLabel: null,
				keyVersion: e.readerType === 'chapter' ? e.keyVersion : null
			}))
		);
	}

	/**
	 * Group envelopes of a message whose key version is no longer the group's
	 * current one: a rotation landed between validating and storing them.
	 * @returns {Promise<number[]>} chapter ids
	 */
	static async staleGroupEnvelopes(messageId) {
		const rows = await this.findAll({
			where: { message: messageId, readerType: 'chapter' },
			attributes: ['readerId', 'keyVersion']
		});
		if (rows.length === 0) {
			return [];
		}
		const chapters = await this.sequelize.models.Chapter.findAll({
			where: { id: rows.map((r) => r.readerId) },
			attributes: ['id', 'keyVersion']
		});
		const current = new Map(chapters.map((c) => [c.id, c.keyVersion]));
		return rows.filter((r) => current.get(r.readerId) !== r.keyVersion).map((r) => r.readerId);
	}

	/**
	 * A group envelope names the version of the group key it was sealed to.
	 * The server cannot look inside a sealed box, so this is how a letter
	 * sealed to a key that has since been rotated away gets refused instead
	 * of stored unreadable.
	 * @returns {number} the version, equal to the group's current one
	 * @throws {ValidationError} missing version or keyless group; {HttpError} 409 for a stale version
	 */
	static #checkKeyVersion(envelope, chapterId, versions) {
		const current = versions ? versions.get(chapterId) || 0 : 0;
		if (current === 0) {
			throw new ValidationError(
				'Chapter ' + chapterId + ' has no group key yet, so nothing can be sealed to it.'
			);
		}
		if (!Number.isInteger(envelope.keyVersion)) {
			throw new ValidationError(
				'An envelope for a group needs keyVersion: the version GET /auth/public-key returned with the key it was sealed to.'
			);
		}
		if (envelope.keyVersion !== current) {
			throw new HttpError(
				409,
				'Chapter ' +
					chapterId +
					' rotated its key (now version ' +
					current +
					'); fetch its public key again and re-seal the envelope.',
				'KeyVersionError'
			);
		}
		return current;
	}

	/**
	 * Validate the shape of client-supplied envelopes against the readers a
	 * letter may have.
	 * @param {unknown} envelopes from the request body
	 * @param {{users: Set<number>, chapters: Set<number>, chapterVersions: Map<number, number>}} allowed
	 * @param {{writer: object, relayChapter: number|null}} letter
	 * @returns {{readerType: string, readerId: number, wrappedKey: string, keyVersion?: number}[]}
	 * @throws {ValidationError}; {HttpError} 409 for an envelope sealed to a rotated group key
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
			const envelope = { readerType: e.readerType, readerId, wrappedKey: e.wrappedKey };
			if (e.readerType === 'chapter') {
				envelope.keyVersion = LetterKey.#checkKeyVersion(e, readerId, allowed.chapterVersions);
			}
			return envelope;
		});
		// A writer who has set up keys must be able to read their own thread. One
		// who has not (yet) has nothing to seal to: the letter is stored for the
		// group alone, and a group member's client adds the writer's envelope
		// when they get keys (LetterKey.missingForWriters).
		if (!writer.anonymousForChapter && writer.publicKey && !seen.has('user:' + writer.id)) {
			throw new ValidationError('The writer (user ' + writer.id + ') needs an envelope.');
		}
		if (!writer.publicKey && seen.has('user:' + writer.id)) {
			throw new ValidationError(
				'User ' + writer.id + ' has no public key yet, so nothing can be sealed to them.'
			);
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

	/**
	 * Letters this group can open whose writer now has keys and still no
	 * envelope: replies recorded while the writer had none, mostly. A member's
	 * client opens the group's envelope, seals the content key to the writer,
	 * and posts it to /messaging/envelope.
	 * @param {number} chapterId
	 * @param {number} limit
	 * @returns {Promise<{message: number, chat: number, readerType: 'user', readerId: number, publicKey: string, wrappedKey: string, keyVersion: number}[]>}
	 */
	static async missingForWriters(chapterId, limit = 100) {
		const [rows] = await this.sequelize.query(
			`SELECT m.id AS message, m.chat AS chat, u.id AS readerId, u.publicKey AS publicKey,
				g.wrappedKey AS wrappedKey, g.keyVersion AS keyVersion
			FROM LetterKeys g
			JOIN Messages m ON m.id = g.message
			JOIN User u ON u.id = m.user
			WHERE g.readerType = 'chapter' AND g.readerId = :chapterId
				AND u.publicKey IS NOT NULL AND u.anonymousForChapter IS NULL
				AND NOT EXISTS (
					SELECT 1 FROM LetterKeys w
					WHERE w.message = m.id AND w.readerType = 'user' AND w.readerId = u.id
				)
			ORDER BY m.id ASC
			LIMIT :limit`,
			{ replacements: { chapterId, limit } }
		);
		return rows.map((row) => ({ ...row, readerType: 'user' }));
	}

	/** Does this reader hold an envelope (or a managed writer's) for the message? */
	static async canRead(messageId, reader) {
		// Admins see every envelope but can open none: not a reader for forwarding.
		const map = await this.envelopeMap([messageId], { ...reader, all: false });
		return (map.get(Number(messageId)) || []).length > 0;
	}
}
