import { Model } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import Hooks from '#hooks/all.hooks.js';
import modelsService from '#models/models.service.js';
import Chat from '#models/chat.model.js';
import MessageStatus from '#models/message-status.model.js';
import Attachment from '#models/attachment.model.js';
import LetterKey from '#models/letter-key.model.js';
import Prisoner from '#models/prisoner.model.js';
import ValidationError from '#services/ValidationError.js';
import { HttpError } from '#services/HttpError.js';
import { canTransition, initialStatusFor, LETTER_STATUSES } from '#db/letter-status.js';

export default class Message extends Model {
	static init(sequelize) {
		return super.init(Schemas.message, {
			sequelize,
			hooks: Hooks.message || null,
			modelName: 'Message'
		});
	}
	static associate(models) {
		this.belongsTo(models.Chat, {
			as: 'chat_details',
			foreignKey: 'chat',
			onDelete: 'RESTRICT',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.User, {
			as: 'user_details',
			foreignKey: 'user',
			onDelete: 'RESTRICT',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.Prisoner, {
			as: 'prisoner_details',
			foreignKey: 'prisoner',
			onDelete: 'RESTRICT',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.Chapter, {
			as: 'relay_group',
			foreignKey: 'relayChapter',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
		this.belongsTo(models.User, {
			as: 'status_changed_by',
			foreignKey: 'statusChangedBy',
			onDelete: 'SET NULL',
			onUpdate: 'CASCADE'
		});
		this.hasMany(models.MessageStatus, {
			as: 'status_history',
			foreignKey: 'message',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
		this.hasMany(models.Attachment, {
			as: 'attachments',
			foreignKey: 'message',
			onDelete: 'CASCADE',
			onUpdate: 'CASCADE'
		});
	}

	// Letter lifecycle

	/**
	 * Decide which group mails a letter. An explicit `requested` group must be
	 * one of the facility's relay groups. Otherwise: the caller's own group if
	 * it relays for that facility, else the facility's only relay group, else
	 * none (refused when the facility is relay_only).
	 * @param {number|string} prisonerId
	 * @param {number|string|null|undefined} requested `relayChapter` from the body
	 * @param {number|null} callerChapter the caller's group, for chapter-role callers
	 * @returns {Promise<number|null>}
	 * @throws {ValidationError}
	 */
	static async resolveRelayChapter(prisonerId, requested, callerChapter = null) {
		const prisoner = await Prisoner.findByPk(prisonerId);
		if (!prisoner) {
			// The foreign key reports the missing prisoner; nothing to route.
			return requested ?? null;
		}
		const { prison, relayIds } = await Prisoner.relayGroupsFor(prisoner);
		if (requested !== undefined && requested !== null && requested !== '') {
			if (!relayIds.includes(Number(requested))) {
				throw new ValidationError(
					'Relay group ' + requested + ' does not relay mail for this facility.'
				);
			}
			return Number(requested);
		}
		if (callerChapter && relayIds.includes(callerChapter)) {
			return callerChapter;
		}
		if (relayIds.length === 1) {
			return relayIds[0];
		}
		if (prison && prison.routing === 'relay_only') {
			throw new ValidationError(
				relayIds.length === 0
					? 'This facility only accepts relayed mail and has no relay group yet.'
					: 'This facility only accepts relayed mail; choose a relay group (relayChapter).'
			);
		}
		return null;
	}

	/**
	 * Create a letter or reply with its relay group resolved and the first
	 * history row written.
	 * @param {object} message fields for createMessage
	 * @param {{callerChapter?: number|null, changedBy?: number|null}} context
	 */
	static async createLetter(message, { callerChapter = null, changedBy = null } = {}) {
		const relayChapter = await this.resolveRelayChapter(
			message.prisoner,
			message.relayChapter,
			callerChapter
		);
		const status = initialStatusFor(message.sender);
		const created = await this.create({
			...message,
			relayChapter,
			status,
			statusChangedAt: new Date(),
			statusChangedBy: changedBy
		});
		await MessageStatus.record(created.id, null, created.status, changedBy);
		return created;
	}

	/**
	 * Move a letter along its lifecycle (queued -> printed -> mailed).
	 * @param {Message} message
	 * @param {string} status the target status
	 * @param {number|null} changedBy
	 * @returns {Promise<Message>} the updated message with its history
	 * @throws {ValidationError} unknown status; {HttpError} 409 for a move the lifecycle does not allow
	 */
	static async changeStatus(message, status, changedBy = null) {
		if (!LETTER_STATUSES.includes(status)) {
			throw new ValidationError('Status must be one of ' + LETTER_STATUSES.join(', ') + '.');
		}
		if (!canTransition(message.status, status)) {
			throw new HttpError(
				409,
				'A ' + message.status + ' letter cannot move to ' + status + '.',
				'LetterStatusError'
			);
		}
		const from = message.status;
		await message.update({ status, statusChangedAt: new Date(), statusChangedBy: changedBy });
		await MessageStatus.record(message.id, from, status, changedBy);
		return await this.readLetter(message.id);
	}

	/** One message with its relay group, status history, and attachments embedded. */
	static async readLetter(id) {
		return await this.findByPk(id, {
			include: [
				{ model: MessageStatus, as: 'status_history' },
				{ model: Attachment, as: 'attachments' },
				{ association: 'relay_group', attributes: ['id', 'name'] }
			],
			order: [
				[{ model: MessageStatus, as: 'status_history' }, 'id', 'ASC'],
				[{ model: Attachment, as: 'attachments' }, 'id', 'ASC']
			]
		});
	}

	//  Create
	/**
	 * @param {{messageText: string, sender: string, user: number, prisoner: number}} message
	 * The chat is resolved by the beforeValidate hook.
	 */
	static async createMessage(message) {
		return await this.create(message);
	}

	/**
	 *  create multiple message
	 *
	 *  @param {array} messageArray  - Array of message params
	 */
	static async createBulkMessages(messageArray) {
		return await this.bulkCreate(messageArray, { validate: true, individualHooks: true });
	}

	/**
	 * Get raw message count
	 * @returns {int}
	 */
	static async countMessages() {
		const { count } = await this.findAndCountAll();

		return count;
	}

	// Read
	static async readAllMessages(limit, offset = 0, extraWhere = {}) {
		let filters = { limit, offset, where: { ...extraWhere } };
		return await Message.findAndCountAll({ ...filters, order: [['id', 'ASC']] });
	}

	/**
	 * Get a single message by primary key.
	 * @param {number|string} id
	 * @returns {Promise<Message|null>}
	 */
	static async getMessageByID(id) {
		return await this.findByPk(id);
	}

	static async readMessageById(id, limit, offset = 0, extraWhere = {}) {
		let filters = { limit, offset };
		let options = {
			where: { id: id, ...extraWhere }
		};
		filters = { ...filters, ...options };
		return await Message.findAndCountAll({ ...filters, order: [['id', 'ASC']] });
	}

	static async readMessagesByChat(id, limit, offset = 0, extraWhere = {}) {
		const exists = await modelsService.modelInstanceExists('Chat', id);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options = {
			where: { chat: id, ...extraWhere }
		};
		filters = { ...filters, ...options };
		return await Message.findAndCountAll({ ...filters, order: [['id', 'ASC']] });
	}

	static async readMessagesByPrisoner(id, limit, offset = 0, extraWhere = {}) {
		const exists = await modelsService.modelInstanceExists('Prisoner', id);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options = {
			where: { prisoner: id, ...extraWhere }
		};
		filters = { ...filters, ...options };
		return await Message.findAndCountAll({ ...filters, order: [['id', 'ASC']] });
	}

	static async readMessagesByUser(id, limit, offset = 0, extraWhere = {}) {
		const exists = await modelsService.modelInstanceExists('User', id);
		if (exists instanceof Error) {
			throw exists;
		}
		let filters = { limit, offset };
		let options = {
			where: { user: id, ...extraWhere }
		};
		filters = { ...filters, ...options };
		return await Message.findAndCountAll({ ...filters, order: [['id', 'ASC']] });
	}

	// Update

	/**
	 * Update a message by id. If the user or prisoner changes, the message is
	 * moved to the chat for the resulting pair (created if needed). The
	 * beforeValidate hook cannot do this for static updates because Sequelize
	 * discards attribute changes made during validation.
	 * @param {object} message fields to change, including `id`
	 * @returns {Promise<[number]>} affected row count
	 */
	static async updateMessage(message) {
		const values = { ...message };
		if (values.messageText !== undefined || values.relayNote !== undefined) {
			// Static updates skip instance hooks, so re-encrypt here with the letter's key.
			const key = await LetterKey.contentKeyFor(message.id);
			const columns = LetterKey.encryptFields(key, {
				messageText: values.messageText,
				relayNote: values.relayNote
			});
			delete values.messageText;
			delete values.relayNote;
			Object.assign(values, columns);
		}
		if (values.user !== undefined || values.prisoner !== undefined) {
			const current = await this.findByPk(message.id);
			if (current) {
				const user = values.user ?? current.user;
				const prisoner = values.prisoner ?? current.prisoner;
				if (user !== null && prisoner !== null) {
					const [chat] = await Chat.findOrCreateChat(user, prisoner);
					values.chat = chat.id;
				}
			}
		}
		return await this.update(values, { where: { id: message.id } });
	}

	// Delete

	static async deleteMessage(id) {
		await Attachment.purgeForMessages([Number(id)]);
		return await this.destroy({
			where: { id: id },
			force: true
		});
	}
}
