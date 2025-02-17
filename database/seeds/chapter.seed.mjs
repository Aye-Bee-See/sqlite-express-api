
import {readFileSync as read} from 'node:fs';
import {join, dirname, normalize} from 'node:path';
import { fileURLToPath } from 'node:url';
import Chapter from '#models/chapter.model.mjs';

const filename = fileURLToPath(import.meta.url);

export async function createChapterSeed() {

    const count =  await Chapter.countChapters();
    if (count === 0) {
        const seedPath = normalize(join(dirname(filename), "chapterSeed.json"));
        const {seeds} = JSON.parse(read(seedPath, {encoding: 'utf8', flag: 'r'}));
        return await Chapter.createBulkChapters(seeds);

    } 
};


