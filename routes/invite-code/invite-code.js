import express from 'express';
import { default as passport } from 'passport';
import { inviteCodeEnd } from '#routes/constants.js';
import InviteCodeController from '#rtControllers/invite-code.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import { limiters } from '#rtServices/ratelimit.services.js';

/** Invite-code routes, mounted under /auth beside the user routes. */
class InviteCodeRoutes {
	static Router;
	static #Controller;

	static {
		this.#Controller = new InviteCodeController();
		this.Router = express.Router();
		this.#router();
	}

	static #router() {
		const authenticate = passport.authenticate('UsrJStrat', {
			session: false,
			failWithError: true
		});
		// Group admins of an active chapter, and superadmins.
		const staff = [
			authenticate,
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER)
		];
		this.Router.post(inviteCodeEnd.post.create, ...staff, this.#Controller.create);
		this.Router.get(inviteCodeEnd.get.many, ...staff, this.#Controller.getMany);
		this.Router.delete(inviteCodeEnd.delete.remove, ...staff, this.#Controller.remove);
		// Joining is public: the code is the credential, and tries are limited by address.
		this.Router.get(inviteCodeEnd.get.one, limiters.join, this.#Controller.getOne);
		this.Router.post(
			inviteCodeEnd.post.createAccount,
			limiters.join,
			this.#Controller.createAccount
		);
	}
}

export default InviteCodeRoutes;
