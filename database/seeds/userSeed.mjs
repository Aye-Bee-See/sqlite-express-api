
import {readFileSync as read} from 'node:fs';
import {join, dirname, normalize} from 'node:path';
import { fileURLToPath } from 'node:url';
import {UserHelpers} from '#db/helpers/user.helper.mjs';

const filename = fileURLToPath(import.meta.url);

export async function createUserSeed() {
    const count =  await UserHelpers.countUsers();
    if (count === 0) {
        const seedPath = normalize(join(dirname(filename), "userSeed.json"));
        const {seeds} = JSON.parse(read(seedPath, {encoding: 'utf8', flag: 'r'}));
        return await createBulkUsers(seeds);
    }
};