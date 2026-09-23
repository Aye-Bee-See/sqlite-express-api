import express from 'express';
import { default as passport } from 'passport';
import { keysEnd } from '#routes/constants.js';
import { default as keysCtrlr } from '#rtControllers/keys.controller.js';
import { limiters } from '#rtServices/ratelimit.services.js';
import AuthzService from '#rtServices/authz.services.js';
import { default as bodyParser } from 'body-parser';
import { singleIds } from '#rtServices/request-shape.services.js';
import { rotationMaxBytes } from '#constants';

/** Where a rotation is posted, as the app sees it: app.js leaves its body for this router to parse. */
export const ROTATION_PATH = '/auth' + keysEnd.post.rotate;

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

		// Group keys: for admins and the accounts of groups that are active members of the
		// network. A pending or suspended group sets up and changes nothing.
		const activeStaff = AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER);
		this.Router.put(
			keysEnd.put.chapterKeys,
			authenticate,
			activeStaff,
			this.#Controller.chapterKeys
		);
		this.Router.put(
			keysEnd.put.putMemberKey,
			authenticate,
			activeStaff,
			this.#Controller.putMemberKey
		);
		this.Router.put(
			keysEnd.put.chapterOwner,
			authenticate,
			activeStaff,
			this.#Controller.chapterOwner
		);
		this.Router.delete(keysEnd.delete.remove, authenticate, activeStaff, this.#Controller.remove);
		this.Router.get(keysEnd.get.many, authenticate, activeStaff, this.#Controller.getMany);
		this.Router.get(
			keysEnd.get.rotationMaterial,
			authenticate,
			activeStaff,
			this.#Controller.rotationMaterial
		);
		this.Router.post(
			keysEnd.post.rotate,
			authenticate,
			activeStaff,
			// A rotation carries every envelope of the group: too large for the app-wide
			// parser (which skips this path), and only read for a caller who may rotate.
			bodyParser.json({ limit: rotationMaxBytes }),
			singleIds,
			this.#Controller.rotate
		);

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
