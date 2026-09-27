import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripMetadata, UnreadableImageError } from '../services/image.js';

/** A JPEG segment: marker, two-byte length, payload. */
function segment(marker, payload = Buffer.alloc(0)) {
	const head = Buffer.from([0xff, marker, 0, 0]);
	head.writeUInt16BE(payload.length + 2, 2);
	return Buffer.concat([head, payload]);
}

const SOI = Buffer.from([0xff, 0xd8]);
const scan = Buffer.concat([Buffer.from([0xff, 0xda, 0x00, 0x02]), Buffer.from('PICTURE-BYTES')]);
const EOI = Buffer.from([0xff, 0xd9]);

test('a JPEG loses EXIF, XMP and comments, and keeps what it is drawn with', () => {
	const jpeg = Buffer.concat([
		SOI,
		segment(0xe0, Buffer.from('JFIF\0keep-me')),
		segment(0xe1, Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('GPS 51.5074,-0.1278')])),
		segment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>Jane</x:xmpmeta>')),
		segment(0xed, Buffer.from('Photoshop 3.0\0IPTC caption')),
		segment(0xfe, Buffer.from('Taken on my phone')),
		segment(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0'), Buffer.alloc(8, 1)])),
		segment(0xee, Buffer.from('Adobe\0colour')),
		segment(0xdb, Buffer.alloc(16, 3)), // quantisation table
		scan,
		EOI
	]);
	const out = stripMetadata(jpeg, 'image/jpeg');
	const text = out.toString('latin1');
	for (const secret of ['GPS 51.5074', 'xmpmeta', 'IPTC caption', 'Taken on my phone']) {
		assert.ok(!text.includes(secret), 'removed: ' + secret);
	}
	for (const kept of ['JFIF\0keep-me', 'ICC_PROFILE', 'Adobe\0colour', 'PICTURE-BYTES']) {
		assert.ok(text.includes(kept), 'kept: ' + kept);
	}
	assert.ok(out.length < jpeg.length, 'smaller than it was');
	assert.deepEqual([...out.subarray(0, 2)], [0xff, 0xd8], 'still a JPEG');
	assert.deepEqual([...out.subarray(-2)], [0xff, 0xd9], 'still ends where a JPEG ends');
});

test('a JPEG with nothing to remove comes back whole', () => {
	const plain = Buffer.concat([SOI, segment(0xdb, Buffer.alloc(8, 7)), scan, EOI]);
	assert.deepEqual(stripMetadata(plain, 'image/jpeg'), plain);
});

/** A PNG chunk: length, type, data, and a CRC that is not checked here. */
function chunk(type, data = Buffer.alloc(0)) {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length, 0);
	head.write(type, 4, 'ascii');
	return Buffer.concat([head, data, Buffer.alloc(4, 0)]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('a PNG loses text and EXIF chunks and keeps the picture', () => {
	const png = Buffer.concat([
		PNG_SIGNATURE,
		chunk('IHDR', Buffer.alloc(13, 1)),
		chunk('tEXt', Buffer.from('Author\0Jane Doe')),
		chunk('iTXt', Buffer.from('Comment\0\0\0\0Taken at home')),
		chunk('eXIf', Buffer.from('GPS 51.5074,-0.1278')),
		chunk('tIME', Buffer.alloc(7, 2)),
		chunk('gAMA', Buffer.alloc(4, 3)),
		chunk('IDAT', Buffer.from('PICTURE-BYTES')),
		chunk('IEND')
	]);
	const out = stripMetadata(png, 'image/png');
	const text = out.toString('latin1');
	for (const secret of ['Jane Doe', 'Taken at home', 'GPS 51.5074']) {
		assert.ok(!text.includes(secret), 'removed: ' + secret);
	}
	assert.ok(text.includes('PICTURE-BYTES'), 'the picture is there');
	assert.ok(text.includes('gAMA'), 'gamma is kept');
	assert.ok(out.subarray(0, 8).equals(PNG_SIGNATURE), 'still a PNG');
	assert.ok(out.toString('ascii').endsWith('IEND\0\0\0\0'), 'still ends with IEND');
});

/** A RIFF chunk, padded to an even length as the format requires. */
function riff(type, data) {
	const head = Buffer.alloc(8);
	head.write(type, 0, 'ascii');
	head.writeUInt32LE(data.length, 4);
	const pad = data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
	return Buffer.concat([head, data, pad]);
}

test('a WebP loses EXIF and XMP, and its header stops claiming them', () => {
	const flags = Buffer.alloc(10);
	flags[0] = 0b0000_1100; // EXIF and XMP present
	const body = Buffer.concat([
		riff('VP8X', flags),
		riff('VP8 ', Buffer.from('PICTURE-BYTES')),
		riff('EXIF', Buffer.from('GPS 51.5074,-0.1278')),
		riff('XMP ', Buffer.from('<x:xmpmeta>Jane</x:xmpmeta>'))
	]);
	const size = Buffer.alloc(4);
	size.writeUInt32LE(body.length + 4, 0);
	const webp = Buffer.concat([Buffer.from('RIFF'), size, Buffer.from('WEBP'), body]);

	const out = stripMetadata(webp, 'image/webp');
	const text = out.toString('latin1');
	assert.ok(!text.includes('GPS 51.5074'), 'EXIF gone');
	assert.ok(!text.includes('xmpmeta'), 'XMP gone');
	assert.ok(text.includes('PICTURE-BYTES'), 'the picture is there');
	assert.equal(out.toString('ascii', 0, 4), 'RIFF');
	assert.equal(out.toString('ascii', 8, 12), 'WEBP');
	assert.equal(out.readUInt32LE(4), out.length - 8, 'the RIFF size matches what is left');
	assert.equal(out[20] & 0b0000_1100, 0, 'the flags no longer promise EXIF or XMP');
});

test('a file that is not an image of a known kind is left alone', () => {
	const pdf = Buffer.from('%PDF-1.4 not an image');
	assert.deepEqual(stripMetadata(pdf, 'application/pdf'), pdf);
});

test('nothing after the end of a JPEG is kept: not a second picture, not a video', () => {
	// What phones append: a smaller picture with its own EXIF (MPF), or a motion
	// photo's video. Neither is drawn, and both can say where the photo was taken.
	const second = Buffer.concat([
		SOI,
		segment(0xe1, Buffer.from('Exif\0\0GPS 48.8566,2.3522')),
		scan,
		EOI
	]);
	const jpeg = Buffer.concat([
		SOI,
		segment(0xdb, Buffer.alloc(8, 7)),
		scan,
		EOI,
		second,
		Buffer.from('....ftypmp42 MotionPhoto_Data')
	]);
	const out = stripMetadata(jpeg, 'image/jpeg');
	const text = out.toString('latin1');
	assert.ok(!text.includes('GPS 48.8566'), "the second picture's EXIF is gone");
	assert.ok(!text.includes('MotionPhoto'), 'the video is gone');
	assert.deepEqual(out, Buffer.concat([SOI, segment(0xdb, Buffer.alloc(8, 7)), scan, EOI]));
});

test('a progressive JPEG keeps every scan, with its restarts and stuffed bytes', () => {
	// 0xFF 0x00 and 0xFF 0xD0-D7 inside a scan are picture, not the end of it; a
	// progressive JPEG has several scans with tables between them.
	const scanWith = (bytes) =>
		Buffer.concat([Buffer.from([0xff, 0xda, 0x00, 0x02]), Buffer.from(bytes)]);
	const jpeg = Buffer.concat([
		SOI,
		segment(0xc2, Buffer.alloc(6, 1)), // progressive frame header
		scanWith([0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33]),
		segment(0xc4, Buffer.alloc(5, 2)), // a table between scans
		segment(0xfe, Buffer.from('between the scans')),
		scanWith([0x44, 0xff, 0xd7, 0x55]),
		EOI
	]);
	const out = stripMetadata(jpeg, 'image/jpeg');
	assert.ok(!out.toString('latin1').includes('between the scans'), 'a comment between scans goes');
	const expected = Buffer.concat([
		SOI,
		segment(0xc2, Buffer.alloc(6, 1)),
		scanWith([0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33]),
		segment(0xc4, Buffer.alloc(5, 2)),
		scanWith([0x44, 0xff, 0xd7, 0x55]),
		EOI
	]);
	assert.deepEqual(out, expected, 'every picture byte, in order');
});

test('an image that cannot be read to the end is refused, not stored as it is', () => {
	// A segment claiming more bytes than the file has could be hiding anything.
	const overlong = Buffer.concat([
		SOI,
		Buffer.from([0xff, 0xe1, 0x40, 0x00]),
		Buffer.from('Exif GPS')
	]);
	assert.throws(() => stripMetadata(overlong, 'image/jpeg'), UnreadableImageError);
	assert.throws(
		() => stripMetadata(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg'),
		UnreadableImageError
	);

	const bogus = Buffer.alloc(8);
	bogus.write('EXIF', 0, 'ascii');
	bogus.writeUInt32LE(1000, 4);
	const body = Buffer.concat([riff('VP8 ', Buffer.from('PICTURE')), bogus, Buffer.from('GPS 1,2')]);
	const size = Buffer.alloc(4);
	size.writeUInt32LE(body.length + 4, 0);
	const webp = Buffer.concat([Buffer.from('RIFF'), size, Buffer.from('WEBP'), body]);
	assert.throws(() => stripMetadata(webp, 'image/webp'), UnreadableImageError);
	const err = (() => {
		try {
			stripMetadata(webp, 'image/webp');
		} catch (e) {
			return e;
		}
	})();
	assert.equal(err.name, 'ValidationError');
});

test('a WebP ends where its header says it does', () => {
	const body = riff('VP8 ', Buffer.from('PICTURE-BYTES'));
	const size = Buffer.alloc(4);
	size.writeUInt32LE(body.length + 4, 0);
	const webp = Buffer.concat([Buffer.from('RIFF'), size, Buffer.from('WEBP'), body]);
	const out = stripMetadata(
		Buffer.concat([webp, riff('EXIF', Buffer.from('GPS 1,2'))]),
		'image/webp'
	);
	assert.deepEqual(out, webp, 'what was appended after the file is gone');
});
