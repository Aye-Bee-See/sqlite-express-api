import Prisoner from '#models/prisoner.model.mjs';
import { default as jwt } from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisonerMsg } from '#routes/constants.js';
import { default as Utls } from '#services/Utilities.js';
import RouteController from '#rtControllers/route.controller.js';

export default class PrisonerController extends RouteController {
	constructor() {
		/*
		 * If we use class methods as subfunctions (or callbacks)
		 * JS loses where we are and thinks this is is something
		 * other than the instance of our class
		 */
		super('prisoner');
		this.getMany = this.getMany.bind(this);
		this.getOne = this.getOne.bind(this);
		this.update = this.update.bind(this);
		this.remove = this.remove.bind(this);
		this.create = this.create.bind(this);

		this.#handleErr = super.handleErr;
		this.#handleSuccess = super.handleSuccess;
		this.#handleLimits = super.handleLimits;
	}

	#handleSuccess;
	#handleErr;
	#handleLimits;

	async getMany(req, res, next) {
		const { prison, full, page, page_size } = req.query;
		const { limit, offset } = this.#handleLimits(page, page_size);
		const fullBool = full === 'true';

		//const {prison, limit, offset} = req.query;
		if (prison) {
			this.getListByPrison(req, res);
		} else {
			try {
				const rules = await Prisoner.getAllPrisoners(fullBool, limit, offset);
				this.#handleSuccess(res, rules);
			} catch (err) {
				err = !(err instanceof Error) ? new Error(err) : err;
				this.#handleErr(res, err);
			}
		}
	}

	async getListByPrison(req, res) {
		const { prison, full, page, page_size } = req.query;
		const limit = page_size || 10;
		const list_start = page - 1 || 0;
		const offset = list_start * limit;
		const fullBool = full === 'true';
		try {
			const prisoner = await Prisoner.getPrisonersByPrison(fullBool, prison, limit, offset);
			this.#handleSuccess(res, prisoner);
		} catch (err) {
			err = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, err);
		}
	}

	// get one prisoner

	async getOne(req, res) {
		const { id, full } = req.query;
		const fullBool = full === 'true';
		try {
			const prisoner = await Prisoner.getPrisonerByID(id, fullBool);
			this.#handleSuccess(res, prisoner);
		} catch (err) {
			err = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, err);
		}
	}
	// Create
	async create(req, res) {
		const { birthName, chosenName, prison, inmateID, releaseDate, bio, status } = req.body;
		try {
			const prisoner = await Prisoner.createPrisoner({
				birthName,
				chosenName,
				prison,
				inmateID,
				releaseDate,
				bio,
				status
			});
			this.#handleSuccess(res, prisoner);
			// res.status(200).json({msg: ruleMsg.post.create.success.condition.par, rule});
		} catch (err) {
			err = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, err);
		}
	}

	// Update

	async update(req, res) {
		const newPrisoner = req.body;
		try {
			const updatedRows = await Prisoner.updatePrisoner(newPrisoner);
			this.#handleSuccess(res, { updatedRows, newPrisoner });
		} catch (err) {
			err = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, err);
		}
	}

	// Delete
	async remove(req, res) {
		const { id } = req.body;
		try {
			const deletedRows = await Prisoner.deletePrisoner(id);
			this.#handleSuccess(res, deletedRows);
		} catch (err) {
			err = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, err);
		}
	}
}
