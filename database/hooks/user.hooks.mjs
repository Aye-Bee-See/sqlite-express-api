import {hash} from 'bcrypt';

export default  {
    beforeCreate: async function hashPass(record, options) {
        const hashedPass = await hash(record.password, 10);
        record.password = hashedPass;
                 
    },
    afterCreate: (instance, options)=>{

        
    }
};


