import passport from 'passport';

/**
 * Authorization helpers.
 *
 * Authentication (who is calling) is handled by passport in auth.services.js.
 * This class answers "is this caller allowed to do this?" once req.user is set.
 *
 * Roles (see database/schemas/user.schema.js): admin, chapter, user, banned.
 * Banned users are rejected at token verification and never reach these checks.
 */
export default class AuthzService {
	static ADMIN = 'admin';
	static CHAPTER = 'chapter';
	static USER = 'user';

	/**
	 * Build an error that ErrorService.handler renders as a JSON 403.
	 * @param {string} message
	 * @returns {Error}
	 */
	static forbidden(message = 'Forbidden') {
		const err = new Error(message);
		err.name = 'AuthorizationError';
		err.status = 403;
		return err;
	}

	/**
	 * Build an error that ErrorService.handler renders as a JSON 401.
	 * @param {string} message
	 * @returns {Error}
	 */
	static unauthorized(message = 'Unauthorized') {
		const err = new Error(message);
		err.name = 'AuthenticationError';
		err.status = 401;
		return err;
	}

	/**
	 * Does the caller hold one of the given roles?
	 * @param {object} req
	 * @param  {...string} roles
	 * @returns {boolean}
	 */
	static hasRole(req, ...roles) {
		const role = req.user?.role;
		return typeof role === 'string' && roles.includes(role);
	}

	/**
	 * Is the caller an admin?
	 * @param {object} req
	 * @returns {boolean}
	 */
	static isAdmin(req) {
		return AuthzService.hasRole(req, AuthzService.ADMIN);
	}

	/**
	 * Admins and chapters: may see unpublished directory records and everyone's threads.
	 * @param {object} req
	 * @returns {boolean}
	 */
	static isStaff(req) {
		return AuthzService.hasRole(req, AuthzService.ADMIN, AuthzService.CHAPTER);
	}

	/**
	 * Should directory reads be limited to published records? True for
	 * anonymous callers and the plain user role.
	 * @param {object} req
	 * @returns {boolean}
	 */
	static publishedOnly(req) {
		return !AuthzService.isStaff(req);
	}

	/**
	 * The chapter a chapter-role caller belongs to, or null.
	 * @param {object} req
	 * @returns {number|null}
	 */
	static chapterOf(req) {
		if (!AuthzService.hasRole(req, AuthzService.CHAPTER)) {
			return null;
		}
		return req.user.chapterId || null;
	}

	/**
	 * Middleware: admins pass; chapter-role callers must belong to a group.
	 */
	static requireGroupMember(req, res, next) {
		if (AuthzService.isAdmin(req) || AuthzService.chapterOf(req)) {
			return next();
		}
		if (AuthzService.hasRole(req, AuthzService.CHAPTER)) {
			return next(
				AuthzService.forbidden(
					'This chapter account is not a member of a group yet; ask an admin to set chapterId.'
				)
			);
		}
		return next(AuthzService.forbidden());
	}

	/**
	 * Is the caller limited to records they own? True for the plain "user"
	 * role. Chats and messages use threadScope() in scope.services.js instead.
	 * @param {object} req
	 * @returns {boolean}
	 */
	static ownOnly(req) {
		return AuthzService.hasRole(req, AuthzService.USER);
	}

	/**
	 * Does a chat or message record belong to the caller? Both models keep
	 * the owning user's id in a `user` column.
	 * @param {object} req
	 * @param {object} record A Sequelize instance or plain object with `user`.
	 * @returns {boolean}
	 */
	static ownsRecord(req, record) {
		if (!req.user || !record) {
			return false;
		}
		return String(record.user) === String(req.user.id);
	}

	/**
	 * Does the request target the caller's own user record?
	 *
	 * Mirrors UserController.getOne precedence: id, then email, then username.
	 * GET requests carry the target in the query string; PUT and DELETE carry it
	 * in the body.
	 * @param {object} req
	 * @returns {boolean}
	 */
	static targetsSelf(req) {
		const me = req.user;
		if (!me) {
			return false;
		}
		const source = req.method === 'GET' ? req.query : req.body;
		const { id, email, username } = source ?? {};
		if (id !== undefined) {
			return String(id) === String(me.id);
		}
		if (email !== undefined) {
			return email === me.email;
		}
		if (username !== undefined) {
			return username === me.username;
		}
		return false;
	}

	/**
	 * Middleware: allow only callers holding one of the given roles.
	 * Must run after passport.authenticate so req.user is populated.
	 * @param  {...string} roles
	 */
	static requireRole(...roles) {
		return function roleGate(req, res, next) {
			if (AuthzService.hasRole(req, ...roles)) {
				return next();
			}
			return next(AuthzService.forbidden());
		};
	}

	/**
	 * Middleware: allow admins, or any caller whose own record is the target.
	 */
	static requireSelfOrAdmin(req, res, next) {
		if (AuthzService.isAdmin(req) || AuthzService.targetsSelf(req)) {
			return next();
		}
		// A chapter may reach its own unclaimed writers; the controller re-checks
		// custody once the record is loaded (see managesTarget).
		if (AuthzService.chapterOf(req)) {
			return next();
		}
		return next(AuthzService.forbidden());
	}

	/**
	 * Once a user record is loaded: may this caller act on it? Admins, the
	 * user themselves, or the chapter that manages an unclaimed writer.
	 * @param {object} req
	 * @param {object} target a User instance or plain object
	 * @returns {boolean}
	 */
	static mayManageUser(req, target) {
		if (!target) {
			return false;
		}
		if (AuthzService.isAdmin(req) || String(target.id) === String(req.user.id)) {
			return true;
		}
		const chapter = AuthzService.chapterOf(req);
		return Boolean(chapter && target.managedBy === chapter && !target.claimedAt);
	}

	/**
	 * Middleware: authenticate with the JWT strategy only if an Authorization
	 * header is present. Anonymous requests continue with no req.user; requests
	 * that present a bad token are rejected rather than downgraded to anonymous.
	 */
	static optionalAuthenticate(req, res, next) {
		if (!req.headers.authorization) {
			return next();
		}
		return passport.authenticate('UsrJStrat', { session: false }, (err, user) => {
			if (err) {
				return next(err);
			}
			if (!user) {
				return next(AuthzService.unauthorized());
			}
			req.user = user;
			return next();
		})(req, res, next);
	}
}
