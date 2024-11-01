import express,{Router as router} from 'express';
import {default as bodyParser} from 'body-parser';
import {default as passport} from 'passport';
import {messageEnd} from '#routes/constants.js';
import {default as messageCrtlr} from "#rtControllers/message.controller.js";
import authService from "#rtServices/auth.services.mjs";

class MessageRoutes {

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
       
       this.#Controller= new messageCrtlr;
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

        this.Router.post(messageEnd.post.create, this.#Controller.create);

// Read

        this.Router.get(messageEnd.get.many, this.#Controller.getMany);
        this.Router.get(messageEnd.get.one, this.#Controller.getOne);

// Update

        this.Router.put(messageEnd.put.update, this.#Controller.update);


// Delete

        this.Router.delete(messageEnd.delete.remove, this.#Controller.remove);
    }
}


export default MessageRoutes;

