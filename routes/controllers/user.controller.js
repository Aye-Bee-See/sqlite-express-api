import User from '#models/user.model.js';
//import { default as jwt } from 'jsonwebtoken';
//import bcrypt from 'bcrypt';
//import { secretOrKey } from '#constants';
import RouteController from '#rtControllers/route.controller.js';

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
		this.uploadAvi = this.uploadAvi.bind(this);

		this.login = this.login.bind(this);
		this.register = this.create;
		this.#handleErr = super.handleErr;
		this.#handleSuccess = super.handleSuccess;
		this.#handleLimits = super.handleLimits;
	}

	#handleSuccess;
	#handleErr;
	#handleLimits;

	#stripPassword(userObject) {
		if (!userObject) {
			throw new Error('Cannot strip password from null/undefined user object');
		}

		const userData = userObject.dataValues || userObject;

		if (!userData) {
			throw new Error('User data is null/undefined after fallback');
		}

		const { id, email, name, role, username, bio, avatar } = userData;
		return { id, email, name, role, username, bio, avatar };
	}

	#handlePass(res, user, type) {
		if (user) {
			const strippedPassword = this.#stripPassword(user);
			this.#handleSuccess(res, strippedPassword);
		} else {
			const err = new Error();
			this.#handleErr(res, err, type);
		}
	}

	#stripUsersListPasswords(usersList) {
		let pwStrippedList = [];
		Object.entries(usersList).forEach(([id, userData]) => {
			pwStrippedList.push(this.#stripPassword(userData));
		});
		return pwStrippedList;
	}
	/**
	 * TODO: UPDATE loops to handle for non-incrementation or strings
	 */
	#formatUsersList(usersList) {
		let formattedList = {};

		for (let i = 0; i < usersList.length; i++) {
			const id = usersList[i].dataValues.id;
			const userData = usersList[i].dataValues;
			formattedList[id] = userData;
		}
		return formattedList;
	}

	#handleUsers(res, users) {
		const formattedList = this.#formatUsersList(users);
		const filteredUsers = this.#stripUsersListPasswords(formattedList);
		if (users.length > 0) {
			this.#handleSuccess(res, filteredUsers);
		} else {
			const errorVar = new Error();
			this.#handleErr(res, errorVar, 'empty');
		}
	}

	/***
	 * TODO:  Needs error trapping for no existing chats
	 */
	async getMany(req, res) {
		let errorVar;
		const { role, full, page, page_size } = req.query;
		const { limit, offset } = this.#handleLimits(page, page_size);

		//const {role, full, limit, offset} = req.query;
		const fullBool = full === 'true';

		if (role) {
			try {
				const users = await User.getUsersByRole(role, fullBool, limit, offset);
				this.#handleUsers(res, users);
			} catch (err) {
				errorVar = !(err instanceof Error) ? new Error(err) : err;
				this.#handleErr(res, errorVar, 'role');
			}
		} else {
			try {
				const users = await User.getAllUsers(fullBool, limit, offset);
				this.#handleUsers(res, users);
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
				errorVar = new Error();
				this.#handleErr(res, errorVar, type);
				break;
		}
	}

	// Create
	async create(req, res) {
		const { username, email, password, name, bio, role, avatar } = req.body;

		if (!role) {
			return this.#handleErr(res, new Error('Role is required for user creation'));
		}
		const roleLower = role.toLowerCase();

		try {
			const userData = { username, password, role: roleLower, email, name, bio };

			// Include avatar if provided via file upload
			if (req.file) {
				// Store as URL path (e.g., /uploads/avatars/users/filename.jpg)
				userData.avatar = `/${req.file.path}`;
			} else if (avatar) {
				// Include avatar if provided as text field (file path)
				userData.avatar = avatar;
			}

			const user = await User.createUser(userData);
			const strippedPassword = this.#stripPassword(user);
			this.#handleSuccess(res, strippedPassword);
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}

	// Upload Avatar
	async uploadAvi(req, res) {
		try {
			if (!req.file) {
				return this.#handleErr(res, new Error('No file uploaded'));
			}

			const { userId } = req.body;
			if (!userId) {
				return this.#handleErr(res, new Error('User ID is required'));
			}

			// Store the URL path in the database (e.g., /uploads/avatars/users/filename.jpg)
			const avatarPath = `/${req.file.path}`;

			// Update user record with avatar path
			await User.updateUser({
				id: userId,
				avatar: avatarPath
			});

			// Get the updated user to return in response
			const updatedUser = await User.getUserByID(userId, false);
			const userResponse = this.#stripPassword(updatedUser);

			this.#handleSuccess(res, {
				message: 'Avatar uploaded successfully',
				user: userResponse,
				avatar: {
					filename: req.file.filename,
					originalName: req.file.originalname,
					path: avatarPath,
					url: avatarPath, // Same as path now since it's the URL
					size: req.file.size,
					mimetype: req.file.mimetype
				}
			});
		} catch (err) {
			const errorVar = !(err instanceof Error) ? new Error(err) : err;
			this.#handleErr(res, errorVar);
		}
	}
	// Update

	async update(req, res) {
		const newUser = req.body;
		try {
			const updatedRows = await User.updateUser(newUser);
			this.#handleSuccess(res, { updatedRows, newUser });
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
			this.#handleSuccess(res, deletedRows);
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
