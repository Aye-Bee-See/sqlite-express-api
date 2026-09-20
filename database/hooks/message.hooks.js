import Chat from '#models/chat.model.js';
import { initialStatusFor } from '#db/letter-status.js';
import LetterKey from '#models/letter-key.model.js';
import * as crypto from '#services/crypto.js';
import ValidationError from '#services/ValidationError.js';

/** Content keys of instances being created, until afterCreate stores the envelope. */
const pendingKeys = new WeakMap();

export default {
	/**
	 * Resolve the chat a message belongs to from its user + prisoner pair,
	 * creating the chat on first contact.
	 *
	 * Skipped when either id is missing so that the schema's notNull
	 * validators report the problem instead of a raw SQL error.
	 *
	 * Only effective on create: Sequelize's static update discards attribute
	 * changes made during validation, so Message.updateMessage resolves the
	 * chat itself when the user or prisoner changes.
	 */
	beforeValidate: async (instance) => {
		if (instance.isNewRecord) {
			// Replies are always received; letters start queued unless a valid
			// outgoing status was given explicitly (seeds, admin backfills).
			const given = instance.dataValues.status;
			if (instance.sender === 'prisoner' || !given || given === 'received') {
				instance.status = initialStatusFor(instance.sender);
			}
		}
		const { user, prisoner } = instance.dataValues;
		if (user === undefined || user === null || prisoner === undefined || prisoner === null) {
			return;
		}
		const [chat] = await Chat.findOrCreateChat(user, prisoner);
		instance.chat = chat.id;
	},

	/**
	 * Encrypt the body and relay note with a fresh content key. The key is
	 * kept until afterCreate has the row id to attach the server envelope to.
	 */
	beforeCreate: (instance) => {
		if (crypto.isE2E()) {
			// The browser encrypted the body; the server stores what it was given.
			if (!instance.getDataValue('ciphertext') || !instance.getDataValue('nonce')) {
				throw new ValidationError('End-to-end mode: send ciphertext and nonce, not messageText.');
			}
			return;
		}
		const key = crypto.generateContentKey();
		pendingKeys.set(instance, key);
		const columns = LetterKey.encryptFields(key, {
			messageText: instance.getDataValue('messageText') ?? null,
			relayNote: instance.getDataValue('relayNote') ?? null
		});
		for (const [column, value] of Object.entries(columns)) {
			instance.setDataValue(column, value);
		}
	},

	afterCreate: async (instance) => {
		const key = pendingKeys.get(instance);
		pendingKeys.delete(instance);
		if (key) {
			try {
				await LetterKey.issueServerKey(instance.id, key);
			} catch (err) {
				// The row is in; without its key nobody could ever read it. Take it back,
				// so the failed create leaves nothing (and a retry makes the only copy).
				await instance.destroy({ force: true, hooks: false }).catch(() => {});
				throw err;
			}
		}
		if (crypto.isE2E()) {
			instance.setDataValue('messageText', null);
			instance.setDataValue('relayNote', null);
		}
		LetterKey.stripCipher(instance);
	},

	/** Decrypt rows read directly through Message (includes are handled by the chat hook). */
	afterFind: async (result) => {
		if (!result) {
			return;
		}
		await LetterKey.decryptRows(Array.isArray(result) ? result : [result]);
	}
};
