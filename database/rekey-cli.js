import { sequelize } from './connection.js';
import { rekeyServerEnvelopes } from './rekey.js';

/**
 * `npm run encryption:rekey [-- --dry-run]`: see rekey.js. Opens the database
 * alone (no migrations, no server), so it runs beside the API. Exits 1 when
 * letters remain that no configured key opens.
 */
try {
	const report = await rekeyServerEnvelopes({ dryRun: process.argv.includes('--dry-run') });
	if (report.unreadable.length > 0) {
		process.exitCode = 1;
	}
} catch (err) {
	console.error('rekey: ' + err.message);
	process.exitCode = 1;
} finally {
	await sequelize.close();
}
