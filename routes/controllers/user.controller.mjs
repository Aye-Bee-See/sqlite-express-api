//import {User} from "#db/sql-database.mjs"
import User from "#models/user.model.mjs"
import {default as jwt} from "jsonwebtoken"
import bcrypt from "bcrypt";
//import dbgLog from "../../debug/logger.mjs";
export default class userController {

  // dbg;
    constructor() {
        /* 
         * If we use class methods as subfunctions (or callbacks)
         * JS loses where we are and thinks this is is something
         * other than the instance of our class
         */
        this.register = this.register.bind(this);
        this.getAll = this.getAll.bind(this);
        this.getOne = this.getOne.bind(this);
        this.protect = this.protect.bind(this);
        this.update = this.update.bind(this);
        this.login = this.login.bind(this);
        this.remove = this.remove.bind(this);

      // this.dbg = new dbgLog;

    }
    #stripPassword(userList) {
        return userList.map((user) => {
            const {id, email, name, role, username, bio} = user;
            return {id, email, name, role, username, bio};
        });
    }

    #handlePass(res, user) {

        if (user) {
            const strippedPassword = this.#stripPassword([user])[0];
            res.status(200).json({user: strippedPassword})
        } else {
            this.#handleErr(res, "nid");
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
                res.status(200).json({msg: 'ok', token, expires: expiryDateMs});
            } else {
                this.#handleErr(res, "logn")
            }
        } catch (err) {
            this.#handleErr(res, "logn", err);
        }
    }

    #handleUsers(res, users) {
        const filteredUsers = this.#stripPassword(users);
        if (users.length > 0) {
            res.status(200).json(filteredUsers)
        } else {
            this.#handleErr(res, "empty");
        }
    }
    
    /**
     * Todo:
     * 
     * Transition to using constants file
     */
    #handleErr(res, msgType, errMsg = null) {
        const errors = {
            nid: "Error: No such user ID.",
            nusr: "Zero users exist in the database.",
            id: "Error getting user by ID.",
            mail: "Error getting user by email.",
            name: "Error getting user by username.",
            up: "Error updating user.",
            del: "Error deleting user.",
            reg: "Err registering user.",
            list: "Error retrieving user list.",
            role: "Error getting users by role.",
            logn: 'No such user or associated password found.',
            niue: "No ID, username, or email provided.",
            empty: "Error retrieving user list."

        };
        const message = errMsg ? {msg: errors[msgType], errMsg} : {msg: errors[msgType]};
        res.status(400).json(message);
    }

    async getAll(req, res, next) {
        const {role, full} = req.query;
        const fullBool = (full === 'true');
        if (role) {
            try {
                const users = await User.getUsersByRole(role, fullBool);
                this.#handleUsers(res, users);
            } catch (err) {
                this.#handleErr(res, "role", err);
            }
        } else {
            try {
                const users = await User.getAllUsers(fullBool);
                this.#handleUsers(res, users);
            } catch (err) {
                this.#handleErr(res, "list", err);
            }
        }
    }

// get one user
    async getOne(req, res) {
        const {id, email, username, full} = req.query;
        const fullBool = (full === 'true');

        const type = req.query.id ? "id" : req.query.email ? "mail" : req.query.username ? "name" : "niue";

        switch (type) {
            case "id":
                try {
                    const user = await User.getUserByID(id, fullBool);
                    this.#handlePass(res, user);
                } catch (err) {
                    this.#handleErr(res, type, err);
                }
                break;
            case "mail":
                try {
                    const user = await User.getUserByEmail(email, fullBool);
                    this.#handlePass(res, user);
                } catch (err) {
                    this.#handleErr(res, type, err);
                }
                break;
            case "name":
                try {
                    const user = await User.getUserByUsername(username, fullBool);
                    this.#handlePass(res, user);
                } catch (err) {
                    this.#handleErr(res, type, err);
                }
                break;
            default:
                this.#handleErr(res, type);
                break;
        }
    }
    // protected route
    async protect(req, res)
    {
        res.status(200).json({msg: 'Congrats! You are seeing this because you are authorized.'});
    }

    async register(req, res, next) {
        const {username, email, password, name, bio} = req.body;
        const role = req.body.role.toLowerCase();
        try {
            const user = await User.createUser({username, password, role, email, name, bio});
            const strippedPassword = this.#stripPassword([user])[0];
            res.status(200).json({msg: "User successfully created.", user: strippedPassword});
        } catch (err) {
            this.#handleErr(res, "reg", err);
        }
    }
// Update

    async update(req, res)
    {
        const newUser = req.body;
        try {
            const updatedRows = await User.updateUser(newUser);
            res.status(200).json({msg: "Updated user.", updatedRows, newUser});
        } catch (err) {
            this.#handleErr(res, "up", err)
        }
    }

// Delete
    async remove(req, res)
    {
        const {id} = req.body;
        try {
            const deletedRows = await User.deleteUser(id);
            res.status(200).json({msg: "Deleted user.", deletedRows});
        } catch (err) {
            this.#handleErr(res, "del", err);
        }
    }

// login route
    async login(req, res, next)
    {
        const {username, email, password} = req.body;

        if ((username || email) && password) {
            this.#handleLogin(res, req.body);
        } else {
            this.#handleErr(res, "elog")
        }

    }

}

