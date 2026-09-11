import express from 'express';
import { default as passport } from 'passport';
import { prisonEnd } from '#routes/constants.js';
import { default as prisonCrtlr } from '#rtControllers/prison.controller.js';
import AuthzService from '#rtServices/authz.services.js';

class PrisonRoutes {
	static Router;
	static #Controller;

	/************************************************************
	 *                                                                                                                    *
	 *                  STATIC INIT BLOCK                                                                  *
	 *                                                                                                                    *
	 *   Initialize all necessary parts of the class                                              *
	 ************************************************************/
	static {
		this.#Controller = new prisonCrtlr();
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
			prisonEnd.post.create,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER),
			this.#Controller.create
		);

		// Read

		this.Router.get(
			prisonEnd.get.many,
			AuthzService.optionalAuthenticate,
			this.#Controller.getMany
		);

		this.Router.get(prisonEnd.get.one, AuthzService.optionalAuthenticate, this.#Controller.getOne);

		// Update

		this.Router.put(
			prisonEnd.put.update,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER),
			this.#Controller.update
		);
		// Add Rule
		this.Router.put(
			prisonEnd.put.addRule,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER),
			this.#Controller.addRule
		);

		// Delete

		this.Router.delete(
			prisonEnd.delete.remove,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER),
			this.#Controller.remove
		);
	}
}

export default PrisonRoutes;
