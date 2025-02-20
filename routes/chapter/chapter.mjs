import express,{Router as router} from 'express';
import {default as bodyParser} from 'body-parser';
import {default as passport} from 'passport';
import {chapterEnd} from '#routes/constants.js';
import * as chapterCtrlr from "#rtControllers/chapter.controller.js";
import authService from "#rtServices/auth.services.mjs";

class ChapterRoutes {
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
         passport.use('UsrJStrat', JwtStrat);
         
         this.#Controller= new chapterCtrlr.default;
         this.Router = express.Router();
  
         this.#router();
     }
     static #router(){

      // Create
      
              this.Router.post(chapterEnd.post.create, passport.authenticate('UsrJStrat', { session: false, failWithError: true }), this.#Controller.create);
      
      // Read
      
              this.Router.get(chapterEnd.get.many, passport.authenticate('UsrJStrat', { session: false, failWithError: true }), this.#Controller.getMany);
      
              this.Router.get(chapterEnd.get.one, passport.authenticate('UsrJStrat', { session: false, failWithError: true }), this.#Controller.getOne);
      
      // Update
      
              this.Router.put(chapterEnd.put.update, passport.authenticate('UsrJStrat', { session: false, failWithError: true }), this.#Controller.update);
      
      // Delete
      
              this.Router.delete(chapterEnd.delete.remove, passport.authenticate('UsrJStrat', { session: false, failWithError: true }), this.#Controller.remove);
     }

}

export default ChapterRoutes;