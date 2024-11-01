import express,{Router as router} from 'express';
import {default as bodyParser} from 'body-parser';
import {default as passport} from 'passport';
import {userEnd} from '#routes/constants.js';
import {default as userCrtlr} from "#rtControllers/user.controller.mjs";
import authService from "#rtServices/auth.services.mjs";

class UserRoutes {

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
       
       this.#Controller= new userCrtlr;
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
        this.Router.post(userEnd.post.create, this.#Controller.create);
        
        // Read
        this.Router.get(userEnd.get.many, this.#Controller.getMany);
        this.Router.get(userEnd.get.one, this.#Controller.getOne);
        
        // Update
        this.Router.put(userEnd.put.update, this.#Controller.update);
        
        // Delete
        this.Router.delete(userEnd.delete.remove, this.#Controller.remove);
    }
}


export default UserRoutes;
