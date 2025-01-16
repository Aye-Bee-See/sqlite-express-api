import express,{Router as router} from 'express';
import {default as bodyParser} from 'body-parser';
import {default as passport} from 'passport';
import {chatEnd} from '#routes/constants.js';
import {default as chatCrtlr} from "#rtControllers/chat.controller.js";
import authService from "#rtServices/auth.services.mjs";

class ChatRoutes {

    static Router;
    static #Controller;

    /************************************************************
     *                                                          *
     *                  STATIC INIT BLOCK                       *
     *                                                          *
     *   Initialize all necessary parts of the class            *
     ************************************************************/
    static {
       const app=express();
       app.use(bodyParser.json());
       app.use(bodyParser.urlencoded({extended: true}));
       app.use(passport.initialize());
       
       const UserJWTStrat = authService.authorize;
       passport.use('UsrJStrat', UserJWTStrat);
       
       this.#Controller= new chatCrtlr;
       this.Router = express.Router();
       

       this.#router();
   }
    /***
     * 
     *   Handle router params
     * 
     ***/
    static #router(){

// Create

        this.Router.post(chatEnd.post.create, passport.authenticate('UsrJStrat', { session: false, failWithError: true }), this.#Controller.create);

// Read

        this.Router.get(chatEnd.get.many, passport.authenticate('UsrJStrat', { session: false, failWithError: true }), this.#Controller.getMany);
        this.Router.get(chatEnd.get.one, passport.authenticate('UsrJStrat', { session: false, failWithError: true }), this.#Controller.getOne);


// Update

        this.Router.put(chatEnd.put.update, passport.authenticate('UsrJStrat', { session: false, failWithError: true }), this.#Controller.update);


// Delete

        this.Router.delete(chatEnd.delete.remove, passport.authenticate('UsrJStrat', { session: false, failWithError: true }), this.#Controller.remove);
    }
}


export default ChatRoutes;

