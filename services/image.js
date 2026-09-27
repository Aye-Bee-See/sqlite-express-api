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

import ValidationError from '#services/ValidationError.js';

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
 * An image this file cannot walk from end to end. Stored as it is, anything it
 * failed to recognise would go with it, so it is refused instead.
 */
export class UnreadableImageError extends ValidationError {
	constructor(kind) {
		super({
			message:
				'This ' +
				kind +
				' could not be read far enough to remove what it says about where it was taken. Save it again (a screenshot or an export will do) and upload that.',
			field: 'photo',
			code: 'wrong_type',
			params: { expected: 'a JPEG, PNG or WebP that can be read to the end' }
		});
	}
}

/**
 * Remove the descriptive segments of a JPEG, and everything after its end.
 *
 * A phone's JPEG often carries more after the end-of-image marker: a second,
 * smaller picture with its own EXIF (MPF), or a whole video (a motion photo).
 * No viewer draws any of it, and all of it can say where the picture was
 * taken, so nothing after the first end-of-image survives.
 * @param {Buffer} buffer
 * @returns {Buffer}
 * @throws {UnreadableImageError} a segment that runs past the end of the file
 */
function stripJpeg(buffer) {
	if (buffer.length < 4) {
		throw new UnreadableImageError('JPEG');
	}
	const parts = [buffer.subarray(0, 2)]; // SOI
	let at = 2;
	while (at + 2 <= buffer.length) {
		if (buffer[at] !== 0xff) {
			// Stray bytes between segments, which decoders skip: dropped, not kept.
			const next = buffer.indexOf(0xff, at);
			if (next === -1) {
				break;
			}
			at = next;
			continue;
		}
		const marker = buffer[at + 1];
		if (marker === 0xff) {
			at += 1; // fill byte before a marker
			continue;
		}
		if (marker === 0xd9) {
			parts.push(buffer.subarray(at, at + 2));
			return Buffer.concat(parts); // end of image: nothing after it is kept
		}
		if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
			parts.push(buffer.subarray(at, at + 2)); // markers with no length
			at += 2;
			continue;
		}
		if (marker === 0xd8 || at + 4 > buffer.length) {
			throw new UnreadableImageError('JPEG');
		}
		const length = buffer.readUInt16BE(at + 2);
		if (length < 2 || at + 2 + length > buffer.length) {
			throw new UnreadableImageError('JPEG');
		}
		const segment = buffer.subarray(at, at + 2 + length);
		if (marker === 0xda) {
			// Start of scan: its header, then compressed picture up to the next real
			// marker. 0xFF 0x00 is a stuffed byte and 0xFF 0xD0-D7 a restart, both
			// part of the picture. A progressive JPEG has several scans.
			let end = at + 2 + length;
			while (end < buffer.length) {
				if (buffer[end] === 0xff && end + 1 < buffer.length) {
					const next = buffer[end + 1];
					if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7)) {
						break;
					}
				}
				end += 1;
			}
			parts.push(buffer.subarray(at, end));
			at = end;
			continue;
		}
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
	// A file cut short after its picture: what was read is kept, and nothing was
	// left unread that could carry a description.
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
		throw new UnreadableImageError('WebP');
	}
	const parts = [];
	// Only what the RIFF header says is the file: anything appended after it is
	// not part of the picture and is not kept.
	const fileEnd = Math.min(buffer.length, 8 + buffer.readUInt32LE(4));
	let at = 12; // 'RIFF' + size + 'WEBP'
	while (at + 8 <= fileEnd) {
		const type = buffer.toString('ascii', at, at + 4);
		const size = buffer.readUInt32LE(at + 4);
		// Chunks are padded to an even length; the last one's pad may be missing.
		const end = Math.min(at + 8 + size + (size % 2), fileEnd);
		if (at + 8 + size > fileEnd) {
			// A chunk that claims more than is there could be hiding anything.
			throw new UnreadableImageError('WebP');
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
