import express from 'express';
import { default as passport } from 'passport';
import { twoFactorEnd } from '#routes/constants.js';
import TwoFactorController from '#rtControllers/two-factor.controller.js';
import { limiters } from '#rtServices/ratelimit.services.js';

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
		this.Router.delete(
			twoFactorEnd.delete.remove,
			signedIn,
			limiters.twoFactorManage,
			this.#Controller.remove
		);
	}
}

export default TwoFactorRoutes;
