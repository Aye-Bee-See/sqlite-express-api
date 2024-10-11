
import Rule from "#models/rule.model.mjs"
import {default as jwt} from "jsonwebtoken"
import bcrypt from "bcrypt";
import {ruleMsg} from '#routes/constants.js'
import {default as Utls} from "#services/Utilities.js"
import Logger from "#dbg/Logger"

export default class ruleController {

    constructor() {
        /* 
         * If we use class methods as subfunctions (or callbacks)
         * JS loses where we are and thinks this is is something
         * other than the instance of our class
         */
        this.getList = this.getList.bind(this);
        this.getRule = this.getRule.bind(this);
        this.update = this.update.bind(this);
        this.remove = this.remove.bind(this);


    }

    #formatMessagesList(messagesList) {
        let formattedList = {};

        for (let i = 0; i < messagesList.length; i++) {
            const id = messagesList[i].dataValues.id;
            const ruleData = messagesList[i].dataValues;
            formattedList[id] = ruleData;
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
        const msgRef = ["getRule", "getList"].includes(callerName) ? callerName.toLowerCase().substring(3) : callerName;
        const {method} = stack;
        let message_object = {...outObj};
        message_object['info'] = ruleMsg[method][msgRef].success.condition[condition];
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
        const info = ruleMsg[method][msgRef].error.condition[msgType];
        const message = errMsg ? {info: info, type: errMsg.name, error: errMsg.message, stack: errMsg.stack.toString()} : {info: info};

        res.status(400).json(message);
    }

    /***
     * TODO:  Needs error trapping for no existing chats
     */
    async getList(req, res, next) {
            const {prison} = req.query;
            if (!prison) {
                Rule.getAllRules()
                        .then(rules => res.status(200).json(rules))
                        .catch(err => res.status(400).json({msg: ruleMsg.get.list.success.condition.par, err}));
            } else {

                Rule.getRulesByPrison(prison).then(rules => res.status(200).json(rules))
                        .catch(err => {
                            let sqliteError = ""
                            // if (err.original.errno === 1) { sqliteError =  "That prison doesn't exist."}
                            res.status(400).json({msg: ruleMsg.get.list.error.condition.par, err})
                        }
                        )
            }
    }

    // get one rule

    async getRule(req, res) {
        const {id, full} = req.query;
        const fullBool = (full === 'true');
        try {
            const rule = await Rule.getRuleByID(id, fullBool);
            res.status(200).json(rule);
        } catch (err) {
            res.status(400).json({msg: ruleMsg.get.rule.error.condition.par, err});
        }
    }
    // Create
    async create(req, res) {
        const {title, description} = req.body;
        try {
            const rule = await Rule.createRule({title, description});
            res.status(200).json({msg: ruleMsg.post.create.success.condition.par, rule});
        } catch (err) {
            res.status(400).json({msg: ruleMsg.post.create.error.condition.par, err});
        }
    }

    // Update

    async update(req, res)
    {
        const newRule = req.body;
        try {
            const updatedRows = await Rule.updateRule(newRule);
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
            const deletedRows = await Rule.deleteRule(id);
            this.#handleSuccess(res, deletedRows);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

}


