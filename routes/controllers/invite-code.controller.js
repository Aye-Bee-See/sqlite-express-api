import RouteController from '#rtControllers/route.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import InviteCode from '#models/invite-code.model.js';
import User from '#models/user.model.js';
import Chapter from '#models/chapter.model.js';
import ValidationError from '#services/ValidationError.js';
import { HttpError, NotFoundError } from '#services/HttpError.js';
import { audit } from '#rtServices/audit.services.js';
import { inviteCodes as settings } from '#constants';
import * as authScheme from '#services/auth-scheme.js';
import KeysController from '#rtControllers/keys.controller.js';

/**
 * Invite codes: a chapter issues them, a newcomer joins with one. The chapter
 * sees counts; the code never learns who used it; the account remembers the
 * chapter that sponsored it (`sponsoredBy`), for good.
 */
export default class InviteCodeController extends RouteController {
	constructor() {
		super('inviteCode');
		this.create = this.create.bind(this);
		this.getMany = this.getMany.bind(this);
		this.remove = this.remove.bind(this);
		this.getOne = this.getOne.bind(this);
		this.createAccount = this.createAccount.bind(this);
		this.update = this.update.bind(this);
		this.#handleSuccess = super.handleSuccess;
		this.#handleErr = super.handleErr;
	}

	#handleSuccess;
	#handleErr;

	#fail(res, next, err, condition) {
		if (err && err.status === 403) {
			return next(err);
		}
		this.#handleErr(res, !(err instanceof Error) ? new Error(err) : err, condition);
	}

	/** The chapter a request is about: a group admin's own; a superadmin names one with `chapter`. */
	async #chapterFor(req, wanted) {
		if (AuthzService.isAdmin(req)) {
			const id = wanted ?? req.query.chapter;
			return this.requireFound(await Chapter.findByPk(id), 'Chapter ' + id);
		}
		const own = await AuthzService.activeChapterOf(req);
		if (!own) {
			throw await AuthzService.groupRefusal(req);
		}
		if (wanted !== undefined && String(wanted) !== String(own)) {
			throw AuthzService.forbidden('A group admin issues invite codes for their own chapter only.');
		}
		return await Chapter.findByPk(own);
	}

	/**
	 * POST /auth/invite-codes { count, label?, days?, chapter? (superadmin) }:
	 * a batch of codes, shown once. Print them as slips; the answer is the only
	 * time the server says them.
	 */
	async create(req, res, next) {
		const { count, label, days } = req.body;
		try {
			const chapter = await this.#chapterFor(req, req.body.chapter);
			const issued = await InviteCode.issue({
				chapterId: chapter.id,
				count,
				label,
				days,
				createdBy: req.user.id
			});
			await audit(req, 'invite-code.issue', 'chapter', chapter.id, {
				batch: issued.batch,
				count: issued.codes.length,
				label: issued.label
			});
			this.#handleSuccess(res, {
				chapter: chapter.id,
				batch: issued.batch,
				label: issued.label,
				expiresAt: issued.expiresAt,
				codes: issued.codes,
				outstanding: issued.outstanding,
				limit: settings.outstanding
			});
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** GET /auth/invite-codes[?chapter=]: the chapter's batches with counts; never the codes. */
	async getMany(req, res, next) {
		try {
			const chapter = await this.#chapterFor(req, req.query.chapter);
			this.#handleSuccess(res, {
				chapter: chapter.id,
				limit: settings.outstanding,
				outstanding: await InviteCode.outstanding(chapter.id),
				batches: await InviteCode.batches(chapter.id)
			});
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** DELETE /auth/invite-codes { batch } or { all: true }: cancel unused codes. */
	async remove(req, res, next) {
		const { batch, all } = req.body;
		try {
			const chapter = await this.#chapterFor(req, req.body.chapter);
			if ((typeof batch !== 'string' || batch === '') && all !== true) {
				throw new ValidationError('Send batch (the id of one batch) or all: true.');
			}
			const cancelled = await InviteCode.cancel(chapter.id, { batch: all === true ? null : batch });
			await audit(req, 'invite-code.cancel', 'chapter', chapter.id, {
				batch: all === true ? null : batch,
				cancelled
			});
			this.#handleSuccess(res, {
				chapter: chapter.id,
				cancelled,
				outstanding: await InviteCode.outstanding(chapter.id)
			});
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** @throws {HttpError} 404 for an unknown code, 410 for a spent, cancelled, or expired one */
	async #usable(code) {
		const { record, state } = await InviteCode.lookup(code);
		if (state !== 'valid') {
			const err = new HttpError(
				state === 'unknown' ? 404 : 410,
				state === 'unknown'
					? 'That invite code is not one we know. Check it against the slip.'
					: 'This invite code was ' +
						(state === 'used' ? 'already used' : state) +
						'. Ask the chapter for another.',
				'InviteCodeError'
			);
			err.condition = state;
			throw err;
		}
		const chapter = await Chapter.findByPk(record.chapterId, {
			attributes: ['id', 'name', 'accountStatus']
		});
		if (!chapter || chapter.accountStatus !== 'active') {
			const err = new HttpError(
				410,
				'The chapter that issued this code is not active.',
				'InviteCodeError'
			);
			err.condition = 'cancelled';
			throw err;
		}
		return { record, chapter };
	}

	/** GET /auth/join?code=: is the code usable, and which chapter is behind it? Public. */
	async getOne(req, res, next) {
		try {
			const { record, chapter } = await this.#usable(req.query.code);
			this.#handleSuccess(res, {
				chapter: { id: chapter.id, name: chapter.name },
				expiresAt: record.expiresAt
			});
		} catch (err) {
			this.#fail(res, next, err, err.condition);
		}
	}

	/**
	 * POST /auth/join { code, username, password, email?, name?, bio?, authScheme?, ...keys }:
	 * make an account with an invite code. Public; the code is the credential.
	 * The account belongs to the person from the first request; the chapter that
	 * issued the code is recorded as its sponsor, and nothing links code to account.
	 */
	async createAccount(req, res, next) {
		const { code, username, password, email, name, bio } = req.body;
		let consumed = null;
		try {
			const { record, chapter } = await this.#usable(code);
			const keys = KeysController.keyFields(req.body, { newAccount: true });
			const scheme = authScheme.schemeFrom(req.body);
			authScheme.checkPassword(scheme, password);
			authScheme.requireKeysForSplit(scheme, keys);
			// Say what is wrong with the account before the code is spent; a taken
			// username can only be found by trying, below, and then the code is given back.
			await User.build({
				username,
				password,
				email: email || 'placeholder@managed.example',
				name,
				bio,
				role: 'user'
			}).validate();
			User.refuseReserved({ username, email });
			if (!(await InviteCode.consume(record.id))) {
				const err = new HttpError(410, 'This invite code was just used.', 'InviteCodeError');
				err.condition = 'used';
				throw err;
			}
			consumed = record.id;
			const user = await User.createSponsored({
				username,
				password,
				email,
				name,
				bio,
				sponsoredBy: chapter.id,
				authScheme: scheme,
				keys
			});
			// The log says a chapter's code was used; never by whom.
			await audit(null, 'invite-code.join', 'chapter', chapter.id, { batch: record.batch });
			const plain = user.toJSON();
			delete plain.password;
			for (const column of KeysController.hiddenColumns()) {
				delete plain[column];
			}
			this.#handleSuccess(res, { user: plain, chapter: { id: chapter.id, name: chapter.name } });
		} catch (err) {
			if (consumed) {
				await InviteCode.release(consumed).catch(() => {});
			}
			this.#fail(res, next, err, err.condition);
		}
	}

	/** No route; the interface asks for one. */
	async update(req, res, next) {
		next(new NotFoundError('Cannot PUT invite codes.'));
	}
}
