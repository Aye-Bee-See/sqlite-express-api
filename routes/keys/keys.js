import express from 'express';
import { default as passport } from 'passport';
import { keysEnd } from '#routes/constants.js';
import { default as keysCtrlr } from '#rtControllers/keys.controller.js';
import { limiters } from '#rtServices/ratelimit.services.js';
import AuthzService from '#rtServices/authz.services.js';

/** Key material routes, mounted under /auth beside the user routes. */
class KeysRoutes {
	static Router;
	static #Controller;

	static {
		this.#Controller = new keysCtrlr();
		this.Router = express.Router();
		this.#router();
	}

	static #router() {
		const authenticate = passport.authenticate('UsrJStrat', {
			session: false,
			failWithError: true
		});

		this.Router.get(keysEnd.get.one, authenticate, this.#Controller.getOne);
		this.Router.put(keysEnd.put.update, authenticate, this.#Controller.update);
		this.Router.get(keysEnd.get.publicKey, authenticate, this.#Controller.publicKey);

		// Recovery is public: the recovery code is the credential.
		this.Router.get(
			keysEnd.get.recoverChallenge,
			limiters.recoverStart,
			this.#Controller.recoverChallenge
		);
		this.Router.post(keysEnd.post.create, limiters.recoverFinish, this.#Controller.create);

		// Group keys
		this.Router.put(keysEnd.put.chapterKeys, authenticate, this.#Controller.chapterKeys);
		this.Router.put(keysEnd.put.putMemberKey, authenticate, this.#Controller.putMemberKey);
		this.Router.delete(keysEnd.delete.remove, authenticate, this.#Controller.remove);
		this.Router.get(keysEnd.get.many, authenticate, this.#Controller.getMany);
		this.Router.get(keysEnd.get.rotationMaterial, authenticate, this.#Controller.rotationMaterial);
		this.Router.post(keysEnd.post.rotate, authenticate, this.#Controller.rotate);

		// Who still has to set up keys before (or after) the switch to e2e.
		this.Router.get(
			keysEnd.get.readiness,
			authenticate,
			AuthzService.requireRole(AuthzService.ADMIN),
			this.#Controller.readiness
		);
	}
}

export default KeysRoutes;
