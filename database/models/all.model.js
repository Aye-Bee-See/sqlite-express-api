import Chat from '#models/chat.model.js';
import Message from '#models/message.model.js';
import Prison from '#models/prison.model.js';
import Prisoner from '#models/prisoner.model.js';
import User from '#models/user.model.js';
import Chapter from '#models/chapter.model.js';
import PrisonerSupport from '#models/prisoner-support.model.js';
import ClaimToken from '#models/claim-token.model.js';
import MessageStatus from '#models/message-status.model.js';
import Attachment from '#models/attachment.model.js';
import LetterKey from '#models/letter-key.model.js';
import Submission from '#models/submission.model.js';
import AuditLog from '#models/audit-log.model.js';
import OrgMemberKey from '#models/org-member-key.model.js';
import RevokedToken from '#models/revoked-token.model.js';
import SessionRun from '#models/session-run.model.js';
import Invitation from '#models/invitation.model.js';
import MailRule from '#models/mail-rule.model.js';

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

export {
	Attachment,
	AuditLog,
	Chat,
	Chapter,
	ClaimToken,
	LetterKey,
	Message,
	MessageStatus,
	OrgMemberKey,
	Prison,
	Prisoner,
	PrisonerSupport,
	RevokedToken,
	SessionRun,
	Invitation,
	MailRule,
	Submission,
	User
};
