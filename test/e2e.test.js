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
	upload,
	getBytes,
	login,
	makeFixtures,
	makeUser,
	User,
	Chapter,
	Prison
} = await import('./helpers.js');
const client = await import('./e2e-client.js');

let f;
let admin;
let alice;
let bob;
let member; // chapter member of f.group
let keys = {}; // name -> { publicKey, privateKey }
let groupKeys; // { publicKey, privateKey }
let partnerGroup;
let partnerMember;
let partnerKeys;

async function setKeys(who, password) {
	const { privateKey, fields } = client.accountKeys(password, 'RECOVERY-' + password);
	const res = await put('/auth/keys', fields, who);
	assert.equal(res.status, 200, JSON.stringify(res.body));
	// First keys for an account with no letters yet: nothing to catch up.
	assert.deepEqual(res.body.data.caughtUp, { letters: 0, sealed: 0, dropped: 0 });
	return { publicKey: fields.publicKey, privateKey };
}

before(async () => {
	await client.ready;
	await startServer();
	f = await makeFixtures();
	admin = { token: f.admin.token };
	alice = { token: f.alice.token };
	bob = { token: f.bob.token };
	member = { token: f.chapter.token, id: f.chapter.id };
	keys.alice = await setKeys(alice, f.alice.password);
	keys.bob = await setKeys(bob, f.bob.password);
	keys.member = await setKeys(member, f.chapter.password);
	await Prison.addRelay(f.group.id, f.prison.id);

	partnerGroup = await Chapter.createChapter({
		name: 'Partner Relay',
		location: {},
		accountStatus: 'active'
	});
	const p = await makeUser({ role: 'chapter', username: 'partner' });
	await User.update({ chapterId: partnerGroup.id }, { where: { id: p.id } });
	partnerMember = { token: p.token, id: p.id };
	keys.partner = await setKeys(partnerMember, p.password);
	await Prison.addRelay(partnerGroup.id, f.prison.id);
});
after(stopServer);

// ---- account keys ----------------------------------------------------------

test('health announces the encryption mode', async () => {
	const res = await get('/health');
	assert.deepEqual(res.body, { status: 'ok', encryptionMode: 'e2e', push: [] });
});

test('kdfParams must name the KDF, on registration, key updates, and password re-wraps', async () => {
	const { fields } = client.accountKeys('kdfpass', 'RECOVERY');
	const bad = await post('/auth/user', {
		username: 'kdfless',
		password: 'kdfpass',
		email: 'k@example.com',
		...fields,
		kdfParams: { opslimit: 2 }
	});
	assert.equal(bad.status, 400);
	assert.match(bad.body.errors[0], /kdfParams must be an object naming the KDF/);
	assert.equal((await put('/auth/keys', { ...fields, recoveryKdfParams: [] }, alice)).status, 400);
	assert.equal((await put('/auth/keys', { ...fields, kdfParams: { kdf: '' } }, alice)).status, 400);
	// A password re-wrap through the user update follows the same rule.
	const rewrap = await put(
		'/auth/user',
		{ id: f.alice.id, password: 'alicepass2', wrappedPrivateKey: 'x', kdfSalt: 'y', kdfParams: {} },
		alice
	);
	assert.equal(rewrap.status, 400);
	assert.match(rewrap.body.errors[0], /kdfParams must be an object naming the KDF/);
});

test('registration and key bundles', async () => {
	const { privateKey, fields } = client.accountKeys('carolpass', 'RECOVERY-carol');
	const reg = await post('/auth/user', {
		username: 'carol',
		password: 'carolpass',
		email: 'carol@example.com',
		...fields
	});
	assert.equal(reg.status, 201);
	assert.equal(reg.body.data.publicKey, fields.publicKey);
	assert.equal(reg.body.data.wrappedPrivateKey, undefined, 'never in a user record');
	const loginRes = await post('/auth/login', { username: 'carol', password: 'carolpass' });
	assert.equal(loginRes.status, 200);
	assert.equal(loginRes.body.data.keys.wrappedPrivateKey, fields.wrappedPrivateKey);
	assert.equal(loginRes.body.data.keys.hasRecovery, true);
	assert.equal(loginRes.body.data.user.wrappedPrivateKey, undefined);
	const carol = { token: loginRes.body.data.token.token };
	const bundle = await get('/auth/keys', carol);
	assert.equal(bundle.body.data.publicKey, fields.publicKey);
	assert.equal(bundle.body.data.orgKey, null);
	const unwrapped = client.unwrapPrivateKey(
		bundle.body.data.wrappedPrivateKey,
		'carolpass',
		bundle.body.data.kdfSalt,
		bundle.body.data.kdfParams
	);
	assert.equal(unwrapped, privateKey);

	// Public keys are readable by any signed-in account; the private key never changes.
	const pk = await get('/auth/public-key?user=' + reg.body.data.id, alice);
	assert.equal(pk.body.data.publicKey, fields.publicKey);
	const other = client.keypair();
	assert.equal((await put('/auth/keys', { publicKey: other.publicKey }, carol)).status, 409);
	assert.equal((await put('/auth/keys', { publicKey: 'nope' }, carol)).status, 400);
	assert.equal(
		(await put('/auth/keys', { wrappedPrivateKey: 'x' }, carol)).status,
		400,
		'salt and params go together'
	);
	assert.equal((await get('/auth/users?page_size=100', admin)).status, 200);
	assert.ok(
		!JSON.stringify((await get('/auth/users?page_size=100', admin)).body).includes(
			'WrappedPrivateKey'
		)
	);
});

test('a group gets a keypair and hands it to members one by one', async () => {
	groupKeys = client.keypair();
	const second = await makeUser({ role: 'chapter', username: 'second' });
	await User.update({ chapterId: f.group.id }, { where: { id: second.id } });
	const secondKeys = await setKeys({ token: second.token }, second.password);

	// A non-member cannot bootstrap; the first member can, wrapping the group key to themselves.
	assert.equal(
		(
			await put(
				'/auth/chapter-keys',
				{ chapter: f.group.id, publicKey: groupKeys.publicKey, wrappedOrgPrivateKey: 'x' },
				alice
			)
		).status,
		403
	);
	const boot = await put(
		'/auth/chapter-keys',
		{
			chapter: f.group.id,
			publicKey: groupKeys.publicKey,
			wrappedOrgPrivateKey: client.seal(
				keys.member.publicKey,
				client.open === undefined ? null : Buffer.from(groupKeys.privateKey, 'base64')
			)
		},
		member
	);
	assert.equal(boot.status, 200, JSON.stringify(boot.body));
	assert.equal(
		(
			await put(
				'/auth/chapter-keys',
				{ chapter: f.group.id, publicKey: groupKeys.publicKey, wrappedOrgPrivateKey: 'x' },
				member
			)
		).status,
		409
	);
	const chapterRow = await get('/chapter/chapter?id=' + f.group.id);
	assert.equal(chapterRow.body.data.publicKey, groupKeys.publicKey);

	const mine = await get('/auth/keys', member);
	assert.equal(mine.body.data.orgKey.chapterPublicKey, groupKeys.publicKey);
	const orgPriv = client.open(
		mine.body.data.orgKey.wrappedOrgPrivateKey,
		keys.member.publicKey,
		keys.member.privateKey
	);
	assert.equal(Buffer.from(orgPriv).toString('base64'), groupKeys.privateKey);

	// The second member has no group key until a holder adds them.
	const before = await get('/auth/keys', { token: second.token });
	assert.equal(before.body.data.orgKey.wrappedOrgPrivateKey, null);
	assert.equal(
		(
			await put(
				'/auth/member-key',
				{ chapter: f.group.id, user: second.id, wrappedOrgPrivateKey: 'x' },
				{ token: second.token }
			)
		).status,
		403
	);
	const added = await put(
		'/auth/member-key',
		{
			chapter: f.group.id,
			user: second.id,
			wrappedOrgPrivateKey: client.seal(secondKeys.publicKey, orgPriv)
		},
		member
	);
	assert.equal(added.status, 200);
	const list = await get('/auth/member-keys?chapter=' + f.group.id, member);
	assert.deepEqual(
		list.body.data.members.map((m) => [m.username, m.holdsGroupKey]),
		[
			['chapter', true],
			['second', true]
		]
	);
	assert.equal(
		(await del('/auth/member-key', { chapter: f.group.id, user: second.id }, member)).status,
		200
	);
	assert.equal(
		(await get('/auth/keys', { token: second.token })).body.data.orgKey.wrappedOrgPrivateKey,
		null
	);
	assert.equal((await get('/auth/member-keys?chapter=' + f.group.id, alice)).status, 403);

	// The partner group bootstraps too, for forwarding later.
	partnerKeys = client.keypair();
	const pboot = await put(
		'/auth/chapter-keys',
		{
			chapter: partnerGroup.id,
			publicKey: partnerKeys.publicKey,
			wrappedOrgPrivateKey: client.seal(
				keys.partner.publicKey,
				Buffer.from(partnerKeys.privateKey, 'base64')
			)
		},
		partnerMember
	);
	assert.equal(pboot.status, 200);
});

// ---- letters -----------------------------------------------------------------

let letter;
let letterKey;

test('a writer sends ciphertext with envelopes; the server validates readers', async () => {
	const readers = [
		{ readerType: 'user', readerId: f.alice.id, publicKey: keys.alice.publicKey },
		{ readerType: 'chapter', readerId: f.group.id, publicKey: groupKeys.publicKey }
	];
	const { contentKey, fields } = client.encryptLetter(
		'Dear friend, hello.',
		readers,
		'Two pages, please'
	);
	letterKey = contentKey;

	const plain = await post(
		'/messaging/message',
		{ messageText: 'x', sender: 'user', prisoner: f.prisoner1.id },
		alice
	);
	assert.equal(plain.status, 400);
	assert.match(plain.body.errors[0], /ciphertext and nonce/);
	const noWriter = await post(
		'/messaging/message',
		{ ...fields, envelopes: fields.envelopes.slice(1), sender: 'user', prisoner: f.prisoner1.id },
		alice
	);
	assert.equal(noWriter.status, 400);
	assert.match(noWriter.body.errors[0], /writer.*needs an envelope/);
	const stranger = await post(
		'/messaging/message',
		{
			...fields,
			envelopes: [...fields.envelopes, { readerType: 'user', readerId: f.bob.id, wrappedKey: 'x' }],
			sender: 'user',
			prisoner: f.prisoner1.id
		},
		alice
	);
	assert.equal(stranger.status, 400);
	assert.match(stranger.body.errors[0], /not a permitted reader/);

	const res = await post(
		'/messaging/message',
		{ ...fields, sender: 'user', prisoner: f.prisoner1.id, relayChapter: f.group.id },
		alice
	);
	assert.equal(res.status, 201, JSON.stringify(res.body));
	letter = res.body.data;
	assert.equal(letter.relayChapter, f.group.id);
	assert.equal(letter.messageText, null);
	assert.equal(letter.ciphertext, fields.ciphertext);
	assert.equal(letter.envelopes.length, 1, 'only the caller envelope comes back');
	assert.equal(letter.envelopes[0].readerType, 'user');
	const opened = client.decryptLetter(
		letter,
		letter.envelopes[0],
		keys.alice.publicKey,
		keys.alice.privateKey
	);
	assert.equal(opened.text, 'Dear friend, hello.');
	assert.equal(opened.note, 'Two pages, please');

	// The database holds no server envelope and no plaintext.
	const { LetterKey, sequelize } = await import('./helpers.js');
	assert.equal(await LetterKey.count({ where: { message: letter.id, readerType: 'server' } }), 0);
	assert.equal(await LetterKey.count({ where: { message: letter.id } }), 2);
	const [rows] = await sequelize.query('SELECT ciphertext FROM Messages WHERE id = ' + letter.id);
	assert.ok(!rows[0].ciphertext.includes('Dear friend'));
});

test('readers get their own envelope on every read path', async () => {
	const one = await get('/messaging/message?id=' + letter.id + '&full=true', alice);
	assert.equal(one.body.data.envelopes.length, 1);
	const list = await get('/messaging/messages?prisoner=' + f.prisoner1.id, alice);
	assert.ok(list.body.data.every((m) => m.envelopes.length === 1 && m.messageText === null));
	const chats = await get('/chat/chats', alice);
	const chat = chats.body.data.find((c) => c.id === letter.chat);
	assert.equal(chat.last_message.ciphertext, letter.ciphertext);
	assert.equal(chat.last_message.envelopes.length, 1);

	// The relay group's member unwraps the group key, then the content key.
	const asMember = await get('/messaging/message?id=' + letter.id, member);
	assert.equal(asMember.status, 200);
	const env = asMember.body.data.envelopes.find((e) => e.readerType === 'chapter');
	assert.ok(env);
	const opened = client.decryptLetter(
		asMember.body.data,
		env,
		groupKeys.publicKey,
		groupKeys.privateKey
	);
	assert.equal(opened.text, 'Dear friend, hello.');

	// The partner group is a permitted reader but has no envelope yet; bob sees nothing.
	assert.equal((await get('/messaging/message?id=' + letter.id, partnerMember)).status, 403);
	assert.equal((await get('/messaging/message?id=' + letter.id, bob)).status, 403);
	assert.equal(
		(await get('/messaging/message?id=' + letter.id, admin)).body.data.envelopes.length,
		2,
		'admins see envelopes they cannot open'
	);
});

test('a reader forwards the letter by sealing the key to a partner group', async () => {
	const forward = {
		message: letter.id,
		readerType: 'chapter',
		readerId: partnerGroup.id,
		keyVersion: 1
	};
	assert.equal(
		(await post('/messaging/envelope', { ...forward, wrappedKey: 'x' }, partnerMember)).status,
		403,
		'not yet a reader'
	);
	assert.equal(
		(await post('/messaging/envelope', { ...forward, wrappedKey: 'x' }, bob)).status,
		403
	);
	const wrong = await post(
		'/messaging/envelope',
		{ message: letter.id, readerType: 'user', readerId: f.bob.id, wrappedKey: 'x' },
		member
	);
	assert.equal(wrong.status, 400);
	const res = await post(
		'/messaging/envelope',
		{ ...forward, wrappedKey: client.seal(partnerKeys.publicKey, letterKey) },
		member
	);
	assert.equal(res.status, 201);
	assert.equal(
		(await post('/messaging/envelope', { ...forward, wrappedKey: 'x' }, member)).status,
		409
	);
	const asPartner = await get('/messaging/message?id=' + letter.id, partnerMember);
	assert.equal(asPartner.status, 200);
	const opened = client.decryptLetter(
		asPartner.body.data,
		asPartner.body.data.envelopes[0],
		partnerKeys.publicKey,
		partnerKeys.privateKey
	);
	assert.equal(opened.text, 'Dear friend, hello.');
});

test('attachments pass through as ciphertext', async () => {
	const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(50, 0x41)]);
	const { bytes, nonce } = client.encryptFile(pdf, letterKey);
	const missing = await upload(
		'/messaging/attachment',
		{ fields: { message: letter.id }, file: { name: 'a.pdf', type: 'application/pdf', bytes } },
		alice
	);
	assert.equal(missing.status, 400);
	assert.match(missing.body.errors[0], /nonce/);
	const res = await upload(
		'/messaging/attachment',
		{
			fields: { message: letter.id, nonce },
			file: { name: 'a.pdf', type: 'application/pdf', bytes }
		},
		alice
	);
	assert.equal(res.status, 201, JSON.stringify(res.body));
	assert.equal(res.body.data.nonce, nonce, 'clients need the nonce back');
	assert.equal(res.body.data.mimeType, 'application/pdf');
	const dl = await getBytes('/messaging/attachment?id=' + res.body.data.id, member);
	assert.equal(dl.status, 200);
	assert.equal(dl.headers.get('content-type'), 'application/octet-stream');
	assert.equal(dl.headers.get('x-encrypted'), 'e2e');
	assert.ok(dl.bytes.equals(bytes));
	assert.ok(client.decryptFile(dl.bytes, nonce, letterKey).equals(pdf));
});

// ---- managed writers: custody, claim, recovery -------------------------------

let writer;
let writerKeys;

test('a group creates a writer with a keypair it holds, and sends for them', async () => {
	writerKeys = client.keypair();
	const noKeys = await post('/auth/writer', { name: 'Held Writer' }, member);
	assert.equal(noKeys.status, 400);
	const res = await post(
		'/auth/writer',
		{
			name: 'Held Writer',
			publicKey: writerKeys.publicKey,
			orgWrappedPrivateKey: client.seal(
				groupKeys.publicKey,
				Buffer.from(writerKeys.privateKey, 'base64')
			),
			orgKeyVersion: 1
		},
		member
	);
	assert.equal(res.status, 201, JSON.stringify(res.body));
	writer = res.body.data;
	assert.equal(writer.publicKey, writerKeys.publicKey);
	assert.equal(writer.orgWrappedPrivateKey, undefined);
	const listed = (await get('/auth/writers', member)).body.data.find((w) => w.id === writer.id);
	assert.ok(listed.orgWrappedPrivateKey, 'the managing group can fetch its sealed copy');
	const recovered = client.open(
		listed.orgWrappedPrivateKey,
		groupKeys.publicKey,
		groupKeys.privateKey
	);
	assert.equal(Buffer.from(recovered).toString('base64'), writerKeys.privateKey);

	const { fields } = client.encryptLetter('Written at the letter night', [
		{ readerType: 'user', readerId: writer.id, publicKey: writerKeys.publicKey },
		{ readerType: 'chapter', readerId: f.group.id, publicKey: groupKeys.publicKey }
	]);
	const sent = await post(
		'/messaging/message',
		{ ...fields, sender: 'user', prisoner: f.prisoner2.id, user: writer.id },
		member
	);
	assert.equal(sent.status, 201, JSON.stringify(sent.body));
	assert.equal(sent.body.data.envelopes.length, 2, 'the group holds the writer key too');
});

test('claiming moves the keypair to the writer; the group loses its copy', async () => {
	const token = client.claimToken();
	const wrapped = client.wrapPrivateKey(writerKeys.privateKey, token, 'claim');
	const bad = await post('/auth/writer/token', { writer: writer.id }, member);
	assert.equal(bad.status, 400);
	const badKdf = await post(
		'/auth/writer/token',
		{
			writer: writer.id,
			tokenHash: client.hashToken(token),
			claimWrappedPrivateKey: wrapped.claimWrappedPrivateKey,
			claimSalt: wrapped.claimSalt,
			claimKdfParams: { opslimit: 2 }
		},
		member
	);
	assert.equal(badKdf.status, 400);
	assert.match(badKdf.body.errors[0], /claimKdfParams must be an object naming the KDF/);
	const issued = await post(
		'/auth/writer/token',
		{
			writer: writer.id,
			tokenHash: client.hashToken(token),
			claimWrappedPrivateKey: wrapped.claimWrappedPrivateKey,
			claimSalt: wrapped.claimSalt,
			claimKdfParams: wrapped.claimKdfParams
		},
		member
	);
	assert.equal(issued.status, 201, JSON.stringify(issued.body));
	assert.equal(issued.body.data.token, undefined, 'the server never learns the token');

	const info = await get('/auth/claim?token=' + token.toLowerCase());
	assert.equal(info.status, 200);
	assert.equal(info.body.data.publicKey, writerKeys.publicKey);
	const priv = client.unwrapPrivateKey(
		info.body.data.claimWrappedPrivateKey,
		token,
		info.body.data.claimSalt,
		info.body.data.claimKdfParams
	);
	assert.equal(priv, writerKeys.privateKey);

	const pw = client.wrapPrivateKey(priv, 'heldpass', '');
	const rc = client.wrapPrivateKey(priv, 'RECOVERY-held', 'recovery');
	const noMaterial = await post('/auth/claim', { token, username: 'held', password: 'heldpass' });
	assert.equal(noMaterial.status, 400);
	const claimed = await post('/auth/claim', {
		token,
		username: 'held',
		password: 'heldpass',
		wrappedPrivateKey: pw.WrappedPrivateKey,
		kdfSalt: pw.Salt,
		kdfParams: pw.KdfParams,
		recoveryWrappedPrivateKey: rc.recoveryWrappedPrivateKey,
		recoverySalt: rc.recoverySalt,
		recoveryKdfParams: rc.recoveryKdfParams
	});
	assert.equal(claimed.status, 201, JSON.stringify(claimed.body));

	const jwt = await login('held', 'heldpass');
	const held = { token: jwt };
	const bundle = await get('/auth/keys', held);
	assert.equal(bundle.body.data.publicKey, writerKeys.publicKey);
	assert.equal(
		client.unwrapPrivateKey(
			bundle.body.data.wrappedPrivateKey,
			'heldpass',
			bundle.body.data.kdfSalt,
			bundle.body.data.kdfParams
		),
		priv
	);
	// Their earlier letter opens with the same keypair.
	const mine = await get('/messaging/messages', held);
	assert.equal(mine.body.data.length, 1);
	const opened = client.decryptLetter(
		mine.body.data[0],
		mine.body.data[0].envelopes[0],
		writerKeys.publicKey,
		priv
	);
	assert.equal(opened.text, 'Written at the letter night');
	// The group no longer lists the writer or holds a sealed copy, but keeps its own envelope on the relayed letter.
	assert.ok(!(await get('/auth/writers', member)).body.data.some((w) => w.id === writer.id));
	const still = await get('/messaging/message?id=' + mine.body.data[0].id, member);
	assert.equal(still.status, 200);
	assert.deepEqual(
		still.body.data.envelopes.map((e) => e.readerType),
		['chapter']
	);
});

test('recovery proves possession of the private key before resetting the password', async () => {
	const start = await get('/auth/recover?username=held');
	assert.equal(start.status, 200);
	assert.equal((await get('/auth/recover?username=nobody')).status, 404);
	const priv = client.unwrapPrivateKey(
		start.body.data.recoveryWrappedPrivateKey,
		'RECOVERY-held',
		start.body.data.recoverySalt,
		start.body.data.recoveryKdfParams
	);
	assert.equal(priv, writerKeys.privateKey);
	const challenge = Buffer.from(
		client.open(start.body.data.sealedChallenge, start.body.data.publicKey, priv)
	).toString('base64');
	const pw = client.wrapPrivateKey(priv, 'newheldpass', '');
	const wrongChallenge = await post('/auth/recover', {
		username: 'held',
		challenge: 'AAAA',
		password: 'newheldpass',
		wrappedPrivateKey: pw.WrappedPrivateKey,
		kdfSalt: pw.Salt,
		kdfParams: pw.KdfParams
	});
	assert.equal(wrongChallenge.status, 401);
	const done = await post('/auth/recover', {
		username: 'held',
		challenge,
		password: 'newheldpass',
		wrappedPrivateKey: pw.WrappedPrivateKey,
		kdfSalt: pw.Salt,
		kdfParams: pw.KdfParams
	});
	assert.equal(done.status, 201, JSON.stringify(done.body));
	assert.equal((await post('/auth/login', { username: 'held', password: 'heldpass' })).status, 401);
	const jwt = await login('held', 'newheldpass');
	const bundle = await get('/auth/keys', { token: jwt });
	assert.equal(
		client.unwrapPrivateKey(
			bundle.body.data.wrappedPrivateKey,
			'newheldpass',
			bundle.body.data.kdfSalt,
			bundle.body.data.kdfParams
		),
		priv
	);
	// A challenge is single use.
	assert.equal(
		(
			await post('/auth/recover', {
				username: 'held',
				challenge,
				password: 'again',
				wrappedPrivateKey: pw.WrappedPrivateKey,
				kdfSalt: pw.Salt,
				kdfParams: pw.KdfParams
			})
		).status,
		401
	);
});

test('editing keeps the content key: the writer re-encrypts under it', async () => {
	const { ciphertext, nonce } = (await import('../services/crypto.js')).encrypt(
		'Dear friend, revised.',
		letterKey
	);
	assert.equal(
		(await put('/messaging/message', { id: letter.id, messageText: 'plain' }, alice)).status,
		400
	);
	const res = await put('/messaging/message', { id: letter.id, ciphertext, nonce }, alice);
	assert.equal(res.status, 200);
	const read = await get('/messaging/message?id=' + letter.id, member);
	const env = read.body.data.envelopes.find((e) => e.readerType === 'chapter');
	assert.equal(
		client.decryptLetter(read.body.data, env, groupKeys.publicKey, groupKeys.privateKey).text,
		'Dear friend, revised.'
	);
});

// ---- review follow-ups (regressions) ------------------------------------------

test('cipher fields travel in pairs and the reader set is fixed after sending', async () => {
	const readers = [
		{ readerType: 'user', readerId: f.alice.id, publicKey: keys.alice.publicKey },
		{ readerType: 'chapter', readerId: f.group.id, publicKey: groupKeys.publicKey }
	];
	const { fields } = client.encryptLetter('Pairs', readers, 'note');
	const halfNote = await post(
		'/messaging/message',
		{
			...fields,
			relayNoteNonce: undefined,
			sender: 'user',
			prisoner: f.prisoner1.id,
			relayChapter: f.group.id
		},
		alice
	);
	assert.equal(halfNote.status, 400);
	assert.match(halfNote.body.errors[0], /relayNoteCiphertext and relayNoteNonce together/);
	const halfBody = await put('/messaging/message', { id: letter.id, ciphertext: 'AAAA' }, alice);
	assert.equal(halfBody.status, 400);
	assert.match(halfBody.body.errors[0], /ciphertext and nonce together/);
	const moved = await put(
		'/messaging/message',
		{ id: letter.id, relayChapter: partnerGroup.id },
		alice
	);
	assert.equal(moved.status, 400);
	assert.match(moved.body.errors[0], /relayChapter cannot change/);
	const same = await put('/messaging/message', { id: letter.id, relayChapter: f.group.id }, alice);
	assert.equal(same.status, 200, 'restating the current value is not a change');
});

test('admins are not cryptographic readers and cannot forward', async () => {
	const res = await post(
		'/messaging/envelope',
		{ message: letter.id, readerType: 'chapter', readerId: f.group.id, wrappedKey: 'x' },
		admin
	);
	assert.equal(res.status, 403);
});

test('keys never travel through the generic chapter and user updates', async () => {
	const other = client.keypair();
	assert.equal(
		(await put('/chapter/chapter', { id: f.group.id, publicKey: other.publicKey }, member)).status,
		403
	);
	assert.equal(
		(await put('/chapter/chapter', { id: f.group.id, publicKey: other.publicKey }, admin)).status,
		403
	);
	assert.equal(
		(
			await post(
				'/chapter/chapter',
				{ name: 'Keyed', location: {}, publicKey: other.publicKey },
				admin
			)
		).status,
		403
	);
	assert.equal(
		(await get('/chapter/chapter?id=' + f.group.id)).body.data.publicKey,
		groupKeys.publicKey
	);

	const stray = await put('/auth/user', { id: f.alice.id, publicKey: other.publicKey }, alice);
	assert.equal(stray.status, 400);
	assert.match(stray.body.errors[0], /PUT \/auth\/keys/);
	assert.equal((await put('/auth/user', { id: f.alice.id, recoverySalt: 'x' }, admin)).status, 400);

	// A password change must re-wrap the private key, and only the holder can do it.
	const bare = await put('/auth/user', { id: f.alice.id, password: 'alicenewpass' }, alice);
	assert.equal(bare.status, 400);
	assert.match(bare.body.errors[0], /re-wrapped under the new password/);
	assert.equal(
		(await put('/auth/user', { id: f.alice.id, password: 'adminreset' }, admin)).status,
		400
	);
	const pw = client.wrapPrivateKey(keys.alice.privateKey, 'alicenewpass', '');
	const ok = await put(
		'/auth/user',
		{
			id: f.alice.id,
			password: 'alicenewpass',
			wrappedPrivateKey: pw.WrappedPrivateKey,
			kdfSalt: pw.Salt,
			kdfParams: pw.KdfParams
		},
		alice
	);
	assert.equal(ok.status, 200, JSON.stringify(ok.body));
	const loginRes = await post('/auth/login', { username: 'alice', password: 'alicenewpass' });
	assert.equal(loginRes.status, 200);
	assert.equal(
		client.unwrapPrivateKey(
			loginRes.body.data.keys.wrappedPrivateKey,
			'alicenewpass',
			loginRes.body.data.keys.kdfSalt,
			loginRes.body.data.keys.kdfParams
		),
		keys.alice.privateKey
	);
	alice = { token: loginRes.body.data.token.token };
});

test('group key bootstrap needs a keyed first member, and the last holder stays', async () => {
	const bare = await makeUser({ role: 'chapter', username: 'bareorg' });
	const bareGroup = await Chapter.createChapter({
		name: 'Bare Group',
		location: {},
		accountStatus: 'active'
	});
	await User.update({ chapterId: bareGroup.id }, { where: { id: bare.id } });
	const kp = client.keypair();
	const res = await put(
		'/auth/chapter-keys',
		{ chapter: bareGroup.id, publicKey: kp.publicKey, wrappedOrgPrivateKey: 'x' },
		{ token: bare.token }
	);
	assert.equal(res.status, 409);
	assert.match(res.body.error, /no public key yet/);
	assert.equal((await Chapter.findByPk(bareGroup.id)).publicKey, null, 'nothing half-set');

	// The group-owner admin (the member set the key) taking their own, last, copy away.
	const last = await del('/auth/member-key', { chapter: f.group.id, user: member.id }, member);
	assert.equal(last.status, 409);
	assert.match(last.body.error, /last holder/);
	assert.ok(
		await (
			await import('../database/models/org-member-key.model.js')
		).default.forMember(f.group.id, member.id)
	);
});

test('a forwarded group sees only the letters it holds envelopes for', async () => {
	// A second letter in the same thread, not forwarded to the partner.
	const { fields } = client.encryptLetter('Second, private', [
		{ readerType: 'user', readerId: f.alice.id, publicKey: keys.alice.publicKey },
		{ readerType: 'chapter', readerId: f.group.id, publicKey: groupKeys.publicKey }
	]);
	const second = await post(
		'/messaging/message',
		{ ...fields, sender: 'user', prisoner: f.prisoner1.id, relayChapter: f.group.id },
		alice
	);
	assert.equal(second.status, 201);
	assert.equal(second.body.data.chat, letter.chat);

	const thread = await get('/chat/chat?id=' + letter.chat + '&full=true', partnerMember);
	assert.equal(thread.status, 200);
	assert.deepEqual(
		thread.body.data.messages.map((m) => m.id),
		[letter.id]
	);
	assert.equal(thread.body.data.messages[0].envelopes.length, 1);
	const list = await get('/messaging/messages?chat=' + letter.chat, partnerMember);
	assert.deepEqual(
		list.body.data.map((m) => m.id),
		[letter.id]
	);

	const inbox = await get('/chat/chats', partnerMember);
	const row = inbox.body.data.find((c) => c.id === letter.chat);
	assert.ok(row, 'the chat is still listed');
	assert.equal(row.last_message.id, second.body.data.id);
	assert.equal(row.last_message.ciphertext, null, 'no ciphertext without an envelope');
	assert.deepEqual(row.last_message.envelopes, []);

	const own = await get('/chat/chat?id=' + letter.chat + '&full=true', alice);
	assert.equal(own.body.data.messages.length, 2);
	assert.ok(own.body.data.messages.every((m) => m.envelopes.length === 1));
});

test('an Idempotency-Key retry that was encrypted afresh is still the same letter', async () => {
	const readers = [
		{ readerType: 'user', readerId: f.alice.id, publicKey: keys.alice.publicKey },
		{ readerType: 'chapter', readerId: f.group.id, publicKey: groupKeys.publicKey }
	];
	const body = { sender: 'user', prisoner: f.prisoner1.id, relayChapter: f.group.id };
	const withKey = { ...alice, headers: { 'Idempotency-Key': 'e2e-retry-0001' } };
	const first = client.encryptLetter('Written on the train', readers);
	const sent = await post('/messaging/message', { ...first.fields, ...body }, withKey);
	assert.equal(sent.status, 201, JSON.stringify(sent.body));

	// The outbox encrypts again before retrying: new content key, new nonce, new ciphertext.
	const second = client.encryptLetter('Written on the train', readers);
	assert.notEqual(second.fields.ciphertext, first.fields.ciphertext);
	const retry = await post('/messaging/message', { ...second.fields, ...body }, withKey);
	assert.equal(retry.status, 201, JSON.stringify(retry.body));
	assert.equal(retry.headers.get('idempotent-replayed'), 'true');
	assert.equal(retry.body.data.id, sent.body.data.id);
	// What comes back is the stored letter, which opens with the FIRST attempt's key.
	assert.equal(retry.body.data.ciphertext, first.fields.ciphertext);
	const opened = client.decryptLetter(
		retry.body.data,
		retry.body.data.envelopes[0],
		keys.alice.publicKey,
		keys.alice.privateKey
	);
	assert.equal(opened.text, 'Written on the train');

	const elsewhere = await post(
		'/messaging/message',
		{ ...second.fields, ...body, prisoner: f.prisoner2.id },
		withKey
	);
	assert.equal(elsewhere.status, 422, 'the same key for a different prisoner is refused');
});

test('in end-to-end mode a split account is made with its keys: the salt and recipe alone are refused', async () => {
	const keys = client.splitKeys('a long enough password', 'RECOVERY-CODE');
	const bare = await post('/auth/user', {
		username: 'saltonly',
		email: 'saltonly@example.com',
		password: keys.authKey,
		authScheme: 'split',
		kdfSalt: keys.fields.kdfSalt,
		kdfParams: keys.fields.kdfParams
	});
	assert.equal(bare.status, 400, JSON.stringify(bare.body));
	assert.match(bare.body.errors[0], /end-to-end mode an account is made with its keys/);
	const whole = await post('/auth/user', {
		username: 'saltonly',
		email: 'saltonly@example.com',
		password: keys.authKey,
		...keys.fields
	});
	assert.equal(whole.status, 201, JSON.stringify(whole.body));
});
