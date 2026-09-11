# Aye Bee See API

Aye Bee See is a project to make sending a physical letter to an incarcerated person as easy as sending a text message. A person on the outside writes a message in an app; a partner non-profit chapter prints it and mails it; replies flow back the same way.

This repository is the backend HTTP API for that product. It is an Express 5 application backed by a SQLite database through Sequelize. It stores users, prisons, prisoners, prison mail rules, non-profit chapters, and the message threads ("chats") between a user and a prisoner.

This README is written for people who **use** the API: front-end developers, integrators, and testers. If you want to change the API itself, read the [developer guide](docs/DEVELOPER.md).

## Contents

- [Concepts](#concepts)
- [Running the API](#running-the-api)
- [Seed data and test accounts](#seed-data-and-test-accounts)
- [Authentication and roles](#authentication-and-roles)
- [Conventions](#conventions)
- [Endpoint reference](#endpoint-reference)
- [Known quirks](#known-quirks)
- [Postman collection](#postman-collection)

## Concepts

| Term         | Meaning                                                                                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User**     | An account. Has a `role` of `admin`, `user`, `chapter`, or `banned`. A `user` is a person on the outside writing letters; a `chapter` is a partner organisation that prints and mails them; an `admin` manages everything.    |
| **Prison**   | A correctional facility. Has a name and a free-form JSON `address`.                                                                                                                                                           |
| **Prisoner** | An incarcerated person that users can write to. Belongs to one prison. Stores birth name, chosen name, inmate ID, release date, a bio, and a status.                                                                          |
| **Rule**     | A mail rule a prison enforces, such as "No pictures". A rule can be attached to many prisons and a prison can have many rules.                                                                                                |
| **Chat**     | A thread between exactly one user and one prisoner. Chats are created automatically the first time a message is sent between a pair, and can also be created directly.                                                        |
| **Message**  | One letter or text within a chat. `sender` is either `user` or `prisoner`.                                                                                                                                                    |
| **Chapter**  | A local chapter of the partner non-profit. Has a name, a JSON `location`, and some statistics fields. Note that chapter _accounts_ are users with the `chapter` role; the Chapter resource describes the organisation itself. |

All identifiers are auto-incrementing integers. Every record carries `createdAt` and `updatedAt` ISO-8601 timestamps.

Relationships are enforced by the database. A message must point at an existing user and prisoner, a prisoner at an existing prison, and so on. Deleting a record that others still depend on is refused (see [Deletes and referential integrity](#deletes-and-referential-integrity)).

## Running the API

### Prerequisites

- Node.js 18 or newer. Verified on Node 24 and Node 26, on both Intel and Apple Silicon Macs.
- npm.
- No database server. SQLite is bundled through the `sqlite3` npm package, which downloads a prebuilt binary during install.

### Install

```bash
git clone https://github.com/Aye-Bee-See/sqlite-express-api.git
cd sqlite-express-api
npm ci
```

`npm ci` installs exactly what the lockfile pins. The native modules (`sqlite3`, `bcrypt`) have their install scripts pre-approved in `package.json`, so npm 11 will not prompt.

### Configure

Copy `.env.example` to `.env` and edit it. `.env` is git-ignored.

```bash
cp .env.example .env
```

| Variable         | Required | Default                 | Purpose                                                                                                                           |
| ---------------- | -------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`     | Yes      | none                    | Secret used to sign and verify login tokens. Login fails without it.                                                              |
| `PORT`           | Yes      | none                    | TCP port to listen on.                                                                                                            |
| `ADMIN_USERNAME` | No       | none                    | Together with the next two: an administrator account created on boot if no user with this username exists. All three must be set. |
| `ADMIN_PASSWORD` | No       | none                    | Password for that account, at least 7 characters.                                                                                 |
| `ADMIN_EMAIL`    | No       | none                    | Email for that account.                                                                                                           |
| `CORS_ORIGIN`    | No       | `http://localhost:3001` | Browser origins allowed by CORS, comma-separated.                                                                                 |
| `DB_RESET`       | No       | `false`                 | `true` drops every table and replays all migrations on boot. All data is lost.                                                    |
| `DB_SEED`        | No       | `true`                  | `false` skips loading the seed files. Seeding only ever fills empty tables, so leaving it on is safe.                             |
| `DB_LOGGING`     | No       | `false`                 | `true` prints every SQL statement.                                                                                                |
| `DB_STORAGE`     | No       | `database.sqlite`       | Path of the SQLite file. `:memory:` gives a throwaway database (the test suite uses this).                                        |
| `NODE_ENV`       | No       | none                    | `development` adds the underlying error message and stack trace to `500` responses. Leave unset elsewhere.                        |

### Start

```bash
npm start
```

For automatic restarts while developing:

```bash
npm run dev
```

Boot output looks like this:

```text
Express is running on port: 3000
Seed data: users: 41 seeded, prisons: 52 seeded, prisoners: 40 seeded, rules: 44 seeded, chats: 40 seeded, messages: 40 seeded, chapters: 1 seeded.
Created admin account "bootadmin" (id 42).
Database ready.
```

The server accepts connections as soon as the first line prints. `GET /health` answers `503 {"status":"starting"}` until the database is ready and `200 {"status":"ok"}` afterwards; it needs no token.

### Running the tests

```bash
npm test
```

The suite runs against an in-memory database and needs no `.env`. It takes a couple of seconds.

### Data persistence

Data lives in `database.sqlite` in the repository root and **survives restarts**. On the second boot the seed line reads `users: already populated, ...` and nothing is inserted. To start over, delete the file or boot once with `DB_RESET=true`.

Schema changes ship as migrations and are applied automatically on boot, so pulling a new version and starting the server upgrades an existing database in place. A database created before migrations existed is adopted on first boot (you will see `Existing database adopted` once).

### CORS

The server only sends CORS headers for the origins in `CORS_ORIGIN`. Browser clients served from other origins are blocked by the browser. Non-browser clients such as `curl`, Postman, or server-to-server calls are unaffected.

## Seed data and test accounts

On a fresh database the JSON files in `database/seeds/` are loaded:

| Resource  | Rows | Notes                                                                                                                        |
| --------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| Users     | 41   | One admin plus forty regular users.                                                                                          |
| Prisons   | 52   | "Test Prison", then Greek-letter names ("Alpha Prison", "Beta Prison", ...). Each has a one-line street address.             |
| Prisoners | 40   | Prisoner N is in prison N. Each has a birth name, chosen name, inmate ID, release date, and bio. `status` is null.           |
| Rules     | 44   | "No pictures", "No contraband", and so on. Seeded rules are not attached to any prison; attach them with `PUT /prison/rule`. |
| Chats     | 40   | Chat N pairs user N with prisoner N.                                                                                         |
| Messages  | 40   | One short greeting per chat, all sent by the user side.                                                                      |
| Chapters  | 1    | "Test Chapter".                                                                                                              |

### Credentials

| Username             | Password                     | Role    | Email                   |
| -------------------- | ---------------------------- | ------- | ----------------------- |
| `admin`              | `abcpassword`                | `admin` | `admin@localhost`       |
| `user1` ... `user40` | `password1` ... `password40` | `user`  | `user1@example.com` ... |

Plus whatever you configured in `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL`.

The numeric `id` a seeded account receives is **not** guaranteed to match its position in the seed file. In one verified run `admin` was id 3 and `user4` was id 1. Read ids from responses rather than assuming them. This also means "user N is paired with prisoner N" refers to database ids, not to the `userN` usernames.

## Authentication and roles

### Public routes

Only two routes work without a token:

- `POST /auth/user` registers an account. It always gets the `user` role.
- `POST /auth/login` returns a token.

Everything else requires a bearer token.

### Logging in

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"abcpassword"}'
```

```json
{
	"data": {
		"user": {
			"id": 3,
			"name": null,
			"username": "admin",
			"email": "admin@localhost",
			"bio": null,
			"role": "admin",
			"createdAt": "2026-09-11T18:18:17.874Z",
			"updatedAt": "2026-09-11T18:18:17.874Z"
		},
		"token": {
			"token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MywiZXhwaXJ5IjoxNzg5NzU1NTQ3OTA5LCJpYXQiOjE3ODkxNTA3NDcsImV4cCI6MTc4OTc1NTU0N30.hFU0KQ...",
			"expires": 1789755547909
		}
	},
	"info": "Login success.",
	"success": true,
	"status": 200,
	"name": "user login"
}
```

- The login field is `username`, not `name` or `email`.
- The body may be JSON or `application/x-www-form-urlencoded`.
- `data.token.token` is the JWT. `data.token.expires` is the expiry as a Unix timestamp in milliseconds.
- Tokens are valid for **one week**. There is no refresh or logout endpoint; to end a session, discard the token.
- Wrong username or password: `401`. Missing field: `400`. Both use the [general error shape](#general-errors).
- A `banned` account cannot log in, and any token it already holds stops working.

### Using the token

```bash
curl -s http://localhost:3000/prison/prisons \
  -H 'Authorization: Bearer eyJhbGciOi...'
```

A token whose user has since been deleted or banned is rejected with `401`.

### What each role can do

| Action                                                     | `user`                | `chapter` | `admin` |
| ---------------------------------------------------------- | --------------------- | --------- | ------- |
| Read prisons, prisoners, rules, chapters                   | Yes                   | Yes       | Yes     |
| Create, update, delete prisons, prisoners, rules, chapters | No                    | Yes       | Yes     |
| Attach a rule to a prison                                  | No                    | Yes       | Yes     |
| Read, create, update, delete chats and messages            | **Own threads only**  | All       | All     |
| Send a message as the prisoner side (`sender: prisoner`)   | No (forced to `user`) | Yes       | Yes     |
| Read own user record; update or delete own account         | Yes                   | Yes       | Yes     |
| Read, update, delete other users; list users               | No                    | No        | Yes     |
| Change a role, or create a non-`user` account              | No                    | No        | Yes     |

"Own threads" means chats whose `user` is the caller's id, and messages whose `user` is the caller's id. For a `user`:

- List endpoints silently filter to the caller; a `user` or `prisoner` query parameter cannot widen the result.
- Fetching, updating, or deleting someone else's chat or message returns `403`.
- Creating a chat or message always uses the caller's own id as `user`, whatever the body says, and messages are always sent as `user`.

Every refusal is a `403` with the general error shape. A `chapter` account is unrestricted on chats and messages so it can read letters to print and transcribe prisoner replies.

### Creating accounts with other roles

Registration always yields `role: user`. To create a `chapter`, `admin`, or `banned` account, an admin calls the same endpoint with their token:

```bash
curl -s -X POST http://localhost:3000/auth/user \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"username":"chapter1","password":"longenough","email":"chapter1@example.com","role":"chapter","name":"Portland Chapter"}'
```

Without an admin token the same request returns:

```json
{
	"success": false,
	"name": "AuthorizationError",
	"info": "Only an admin can create a user with role \"admin\".",
	"status": 403
}
```

To get the first admin on a fresh database, either log in as the seeded `admin`, or set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ADMIN_EMAIL` before booting. See [Configure](#configure).

## Conventions

### Base URL and mount points

All examples use `http://localhost:3000`. Each resource lives under its own prefix, and the resource name is repeated in the path:

| Prefix       | Resource  | Singular path        | Plural path           |
| ------------ | --------- | -------------------- | --------------------- |
| `/auth`      | Users     | `/auth/user`         | `/auth/users`         |
| `/prison`    | Prisons   | `/prison/prison`     | `/prison/prisons`     |
| `/prisoner`  | Prisoners | `/prisoner/prisoner` | `/prisoner/prisoners` |
| `/rule`      | Rules     | `/rule/rule`         | `/rule/rules`         |
| `/chat`      | Chats     | `/chat/chat`         | `/chat/chats`         |
| `/messaging` | Messages  | `/messaging/message` | `/messaging/messages` |
| `/chapter`   | Chapters  | `/chapter/chapter`   | `/chapter/chapters`   |

Note the odd one out: messages are mounted at `/messaging`, while chats are at `/chat`.

### How to pass identifiers and filters

- **GET** requests take everything as **query-string parameters**: `GET /prison/prison?id=1`.
- **PUT** and **DELETE** requests take the `id` (and any fields) in a **JSON body**. Yes, `DELETE` requests carry a body.
- Path-style ids such as `GET /prison/prison/1` are not supported and return a `404`.

### Request bodies

Send `Content-Type: application/json`. Form-encoded bodies are also parsed. Unknown fields are ignored.

### Response envelope

Every successful response is a JSON object with this shape:

```json
{
	"data": {},
	"info": "Success getting prison by ID",
	"success": true,
	"status": 200,
	"name": "prison one"
}
```

| Field     | Meaning                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| `data`    | The payload: an object, an array, or a number (deleted-row count).                                           |
| `info`    | A human-readable message. `null` on some user endpoints. A few contain typos ("retireved", "Succeessfully"). |
| `success` | Always `true` on this shape.                                                                                 |
| `status`  | `201` for creates, `200` for everything else. Mirrors the HTTP status.                                       |
| `name`    | The resource and operation, for example `user create`, `chat many`, `prison remove`, `prison addRule`.       |

Update responses wrap the affected-row count and echo the body you sent:

```json
{
	"data": {
		"updatedRows": [1],
		"newPrison": { "id": 53, "prisonName": "Doc Prison Renamed" }
	},
	"info": "Succeessfully updated prison",
	"success": true,
	"status": 200,
	"name": "prison update"
}
```

Delete responses put the number of deleted rows directly in `data`, and it is always `1` because a missing id is a `404` instead.

### Errors

There are two error shapes.

#### Validation errors

Status `400`, whenever input fails a rule: a missing required field, a bad email, a bad `status` value, a bad `page` value, and so on. Several problems are reported together.

```json
{
	"success": false,
	"errors": [
		"Username must be between 3 and 16 characters.",
		"Password must be a minimum of 7 characters."
	]
}
```

#### General errors

Everything else. `info` is the fixed message for that endpoint; `error`, when present, is the specific reason.

```json
{
	"success": false,
	"name": "NotFoundError",
	"info": "Error getting prison by ID",
	"status": 404,
	"error": "Prison 9999 not found"
}
```

Authentication and authorization failures use the same shape without `error`:

```json
{
	"success": false,
	"name": "AuthenticationError",
	"info": "Unauthorized",
	"status": 401
}
```

Unknown paths return the same shape with status `404` and `"info": "Cannot GET /nope"`, never an HTML page.

`500` responses carry only a generic `"info": "Internal Server Error"`; the details are logged on the server. Stack traces never appear in responses.

### Status codes

| Situation                                                                                             | Status |
| ----------------------------------------------------------------------------------------------------- | ------ |
| Create                                                                                                | 201    |
| Read, update, delete, login, attach rule                                                              | 200    |
| Validation failed, bad pagination, unknown role filter                                                | 400    |
| Duplicate username or email                                                                           | 400    |
| Referential integrity refused the change (see below)                                                  | 400    |
| Missing or invalid token, banned or deleted user, wrong password                                      | 401    |
| Role or ownership does not permit the action                                                          | 403    |
| No record with that id (read, update, or delete), or unknown parent in a list filter, or unknown path | 404    |
| Internal fault                                                                                        | 500    |

### Pagination

List endpoints accept two optional query parameters:

| Parameter   | Default | Rules                  |
| ----------- | ------- | ---------------------- |
| `page`      | 1       | Positive integer.      |
| `page_size` | 10      | Integer from 1 to 100. |

`GET /prison/prisons?page=2&page_size=2` returns the third and fourth prisons. Responses do not include a total count; keep requesting until you get fewer rows than `page_size`. Invalid values return a validation error:

```json
{
	"success": false,
	"errors": ["page must be a positive integer.", "page_size must be an integer between 1 and 100."]
}
```

`GET /chapter/chapters` is not paginated and returns everything.

### The `full` parameter

Most read endpoints accept `full=true` to embed related records. The string must be exactly `true`; anything else is treated as `false`.

| Endpoint                     | `full=true` adds                               |
| ---------------------------- | ---------------------------------------------- |
| Users (list, by id, by role) | `chats`                                        |
| Prisons (list, by id)        | `prisoners`, `rules`                           |
| Prisoners (list, by id)      | `prison_details`                               |
| Prisoners by prison          | `prison_details`, `chats`                      |
| Rules (list, by id)          | `prisons`                                      |
| Chats (list, by id, by pair) | `messages`, `user_details`, `prisoner_details` |
| Messages                     | accepted but ignored                           |

Embedded rules and prisons carry a `RulePassthrough` object describing the link (see the prison example below). Embedded users never include the password hash.

### Deletes and referential integrity

Foreign keys are enforced with `RESTRICT`. Deleting a record that other records still reference fails with status `400` and `"name": "SequelizeForeignKeyConstraintError"`:

- A user with chats or messages.
- A prisoner with chats or messages.
- A prison with prisoners.
- A chat with messages, **except** through `DELETE /chat/chat`, which deletes the chat's messages first.

Deleting a rule or a prison removes its rule-to-prison links automatically. Creating or updating a record that points at a nonexistent user, prisoner, chat, or prison fails the same way.

## Endpoint reference

The **Auth** column says who may call the endpoint: _Public_, _Any_ (any valid token), _Admin or chapter_, _Admin_, _Self or admin_ (your own record, or an admin), _Own_ (any token, but a `user` only sees their own threads).

### Users

| Method | Path          | Auth          | Purpose                                            |
| ------ | ------------- | ------------- | -------------------------------------------------- |
| POST   | `/auth/user`  | Public        | Register (role `user`); admins may set other roles |
| POST   | `/auth/login` | Public        | Log in and receive a token                         |
| GET    | `/auth/users` | Admin         | List users, optionally by role                     |
| GET    | `/auth/user`  | Self or admin | Get one user by id, email, or username             |
| PUT    | `/auth/user`  | Self or admin | Update a user                                      |
| DELETE | `/auth/user`  | Self or admin | Delete a user                                      |

#### User fields

| Field      | Rules                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `username` | Required, unique, 3 to 16 characters.                                                                                                  |
| `password` | Required, 7 to 255 characters. Stored as a bcrypt hash. Never returned by any endpoint.                                                |
| `email`    | Required, unique, must look like an email address.                                                                                     |
| `role`     | `admin`, `user`, `chapter`, or `banned`. Case-insensitive. Defaults to `user`. Only an admin may set anything else or change it later. |
| `name`     | Optional display name, 3 to 32 characters.                                                                                             |
| `bio`      | Optional, 12 to 2400 characters.                                                                                                       |

#### POST /auth/user

```bash
curl -s -X POST http://localhost:3000/auth/user \
  -H 'Content-Type: application/json' \
  -d '{"username":"docwriter","password":"longenough","email":"doc@example.com","name":"Doc Writer","bio":"Writing documentation for the API"}'
```

```json
{
	"data": {
		"id": 43,
		"username": "docwriter",
		"role": "user",
		"email": "doc@example.com",
		"name": "Doc Writer",
		"bio": "Writing documentation for the API",
		"updatedAt": "2026-09-11T18:19:07.993Z",
		"createdAt": "2026-09-11T18:19:07.993Z"
	},
	"info": "Successfully created user.",
	"success": true,
	"status": 201,
	"name": "user create"
}
```

A duplicate username or email is a general error with `"error": "Username already in use."` or `"Email address already in use."`. Requesting a role other than `user` without an admin token is a `403`.

#### POST /auth/login

See [Logging in](#logging-in).

#### GET /auth/users

Admin only. Parameters: `role`, `full`, `page`, `page_size`.

```bash
curl -s 'http://localhost:3000/auth/users?role=chapter' -H "Authorization: Bearer $TOKEN"
```

```json
{
	"data": [
		{
			"id": 44,
			"name": "Portland Chapter",
			"username": "chapter1",
			"email": "chapter1@example.com",
			"bio": null,
			"role": "chapter",
			"createdAt": "2026-09-11T18:19:08.140Z",
			"updatedAt": "2026-09-11T18:19:08.140Z"
		}
	],
	"info": null,
	"success": true,
	"status": 200,
	"name": "user many"
}
```

An unknown `role` value is a validation error listing the allowed roles. An empty result is a `200` with an empty array.

#### GET /auth/user

Supply exactly one of `id`, `email`, or `username`. If more than one is supplied, `id` wins, then `email`, then `username`. Email and username matching is case-sensitive.

A non-admin may only fetch their own record; anything else is a `403`. No parameter at all is a `400`; no match is a `404`.

```bash
curl -s 'http://localhost:3000/auth/user?id=43' -H "Authorization: Bearer $TOKEN"
```

```json
{
	"data": {
		"id": 43,
		"name": "Doc Writer",
		"username": "docwriter",
		"email": "doc@example.com",
		"bio": "Writing documentation for the API",
		"role": "user",
		"createdAt": "2026-09-11T18:19:07.993Z",
		"updatedAt": "2026-09-11T18:19:07.993Z"
	},
	"info": null,
	"success": true,
	"status": 200,
	"name": "user one"
}
```

`full=true` adds a `chats` array.

#### PUT /auth/user

Body must include `id`; every other field present is written. A non-admin may only update their own record and may not include `role`. Changing `password` is supported and re-hashes it.

```bash
curl -s -X PUT http://localhost:3000/auth/user \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":43,"name":"Doc Writer Updated"}'
```

```json
{
	"data": { "updatedRows": [1], "newUser": { "id": 43, "name": "Doc Writer Updated" } },
	"info": "Successfully updated user.",
	"success": true,
	"status": 200,
	"name": "user update"
}
```

A password sent in the body is not echoed back.

#### DELETE /auth/user

Body: `{"id": 43}`. Returns `"data": 1`. A user who still has chats or messages cannot be deleted (see [Deletes and referential integrity](#deletes-and-referential-integrity)).

### Prisons

| Method | Path              | Auth             | Purpose                   |
| ------ | ----------------- | ---------------- | ------------------------- |
| POST   | `/prison/prison`  | Admin or chapter | Create a prison           |
| GET    | `/prison/prisons` | Any              | List prisons              |
| GET    | `/prison/prison`  | Any              | Get one prison by id      |
| PUT    | `/prison/prison`  | Admin or chapter | Update a prison           |
| PUT    | `/prison/rule`    | Admin or chapter | Attach a rule to a prison |
| DELETE | `/prison/prison`  | Admin or chapter | Delete a prison           |

#### Prison fields

| Field        | Type   | Notes                                                        |
| ------------ | ------ | ------------------------------------------------------------ |
| `prisonName` | string | Required.                                                    |
| `address`    | object | Required. Free-form JSON; the seeds use `{"street": "..."}`. |

#### POST /prison/prison

```bash
curl -s -X POST http://localhost:3000/prison/prison \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"prisonName":"Doc Prison","address":{"street":"1 Doc St","city":"Docville"}}'
```

```json
{
	"data": {
		"id": 53,
		"prisonName": "Doc Prison",
		"address": { "street": "1 Doc St", "city": "Docville" },
		"updatedAt": "2026-09-11T18:19:08.432Z",
		"createdAt": "2026-09-11T18:19:08.432Z"
	},
	"info": "Successfully created prison",
	"success": true,
	"status": 201,
	"name": "prison create"
}
```

#### GET /prison/prisons

Parameters: `page`, `page_size`, `full`.

```json
{
	"data": [
		{
			"id": 1,
			"prisonName": "Test Prison",
			"address": { "street": "123 Fake Street" },
			"createdAt": "2026-09-11T18:18:18.368Z",
			"updatedAt": "2026-09-11T18:18:18.368Z"
		},
		{
			"id": 2,
			"prisonName": "Alpha Prison",
			"address": { "street": "456 Alpha Street" },
			"createdAt": "2026-09-11T18:18:18.369Z",
			"updatedAt": "2026-09-11T18:18:18.369Z"
		}
	],
	"info": "Successfully retireved prisons list",
	"success": true,
	"status": 200,
	"name": "prison many"
}
```

#### GET /prison/prison

Parameters: `id` (required), `full`. With `full=true`:

```bash
curl -s 'http://localhost:3000/prison/prison?id=1&full=true' -H "Authorization: Bearer $TOKEN"
```

```json
{
	"data": {
		"id": 1,
		"prisonName": "Test Prison",
		"address": { "street": "123 Fake Street" },
		"createdAt": "2026-09-11T18:18:18.368Z",
		"updatedAt": "2026-09-11T18:18:18.368Z",
		"prisoners": [
			{
				"id": 1,
				"birthName": "John Smith",
				"chosenName": "Jane Smith",
				"prison": 1,
				"inmateID": "1",
				"releaseDate": "2029-04-05T23:24:24.819Z",
				"bio": "Test bio here",
				"status": null,
				"createdAt": "2026-09-11T18:18:18.391Z",
				"updatedAt": "2026-09-11T18:18:18.391Z"
			}
		],
		"rules": [
			{
				"id": 1,
				"title": "No pictures",
				"description": "Letters must be text only, no photographs",
				"createdAt": "2026-09-11T18:18:18.407Z",
				"updatedAt": "2026-09-11T18:18:18.407Z",
				"RulePassthrough": {
					"createdAt": "2026-09-11T18:19:08.527Z",
					"updatedAt": "2026-09-11T18:19:08.527Z",
					"prison": 1,
					"rule": 1
				}
			}
		]
	},
	"info": "Success getting prison by ID",
	"success": true,
	"status": 200,
	"name": "prison one"
}
```

No prison with that id is a `404`.

#### PUT /prison/prison

Body: `{"id": 53, "prisonName": "Doc Prison Renamed"}` plus any other fields to change. Returns the update envelope.

#### PUT /prison/rule

Attach an existing rule to an existing prison. Idempotent: attaching the same pair twice is a no-op.

```bash
curl -s -X PUT http://localhost:3000/prison/rule \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"rule":1,"prison":1}'
```

The response echoes the ids and returns the prison with its prisoners and rules embedded, under the (historically named) `updatedRows` key:

```json
{
	"data": {
		"updatedRows": {
			"id": 1,
			"prisonName": "Test Prison",
			"address": { "street": "123 Fake Street" },
			"createdAt": "2026-09-11T18:18:18.368Z",
			"updatedAt": "2026-09-11T18:18:18.368Z",
			"prisoners": [
				{ "id": 1, "birthName": "John Smith", "chosenName": "Jane Smith", "prison": 1 }
			],
			"rules": [
				{
					"id": 1,
					"title": "No pictures",
					"description": "Letters must be text only, no photographs"
				}
			]
		},
		"rule": 1,
		"prison": 1
	},
	"info": "Successfully added rule to prison",
	"success": true,
	"status": 200,
	"name": "prison addRule"
}
```

(Embedded objects abbreviated.) An unknown rule or prison id is a `404`. There is no detach endpoint; delete the rule, or delete and recreate it, to remove a link.

#### DELETE /prison/prison

Body: `{"id": 53}`. Fails with `400` while the prison still has prisoners.

### Prisoners

| Method | Path                  | Auth             | Purpose                              |
| ------ | --------------------- | ---------------- | ------------------------------------ |
| POST   | `/prisoner/prisoner`  | Admin or chapter | Create a prisoner                    |
| GET    | `/prisoner/prisoners` | Any              | List prisoners, optionally by prison |
| GET    | `/prisoner/prisoner`  | Any              | Get one prisoner by id               |
| PUT    | `/prisoner/prisoner`  | Admin or chapter | Update a prisoner                    |
| DELETE | `/prisoner/prisoner`  | Admin or chapter | Delete a prisoner                    |

#### Prisoner fields

| Field         | Type     | Notes                                                                      |
| ------------- | -------- | -------------------------------------------------------------------------- |
| `birthName`   | string   | Legal name.                                                                |
| `chosenName`  | string   | Name the person goes by.                                                   |
| `prison`      | integer  | Id of an existing prison. A nonexistent id is refused.                     |
| `inmateID`    | string   | Facility-issued identifier. Free text.                                     |
| `releaseDate` | datetime | ISO-8601 string.                                                           |
| `bio`         | string   |                                                                            |
| `status`      | string   | `pretrial`, `incarcerated`, or `free`. Optional; anything else is a `400`. |

All fields are optional at the database level.

#### POST /prisoner/prisoner

```bash
curl -s -X POST http://localhost:3000/prisoner/prisoner \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"birthName":"Doc Person","chosenName":"Doc","inmateID":"D-100","prison":1,"releaseDate":"2030-01-01T00:00:00.000Z","bio":"Docs","status":"incarcerated"}'
```

```json
{
	"data": {
		"id": 41,
		"birthName": "Doc Person",
		"chosenName": "Doc",
		"prison": 1,
		"inmateID": "D-100",
		"releaseDate": "2030-01-01T00:00:00.000Z",
		"bio": "Docs",
		"status": "incarcerated",
		"updatedAt": "2026-09-11T18:19:08.625Z",
		"createdAt": "2026-09-11T18:19:08.625Z"
	},
	"info": "Successfully created prisoner",
	"success": true,
	"status": 201,
	"name": "prisoner create"
}
```

#### GET /prisoner/prisoners

Parameters: `prison`, `full`, `page`, `page_size`.

```bash
curl -s 'http://localhost:3000/prisoner/prisoners?prison=1' -H "Authorization: Bearer $TOKEN"
```

Returns only prisoners whose `prison` matches. A `prison` id that does not exist is a `404`. Without `prison`, all prisoners are listed. With `full=true` each row gains `prison_details` (and, when filtering by prison, `chats`):

```json
{
	"data": [
		{
			"id": 1,
			"birthName": "John Smith",
			"chosenName": "Jane Smith",
			"prison": 1,
			"inmateID": "1",
			"releaseDate": "2029-04-05T23:24:24.819Z",
			"bio": "Test bio here",
			"status": null,
			"createdAt": "2026-09-11T18:18:18.391Z",
			"updatedAt": "2026-09-11T18:18:18.391Z",
			"prison_details": {
				"id": 1,
				"prisonName": "Test Prison",
				"address": { "street": "123 Fake Street" },
				"createdAt": "2026-09-11T18:18:18.368Z",
				"updatedAt": "2026-09-11T18:18:18.368Z"
			}
		}
	],
	"info": "Successfully retireved prisoners list",
	"success": true,
	"status": 200,
	"name": "prisoner many"
}
```

#### GET /prisoner/prisoner

Parameters: `id` (required), `full`. Returns the prisoner, or `404`.

#### PUT /prisoner/prisoner and DELETE /prisoner/prisoner

Body `{"id": 41, "chosenName": "Doc Updated"}` and `{"id": 41}` respectively. A prisoner with chats or messages cannot be deleted.

### Rules

| Method | Path          | Auth             | Purpose                          |
| ------ | ------------- | ---------------- | -------------------------------- |
| POST   | `/rule/rule`  | Admin or chapter | Create a rule                    |
| GET    | `/rule/rules` | Any              | List rules, optionally by prison |
| GET    | `/rule/rule`  | Any              | Get one rule by id               |
| PUT    | `/rule/rule`  | Admin or chapter | Update a rule                    |
| DELETE | `/rule/rule`  | Admin or chapter | Delete a rule                    |

#### Rule fields

| Field         | Type   | Notes                           |
| ------------- | ------ | ------------------------------- |
| `title`       | string | Short name, e.g. "No pictures". |
| `description` | string | Longer explanation.             |

Rules are created standalone and linked to prisons afterwards with `PUT /prison/rule`. A `prison` field in the create body is ignored.

#### POST /rule/rule

```bash
curl -s -X POST http://localhost:3000/rule/rule \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Doc rule","description":"Documented"}'
```

Returns `201` with the rule.

#### GET /rule/rules

Parameters: `prison`, `full`, `page`, `page_size`. `?prison=1` returns the rules attached to prison 1 (`404` if the prison does not exist). `full=true` embeds `prisons` on the unfiltered list.

#### GET /rule/rule

Parameters: `id` (required), `full`. With `full=true`:

```json
{
	"data": {
		"id": 1,
		"title": "No pictures",
		"description": "Letters must be text only, no photographs",
		"createdAt": "2026-09-11T18:18:18.407Z",
		"updatedAt": "2026-09-11T18:18:18.407Z",
		"prisons": [
			{
				"id": 1,
				"prisonName": "Test Prison",
				"address": { "street": "123 Fake Street" },
				"createdAt": "2026-09-11T18:18:18.368Z",
				"updatedAt": "2026-09-11T18:18:18.368Z",
				"RulePassthrough": {
					"createdAt": "2026-09-11T18:19:08.527Z",
					"updatedAt": "2026-09-11T18:19:08.527Z",
					"prison": 1,
					"rule": 1
				}
			}
		]
	},
	"info": "Success getting rule by ID",
	"success": true,
	"status": 200,
	"name": "rule one"
}
```

#### PUT /rule/rule and DELETE /rule/rule

Body `{"id": 45, ...}` and `{"id": 45}`. Deleting a rule also removes its links to prisons.

### Chats

| Method | Path          | Auth | Purpose                                     |
| ------ | ------------- | ---- | ------------------------------------------- |
| POST   | `/chat/chat`  | Own  | Create a chat between a user and a prisoner |
| GET    | `/chat/chats` | Own  | List chats, optionally by user or prisoner  |
| GET    | `/chat/chat`  | Own  | Get one chat by id or by user + prisoner    |
| PUT    | `/chat/chat`  | Own  | Update a chat                               |
| DELETE | `/chat/chat`  | Own  | Delete a chat and its messages              |

#### Chat fields

| Field      | Type    | Notes                       |
| ---------- | ------- | --------------------------- |
| `user`     | integer | Id of an existing user.     |
| `prisoner` | integer | Id of an existing prisoner. |

You usually do not need to create chats by hand. Sending a message with `POST /messaging/message` finds or creates the chat for that user and prisoner pair automatically.

#### POST /chat/chat

Body: `{"user": 1, "prisoner": 9}`. For a `user`-role caller the `user` field is replaced with their own id. Nonexistent ids are refused. Duplicates are not prevented; the message endpoint's find-or-create always uses the oldest chat for a pair, so prefer letting it create chats.

```json
{
	"data": {
		"id": 41,
		"user": 1,
		"prisoner": 9,
		"updatedAt": "2026-09-11T18:19:08.795Z",
		"createdAt": "2026-09-11T18:19:08.795Z"
	},
	"info": "Successfully created chat",
	"success": true,
	"status": 201,
	"name": "chat create"
}
```

#### GET /chat/chats

Parameters: `user`, `prisoner`, `full`, `page`, `page_size`. If both `user` and `prisoner` are given, `user` wins. A `user`-role caller always gets their own chats, and may narrow with `prisoner`. A `user` or `prisoner` id that does not exist is a `404`.

With `full=true`:

```json
{
	"data": [
		{
			"user": 1,
			"prisoner": 1,
			"id": 1,
			"createdAt": "2026-09-11T18:21:43.400Z",
			"updatedAt": "2026-09-11T18:21:43.400Z",
			"messages": [
				{
					"id": 1,
					"chat": 1,
					"messageText": "Hello",
					"sender": "user",
					"prisoner": 1,
					"user": 1,
					"createdAt": "2026-09-11T18:21:43.426Z",
					"updatedAt": "2026-09-11T18:21:43.426Z"
				}
			],
			"user_details": {
				"id": 1,
				"name": null,
				"username": "user2",
				"email": "user2@example.com",
				"bio": null,
				"role": "user",
				"createdAt": "2026-09-11T18:21:42.870Z",
				"updatedAt": "2026-09-11T18:21:42.870Z"
			},
			"prisoner_details": {
				"id": 1,
				"birthName": "John Smith",
				"chosenName": "Jane Smith",
				"prison": 1,
				"inmateID": "1",
				"releaseDate": "2029-04-05T23:24:24.819Z",
				"bio": "Test bio here",
				"status": null,
				"createdAt": "2026-09-11T18:21:43.370Z",
				"updatedAt": "2026-09-11T18:21:43.370Z"
			}
		}
	],
	"info": "Successfully retireved chats list",
	"success": true,
	"status": 200,
	"name": "chat many"
}
```

#### GET /chat/chat

Two ways to call it, both returning a single object in `data`:

- By id: `?id=1`.
- By pair: `?user=1&prisoner=1`. A `user`-role caller may omit `user`; it defaults to their own id.

```bash
curl -s 'http://localhost:3000/chat/chat?user=1&prisoner=1' -H "Authorization: Bearer $TOKEN"
```

```json
{
	"data": {
		"user": 1,
		"prisoner": 1,
		"id": 1,
		"createdAt": "2026-09-11T18:18:18.429Z",
		"updatedAt": "2026-09-11T18:18:18.429Z"
	},
	"info": "Success getting chat",
	"success": true,
	"status": 200,
	"name": "chat one"
}
```

- No match: `404`.
- Only one of `user` / `prisoner` (for a non-`user` caller), or no parameters: `400` with `"error": "Both user and prisoner are required."` or `"Provide either id, or both user and prisoner."`.
- Someone else's chat, as a `user`: `403`.

#### PUT /chat/chat

Body: `{"id": 1, "prisoner": 5}` plus any fields. A `user` may not move a chat to another user. Nonexistent ids are refused.

#### DELETE /chat/chat

Body: `{"id": 41}`. Deletes the chat's messages, then the chat. Returns `"data": 1`.

### Messages

| Method | Path                  | Auth | Purpose                                     |
| ------ | --------------------- | ---- | ------------------------------------------- |
| POST   | `/messaging/message`  | Own  | Send a message (creates the chat if needed) |
| GET    | `/messaging/messages` | Own  | List messages                               |
| GET    | `/messaging/message`  | Own  | Get one message by id                       |
| PUT    | `/messaging/message`  | Own  | Update a message                            |
| DELETE | `/messaging/message`  | Own  | Delete a message                            |

#### Message fields

| Field         | Type    | Notes                                                                                    |
| ------------- | ------- | ---------------------------------------------------------------------------------------- |
| `chat`        | integer | Id of the chat. Set automatically from `user` + `prisoner`; do not send it.              |
| `messageText` | string  | The letter body.                                                                         |
| `sender`      | string  | Required. `user` or `prisoner`. A `user`-role caller is always recorded as `user`.       |
| `user`        | integer | Required. Id of the user side. A `user`-role caller's own id is used regardless of body. |
| `prisoner`    | integer | Required. Id of the prisoner side.                                                       |

#### POST /messaging/message

The main write endpoint of the product. Before the message is saved, the server looks up a chat for the `user` and `prisoner` pair, creates one if none exists, and stores the message under it.

```bash
curl -s -X POST http://localhost:3000/messaging/message \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"messageText":"Hello from the docs","sender":"user","prisoner":1,"user":43}'
```

```json
{
	"data": {
		"id": 41,
		"messageText": "Hello from the docs",
		"sender": "user",
		"prisoner": 1,
		"user": 43,
		"updatedAt": "2026-09-11T18:19:08.812Z",
		"createdAt": "2026-09-11T18:19:08.812Z",
		"chat": 42
	},
	"info": "Successfully created message",
	"success": true,
	"status": 201,
	"name": "message create"
}
```

`chat` in the response tells you which thread the message landed in; here a new chat (42) was created for this pair.

Failure modes:

- `sender` other than `user` / `prisoner`: validation error `"Sender must either be user or prisoner."`
- Missing `user` or `prisoner`: validation errors naming the missing fields.
- A `user` or `prisoner` id that does not exist: `400`, `"name": "SequelizeForeignKeyConstraintError"`.

#### GET /messaging/messages

Parameters: `id`, `chat`, `prisoner`, `user`, `page`, `page_size`. Filters take precedence in that order; only the first one present is used. A filter naming a chat, prisoner, or user that does not exist is a `404`. A `user`-role caller only ever receives their own messages, whatever filter they pass.

```bash
curl -s 'http://localhost:3000/messaging/messages?chat=1' -H "Authorization: Bearer $TOKEN"
```

```json
{
	"data": [
		{
			"id": 1,
			"chat": 1,
			"messageText": "Hello",
			"sender": "user",
			"prisoner": 1,
			"user": 1,
			"createdAt": "2026-09-11T18:18:18.452Z",
			"updatedAt": "2026-09-11T18:18:18.452Z"
		}
	],
	"info": "Successfully retireved message list",
	"success": true,
	"status": 200,
	"name": "message many"
}
```

#### GET /messaging/message

Parameter: `id` (required). Returns the message object, `404` if missing, `403` if it belongs to another user and the caller is a `user`.

#### PUT /messaging/message

Body must include `id`; any of `messageText`, `sender`, `user`, `prisoner` may follow. Partial updates work: `{"id": 1, "messageText": "Edited"}` changes only the text. Changing `user` or `prisoner` moves the message to the chat for the new pair, creating it if needed. A `user`-role caller cannot change `user`.

```json
{
	"data": { "updatedRows": [1], "newMessage": { "id": 1, "messageText": "Edited" } },
	"info": "Succeessfully updated message",
	"success": true,
	"status": 200,
	"name": "message update"
}
```

#### DELETE /messaging/message

Body: `{"id": 41}`. Returns `"data": 1`.

### Chapters

| Method | Path                | Auth             | Purpose                       |
| ------ | ------------------- | ---------------- | ----------------------------- |
| POST   | `/chapter/chapter`  | Admin or chapter | Create a chapter              |
| GET    | `/chapter/chapters` | Any              | List all chapters (no paging) |
| GET    | `/chapter/chapter`  | Any              | Get one chapter by id         |
| PUT    | `/chapter/chapter`  | Admin or chapter | Update a chapter              |
| DELETE | `/chapter/chapter`  | Admin or chapter | Delete a chapter              |

#### Chapter fields

| Field             | Type    | Notes                                                          |
| ----------------- | ------- | -------------------------------------------------------------- |
| `name`            | string  | Required.                                                      |
| `location`        | object  | Required. Free-form JSON.                                      |
| `prisoners`       | object  | Optional JSON blob. Not a relation. Only settable through PUT. |
| `lettersSent`     | string  | Optional. Only settable through PUT.                           |
| `averageTimeDays` | integer | Optional. Only settable through PUT.                           |

The create handler only reads `name` and `location`; the other three fields must be added with a follow-up PUT.

#### POST /chapter/chapter

```bash
curl -s -X POST http://localhost:3000/chapter/chapter \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Doc Chapter","location":{"city":"Docville"}}'
```

```json
{
	"data": {
		"id": 2,
		"name": "Doc Chapter",
		"location": { "city": "Docville" },
		"updatedAt": "2026-09-11T18:19:08.940Z",
		"createdAt": "2026-09-11T18:19:08.940Z"
	},
	"info": "Successfully created chapter",
	"success": true,
	"status": 201,
	"name": "chapter create"
}
```

#### GET /chapter/chapters

No parameters. Returns every chapter.

```json
{
	"data": [
		{
			"id": 1,
			"name": "Test Chapter",
			"location": { "street": "123 Chapter Street" },
			"prisoners": null,
			"lettersSent": null,
			"averageTimeDays": null,
			"createdAt": "2026-09-11T18:18:18.468Z",
			"updatedAt": "2026-09-11T18:18:18.468Z"
		}
	],
	"info": "Successfully retireved chapter list",
	"success": true,
	"status": 200,
	"name": "chapter many"
}
```

#### GET /chapter/chapter, PUT /chapter/chapter, DELETE /chapter/chapter

`?id=1` for GET; `{"id": 2, ...}` in the body for PUT and DELETE. A missing id is a `404` on all three.

## Known quirks

None of these break anything, but clients should know about them.

1. Several `info` strings contain typos ("retireved", "Succeessfully") that clients may already match on. They are left as-is for now.
2. `PUT /prison/rule` returns the prison object under a key named `updatedRows`.
3. Embedded rules and prisons include a `RulePassthrough` object describing the link row.
4. `GET /chapter/chapters` is not paginated.
5. `full=true` is accepted but ignored on message endpoints.
6. Chats are not unique per user and prisoner pair when created through `POST /chat/chat`. The message endpoint always reuses the oldest chat for a pair.
7. There is no endpoint to detach a rule from a prison.
8. Seeded ids are not stable across databases. Read them from responses.

## Postman collection

`ABC-3.postman_collection.json` in the repository root matches the current API. Import it, then:

1. Run **Users › Login (seeded admin)**. Its test script stores the token in the `{{jwt}}` collection variable and the admin's id in `{{userId}}`.
2. Every other request sends `{{jwt}}` as a bearer token automatically.
3. Ids in request bodies are examples from the seed data; adjust them from list responses.

`ABC-3.postman_collection_old.json` is a historical snapshot and does not match the API.

## Further reading

- [Developer guide](docs/DEVELOPER.md): architecture, request lifecycle, data model, authorization internals, tooling, and how to add a resource.
- [GitHub repository](https://github.com/Aye-Bee-See/sqlite-express-api)
