import express from 'express';
import { default as passport } from 'passport';
import { userEnd } from '#routes/constants.js';
import { default as userCrtlr } from '#rtControllers/user.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import { limiters } from '#rtServices/ratelimit.services.js';

class UserRoutes {
	static Router;
	static #Controller;

	/************************************************************
	 *                                                          *
	 *                  STATIC INIT BLOCK                       *
	 *                                                          *
	 *   Initialize all necessary parts of the class            *
	 ************************************************************/
	static {
		this.#Controller = new userCrtlr();
		this.Router = express.Router();

		this.#router();
	}
	/***
	 *
	 *   Handle router params
	 *
	 ***/
	static #router() {
		// Create (public registration; an admin token unlocks other roles)
		this.Router.post(
			userEnd.post.create,
			AuthzService.optionalAuthenticate,
			this.#Controller.create
		);

		// Login
		this.Router.post(
			userEnd.post.login,
			limiters.login,
			passport.authenticate('LStrat', { session: false, authInfo: true, failWithError: true }),
			this.#Controller.login
		);

		// Sessions
		this.Router.post(
			userEnd.post.logout,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.logout
		);
		this.Router.post(
			userEnd.post.revoke,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN),
			this.#Controller.revoke
		);

		// Managed writers (chapter accounts that belong to a group, or admins)
		const staffOnly = [
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER),
			AuthzService.requireGroupMember
		];
		this.Router.post(userEnd.post.createWriter, ...staffOnly, this.#Controller.createWriter);
		this.Router.get(userEnd.get.writers, ...staffOnly, this.#Controller.writers);
		this.Router.post(userEnd.post.createToken, ...staffOnly, this.#Controller.createToken);
		this.Router.delete(userEnd.delete.revokeToken, ...staffOnly, this.#Controller.revokeToken);

		// Claiming (public: the token is the credential)
		this.Router.get(userEnd.get.claimInfo, limiters.claimCheck, this.#Controller.claimInfo);
		this.Router.post(userEnd.post.claim, this.#Controller.claim);

		// Read
		this.Router.get(
			userEnd.get.many,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN),
			this.#Controller.getMany
		);
		this.Router.get(
			userEnd.get.one,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireSelfOrAdmin,
			this.#Controller.getOne
		);

		// Update
		this.Router.put(
			userEnd.put.update,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireSelfOrAdmin,
			this.#Controller.update
		);

		// Delete
		this.Router.delete(
			userEnd.delete.remove,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireSelfOrAdmin,
			this.#Controller.remove
		);
	}
}

export default UserRoutes;
