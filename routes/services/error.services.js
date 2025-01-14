

export default class ErrorService {
   static handler;
           static  {
        /* 
         * If we use class methods as subfunctions (or callbacks)
         * JS loses where we are and thinks this is is something
         * other than the instance of our class
         */
        console.log("I am init");
        ErrorService.handler=ErrorService.#errorHandler.bind(this);
    }
    static #errorHandler(err, req, res, next) {
        console.group("Error Handler");
        console.group("[");
        console.group("Err");
        console.log(err);
        console.groupEnd();
        console.log("]");
        console.groupEnd();
                console.group("[");
        console.group("req");
        console.log(req);
        console.groupEnd();
        console.log("]");
        console.groupEnd();
        
        console.group("[");
        console.group("res");
        console.log(res);
        console.groupEnd();
        console.log("]");
        console.groupEnd();
        
        
        console.group("[");
        console.group("next");
        console.log(next);
        console.groupEnd();
        console.log("]");
        console.groupEnd();
        
        console.groupEnd();
        if (err) {
            const errStatus = err.statusCode || 500;
            const errMsg = err.message || 'Something went wrong';
            res.status(errStatus).json({
                success: false,
                status: errStatus,
                message: errMsg,
                stack: err.stack
            });
        }
        next();
    }
}