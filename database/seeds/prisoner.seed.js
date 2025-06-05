
import {readFileSync as read} from 'node:fs';
import {join, dirname, normalize} from 'node:path';
import { fileURLToPath } from 'node:url';
import Prisoners from '#models/prisoner.model.js';

const filename = fileURLToPath(import.meta.url);

export async function createPrisonerSeed() {
    const count =  await Prisoners.countPrisoners();
    if (count === 0) {
        const seedPath = normalize(join(dirname(filename), "prisonerSeed.json"));
        const {seeds} = JSON.parse(read(seedPath, {encoding: 'utf8', flag: 'r'}));
        return await Prisoners.createBulkPrisoners(seeds);
    }
};
