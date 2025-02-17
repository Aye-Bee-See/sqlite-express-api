import Chat from '#models/chat.model.mjs';
import Message from '#models/message.model.mjs';
import Prison from '#models/prison.model.mjs';
import Prisoner from '#models/prisoner.model.mjs';
import Rule from '#models/rule.model.mjs';
import User from "#models/user.model.mjs";
import Chapter from "#models/chapter.model.mjs"


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

export {Chat, Chapter, Message, Prison, Prisoner, Rule, User};

