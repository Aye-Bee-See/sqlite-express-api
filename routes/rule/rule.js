import express from 'express';
import { default as bodyParser } from 'body-parser';
import { default as passport } from 'passport';
import { ruleEnd } from '#routes/constants.js';
import { default as ruleCrtlr } from '#rtControllers/rule.controller.js';
import authService from '#rtServices/auth.services.js';

class RuleRoutes {
	static Router;
	static #Controller;

	/************************************************************
	 *                                                          *
	 *                  STATIC INIT BLOCK                       *
	 *                                                          *
	 *   Initialize all necessary parts of the class            *
	 ************************************************************/
	static {
		const app = express();
		app.use(bodyParser.json());
		app.use(bodyParser.urlencoded({ extended: true }));
		app.use(passport.initialize());

		const JwtStrat = authService.authorize;
		passport.use('UsrJStrat', JwtStrat);

		this.#Controller = new ruleCrtlr();
		this.Router = express.Router();

		this.#router();
	}
	/***
	 *
	 *   Handle router params
	 *
	 ***/
	static #router() {
		// Create

		this.Router.post(
			ruleEnd.post.create,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.create
		);

		// Read

		this.Router.get(
			ruleEnd.get.many,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.getMany
		);

		this.Router.get(
			ruleEnd.get.one,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.getOne
		);

		// Update

		this.Router.put(
			ruleEnd.put.update,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.update
		);

		// Delete

		this.Router.delete(
			ruleEnd.delete.remove,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.remove
		);
	}
}

export default RuleRoutes;
