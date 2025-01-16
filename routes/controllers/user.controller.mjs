import User from "#models/user.model.mjs";
import {default as jwt} from "jsonwebtoken";
import bcrypt from "bcrypt";
import {userMsg} from '#routes/constants.js';
import {default as Utls} from "#services/Utilities.js";
import {secretOrKey} from '#constants';
import RouteController from "#rtControllers/route.controller.js";
import passport from 'passport'; // Add this line

export default class UserController extends RouteController {

    constructor() {
        /* 
         * If we use class methods as subfunctions (or callbacks)
         * JS loses where we are and thinks this is is something
         * other than the instance of our class
         */

        super("user");
        this.getMany = this.getMany.bind(this);
        this.getOne = this.getOne.bind(this);
        this.update = this.update.bind(this);
        this.create = this.create.bind(this);
        this.remove = this.remove.bind(this);

        this.protect = this.protect.bind(this);
        this.login = this.login.bind(this);
        this.register = this.create;
        this.#handleErr = super.handleErr;
        this.#handleSuccess = super.handleSuccess;
    }

    #handleSuccess;
    #handleErr;

    #stripPassword(userObject) {
        const {id, email, name, role, username, bio} = userObject;
        return {id, email, name, role, username, bio};
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

    /*
     * Todo:
     * 
     * Needs to handle for email login
     */
    async #handleLogin(res, userProps) {
        const {username, email, password} = userProps;
        try {
            const user = await User.getUser({username});
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                const now = Date.now();
                const weekInMilliseconds = 6.048e+8;
                const expiryDateMs = now + weekInMilliseconds;

                let payload = {id: user.id, expiry: expiryDateMs};
                let token = jwt.sign(payload, secretOrKey, {expiresIn: '1w'});
                this.#handleSuccess(res, {token, expires: expiryDateMs});
            } else {
                const err = new Error();
                this.#handleErr(res, err)
            }
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

    #stripUsersListPasswords(usersList) {
        let pwStrippedList = [];
        Object.entries(usersList).forEach(([key, value]) => {
            pwStrippedList.push(this.#stripPassword(value));
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
            const err = new Error();
            this.#handleErr(res, err, "empty");
        }
    }

    /***
     * TODO:  Needs error trapping for no existing chats
     */
    async getMany(req, res, next) {

        const {role, full} = req.query;
        const fullBool = (full === 'true');
        if (role) {
            try {
                const users = await User.getUsersByRole(role, fullBool);
                this.#handleUsers(res, users);
            } catch (err) {
                err = !(err instanceof Error) ? new Error(err) : err;
                this.#handleErr(res, err, "role");
            }
        } else {
            try {
                const users = await User.getAllUsers(fullBool);
                this.#handleUsers(res, users);
            } catch (err) {
                err = !(err instanceof Error) ? new Error(err) : err;
                this.#handleErr(res, err);
            }
        }
    }

// get one user
    /**
     * TODO:  At least get by email should be case insensitive if not everything
     */
    async getOne(req, res) {
        const {id, email, username, full} = req.query;
        const fullBool = (full === 'true');

        const type = req.query.id ? "id" : req.query.email ? "mail" : req.query.username ? "name" : "empty";

        switch (type) {
            case "id":
                try {
                    const user = await User.getUserByID(id, fullBool);
                    this.#handlePass(res, user, type);
                } catch (err) {
                    err = !(err instanceof Error) ? new Error(err) : err;
                    this.#handleErr(res, err, type);
                }
                break;
            case "mail":
                try {
                    const user = await User.getUserByEmail(email, fullBool);
                    this.#handlePass(res, user, type);
                } catch (err) {
                    err = !(err instanceof Error) ? new Error(err) : err;
                    this.#handleErr(res, err, type);
                }
                break;
            case "name":
                try {
                    const user = await User.getUserByUsername(username, fullBool);
                    this.#handlePass(res, user, type);
                } catch (err) {
                    err = !(err instanceof Error) ? new Error(err) : err;
                    this.#handleErr(res, err, type);
                }
                break;
            default:
                const err = new Error();
                this.#handleErr(res, err, type);
                break;
        }
    }
    // protected route
    async protect(req, res)
    {
        this.#handleSuccess(res);
    }

    async create(req, res, next) {
        const {username, email, password, name, bio} = req.body;
        const role = req.body.role.toLowerCase();
        try {
            const user = await User.createUser({username, password, role, email, name, bio});
            const strippedPassword = this.#stripPassword(user);
            this.#handleSuccess(res, strippedPassword);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }
// Update

    async update(req, res)
    {
        const newUser = req.body;
        try {
            const updatedRows = await User.updateUser(newUser);
            this.#handleSuccess(res, {updatedRows, newUser});
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

// Delete
    async remove(req, res)
    {
        const {id} = req.body;
        try {
            const deletedRows = await User.deleteUser(id);
            this.#handleSuccess(res, deletedRows);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

// login route
    async login(req, res, next) {
        passport.authenticate('LStrat', (err, user, info) => {
            if (err) {
                return this.#handleErr(res, err);
            }
            if (!user) {
                return res.status(401).json({ error: info.message });
            }
            const token = req.authInfo.token;
            const strippedUser = this.#stripPassword(user);
            this.#handleSuccess(res, { user: strippedUser, token });
        })(req, res, next);
    }

}

