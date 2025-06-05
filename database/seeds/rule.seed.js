
import {readFileSync as read} from 'node:fs';
import {join, dirname, normalize} from 'node:path';
import { fileURLToPath } from 'node:url';
import Rule from '#models/rule.model.js';

const filename = fileURLToPath(import.meta.url);

export async function createRuleSeed() {
    const count =  await Rule.countRules();
    if (count === 0) {
        const seedPath = normalize(join(dirname(filename), "ruleSeed.json"));
        const {seeds} = JSON.parse(read(seedPath, {encoding: 'utf8', flag: 'r'}));
        return await Rule.createBulkRules(seeds);
    }
};
