import express from 'express';
import { newsEnd } from '#routes/constants.js';
import NewsController from '#rtControllers/news.controller.js';

/** The front-page news, public. */
class NewsRoutes {
	static Router;
	static #Controller;

	static {
		this.#Controller = new NewsController();
		this.Router = express.Router();
		this.Router.get(newsEnd.get.many, this.#Controller.getMany);
	}
}

export default NewsRoutes;
