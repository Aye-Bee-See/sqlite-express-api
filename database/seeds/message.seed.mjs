
import {readFileSync as read} from 'node:fs';
import {join, dirname, normalize} from 'node:path';
import { fileURLToPath } from 'node:url';
import Message from '#models/message.model.mjs';

const filename = fileURLToPath(import.meta.url);

export async function createMessageSeed() {
    const count =  await Message.countMessages();
    if (count === 0) {
        const seedPath = normalize(join(dirname(filename), "messageSeed.json"));
        const {seeds} = JSON.parse(read(seedPath, {encoding: 'utf8', flag: 'r'}));
        return Message.createBulkMessages(seeds);
    }
};
