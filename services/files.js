import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { uploadDir } from '#constants';

/**
 * Attachment storage: opaque files on disk under UPLOAD_DIR, named by a
 * random id plus the extension for their sniffed type. The database row
 * (Attachment) is the only place the original name and type live.
 */

/** Accepted types, by the bytes files of that type start with. */
export const ALLOWED_TYPES = {
	'application/pdf': { ext: 'pdf', magic: [[0x25, 0x50, 0x44, 0x46]] },
	'image/jpeg': { ext: 'jpg', magic: [[0xff, 0xd8, 0xff]] },
	'image/png': { ext: 'png', magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
	'image/webp': { ext: 'webp', magic: [[0x52, 0x49, 0x46, 0x46]] }
};

export const ALLOWED_MIME_TYPES = Object.keys(ALLOWED_TYPES);

/** Absolute path of the upload directory. */
export function uploadRoot() {
	return isAbsolute(uploadDir) ? uploadDir : resolve(process.cwd(), uploadDir);
}

/**
 * Detect a file's type from its leading bytes.
 * @param {Buffer} buffer
 * @returns {string|null} a MIME type from ALLOWED_TYPES, or null
 */
export function sniffType(buffer) {
	for (const [mime, { magic }] of Object.entries(ALLOWED_TYPES)) {
		for (const signature of magic) {
			if (buffer.length >= signature.length && signature.every((b, i) => buffer[i] === b)) {
				if (mime === 'image/webp') {
					// RIFF....WEBP
					return buffer.length >= 12 && buffer.toString('ascii', 8, 12) === 'WEBP' ? mime : null;
				}
				return mime;
			}
		}
	}
	return null;
}

/**
 * Write a file under the upload directory.
 * @param {Buffer} buffer
 * @param {string} mime one of ALLOWED_MIME_TYPES
 * @returns {Promise<string>} the stored file name (not a path)
 */
export async function storeFile(buffer, mime) {
	const root = uploadRoot();
	await mkdir(root, { recursive: true });
	const name = randomBytes(16).toString('hex') + '.' + ALLOWED_TYPES[mime].ext;
	await writeFile(join(root, name), buffer, { flag: 'wx' });
	return name;
}

/** Absolute path of a stored file name. */
export function storedPath(name) {
	return join(uploadRoot(), name);
}

/** Remove a stored file; a file that is already gone is not an error. */
export async function removeFile(name) {
	try {
		await unlink(storedPath(name));
	} catch (err) {
		if (err.code !== 'ENOENT') {
			throw err;
		}
	}
}
