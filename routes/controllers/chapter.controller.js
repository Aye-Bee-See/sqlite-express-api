import RouteController from '#rtControllers/route.controller.js';
import Chapter, { CHAPTER_FIELDS } from '#models/chapter.model.js';
import { Op, literal } from 'sequelize';
import { readOptions, SORT_BY_CREATED } from '#rtControllers/directory.helpers.js';
import { ACCOUNT_STATUSES, CHAPTER_SERVICES } from '#db/validators.js';
import AuthzService from '#rtServices/authz.services.js';
import { audit } from '#rtServices/audit.services.js';
import AuditLog from '#models/audit-log.model.js';
import { changesBetween } from '#services/record-changes.js';
import GroupBlock from '#models/group-block.model.js';
import User from '#models/user.model.js';
import ValidationError from '#services/ValidationError.js';
import { notify, membersOf } from '#rtServices/notify.services.js';

/** What another group may read of a group's history: edits to its directory record. */
const DIRECTORY_ACTIONS = ['chapter.create', 'chapter.update', 'chapter.delete'];

const READ_CONFIG = {
	table: 'Chapter',
	searchFields: ['name'],
	sorts: { name: [['name', 'ASC']], ...SORT_BY_CREATED },
	filters: {
		country: {},
		// `both` groups match either role.
		networkRole: {
			allowed: ['collecting', 'relay'],
			build: (value) => ({ [Op.and]: [{ networkRole: { [Op.in]: [value, 'both'] } }] })
		},
		accountStatus: { allowed: ACCOUNT_STATUSES },
		// services is a JSON array stored as text; Sequelize would JSON-encode a
		// LIKE value on a JSON column, so match the quoted element with raw SQL.
		// The value is validated against CHAPTER_SERVICES (word characters only).
		service: {
			allowed: CHAPTER_SERVICES,
			build: (value) => ({
				[Op.and]: [literal('`Chapter`.`services` LIKE \'%"' + value + '"%\'')]
			})
		}
	}
};

/**
 * What a superadmin decides about a group, never the group itself: whether it
 * is in the network, who vouched for it, and whether its record is public.
 * (An invitation names the voucher at acceptance; a group could otherwise
 * choose its own afterwards. #189)
 */
const ADMIN_ONLY = {
	accountStatus: "Only an admin can set a group's account status.",
	vouchedBy: 'Only an admin can say which group vouched for a group.',
	recordStatus: "Only an admin can set a group's record status."
};

/** Group key state: written only by the key endpoints under /auth. */
const KEY_STATE = ['publicKey', 'keyVersion', 'keyRotatedAt'];
const KEY_STATE_REFUSAL =
	'Group keys are set through PUT /auth/chapter-keys and changed through POST /auth/chapter-rotation.';

export default class chapterController extends RouteController {
	constructor() {
		/*
		 * If we use class methods as subfunctions (or callbacks)
		 * JS loses where we are and thinks this is is something
		 * other than the instance of our class
		 */
		super('chapter');
		this.create = this.create.bind(this);
		this.getMany = this.getMany.bind(this);
		this.history = this.history.bind(this);
		this.getOne = this.getOne.bind(this);
		this.update = this.update.bind(this);
		this.remove = this.remove.bind(this);
		this.blocks = this.blocks.bind(this);
		this.block = this.block.bind(this);
		this.unblock = this.unblock.bind(this);

		this.#handleSuccess = super.handleSuccess;
		this.#handleErr = super.handleErr;
		this.#handleLimits = super.handleLimits;
	}

	#handleSuccess;
	#handleErr;
	#handleLimits;

	async create(req, res, next) {
		if (KEY_STATE.some((f) => req.body[f] !== undefined)) {
			return next(AuthzService.forbidden(KEY_STATE_REFUSAL));
		}
		const adminOnly = chapterController.#adminOnlyRefusal(req, req.body, null);
		if (adminOnly) {
			return next(adminOnly);
		}
		try {
			const chapter = await Chapter.createChapter(req.body);
			await audit(req, 'chapter.create', 'chapter', chapter.id, { fields: req.body });
			this.#handleSuccess(res, chapter);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	async getOne(req, res) {
		const { id, full } = req.query;
		const { publishedOnly } = readOptions(req);
		try {
			const chapter = await Chapter.getChapterByID(id, { full: full === 'true', publishedOnly });
			this.#handleSuccess(res, this.requireFound(chapter, 'Chapter ' + id));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/** List chapters: page, page_size, full, q, sort, country, service, and (staff only) recordStatus. */
	/**
	 * GET /chapter/history?id=: what has happened to one record, newest first.
	 * Staff only: it names the people who made each change and can carry
	 * staff-only field values. Paginated like any list.
	 *
	 * A group is a directory record and also an organisation. Another group
	 * sees its directory edits, as it sees a prison's; who holds the group's
	 * key, who owns it, and its invite codes are the group's own business, and
	 * only its members and a superadmin see those.
	 */
	async history(req, res) {
		try {
			const { id, page, page_size } = req.query;
			const record = this.requireFound(await Chapter.findByPk(id), 'Chapter ' + id);
			const limits = this.handleLimits(page, page_size);
			const own =
				AuthzService.isAdmin(req) ||
				String(await AuthzService.activeChapterOf(req)) === String(record.id);
			const rows = await AuditLog.forRecord('chapter', record.id, {
				limit: limits.limit,
				offset: limits.offset,
				actions: own ? null : DIRECTORY_ACTIONS
			});
			this.handlePage(
				res,
				{ rows: rows.rows.map((row) => AuditLog.asHistory(row)), count: rows.count },
				limits
			);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.handleErr(res, errorVar);
		}
	}

	async getMany(req, res) {
		const { page, page_size, full } = req.query;
		const limits = this.#handleLimits(page, page_size);
		const { publishedOnly, where, order } = readOptions(req, READ_CONFIG);
		try {
			const result = await Chapter.getAllChapters({
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

	/** Non-admins may only change or delete the group they belong to. */
	/**
	 * A non-admin may not set an ADMIN_ONLY field. On an update, sending back the
	 * value already stored is not setting it (a client that saves the whole record).
	 * @returns {Error|null} the 403, or null
	 */
	static #adminOnlyRefusal(req, fields, stored) {
		if (AuthzService.isAdmin(req)) {
			return null;
		}
		for (const [field, refusal] of Object.entries(ADMIN_ONLY)) {
			if (fields[field] === undefined) {
				continue;
			}
			if (stored && String(fields[field] ?? '') === String(stored[field] ?? '')) {
				continue;
			}
			return AuthzService.forbidden(refusal);
		}
		return null;
	}

	#ownGroupOnly(req, id) {
		if (AuthzService.isAdmin(req) || String(AuthzService.chapterOf(req)) === String(id)) {
			return null;
		}
		return AuthzService.forbidden('A group may only edit its own record.');
	}

	async update(req, res, next) {
		const newChapter = req.body;
		if (KEY_STATE.some((f) => newChapter[f] !== undefined)) {
			return next(AuthzService.forbidden(KEY_STATE_REFUSAL));
		}
		try {
			const was = await Chapter.findByPk(newChapter.id);
			const refusal =
				chapterController.#adminOnlyRefusal(req, newChapter, was) ||
				this.#ownGroupOnly(req, newChapter.id);
			if (refusal) {
				return next(refusal);
			}
			// What a group sent of ADMIN_ONLY is what was stored when it was read; it
			// is not written, so it cannot put back a value an admin has changed since.
			const fields = AuthzService.isAdmin(req)
				? newChapter
				: Object.fromEntries(
						Object.entries(newChapter).filter(([field]) => !(field in ADMIN_ONLY))
					);
			const updatedRows = await Chapter.updateChapter(fields);
			this.requireAffected(updatedRows, 'Chapter ' + newChapter.id);
			await audit(req, 'chapter.update', 'chapter', newChapter.id, {
				changes: changesBetween(was, fields, CHAPTER_FIELDS)
			});
			this.#handleSuccess(res, { updatedRows, newChapter });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	async remove(req, res, next) {
		const { id } = req.body;
		const refusal = this.#ownGroupOnly(req, id);
		if (refusal) {
			return next(refusal);
		}
		try {
			const deletedRows = await Chapter.deleteChapter(id);
			this.requireAffected(deletedRows, 'Chapter ' + id);
			await audit(req, 'chapter.delete', 'chapter', id);
			this.#handleSuccess(res, deletedRows);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Blocking a writer (decided 30 September 2026)

	/**
	 * The group whose blocks this caller manages: their own active group, or for
	 * a superadmin the one named. A superadmin may list and lift blocks, but
	 * blocks nobody from a group; stopping an account everywhere is the ban.
	 * @throws {Error} 403, or 400 when a superadmin names no group
	 */
	async #blockingGroup(req, named, { superadminMay }) {
		if (AuthzService.isAdmin(req)) {
			if (!superadminMay) {
				throw AuthzService.forbidden(
					"A group blocks a writer from its own letters; a superadmin stops an account everywhere by banning it (role 'banned')."
				);
			}
			if (named === undefined || named === null || named === '') {
				throw new ValidationError({
					message: 'Name the group (chapter).',
					field: 'chapter',
					code: 'required'
				});
			}
			return this.requireFound(await Chapter.findByPk(named), 'Chapter ' + named).id;
		}
		const own = await AuthzService.activeChapterOf(req);
		if (!own) {
			throw await AuthzService.refusalFor(req);
		}
		if (named !== undefined && named !== null && named !== '' && String(named) !== String(own)) {
			throw AuthzService.forbidden('A group admin manages the blocks of their own group only.');
		}
		return own;
	}

	/** GET /chapter/blocks?chapter=: the writers this group will not mail letters for. */
	async blocks(req, res) {
		try {
			const chapterId = await this.#blockingGroup(req, req.query.chapter, { superadminMay: true });
			const rows = await GroupBlock.findAll({
				where: { chapterId },
				include: [
					{ association: 'writer', attributes: ['id', 'penName', 'name'] },
					{ association: 'blocked_by', attributes: ['id', 'username', 'name'] }
				],
				order: [['id', 'DESC']]
			});
			this.#handleSuccess(
				res,
				rows.map((row) => ({
					chapter: row.chapterId,
					writer: row.writer,
					reason: row.reason,
					blockedBy: row.blocked_by,
					blockedAt: row.createdAt
				}))
			);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.handleErr(res, errorVar);
		}
	}

	/**
	 * POST /chapter/block { user, reason }: this group will not mail letters from
	 * this writer. Their letters waiting in its queue are held; they are told, with
	 * the reason, and so is every group admin of the group. Blocking again
	 * replaces the reason.
	 */
	async block(req, res) {
		const { user: userId, reason } = req.body;
		try {
			const chapterId = await this.#blockingGroup(req, req.body.chapter, { superadminMay: false });
			const words = typeof reason === 'string' ? reason.trim() : '';
			if (words === '') {
				throw new ValidationError({
					message: 'Say why (reason): the writer and your group are told.',
					field: 'reason',
					code: 'required'
				});
			}
			if (words.length > 500) {
				throw new ValidationError({
					message: 'reason can be at most 500 characters.',
					field: 'reason',
					code: 'length_out_of_range',
					params: { min: 1, max: 500 }
				});
			}
			const writer = this.requireFound(await User.findByPk(userId), 'User ' + userId);
			if (writer.role !== 'user') {
				throw new ValidationError({
					message: 'Only a writer can be blocked from a group.',
					field: 'user',
					code: 'not_eligible'
				});
			}
			const { held } = await GroupBlock.block({
				chapterId,
				userId: writer.id,
				reason: words,
				blockedBy: req.user.id
			});
			await audit(req, 'chapter.block', 'chapter', chapterId, {
				writer: writer.id,
				reason: words,
				held
			});
			const group = await Chapter.findByPk(chapterId, { attributes: ['id', 'name'] });
			await notify(
				[writer.id],
				{
					event: 'writer.block',
					detail: { action: 'blocked', chapter: { id: group.id, name: group.name }, reason: words }
				},
				{ actor: req.user.id }
			);
			await notify(
				await membersOf(chapterId),
				{ event: 'group.block', detail: { action: 'blocked', writer: writer.id, held } },
				{ actor: req.user.id }
			);
			this.#handleSuccess(res, { chapter: chapterId, user: writer.id, reason: words, held });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.handleErr(res, errorVar);
		}
	}

	/**
	 * DELETE /chapter/block { user, chapter? }: lift a block. Any group admin of
	 * the group, or a superadmin naming it. The letters it held go back into the
	 * queue as they were.
	 */
	async unblock(req, res) {
		const { user: userId } = req.body;
		try {
			const chapterId = await this.#blockingGroup(req, req.body.chapter, { superadminMay: true });
			const { lifted, released } = await GroupBlock.lift(chapterId, userId);
			if (!lifted) {
				this.requireFound(null, 'A block of user ' + userId + ' by chapter ' + chapterId);
			}
			await audit(req, 'chapter.block.remove', 'chapter', chapterId, {
				writer: Number(userId),
				released
			});
			const group = await Chapter.findByPk(chapterId, { attributes: ['id', 'name'] });
			await notify(
				[userId],
				{
					event: 'writer.block',
					detail: { action: 'lifted', chapter: { id: group.id, name: group.name } }
				},
				{ actor: req.user.id }
			);
			await notify(
				await membersOf(chapterId),
				{ event: 'group.block', detail: { action: 'lifted', writer: Number(userId), released } },
				{ actor: req.user.id }
			);
			this.#handleSuccess(res, { chapter: chapterId, user: Number(userId), released });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.handleErr(res, errorVar);
		}
	}
}
