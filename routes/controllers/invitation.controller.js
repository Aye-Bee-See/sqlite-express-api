import RouteController from '#rtControllers/route.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import KeysController from '#rtControllers/keys.controller.js';
import Invitation from '#models/invitation.model.js';
import Chapter from '#models/chapter.model.js';
import User from '#models/user.model.js';
import { RESOURCES } from '#models/submission.model.js';
import ValidationError from '#services/ValidationError.js';
import { HttpError } from '#services/HttpError.js';
import { audit } from '#rtServices/audit.services.js';
import { INVITATION_KINDS, INVITATION_STATUSES } from '#schemas/invitation.schema.js';
import { invitationAutoActivate } from '#constants';
import * as authScheme from '#services/auth-scheme.js';

/** What an invited group may say about itself: the public profile, nothing an admin decides. */
const GROUP_PROFILE_FIELDS = RESOURCES.chapter.submittable.filter((f) => f !== 'accountStatus');

/**
 * Invitations. Groups join the network because an active group vouches for
 * them, and a group adds its own members; neither needs an admin to type
 * accounts in. The vouching itself happens between people, off the
 * platform; this records it and turns it into a group and a first account.
 */
export default class InvitationController extends RouteController {
	constructor() {
		super('invitation');
		this.create = this.create.bind(this);
		this.getMany = this.getMany.bind(this);
		this.getOne = this.getOne.bind(this);
		this.update = this.update.bind(this);
		this.remove = this.remove.bind(this);
		this.accept = this.accept.bind(this);

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

	/** An invitation row for the people who manage it, with its display state. */
	static #present(invitation, extra = {}) {
		return { ...invitation.toJSON(), state: Invitation.stateOf(invitation), ...extra };
	}

	/** Load an invitation the caller manages: their own group's, or any for an admin. */
	async #managed(req, id) {
		const invitation = this.requireFound(await Invitation.findByPk(id), 'Invitation ' + id);
		if (AuthzService.isAdmin(req)) {
			return invitation;
		}
		const own = await AuthzService.activeChapterOf(req);
		if (!own || String(invitation.chapterId) !== String(own)) {
			throw AuthzService.forbidden('Only the inviting group or an admin can manage an invitation.');
		}
		return invitation;
	}

	/**
	 * POST /invitation/invitation { kind, inviteeName, inviteeEmail?, note?, chapter? }
	 * A member of an active group invites a new group (their group vouches)
	 * or a new member of their own group. Admins name the group with
	 * `chapter`; for a new group they may leave it out (nobody vouches).
	 * The response carries the token, once.
	 */
	async create(req, res, next) {
		const { kind, inviteeName, inviteeEmail, note } = req.body;
		try {
			if (!INVITATION_KINDS.includes(kind)) {
				throw new ValidationError('kind must be one of ' + INVITATION_KINDS.join(', ') + '.');
			}
			let chapterId;
			if (AuthzService.isAdmin(req)) {
				chapterId = req.body.chapter ?? null;
				if (kind === 'member' && !chapterId) {
					throw new ValidationError('chapter is required: the group the member will join.');
				}
			} else {
				// requireRole already established that the caller's group is active.
				chapterId = await AuthzService.activeChapterOf(req);
				if (req.body.chapter !== undefined && String(req.body.chapter) !== String(chapterId)) {
					throw AuthzService.forbidden('A group invites on its own behalf only.');
				}
			}
			if (chapterId) {
				const chapter = this.requireFound(
					await Chapter.findByPk(chapterId),
					'Chapter ' + chapterId
				);
				if (chapter.accountStatus !== 'active') {
					throw new HttpError(
						409,
						'Chapter ' + chapter.id + ' is not an active member of the network.',
						'InvitationError'
					);
				}
			}
			const { invitation, token } = await Invitation.issue({
				kind,
				chapterId,
				inviteeName,
				inviteeEmail,
				note,
				invitedBy: req.user.id
			});
			await audit(req, 'invitation.create', 'invitation', invitation.id, { kind, chapterId });
			this.#handleSuccess(res, InvitationController.#present(invitation, { token }));
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** GET /invitation/invitations?status=&kind=&chapter=&page=&page_size=: a group's own; admins see all. */
	async getMany(req, res, next) {
		const { status, kind, chapter, page, page_size } = req.query;
		try {
			const limits = this.#handleLimits(page, page_size);
			const where = {};
			if (AuthzService.isAdmin(req)) {
				if (chapter !== undefined && chapter !== '') {
					where.chapterId = chapter;
				}
			} else {
				where.chapterId = await AuthzService.activeChapterOf(req);
			}
			if (kind !== undefined && kind !== '') {
				if (!INVITATION_KINDS.includes(kind)) {
					throw new ValidationError('kind must be one of ' + INVITATION_KINDS.join(', ') + '.');
				}
				where.kind = kind;
			}
			if (status !== undefined && status !== '') {
				if (!INVITATION_STATUSES.includes(status)) {
					throw new ValidationError(
						'status must be one of ' + INVITATION_STATUSES.join(', ') + '.'
					);
				}
				where.status = status;
			}
			const result = await Invitation.findAndCountAll({
				where,
				limit: limits.limit,
				offset: limits.offset,
				order: [['id', 'DESC']]
			});
			this.handlePage(
				res,
				{ rows: result.rows.map((row) => InvitationController.#present(row)), count: result.count },
				limits
			);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** A usable invitation for this token, or the 404/410 that says why not. */
	async #usable(token) {
		const { record, state } = await Invitation.lookup(token);
		if (state !== 'valid') {
			const err = new HttpError(
				state === 'unknown' ? 404 : 410,
				'This invitation is ' + (state === 'unknown' ? 'not known' : state) + '.',
				'InvitationError'
			);
			err.condition = state;
			throw err;
		}
		const chapter = record.chapterId ? await Chapter.findByPk(record.chapterId) : null;
		// A vouch, or a place in a group, is only as good as the group behind it today.
		if (record.chapterId && (!chapter || chapter.accountStatus !== 'active')) {
			const err = new HttpError(
				410,
				'The group behind this invitation is no longer an active member of the network.',
				'InvitationError'
			);
			err.condition = 'inactive';
			throw err;
		}
		return { record, chapter };
	}

	/**
	 * GET /invitation/invitation?token=: what this token invites its holder
	 * to. Public; the token is the credential. Says who vouches or which
	 * group is joined, never the inviter's note or contact details.
	 */
	async getOne(req, res, next) {
		try {
			const { record, chapter } = await this.#usable(req.query.token);
			this.#handleSuccess(res, {
				kind: record.kind,
				inviteeName: record.inviteeName,
				chapter: chapter ? { id: chapter.id, name: chapter.name } : null,
				expiresAt: record.expiresAt,
				activation: InvitationController.#activatesAtOnce(record) ? 'immediate' : 'admin_review',
				groupFields: record.kind === 'group' ? GROUP_PROFILE_FIELDS : undefined
			});
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * Does accepting this invitation give an account that can act straight
	 * away? A member joins a group that is already active. A new group waits
	 * for an admin unless INVITATION_AUTO_ACTIVATE says an invitation is
	 * enough. That includes an admin's invitation with no vouching group:
	 * only an admin can issue one, so an admin has already decided.
	 */
	static #activatesAtOnce(invitation) {
		return invitation.kind === 'member' || invitationAutoActivate;
	}

	/** PUT /invitation/invitation { id }: a fresh token and expiry; the old token stops working. */
	async update(req, res, next) {
		try {
			const invitation = await this.#managed(req, req.body.id);
			const renewed = await Invitation.renew(invitation.id);
			if (!renewed) {
				throw new HttpError(
					409,
					'Only a pending invitation can be renewed; this one is ' + invitation.status + '.',
					'InvitationError'
				);
			}
			await audit(req, 'invitation.renew', 'invitation', invitation.id);
			this.#handleSuccess(
				res,
				InvitationController.#present(renewed.invitation, { token: renewed.token })
			);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/** DELETE /invitation/invitation { id }: withdraw a pending invitation. */
	async remove(req, res, next) {
		try {
			const invitation = await this.#managed(req, req.body.id);
			if (!(await Invitation.revoke(invitation.id))) {
				throw new HttpError(
					409,
					'Only a pending invitation can be withdrawn; this one is ' + invitation.status + '.',
					'InvitationError'
				);
			}
			await audit(req, 'invitation.revoke', 'invitation', invitation.id);
			this.#handleSuccess(
				res,
				InvitationController.#present(await Invitation.findByPk(invitation.id))
			);
		} catch (err) {
			this.#fail(res, next, err);
		}
	}

	/**
	 * POST /invitation/accept { token, username, password, email, name?, group?, ...keys }
	 * Public. Creates the account (role chapter) and, for a group invitation,
	 * the group it belongs to, recorded as vouched for by the inviting group.
	 */
	async accept(req, res, next) {
		const { token, username, password, email, name } = req.body;
		let consumed = null;
		let createdGroup = null;
		let createdUser = null;
		try {
			const { record, chapter } = await this.#usable(token);
			const keys = KeysController.keyFields(req.body, { newAccount: true });
			const scheme = authScheme.schemeFrom(req.body);
			authScheme.checkPassword(scheme, password);
			authScheme.requireKeysForSplit(scheme, keys);
			let groupFields = null;
			if (record.kind === 'group') {
				groupFields = InvitationController.#groupFields(req.body.group);
			} else if (req.body.group !== undefined) {
				throw new ValidationError(
					'This invitation is to join an existing group; do not send group.'
				);
			}
			// Say what is wrong with the account or the group before anything is
			// written; a taken username can only be found by trying, below.
			if (groupFields) {
				await Chapter.build(groupFields).validate();
			}
			await User.build({ username, password, email, name, role: AuthzService.CHAPTER }).validate();
			if (!(await Invitation.consume(record.id))) {
				const err = new HttpError(410, 'This invitation was just used.', 'InvitationError');
				err.condition = 'accepted';
				throw err;
			}
			consumed = record.id;

			let group = chapter;
			if (record.kind === 'group') {
				const atOnce = InvitationController.#activatesAtOnce(record);
				createdGroup = await Chapter.create({
					...groupFields,
					vouchedBy: record.chapterId,
					accountStatus: atOnce ? 'active' : 'pending',
					recordStatus: atOnce ? 'published' : 'pending'
				});
				group = createdGroup;
			}
			createdUser = await User.createUser({
				username,
				password,
				email,
				name,
				role: AuthzService.CHAPTER,
				chapterId: group.id,
				authScheme: scheme,
				...keys
			});
			await Invitation.complete(record.id, {
				acceptedUser: createdUser.id,
				createdChapter: createdGroup ? createdGroup.id : null
			});
			if (createdGroup) {
				// The founding group admin of a new chapter is its group-owner admin.
				await Chapter.setOwner(createdGroup.id, createdUser.id, null);
			} else {
				await KeysController.noteWaiting(createdUser.id, { actor: createdUser.id });
			}
			const user = (await User.findByPk(createdUser.id)).toJSON();
			delete user.managerNote;
			// Last, once nothing else can fail: the log should not describe an acceptance that was undone.
			await audit(null, 'invitation.accept', 'invitation', record.id, {
				kind: record.kind,
				user: createdUser.id,
				chapter: group.id,
				vouchedBy: record.kind === 'group' ? record.chapterId : undefined
			});
			this.#handleSuccess(res, {
				user,
				chapter: { id: group.id, name: group.name, accountStatus: group.accountStatus },
				activation: group.accountStatus === 'active' ? 'immediate' : 'admin_review'
			});
		} catch (err) {
			// Nothing half-made is left behind, whichever step failed, and the
			// invitee can correct and try again. The account goes before the
			// group it points at.
			if (createdUser) {
				await createdUser.destroy({ force: true }).catch(() => {});
			}
			if (createdGroup) {
				await createdGroup.destroy({ force: true }).catch(() => {});
			}
			if (consumed) {
				await Invitation.release(consumed).catch(() => {});
			}
			this.#fail(res, next, err);
		}
	}

	/** The group profile an invitee sent, limited to what a group may say about itself. */
	static #groupFields(group) {
		if (!group || typeof group !== 'object' || Array.isArray(group)) {
			throw new ValidationError("group is required: the new group's name, location, and profile.");
		}
		const refused = Object.keys(group).filter((f) => !GROUP_PROFILE_FIELDS.includes(f));
		if (refused.length > 0) {
			throw new ValidationError(
				'These group fields cannot be set when accepting an invitation: ' +
					refused.join(', ') +
					'. Allowed: ' +
					GROUP_PROFILE_FIELDS.join(', ') +
					'.'
			);
		}
		return { ...group };
	}
}
