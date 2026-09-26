/**
 * Stripping the private parts out of an image before it is stored.
 *
 * A photograph off a phone carries where it was taken, when, on which camera
 * (by serial number), and sometimes the name of whoever owns the phone. A
 * directory photo is served to anyone, so none of that may survive the upload.
 * The pixels are left exactly as they are: nothing here re-encodes an image,
 * so nothing here can make one look worse, and no image library is needed.
 *
 * What is kept is what an image needs to be drawn correctly: JFIF density,
 * colour profiles, transparency, gamma. What goes is everything descriptive:
 * EXIF, XMP, IPTC/Photoshop blocks, comments, text chunks, timestamps.
 *
 * Orientation is the one uncomfortable case: it lives in EXIF, so a photo
 * taken sideways loses the tag that says so and is shown as stored. Clients
 * are asked to rotate before uploading (README, "Photos"), which is what a
 * cropping step does anyway.
 */

/** JPEG markers that carry description rather than picture. */
const JPEG_DROP = new Set([
	0xe1, // APP1: EXIF, XMP
	0xe2, // APP2: ICC is kept below; everything else here is FlashPix and friends
	0xe3,
	0xe4,
	0xe5,
	0xe6,
	0xe7,
	0xe8,
	0xe9,
	0xea,
	0xeb,
	0xec, // APP12: Ducky/Picture Info
	0xed, // APP13: Photoshop/IPTC
	0xee, // APP14: Adobe (colour transform) — see the exception below
	0xef,
	0xfe // COM: comment
]);

/** PNG chunks worth keeping: the picture, and what it needs to be drawn right. */
const PNG_KEEP = new Set([
	'IHDR',
	'PLTE',
	'IDAT',
	'IEND',
	'tRNS',
	'gAMA',
	'cHRM',
	'sRGB',
	'iCCP',
	'sBIT',
	'bKGD',
	'pHYs',
	'sPLT',
	'hIST',
	'acTL', // animation: an APNG stays animated
	'fcTL',
	'fdAT'
]);

/**
 * Remove the descriptive segments of a JPEG.
 * @param {Buffer} buffer
 * @returns {Buffer}
 */
function stripJpeg(buffer) {
	const parts = [buffer.subarray(0, 2)]; // SOI
	let at = 2;
	while (at + 4 <= buffer.length) {
		if (buffer[at] !== 0xff) {
			break; // not where a marker should be: keep the rest as it is
		}
		const marker = buffer[at + 1];
		if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
			parts.push(buffer.subarray(at, at + 2));
			at += 2;
			continue;
		}
		if (marker === 0xda) {
			// Start of scan: the compressed picture runs to the end.
			parts.push(buffer.subarray(at));
			at = buffer.length;
			break;
		}
		const length = buffer.readUInt16BE(at + 2);
		if (length < 2 || at + 2 + length > buffer.length) {
			break; // malformed: leave the remainder alone rather than cut a file in half
		}
		const segment = buffer.subarray(at, at + 2 + length);
		// APP2 holding an ICC profile is colour, not description, and is kept;
		// APP14 'Adobe' says how the colours are encoded and must stay, or a
		// CMYK-ish JPEG is drawn with inverted colours.
		const isIcc = marker === 0xe2 && segment.includes('ICC_PROFILE', 4, 'ascii');
		const isAdobe = marker === 0xee && segment.includes('Adobe', 4, 'ascii');
		if (!JPEG_DROP.has(marker) || isIcc || isAdobe) {
			parts.push(segment);
		}
		at += 2 + length;
	}
	if (at < buffer.length) {
		parts.push(buffer.subarray(at));
	}
	return Buffer.concat(parts);
}

/**
 * Remove the descriptive chunks of a PNG.
 * @param {Buffer} buffer
 * @returns {Buffer}
 */
function stripPng(buffer) {
	const parts = [buffer.subarray(0, 8)]; // signature
	let at = 8;
	while (at + 12 <= buffer.length) {
		const length = buffer.readUInt32BE(at);
		const end = at + 12 + length;
		if (length > buffer.length || end > buffer.length) {
			break; // malformed: keep what is left rather than truncate
		}
		const type = buffer.toString('ascii', at + 4, at + 8);
		if (PNG_KEEP.has(type)) {
			parts.push(buffer.subarray(at, end));
		}
		at = end;
		if (type === 'IEND') {
			break;
		}
	}
	return Buffer.concat(parts);
}

/**
 * Remove the EXIF and XMP chunks of a WebP, and say in the header that they
 * are gone.
 * @param {Buffer} buffer
 * @returns {Buffer}
 */
function stripWebp(buffer) {
	if (buffer.length < 12) {
		return buffer;
	}
	const parts = [];
	let at = 12; // 'RIFF' + size + 'WEBP'
	while (at + 8 <= buffer.length) {
		const type = buffer.toString('ascii', at, at + 4);
		const size = buffer.readUInt32LE(at + 4);
		const end = at + 8 + size + (size % 2); // chunks are padded to an even length
		if (size > buffer.length || end > buffer.length) {
			parts.push(buffer.subarray(at));
			at = buffer.length;
			break;
		}
		if (type !== 'EXIF' && type !== 'XMP ') {
			const chunk = Buffer.from(buffer.subarray(at, end));
			if (type === 'VP8X' && chunk.length >= 9) {
				// The flags byte says which optional chunks follow: unset EXIF (bit 3)
				// and XMP (bit 2), or a reader looks for chunks that are no longer there.
				chunk[8] &= ~0b0000_1100;
			}
			parts.push(chunk);
		}
		at = end;
	}
	const body = Buffer.concat(parts);
	const out = Buffer.concat([buffer.subarray(0, 12), body]);
	out.writeUInt32LE(out.length - 8, 4); // RIFF size: everything after 'RIFF' + size
	return out;
}

/**
 * An image with nothing in it that describes where it came from.
 * @param {Buffer} buffer the file as uploaded
 * @param {string} mime one of image/jpeg, image/png, image/webp
 * @returns {Buffer} the same picture, possibly the same buffer when there was nothing to remove
 */
export function stripMetadata(buffer, mime) {
	switch (mime) {
		case 'image/jpeg':
			return stripJpeg(buffer);
		case 'image/png':
			return stripPng(buffer);
		case 'image/webp':
			return stripWebp(buffer);
		default:
			return buffer;
	}
}
