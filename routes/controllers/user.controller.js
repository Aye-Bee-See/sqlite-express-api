import User from '#models/user.model.js';
import RouteController from '#rtControllers/route.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import { HttpError, NotFoundError } from '#services/HttpError.js';
import ClaimToken from '#models/claim-token.model.js';
import ValidationError from '#services/ValidationError.js';
import { audit } from '#rtServices/audit.services.js';
import Chapter from '#models/chapter.model.js';

export default class UserController extends RouteController {
	constructor() {
		/*
		 * If we use class methods as subfunctions (or callbacks)
		 * JS loses where we are and thinks this is is something
		 * other than the instance of our class
		 */

		super('user');
		this.getMany = this.getMany.bind(this);
		this.getOne = this.getOne.bind(this);
		this.update = this.update.bind(this);
		this.create = this.create.bind(this);
		this.remove = this.remove.bind(this);

		this.login = this.login.bind(this);
		this.createWriter = this.createWriter.bind(this);
		this.writers = this.writers.bind(this);
		this.createToken = this.createToken.bind(this);
		this.revokeToken = this.revokeToken.bind(this);
		this.claimInfo = this.claimInfo.bind(this);
		this.claim = this.claim.bind(this);
		this.register = this.create;
		this.#handleErr = super.handleErr;
		this.#handleSuccess = super.handleSuccess;
		this.#handleLimits = super.handleLimits;
	}

	#handleSuccess;
	#handleErr;
	#handleLimits;

	/**
	 * Return a plain object for a user with the password hash removed.
	 * Everything else, including eager-loaded chats, is kept.
	 * @param {import('sequelize').Model|object} userObject
	 * @returns {object}
	 */
	#stripPassword(userObject, req) {
		const plain = typeof userObject.toJSON === 'function' ? userObject.toJSON() : { ...userObject };
		delete plain.password;
		// The internal note is for the managing chapter and admins only.
		const managerCanSee =
			req &&
			(AuthzService.isAdmin(req) ||
				(plain.managedBy && AuthzService.chapterOf(req) === plain.managedBy));
		if (!managerCanSee) {
			delete plain.managerNote;
		}
		return plain;
	}

	#handlePass(res, user, type, req) {
		if (user && !AuthzService.mayManageUser(req, user)) {
			throw AuthzService.forbidden();
		}
		if (user) {
			const strippedPassword = this.#stripPassword(user, req);
			this.#handleSuccess(res, strippedPassword);
		} else {
			this.#handleErr(res, new NotFoundError('User not found'), type);
		}
	}

	/**
	 * Send a list of users with password hashes removed. An empty list is a
	 * successful, empty result, not an error.
	 */
	#handleUsers(res, result, limits, req) {
		this.handlePage(
			res,
			{ rows: result.rows.map((user) => this.#stripPassword(user, req)), count: result.count },
			limits
		);
	}

	/***
	 * TODO:  Needs error trapping for no existing chats
	 */
	async getMany(req, res) {
		let errorVar;
		const { role, full, page, page_size, q } = req.query;
		const limits = this.#handleLimits(page, page_size);
		const { limit, offset } = limits;

		const fullBool = full === 'true';

		if (role) {
			try {
				const users = await User.getUsersByRole(role, fullBool, limit, offset, q);
				this.#handleUsers(res, users, limits, req);
			} catch (err) {
				errorVar = !(err instanceof Error) ? new Error(err) : err;
				this.#handleErr(res, errorVar, 'role');
			}
		} else {
			try {
				const users = await User.getAllUsers(fullBool, limit, offset, q);
				this.#handleUsers(res, users, limits, req);
			} catch (err) {
				errorVar = !(err instanceof Error) ? new Error(err) : err;
				this.#handleErr(res, errorVar);
			}
		}
	}

	// get one user
	/**
	 * TODO:  At least get by email should be case insensitive if not everything
	 */
	async getOne(req, res, next) {
		let errorVar;
		const { id, email, username, full } = req.query;
		const fullBool = full === 'true';

		const type = req.query.id
			? 'id'
			: req.query.email
				? 'mail'
				: req.query.username
					? 'name'
					: 'empty';

		switch (type) {
			case 'id':
				try {
					const user = await User.getUserByID(id, fullBool);
					this.#handlePass(res, user, type, req);
				} catch (err) {
					if (err && err.status === 403) {
						return next(err);
					}
					errorVar = !(err instanceof Error) ? new Error(err) : err;
					this.#handleErr(res, errorVar, type);
				}
				break;
			case 'mail':
				try {
					const user = await User.getUserByEmail(email, fullBool);
					this.#handlePass(res, user, type, req);
				} catch (err) {
					if (err && err.status === 403) {
						return next(err);
					}
					errorVar = !(err instanceof Error) ? new Error(err) : err;
					this.#handleErr(res, errorVar, type);
				}
				break;
			case 'name':
				try {
					const user = await User.getUserByUsername(username, fullBool);
					this.#handlePass(res, user, type, req);
				} catch (err) {
					if (err && err.status === 403) {
						return next(err);
					}
					errorVar = !(err instanceof Error) ? new Error(err) : err;
					this.#handleErr(res, errorVar, type);
				}
				break;
			default:
				this.#handleErr(res, new HttpError(400, 'No ID, username, or email provided.'), type);
				break;
		}
	}

	/**
	 * Register a user. Anonymous callers (and non-admins) always get the
	 * "user" role; only an admin token may create admin, chapter, or banned
	 * accounts.
	 */
	async create(req, res, next) {
		const { username, email, password, name, bio } = req.body;
		const chapterId = AuthzService.isAdmin(req) ? req.body.chapterId : undefined;
		const role =
			typeof req.body.role === 'string' ? req.body.role.toLowerCase() : AuthzService.USER;
		if (role !== AuthzService.USER && !AuthzService.isAdmin(req)) {
			return next(
				AuthzService.forbidden('Only an admin can create a user with role "' + role + '".')
			);
		}
		try {
			const user = await User.createUser({ username, password, role, email, name, bio, chapterId });
			const strippedPassword = this.#stripPassword(user, req);
			this.#handleSuccess(res, strippedPassword);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
	// Update

	/**
	 * Update a user. Route middleware already limits non-admins to their own
	 * record; here we also stop them from promoting themselves.
	 */
	async update(req, res, next) {
		const newUser = req.body;
		if (newUser.role !== undefined && !AuthzService.isAdmin(req)) {
			return next(AuthzService.forbidden("Only an admin can change a user's role."));
		}
		if (newUser.chapterId !== undefined && !AuthzService.isAdmin(req)) {
			return next(AuthzService.forbidden("Only an admin can change a user's group membership."));
		}
		for (const field of ['managedBy', 'claimedAt', 'claimedFrom', 'anonymousForChapter']) {
			if (newUser[field] !== undefined && !AuthzService.isAdmin(req)) {
				return next(AuthzService.forbidden('Only an admin can change ' + field + '.'));
			}
		}
		try {
			if (!AuthzService.isAdmin(req) && !AuthzService.targetsSelf(req)) {
				// A chapter editing one of its unclaimed writers: limited fields.
				const target = await User.findByPk(newUser.id);
				if (!AuthzService.mayManageUser(req, target)) {
					return next(AuthzService.forbidden());
				}
				const allowed = ['id', 'name', 'email', 'managerNote'];
				const extra = Object.keys(newUser).filter((k) => !allowed.includes(k));
				if (extra.length > 0) {
					return next(
						AuthzService.forbidden(
							'A managing chapter may only change name, email, and managerNote (not ' +
								extra.join(', ') +
								').'
						)
					);
				}
			}
			const updatedRows = await User.updateUser(newUser);
			this.requireAffected(updatedRows, 'User ' + newUser.id);
			if (
				AuthzService.isAdmin(req) &&
				(newUser.role !== undefined || newUser.chapterId !== undefined)
			) {
				await audit(req, 'user.update', 'user', newUser.id, {
					role: newUser.role,
					chapterId: newUser.chapterId
				});
			}
			// Never echo a password, plain or hashed, back to the client.
			const { password, ...echoed } = newUser;
			void password;
			this.#handleSuccess(res, { updatedRows, newUser: echoed });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Delete
	async remove(req, res, next) {
		const { id } = req.body;
		try {
			if (!AuthzService.isAdmin(req) && !AuthzService.targetsSelf(req)) {
				const target = await User.findByPk(id);
				if (target && !AuthzService.mayManageUser(req, target)) {
					return next(AuthzService.forbidden());
				}
			}
			const deletedRows = await User.deleteUser(id);
			this.#handleSuccess(res, this.requireAffected(deletedRows, 'User ' + id));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/**
	 * The chapter a staff caller manages writers for: their own group, or,
	 * for admins, the `chapter` given in the body/query (optional).
	 */
	#managingChapter(req, explicit) {
		if (AuthzService.isAdmin(req)) {
			return explicit ? Number(explicit) : null;
		}
		return AuthzService.chapterOf(req);
	}

	/** May this caller manage (token, note, edit) the given writer? */
	#manages(req, writer) {
		if (AuthzService.isAdmin(req)) {
			return true;
		}
		return User.isUnclaimedManaged(writer) && writer.managedBy === AuthzService.chapterOf(req);
	}

	/**
	 * POST /auth/writer { name, email?, managerNote?, chapter? (admin) }:
	 * create an account under the caller's group's custody.
	 */
	async createWriter(req, res, next) {
		const { name, email, managerNote } = req.body;
		const chapterId = this.#managingChapter(req, req.body.chapter);
		if (!chapterId) {
			return next(AuthzService.forbidden('Specify the chapter this writer belongs to.'));
		}
		if (typeof name !== 'string' || name.trim().length < 1) {
			return next(new ValidationError('name is required.'));
		}
		try {
			const chapter = await Chapter.findByPk(chapterId);
			if (!chapter) {
				throw new NotFoundError('Chapter ' + chapterId + ' not found');
			}
			const writer = await User.createManagedWriter({
				name: name.trim(),
				email,
				managerNote,
				chapterId
			});
			await audit(req, 'writer.create', 'user', writer.id, { chapterId });
			this.#handleSuccess(res, this.#stripPassword(writer, req));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/**
	 * GET /auth/writers: the caller's group's managed writers (admins: all, or
	 * ?chapter=<id>). Each row carries `claimToken` with the live token's
	 * expiry, or null.
	 */
	async writers(req, res) {
		const { page, page_size, q } = req.query;
		const limits = this.#handleLimits(page, page_size);
		const chapterId = this.#managingChapter(req, req.query.chapter);
		try {
			const result = await User.listManagedWriters({
				chapterId,
				limit: limits.limit,
				offset: limits.offset,
				q
			});
			const rows = [];
			for (const writer of result.rows) {
				const plain = this.#stripPassword(writer, req);
				const active = await ClaimToken.activeFor(writer.id);
				plain.claimToken = active ? { expiresAt: active.expiresAt } : null;
				rows.push(plain);
			}
			this.handlePage(res, { rows, count: result.count }, limits);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/**
	 * POST /auth/writer/token { writer }: generate (or regenerate) the
	 * writer's claim token. The plaintext is returned once.
	 */
	async createToken(req, res, next) {
		const { writer: writerId } = req.body;
		try {
			const writer = this.requireFound(await User.findByPk(writerId), 'Writer ' + writerId);
			if (!User.isUnclaimedManaged(writer)) {
				return next(new HttpError(409, 'This account is not an unclaimed managed writer.'));
			}
			if (!this.#manages(req, writer)) {
				return next(AuthzService.forbidden('Your group does not manage this writer.'));
			}
			const { token, expiresAt } = await ClaimToken.issue(writer.id, req.user.id);
			this.#handleSuccess(res, { writer: writer.id, token, expiresAt });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/** DELETE /auth/writer/token { writer }: revoke the live token. */
	async revokeToken(req, res, next) {
		const { writer: writerId } = req.body;
		try {
			const writer = this.requireFound(await User.findByPk(writerId), 'Writer ' + writerId);
			if (!this.#manages(req, writer)) {
				return next(AuthzService.forbidden('Your group does not manage this writer.'));
			}
			const removed = await ClaimToken.revoke(writer.id);
			this.#handleSuccess(res, this.requireAffected(removed, 'Claim token for writer ' + writerId));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/**
	 * Resolve a claim token to its writer, or fail with the right message.
	 * @returns {Promise<{record: ClaimToken, writer: User}>}
	 */
	async #validClaim(token) {
		const { record, state } = await ClaimToken.lookup(token);
		if (state !== 'valid') {
			const status = state === 'unknown' ? 404 : 410;
			const err = new HttpError(status, 'Claim token is ' + state + '.', 'ClaimTokenError');
			err.condition = state;
			throw err;
		}
		const writer = await User.findByPk(record.userId);
		if (!writer || !User.isUnclaimedManaged(writer)) {
			const err = new HttpError(410, 'This account can no longer be claimed.', 'ClaimTokenError');
			err.condition = 'used';
			throw err;
		}
		return { record, writer };
	}

	/**
	 * GET /auth/claim?token=…: is the token usable, and for whom?
	 * Public; reveals only the writer's name and the managing group's name.
	 */
	async claimInfo(req, res) {
		try {
			const { record, writer } = await this.#validClaim(req.query.token);
			const chapter = await Chapter.findByPk(writer.managedBy);
			this.#handleSuccess(res, {
				writer: { id: writer.id, name: writer.name },
				chapter: chapter ? { id: chapter.id, name: chapter.name } : null,
				expiresAt: record.expiresAt
			});
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar, errorVar.condition || 'par');
		}
	}

	/**
	 * POST /auth/claim { token, username, password, email? }: take control of
	 * a managed account. Public; the token is the credential.
	 */
	async claim(req, res) {
		const { token, username, password, email } = req.body;
		try {
			const { record, writer } = await this.#validClaim(token);
			await User.claim(writer, { username, password, email });
			record.usedAt = new Date();
			await record.save();
			await audit(null, 'writer.claim', 'user', writer.id, { claimedFrom: writer.managedBy });
			const claimed = await User.findByPk(writer.id);
			this.#handleSuccess(res, this.#stripPassword(claimed, req));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar, errorVar.condition || 'par');
		}
	}

	// login route
	async login(req, res) {
		if (req.isAuthenticated()) {
			const token = req.authInfo.token;
			const user = this.#stripPassword(req.user, req);
			this.#handleSuccess(res, { user, token });
		} else {
			this.#handleErr(res);
		}
	}
}
