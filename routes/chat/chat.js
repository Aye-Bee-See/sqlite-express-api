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
       
       const JwtStrat = authService.authorize;
       passport.use('JStrat', JwtStrat);
       
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

        this.Router.post(chatEnd.post.create, this.#Controller.create);

// Read

        this.Router.get(chatEnd.get.many, this.#Controller.getMany);
        this.Router.get(chatEnd.get.one, this.#Controller.getOne);


// Update

        this.Router.put(chatEnd.put.update, this.#Controller.update);


// Delete

        this.Router.delete(chatEnd.delete.remove, this.#Controller.remove);
    }
}


export default ChatRoutes;

