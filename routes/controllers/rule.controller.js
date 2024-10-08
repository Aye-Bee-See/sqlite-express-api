
import Rule from "#models/rule.model.mjs"
import {default as jwt} from "jsonwebtoken"
import bcrypt from "bcrypt";
import {userMsg} from '#routes/constants.js'
import {default as Utls} from "#services/Utilities.js"

export default class ruleController {

    #msgObjs;

    constructor() {
        /* 
         * If we use class methods as subfunctions (or callbacks)
         * JS loses where we are and thinks this is is something
         * other than the instance of our class
         */
        this.register = this.register.bind(this);
        this.getList = this.getList.bind(this);
        this.getRule = this.getRule.bind(this);
        this.protect = this.protect.bind(this);
        this.update = this.update.bind(this);
        this.remove = this.remove.bind(this);


    }

    #formatMessagesList(messagesList) {
        let formattedList = {};

        for (let i = 0; i < messagesList.length; i++) {
            const id = messagesList[i].dataValues.id;
            const userData = messagesList[i].dataValues;
            formattedList[id] = userData;
        }
        return formattedList;
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
        let message_object = {...outObj};
        message_object['info'] = userMsg[method][msgRef].success.condition[condition];
        const message = message_object;

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
        const msgRef = ["getRule", "getList"].includes(callerName) ? callerName.toLowerCase().substring(3) : callerName;
        const {method} = stack;
        const info = userMsg[method][msgRef].error.condition[msgType];
        const message = errMsg ? {info: info, type: errMsg.name, error: errMsg.message, stack: errMsg.stack.toString()} : {info: info};

        res.status(400).json(message);
    }

    /***
     * TODO:  Needs error trapping for no existing chats
     */
    async getList(req, res, next) {

    }

// get one user
    /**
     * TODO:  At least get by email should be case insensitive if not everything
     */
    async getRule(req, res) {

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
        const newRule = req.body;
        try {
            const updatedRows = await Rule.updateUser(newRule);
            this.#handleSuccess(res, {updatedRows, newRule});
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

}


