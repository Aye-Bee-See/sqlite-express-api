import express from 'express';
import { default as passport } from 'passport';
import { moderationEnd } from '#routes/constants.js';
import { default as moderationCtrlr } from '#rtControllers/moderation.controller.js';
import AuthzService from '#rtServices/authz.services.js';

class ModerationRoutes {
	static Router;
	static #Controller;

	static {
		this.#Controller = new moderationCtrlr();
		this.Router = express.Router();
		this.#router();
	}

	static #router() {
		const authenticate = passport.authenticate('UsrJStrat', {
			session: false,
			failWithError: true
		});
		const admin = AuthzService.requireRole(AuthzService.ADMIN);

		// Proposals: any signed-in account files and sees its own; admins see all.
		this.Router.post(moderationEnd.post.create, authenticate, this.#Controller.create);
		this.Router.get(moderationEnd.get.many, authenticate, this.#Controller.getMany);
		this.Router.get(moderationEnd.get.one, authenticate, this.#Controller.getOne);
		this.Router.delete(moderationEnd.delete.remove, authenticate, this.#Controller.remove);

		this.Router.put(moderationEnd.put.update, authenticate, this.#Controller.update);

		// Review
		this.Router.put(moderationEnd.put.approve, authenticate, admin, this.#Controller.approve);
		this.Router.put(moderationEnd.put.reject, authenticate, admin, this.#Controller.reject);

		// Oversight
		this.Router.get(moderationEnd.get.audit, authenticate, admin, this.#Controller.audit);
		this.Router.get(moderationEnd.get.summary, authenticate, admin, this.#Controller.summary);
	}
}

export default ModerationRoutes;
