import Prisoner from '#models/prisoner.model.js';
import RouteController from '#rtControllers/route.controller.js';
import { readOptions } from '#rtControllers/directory.helpers.js';

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

	/**
	 * List prisoners, optionally filtered to one prison with ?prison=<id>.
	 * Paginated with page and page_size; full=true embeds the prison and, for
	 * staff listing by prison, each prisoner's chats.
	 */
	async getMany(req, res) {
		const { prison, full, page, page_size } = req.query;
		const limits = this.#handleLimits(page, page_size);
		const { publishedOnly, where } = readOptions(req);
		const options = {
			full: full === 'true',
			limit: limits.limit,
			offset: limits.offset,
			publishedOnly
		};

		try {
			const result =
				prison !== undefined
					? await Prisoner.getPrisonersByPrison(prison, options)
					: await Prisoner.getAllPrisoners({ ...options, where });
			this.handlePage(res, result, limits);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// get one prisoner

	async getOne(req, res) {
		const { id, full } = req.query;
		const { publishedOnly } = readOptions(req);
		try {
			const prisoner = await Prisoner.getPrisonerByID(id, { full: full === 'true', publishedOnly });
			this.#handleSuccess(res, this.requireFound(prisoner, 'Prisoner ' + id));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
	// Create
	async create(req, res) {
		const { birthName, chosenName, prison, inmateID, releaseDate, bio, status, recordStatus } =
			req.body;
		try {
			const prisoner = await Prisoner.createPrisoner({
				birthName,
				chosenName,
				prison,
				inmateID,
				releaseDate,
				bio,
				status,
				recordStatus
			});
			this.#handleSuccess(res, prisoner);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Update

	async update(req, res) {
		const newPrisoner = req.body;
		try {
			const updatedRows = await Prisoner.updatePrisoner(newPrisoner);
			this.requireAffected(updatedRows, 'Prisoner ' + newPrisoner.id);
			this.#handleSuccess(res, { updatedRows, newPrisoner });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Delete
	async remove(req, res) {
		const { id } = req.body;
		try {
			const deletedRows = await Prisoner.deletePrisoner(id);
			this.#handleSuccess(res, this.requireAffected(deletedRows, 'Prisoner ' + id));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
}
