import RouteController from '#rtControllers/route.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import Submission, { RESOURCES, REVIEWER_ONLY } from '#models/submission.model.js';
import AuditLog from '#models/audit-log.model.js';
import Prisoner from '#models/prisoner.model.js';
import Prison from '#models/prison.model.js';
import Chapter from '#models/chapter.model.js';
import ValidationError from '#services/ValidationError.js';
import { HttpError } from '#services/HttpError.js';
import { audit } from '#rtServices/audit.services.js';
import { backupStatus } from '#db/backup.js';
import { notify, membersOf } from '#rtServices/notify.services.js';
import BanRecommendation from '#models/ban-recommendation.model.js';
import User from '#models/user.model.js';
import { BAN_RECOMMENDATION_STATUSES } from '#schemas/ban-recommendation.schema.js';
import { watchPrisoner, afterPrisonerChange } from '#rtServices/prisoner-change.services.js';
import { SUBMISSION_RESOURCES, SUBMISSION_STATUSES } from '#schemas/submission.schema.js';
import { RECORD_STATUSES, staleVerificationWhere } from '#db/record-status.js';

/**
 * Moderation: proposed directory changes, their review, the audit log, and
 * the dashboard summary.
 *
 * Any signed-in account may propose; admins review. Submitters see and
 * withdraw their own proposals.
 */
export default class ModerationController extends RouteController {
	constructor() {
		/*
		 * If we use class methods as subfunctions (or callbacks)
		 * JS loses where we are and thinks this is is something
		 * other than the instance of our class
		 */
		super('moderation');
		this.create = this.create.bind(this);
		this.getMany = this.getMany.bind(this);
		this.getOne = this.getOne.bind(this);
		this.update = this.update.bind(this);
		this.approve = this.approve.bind(this);
		this.reject = this.reject.bind(this);
		this.remove = this.remove.bind(this);
		this.audit = this.audit.bind(this);
		this.summary = this.summary.bind(this);
		this.createBanRecommendation = this.createBanRecommendation.bind(this);
		this.banRecommendations = this.banRecommendations.bind(this);
		this.decideBanRecommendation = this.decideBanRecommendation.bind(this);

		this.#handleErr = super.handleErr;
		this.#handleSuccess = super.handleSuccess;
		this.#handleLimits = super.handleLimits;
	}

	#handleSuccess;
	#handleErr;
	#handleLimits;

	#fail(res, next, err) {
		if (err && err.status === 403) {
			return next(err);
		}
		const errorVar = !(err instanceof Error) ? new Error(err) : err;
		this.#handleErr(res, errorVar);
	}

	/** Tell the person who proposed it what was decided. (The reviewer's note stays in the submission.) */
	static async #announceDecision(req, submission) {
		await notify(
			[submission.submittedBy],
			{
				event: 'submission.decided',
				submission: submission.id,
				detail: { status: submission.status, resource: submission.resource }
			},
			{ actor: req.user.id }
		);
	}

	/**
	 * A submission as this caller may see it: non-admins never receive the
	 * reviewer-only fields a decision may have set.
	 */
	#present(req, submission, extra = {}) {
		const plain = { ...submission.toJSON(), ...extra };
		if (!AuthzService.isAdmin(req) && plain.appliedChanges) {
			plain.appliedChanges = { ...plain.appliedChanges };
			for (const field of REVIEWER_ONLY) {
				delete plain.appliedChanges[field];
			}
		}
		return plain;
	}

	/** Load a submission the caller may see (admin, or its submitter). */
	async #visible(req, id) {
		const submission = this.requireFound(await Submission.read(id), 'Submission ' + id);
		const own = String(submission.submittedBy) === String(req.user.id);
		if (!AuthzService.isAdmin(req) && !own) {
			throw AuthzService.forbidden();
		}
		return submission;
	}

	/**
	 * POST /moderation/submission { resource, target?, fields, evidence?, note? }
	 * Propose a new record (no target) or changes to one.
	 */
	async create(req, res, next) {
		const { resource, target, fields, evidence, note } = req.body;
		try {
			// A group proposes through its group: while it is pending or suspended it
			// reads what the public reads and writes nothing, proposals included.
			if (!AuthzService.isAdmin(req) && !(await AuthzService.activeChapterOf(req))) {
				throw await AuthzService.groupRefusal(req);
			}
			const submission = await Submission.propose({
				resource,
				target,
				fields,
				evidence,
				note,
				submittedBy: req.user.id,
				publishedOnly: AuthzService.publishedOnly(req)
			});
			await audit(req, 'submission.create', 'submission', submission.id, {
				resource,
				kind: submission.kind,
				targetId: submission.targetId
			});
			this.#handleSuccess(res, this.#present(req, await Submission.read(submission.id)));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * GET /moderation/submissions?status=&resource=&submittedBy=&page=&page_size=
	 * Admins see everything (default: pending); others see their own.
	 */
	async getMany(req, res, next) {
		const { status, resource, submittedBy, page, page_size } = req.query;
		const limits = this.#handleLimits(page, page_size);
		try {
			const where = {};
			// Empty query values (e.g. a blank form field) mean "no filter".
			const given = (v) => v !== undefined && v !== '';
			if (given(status) && status !== 'all') {
				if (!SUBMISSION_STATUSES.includes(status)) {
					throw new ValidationError({
						message: 'status must be one of ' + SUBMISSION_STATUSES.join(', ') + ', or all.',
						field: 'status',
						code: 'not_allowed_value',
						params: { allowed: [...SUBMISSION_STATUSES, 'all'] }
					});
				}
				where.status = status;
			} else if (!given(status) && AuthzService.isAdmin(req)) {
				where.status = 'pending';
			}
			if (given(resource)) {
				if (!SUBMISSION_RESOURCES.includes(resource)) {
					throw new ValidationError({
						message: 'resource must be one of ' + SUBMISSION_RESOURCES.join(', ') + '.',
						field: 'resource',
						code: 'not_allowed_value',
						params: { allowed: SUBMISSION_RESOURCES }
					});
				}
				where.resource = resource;
			}
			if (AuthzService.isAdmin(req)) {
				if (given(submittedBy)) {
					where.submittedBy = submittedBy;
				}
			} else {
				where.submittedBy = req.user.id;
			}
			const result = await Submission.list({ where, limit: limits.limit, offset: limits.offset });
			this.handlePage(
				res,
				{ rows: result.rows.map((s) => this.#present(req, s)), count: result.count },
				limits
			);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** GET /moderation/submission?id=: one proposal with the target's current values. */
	async getOne(req, res, next) {
		const { id } = req.query;
		try {
			const submission = await this.#visible(req, id);
			const current = await Submission.currentValues(submission, AuthzService.publishedOnly(req));
			this.#handleSuccess(res, this.#present(req, submission, { current }));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * PUT /moderation/submission { id, fields?, evidence?, note? }: the
	 * submitter (or an admin) revises a proposal that is still pending.
	 */
	async update(req, res, next) {
		const { id, fields, evidence, note } = req.body;
		try {
			const submission = await this.#visible(req, id);
			const result = await Submission.revise(submission, { fields, evidence, note });
			await audit(req, 'submission.update', 'submission', result.id, { resource: result.resource });
			this.#handleSuccess(res, this.#present(req, result));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** PUT /moderation/approve { id, fields?, decisionNote? } (admin). */
	async approve(req, res, next) {
		const { id, fields, decisionNote, ifUnchangedSince } = req.body;
		try {
			const submission = this.requireFound(await Submission.read(id), 'Submission ' + id);
			if (
				fields !== undefined &&
				(!fields || typeof fields !== 'object' || Array.isArray(fields))
			) {
				throw new ValidationError({
					message: 'fields must be an object of reviewer edits.',
					field: 'fields',
					code: 'wrong_type',
					params: { expected: 'object' }
				});
			}
			// An approved edit of a prisoner is an edit of a prisoner: the same follow-up
			// for their writers' mail as a direct one.
			const watched =
				submission.resource === 'prisoner' && submission.kind === 'update'
					? await watchPrisoner(submission.targetId)
					: null;
			const result = await Submission.approve(submission, {
				reviewer: req.user.id,
				fields,
				decisionNote,
				ifUnchangedSince
			});
			await audit(req, 'submission.approve', 'submission', result.id, {
				resource: result.resource,
				kind: result.kind,
				targetId: result.targetId,
				changes: result.appliedChanges
			});
			await audit(
				req,
				result.resource + '.' + (result.kind === 'create' ? 'create' : 'update'),
				result.resource,
				result.targetId,
				{
					viaSubmission: result.id,
					// On a create there is nothing to compare against, so the values are it.
					...(result.changesApplied
						? { changes: result.changesApplied }
						: { fields: result.appliedChanges })
				}
			);
			await afterPrisonerChange(req, watched);
			await ModerationController.#announceDecision(req, result);
			this.#handleSuccess(res, this.#present(req, result));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** PUT /moderation/reject { id, decisionNote } (admin). */
	async reject(req, res, next) {
		const { id, decisionNote } = req.body;
		try {
			const submission = this.requireFound(await Submission.read(id), 'Submission ' + id);
			if (submission.status !== 'pending') {
				throw new HttpError(
					409,
					'Submission ' + submission.id + ' is already ' + submission.status + '.',
					'SubmissionStateError'
				);
			}
			if (typeof decisionNote !== 'string' || decisionNote.trim() === '') {
				throw new ValidationError({
					message: 'decisionNote is required when rejecting.',
					field: 'decisionNote',
					code: 'required'
				});
			}
			const result = await Submission.reject(submission, {
				reviewer: req.user.id,
				decisionNote: decisionNote.trim()
			});
			await audit(req, 'submission.reject', 'submission', result.id, {
				resource: result.resource,
				decisionNote: result.decisionNote
			});
			await ModerationController.#announceDecision(req, result);
			this.#handleSuccess(res, this.#present(req, result));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** DELETE /moderation/submission { id }: withdraw (submitter or admin). */
	async remove(req, res, next) {
		const { id } = req.body;
		try {
			const submission = await this.#visible(req, id);
			const result = await Submission.withdraw(submission);
			await audit(req, 'submission.withdraw', 'submission', result.id, {
				resource: result.resource
			});
			this.#handleSuccess(res, this.#present(req, result));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** GET /moderation/audit?actor=&action=&resource=&target=&page=&page_size= (admin). */
	async audit(req, res, next) {
		const { actor, action, resource, target, page, page_size } = req.query;
		const limits = this.#handleLimits(page, page_size);
		try {
			const where = {};
			if (actor !== undefined) {
				where.actor = actor;
			}
			if (action !== undefined) {
				where.action = action;
			}
			if (resource !== undefined) {
				where.resource = resource;
			}
			if (target !== undefined) {
				where.targetId = target;
			}
			const result = await AuditLog.list({ where, limit: limits.limit, offset: limits.offset });
			this.handlePage(res, result, limits);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * GET /moderation/summary (admin): pending proposals per resource, records
	 * by recordStatus, and how many prisoners and prisons need re-verification.
	 */
	async summary(req, res, next) {
		try {
			const byStatus = async (Model) => {
				const out = Object.fromEntries(RECORD_STATUSES.map((s) => [s, 0]));
				const rows = await Model.findAll({
					attributes: [
						'recordStatus',
						[Model.sequelize.fn('COUNT', Model.sequelize.col('id')), 'n']
					],
					group: ['recordStatus'],
					raw: true
				});
				for (const row of rows) {
					out[row.recordStatus] = Number(row.n);
				}
				return out;
			};
			const summary = {
				pendingSubmissions: await Submission.pendingCounts(),
				// Groups asking for a writer to be blocked site-wide (GET /moderation/ban-recommendations).
				pendingBanRecommendations: await BanRecommendation.count({ where: { status: 'pending' } }),
				records: {
					prisoner: await byStatus(Prisoner),
					prison: await byStatus(Prison),
					chapter: await byStatus(Chapter)
				},
				groups: {
					pendingApproval: await Chapter.count({ where: { accountStatus: 'pending' } }),
					suspended: await Chapter.count({ where: { accountStatus: 'suspended' } })
				},
				staleVerification: {
					prisoner: await Prisoner.count({ where: staleVerificationWhere() }),
					prison: await Prison.count({ where: staleVerificationWhere() })
				},
				// Prisoners whose mail came back as transferred, released, or undeliverable,
				// and whose record nobody has touched since (GET /prisoner/prisoners?addressInDoubt=true).
				addressInDoubt: {
					prisoner: await Prisoner.count({ where: Prisoner.addressInDoubtWhere() })
				},
				// Is there a recent backup? (`configured`: BACKUP_PUBLIC_KEY is set.)
				backups: await backupStatus(),
				resources: Object.fromEntries(
					Object.entries(RESOURCES).map(([name, spec]) => [name, { submittable: spec.submittable }])
				)
			};
			this.#handleSuccess(res, summary);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	// Recommending a site-wide block (decided 30 September 2026)

	/**
	 * POST /moderation/ban-recommendation { user, reason }: a group admin of an
	 * active group asks the superadmins to block a writer everywhere. A group can
	 * only block a writer from its own letters (POST /chapter/block); this is how
	 * it asks for more. The reason is for the superadmin, not the writer.
	 */
	async createBanRecommendation(req, res, next) {
		const { user: userId, reason } = req.body;
		try {
			if (AuthzService.isAdmin(req)) {
				throw AuthzService.forbidden(
					"A superadmin bans a writer directly (role 'banned') rather than recommending it."
				);
			}
			const chapterId = await AuthzService.activeChapterOf(req);
			if (!chapterId) {
				throw await AuthzService.refusalFor(req);
			}
			const words = typeof reason === 'string' ? reason.trim() : '';
			if (words === '') {
				throw new ValidationError({
					message: 'Say why (reason): the superadmin who decides reads it.',
					field: 'reason',
					code: 'required'
				});
			}
			if (words.length > 1000) {
				throw new ValidationError({
					message: 'reason can be at most 1000 characters.',
					field: 'reason',
					code: 'length_out_of_range',
					params: { min: 1, max: 1000 }
				});
			}
			const writer = this.requireFound(await User.findByPk(userId), 'User ' + userId);
			if (writer.role !== 'user') {
				throw new ValidationError({
					message:
						writer.role === 'banned'
							? 'This account is banned already.'
							: 'Only a writer can be recommended for a ban.',
					field: 'user',
					code: 'not_eligible'
				});
			}
			const waiting = await BanRecommendation.findOne({
				where: { userId: writer.id, chapterId, status: 'pending' }
			});
			if (waiting) {
				const err = new HttpError(
					409,
					'Your group already recommended this, and it is waiting for a superadmin (recommendation ' +
						waiting.id +
						').',
					'BanRecommendationError'
				);
				err.condition = 'pending';
				throw err;
			}
			const made = await BanRecommendation.create({
				userId: writer.id,
				chapterId,
				recommendedBy: req.user.id,
				reason: words
			});
			await audit(req, 'user.ban-recommend', 'user', writer.id, {
				recommendation: made.id,
				chapter: chapterId,
				reason: words
			});
			const superadmins = await User.findAll({ where: { role: 'admin' }, attributes: ['id'] });
			await notify(
				superadmins.map((u) => u.id),
				{ event: 'ban.recommended', detail: { recommendation: made.id, user: writer.id } },
				{ actor: req.user.id }
			);
			this.handleSuccess(
				res,
				await BanRecommendation.findByPk(made.id, { include: BanRecommendation.includes() })
			);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * GET /moderation/ban-recommendations?status=: a superadmin sees every group's
	 * (pending by default); a group admin sees their own group's, in any state.
	 */
	async banRecommendations(req, res, next) {
		try {
			const { status } = req.query;
			const where = {};
			if (status !== undefined && status !== '') {
				if (!BAN_RECOMMENDATION_STATUSES.includes(status)) {
					throw new ValidationError({
						message: 'status must be one of ' + BAN_RECOMMENDATION_STATUSES.join(', ') + '.',
						field: 'status',
						code: 'not_allowed_value',
						params: { allowed: BAN_RECOMMENDATION_STATUSES }
					});
				}
				where.status = status;
			}
			if (AuthzService.isAdmin(req)) {
				where.status = where.status ?? 'pending';
			} else {
				const chapterId = await AuthzService.activeChapterOf(req);
				if (!chapterId) {
					throw await AuthzService.refusalFor(req);
				}
				where.chapterId = chapterId;
			}
			const rows = await BanRecommendation.findAll({
				where,
				include: BanRecommendation.includes(),
				order: [['id', 'DESC']]
			});
			this.handleSuccess(res, rows);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * PUT /moderation/ban-recommendation { id, decision, note? }: a superadmin
	 * decides. `ban` gives the writer the banned role, which ends every session at
	 * once, and settles every recommendation still waiting for them; `dismiss`
	 * settles this one. The recommending group is told.
	 */
	async decideBanRecommendation(req, res, next) {
		const { id, decision, note } = req.body;
		try {
			const recommendation = this.requireFound(
				await BanRecommendation.findByPk(id),
				'Recommendation ' + id
			);
			if (!['ban', 'dismiss'].includes(decision)) {
				throw new ValidationError({
					message: 'decision must be ban or dismiss.',
					field: 'decision',
					code: 'not_allowed_value',
					params: { allowed: ['ban', 'dismiss'] }
				});
			}
			if (note !== undefined && note !== null && typeof note !== 'string') {
				throw new ValidationError({
					message: 'note must be text.',
					field: 'note',
					code: 'wrong_type',
					params: { expected: 'text' }
				});
			}
			const words = typeof note === 'string' && note.trim() !== '' ? note.trim() : null;
			if (words && words.length > 500) {
				throw new ValidationError({
					message: 'note can be at most 500 characters.',
					field: 'note',
					code: 'length_out_of_range',
					params: { min: 0, max: 500 }
				});
			}
			if (recommendation.status !== 'pending') {
				const err = new HttpError(
					409,
					'Recommendation ' + id + ' was decided already (' + recommendation.status + ').',
					'BanRecommendationError'
				);
				err.condition = 'decided';
				throw err;
			}
			let settled;
			if (decision === 'ban') {
				settled = await BanRecommendation.ban(recommendation, {
					decidedBy: req.user.id,
					note: words
				});
				await audit(req, 'user.ban', 'user', recommendation.userId, {
					recommendations: settled,
					note: words
				});
			} else {
				await recommendation.update({
					status: 'dismissed',
					decidedBy: req.user.id,
					decidedAt: new Date(),
					decisionNote: words
				});
				settled = [recommendation.id];
				await audit(req, 'user.ban-recommend.dismiss', 'user', recommendation.userId, {
					recommendation: recommendation.id,
					note: words
				});
			}
			const decided = await BanRecommendation.findAll({ where: { id: settled } });
			for (const row of decided) {
				await notify(
					await membersOf(row.chapterId),
					{
						event: 'ban.decided',
						detail: { recommendation: row.id, user: row.userId, decision: row.status }
					},
					{ actor: req.user.id }
				);
			}
			this.handleSuccess(
				res,
				await BanRecommendation.findByPk(recommendation.id, {
					include: BanRecommendation.includes()
				})
			);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}
}
