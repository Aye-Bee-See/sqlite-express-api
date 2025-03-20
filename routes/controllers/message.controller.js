
import Message from "#models/message.model.mjs"
import {default as jwt} from "jsonwebtoken"
import bcrypt from "bcrypt";
import {messageMsg} from '#routes/constants.js'
import {default as Utls} from "#services/Utilities.js"
import RouteController from "#rtControllers/route.controller.js";

export default class MessageController extends RouteController {
    constructor() {
        /* 
         * If we use class methods as subfunctions (or callbacks)
         * JS loses where we are and thinks this is is something
         * other than the instance of our class
         */
        super('message');
        this.getMany = this.getMany.bind(this);
        this.getOne = this.getOne.bind(this);
        this.update = this.update.bind(this);
        this.remove = this.remove.bind(this);
        this.create = this.create.bind(this);

        this.#handleErr = super.handleErr;
        this.#handleSuccess = super.handleSuccess;
        this.#handleLimits=super.handleLimits;

    }

    #handleSuccess;
    #handleErr;
    #handleLimits;

    async getMany(req, res, next) {

        const {id, chat, prisoner, user, full, page, page_size} = req.query;

        const {limit, offset} = this.#handleLimits(page, page_size);
        const fullBool = (full === 'true');

        //const {id, chat, prisoner, user} = req.query;

        const opval = id ? 1 : chat ? 2 : prisoner ? 3 : user ? 4 : 0;
        switch (opval) {
            case 1:
            {
                this.getMessagesById(req, res);
                break;
            }
            case 2:
            {
                this.getMessagesByChat(req, res);
                break;
            }
            case 3:
            {
                this.getMessagesByPrisoner(req, res);
                break;
            }
            case 4:
            {
                this.getMessagesByUser(req, res);
                break;
            }
            default:
            {
                try {
                    const messages = await Message.readAllMessages(limit, offset);
                    console.group("***************messages**********************");
                    console.log(messages);
                    console.groupEnd();
                    this.#handleSuccess(res, messages);
                } catch (err) {
                    err = !(err instanceof Error) ? new Error(err) : err;
                    this.#handleErr(res, err);
                }
                break;
            }
        }
    }

    async getMessagesById(req, res) {

        const {id, full, page, page_size} = req.query;
        const limit = page_size || 10;
        const list_start = (page - 1) || 0;
        const offset = list_start * limit;
        const fullBool = (full === 'true');

        try {
            const messages = await Message.readMessageById(id, fullBool, limit, offset);
            this.#handleSuccess(res, messages);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }
    async getMessagesByChat(req, res) {
        const {chat, full, page, page_size} = req.query;
        const limit = page_size || 10;
        const list_start = (page - 1) || 0;
        const offset = list_start * limit;
        const fullBool = (full === 'true');
        try {
            const messages = await Message.readMessagesByChat(chat, fullBool, limit, offset);
            this.#handleSuccess(res, messages);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

    async getMessagesByPrisoner(req, res) {

        const {prisoner, full, page, page_size} = req.query;
        const limit = page_size || 10;
        const list_start = (page - 1) || 0;
        const offset = list_start * limit;
        const fullBool = (full === 'true');

        try {
            const messages = await Message.readMessagesByPrisoner(prisoner, fullBool, limit, offset);
            this.#handleSuccess(res, messages);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

    async getMessagesByUser(req, res) {
        const {user, full, page, page_size} = req.query;
        const limit = page_size || 10;
        const list_start = (page - 1) || 0;
        const offset = list_start * limit;
        const fullBool = (full === 'true');

        try {
            const messages = await Message.readMessagesByUser(user, fullBool, limit, offset);
            this.#handleSuccess(res, messages);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

    // get one message

    async getOne(req, res) {
        const {id, full} = req.query;
        const fullBool = (full === 'true');
        try {
            const message = await Message.getMessageByID(id, fullBool);
            this.#handleSuccess(res, message);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

    // Create
    async create(req, res) {
        const {messageText, sender, prisoner, user} = req.body;
        try {
            const message = await Message.createMessage({messageText, sender, prisoner, user});
            this.#handleSuccess(res, message);
            // res.status(200).json({msg: ruleMsg.post.create.success.condition.par, rule});
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }

    // Update

    async update(req, res)
    {
        const newMessage = req.body;
        try {
            const updatedRows = await Message.updateMessage(newMessage);
            this.#handleSuccess(res, {updatedRows, newMessage});
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
            const deletedRows = await Message.deleteRule(id);
            this.#handleSuccess(res, deletedRows);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }
}