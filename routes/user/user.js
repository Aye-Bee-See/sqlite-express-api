import express from 'express';
import { default as bodyParser } from 'body-parser';
import { default as passport } from 'passport';
import { userEnd } from '#routes/constants.js';
import { default as userCrtlr } from '#rtControllers/user.controller.js';
import authService from '#rtServices/auth.services.js';
import AuthzService from '#rtServices/authz.services.js';

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
		const app = express();
		app.use(bodyParser.json());
		app.use(bodyParser.urlencoded({ extended: true }));
		app.use(passport.initialize());

		const UserJWTStrat = authService.authorize;
		const LoginStrat = authService.login;
		passport.use('UsrJStrat', UserJWTStrat);
		passport.use('LStrat', LoginStrat);

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
			passport.authenticate('LStrat', { session: false, authInfo: true, failWithError: true }),
			this.#Controller.login
		);

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
