process.env.AUDIT_KEEP_DAYS = '180';
process.env.AUDIT_SECURITY_KEEP_DAYS = '730';

const { test, before, after, beforeEach } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, makeUser, get, sequelize } = await import('./helpers.js');
const { purgeAuditLogs, isSecurityAction, auditWindows } = await import(
	'../database/audit-retention.js'
);
const AuditLog = (await import('../database/models/audit-log.model.js')).default;
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
		// notification is something else and stays out of this.
		for (const match of text.matchAll(
			/action: '([a-z]+\.[a-z.]+)'|audit\([^,]+, '([a-z]+\.[a-z.]+)'/g
		)) {
			actions.add(match[1] ?? match[2]);
		}
	}
	assert.ok(actions.size > 20, 'found the actions in the source: ' + actions.size);
	// Named here so that adding an action means deciding which window it belongs in.
	const known = new Set([
		'chapter.create',
		'chapter.member-key',
		'chapter.member-key.remove',
		'invite-code.cancel',
		'invite-code.issue',
		'invite-code.join',
		'mail-rule.create',
		'mail-rule.delete',
		'mail-rule.update',
		'user.penName',
		'chapter.delete',
		'chapter.keys',
		'chapter.keys.rotate',
		'chapter.owner',
		'chapter.update',
		'invitation.accept',
		'invitation.create',
		'invitation.renew',
		'invitation.revoke',
		'letter.envelope',
		'letter.rerouted',
		'letter.status',
		'letter.status.batch',
		'mail-rule.create',
		'mail-rule.delete',
		'mail-rule.update',
		'prison.create',
		'prison.delete',
		'prison.relay.add',
		'prison.relay.remove',
		'prison.update',
		'prisoner.create',
		'prisoner.delete',
		'prisoner.photo',
		'prisoner.photo.remove',
		'prisoner.support.add',
		'prisoner.support.remove',
		'prisoner.update',
		'retention.run',
		'submission.approve',
		'submission.create',
		'submission.reject',
		'submission.update',
		'submission.withdraw',
		'user.delete',
		'user.keys',
		'user.logout',
		'user.penName',
		'user.recover',
		'user.revoke',
		'user.update',
		'writer.claim',
		'writer.create'
	]);
	const unknown = [...actions].filter((action) => !known.has(action));
	assert.deepEqual(
		unknown,
		[],
		'new audit action(s): decide in database/audit-retention.js whether they are security-relevant, then add them here'
	);
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
