process.env.NEWS_FEED_URL = '';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startServer, stopServer, get } = await import('./helpers.js');
const NewsItem = (await import('../database/models/news-item.model.js')).default;

before(startServer);
after(stopServer);

test('with no feed URL the news is off: nothing is pulled and the list is empty', async () => {
	assert.equal(NewsItem.enabled(), false);
	assert.equal(NewsItem.schedule({ log: () => {} }), null);
	assert.deepEqual(
		await NewsItem.refresh({
			fetch: async () => {
				throw new Error('must not be called');
			}
		}),
		{ fetched: 0, stored: 0 }
	);
	const res = await get('/news');
	assert.equal(res.status, 200);
	assert.deepEqual(res.body.data, []);
});
