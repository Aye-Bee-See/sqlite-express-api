import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRss, plainText } from '../services/news-feed.js';

// The feed comes from another site, and parsing it runs on the one thread that
// answers every request. A body built to make a pattern search the rest of the
// document from every position once stalled the server for two minutes.
const SIZE = 1_500_000; // under the 2 MB the fetch allows

const hostile = {
	'items that never close': '<rss><channel>' + '<item>'.repeat(SIZE / 6),
	'a tag that never closes':
		'<item><title>x</title><link>https://a.example/</link><description>' +
		'<'.repeat(SIZE) +
		'</description></item>',
	'scripts that never close':
		'<item><title>x</title><link>https://a.example/</link><description>' +
		'<script'.repeat(SIZE / 7) +
		'</description></item>',
	'a field that never closes': '<item>' + '<title>'.repeat(SIZE / 7) + '</item>',
	'entities without end':
		'<item><title>' + '&#'.repeat(SIZE / 2) + '</title><link>https://a.example/</link></item>'
};

for (const [what, xml] of Object.entries(hostile)) {
	test('a hostile feed is read quickly: ' + what, () => {
		const started = process.hrtime.bigint();
		parseRss(xml);
		const ms = Number(process.hrtime.bigint() - started) / 1e6;
		assert.ok(ms < 1000, what + ' took ' + Math.round(ms) + ' ms');
	});
}

test('an entity naming no character does not fail the feed', () => {
	const xml =
		'<item><title>Fine &#99999999; and &#x110000; and &#xD800;</title><link>https://a.example/1</link></item>' +
		'<item><title>Also fine</title><link>https://a.example/2</link></item>';
	const items = parseRss(xml);
	assert.equal(items.length, 2);
	assert.equal(items[0].title, 'Fine � and � and �');
});

test('text is read the same way it was', () => {
	assert.equal(
		plainText(
			'<p>One &amp; <b>two</b>&hellip;</p><script>alert(1)</script> &#8217;three&#x2019; &amp;lt;'
		),
		'One & two … ’three’ &lt;'
	);
	assert.equal(plainText('<![CDATA[<p>Inside</p>]]>'), 'Inside');
	assert.equal(plainText('a <br/>b <STYLE>x{}</STYLE>c'), 'a b c');
	const [item] = parseRss(
		'<RSS><ITEM><Title>Upper</Title><LINK>https://a.example/u</LINK><guid isPermaLink="false">g1</guid></ITEM></RSS>'
	);
	assert.deepEqual([item.title, item.url, item.guid], ['Upper', 'https://a.example/u', 'g1']);
	assert.equal(parseRss('<items><item>x</item></items>').length, 0, '<items> is not <item>');
});
