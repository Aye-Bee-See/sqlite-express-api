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

function unwrap(text) {
	return String(text ?? '')
		.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
		.trim();
}

function decodeEntities(text) {
	return text
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&nbsp;/g, ' ')
		.replace(/&hellip;/g, '…')
		.replace(/&(?:rsquo|#8217);/g, '’')
		.replace(/&(?:lsquo|#8216);/g, '‘')
		.replace(/&(?:rdquo|#8221);/g, '”')
		.replace(/&(?:ldquo|#8220);/g, '“')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

/** Plain text of an HTML fragment: tags gone, entities decoded, whitespace folded. */
export function plainText(html) {
	return decodeEntities(
		unwrap(html)
			.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
			.replace(/<[^>]+>/g, ' ')
	)
		.replace(/\s+/g, ' ')
		.replace(/\s+([.,;:!?)])/g, '$1')
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

function tag(item, name) {
	const m = item.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
	return m ? unwrap(m[1]) : '';
}

/**
 * The items of an RSS 2.0 document, newest first, each `{ guid, title, url,
 * date, summary }`. Items without a title or a usable link are skipped.
 * @param {string} xml
 * @returns {{guid: string, title: string, url: string, date: Date|null, summary: string}[]}
 */
export function parseRss(xml) {
	const items = [];
	for (const [, body] of String(xml ?? '').matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
		const title = plainText(tag(body, 'title'));
		const url = decodeEntities(tag(body, 'link'));
		if (!title || !/^https?:\/\//i.test(url)) {
			continue;
		}
		const when = tag(body, 'pubDate') || tag(body, 'dc:date');
		const date = when && !Number.isNaN(Date.parse(when)) ? new Date(when) : null;
		const summary = summarize(tag(body, 'description') || tag(body, 'content:encoded'));
		items.push({ guid: decodeEntities(tag(body, 'guid')) || url, title, url, date, summary });
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
