import express from 'express';
import { default as passport } from 'passport';
import { twoFactorEnd } from '#routes/constants.js';
import TwoFactorController from '#rtControllers/two-factor.controller.js';
import { limiters } from '#rtServices/ratelimit.services.js';
import AuthzService from '#rtServices/authz.services.js';

/** Two-factor sign-in for one's own account, mounted under /auth. */
class TwoFactorRoutes {
	static Router;
	static #Controller;

	static {
		this.#Controller = new TwoFactorController();
		this.Router = express.Router();
		this.#router();
	}

	static #router() {
		const signedIn = passport.authenticate('UsrJStrat', { session: false, failWithError: true });
		this.Router.get(twoFactorEnd.get.one, signedIn, this.#Controller.getOne);
		this.Router.post(twoFactorEnd.post.setup, signedIn, this.#Controller.setup);
		// A code is asked for here: counted like failed sign-ins, per account.
		this.Router.post(
			twoFactorEnd.post.confirm,
			signedIn,
			limiters.twoFactorManage,
			this.#Controller.confirm
		);
		this.Router.post(
			twoFactorEnd.post.recoveryCodes,
			signedIn,
			limiters.twoFactorManage,
			this.#Controller.recoveryCodes
		);
		// Requiring it, and resetting it for a lost phone: superadmins.
		const superadmin = [signedIn, AuthzService.requireRole(AuthzService.ADMIN)];
		this.Router.get(twoFactorEnd.get.policy, ...superadmin, this.#Controller.policy);
		this.Router.put(twoFactorEnd.put.setPolicy, ...superadmin, this.#Controller.setPolicy);
		this.Router.put(twoFactorEnd.put.setGroup, ...superadmin, this.#Controller.setGroup);
		this.Router.delete(twoFactorEnd.delete.resetUser, ...superadmin, this.#Controller.resetUser);
		this.Router.delete(
			twoFactorEnd.delete.remove,
			signedIn,
			limiters.twoFactorManage,
			this.#Controller.remove
		);
	}
}

export default TwoFactorRoutes;
