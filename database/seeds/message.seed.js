import { readFileSync as read } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import Message from '#models/message.model.js';
import { isE2E } from '#services/crypto.js';

const filename = fileURLToPath(import.meta.url);

export async function createMessageSeed() {
	if (isE2E()) {
		// Seed letters are plaintext; in end-to-end mode only browsers can encrypt.
		return [];
	}
	const count = await Message.countMessages();
	if (count === 0) {
		const seedPath = normalize(join(dirname(filename), 'messageSeed.json'));
		const { seeds } = JSON.parse(read(seedPath, { encoding: 'utf8', flag: 'r' }));
		return Message.createBulkMessages(seeds);
	}
}
