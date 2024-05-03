# Aye Bee See

## Routes
Message
Prison
Prisoner
Rule
User

### User Model
localhost:3000/auth

Create:
POST /register-admin - Registers a user with a role of Admin

Read:
GET /users - Read all users
GET /user - Read individual user by ID.  ID should be in request body as "id".

Login:
POST /login - Logs in as user
body variables:
"name", "password"

### Prison Model




Variables:
id - Int - Auto-created - Autoincrementing
name - String
password - String
role - String - Automatically set to "Admin" currently
email - String
createdAt - Date - Automatically set
updatedAt - Date - Automatically set


## TODOS

### Breaking
Currently a prison can only have one prisoner

### Non-breaking
When creating server create admin user
Make IDs UUID instead of incrementing variables
Don't show hashed password in response to create user
Validate and rinse parameters
Ensure CRUD operations exist for all tables
Protect the necessary routes
All additional roles and check roles for permissions
Switch any GET requests with body requirements to URL parameters
Set "force: true" in sequelize.sync in sql-database.js only in certain destructive environment