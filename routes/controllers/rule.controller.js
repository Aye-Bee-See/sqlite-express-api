
import Rule from "#models/rule.model.mjs"
import {default as jwt} from "jsonwebtoken"
import bcrypt from "bcrypt";
import {ruleMsg} from '#routes/constants.js'
import {default as Utls} from "#services/Utilities.js"
import RouteController from "#rtControllers/route.controller.js";

export default class ruleController extends RouteController {

    constructor() {
        /* 
         * If we use class methods as subfunctions (or callbacks)
         * JS loses where we are and thinks this is is something
         * other than the instance of our class
         */
        super("rule");
        this.getMany = this.getMany.bind(this);
        this.getOne = this.getOne.bind(this);
        this.update = this.update.bind(this);
        this.remove = this.remove.bind(this);
        this.create = this.create.bind(this);

        this.#handleErr = super.handleErr;
        this.#handleSuccess = super.handleSuccess;

    }

    #handleSuccess;
    #handleErr;
    #handleLimits;
    /***
     * TODO:  Needs error trapping for no existing chats
     */
    async getMany(req, res, next) {
        const {prison} = req.query;
        if (prison) {
            this.getListByPrison(req, res);
        }
        try {
            const rules = await Rule.getAllRules();
            this.#handleSuccess(res, rules);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }


    }

    async getListByPrison(req, res) {
        const {prison} = req.query;
        try {
            const rule = await Rule.getRulesByPrison(prison);
            this.#handleSuccess(res, rule);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

    // get one rule

    async getOne(req, res) {
        const {id, full} = req.query;
        const fullBool = (full === 'true');
        try {
            const rule = await Rule.getRuleByID(id, fullBool);
            this.#handleSuccess(res, rule);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }
    // Create
    async create(req, res) {
        const {title, description} = req.body;
        try {
            const rule = await Rule.createRule({title, description});
            this.#handleSuccess(res, rule);
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


