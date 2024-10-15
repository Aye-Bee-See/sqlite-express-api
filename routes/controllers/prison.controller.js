


import Prison from "#models/prison.model.mjs"
import {default as jwt} from "jsonwebtoken"
import bcrypt from "bcrypt";
import {prisonMsg} from '#routes/constants.js'
import {default as Utls} from "#services/Utilities.js"
//import Logger from "#dbg/Logger"

export default class prisonController {

    constructor() {
        /* 
         * If we use class methods as subfunctions (or callbacks)
         * JS loses where we are and thinks this is is something
         * other than the instance of our class
         */
        this.getList = this.getList.bind(this);
        this.getPrison = this.getPrison.bind(this);
        this.update = this.update.bind(this);
        this.remove = this.remove.bind(this);
        this.create = this.create.bind(this);


    }

    #formatMessagesList(messagesList) {
        let formattedList = {};

        for (let i = 0; i < messagesList.length; i++) {
            const id = messagesList[i].dataValues.id;
            const prisonData = messagesList[i].dataValues;
            formattedList[id] = prisonData;
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
        const msgRef = ["getPrison", "getList"].includes(callerName) ? callerName.toLowerCase().substring(3) : callerName;
        console.log({msgRef});
        const {method} = stack;
        let message = {};
        message['data'] = {...outObj};
        message['info'] = prisonMsg[method][msgRef].success.condition[condition];

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
        const msgRef = ["getPrison", "getList"].includes(callerName) ? callerName.toLowerCase().substring(3) : callerName;
        const {method} = stack;
        const info = prisonMsg[method][msgRef].error.condition[msgType];
        const message = errMsg ? {info: info, type: errMsg.name, error: errMsg.message, stack: errMsg.stack.toString()} : {info: info};

        res.status(400).json(message);
    }

    async getList(req, res, next) {
        try {
            const rules = await Prison.getAllPrisons();
            this.#handleSuccess(res, rules);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }


    }

    // get one prison

    async getPrison(req, res) {
        const {id, full} = req.query;
        const fullBool = (full === 'true');
        try {
            const prison = await Prison.getPrisonByID(id, fullBool);
            this.#handleSuccess(res, prison);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }
    // Create
    async create(req, res) {
        const { prisonName, address } = req.body;
        try {
            const prison = await Prison.createPrison({ prisonName, address });
            this.#handleSuccess(res, prison);
            // res.status(200).json({msg: ruleMsg.post.create.success.condition.par, rule});
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

    // Update

    async update(req, res)
    {
        const newPrison = req.body;
        try {
            const updatedRows = await Prison.updatePrison(newPrison);
            this.#handleSuccess(res, {updatedRows, newPrison});
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }
    
    async addRule(req, res)
    {
        const { rule, prison } = req.body;
        
        try {
            const updatedRows = await Prison.addRule(rule, prison);;
            this.#handleSuccess(res, {updatedRows, rule, prison});
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
            const deletedRows = await Prison.deleteRule(id);
            this.#handleSuccess(res, deletedRows);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

}
