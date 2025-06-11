import express, { Router as router } from 'express';
import { default as bodyParser } from 'body-parser';
import { default as passport } from 'passport';
import { userEnd } from '#routes/constants.js';
import { default as userCrtlr } from '#rtControllers/user.controller.mjs';
import authService from '#rtServices/auth.services.mjs';

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
		// Create
		this.Router.post(userEnd.post.create, this.#Controller.create);

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
			this.#Controller.getMany
		);
		this.Router.get(
			userEnd.get.one,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.getOne
		);

		// Update
		this.Router.put(
			userEnd.put.update,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.update
		);

		// Delete
		this.Router.delete(
			userEnd.delete.remove,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.remove
		);
	}
}

export default UserRoutes;
