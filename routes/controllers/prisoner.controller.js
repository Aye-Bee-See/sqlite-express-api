

import Prisoner from "#models/prisoner.model.mjs"
import {default as jwt} from "jsonwebtoken"
import bcrypt from "bcrypt";
import {prisonerMsg} from '#routes/constants.js'
import {default as Utls} from "#services/Utilities.js"
//import Logger from "#dbg/Logger"

export default class prisonerController {

    constructor() {
        /* 
         * If we use class methods as subfunctions (or callbacks)
         * JS loses where we are and thinks this is is something
         * other than the instance of our class
         */
        this.getList = this.getList.bind(this);
        this.getPrisoner = this.getPrisoner.bind(this);
        this.update = this.update.bind(this);
        this.remove = this.remove.bind(this);
        this.create = this.create.bind(this);


    }

    #formatMessagesList(messagesList) {
        let formattedList = {};

        for (let i = 0; i < messagesList.length; i++) {
            const id = messagesList[i].dataValues.id;
            const prisonerData = messagesList[i].dataValues;
            formattedList[id] = prisonerData;
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
        const msgRef = ["getPrisoner", "getList"].includes(callerName) ? callerName.toLowerCase().substring(3) : callerName;
        console.log({msgRef});
        const {method} = stack;
        let message = {};
        message['data'] = {...outObj};
        message['info'] = prisonerMsg[method][msgRef].success.condition[condition];

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
        const msgRef = ["getPrisoner", "getList"].includes(callerName) ? callerName.toLowerCase().substring(3) : callerName;
        const {method} = stack;
        const info = prisonerMsg[method][msgRef].error.condition[msgType];
        const message = errMsg ? {info: info, type: errMsg.name, error: errMsg.message, stack: errMsg.stack.toString()} : {info: info};

        res.status(400).json(message);
    }

    async getList(req, res, next) {
        const {prison} = req.query;
        if (prison) {
            this.getListByPrison(req, res);
        }
        try {
            const rules = await Prisoner.getAllPrisoners();
            this.#handleSuccess(res, rules);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }


    }

    async getListByPrison(req, res) {
        const {prison} = req.query;
        try {
            const prisoner = await Prisoner.getPrisonersByPrison(prison);
            this.#handleSuccess(res, prisoner);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

    // get one prisoner

    async getPrisoner(req, res) {
        const {id, full} = req.query;
        const fullBool = (full === 'true');
        try {
            const prisoner = await Prisoner.getPrisonerByID(id, fullBool);
            this.#handleSuccess(res, prisoner);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }
    // Create
    async create(req, res) {
        const { birthName, chosenName, prison, inmateID, releaseDate, bio, status } = req.body;
        try {
            const prisoner = await Prisoner.createPrisoner({ birthName, chosenName, prison, inmateID, releaseDate, bio, status });
            this.#handleSuccess(res, prisoner);
            // res.status(200).json({msg: ruleMsg.post.create.success.condition.par, rule});
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

    // Update

    async update(req, res)
    {
        const newPrisoner = req.body;
        try {
            const updatedRows = await Prisoner.updatePrisoner(newPrisoner);
            this.#handleSuccess(res, {updatedRows, newPrisoner});
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
            const deletedRows = await Prisoner.deleteRule(id);
            this.#handleSuccess(res, deletedRows);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

}
