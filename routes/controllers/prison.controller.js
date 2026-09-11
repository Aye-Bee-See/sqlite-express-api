import Prison from '#models/prison.model.js';
import RouteController from '#rtControllers/route.controller.js';
import { readOptions } from '#rtControllers/directory.helpers.js';

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
		this.addRule = this.addRule.bind(this);

		this.#handleErr = super.handleErr;
		this.#handleSuccess = super.handleSuccess;
		this.#handleLimits = super.handleLimits;
	}

	#handleSuccess;
	#handleErr;
	#handleLimits;

	/** List prisons: page, page_size, full, and (staff only) recordStatus. */
	async getMany(req, res) {
		const { full, page, page_size } = req.query;
		const limits = this.#handleLimits(page, page_size);
		const { publishedOnly, where } = readOptions(req);
		try {
			const result = await Prison.getAllPrisons({
				full: full === 'true',
				limit: limits.limit,
				offset: limits.offset,
				publishedOnly,
				where
			});
			this.handlePage(res, result, limits);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// get one prison

	async getOne(req, res) {
		const { id, full } = req.query;
		const { publishedOnly } = readOptions(req);
		try {
			const prison = await Prison.getPrisonByID(id, { full: full === 'true', publishedOnly });
			this.#handleSuccess(res, this.requireFound(prison, 'Prison ' + id));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
	// Create
	async create(req, res) {
		const { prisonName, address, recordStatus } = req.body;
		try {
			const prison = await Prison.createPrison({ prisonName, address, recordStatus });
			this.#handleSuccess(res, prison);
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
			this.requireAffected(updatedRows, 'Prison ' + newPrison.id);
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

	async remove(req, res) {
		const { id } = req.body;
		try {
			const deletedRows = await Prison.deletePrison(id);
			this.#handleSuccess(res, this.requireAffected(deletedRows, 'Prison ' + id));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
}
