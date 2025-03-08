
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

    }

    #handleSuccess;
    #handleErr;

    async getMany(req, res, next) {
        const {id, chat, prisoner, user} = req.query;
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
            }default:
            {
                try {
                    const rules = await Message.readAllMessages();
                    this.#handleSuccess(res, rules);
                } catch (err) {
                    err = !(err instanceof Error) ? new Error(err) : err;
                    this.#handleErr(res, err);
                }
                break;
            }
        }
    }

    async getMessagesById(req, res) {
        const {id} = req.query;
        try {
            const messages = await Message.readMessageById(id);
            this.#handleSuccess(res, messages);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }
    async getMessagesByChat(req, res) {
        const {chat} = req.query;
        try {
            const messages = await Message.readMessagesByChat(chat);
            this.#handleSuccess(res, messages);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }
    
    async getMessagesByPrisoner(req, res) {
        const {prisoner} = req.query;
        try {
            const messages = await Message.readMessagesByPrisoner(prisoner);
            this.#handleSuccess(res, messages);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }
    
    async getMessagesByUser(req, res) {
        const {user} = req.query;
        try {
            const messages = await Message.readMessagesByUser(user);
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
            const deletedRows = await Message.deleteMessage(id);
            this.#handleSuccess(res, deletedRows);
        } catch (err) {
            err = !(err instanceof Error) ? new Error(err) : err;
            this.#handleErr(res, err);
        }
    }
}