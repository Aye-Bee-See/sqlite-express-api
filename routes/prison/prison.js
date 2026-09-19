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

		// The mail rule vocabulary: static and public (a bad token is still a 401, as on every public read).
		this.Router.get(
			prisonEnd.get.mailRules,
			AuthzService.optionalAuthenticate,
			this.#Controller.mailRules
		);

		// The master list is the admins' to change.
		const admin = [
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN)
		];
		this.Router.post(prisonEnd.post.createMailRule, ...admin, this.#Controller.createMailRule);
		this.Router.put(prisonEnd.put.updateMailRule, ...admin, this.#Controller.updateMailRule);
		this.Router.delete(prisonEnd.delete.removeMailRule, ...admin, this.#Controller.removeMailRule);

		// Update

		this.Router.put(
			prisonEnd.put.update,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER),
			this.#Controller.update
		);
		// Relay groups
		this.Router.put(
			prisonEnd.put.addRelay,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER),
			this.#Controller.addRelay
		);
		this.Router.delete(
			prisonEnd.delete.removeRelay,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER),
			this.#Controller.removeRelay
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
