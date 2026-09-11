import express from 'express';
import { default as passport } from 'passport';
import { prisonerEnd } from '#routes/constants.js';
import { default as prisonerCrtlr } from '#rtControllers/prisoner.controller.js';
import AuthzService from '#rtServices/authz.services.js';

class PrisonerRoutes {
	static Router;
	static #Controller;

	/************************************************************
	 *                                                          *
	 *                  STATIC INIT BLOCK                       *
	 *                                                          *
	 *   Initialize all necessary parts of the class            *
	 ************************************************************/
	static {
		this.#Controller = new prisonerCrtlr();
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
			prisonerEnd.post.create,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER),
			this.#Controller.create
		);

		// Read

		this.Router.get(
			prisonerEnd.get.many,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.getMany
		);

		this.Router.get(
			prisonerEnd.get.one,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.getOne
		);

		// Update

		this.Router.put(
			prisonerEnd.put.update,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER),
			this.#Controller.update
		);

		// Delete

		this.Router.delete(
			prisonerEnd.delete.remove,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER),
			this.#Controller.remove
		);
	}
}

export default PrisonerRoutes;
