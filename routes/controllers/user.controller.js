import User from '#models/user.model.js';
import RouteController from '#rtControllers/route.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import { HttpError, NotFoundError } from '#services/HttpError.js';
import ClaimToken from '#models/claim-token.model.js';
import ValidationError from '#services/ValidationError.js';
import { audit } from '#rtServices/audit.services.js';
import KeysController from '#rtControllers/keys.controller.js';
import authService from '#rtServices/auth.services.js';
import RevokedToken from '#models/revoked-token.model.js';
import { KEY_COLUMNS, KEY_INPUT } from '#models/user.model.js';
import { retentionMaxDays } from '#constants';
import * as crypto from '#services/crypto.js';
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
		this.logout = this.logout.bind(this);
		this.revoke = this.revoke.bind(this);
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
		// Key material only travels through GET /auth/keys and the claim and recovery flows.
		for (const column of KEY_COLUMNS) {
			delete plain[column];
		}
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

	async #handlePass(res, user, type, req) {
		if (user && !(await AuthzService.mayManageUser(req, user))) {
			throw await AuthzService.refusalFor(req);
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
					await this.#handlePass(res, user, type, req);
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
					await this.#handlePass(res, user, type, req);
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
					await this.#handlePass(res, user, type, req);
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
			const keys = KeysController.keyFields(req.body);
			const user = await User.createUser({
				username,
				password,
				role,
				email,
				name,
				bio,
				chapterId,
				...keys
			});
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
		if (newUser.retentionDays !== undefined && newUser.retentionDays !== null) {
			const days = Number(newUser.retentionDays);
			if (!Number.isInteger(days) || days < 0) {
				return next(
					new ValidationError('retentionDays must be a whole number of days (0 keeps forever).')
				);
			}
			if (retentionMaxDays !== null && (days === 0 || days > retentionMaxDays)) {
				return next(
					new ValidationError(
						'retentionDays cannot exceed the site maximum of ' + retentionMaxDays + ' days.'
					)
				);
			}
		}
		if (newUser.sessionsRevokedAt !== undefined) {
			// Server-controlled: set through logout, POST /auth/revoke, or a password change.
			return next(
				AuthzService.forbidden('sessionsRevokedAt cannot be set directly; use POST /auth/revoke.')
			);
		}
		try {
			const custody = !AuthzService.isAdmin(req) && !AuthzService.targetsSelf(req);
			if (!custody) {
				// Key material has its own endpoint with the immutability checks.
				const keyFields = [...KEY_INPUT, 'orgWrappedPrivateKey'].filter(
					(f) => newUser[f] !== undefined
				);
				const rewrap = ['wrappedPrivateKey', 'kdfSalt', 'kdfParams'];
				const stray = keyFields.filter((f) => !rewrap.includes(f));
				if (stray.length > 0) {
					throw new ValidationError(
						'Set keys through PUT /auth/keys, not here (' + stray.join(', ') + ').'
					);
				}
				if (crypto.isE2E() && newUser.password !== undefined) {
					// A new password means a new wrapping of the private key.
					const target = await User.findByPk(newUser.id, { attributes: ['id', 'publicKey'] });
					if (target && target.publicKey) {
						if (!AuthzService.targetsSelf(req)) {
							throw new ValidationError(
								'End-to-end mode: only the account holder can change this password (the private key is wrapped under it); use recovery.'
							);
						}
						if (rewrap.some((f) => newUser[f] === undefined)) {
							throw new ValidationError(
								'End-to-end mode: send wrappedPrivateKey, kdfSalt, and kdfParams re-wrapped under the new password.'
							);
						}
					}
				} else if (keyFields.length > 0) {
					throw new ValidationError('Set keys through PUT /auth/keys, not here.');
				}
			}
			if (custody) {
				// A chapter editing one of its unclaimed writers: limited fields.
				const target = await User.findByPk(newUser.id);
				if (!(await AuthzService.mayManageUser(req, target))) {
					return next(await AuthzService.refusalFor(req));
				}
				// A managing group may also prepare an unclaimed writer for end-to-end
				// mode: set the keypair it generated (public key once, its sealed copy).
				const allowed = [
					'id',
					'name',
					'email',
					'managerNote',
					'retentionDays',
					'publicKey',
					'orgWrappedPrivateKey'
				];
				if (newUser.publicKey !== undefined) {
					if (!crypto.isPublicKey(newUser.publicKey)) {
						return next(
							new ValidationError('publicKey must be a base64 X25519 public key (32 bytes).')
						);
					}
					if (target.publicKey && target.publicKey !== newUser.publicKey) {
						return next(
							new HttpError(
								409,
								'The writer already has a public key; it cannot change.',
								'KeyChangeError'
							)
						);
					}
				}
				if (
					newUser.orgWrappedPrivateKey !== undefined &&
					typeof newUser.orgWrappedPrivateKey !== 'string'
				) {
					return next(new ValidationError('orgWrappedPrivateKey must be a string.'));
				}
				const extra = Object.keys(newUser).filter((k) => !allowed.includes(k));
				if (extra.length > 0) {
					return next(
						AuthzService.forbidden(
							'A managing chapter may only change ' +
								allowed.filter((k) => k !== 'id').join(', ') +
								' (not ' +
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
			const result = { updatedRows, newUser: echoed };
			if (password !== undefined) {
				// A new password ends every existing session; the caller who
				// changed their own gets a fresh token so they stay signed in.
				await User.revokeSessions(newUser.id);
				if (AuthzService.targetsSelf(req)) {
					result.token = authService.issueToken(req.user);
				}
			}
			this.#handleSuccess(res, result);
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
				if (target && !(await AuthzService.mayManageUser(req, target))) {
					return next(await AuthzService.refusalFor(req));
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
			const keys = {};
			if (crypto.isE2E()) {
				// The group's browser generated the writer's keypair and sealed the
				// private key to the group, so the group can read and print for them.
				if (!crypto.isPublicKey(req.body.publicKey)) {
					throw new ValidationError('End-to-end mode: publicKey (base64 X25519) is required.');
				}
				if (
					typeof req.body.orgWrappedPrivateKey !== 'string' ||
					req.body.orgWrappedPrivateKey === ''
				) {
					throw new ValidationError('End-to-end mode: orgWrappedPrivateKey is required.');
				}
				keys.publicKey = req.body.publicKey;
				keys.orgWrappedPrivateKey = req.body.orgWrappedPrivateKey;
			}
			const writer = await User.createManagedWriter({
				name: name.trim(),
				email,
				managerNote,
				chapterId,
				...keys
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
			const orgKeys = crypto.isE2E()
				? await User.orgWrappedKeysFor(result.rows.map((w) => w.id))
				: null;
			for (const writer of result.rows) {
				const plain = this.#stripPassword(writer, req);
				if (orgKeys) {
					plain.orgWrappedPrivateKey = orgKeys.get(writer.id) || null;
				}
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
			if (crypto.isE2E()) {
				// The browser made the token; the server only ever holds its hash.
				const { tokenHash, claimWrappedPrivateKey, claimSalt, claimKdfParams } = req.body;
				if (typeof tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(tokenHash)) {
					throw new ValidationError(
						'End-to-end mode: tokenHash (SHA-256 hex of the upper-cased token) is required.'
					);
				}
				for (const [field, value] of [
					['claimWrappedPrivateKey', claimWrappedPrivateKey],
					['claimSalt', claimSalt]
				]) {
					if (typeof value !== 'string' || value === '') {
						throw new ValidationError('End-to-end mode: ' + field + ' is required.');
					}
				}
				if (!claimKdfParams || typeof claimKdfParams !== 'object') {
					throw new ValidationError('End-to-end mode: claimKdfParams must be an object.');
				}
				const { expiresAt } = await ClaimToken.issueFromClient(
					writer.id,
					{ tokenHash, claimWrappedPrivateKey, claimSalt, claimKdfParams },
					req.user.id
				);
				return this.#handleSuccess(res, { writer: writer.id, expiresAt });
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
			const info = {
				writer: { id: writer.id, name: writer.name },
				chapter: chapter ? { id: chapter.id, name: chapter.name } : null,
				expiresAt: record.expiresAt
			};
			if (crypto.isE2E()) {
				Object.assign(info, {
					publicKey: writer.publicKey,
					claimWrappedPrivateKey: record.claimWrappedPrivateKey,
					claimSalt: record.claimSalt,
					claimKdfParams: record.claimKdfParams
				});
			}
			this.#handleSuccess(res, info);
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
			let keys = {};
			if (crypto.isE2E()) {
				// The browser unwrapped the key with the token and re-wrapped it
				// under the new password and a recovery code; the keypair stays.
				keys = KeysController.keyFields(req.body);
				if (keys.wrappedPrivateKey === undefined || keys.recoveryWrappedPrivateKey === undefined) {
					throw new ValidationError(
						'End-to-end mode: send wrappedPrivateKey, kdfSalt, kdfParams, recoveryWrappedPrivateKey, recoverySalt, and recoveryKdfParams.'
					);
				}
				if (keys.publicKey !== undefined && keys.publicKey !== writer.publicKey) {
					throw new HttpError(409, 'The public key cannot change on claim.', 'KeyChangeError');
				}
				delete keys.publicKey;
			}
			await User.claim(writer, { username, password, email, keys });
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

	/**
	 * POST /auth/logout { everywhere? }: revoke this token, or every token
	 * for the account. A token issued before revocation existed has no id
	 * and can only be signed out everywhere.
	 */
	async logout(req, res) {
		const body = req.body || {};
		const everywhere = body.everywhere === true || body.everywhere === 'true';
		try {
			const payload = authService.tokenPayload(req) || {};
			let condition = 'par';
			if (everywhere || !payload.jti) {
				await User.revokeSessions(req.user.id);
				condition = 'everywhere';
			} else {
				const expiresAt = payload.exp
					? new Date(payload.exp * 1000)
					: new Date(Date.now() + 6.048e8);
				await RevokedToken.revoke(payload.jti, req.user.id, expiresAt);
			}
			await RevokedToken.sweep();
			await audit(req, 'user.logout', 'user', req.user.id, {
				everywhere: condition === 'everywhere'
			});
			this.#handleSuccess(
				res,
				{ signedOut: true, everywhere: condition === 'everywhere' },
				condition
			);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	/** POST /auth/revoke { user } (admin): every token for that account stops working. */
	async revoke(req, res) {
		const { user: userId } = req.body;
		try {
			const target = this.requireFound(await User.findByPk(userId), 'User ' + userId);
			const at = await User.revokeSessions(target.id);
			await audit(req, 'user.revoke', 'user', target.id);
			this.#handleSuccess(res, { user: target.id, sessionsRevokedAt: at });
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// login route
	async login(req, res) {
		if (req.isAuthenticated()) {
			const token = req.authInfo.token;
			const user = this.#stripPassword(req.user, req);
			// The login lookup bypasses the default scope; key material is only
			// handed out as the bundle, and only in end-to-end mode.
			for (const column of KEY_COLUMNS) {
				delete user[column];
			}
			const keys = crypto.isE2E() ? await KeysController.keyBundle(req.user.id) : undefined;
			this.#handleSuccess(res, { user, token, ...(keys ? { keys } : {}) });
		} else {
			this.#handleErr(res);
		}
	}
}
