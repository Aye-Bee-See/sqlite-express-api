import LetterKey from '#models/letter-key.model.js';

export default {
	/**
	 * Sequelize does not run a model's afterFind for rows embedded through an
	 * include, so chats decrypt their embedded messages themselves.
	 */
	afterFind: async (result) => {
		if (!result) {
			return;
		}
		const chats = Array.isArray(result) ? result : [result];
		const messages = chats.flatMap((c) => c.messages || []);
		await LetterKey.decryptRows(messages);
	}
};
