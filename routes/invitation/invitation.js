import express from 'express';
import { default as passport } from 'passport';
import { invitationEnd } from '#routes/constants.js';
import { default as invitationCtrlr } from '#rtControllers/invitation.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import { limiters } from '#rtServices/ratelimit.services.js';

class InvitationRoutes {
	static Router;
	static #Controller;

	static {
		this.#Controller = new invitationCtrlr();
		this.Router = express.Router();
		this.#router();
	}

	static #router() {
		const authenticate = passport.authenticate('UsrJStrat', {
			session: false,
			failWithError: true
		});
		// Members of an active group, and admins.
		const staff = [
			authenticate,
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER)
		];

		this.Router.post(invitationEnd.post.create, ...staff, this.#Controller.create);
		this.Router.get(invitationEnd.get.many, ...staff, this.#Controller.getMany);
		this.Router.put(invitationEnd.put.update, ...staff, this.#Controller.update);
		this.Router.delete(invitationEnd.delete.remove, ...staff, this.#Controller.remove);

		// Public: the token is the credential. Rate limited like claim checks.
		this.Router.get(invitationEnd.get.one, limiters.inviteCheck, this.#Controller.getOne);
		this.Router.post(invitationEnd.post.accept, limiters.inviteCheck, this.#Controller.accept);
	}
}

export default InvitationRoutes;
