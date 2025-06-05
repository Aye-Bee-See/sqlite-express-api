import Chat from '#models/chat.model.js';

export default {
	beforeValidate: async (instance) => {
		const record = instance.dataValues;
		const chat = await Chat.findOrCreateChat(record.user, record.prisoner);
		const chatId = chat[0].dataValues.id;
		instance.chat = chatId;
	}

// beforeCreate: async (record, options={}) => {},
// afterCreate: (instance, options={})=> {}
};
