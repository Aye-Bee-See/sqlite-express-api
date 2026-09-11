import Prisoner from '#models/prisoner.model.js';
import RouteController from '#rtControllers/route.controller.js';
import { readOptions, SORT_BY_CREATED } from '#rtControllers/directory.helpers.js';

const READ_CONFIG = {
	searchFields: ['birthName', 'chosenName'],
	sorts: {
		name: [
			['chosenName', 'ASC'],
			['birthName', 'ASC']
		],
		...SORT_BY_CREATED
	},
	filters: {
		status: { allowed: ['pretrial', 'incarcerated', 'free'] },
		country: {},
		featured: { allowed: ['true', 'false'], transform: (v) => v === 'true' }
	}
};

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
		this.addSupport = this.addSupport.bind(this);
		this.removeSupport = this.removeSupport.bind(this);

		this.#handleErr = super.handleErr;
		this.#handleSuccess = super.handleSuccess;
		this.#handleLimits = super.handleLimits;
	}

	#handleSuccess;
	#handleErr;
	#handleLimits;

	/**
	 * List prisoners: page, page_size, full, q (name search), sort, status,
	 * prison (limit to one prison), and (staff only) recordStatus. full=true
	 * embeds the prison and, for staff listing by prison, each prisoner's chats.
	 */
	async getMany(req, res) {
		const { prison, full, page, page_size } = req.query;
		const limits = this.#handleLimits(page, page_size);
		const { publishedOnly, where, order } = readOptions(req, READ_CONFIG);
		const options = {
			full: full === 'true',
			limit: limits.limit,
			offset: limits.offset,
			publishedOnly,
			where,
			order
		};

		try {
			const result =
				prison !== undefined
					? await Prisoner.getPrisonersByPrison(prison, options)
					: await Prisoner.getAllPrisoners(options);
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
		try {
			const prisoner = await Prisoner.createPrisoner(req.body);
			this.#handleSuccess(res, prisoner);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/** PUT /prisoner/support { prisoner, chapter, description? }: link a support group. */
	async addSupport(req, res) {
		const { prisoner, chapter, description } = req.body;
		try {
			const updated = await Prisoner.addSupport(prisoner, chapter, description);
			this.#handleSuccess(res, { prisoner: updated, chapter });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/** DELETE /prisoner/support { prisoner, chapter }: unlink a support group. */
	async removeSupport(req, res) {
		const { prisoner, chapter } = req.body;
		try {
			const removed = await Prisoner.removeSupport(prisoner, chapter);
			this.#handleSuccess(
				res,
				this.requireAffected(
					removed,
					'Support link for prisoner ' + prisoner + ' and chapter ' + chapter
				)
			);
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
