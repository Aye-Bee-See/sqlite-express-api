import User from '#models/user.model.js';
import RouteController from '#rtControllers/route.controller.js';
import AuthzService from '#rtServices/authz.services.js';
import { HttpError, NotFoundError } from '#services/HttpError.js';

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
	#stripPassword(userObject) {
		const plain = typeof userObject.toJSON === 'function' ? userObject.toJSON() : { ...userObject };
		delete plain.password;
		return plain;
	}

	#handlePass(res, user, type) {
		if (user) {
			const strippedPassword = this.#stripPassword(user);
			this.#handleSuccess(res, strippedPassword);
		} else {
			this.#handleErr(res, new NotFoundError('User not found'), type);
		}
	}

	/**
	 * Send a list of users with password hashes removed. An empty list is a
	 * successful, empty result, not an error.
	 */
	#handleUsers(res, result, limits) {
		this.handlePage(
			res,
			{ rows: result.rows.map((user) => this.#stripPassword(user)), count: result.count },
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
				this.#handleUsers(res, users, limits);
			} catch (err) {
				errorVar = !(err instanceof Error) ? new Error(err) : err;
				this.#handleErr(res, errorVar, 'role');
			}
		} else {
			try {
				const users = await User.getAllUsers(fullBool, limit, offset, q);
				this.#handleUsers(res, users, limits);
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
	async getOne(req, res) {
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
					this.#handlePass(res, user, type);
				} catch (err) {
					errorVar = !(err instanceof Error) ? new Error(err) : err;
					this.#handleErr(res, errorVar, type);
				}
				break;
			case 'mail':
				try {
					const user = await User.getUserByEmail(email, fullBool);
					this.#handlePass(res, user, type);
				} catch (err) {
					errorVar = !(err instanceof Error) ? new Error(err) : err;
					this.#handleErr(res, errorVar, type);
				}
				break;
			case 'name':
				try {
					const user = await User.getUserByUsername(username, fullBool);
					this.#handlePass(res, user, type);
				} catch (err) {
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
			const strippedPassword = this.#stripPassword(user);
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
		try {
			const updatedRows = await User.updateUser(newUser);
			this.requireAffected(updatedRows, 'User ' + newUser.id);
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
	async remove(req, res) {
		const { id } = req.body;
		try {
			const deletedRows = await User.deleteUser(id);
			this.#handleSuccess(res, this.requireAffected(deletedRows, 'User ' + id));
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// login route
	async login(req, res) {
		if (req.isAuthenticated()) {
			const token = req.authInfo.token;
			const user = this.#stripPassword(req.user);
			this.#handleSuccess(res, { user, token });
		} else {
			this.#handleErr(res);
		}
	}
}
