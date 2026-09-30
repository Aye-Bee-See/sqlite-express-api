process.env.AUDIT_KEEP_DAYS = '180';
process.env.AUDIT_SECURITY_KEEP_DAYS = '730';

const { test, before, after, beforeEach } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, makeUser, get, sequelize } = await import('./helpers.js');
const { purgeAuditLogs, isSecurityAction, auditWindows } = await import(
	'../database/audit-retention.js'
);
const AuditLog = (await import('../database/models/audit-log.model.js')).default;
const { RESOURCES } = await import('../database/models/submission.model.js');
const { readdir } = await import('node:fs/promises');
const { readFile } = await import('node:fs/promises');

let admin;
before(async () => {
	await startServer();
	admin = await makeUser({ role: 'admin', username: 'auditadmin' });
});
after(stopServer);
beforeEach(async () => {
	await AuditLog.destroy({ where: {}, truncate: true });
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** An entry of `action`, written `days` ago. */
async function entry(action, days) {
	const row = await AuditLog.record({ action, resource: 'user', targetId: 1 });
	const when = new Date(Date.now() - days * DAY_MS);
	await AuditLog.update({ createdAt: when }, { where: { id: row.id }, silent: true });
	return row.id;
}

test('the two windows, and which actions belong to the longer one', () => {
	assert.deepEqual(auditWindows(), { routine: 180, security: 730 });
	for (const action of [
		'user.update',
		'user.revoke',
		'user.penName',
		'writer.claim',
		'invitation.accept',
		'chapter.keys.rotate',
		'chapter.owner',
		'submission.approve',
		'submission.reject',
		'prisoner.delete',
		'chapter.delete'
	]) {
		assert.equal(isSecurityAction(action), true, action + ' is security-relevant');
	}
	for (const action of [
		'prisoner.update',
		'prison.create',
		'letter.status',
		'letter.status.batch',
		'prisoner.photo',
		'submission.create',
		'invite-code.issue',
		'mail-rule.update'
	]) {
		assert.equal(isSecurityAction(action), false, action + ' is routine');
	}
	// Three that were routine until 27 September, each for a reason worth keeping:
	// handing out or withdrawing a group key is access control, and a retention run
	// is the only record that a deletion happened at all.
	for (const action of ['chapter.member-key', 'chapter.member-key.remove', 'retention.run']) {
		assert.equal(isSecurityAction(action), true, action + ' is security-relevant');
	}
});

test('routine entries go after 180 days, security entries stay until 730', async () => {
	const keptRoutine = await entry('letter.status', 179);
	const goneRoutine = await entry('letter.status', 181);
	const keptSecurity = await entry('user.revoke', 700);
	const goneSecurity = await entry('user.revoke', 731);
	// A deletion is security-relevant however routine its resource.
	const keptDelete = await entry('prisoner.delete', 200);

	const preview = await purgeAuditLogs({ dryRun: true });
	assert.deepEqual(preview, { routine: 1, security: 1 }, 'a dry run counts and deletes nothing');
	assert.equal(await AuditLog.count(), 5);

	assert.deepEqual(await purgeAuditLogs(), { routine: 1, security: 1 });
	const left = (await AuditLog.findAll({ attributes: ['id'] })).map((row) => row.id).sort();
	assert.deepEqual(left, [keptRoutine, keptSecurity, keptDelete].sort());
	assert.equal(await AuditLog.findByPk(goneRoutine), null);
	assert.equal(await AuditLog.findByPk(goneSecurity), null);

	// Nothing left to do the second time.
	assert.deepEqual(await purgeAuditLogs(), { routine: 0, security: 0 });
});

test('every audit action the code writes has been sorted into a window on purpose', async () => {
	// Every action the code writes, so a new one is a decision rather than an oversight.
	const sources = [];
	for (const dir of ['routes', 'services', 'database']) {
		const walk = async (path) => {
			for (const item of await readdir(path, { withFileTypes: true })) {
				const full = path + '/' + item.name;
				if (item.isDirectory()) {
					await walk(full);
				} else if (item.name.endsWith('.js')) {
					sources.push(full);
				}
			}
		};
		await walk(dir);
	}
	const actions = new Set();
	for (const file of sources) {
		const text = await readFile(file, 'utf8');
		// A dotted verb, which is what an audit action is; `action: 'rotated'` in a
		// notification is something else and stays out of this. Hyphens and capitals
		// count (`chapter.member-key`, `user.penName`): a pattern without them once hid
		// a key hand-over in the short window. `\s*` because Prettier moves a long
		// call's arguments onto lines of their own.
		for (const match of text.matchAll(
			/action: '([a-zA-Z-]+\.[a-zA-Z.-]+)'|audit\(\s*[^,]+,\s*'([a-zA-Z-]+\.[a-zA-Z.-]+)'/g
		)) {
			actions.add(match[1] ?? match[2]);
		}
	}
	// The one action built at run time: an approved submission is recorded as
	// `<resource>.create` or `<resource>.update` (ModerationController.approve).
	for (const resource of Object.keys(RESOURCES)) {
		actions.add(resource + '.create');
		actions.add(resource + '.update');
	}
	assert.ok(actions.size > 40, 'found the actions in the source: ' + actions.size);

	// Named here with the window each belongs in, so that adding an action means
	// deciding where it goes, and so that moving one is a change someone sees.
	const S = 'security';
	const R = 'routine';
	const decided = {
		'chapter.block': S,
		'chapter.block.remove': S,
		'chapter.create': R,
		'chapter.delete': S,
		'chapter.keys': S,
		'chapter.keys.rotate': S,
		'chapter.member-key': S,
		'chapter.member-key.remove': S,
		'chapter.owner': S,
		'chapter.update': R,
		'invitation.accept': S,
		'invitation.create': S,
		'invitation.renew': S,
		'invitation.revoke': S,
		'invite-code.cancel': R,
		'invite-code.issue': R,
		'invite-code.join': R,
		'letter.decline': S,
		'letter.envelope': R,
		'letter.rerouted': R,
		'letter.status': R,
		'letter.status.batch': R,
		'mail-rule.create': R,
		'mail-rule.delete': S,
		'mail-rule.update': R,
		'prison.create': R,
		'prison.delete': S,
		'prison.relay.add': R,
		'prison.relay.remove': R,
		'prison.update': R,
		'prisoner.create': R,
		'prisoner.delete': S,
		'prisoner.photo': R,
		'prisoner.photo.remove': R,
		'prisoner.support.add': R,
		'prisoner.support.remove': R,
		'prisoner.update': R,
		'retention.run': S,
		'submission.approve': S,
		'submission.create': R,
		'submission.reject': S,
		'submission.update': R,
		'submission.withdraw': R,
		'user.ban': S,
		'user.ban-recommend': S,
		'user.ban-recommend.dismiss': S,
		'user.delete': S,
		'user.keys': S,
		'user.logout': S,
		'user.penName': S,
		'user.recover': S,
		'user.revoke': S,
		'user.update': S,
		'writer.claim': S,
		'writer.create': S
	};
	const unknown = [...actions].filter((action) => !Object.hasOwn(decided, action));
	assert.deepEqual(
		unknown,
		[],
		'new audit action(s): decide in database/audit-retention.js whether they are security-relevant, then add them here'
	);
	// And the other way: a name listed here that the pattern cannot find means the
	// pattern has gone blind to it, or the action is gone and should leave the list.
	const unseen = Object.keys(decided).filter((action) => !actions.has(action));
	assert.deepEqual(unseen, [], 'listed but not found in the source');
	for (const [action, window] of Object.entries(decided)) {
		assert.equal(isSecurityAction(action) ? S : R, window, action);
	}
});

test('0 keeps a kind for ever, and the retention run reports what it removed', async () => {
	await entry('letter.status', 400);
	// The run is the only caller in the server; it says so in its own entry.
	const { runRetention } = await import('../database/retention.js');
	const report = await runRetention({ log: () => {} });
	assert.deepEqual(report.audit, { routine: 1, security: 0 });
	const written = await get('/moderation/audit?action=retention.run', admin);
	assert.equal(written.body.data.length, 1, 'the run recorded itself');
	assert.deepEqual(written.body.data[0].details.auditEntries, { routine: 1, security: 0 });
	// And the entry it just wrote is far too young to be caught by its own sweep.
	assert.ok(await AuditLog.findOne({ where: { action: 'retention.run' } }));
	void sequelize;
});

test('a large purge goes a batch at a time and removes exactly what it should', async () => {
	const old = [];
	for (let i = 0; i < 10; i++) {
		old.push(await entry('letter.status', 400));
	}
	const young = await entry('letter.status', 10);
	const kept = await entry('user.update', 400);
	// Batches of three: four statements for ten entries, the last one short.
	const report = await purgeAuditLogs({ batchSize: 3 });
	assert.deepEqual(report, { routine: 10, security: 0 });
	const left = (await AuditLog.findAll({ attributes: ['id'], raw: true })).map((r) => r.id);
	assert.deepEqual(
		left.sort((a, b) => a - b),
		[young, kept].sort((a, b) => a - b)
	);
	void old;
});

test('reading or purging the log by action uses an index, not the whole table', async () => {
	const [indexes] = await sequelize.query("PRAGMA index_list('AuditLogs')");
	assert.ok(indexes.some((i) => i.name === 'audit_logs_action_created_at'));
	const [plan] = await sequelize.query(
		"EXPLAIN QUERY PLAN SELECT id FROM AuditLogs WHERE action IN ('letter.status') AND createdAt < '2026-01-01'"
	);
	const said = plan.map((row) => row.detail).join(' | ');
	assert.match(said, /USING (COVERING )?INDEX audit_logs_action_created_at/, said);
	assert.doesNotMatch(said, /^SCAN AuditLogs$/);
});
