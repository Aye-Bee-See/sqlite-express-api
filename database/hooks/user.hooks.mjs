import {hash} from 'bcrypt';
//import Logger from "#dbg/logger";
//const dbg=new Logger;
export default  {
    beforeCreate: async function hashPass(record, options) {
        console.log("%o", record.dataValues);
        const hashedPass = await hash(record.password, 10);
        record.password = hashedPass;
                 
    },
    afterSave: (a, b, c)=>{
      //  dbg.output_base_colors();
      
       // console.log({b});
       // console.log({c});
      // dbg.term("test");
        //dbg.term("test");
        
    }
};


