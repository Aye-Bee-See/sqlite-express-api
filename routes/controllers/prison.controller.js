import Prison from '#models/prison.model.js';
//import { default as jwt } from 'jsonwebtoken';
//import bcrypt from 'bcrypt';
//import { prisonMsg } from '#routes/constants.js';
//import { default as Utls } from '#services/Utilities.js';
import RouteController from '#rtControllers/route.controller.js';

export default class PrisonController extends RouteController {
	constructor() {
		/*
		 * If we use class methods as subfunctions (or callbacks)
		 * JS loses where we are and thinks this is is something
		 * other than the instance of our class
		 */
		super('prison');
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
	async getMany(req, res) {
		const { full, page, page_size } = req.query;
		const { limit, offset } = this.#handleLimits(page, page_size);
		const fullBool = full === 'true';

		// const {limit, offset} = req.query;
		try {
			const prisons = await Prison.getAllPrisons(fullBool, limit, offset);
			this.#handleSuccess(res, prisons);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// get one prison

	async getOne(req, res) {
		const { id, full } = req.query;
		const fullBool = full === 'true';
		try {
			const prison = await Prison.getPrisonByID(id, fullBool);
			this.#handleSuccess(res, prison);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
	// Create
	async create(req, res) {
		const { prisonName, address } = req.body;
		try {
			const prison = await Prison.createPrison({ prisonName, address });
			this.#handleSuccess(res, prison);
			// res.status(200).json({msg: ruleMsg.post.create.success.condition.par, rule});
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Update

	async update(req, res) {
		const newPrison = req.body;
		try {
			const updatedRows = await Prison.updatePrison(newPrison);
			this.#handleSuccess(res, { updatedRows, newPrison });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	async addRule(req, res) {
		const { rule, prison } = req.body;

		try {
			const updatedRows = await Prison.addRule(rule, prison);
			this.#handleSuccess(res, { updatedRows, rule, prison });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Delete
	// async remove(req, res)
	// {
	//     const {id} = req.body;
	//     try {
	//         const deletedRows = await Prisoner.deletePrisoner(id);
	//         this.#handleSuccess(res, deletedRows);
	//     } catch (err) {
	//         err = !(err instanceof Error) ? new Error(err) : err;
	//         this.#handleErr(res, err);
	//     }
	// }

	async remove(req, res) {
		const { id } = req.body;
		try {
			const deletedRows = await Prison.deletePrison(id);
			this.#handleSuccess(res, deletedRows);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
}
