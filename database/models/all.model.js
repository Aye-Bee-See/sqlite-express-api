import Chat from '#models/chat.model.js';
import Message from '#models/message.model.js';
import Prison from '#models/prison.model.js';
import Prisoner from '#models/prisoner.model.js';
import Rule from '#models/rule.model.js';
import User from "#models/user.model.js";


/********************************************
 * How to understand sequelize associations *
 ********************************************
O:O

// foreign key has to be defined on both sides.
Parent.hasOne(Child, {foreignKey: 'Parent_parentId'})
// "Parent_parentId" column will exist in the "belongsTo" table.
Child.belongsTo(Parent, {foreignKey: 'Parent_parentId'})

O:M

Parent.hasMany(Child, {foreignKey: 'Parent_parentId'})
Child.belongsTo(Parent, {foreignKey: 'Parent_parentId'})

N:M

Parent.belongsToMany(
    Child, 
    {
        // this can be string (model name) or a Sequelize Model Object Class
        // through is compulsory since v2
        through: 'Parent_Child',

        // GOTCHA
        // note that this is the Parent's Id, not Child. 
        foreignKey: 'Parent_parentId'
    }
)


//The above reads:
//"Parents" belongs to many "Children", and is recorded in the "Parent_child" table, using "Parents"'s ID.


Child.belongsToMany(
    Parent, 
    {
        through: 'Parent_Child',

        // GOTCHA
        // note that this is the Child's Id, not Parent.
        foreignKey: 'Child_childId'
    }
)
*/

export {Chat, Message, Prison, Prisoner, Rule, User};

