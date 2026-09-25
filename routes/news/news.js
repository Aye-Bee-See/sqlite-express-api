import express from 'express';
import { newsEnd } from '#routes/constants.js';
import NewsController from '#rtControllers/news.controller.js';
import AuthzService from '#rtServices/authz.services.js';

/** The front-page news, public. */
class NewsRoutes {
	static Router;
	static #Controller;

	static {
		this.#Controller = new NewsController();
		this.Router = express.Router();
		// Public, but a token that is present and bad is still a 401, as on every public read.
		this.Router.get(newsEnd.get.many, AuthzService.optionalAuthenticate, this.#Controller.getMany);
	}
}

export default NewsRoutes;
