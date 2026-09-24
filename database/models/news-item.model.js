import { Model, Op } from 'sequelize';
import Schemas from '#schemas/all.schema.js';
import { newsFeed } from '#constants';
import { fetchFeed } from '#services/news-feed.js';

/**
 * The front-page news, pulled from an RSS feed by the server on a schedule
 * (NEWS_FEED_URL, NEWS_EVERY_HOURS) so that visitors never fetch it
 * themselves. Only the newest items are kept.
 */
export default class NewsItem extends Model {
	static init(sequelize) {
		return super.init(Schemas.newsItem, {
			sequelize,
			modelName: 'NewsItem',
			tableName: 'NewsItems'
		});
	}

	static associate() {}

	/** Is the feature on? Off when no feed URL is set. */
	static enabled() {
		return Boolean(newsFeed.url);
	}

	/**
	 * Pull the feed and store its items; keep the newest `newsFeed.keep`.
	 * @param {{fetch?: typeof fetch, url?: string, log?: (line: string) => void}} [options]
	 * @returns {Promise<{fetched: number, stored: number}>}
	 */
	static async refresh({ fetch, url = newsFeed.url, log = console.log } = {}) {
		if (!url) {
			return { fetched: 0, stored: 0 };
		}
		const items = await fetchFeed(url, fetch ? { fetch } : {});
		const now = new Date();
		const newest = items.slice(0, newsFeed.keep);
		// SQLite's upsert does not say whether it inserted, so look first.
		const known = new Set(
			(
				await this.findAll({
					attributes: ['guid'],
					where: { guid: newest.map((item) => item.guid) }
				})
			).map((row) => row.guid)
		);
		let stored = 0;
		for (const item of newest) {
			await this.upsert({
				guid: item.guid,
				title: item.title,
				url: item.url,
				date: item.date,
				summary: item.summary,
				fetchedAt: now
			});
			stored += known.has(item.guid) ? 0 : 1;
		}
		// Items that fell off the feed and off the list go.
		const keep = await this.findAll({
			attributes: ['id'],
			order: [
				['date', 'DESC'],
				['id', 'DESC']
			],
			limit: newsFeed.keep
		});
		await this.destroy({ where: { id: { [Op.notIn]: keep.map((row) => row.id) } } });
		log('News: ' + items.length + ' item(s) in the feed, ' + stored + ' new.');
		return { fetched: items.length, stored };
	}

	/** The newest items, for the front page. */
	static async latest(limit = newsFeed.show) {
		const rows = await this.findAll({
			order: [
				['date', 'DESC'],
				['id', 'DESC']
			],
			limit
		});
		return rows.map((row) => ({
			title: row.title,
			url: row.url,
			date: row.date,
			summary: row.summary
		}));
	}

	/**
	 * Pull now (in the background) and on a schedule. The timer never holds the
	 * process open, and a failed pull is logged, not thrown: the front page shows
	 * what was last fetched.
	 */
	static schedule({ log = console.log } = {}) {
		if (!NewsItem.enabled()) {
			return null;
		}
		const pull = () =>
			NewsItem.refresh({ log }).catch((err) => console.error('[news] pull failed', err.message));
		pull();
		return setInterval(pull, newsFeed.everyHours * 60 * 60 * 1000).unref();
	}
}
