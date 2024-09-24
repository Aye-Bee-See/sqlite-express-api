
import {readFileSync as read} from 'node:fs';
import {join, dirname, normalize} from 'node:path';
import { fileURLToPath } from 'node:url';
import Chat from '#models/chat.model.mjs';

const filename = fileURLToPath(import.meta.url);

export async function createChatSeed() {
    const count =  await Chat.countChats();
    if (count === 0) {
        const seedPath = normalize(join(dirname(filename), "chatSeed.json"));
        const {seeds} = JSON.parse(read(seedPath, {encoding: 'utf8', flag: 'r'}));
        return await Chat.createBulkChats(seeds);
    }
};