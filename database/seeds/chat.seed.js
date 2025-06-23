import Chat from '#models/chat.model.js';

const chatSeeds = {
	seeds: [
		// Admin chats
		{ user: 1, prisoner: 1 },
		{ user: 1, prisoner: 5 },
		{ user: 1, prisoner: 10 },

		// Regular user chats - creating realistic relationships
		{ user: 2, prisoner: 1 },
		{ user: 2, prisoner: 7 },
		{ user: 3, prisoner: 2 },
		{ user: 3, prisoner: 8 },
		{ user: 4, prisoner: 3 },
		{ user: 4, prisoner: 9 },
		{ user: 5, prisoner: 4 },
		{ user: 5, prisoner: 10 },
		{ user: 6, prisoner: 5 },
		{ user: 6, prisoner: 11 },
		{ user: 7, prisoner: 6 },
		{ user: 7, prisoner: 12 },
		{ user: 8, prisoner: 7 },
		{ user: 8, prisoner: 13 },
		{ user: 9, prisoner: 8 },
		{ user: 9, prisoner: 14 },
		{ user: 10, prisoner: 9 },
		{ user: 10, prisoner: 15 },

		// Additional cross-connections for more realistic relationships
		{ user: 11, prisoner: 1 }, // Multiple users can chat with same prisoner
		{ user: 12, prisoner: 2 },
		{ user: 13, prisoner: 3 },
		{ user: 14, prisoner: 4 },
		{ user: 15, prisoner: 16 },
		{ user: 16, prisoner: 17 },
		{ user: 17, prisoner: 18 },
		{ user: 18, prisoner: 19 },
		{ user: 19, prisoner: 20 },
		{ user: 20, prisoner: 21 },

		// Some users with multiple prisoner connections
		{ user: 11, prisoner: 22 },
		{ user: 12, prisoner: 23 },
		{ user: 13, prisoner: 24 },
		{ user: 14, prisoner: 25 },
		{ user: 15, prisoner: 26 },
		{ user: 16, prisoner: 27 },
		{ user: 17, prisoner: 28 },
		{ user: 18, prisoner: 29 },
		{ user: 19, prisoner: 30 },
		{ user: 20, prisoner: 31 }
	]
};

export async function createChatSeed() {
	const count = await Chat.count();
	if (count === 0) {
		return await Chat.bulkCreate(chatSeeds.seeds);
	}
}
