import express from 'express';
import { default as bodyParser } from 'body-parser';
import { default as passport } from 'passport';
import { prisonerEnd } from '#routes/constants.js';
import { default as prisonerCrtlr } from '#rtControllers/prisoner.controller.js';
import authService from '#rtServices/auth.services.js';
import multer from 'multer';
import path from 'path';

const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		cb(null, 'uploads/avatars/prisoners/');
	},
	filename: (req, file, cb) => {
		cb(null, Date.now() + path.extname(file.originalname));
	}
});

const upload = multer({ storage: storage });

class PrisonerRoutes {
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

		const JwtStrat = authService.authorize;
		passport.use('UsrJStrat', JwtStrat);

		this.#Controller = new prisonerCrtlr();
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

		this.Router.post(
			prisonerEnd.post.create,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			upload.single('avatar'),
			this.#Controller.create
		);

		this.Router.post(
			prisonerEnd.post.uploadAvi,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			upload.single('avatar'),
			this.#Controller.uploadAvi
		);

		// Read

		this.Router.get(
			prisonerEnd.get.many,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.getMany
		);

		this.Router.get(
			prisonerEnd.get.one,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.getOne
		);

		// Update

		this.Router.put(
			prisonerEnd.put.update,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.update
		);

		// Delete

		this.Router.delete(
			prisonerEnd.delete.remove,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.remove
		);
	}
}

export default PrisonerRoutes;
