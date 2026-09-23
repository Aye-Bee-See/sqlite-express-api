process.env.ENCRYPTION_MODE = 'e2e';
process.env.ENCRYPTION_KEY = '';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const {
	startServer,
	stopServer,
	get,
	post,
	put,
	del,
	makeFixtures,
	makeUser,
	User,
	Chapter,
	Prison
} = await import('./helpers.js');
const { default: AuditLog } = await import('#models/audit-log.model.js');
const { default: LetterKey } = await import('#models/letter-key.model.js');
const { default: OrgMemberKey } = await import('#models/org-member-key.model.js');
const client = await import('./e2e-client.js');

let f;
let admin;
let alice;
let first; // the member who set the group up and rotates
let second; // a member who keeps access
let leaver; // a member who is rotated out
const keys = {};
let oldGroup; // { publicKey, privateKey }
let newGroup;
let writer; // managed writer whose keypair the group holds
let writerKeys;
let letter;
let writerLetter;

const bytes = (b64) => Buffer.from(b64, 'base64');

async function setKeys(who, password) {
	const { privateKey, fields } = client.accountKeys(password, 'RECOVERY-' + password);
	const res = await put('/auth/keys', fields, who);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	return { publicKey: fields.publicKey, privateKey };
}

async function addMember(username) {
	const made = await makeUser({ role: 'chapter', username });
	await User.update({ chapterId: f.group.id }, { where: { id: made.id } });
	const who = { token: made.token, id: made.id };
	keys[username] = await setKeys(who, made.password);
	return who;
}

/** Open everything with the old group key and seal it to the new one, as a client would. */
function reseal(material, from, to, memberIds) {
	const open = (sealed) => client.open(sealed, from.publicKey, from.privateKey);
	return {
		chapter: material.chapter,
		keyVersion: material.keyVersion,
		publicKey: to.publicKey,
		envelopes: material.envelopes.map((e) => ({
			id: e.id,
			wrappedKey: client.seal(to.publicKey, open(e.wrappedKey))
		})),
		writers: material.writers.map((w) => ({
			id: w.id,
			orgWrappedPrivateKey: client.seal(to.publicKey, open(w.orgWrappedPrivateKey))
		})),
		members: material.members
			.filter((m) => memberIds.includes(m.id))
			.map((m) => ({
				user: m.id,
				wrappedOrgPrivateKey: client.seal(m.publicKey, bytes(to.privateKey))
			}))
	};
}

function groupLetter(text, group, version, extraReaders = []) {
	return client.encryptLetter(text, [
		...extraReaders,
		{
			readerType: 'chapter',
			readerId: f.group.id,
			publicKey: group.publicKey,
			keyVersion: version
		}
	]);
}

before(async () => {
	await client.ready;
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
	alice = { token: f.alice.token };
	first = { token: f.chapter.token, id: f.chapter.id };
	keys.alice = await setKeys(alice, f.alice.password);
	keys.first = await setKeys(first, f.chapter.password);
	second = await addMember('second');
	leaver = await addMember('leaver');
	await Prison.addRelay(f.group.id, f.prison.id);

	oldGroup = client.keypair();
	const boot = await put(
		'/auth/chapter-keys',
		{
			chapter: f.group.id,
			publicKey: oldGroup.publicKey,
			wrappedOrgPrivateKey: client.seal(keys.first.publicKey, bytes(oldGroup.privateKey))
		},
		first
	);
	assert.equal(boot.status, 200, JSON.stringify(boot.body));
	assert.equal(boot.body.data.keyVersion, 1);
	for (const [who, name] of [
		[second, 'second'],
		[leaver, 'leaver']
	]) {
		const res = await put(
			'/auth/member-key',
			{
				chapter: f.group.id,
				user: who.id,
				wrappedOrgPrivateKey: client.seal(keys[name].publicKey, bytes(oldGroup.privateKey))
			},
			first
		);
		assert.equal(res.status, 200, JSON.stringify(res.body));
	}

	writerKeys = client.keypair();
	const made = await post(
		'/auth/writer',
		{
			name: 'Held Writer',
			publicKey: writerKeys.publicKey,
			orgWrappedPrivateKey: client.seal(oldGroup.publicKey, bytes(writerKeys.privateKey)),
			orgKeyVersion: 1
		},
		first
	);
	assert.equal(made.status, 201, JSON.stringify(made.body));
	writer = made.body.data;

	const fromAlice = groupLetter('From Alice, before the rotation', oldGroup, 1, [
		{ readerType: 'user', readerId: f.alice.id, publicKey: keys.alice.publicKey }
	]);
	const sent = await post(
		'/messaging/message',
		{ ...fromAlice.fields, sender: 'user', prisoner: f.prisoner1.id, relayChapter: f.group.id },
		alice
	);
	assert.equal(sent.status, 201, JSON.stringify(sent.body));
	letter = sent.body.data;

	const fromWriter = groupLetter('From the held writer', oldGroup, 1, [
		{ readerType: 'user', readerId: writer.id, publicKey: writerKeys.publicKey }
	]);
	const sentForWriter = await post(
		'/messaging/message',
		{ ...fromWriter.fields, sender: 'user', user: writer.id, prisoner: f.prisoner2.id },
		first
	);
	assert.equal(sentForWriter.status, 201, JSON.stringify(sentForWriter.body));
	writerLetter = sentForWriter.body.data;
});
after(stopServer);

test('the public key comes with its version, and a group envelope must name it', async () => {
	const pub = await get('/auth/public-key?chapter=' + f.group.id, alice);
	assert.deepEqual(pub.body.data, {
		chapter: f.group.id,
		publicKey: oldGroup.publicKey,
		keyVersion: 1
	});
	const bundle = await get('/auth/keys', first);
	assert.equal(bundle.body.data.orgKey.keyVersion, 1);

	const { fields } = groupLetter('No version', oldGroup, 1, [
		{ readerType: 'user', readerId: f.alice.id, publicKey: keys.alice.publicKey }
	]);
	const unversioned = {
		...fields,
		envelopes: fields.envelopes.map((e) => ({
			readerType: e.readerType,
			readerId: e.readerId,
			wrappedKey: e.wrappedKey
		}))
	};
	const res = await post(
		'/messaging/message',
		{ ...unversioned, sender: 'user', prisoner: f.prisoner1.id, relayChapter: f.group.id },
		alice
	);
	assert.equal(res.status, 400);
	assert.match(res.body.errors[0], /needs keyVersion/);

	const writerNoVersion = await post(
		'/auth/writer',
		{
			name: 'No Version',
			publicKey: client.keypair().publicKey,
			orgWrappedPrivateKey: 'sealed'
		},
		first
	);
	assert.equal(writerNoVersion.status, 400);
	assert.match(writerNoVersion.body.errors[0], /orgKeyVersion is required/);
});

test('a group without keys cannot be sealed to', async () => {
	const keyless = await Chapter.createChapter({
		name: 'Keyless Relay',
		location: {},
		accountStatus: 'active'
	});
	await Prison.addRelay(keyless.id, f.prison.id);
	const res = await post(
		'/messaging/envelope',
		{
			message: letter.id,
			readerType: 'chapter',
			readerId: keyless.id,
			wrappedKey: 'x',
			keyVersion: 1
		},
		first
	);
	assert.equal(res.status, 400);
	assert.match(res.body.errors[0], /no group key yet/);
});

test('only a member holding the group key can fetch rotation material or rotate', async () => {
	const path = '/auth/chapter-rotation?chapter=' + f.group.id;
	assert.equal((await get(path)).status, 401);
	assert.equal((await get(path, alice)).status, 403);
	assert.equal((await get(path, admin)).status, 403, 'an admin cannot open what must be re-sealed');

	const keylessMember = await addMember('newcomer');
	assert.equal((await get(path, keylessMember)).status, 403, 'a member without the group key');
	assert.equal(
		(await post('/auth/chapter-rotation', { chapter: f.group.id }, keylessMember)).status,
		403
	);
	assert.equal((await post('/auth/chapter-rotation', { chapter: f.group.id }, admin)).status, 403);
});

test('rotation material lists every envelope, keyed writer, and member', async () => {
	const res = await get('/auth/chapter-rotation?chapter=' + f.group.id, first);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	const material = res.body.data;
	assert.equal(material.keyVersion, 1);
	assert.equal(material.publicKey, oldGroup.publicKey);
	assert.deepEqual(material.envelopes.map((e) => e.message).sort(), [letter.id, writerLetter.id]);
	assert.deepEqual(
		material.writers.map((w) => w.id),
		[writer.id],
		'the fixture writer has no keys, so there is nothing to re-seal for it'
	);
	const holders = material.members.filter((m) => m.holdsGroupKey).map((m) => m.id);
	assert.deepEqual(holders.sort(), [first.id, second.id, leaver.id].sort());
	assert.ok(material.members.every((m) => m.publicKey));
});

test('a rotation is refused unless it is well formed and complete', async () => {
	const material = (await get('/auth/chapter-rotation?chapter=' + f.group.id, first)).body.data;
	const fresh = client.keypair();
	const good = reseal(material, oldGroup, fresh, [first.id, second.id]);
	const attempt = async (change) => await post('/auth/chapter-rotation', change(good), first);

	const samekey = await attempt((b) => ({ ...b, publicKey: oldGroup.publicKey }));
	assert.equal(samekey.status, 400);
	assert.equal((await attempt((b) => ({ ...b, publicKey: 'nope' }))).status, 400);
	assert.equal((await attempt((b) => ({ ...b, keyVersion: undefined }))).status, 400);
	assert.equal((await attempt((b) => ({ ...b, keyVersion: 7 }))).status, 409);
	assert.equal((await attempt((b) => ({ ...b, members: [] }))).status, 400);
	assert.equal((await attempt((b) => ({ ...b, envelopes: 'all' }))).status, 400);
	assert.equal(
		(await attempt((b) => ({ ...b, envelopes: [...b.envelopes, b.envelopes[0]] }))).status,
		400,
		'duplicates'
	);

	const outsider = await attempt((b) => ({
		...b,
		members: [...b.members, { user: f.alice.id, wrappedOrgPrivateKey: 'x' }]
	}));
	assert.equal(outsider.status, 400);
	assert.match(outsider.body.errors[0], /not a member/);

	const missing = await attempt((b) => ({ ...b, envelopes: b.envelopes.slice(1) }));
	assert.equal(missing.status, 409);
	assert.equal(missing.body.name, 'RotationIncompleteError');
	const foreign = await attempt((b) => ({
		...b,
		envelopes: [...b.envelopes, { id: 99999, wrappedKey: 'x' }]
	}));
	assert.equal(foreign.status, 409);
	const noWriters = await attempt((b) => ({ ...b, writers: [] }));
	assert.equal(noWriters.status, 409);

	// Nothing moved: a refused rotation leaves the group exactly as it was.
	const group = await Chapter.findByPk(f.group.id);
	assert.equal(group.publicKey, oldGroup.publicKey);
	assert.equal(group.keyVersion, 1);
	assert.equal(await OrgMemberKey.count({ where: { chapterId: f.group.id } }), 3);
});

test('a letter arriving after the material was fetched makes the rotation stale', async () => {
	const material = (await get('/auth/chapter-rotation?chapter=' + f.group.id, first)).body.data;
	const late = groupLetter('Sent while the rotation was being prepared', oldGroup, 1, [
		{ readerType: 'user', readerId: f.alice.id, publicKey: keys.alice.publicKey }
	]);
	const sent = await post(
		'/messaging/message',
		{ ...late.fields, sender: 'user', prisoner: f.prisoner1.id, relayChapter: f.group.id },
		alice
	);
	assert.equal(sent.status, 201);
	const res = await post(
		'/auth/chapter-rotation',
		reseal(material, oldGroup, client.keypair(), [first.id]),
		first
	);
	assert.equal(res.status, 409);
	assert.equal(res.body.name, 'RotationIncompleteError');
	assert.match(res.body.error, /fetch the rotation material again/);
	assert.equal((await Chapter.findByPk(f.group.id)).keyVersion, 1, 'rolled back');
});

test('rotating re-seals everything and leaves the removed member out', async () => {
	const material = (await get('/auth/chapter-rotation?chapter=' + f.group.id, first)).body.data;
	newGroup = client.keypair();
	const res = await post(
		'/auth/chapter-rotation',
		reseal(material, oldGroup, newGroup, [first.id, second.id]),
		first
	);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	assert.equal(res.body.data.keyVersion, 2);
	assert.equal(res.body.data.envelopes, 3);
	assert.equal(res.body.data.writers, 1);
	assert.deepEqual(res.body.data.members.sort(), [first.id, second.id].sort());
	assert.deepEqual(res.body.data.removed, [leaver.id]);

	const pub = await get('/auth/public-key?chapter=' + f.group.id, alice);
	assert.equal(pub.body.data.publicKey, newGroup.publicKey);
	assert.equal(pub.body.data.keyVersion, 2);

	const log = await AuditLog.findOne({ where: { action: 'chapter.keys.rotate' } });
	assert.ok(log, 'the rotation is audited');
	// A plain substring check: the key is random base64 and may hold characters a RegExp would choke on.
	assert.equal(JSON.stringify(log).includes(newGroup.publicKey.slice(0, 12)), false);
});

test('the members who stay open old letters with the new group key', async () => {
	const bundle = (await get('/auth/keys', second)).body.data;
	assert.equal(bundle.orgKey.keyVersion, 2);
	assert.equal(bundle.orgKey.chapterPublicKey, newGroup.publicKey);
	const groupPrivate = Buffer.from(
		client.open(bundle.orgKey.wrappedOrgPrivateKey, keys.second.publicKey, keys.second.privateKey)
	).toString('base64');
	assert.equal(groupPrivate, newGroup.privateKey);

	const read = await get('/messaging/message?id=' + letter.id, second);
	assert.equal(read.status, 200);
	const envelope = read.body.data.envelopes.find((e) => e.readerType === 'chapter');
	assert.equal(
		client.decryptLetter(read.body.data, envelope, newGroup.publicKey, groupPrivate).text,
		'From Alice, before the rotation'
	);
	assert.throws(
		() => client.open(envelope.wrappedKey, oldGroup.publicKey, oldGroup.privateKey),
		'the old group key opens nothing that is stored now'
	);

	// The writer's own envelope is untouched.
	const asAlice = await get('/messaging/message?id=' + letter.id, alice);
	assert.equal(
		client.decryptLetter(
			asAlice.body.data,
			asAlice.body.data.envelopes[0],
			keys.alice.publicKey,
			keys.alice.privateKey
		).text,
		'From Alice, before the rotation'
	);
});

test('the member left out no longer receives the group key', async () => {
	const bundle = (await get('/auth/keys', leaver)).body.data;
	assert.equal(bundle.orgKey.wrappedOrgPrivateKey, null);
	const list = (await get('/auth/member-keys?chapter=' + f.group.id, first)).body.data;
	assert.equal(list.keyVersion, 2);
	assert.ok(list.keyRotatedAt);
	assert.equal(list.members.find((m) => m.id === leaver.id).holdsGroupKey, false);
	assert.equal(
		(await get('/auth/chapter-rotation?chapter=' + f.group.id, leaver)).status,
		403,
		'and cannot rotate it back'
	);
	const stored = await LetterKey.findAll({
		where: { readerType: 'chapter', readerId: f.group.id }
	});
	assert.ok(stored.every((row) => row.keyVersion === 2));
});

test("the group still holds its managed writer's key", async () => {
	const listed = (await get('/auth/writers', first)).body.data.find((w) => w.id === writer.id);
	const writerPrivate = Buffer.from(
		client.open(listed.orgWrappedPrivateKey, newGroup.publicKey, newGroup.privateKey)
	).toString('base64');
	assert.equal(writerPrivate, writerKeys.privateKey);
	assert.throws(() =>
		client.open(listed.orgWrappedPrivateKey, oldGroup.publicKey, oldGroup.privateKey)
	);
});

test('anything sealed to the old group key is refused after the rotation', async () => {
	const stale = groupLetter('Sealed to the old key', oldGroup, 1, [
		{ readerType: 'user', readerId: f.alice.id, publicKey: keys.alice.publicKey }
	]);
	const body = { sender: 'user', prisoner: f.prisoner1.id, relayChapter: f.group.id };
	const refused = await post('/messaging/message', { ...stale.fields, ...body }, alice);
	assert.equal(refused.status, 409);
	assert.equal(refused.body.name, 'KeyVersionError');

	const current = groupLetter('Sealed to the new key', newGroup, 2, [
		{ readerType: 'user', readerId: f.alice.id, publicKey: keys.alice.publicKey }
	]);
	assert.equal(
		(await post('/messaging/message', { ...current.fields, ...body }, alice)).status,
		201
	);

	const staleWriter = await post(
		'/auth/writer',
		{
			name: 'Stale Writer',
			publicKey: client.keypair().publicKey,
			orgWrappedPrivateKey: 'sealed-to-the-old-key',
			orgKeyVersion: 1
		},
		first
	);
	assert.equal(staleWriter.status, 409);
	const staleCustody = await put(
		'/auth/user',
		{ id: writer.id, orgWrappedPrivateKey: 'sealed-to-the-old-key', orgKeyVersion: 1 },
		first
	);
	assert.equal(staleCustody.status, 409);
	const custody = await put(
		'/auth/user',
		{
			id: writer.id,
			orgWrappedPrivateKey: client.seal(newGroup.publicKey, bytes(writerKeys.privateKey)),
			orgKeyVersion: 2
		},
		first
	);
	assert.equal(custody.status, 200, JSON.stringify(custody.body));
});

test('a group-sealed writer key cannot straddle a rotation', async () => {
	// Whichever request lands first, no writer may end up sealed to a key the group no longer has.
	const sealedWriters = async (group) => {
		const listed = (await get('/auth/writers', first)).body.data.filter(
			(w) => w.orgWrappedPrivateKey
		);
		for (const w of listed) {
			assert.doesNotThrow(
				() => client.open(w.orgWrappedPrivateKey, group.publicKey, group.privateKey),
				'writer ' + w.id + ' opens with the current group key'
			);
		}
		return listed.length;
	};
	const race = async (other, { bothMayWin = false } = {}) => {
		const material = (await get('/auth/chapter-rotation?chapter=' + f.group.id, first)).body.data;
		const next = client.keypair();
		const [rotation, write] = await Promise.all([
			post(
				'/auth/chapter-rotation',
				reseal(material, newGroup, next, [first.id, second.id]),
				first
			),
			other(material.keyVersion)
		]);
		const statuses = [rotation.status, write.status].join(', ');
		assert.ok(
			[200, 409].includes(rotation.status) && [200, 201, 409].includes(write.status),
			statuses
		);
		assert.ok(rotation.status === 200 || write.status < 300, 'they cannot both lose: ' + statuses);
		if (!bothMayWin) {
			assert.ok(rotation.status === 409 || write.status === 409, 'only one can win: ' + statuses);
		}
		if (rotation.status === 200) {
			newGroup = next;
		}
		await sealedWriters(newGroup);
	};

	const racerKeys = client.keypair();
	await race((version) =>
		post(
			'/auth/writer',
			{
				name: 'Racing Writer',
				publicKey: racerKeys.publicKey,
				orgWrappedPrivateKey: client.seal(newGroup.publicKey, bytes(racerKeys.privateKey)),
				orgKeyVersion: version
			},
			first
		)
	);
	await race(
		(version) =>
			put(
				'/auth/user',
				{
					id: writer.id,
					orgWrappedPrivateKey: client.seal(newGroup.publicKey, bytes(writerKeys.privateKey)),
					orgKeyVersion: version
				},
				first
			),
		// Re-sealing a writer the rotation already covers: if it lands first, the
		// rotation simply re-seals that writer again, and both succeed.
		{ bothMayWin: true }
	);
	assert.ok((await sealedWriters(newGroup)) >= 1);
});

test('two rotations from the same material: one wins', async () => {
	const material = (await get('/auth/chapter-rotation?chapter=' + f.group.id, first)).body.data;
	const a = reseal(material, newGroup, client.keypair(), [first.id, second.id]);
	const b = reseal(material, newGroup, client.keypair(), [second.id]);
	const results = await Promise.all([
		// Only the group-owner admin rotates: the same owner, from two devices, from the same material.
		post('/auth/chapter-rotation', a, first),
		post('/auth/chapter-rotation', b, first)
	]);
	assert.deepEqual(
		results.map((r) => r.status).sort(),
		[200, 409],
		JSON.stringify(results.map((r) => r.body))
	);
	const group = await Chapter.findByPk(f.group.id);
	assert.equal(group.keyVersion, material.keyVersion + 1);
	const winner = results[0].status === 200 ? a : b;
	assert.equal(group.publicKey, winner.publicKey);
	const holders = await OrgMemberKey.findAll({ where: { chapterId: f.group.id } });
	assert.deepEqual(holders.map((h) => h.userId).sort(), winner.members.map((m) => m.user).sort());
});

test('the last holder cannot be removed, and the refusal points at rotation', async () => {
	const holders = await OrgMemberKey.findAll({ where: { chapterId: f.group.id } });
	// The group-owner admin (first) removes every other copy, then tries their own.
	for (const h of holders.filter((h) => h.userId !== first.id)) {
		assert.equal(
			(await del('/auth/member-key', { chapter: f.group.id, user: h.userId }, first)).status,
			200
		);
	}
	const last = await del('/auth/member-key', { chapter: f.group.id, user: first.id }, first);
	assert.equal(last.status, 409);
	assert.match(last.body.error, /chapter-rotation/);
});

test('two removals at once cannot leave the group without a holder', async () => {
	for (const who of [first, second]) {
		const res = await put(
			'/auth/member-key',
			{ chapter: f.group.id, user: who.id, wrappedOrgPrivateKey: 'sealed' },
			first
		);
		assert.equal(res.status, 200, JSON.stringify(res.body));
	}
	await OrgMemberKey.destroy({
		where: { chapterId: f.group.id, userId: leaver.id }
	});
	assert.equal(await OrgMemberKey.count({ where: { chapterId: f.group.id } }), 2);
	const results = await Promise.all(
		[first, second].map((who) =>
			del('/auth/member-key', { chapter: f.group.id, user: who.id }, first)
		)
	);
	assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
	assert.equal(await OrgMemberKey.count({ where: { chapterId: f.group.id } }), 1);
});

test('key state never travels through the generic group update', async () => {
	const res = await put('/chapter/chapter', { id: f.group.id, keyVersion: 9 }, admin);
	assert.equal(res.status, 403);
	assert.equal(
		(await put('/chapter/chapter', { id: f.group.id, keyRotatedAt: null }, first)).status,
		403
	);
});

test('a rotation body may be far larger than other JSON bodies, and only for a caller who may rotate', async () => {
	const padding = 'x'.repeat(300 * 1024);
	// Parsed after authentication: a stranger's large body is refused unread.
	const anonymous = await post('/auth/chapter-rotation', { chapter: 1, padding });
	assert.equal(anonymous.status, 401);
	// Elsewhere the usual limit stands.
	const elsewhere = await put('/auth/keys', { padding }, first);
	assert.equal(elsewhere.status, 413);
	// Here it is read, and then judged like any rotation (this one is missing everything).
	const read = await post('/auth/chapter-rotation', { chapter: f.group.id, padding }, first);
	assert.notEqual(read.status, 413, JSON.stringify(read.body));
	assert.ok(read.status >= 400 && read.status < 500);
	const list = await post('/auth/chapter-rotation', { chapter: [f.group.id], padding }, first);
	assert.equal(list.status, 400);
});

test('the larger limit follows the route however its path is written', async () => {
	// Express matches these too; the app-wide 100 KB parser must not get to them first.
	const padding = 'x'.repeat(300 * 1024);
	for (const path of ['/auth/chapter-rotation/', '/AUTH/Chapter-Rotation']) {
		const res = await post(path, { chapter: f.group.id, padding }, first);
		assert.notEqual(res.status, 413, path);
		assert.ok(res.status >= 400 && res.status < 500, path + ' ' + res.status);
	}
});
