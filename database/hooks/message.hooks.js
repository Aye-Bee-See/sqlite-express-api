import Chat from '#models/chat.model.mjs';

export default {
	beforeValidate: async (instance, options) => {
		const record = instance.dataValues;
		const chat = await Chat.findOrCreateChat(record.user, record.prisoner);
		const chatId = chat[0].dataValues.id;
		instance.chat = chatId;
	},

	beforeCreate: async (record, options) => {},
	afterCreate: (instance, options) => {}
};
