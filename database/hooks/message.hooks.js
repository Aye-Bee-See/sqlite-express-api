import Chat from '#models/chat.model.js';

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
		const { user, prisoner } = instance.dataValues;
		if (user === undefined || user === null || prisoner === undefined || prisoner === null) {
			return;
		}
		const [chat] = await Chat.findOrCreateChat(user, prisoner);
		instance.chat = chat.id;
	}
};
