
import Rule from "#models/rule.model.mjs"
import {default as jwt} from "jsonwebtoken"
import bcrypt from "bcrypt";
import {ruleMsg} from '#routes/constants.js'
import {default as Utilities} from "../../services/Utilities.js";
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

        const {full, page, page_size} = req.query;
        const prison = Utilities.isUndefined(req.query.prison) ? false : req.query.prison;
        const limit = page_size || 10;
        const list_start = (page - 1) || 0;
        const offset = list_start * limit;
        const fullBool = (full === 'true') || false;

        //const prisonId=( && prison >0) || false;
        //  const {prison, limit, offset} = req.query;
        console.group("***** prison & full *****");
        console.log("prison", prison);
        console.log("fullBool", fullBool);
        console.groupEnd();

        if (!prison) {
            try {
                const rules = await Rule.getAllRules(limit, offset);
                this.#handleSuccess(res, rules);
            } catch (err) {
                err = !(err instanceof Error) ? new Error(err) : err;
                this.#handleErr(res, err);
            }
        } else {
            this.getListByPrison(req, res);
        }

    }

    async getListByPrison(req, res) {

        const {prison, full, page, page_size} = req.query;
        const limit = page_size || 10;
        const list_start = (page - 1) || 0;
        const offset = list_start * limit;
        const fullBool = (full === 'true');

        try {
            const rule = await Rule.getRulesByPrison(prison, limit, offset);
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


