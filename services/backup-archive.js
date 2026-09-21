import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import _sodium from 'libsodium-wrappers';

/**
 * The backup file: a tar archive, encrypted to a public key.
 *
 * The server that makes a backup must not be able to open it: whoever breaks
 * into the server would otherwise have every backup as well. So the file is
 * sealed to a public key (BACKUP_PUBLIC_KEY) whose private half is kept
 * offline by the people who run the site.
 *
 *   "ABCBAK1\n"                       magic, 8 bytes
 *   uint32 (big endian) + header      JSON: format, createdAt, recipient, sealedKey, streamHeader, chunkBytes
 *   uint32 + ciphertext, repeated     the tar stream in chunks
 *
 * A random 32-byte key encrypts the tar stream (libsodium secretstream,
 * XChaCha20-Poly1305: every chunk is authenticated, chunks cannot be
 * reordered, and the last one is marked, so a truncated file is noticed).
 * That key travels in the header as `sealedKey`, a sealed box to the public
 * key. The magic and the header are bound to every chunk as associated data.
 *
 * Inside is plain ustar, so that once decrypted (`npm run backup:decrypt`) any
 * tar tool opens it, with or without this repository. Everything streams:
 * nothing here holds more than one chunk in memory.
 */

export const MAGIC = Buffer.from('ABCBAK1\n');
export const FORMAT = 1;
/** Plaintext bytes per encrypted chunk. */
export const CHUNK_BYTES = 256 * 1024;
const BLOCK = 512;

let sodium = null;
export async function ready() {
	await _sodium.ready;
	sodium = _sodium;
	return sodium;
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (text) => new Uint8Array(Buffer.from(text, 'base64'));

/** A new keypair. The private half never belongs on the server. */
export function generateKeypair() {
	const pair = sodium.crypto_box_keypair();
	return { publicKey: b64(pair.publicKey), privateKey: b64(pair.privateKey) };
}

/** @throws {Error} unless this is the base64 of a 32-byte key */
export function parseKey(text, what) {
	const bytes = typeof text === 'string' ? unb64(text.trim()) : new Uint8Array();
	if (bytes.length !== 32 || b64(bytes) !== text.trim()) {
		throw new Error(
			what + ' must be the base64 of a 32-byte key (npm run backup:keygen makes one).'
		);
	}
	return bytes;
}

/** A short name for a public key, to tell which key a backup was made for. */
export function fingerprint(publicKey) {
	return Buffer.from(sodium.crypto_generichash(8, publicKey)).toString('hex');
}

export function publicKeyOf(privateKey) {
	return sodium.crypto_scalarmult_base(privateKey);
}

// ---------------------------------------------------------------- tar

function octal(value, width) {
	return value.toString(8).padStart(width - 1, '0') + '\0';
}

/** One ustar header for a regular file. */
export function tarHeader(name, size, mtime = new Date()) {
	let prefix = '';
	let base = name;
	if (Buffer.byteLength(base) > 100) {
		const cut = name.lastIndexOf('/', 155);
		prefix = name.slice(0, cut);
		base = name.slice(cut + 1);
	}
	if (!base || Buffer.byteLength(base) > 100 || Buffer.byteLength(prefix) > 155) {
		throw new Error('File name too long for the archive: ' + name);
	}
	const header = Buffer.alloc(BLOCK);
	header.write(base, 0, 100);
	header.write(octal(0o600, 8), 100);
	header.write(octal(0, 8), 108);
	header.write(octal(0, 8), 116);
	header.write(octal(size, 12), 124);
	header.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136);
	header.fill(' ', 148, 156);
	header.write('0', 156);
	header.write('ustar\0' + '00', 257);
	header.write(prefix, 345, 155);
	let sum = 0;
	for (const byte of header) {
		sum += byte;
	}
	header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
	return header;
}

const padding = (size) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

/**
 * The tar stream of some files, followed by `manifest.json`, which lists every
 * file with its size and SHA-256 (known only once each has been read).
 * @param {{name: string, path: string, size: number}[]} files
 * @param {object} about what the manifest says besides the files
 * @returns {AsyncGenerator<Buffer>}
 */
export async function* tarStream(files, about) {
	const listed = [];
	for (const file of files) {
		yield tarHeader(file.name, file.size);
		const hash = createHash('sha256');
		let seen = 0;
		for await (const piece of createReadStream(file.path)) {
			hash.update(piece);
			seen += piece.length;
			yield piece;
		}
		if (seen !== file.size) {
			throw new Error(file.name + ' changed size while it was being backed up.');
		}
		yield padding(seen);
		listed.push({ name: file.name, size: seen, sha256: hash.digest('hex') });
	}
	const manifest = Buffer.from(JSON.stringify({ ...about, files: listed }, null, '\t') + '\n');
	yield tarHeader('manifest.json', manifest.length);
	yield manifest;
	yield padding(manifest.length);
	yield Buffer.alloc(BLOCK * 2);
}

/** Reads exact byte counts from a stream of buffers. */
class Reader {
	#source;
	#held = [];
	#length = 0;
	constructor(source) {
		this.#source = source[Symbol.asyncIterator]();
	}
	/** @returns {Promise<Buffer|null>} exactly `count` bytes, or null at a clean end */
	async read(count) {
		while (this.#length < count) {
			const next = await this.#source.next();
			if (next.done) {
				if (this.#length === 0) {
					return null;
				}
				throw new Error('The archive ends in the middle of a record.');
			}
			this.#held.push(next.value);
			this.#length += next.value.length;
		}
		const all = Buffer.concat(this.#held);
		this.#held = [all.subarray(count)];
		this.#length = all.length - count;
		return all.subarray(0, count);
	}
	/** Hand `count` bytes to `each` in pieces, without joining them. */
	async pour(count, each) {
		let left = count;
		while (left > 0) {
			const piece = await this.read(Math.min(left, CHUNK_BYTES));
			if (piece === null) {
				throw new Error('The archive ends in the middle of a file.');
			}
			await each(piece);
			left -= piece.length;
		}
	}
}

/**
 * Walk a tar stream. For each regular file `open(name, size)` returns a sink
 * `{ write(piece), close() }` (or null to skip the bytes).
 * @returns {Promise<string[]>} the names met, in order
 */
export async function untar(plain, open) {
	const reader = new Reader(plain);
	const names = [];
	for (;;) {
		const header = await reader.read(BLOCK);
		if (header === null) {
			return names;
		}
		if (header.every((byte) => byte === 0)) {
			// The end of the archive. Read on to the end of the stream all the same: the
			// encryption only vouches for the file once its last chunk has been seen.
			while ((await reader.read(BLOCK)) !== null) {
				// nothing: padding
			}
			return names;
		}
		const text = (from, length) =>
			header.toString('utf8', from, from + length).replace(/\0.*$/, '');
		const stored = parseInt(text(148, 8).trim(), 8);
		const check = Buffer.from(header);
		check.fill(' ', 148, 156);
		let sum = 0;
		for (const byte of check) {
			sum += byte;
		}
		if (sum !== stored) {
			throw new Error('The archive is damaged (a tar header does not add up).');
		}
		const prefix = text(345, 155);
		const name = (prefix ? prefix + '/' : '') + text(0, 100);
		const size = parseInt(text(124, 12).trim() || '0', 8);
		if (name.startsWith('/') || name.split('/').includes('..') || name.includes('\\')) {
			throw new Error('The archive names a file outside itself: ' + name);
		}
		names.push(name);
		const sink = await open(name, size);
		await reader.pour(size, async (piece) => {
			if (sink) {
				await sink.write(piece);
			}
		});
		if (sink) {
			await sink.close();
		}
		await reader.read((BLOCK - (size % BLOCK)) % BLOCK);
	}
}

// ---------------------------------------------------------------- encryption

const uint32 = (value) => {
	const out = Buffer.alloc(4);
	out.writeUInt32BE(value);
	return out;
};

/**
 * Encrypt a stream of buffers to a public key.
 * @param {AsyncIterable<Buffer>} plain
 * @param {Uint8Array} publicKey
 * @returns {AsyncGenerator<Buffer>} the bytes of the backup file
 */
export async function* seal(plain, publicKey, createdAt = new Date()) {
	const key = sodium.crypto_secretstream_xchacha20poly1305_keygen();
	const { state, header: streamHeader } =
		sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
	const header = Buffer.from(
		JSON.stringify({
			format: FORMAT,
			createdAt: createdAt.toISOString(),
			recipient: fingerprint(publicKey),
			sealedKey: b64(sodium.crypto_box_seal(key, publicKey)),
			streamHeader: b64(streamHeader),
			chunkBytes: CHUNK_BYTES
		})
	);
	sodium.memzero(key);
	const bound = Buffer.concat([MAGIC, header]);
	yield MAGIC;
	yield uint32(header.length);
	yield header;

	const push = (chunk, last) => {
		const tag = last
			? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
			: sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
		const sealed = sodium.crypto_secretstream_xchacha20poly1305_push(state, chunk, bound, tag);
		return [uint32(sealed.length), Buffer.from(sealed)];
	};
	// One chunk is held back, because only the last may be marked as the last.
	let held = null;
	let pending = [];
	let size = 0;
	for await (const piece of plain) {
		pending.push(piece);
		size += piece.length;
		while (size >= CHUNK_BYTES) {
			const all = Buffer.concat(pending);
			if (held) {
				yield* push(held, false);
			}
			held = all.subarray(0, CHUNK_BYTES);
			pending = [all.subarray(CHUNK_BYTES)];
			size = all.length - CHUNK_BYTES;
		}
	}
	const rest = Buffer.concat(pending);
	if (rest.length > 0) {
		if (held) {
			yield* push(held, false);
		}
		held = rest;
	}
	yield* push(held ?? Buffer.alloc(0), true);
}

/**
 * Read a backup file's header without the private key: when it was made and
 * for which key.
 * @param {AsyncIterable<Buffer>} file
 */
export async function readHeader(file) {
	const reader = new Reader(file);
	return (await openHeader(reader)).header;
}

async function openHeader(reader) {
	const magic = await reader.read(MAGIC.length);
	if (magic === null || !magic.equals(MAGIC)) {
		throw new Error('This is not a backup made by npm run backup.');
	}
	const length = (await reader.read(4)).readUInt32BE();
	if (length > 64 * 1024) {
		throw new Error('The backup file is damaged (its header is too large).');
	}
	const raw = await reader.read(length);
	let header;
	try {
		header = JSON.parse(raw.toString('utf8'));
	} catch {
		throw new Error('The backup file is damaged (its header cannot be read).');
	}
	if (header.format !== FORMAT) {
		throw new Error(
			'This backup has format ' + header.format + '; this version reads format ' + FORMAT + '.'
		);
	}
	return { header, bound: Buffer.concat([MAGIC, raw]) };
}

/**
 * Decrypt a backup file.
 * @param {AsyncIterable<Buffer>} file
 * @param {Uint8Array} privateKey
 * @returns {AsyncGenerator<Buffer>} the tar stream
 * @throws {Error} wrong key, damaged, or cut short
 */
export async function* unseal(file, privateKey) {
	const reader = new Reader(file);
	const { header, bound } = await openHeader(reader);
	const publicKey = publicKeyOf(privateKey);
	let key;
	try {
		key = sodium.crypto_box_seal_open(unb64(header.sealedKey), publicKey, privateKey);
	} catch {
		throw new Error(
			'This key does not open this backup. The backup was made for key ' +
				header.recipient +
				'; this is key ' +
				fingerprint(publicKey) +
				'.'
		);
	}
	const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(
		unb64(header.streamHeader),
		key
	);
	sodium.memzero(key);
	let finished = false;
	for (;;) {
		const size = await reader.read(4);
		if (size === null) {
			break;
		}
		if (finished) {
			throw new Error('The backup file has data after its end.');
		}
		const length = size.readUInt32BE();
		if (length > CHUNK_BYTES + 1024) {
			throw new Error('The backup file is damaged (a chunk is too large).');
		}
		const sealed = await reader.read(length);
		const opened = sodium.crypto_secretstream_xchacha20poly1305_pull(state, sealed, bound);
		if (!opened) {
			throw new Error('The backup file is damaged or was changed (a chunk does not verify).');
		}
		finished = opened.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL;
		yield Buffer.from(opened.message);
	}
	if (!finished) {
		throw new Error('The backup file is cut short: its last part is missing.');
	}
}
