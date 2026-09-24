import RouteController from '#rtControllers/route.controller.js';
import NewsItem from '#models/news-item.model.js';
import ValidationError from '#services/ValidationError.js';
import { NotFoundError } from '#services/HttpError.js';
import { newsFeed } from '#constants';

/** GET /news: the front-page news items, newest first. */
export default class NewsController extends RouteController {
	constructor() {
		super('news');
		this.getMany = this.getMany.bind(this);
		this.getOne = this.getOne.bind(this);
		this.create = this.create.bind(this);
		this.update = this.update.bind(this);
		this.remove = this.remove.bind(this);
	}

	async getMany(req, res) {
		try {
			let limit = newsFeed.show;
			if (req.query.limit !== undefined) {
				limit = Number(req.query.limit);
				if (!Number.isInteger(limit) || limit < 1 || limit > newsFeed.keep) {
					throw new ValidationError(
						'limit must be a whole number from 1 to ' + newsFeed.keep + '.'
					);
				}
			}
			this.handleSuccess(res, NewsItem.enabled() ? await NewsItem.latest(limit) : []);
		} catch (err) {
			this.handleErr(res, !(err instanceof Error) ? new Error(err) : err);
		}
	}

	async getOne(req, res, next) {
		next(new NotFoundError('The news has no single-item read.'));
	}
	async create(req, res, next) {
		next(new NotFoundError('The news is pulled by the server, not posted.'));
	}
	async update(req, res, next) {
		next(new NotFoundError('The news is pulled by the server, not edited.'));
	}
	async remove(req, res, next) {
		next(new NotFoundError('The news is pulled by the server, not deleted.'));
	}
}
