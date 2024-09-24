
import User from "#models/user.model.mjs"
import {default as jwt} from "jsonwebtoken"
import bcrypt from "bcrypt";
import {userMsg} from '#routes/constants.js'
import {default as Utls} from "#services/Utilities.js"

export default class userController {

    #msgObjs;

    constructor() {
        /* 
         * If we use class methods as subfunctions (or callbacks)
         * JS loses where we are and thinks this is is something
         * other than the instance of our class
         */
        this.register = this.register.bind(this);
        this.getList = this.getList.bind(this);
        this.getUser = this.getUser.bind(this);
        this.protect = this.protect.bind(this);
        this.update = this.update.bind(this);
        this.login = this.login.bind(this);
        this.remove = this.remove.bind(this);


    }
    #stripPassword(userList) {
        return userList.map((user) => {
            const {id, email, name, role, username, bio} = user;
            return {id, email, name, role, username, bio};
        });
    }

    #handlePass(res, user, type) {

        if (user) {
            const strippedPassword = this.#stripPassword([user])[0];
            this.#handleSuccess(res, {user: strippedPassword});
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
                let token = jwt.sign(payload, process.env.JWT_SECRET, {expiresIn: '1w'});
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

    #handleUsers(res, users) {
        const filteredUsers = this.#stripPassword(users);
        if (users.length > 0) {
            this.#handleSuccess(res, filteredUsers);
        } else {
            const err = new Error();
            this.#handleErr(res, err, "empty");
        }
    }

    #findStack(res) {
        let stack;
        res.req.route.stack.forEach((layer) => {
            const fname = layer.name.substr(6);
            if (this.hasOwnProperty(fname)) {
                stack = layer;
            }
        });
        return stack;
    }

    #handleSuccess(res, outObj = {}, condition = "par") {

        const stack = this.#findStack(res);
        const callerName = stack.name.substr(6);
        const msgRef = ["getUser", "getList"].includes(callerName) ? callerName.toLowerCase().substring(3) : callerName;
        const {method} = stack;
        const info = userMsg[method][msgRef].success.condition[condition];
        const message = {...outObj, info: info};

        res.status(200).json(message);
    }
    /**
     * Todo:
     * 
     * Transition to using constants file
     */
    #handleErr(res, errMsg = null, msgType = "par") {
        const stack = this.#findStack(res);
        const callerName = stack.name.substr(6);
        const msgRef = ["getUser", "getList"].includes(callerName) ? callerName.toLowerCase().substring(3) : callerName;
        const {method} = stack;
        const info = userMsg[method][msgRef].error.condition[msgType];
        const message = errMsg ? {info: info, type: errMsg.name, error: errMsg.message, stack: errMsg.stack.toString()} : {info: info};

        res.status(400).json(message);
    }

    /***
     * TODO:  Needs error trapping for no existing chats
     */
    async getList(req, res, next) {

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
    async getUser(req, res) {
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

    async register(req, res, next) {
        const {username, email, password, name, bio} = req.body;
        const role = req.body.role.toLowerCase();
        try {
            const user = await User.createUser({username, password, role, email, name, bio});
            const strippedPassword = this.#stripPassword([user])[0];
            this.#handleSuccess(res, {user: strippedPassword});
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
    async login(req, res, next)
    {


        if (req.isAuthenticated()) {
            const token = req.authInfo.token;
            const user = req.user;
            this.#handleSuccess(res, {user, token});
        } else {
            this.#handleErr(res)
        }

    }

}

