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
		// Create: superadmins only. A group admin proposes through POST /moderation/submission
		// (decided 22 September 2026); the group's own links (relay, support) are still theirs.

		this.Router.post(
			prisonerEnd.post.create,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN),
			this.#Controller.create
		);

		// Read

		this.Router.get(
			prisonerEnd.get.many,
			AuthzService.optionalAuthenticate,
			this.#Controller.getMany
		);

		this.Router.get(
			prisonerEnd.get.one,
			AuthzService.optionalAuthenticate,
			this.#Controller.getOne
		);

		// Update

		this.Router.put(
			prisonerEnd.put.update,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN),
			this.#Controller.update
		);

		// Support groups
		this.Router.put(
			prisonerEnd.put.addSupport,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER),
			this.#Controller.addSupport
		);
		this.Router.delete(
			prisonerEnd.delete.removeSupport,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER),
			this.#Controller.removeSupport
		);

		// Delete

		this.Router.delete(
			prisonerEnd.delete.remove,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN),
			this.#Controller.remove
		);
	}
}

export default PrisonerRoutes;
