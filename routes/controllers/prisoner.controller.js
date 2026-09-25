import { Op } from 'sequelize';
import Prisoner from '#models/prisoner.model.js';
import RouteController from '#rtControllers/route.controller.js';
import { publishedWhere } from '#db/record-status.js';
import { watchPrisoner, afterPrisonerChange } from '#rtServices/prisoner-change.services.js';
import { readOptions, SORT_BY_CREATED, filterValues } from '#rtControllers/directory.helpers.js';
import AuthzService from '#rtServices/authz.services.js';
import { staleVerificationWhere } from '#db/record-status.js';
import { audit } from '#rtServices/audit.services.js';

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
		featured: { allowed: ['true', 'false'], transform: (v) => v === 'true' },
		stale: { allowed: ['true'], build: () => staleVerificationWhere() }
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
		this.filters = this.filters.bind(this);
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
	 * embeds the prison and support groups and, for admins listing by prison,
	 * each prisoner's chats.
	 */
	/**
	 * GET /prisoner/filters: the values the list pages build their filter chips
	 * from ([`country`, `status`]), each with a count, over the records the caller could list.
	 */
	async filters(req, res) {
		try {
			const { publishedOnly } = readOptions(req);
			const where = publishedOnly ? publishedWhere(true) : {};
			this.handleSuccess(res, await filterValues(Prisoner, ['country', 'status'], where));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.handleErr(res, errorVar);
		}
	}

	async getMany(req, res) {
		const { prison, full, page, page_size } = req.query;
		const limits = this.#handleLimits(page, page_size);
		const { publishedOnly, where, order } = readOptions(req, READ_CONFIG);
		if (req.query.addressInDoubt === 'true' && !publishedOnly) {
			// Staff only (ignored for everyone else, like recordStatus): that somebody's
			// mail came back is not for the public directory.
			where[Op.and] = [...(where[Op.and] || []), Prisoner.addressInDoubtWhere()];
		}
		const options = {
			full: full === 'true',
			limit: limits.limit,
			offset: limits.offset,
			publishedOnly,
			withChats: AuthzService.isAdmin(req),
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
			await audit(req, 'prisoner.create', 'prisoner', prisoner.id, { fields: req.body });
			this.#handleSuccess(res, prisoner);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/**
	 * A group admin links and unlinks their own active group only; a superadmin any.
	 * @throws {Error} 403
	 */
	async #ownGroupOnly(req, chapter) {
		if (AuthzService.isAdmin(req)) {
			return;
		}
		const own = await AuthzService.activeChapterOf(req);
		if (!own) {
			throw await AuthzService.groupRefusal(req);
		}
		if (String(chapter) !== String(own)) {
			throw AuthzService.forbidden('A group admin links their own group only; ask a superadmin.');
		}
	}

	/** PUT /prisoner/support { prisoner, chapter, description? }: link a support group. */
	async addSupport(req, res, next) {
		const { prisoner, chapter, description } = req.body;
		try {
			await this.#ownGroupOnly(req, chapter);
			const updated = await Prisoner.addSupport(prisoner, chapter, description);
			await audit(req, 'prisoner.support.add', 'prisoner', prisoner, { chapter, description });
			this.#handleSuccess(res, { prisoner: updated, chapter });
		} catch (err) {
			if (err && err.status === 403) {
				return next(err);
			}
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/** DELETE /prisoner/support { prisoner, chapter }: unlink a support group. */
	async removeSupport(req, res, next) {
		const { prisoner, chapter } = req.body;
		try {
			await this.#ownGroupOnly(req, chapter);
			const removed = await Prisoner.removeSupport(prisoner, chapter);
			this.requireAffected(
				removed,
				'Support link for prisoner ' + prisoner + ' and chapter ' + chapter
			);
			await audit(req, 'prisoner.support.remove', 'prisoner', prisoner, { chapter });
			this.#handleSuccess(res, removed);
		} catch (err) {
			if (err && err.status === 403) {
				return next(err);
			}
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Update

	async update(req, res) {
		const newPrisoner = req.body;
		try {
			const before = await watchPrisoner(newPrisoner.id);
			const updatedRows = await Prisoner.updatePrisoner(newPrisoner);
			this.requireAffected(updatedRows, 'Prisoner ' + newPrisoner.id);
			await audit(req, 'prisoner.update', 'prisoner', newPrisoner.id, { fields: newPrisoner });
			// Moved or freed: their writers are told, and queued letters re-routed or held.
			const mail = await afterPrisonerChange(req, before);
			const changed = mail && (mail.moved || mail.freed || mail.released > 0);
			this.#handleSuccess(res, { updatedRows, newPrisoner, ...(changed ? { mail } : {}) });
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
			this.requireAffected(deletedRows, 'Prisoner ' + id);
			await audit(req, 'prisoner.delete', 'prisoner', id);
			this.#handleSuccess(res, deletedRows);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
}
