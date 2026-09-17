import Prison from '#models/prison.model.js';
import { Op, literal } from 'sequelize';
import RouteController from '#rtControllers/route.controller.js';
import { readOptions, SORT_BY_CREATED } from '#rtControllers/directory.helpers.js';
import { ROUTING_METHODS } from '#db/validators.js';
import {
	MAIL_RULES,
	MAIL_RULE_CATEGORIES,
	MAIL_RULE_CONFLICTS,
	MAIL_RULE_PARAMETERS,
	MAIL_RULE_TAGS
} from '#db/mail-rules.js';
import ValidationError from '#services/ValidationError.js';
import { staleVerificationWhere } from '#db/record-status.js';
import { audit } from '#rtServices/audit.services.js';

const READ_CONFIG = {
	searchFields: ['prisonName'],
	sorts: { name: [['prisonName', 'ASC']], ...SORT_BY_CREATED },
	filters: {
		country: {},
		routing: { allowed: ROUTING_METHODS },
		stale: { allowed: ['true'], build: () => staleVerificationWhere() },
		// mailRule=<tag>: facilities carrying that tag. The value is checked
		// against the vocabulary before it reaches the SQL.
		mailRule: {
			allowed: MAIL_RULE_TAGS,
			build: (tag) => ({
				id: {
					[Op.in]: literal(
						"(SELECT `Prisons`.`id` FROM `Prisons`, json_each(`Prisons`.`mailRules`) WHERE json_each.value = '" +
							tag +
							"')"
					)
				}
			})
		},
		// language=<code>: facilities that accept mail in it; no restriction counts.
		language: {
			build: (code) => {
				if (!/^[a-z]{2}$/.test(code)) {
					throw new ValidationError('language must be a two-letter ISO 639-1 code in lower case.');
				}
				return {
					id: {
						[Op.in]: literal(
							"(SELECT `Prisons`.`id` FROM `Prisons` WHERE `Prisons`.`mailLanguages` IS NULL OR json_array_length(`Prisons`.`mailLanguages`) = 0 OR EXISTS (SELECT 1 FROM json_each(`Prisons`.`mailLanguages`) WHERE json_each.value = '" +
								code +
								"'))"
						)
					}
				};
			}
		},
		// relay=true: at least one active relay group; relay=false: none.
		relay: {
			allowed: ['true', 'false'],
			build: (value) => ({
				id: {
					[value === 'true' ? Op.in : Op.notIn]: literal(
						"(SELECT `PrisonRelay`.`prison` FROM `PrisonRelay` JOIN `Chapters` ON `Chapters`.`id` = `PrisonRelay`.`chapter` WHERE `Chapters`.`accountStatus` = 'active')"
					)
				}
			})
		}
	}
};

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
		this.mailRules = this.mailRules.bind(this);
		this.addRelay = this.addRelay.bind(this);
		this.removeRelay = this.removeRelay.bind(this);

		this.#handleErr = super.handleErr;
		this.#handleSuccess = super.handleSuccess;
		this.#handleLimits = super.handleLimits;
	}

	#handleSuccess;
	#handleErr;
	#handleLimits;

	/** List prisons: page, page_size, full, q, sort, and (staff only) recordStatus. */
	async getMany(req, res) {
		const { full, page, page_size } = req.query;
		const limits = this.#handleLimits(page, page_size);
		const { publishedOnly, where, order } = readOptions(req, READ_CONFIG);
		try {
			const result = await Prison.getAllPrisons({
				full: full === 'true',
				limit: limits.limit,
				offset: limits.offset,
				publishedOnly,
				where,
				order
			});
			this.handlePage(res, result, limits);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/**
	 * GET /prison/mail-rules: the rule tags a facility may carry, grouped by
	 * category, with default English wording, and the typed limits beside them.
	 */
	mailRules(req, res) {
		this.#handleSuccess(res, {
			categories: MAIL_RULE_CATEGORIES,
			rules: MAIL_RULES,
			conflicts: MAIL_RULE_CONFLICTS,
			parameters: MAIL_RULE_PARAMETERS
		});
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
		try {
			const prison = await Prison.createPrison(req.body);
			await audit(req, 'prison.create', 'prison', prison.id, { fields: req.body });
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
			await audit(req, 'prison.update', 'prison', newPrison.id, { fields: newPrison });
			this.#handleSuccess(res, { updatedRows, newPrison });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/** PUT /prison/relay { prison, chapter }: attach a relay group. */
	async addRelay(req, res) {
		const { chapter, prison } = req.body;
		try {
			const updatedRows = await Prison.addRelay(chapter, prison);
			await audit(req, 'prison.relay.add', 'prison', prison, { chapter });
			this.#handleSuccess(res, { updatedRows, chapter, prison });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/** DELETE /prison/relay { prison, chapter }: detach a relay group. */
	async removeRelay(req, res) {
		const { chapter, prison } = req.body;
		try {
			const removed = await Prison.removeRelay(chapter, prison);
			this.requireAffected(removed, 'Relay link for prison ' + prison + ' and chapter ' + chapter);
			await audit(req, 'prison.relay.remove', 'prison', prison, { chapter });
			this.#handleSuccess(res, removed);
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
			this.requireAffected(deletedRows, 'Prison ' + id);
			await audit(req, 'prison.delete', 'prison', id);
			this.#handleSuccess(res, deletedRows);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
}
