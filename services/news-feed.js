/**
 * The news feed on the front page. The server pulls an RSS feed (ABCF's, by
 * default when set) on a schedule and keeps the newest items, so that a
 * visitor's browser never touches the other site: what reaches it is a short
 * JSON list from this API.
 *
 * A small RSS 2.0 reader, enough for a WordPress feed: item title, link,
 * pubDate, and description (tags stripped, cut short). No dependency.
 */

const USER_AGENT = 'letters.support/1.0 (+https://letters.support)';
const SUMMARY_LENGTH = 300;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 2_000_000;

/*
 * Everything below reads text from another site on the thread that answers
 * every request, so every step is one pass: it looks for what closes a tag
 * with indexOf, from where it is, and gives up the moment that is not there.
 * The regular expressions this replaced searched the rest of the document
 * again from every unclosed `<`, `<item` or `<title`, and a 1.4 MB body built
 * that way held the server for minutes.
 */

/** The most items read from one feed; the front page shows a handful. */
const MAX_ITEMS = 200;

/** Lower case for ASCII letters only, so every offset in it holds in the original. */
function asciiLower(text) {
	return text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

function isSpace(char) {
	return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function unwrap(text) {
	const trimmed = String(text ?? '').trim();
	return trimmed.startsWith('<![CDATA[') && trimmed.endsWith(']]>')
		? trimmed.slice(9, -3).trim()
		: trimmed;
}

const NAMED = {
	nbsp: ' ',
	hellip: '…',
	rsquo: '’',
	lsquo: '‘',
	rdquo: '”',
	ldquo: '“',
	quot: '"',
	apos: "'",
	lt: '<',
	gt: '>',
	amp: '&'
};

/** A character by number, or U+FFFD for a number that names none. */
function character(n) {
	return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
		? String.fromCodePoint(n)
		: '\uFFFD';
}

/** One pass: `&amp;lt;` becomes `&lt;`, not `<`. */
function decodeEntities(text) {
	return text.replace(
		/&(?:#(\d{1,8})|#x([0-9a-f]{1,8})|([a-z]{2,8}));/gi,
		(whole, decimal, hex, name) => {
			if (decimal) {
				return character(Number(decimal));
			}
			if (hex) {
				return character(parseInt(hex, 16));
			}
			return Object.hasOwn(NAMED, name) ? NAMED[name] : whole;
		}
	);
}

/**
 * An HTML fragment with its tags replaced by spaces and its scripts and styles
 * dropped. A tag that never closes ends the text there.
 */
function stripTags(html) {
	const lower = asciiLower(html);
	const parts = [];
	let at = 0;
	while (at < html.length) {
		const open = html.indexOf('<', at);
		if (open === -1) {
			parts.push(html.slice(at));
			break;
		}
		parts.push(html.slice(at, open), ' ');
		const close = html.indexOf('>', open + 1);
		if (close === -1) {
			break;
		}
		const skip = ['script', 'style'].find(
			(name) =>
				lower.startsWith(name, open + 1) &&
				(lower[open + 1 + name.length] === '>' || isSpace(lower[open + 1 + name.length]))
		);
		if (skip) {
			const end = lower.indexOf('</' + skip, close + 1);
			const endClose = end === -1 ? -1 : html.indexOf('>', end);
			if (endClose === -1) {
				break;
			}
			at = endClose + 1;
		} else {
			at = close + 1;
		}
	}
	return parts.join('');
}

/** Plain text of an HTML fragment: tags gone, entities decoded, whitespace folded. */
export function plainText(html) {
	return decodeEntities(stripTags(unwrap(html)))
		.replace(/\s+/g, ' ')
		.replace(/ ([.,;:!?)])/g, '$1')
		.trim();
}

/** The first SUMMARY_LENGTH characters, cut at a word, with an ellipsis when cut. */
export function summarize(text, length = SUMMARY_LENGTH) {
	const plain = plainText(text);
	if (plain.length <= length) {
		return plain;
	}
	const cut = plain.slice(0, length);
	const atWord = cut.lastIndexOf(' ');
	return (atWord > length / 2 ? cut.slice(0, atWord) : cut).trim() + '…';
}

/**
 * Where the element `name` (lower case) opens at or after `from`: the offset of
 * its `<` and of the `>` that ends its opening tag, or null.
 */
function findOpen(lower, name, from) {
	const open = '<' + name;
	let at = from;
	for (;;) {
		const start = lower.indexOf(open, at);
		if (start === -1) {
			return null;
		}
		const next = lower[start + open.length];
		if (next === '>' || isSpace(next)) {
			const gt = lower.indexOf('>', start);
			return gt === -1 ? null : { start, gt };
		}
		at = start + open.length; // <items>, <linked>: another element
	}
}

/** The text of the first `name` element in an item, or ''. */
function field(body, lower, name) {
	const found = findOpen(lower, name, 0);
	if (!found) {
		return '';
	}
	const end = lower.indexOf('</' + name + '>', found.gt + 1);
	return end === -1 ? '' : unwrap(body.slice(found.gt + 1, end));
}

/**
 * The items of an RSS 2.0 document, newest first, each `{ guid, title, url,
 * date, summary }`. Items without a title or a usable link are skipped.
 * @param {string} xml
 * @returns {{guid: string, title: string, url: string, date: Date|null, summary: string}[]}
 */
export function parseRss(xml) {
	const text = String(xml ?? '');
	const lower = asciiLower(text);
	const items = [];
	let at = 0;
	while (items.length < MAX_ITEMS) {
		const found = findOpen(lower, 'item', at);
		if (!found) {
			break;
		}
		const end = lower.indexOf('</item>', found.gt + 1);
		if (end === -1) {
			break; // an item that never closes, and nothing after it can be one
		}
		const body = text.slice(found.gt + 1, end);
		const bodyLower = lower.slice(found.gt + 1, end);
		at = end + '</item>'.length;
		const title = plainText(field(body, bodyLower, 'title'));
		const url = decodeEntities(field(body, bodyLower, 'link'));
		if (!title || !/^https?:\/\//i.test(url)) {
			continue;
		}
		const when = field(body, bodyLower, 'pubdate') || field(body, bodyLower, 'dc:date');
		const date = when && !Number.isNaN(Date.parse(when)) ? new Date(when) : null;
		const summary = summarize(
			field(body, bodyLower, 'description') || field(body, bodyLower, 'content:encoded')
		);
		items.push({
			guid: decodeEntities(field(body, bodyLower, 'guid')) || url,
			title,
			url,
			date,
			summary
		});
	}
	return items.sort((a, b) => (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0));
}

/**
 * Fetch a feed and parse it.
 * @param {string} url
 * @param {{fetch?: typeof fetch}} [options] a fetch to use instead of the global one (tests)
 * @throws {Error} on a non-2xx answer, a body over MAX_BYTES, or a timeout
 */
export async function fetchFeed(url, { fetch: doFetch = globalThis.fetch } = {}) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await doFetch(url, {
			headers: {
				'user-agent': USER_AGENT,
				accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1'
			},
			redirect: 'follow',
			signal: controller.signal
		});
		if (!res.ok) {
			throw new Error('The feed answered ' + res.status + '.');
		}
		return parseRss(await readBounded(res, MAX_BYTES, controller));
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The body as text, read chunk by chunk and abandoned the moment it passes
 * `max` bytes, so a feed of any size costs at most that much memory.
 * @throws {Error} over the cap
 */
async function readBounded(res, max, controller) {
	if (!res.body || typeof res.body.getReader !== 'function') {
		// A stand-in response (tests) with text() only.
		const text = await res.text();
		if (Buffer.byteLength(text) > max) {
			throw new Error('The feed is larger than ' + max + ' bytes.');
		}
		return text;
	}
	const reader = res.body.getReader();
	const chunks = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		size += value.byteLength;
		if (size > max) {
			controller.abort();
			await reader.cancel().catch(() => {});
			throw new Error('The feed is larger than ' + max + ' bytes.');
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString('utf8');
}
