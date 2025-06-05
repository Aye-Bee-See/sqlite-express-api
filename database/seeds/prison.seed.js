
import {readFileSync as read} from 'node:fs';
import {join, dirname, normalize} from 'node:path';
import { fileURLToPath } from 'node:url';
import Prison from '#models/prison.model.js';

const filename = fileURLToPath(import.meta.url);

export async function createPrisonSeed() {

    const count =  await Prison.countPrisons();
    if (count === 0) {
        const seedPath = normalize(join(dirname(filename), "prisonSeed.json"));
        const {seeds} = JSON.parse(read(seedPath, {encoding: 'utf8', flag: 'r'}));
        return await Prison.createBulkPrisons(seeds);

    } 
};


