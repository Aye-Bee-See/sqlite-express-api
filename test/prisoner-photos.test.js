process.env.PHOTO_MAX_BYTES = '4096';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const {
	startServer,
	stopServer,
	makeFixtures,
	makeUser,
	get,
	put,
	del,
	upload,
	getBytes,
	uploadDir,
	Prisoner,
	Chapter,
	User
} = await import('./helpers.js');
const { readdirSync } = await import('node:fs');

let f;
let owner;
before(async () => {
	await startServer();
	f = await makeFixtures();
	// The group's owner-admin: the one account in a group that may change photos.
	owner = await makeUser({ role: 'chapter', username: 'groupowner' });
	await User.update({ chapterId: f.group.id }, { where: { id: owner.id } });
	await Chapter.update({ ownerId: owner.id }, { where: { id: f.group.id } });
});
after(stopServer);

/** A JPEG whose EXIF says where it was taken. */
function jpegWithExif(marker = 'PICTURE-BYTES') {
	const exif = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('GPS 51.5074,-0.1278')]);
	const head = Buffer.alloc(4);
	head.writeUInt16BE(0xffe1, 0);
	head.writeUInt16BE(exif.length + 2, 2);
	return Buffer.concat([
		Buffer.from([0xff, 0xd8]),
		head,
		exif,
		Buffer.from([0xff, 0xda, 0x00, 0x02]),
		Buffer.from(marker),
		Buffer.from([0xff, 0xd9])
	]);
}

const photo = (bytes = jpegWithExif()) => ({ name: 'face.jpg', type: 'image/jpeg', bytes });
const send = (prisoner, who, extra = {}, file = photo()) =>
	upload('/prisoner/photo', { fields: { prisoner, ...extra }, file, field: 'photo' }, who);
const filesOnDisk = () => readdirSync(uploadDir).length;

test('a superadmin adds a photo; it is public, and what the camera wrote is gone', async () => {
	const res = await send(f.prisoner1.id, f.admin, { credit: 'Family, with permission' });
	assert.equal(res.status, 201, JSON.stringify(res.body));
	const { photo: stored, bytesStored, bytesUploaded } = res.body.data;
	assert.equal(stored.hosted, true);
	assert.equal(stored.credit, 'Family, with permission');
	assert.match(
		stored.url,
		new RegExp('^/prisoner/photo\\?prisoner=' + f.prisoner1.id + '&v=\\d+$')
	);
	assert.ok(bytesStored < bytesUploaded, 'smaller once the metadata is out');

	// The record carries it, for anyone reading the directory, and nothing about
	// where it is kept or who put it there.
	const record = await get('/prisoner/prisoner?id=' + f.prisoner1.id);
	assert.equal(record.body.data.photo.url, stored.url);
	assert.equal(record.body.data.photo.hosted, true);
	for (const hidden of ['photoFile', 'photoAddedBy']) {
		assert.equal(hidden in record.body.data, false, hidden + ' is not sent');
		const list = await get('/prisoner/prisoners?page_size=100', f.admin);
		assert.ok(
			list.body.data.every((row) => !(hidden in row)),
			hidden + ' is not sent to staff either'
		);
	}

	// The picture itself, with no token.
	const file = await getBytes(stored.url);
	assert.equal(file.status, 200);
	assert.equal(file.headers.get('content-type'), 'image/jpeg');
	// Checked every time it is shown, so a photo taken down is gone at once.
	assert.equal(file.headers.get('cache-control'), 'public, no-cache');
	assert.equal(file.headers.get('etag'), '"' + stored.url.split('&v=')[1] + '"');
	const text = file.bytes.toString('latin1');
	assert.ok(text.includes('PICTURE-BYTES'), 'the picture is served');
	assert.ok(!text.includes('GPS 51.5074'), 'where it was taken is not');

	// Asked for again with the tag it was given, it is not sent twice.
	const again = await getBytes(stored.url, {
		headers: { 'If-None-Match': file.headers.get('etag') }
	});
	assert.equal(again.status, 304);
});

test('a group-owner admin may add one; another account in the same group may not', async () => {
	const ok = await send(f.prisoner2.id, owner);
	assert.equal(ok.status, 201, JSON.stringify(ok.body));

	for (const [who, what] of [
		[f.chapter, 'a group admin who is not the owner'],
		[f.alice, 'a writer']
	]) {
		const refused = await send(f.prisoner2.id, who);
		assert.equal(refused.status, 403, what + ': ' + JSON.stringify(refused.body));
	}
	const anonymous = await upload(
		'/prisoner/photo',
		{ fields: { prisoner: f.prisoner2.id }, file: photo(), field: 'photo' },
		{}
	);
	assert.equal(anonymous.status, 401);
});

test('replacing a photo deletes the file it replaces, and removing it takes both away', async () => {
	const fresh = await Prisoner.createPrisoner({
		birthName: 'Photo Subject',
		chosenName: 'Subject',
		prison: f.prison.id,
		inmateID: 'P-8',
		status: 'incarcerated'
	});
	const before = filesOnDisk();
	const first = await send(fresh.id, f.admin, {}, photo(jpegWithExif('FIRST-PICTURE')));
	assert.equal(first.status, 201, JSON.stringify(first.body));
	assert.equal(filesOnDisk(), before + 1);

	const second = await send(fresh.id, f.admin, {}, photo(jpegWithExif('SECOND-PICTURE')));
	assert.equal(second.status, 201);
	assert.notEqual(
		second.body.data.photo.url,
		first.body.data.photo.url,
		'a new photo is a new URL, so no image cache shows the old one'
	);
	assert.equal(filesOnDisk(), before + 1, 'one photo, one file');
	const served = await getBytes('/prisoner/photo?prisoner=' + fresh.id);
	assert.ok(served.bytes.toString('latin1').includes('SECOND-PICTURE'), 'the newer picture');

	const gone = await del('/prisoner/photo', { prisoner: fresh.id }, f.admin);
	assert.equal(gone.status, 200, JSON.stringify(gone.body));
	assert.equal(gone.body.data.photo, null);
	assert.equal(filesOnDisk(), before, 'the file is gone too');
	assert.equal((await get('/prisoner/photo?prisoner=' + fresh.id)).status, 404);
	assert.equal((await Prisoner.findByPk(fresh.id)).getDataValue('photoFile'), null);
});

test('only a picture, and only a small one', async () => {
	const pdf = await send(
		f.prisoner2.id,
		f.admin,
		{},
		{
			name: 'scan.pdf',
			type: 'image/jpeg', // lying about the type does not help: the bytes are read
			bytes: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 0x20)])
		}
	);
	assert.equal(pdf.status, 400, JSON.stringify(pdf.body));
	assert.match(pdf.body.errors[0], /JPEG, PNG, or WebP/);

	const big = await send(f.prisoner2.id, f.admin, {}, photo(jpegWithExif('X'.repeat(5000))));
	assert.equal(big.status, 400, JSON.stringify(big.body));
	assert.match(big.body.errors[0], /4096 bytes/);
	assert.deepEqual(big.body.problems[0], {
		field: 'photo',
		code: 'out_of_range',
		params: { max: 4096 }
	});
	assert.equal(pdf.body.problems[0].field, 'photo');
	assert.equal(pdf.body.problems[0].code, 'not_allowed_value');

	// Who is sending it is settled before the file is read: an account that may
	// not change photos is refused as that, whatever it sent.
	const refused = await send(f.prisoner2.id, f.alice, {}, photo(jpegWithExif('X'.repeat(5000))));
	assert.equal(refused.status, 403, JSON.stringify(refused.body));
});

test('a record only staff may see keeps its photo to staff', async () => {
	const hidden = await Prisoner.createPrisoner({
		birthName: 'Pending Person',
		chosenName: 'Pending',
		prison: f.prison.id,
		inmateID: 'P-9',
		status: 'incarcerated',
		recordStatus: 'pending'
	});
	assert.equal((await send(hidden.id, f.admin)).status, 201);
	assert.equal(
		(await get('/prisoner/photo?prisoner=' + hidden.id)).status,
		404,
		'a visitor is not told it exists'
	);
	const staff = await getBytes('/prisoner/photo?prisoner=' + hidden.id, { token: f.admin.token });
	assert.equal(staff.status, 200);
	assert.equal(
		staff.headers.get('cache-control'),
		'private, no-cache',
		'no shared cache may keep it to hand to someone else'
	);
});

test('there is no way to point a record at a photo on another site', async () => {
	// The column is gone (migration 2026.09.28T00.00.00.drop-photo-url.js): a
	// record either has a photo hosted here or has none.
	const row = await get('/prisoner/prisoner?id=' + f.prisoner2.id);
	assert.equal(row.status, 200);
	assert.equal('photoUrl' in row.body.data, false, 'not in a prisoner row any more');

	// Writing it is ignored rather than stored: it is not a field of the model.
	const update = await put(
		'/prisoner/prisoner',
		{ id: f.prisoner2.id, photoUrl: 'https://example.com/x.jpg' },
		f.admin
	);
	assert.equal(update.status, 200, JSON.stringify(update.body));
	const after = await Prisoner.findByPk(f.prisoner2.id);
	assert.equal(after.get('photoUrl'), undefined);

	// And `photo` still answers for the photo this record does have.
	assert.equal(after.photo.hosted, true);
	assert.ok(after.photo.url.startsWith('/prisoner/photo?prisoner=' + f.prisoner2.id + '&v='));
});

test('deleting a prisoner deletes its photo file', async () => {
	const doomed = await Prisoner.createPrisoner({
		birthName: 'Short Lived',
		chosenName: 'Short',
		prison: f.prison.id,
		inmateID: 'P-10',
		status: 'incarcerated'
	});
	const before = filesOnDisk();
	assert.equal((await send(doomed.id, f.admin)).status, 201);
	assert.equal(filesOnDisk(), before + 1);
	const gone = await del('/prisoner/prisoner', { id: doomed.id }, f.admin);
	assert.equal(gone.status, 200, JSON.stringify(gone.body));
	assert.equal(filesOnDisk(), before, 'no file left behind for a record that is gone');
});

test('a photo that cannot be read to the end is refused', async () => {
	const overlong = Buffer.concat([
		Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00]),
		Buffer.from('Exif GPS 51.5074')
	]);
	const res = await send(f.prisoner2.id, f.admin, {}, photo(overlong));
	assert.equal(res.status, 400, JSON.stringify(res.body));
	assert.deepEqual(res.body.problems[0].field, 'photo');
	assert.equal(res.body.problems[0].code, 'wrong_type');
});
