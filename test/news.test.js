process.env.NEWS_FEED_URL = 'https://feed.example/feed/';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, get } = await import('./helpers.js');
const { parseRss, summarize, plainText } = await import('../services/news-feed.js');
const NewsItem = (await import('../database/models/news-item.model.js')).default;

const FEED = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Anarchist Black Cross Federation</title><link>https://www.abcf.net</link>
<item>
	<title>Running Down the Walls postponed to 10.18</title>
	<link>https://www.abcf.net/blog/rdtw-postponed/</link>
	<pubDate>Sat, 19 Sep 2026 23:04:57 +0000</pubDate>
	<guid isPermaLink="false">https://www.abcf.net/?p=1</guid>
	<description><![CDATA[]]></description>
	<content:encoded><![CDATA[<p>The NYC run moves to <strong>October 18</strong>. Same route &amp; same time.</p>]]></content:encoded>
</item>
<item>
	<title>Benjamin Song statement</title>
	<link>https://www.abcf.net/blog/song-statement/</link>
	<pubDate>Thu, 17 Sep 2026 01:32:57 +0000</pubDate>
	<guid isPermaLink="false">https://www.abcf.net/?p=2</guid>
	<description><![CDATA[Hey y&#8217;all, my name is Champagne. ${'word '.repeat(80)}<a href="x">end</a>]]></description>
</item>
<item><title>No link here</title><description>skipped</description></item>
<item><title>Bad link</title><link>javascript:alert(1)</link></item>
<item>
	<title>Oldest, no guid</title>
	<link>https://www.abcf.net/blog/oldest/</link>
	<pubDate>Mon, 01 Sep 2026 00:00:00 +0000</pubDate>
	<description>Short.</description>
</item>
</channel></rss>`;

before(startServer);
after(stopServer);

test('the reader takes what the front page needs from a WordPress feed and nothing it should not', () => {
	const items = parseRss(FEED);
	assert.deepEqual(
		items.map((i) => [i.title, i.url, i.guid]),
		[
			[
				'Running Down the Walls postponed to 10.18',
				'https://www.abcf.net/blog/rdtw-postponed/',
				'https://www.abcf.net/?p=1'
			],
			[
				'Benjamin Song statement',
				'https://www.abcf.net/blog/song-statement/',
				'https://www.abcf.net/?p=2'
			],
			['Oldest, no guid', 'https://www.abcf.net/blog/oldest/', 'https://www.abcf.net/blog/oldest/']
		],
		'newest first; items without a title or an http link are skipped'
	);
	assert.equal(items[0].date.toISOString(), '2026-09-19T23:04:57.000Z');
	assert.equal(
		items[0].summary,
		'The NYC run moves to October 18. Same route & same time.',
		'content:encoded when the description is empty; tags gone'
	);
	assert.ok(items[1].summary.startsWith('Hey y’all, my name is Champagne.'));
	assert.ok(
		items[1].summary.length <= 301 && items[1].summary.endsWith('…'),
		'cut at a word with an ellipsis'
	);
	assert.ok(!items[1].summary.includes('<a'));
	assert.equal(plainText('<p>a &lt;b&gt; &amp; c</p>'), 'a <b> & c');
	assert.equal(summarize('short', 10), 'short');
	assert.deepEqual(parseRss(''), []);
	assert.deepEqual(parseRss('<html>not a feed</html>'), []);
});

test('the server pulls the feed, keeps the newest, and hands the front page a short list', async () => {
	const calls = [];
	const fetch = async (url, options) => {
		calls.push({ url, ua: options.headers['user-agent'] });
		return { ok: true, status: 200, text: async () => FEED };
	};
	const first = await NewsItem.refresh({ fetch, log: () => {} });
	assert.deepEqual(first, { fetched: 3, stored: 3 });
	assert.deepEqual(
		calls.map((c) => c.url),
		['https://feed.example/feed/']
	);
	assert.match(calls[0].ua, /^letters\.support\//, 'an honest user agent');
	// A second pull with the same feed stores nothing new.
	assert.deepEqual(await NewsItem.refresh({ fetch, log: () => {} }), { fetched: 3, stored: 0 });
	assert.equal(await NewsItem.count(), 3);

	const res = await get('/news');
	assert.equal(res.status, 200, JSON.stringify(res.body));
	assert.deepEqual(
		res.body.data.map((i) => Object.keys(i).sort()),
		[
			['date', 'summary', 'title', 'url'],
			['date', 'summary', 'title', 'url'],
			['date', 'summary', 'title', 'url']
		]
	);
	assert.equal(res.body.data[0].title, 'Running Down the Walls postponed to 10.18');
	assert.equal(res.body.data[0].date, '2026-09-19T23:04:57.000Z');
	assert.equal((await get('/news?limit=1')).body.data.length, 1);
	assert.equal((await get('/news?limit=0')).status, 400);
	assert.equal((await get('/news?limit=21')).status, 400);
	assert.equal((await get('/news?limit=two')).status, 400);

	// A feed that refuses or vanishes leaves what was last fetched.
	await assert.rejects(
		NewsItem.refresh({
			fetch: async () => ({ ok: false, status: 403, text: async () => '' }),
			log: () => {}
		}),
		/answered 403/
	);
	assert.equal((await get('/news')).body.data.length, 3, 'the last good pull stays');
	// Only the newest `keep` survive when the feed is long.
	const many =
		'<rss><channel>' +
		Array.from(
			{ length: 30 },
			(_, i) =>
				`<item><title>Item ${i}</title><link>https://www.abcf.net/blog/${i}/</link><pubDate>Mon, 0${1 + (i % 9)} Sep 2026 0${i % 10}:00:00 +0000</pubDate></item>`
		).join('') +
		'</channel></rss>';
	await NewsItem.refresh({
		fetch: async () => ({ ok: true, status: 200, text: async () => many }),
		log: () => {}
	});
	assert.equal(await NewsItem.count(), 20);
	assert.equal((await get('/news?limit=20')).body.data.length, 20);
});
