import { sequelize, ready } from './sql-database.js';
import { runRetention } from './retention.js';

/**
 * `npm run retention [-- --dry-run]`: run the purge by hand. Kept apart from
 * retention.js because sql-database.js imports that module (a script entry
 * there would create an import cycle), and because the database must be
 * fully migrated and seeded (`ready`) before the run.
 */
const args = new Set(process.argv.slice(2));
await ready;
await runRetention({ dryRun: args.has('--dry-run') });
await sequelize.close();
