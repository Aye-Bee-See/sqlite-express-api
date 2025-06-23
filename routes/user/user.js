import express from 'express';
import { default as bodyParser } from 'body-parser';
import { default as passport } from 'passport';
import { userEnd } from '#routes/constants.js';
import { default as userCrtlr } from '#rtControllers/user.controller.js';
import authService from '#rtServices/auth.services.js';
import multer from 'multer';
import fs from 'fs';

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

		const storage = multer.diskStorage({
			destination: function (req, file, cb) {
				const uploadPath = 'uploads/avatars/users/';
				if (!fs.existsSync(uploadPath)) {
					fs.mkdirSync(uploadPath, { recursive: true });
				}
				cb(null, uploadPath);
			},
			filename: function (req, file, cb) {
				cb(null, `${Date.now()}-${file.originalname}`);
			}
		});

		const upload = multer({ storage: storage });

		this.#Controller = new userCrtlr();
		this.Router = express.Router();

		this.#router(upload);
	}
	/***
	 *
	 *   Handle router params
	 *
	 ***/
	static #router(upload) {
		// Create - support form data with optional avatar upload during user creation
		this.Router.post(userEnd.post.create, upload.single('avatar'), this.#Controller.create);
		this.Router.post(userEnd.post.uploadAvi, upload.single('avatar'), this.#Controller.uploadAvi);

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

		// Update - support both JSON and form data
		this.Router.put(
			userEnd.put.update,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			upload.none(),
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
