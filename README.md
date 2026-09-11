# Aye Bee See API

Aye Bee See is a project to make sending a physical letter to an incarcerated person as easy as sending a text message. A person on the outside writes a message in an app; a partner non-profit chapter prints it and mails it; replies flow back the same way.

This repository is the backend HTTP API for that product. It is an Express 5 application backed by a SQLite database through Sequelize. It stores users, prisons, prisoners, prison mail rules, non-profit chapters, and the message threads ("chats") between a user and a prisoner.

This README is written for people who **use** the API: front-end developers, integrators, and testers. If you want to change the API itself, read the [developer guide](docs/DEVELOPER.md).

> **Status (September 2026).** The code on `main` was last changed in June 2025. As checked in, it does not work: a one-line regression in the shared response formatter makes every controller response fail with a `TypeError` (see [Known issues](#known-issues), item 1). Everything in this document was verified against a local build with that single line patched. Endpoints whose status is listed as **Broken** or **Partial** have further problems, each described in the Known issues section. Endpoints listed as **Works** behave as documented.

## Contents

- [Concepts](#concepts)
- [Running the API](#running-the-api)
- [Seed data and test accounts](#seed-data-and-test-accounts)
- [Authentication](#authentication)
- [Conventions](#conventions)
- [Endpoint reference](#endpoint-reference)
- [Known issues](#known-issues)
- [Postman collection](#postman-collection)

## Concepts

| Term         | Meaning                                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User**     | An account for a person on the outside (or an admin, or a chapter). Has a `role` of `admin`, `user`, `chapter`, or `banned`.                                           |
| **Prison**   | A correctional facility. Has a name and a free-form JSON `address`.                                                                                                    |
| **Prisoner** | An incarcerated person that users can write to. Belongs to one prison. Stores birth name, chosen name, inmate ID, release date, a bio, and a status.                   |
| **Rule**     | A mail rule a prison enforces, such as "No pictures". Rules are meant to be attached to many prisons, and a prison can have many rules.                                |
| **Chat**     | A thread between exactly one user and one prisoner. Chats are created automatically the first time a message is sent between a pair, but can also be created directly. |
| **Message**  | One letter or text within a chat. `sender` is either `user` or `prisoner`.                                                                                             |
| **Chapter**  | A local chapter of the partner non-profit that prints and mails letters. Has a name, a JSON `location`, and some statistics fields.                                    |

All identifiers are auto-incrementing integers. Every record also carries `createdAt` and `updatedAt` ISO-8601 timestamps.

## Running the API

### Prerequisites

- Node.js. The code was verified with Node 24. It uses ES modules and package `imports` aliases, so anything older than Node 16 will not work.
- npm.
- No database server. SQLite is bundled through the `sqlite3` npm package, which downloads a prebuilt binary during install.

### Install

```bash
git clone https://github.com/Aye-Bee-See/sqlite-express-api.git
cd sqlite-express-api
npm install
```

Use `npm install`, not `npm ci`. The committed `package-lock.json` is out of sync with `package.json`, so `npm ci` refuses to run.

### Configure

Create a `.env` file in the repository root. It is git-ignored.

```dotenv
JWT_SECRET=replace-this-with-a-long-random-string
PORT=3000
```

| Variable       | Required | Purpose                                                                                                   |
| -------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`   | Yes      | Secret used to sign and verify login tokens. If it is missing, login fails when it tries to sign a token. |
| `PORT`         | Yes      | TCP port the server listens on. If it is missing, Express listens on a random port.                       |
| `REDIS_SECRET` | No       | Read into a constant but never used.                                                                      |

### Start

```bash
node index.js
```

For automatic restarts while developing:

```bash
npx nodemon index.js
```

You will see `Express is running on port: 3000`, followed by a long stream of SQL statements and then a block of seed data. The server is ready once `End Seed Data` is printed.

### What happens on every start

Each start **drops and recreates every table** in `database.sqlite`, then loads the seed data described below. Nothing you create through the API survives a restart. Treat the running server as a disposable fixture.

### CORS

The server only sends CORS headers for the origin `http://localhost:3001`. Browser clients served from any other origin will be blocked by the browser. Non-browser clients such as `curl`, Postman, or server-to-server calls are unaffected.

## Seed data and test accounts

The database is seeded from the JSON files in `database/seeds/` on every boot.

| Resource  | Rows | Notes                                                                                                              |
| --------- | ---- | ------------------------------------------------------------------------------------------------------------------ |
| Users     | 41   | One admin plus forty regular users.                                                                                |
| Prisons   | 52   | "Test Prison", then Greek-letter names ("Alpha Prison", "Beta Prison", ...). Each has a one-line street address.   |
| Prisoners | 40   | Prisoner N is in prison N. Each has a birth name, chosen name, inmate ID, release date, and bio. `status` is null. |
| Rules     | 44   | "No pictures", "No contraband", and so on. Seeded rules are **not** attached to any prison.                        |
| Chats     | 40   | Chat N pairs user N with prisoner N.                                                                               |
| Messages  | 40   | One short greeting per chat, all sent by the user side.                                                            |
| Chapters  | 1    | "Test Chapter".                                                                                                    |

### Credentials

| Username             | Password                     | Role    | Email                   |
| -------------------- | ---------------------------- | ------- | ----------------------- |
| `admin`              | `abcpassword`                | `admin` | `admin@localhost`       |
| `user1` ... `user40` | `password1` ... `password40` | `user`  | `user1@example.com` ... |

The numeric `id` a seeded account receives is **not** guaranteed to match its position in the seed file. In a verified run `admin` was id 3 and `user2` was id 4. Read your id from the login response rather than assuming it.

## Authentication

### Which routes are public

Only two:

- `POST /auth/user` (register)
- `POST /auth/login`

Every other route requires a bearer token.

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
			"email": "admin@localhost",
			"name": null,
			"role": "admin",
			"username": "admin",
			"bio": null
		},
		"token": {
			"token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MywiZXhwaXJ5IjoxNzg5NzQ5NjE5NDc2LCJpYXQiOjE3ODkxNDQ4MTksImV4cCI6MTc4OTc0OTYxOX0.PLALbf...",
			"expires": 1789749619476
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
- Tokens are valid for **one week**. There is no refresh endpoint and no logout endpoint; to end a session, discard the token.
- Wrong username or password returns `401` with the [auth error shape](#authentication-errors). A missing field returns `400` with the same shape and `"info": "Bad Request"`.

### Using the token

Send it as a bearer token on every request:

```bash
curl -s http://localhost:3000/prison/prisons \
  -H 'Authorization: Bearer eyJhbGciOi...'
```

### What a token grants

A valid token grants **full access to every endpoint**. Roles are stored but never checked, so a `user`, a `chapter`, and a `banned` account can all do everything an `admin` can, including creating and deleting other users. See Known issues 3 and 4 before exposing this service to the public.

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

Note the odd one out: messages are mounted at `/messaging`, while chats are at `/chat`. The older Postman collection used `/messaging/chat`, which now returns a 404.

### How to pass identifiers and filters

- **GET** requests take everything as **query-string parameters**: `GET /prison/prison?id=1`.
- **PUT** and **DELETE** requests take the `id` (and any fields) in a **JSON body**. Yes, `DELETE` requests carry a body.
- The route definitions contain optional path segments such as `/prison{/:id}`, but the handlers never read them. `GET /prison/prison/1` is accepted by the router and then fails with a database error, because `id` was not read from the path. Always use the query string.

### Request bodies

Send `Content-Type: application/json`. Form-encoded bodies are also parsed. Unknown fields in a create body are ignored; unknown fields in an update body are passed to the database and will cause an error if they are not real columns.

### Response envelope

Every successful controller response is a JSON object with this shape:

```json
{
	"data": {},
	"info": "Success getting prison by ID",
	"success": true,
	"status": 200,
	"name": "prison one"
}
```

| Field     | Meaning                                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| `data`    | The payload. A single object, an array, `null` when a lookup found nothing, or a number for delete counts.            |
| `info`    | A human-readable message. May be `null` for some list endpoints. Contains a few typos ("retireved", "Succeessfully"). |
| `success` | Always `true` on this shape.                                                                                          |
| `status`  | Always `200`. Successful creates and updates also return 200, not 201 or 204.                                         |
| `name`    | The resource and operation, for example `user create`, `chat many`, `prison remove`.                                  |

Update responses wrap the database result and echo the body you sent:

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

`updatedRows` is a one-element array holding the number of rows changed. Delete responses put the number of deleted rows directly in `data`.

### Error responses

There are three error shapes, plus a bare HTML 404 for unknown paths.

#### Validation errors

Returned with status `400` when the database schema rejects a value on create:

```json
{
	"success": false,
	"errors": [
		"Password must be a minimum of 7 characters.",
		"Email must be in traditional email format. E.g. x@y.z"
	]
}
```

#### Controller errors

Returned with status `400` for anything else that fails inside a handler, including "not found" lookups and internal faults. The `stack` field is a full server stack trace.

```json
{
	"info": "Error getting chats list",
	"type": "Error",
	"error": "User 9999 not found",
	"stack": "Error: User 9999 not found\n    at modelsService.modelInstanceExists (...)"
}
```

`info` is the fixed message for that endpoint. `type` and `error` come from the underlying JavaScript error. Unique-constraint violations (duplicate username or email) arrive in this shape with `"type": "SequelizeUniqueConstraintError"`.

#### Authentication errors

Returned with status `401` when the token is missing, invalid, or expired, and with `400` when login credentials are missing:

```json
{
	"success": false,
	"name": "AuthenticationError",
	"info": "Unauthorized",
	"status": 401
}
```

Uncaught errors thrown outside a handler's `try` block also use this shape, with the JavaScript error name in `name` and the message in `info`, status `400`.

#### Unknown routes

An unmatched path returns Express's default HTML page with status `404`, not JSON.

### Status codes in practice

| Situation                                | Status | Shape                  |
| ---------------------------------------- | ------ | ---------------------- |
| Success (read, create, update, delete)   | 200    | Envelope               |
| Lookup by id finds nothing (most models) | 200    | Envelope, `data: null` |
| Lookup by id finds nothing (users)       | 400    | Controller error       |
| Delete of a nonexistent id               | 200    | Envelope, `data: 0`    |
| Schema validation failed                 | 400    | Validation error       |
| Any other handler failure                | 400    | Controller error       |
| Missing, bad, or expired token           | 401    | Auth error             |
| Unknown path                             | 404    | HTML                   |

There is no 404 for missing records and no 500 for server faults. Check `success` and inspect `data`.

### Pagination

List endpoints accept two optional query parameters:

| Parameter   | Default | Meaning                  |
| ----------- | ------- | ------------------------ |
| `page`      | 1       | 1-based page number.     |
| `page_size` | 10      | Number of rows per page. |

`GET /prison/prisons?page=2&page_size=2` returns prisons 3 and 4. Responses do not include a total count or next-page link; keep requesting until you get fewer rows than `page_size`. Both parameters must be numeric. `page=0` or `page_size=abc` produces a database error rather than a validation message. `GET /chapter/chapters` is not paginated and returns everything.

### The `full` parameter

Most read endpoints accept `full=true` to embed related records (a prison's prisoners and rules, a chat's messages, and so on). The string must be exactly `true`; anything else is treated as `false`.

At the moment `full=true` is either broken or ineffective on every endpoint, for reasons explained in Known issues 9 and 17. Where it does not error, it adds keys such as `messages: []` or `prison_details: null` that are always empty. It is documented per endpoint below so you know what to expect once the underlying fixes land.

## Endpoint reference

Status legend: **Works** as documented. **Partial** works for the default case but some options fail (see Known issues). **Broken** fails for every call.

### Users

| Method | Path              | Auth   | Status  | Purpose                                  |
| ------ | ----------------- | ------ | ------- | ---------------------------------------- |
| POST   | `/auth/user`      | Public | Works   | Register a user                          |
| POST   | `/auth/login`     | Public | Works   | Log in and receive a token               |
| GET    | `/auth/users`     | Token  | Broken  | List users, optionally by role           |
| GET    | `/auth/user`      | Token  | Works   | Get one user by id, email, or username   |
| PUT    | `/auth/user`      | Token  | Partial | Update a user                            |
| DELETE | `/auth/user`      | Token  | Works   | Delete a user                            |
| GET    | `/auth/protected` | Token  | Broken  | Defined in constants, never routed (404) |

#### POST /auth/user

Registers an account. No token required.

| Field      | Required | Rules                                                                                                              |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `username` | Yes      | Must be unique. Intended to be 3 to 16 characters, but length is not actually enforced.                            |
| `password` | Yes      | 7 to 255 characters. Stored as a bcrypt hash and never returned.                                                   |
| `email`    | Yes      | Must look like an email address and be unique.                                                                     |
| `role`     | Yes      | One of `admin`, `user`, `chapter`, `banned`. Case-insensitive. Omitting it crashes the request with a `TypeError`. |
| `name`     | No       | Display name.                                                                                                      |
| `bio`      | No       | Free text. Intended to be 12 to 2400 characters, but length is not actually enforced.                              |

```bash
curl -s -X POST http://localhost:3000/auth/user \
  -H 'Content-Type: application/json' \
  -d '{"username":"docwriter","password":"longenough","email":"doc@example.com","role":"user","name":"Doc Writer","bio":"Writing documentation for the API"}'
```

```json
{
	"data": {
		"id": 42,
		"email": "doc@example.com",
		"name": "Doc Writer",
		"role": "user",
		"username": "docwriter",
		"bio": "Writing documentation for the API"
	},
	"info": "Successfully created user.",
	"success": true,
	"status": 200,
	"name": "user create"
}
```

A duplicate username returns a controller error with `"error": "Username already in use."`; a duplicate email returns `"Email address already in use."`. Because this endpoint is public and accepts `role: "admin"`, anyone who can reach the server can create an administrator (Known issues 3).

#### POST /auth/login

See [Logging in](#logging-in).

#### GET /auth/users

Intended to list users, with optional `role`, `full`, `page`, and `page_size` parameters.

**Broken.** The plain list returns the right number of rows, but every row is an empty object `{}` because the password-stripping step discards all fields (Known issues 5). Filtering by `role` crashes with `Cannot read properties of undefined (reading 'findByPk')` (Known issues 6).

```json
{ "data": [{}, {}], "info": null, "success": true, "status": 200, "name": "user many" }
```

#### GET /auth/user

Fetch one user. Supply exactly one of `id`, `email`, or `username`. If more than one is supplied, `id` wins, then `email`, then `username`.

```bash
curl -s 'http://localhost:3000/auth/user?email=user1@example.com' -H "Authorization: Bearer $TOKEN"
```

```json
{
	"data": {
		"id": 1,
		"email": "user1@example.com",
		"name": null,
		"role": "user",
		"username": "user1",
		"bio": null
	},
	"info": null,
	"success": true,
	"status": 200,
	"name": "user one"
}
```

The response never includes the password hash, `createdAt`, or `updatedAt`. `full=true` is accepted but has no visible effect, because the embedded `chats` are stripped along with the password.

Failure modes:

- No parameter at all: `400` controller error, `"info": "No ID, username, or email provided."`
- No matching user: `400` controller error, `"info": "Error getting user by ID."` (or "by email" / "by username").
- Email lookups are case-sensitive.

#### PUT /auth/user

Update any user. Body must include `id`; every other field present is written as-is.

```bash
curl -s -X PUT http://localhost:3000/auth/user \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":42,"name":"Doc Writer Updated"}'
```

```json
{
	"data": { "updatedRows": [1], "newUser": { "id": 42, "name": "Doc Writer Updated" } },
	"info": "Successfully updated user.",
	"success": true,
	"status": 200,
	"name": "user update"
}
```

**Do not update `password` through this endpoint.** Passwords are hashed only on create, so an updated password is stored in plain text and that account can no longer log in (Known issues 8).

#### DELETE /auth/user

Body: `{"id": 42}`. Returns the number of rows removed in `data`: `1` on success, `0` if no such user existed. Both return status 200.

### Prisons

| Method | Path              | Auth  | Status  | Purpose                   |
| ------ | ----------------- | ----- | ------- | ------------------------- |
| POST   | `/prison/prison`  | Token | Works   | Create a prison           |
| GET    | `/prison/prisons` | Token | Partial | List prisons              |
| GET    | `/prison/prison`  | Token | Partial | Get one prison by id      |
| PUT    | `/prison/prison`  | Token | Works   | Update a prison           |
| PUT    | `/prison/rule`    | Token | Broken  | Attach a rule to a prison |
| DELETE | `/prison/prison`  | Token | Works   | Delete a prison           |

#### Prison fields

| Field        | Type    | Notes                                                                |
| ------------ | ------- | -------------------------------------------------------------------- |
| `id`         | integer | Auto-assigned.                                                       |
| `prisonName` | string  | Required.                                                            |
| `address`    | object  | Required. Free-form JSON; the seeds use `{"street": "..."}`.         |
| `deleted`    | boolean | Always `false`. Set on create, never read. Deletes are real deletes. |

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
		"deleted": false,
		"updatedAt": "2026-09-11T16:40:19.750Z",
		"createdAt": "2026-09-11T16:40:19.750Z"
	},
	"info": "Successfully created prison",
	"success": true,
	"status": 200,
	"name": "prison create"
}
```

Omitting `prisonName` returns a validation error: `"Prison.prisonName cannot be null"`.

#### GET /prison/prisons

Parameters: `page`, `page_size`, `full`.

```bash
curl -s 'http://localhost:3000/prison/prisons?page_size=2' -H "Authorization: Bearer $TOKEN"
```

```json
{
	"data": [
		{
			"id": 1,
			"prisonName": "Test Prison",
			"address": { "street": "123 Fake Street" },
			"deleted": false,
			"createdAt": "2026-09-11T16:39:42.350Z",
			"updatedAt": "2026-09-11T16:39:42.350Z"
		},
		{
			"id": 2,
			"prisonName": "Alpha Prison",
			"address": { "street": "456 Alpha Street" },
			"deleted": false,
			"createdAt": "2026-09-11T16:39:42.350Z",
			"updatedAt": "2026-09-11T16:39:42.350Z"
		}
	],
	"info": "Successfully retireved prisons list",
	"success": true,
	"status": 200,
	"name": "prison many"
}
```

`full=true` is intended to embed `prisoners` and `rules`. It currently fails with a `SequelizeEagerLoadingError` about the alias `rules` (Known issues 9).

#### GET /prison/prison

Parameters: `id` (required), `full`.

Returns the single prison object in `data`. If no prison has that id, the call still succeeds with `"data": null`. `full=true` fails the same way as the list endpoint.

#### PUT /prison/prison

Body: `{"id": 53, "prisonName": "Doc Prison Renamed"}` plus any other fields to change. Returns the update envelope described under [Response envelope](#response-envelope).

#### PUT /prison/rule

Intended to attach an existing rule to a prison with body `{"rule": 1, "prison": 53}`.

**Broken.** Fails with `Cannot read properties of undefined (reading '#handleErr')` because the handler was never bound to its controller (Known issues 10). Until it is fixed there is no way to associate rules with prisons.

#### DELETE /prison/prison

Body: `{"id": 53}`. Returns the count of deleted rows. Prisoners that pointed at the prison are left in place with a dangling `prison` value.

### Prisoners

| Method | Path                  | Auth  | Status  | Purpose                              |
| ------ | --------------------- | ----- | ------- | ------------------------------------ |
| POST   | `/prisoner/prisoner`  | Token | Works   | Create a prisoner                    |
| GET    | `/prisoner/prisoners` | Token | Partial | List prisoners, optionally by prison |
| GET    | `/prisoner/prisoner`  | Token | Works   | Get one prisoner by id               |
| PUT    | `/prisoner/prisoner`  | Token | Works   | Update a prisoner                    |
| DELETE | `/prisoner/prisoner`  | Token | Works   | Delete a prisoner                    |

#### Prisoner fields

| Field         | Type     | Notes                                                                                                                    |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`          | integer  | Auto-assigned.                                                                                                           |
| `birthName`   | string   | Legal name.                                                                                                              |
| `chosenName`  | string   | Name the person goes by.                                                                                                 |
| `prison`      | integer  | Id of the prison. Not validated against the prisons table.                                                               |
| `inmateID`    | string   | Facility-issued identifier. Free text.                                                                                   |
| `releaseDate` | datetime | ISO-8601 string.                                                                                                         |
| `bio`         | string   |                                                                                                                          |
| `status`      | string   | Intended to be one of `pretrial`, `incarcerated`, `free`. Not validated; any string is stored.                           |
| `prisonId`    | integer  | Appears in responses, always `null`. An artifact of a mismatched association (Known issues 17). Ignore it; use `prison`. |

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
		"updatedAt": "2026-09-11T16:40:19.880Z",
		"createdAt": "2026-09-11T16:40:19.880Z"
	},
	"info": "Successfully created prisoner",
	"success": true,
	"status": 200,
	"name": "prisoner create"
}
```

#### GET /prisoner/prisoners

Parameters: `prison`, `full`, `page`, `page_size`.

Without `prison`, returns a page of all prisoners. `full=true` adds a `prison_details` key to each row, but it is always `null` (Known issues 17).

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
			"createdAt": "2026-09-11T16:39:42.378Z",
			"updatedAt": "2026-09-11T16:39:42.378Z",
			"prisonId": null
		}
	],
	"info": "Successfully retireved prisoners list",
	"success": true,
	"status": 200,
	"name": "prisoner many"
}
```

**Filtering by prison is broken.** `?prison=1` fails with `Argument passed to findByPk is invalid: false` because the controller passes its arguments in the wrong order (Known issues 11).

#### GET /prisoner/prisoner

Parameters: `id` (required), `full`. Returns the prisoner in `data`, or `"data": null` if not found. `full=true` adds `prison_details: null`.

#### PUT /prisoner/prisoner

Body: `{"id": 41, "chosenName": "Doc Updated"}` plus any other fields.

#### DELETE /prisoner/prisoner

Body: `{"id": 41}`. Returns the deleted-row count. Chats and messages that reference the prisoner are left in place.

### Rules

| Method | Path          | Auth  | Status  | Purpose                          |
| ------ | ------------- | ----- | ------- | -------------------------------- |
| POST   | `/rule/rule`  | Token | Works   | Create a rule                    |
| GET    | `/rule/rules` | Token | Partial | List rules, optionally by prison |
| GET    | `/rule/rule`  | Token | Partial | Get one rule by id               |
| PUT    | `/rule/rule`  | Token | Works   | Update a rule                    |
| DELETE | `/rule/rule`  | Token | Works   | Delete a rule                    |

#### Rule fields

| Field         | Type    | Notes                           |
| ------------- | ------- | ------------------------------- |
| `id`          | integer | Auto-assigned.                  |
| `title`       | string  | Short name, e.g. "No pictures". |
| `description` | string  | Longer explanation.             |

Rules are not tied to a prison at creation. A `prison` field in the create body is silently ignored. The only way to link a rule to a prison is `PUT /prison/rule`, which is currently broken, so in practice rules are a standalone list.

#### POST /rule/rule

```bash
curl -s -X POST http://localhost:3000/rule/rule \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Doc rule","description":"Documented"}'
```

```json
{
	"data": {
		"id": 45,
		"title": "Doc rule",
		"description": "Documented",
		"updatedAt": "2026-09-11T16:40:19.956Z",
		"createdAt": "2026-09-11T16:40:19.956Z"
	},
	"info": "Successfully created rule",
	"success": true,
	"status": 200,
	"name": "rule create"
}
```

#### GET /rule/rules

Parameters: `prison`, `page`, `page_size`. `full` is accepted but ignored on the unfiltered list.

The unfiltered list works. `?prison=1` fails with a `SequelizeEagerLoadingError` about the alias `prisons` (Known issues 9).

#### GET /rule/rule

Parameters: `id` (required), `full`. Works without `full`; `full=true` fails with the same alias error.

#### PUT /rule/rule and DELETE /rule/rule

Body `{"id": 45, ...}` and `{"id": 45}` respectively. Both work.

### Chats

| Method | Path          | Auth  | Status  | Purpose                                     |
| ------ | ------------- | ----- | ------- | ------------------------------------------- |
| POST   | `/chat/chat`  | Token | Works   | Create a chat between a user and a prisoner |
| GET    | `/chat/chats` | Token | Partial | List chats, optionally by user or prisoner  |
| GET    | `/chat/chat`  | Token | Partial | Get one chat by id or by user + prisoner    |
| PUT    | `/chat/chat`  | Token | Broken  | Update a chat                               |
| DELETE | `/chat/chat`  | Token | Works   | Delete a chat and its messages              |

#### Chat fields

| Field        | Type    | Notes                                                                          |
| ------------ | ------- | ------------------------------------------------------------------------------ |
| `id`         | integer | Auto-assigned.                                                                 |
| `user`       | integer | Id of the user.                                                                |
| `prisoner`   | integer | Id of the prisoner.                                                            |
| `userId`     | integer | Always `null`. Artifact of a mismatched association (Known issues 17). Ignore. |
| `prisonerId` | integer | Always `null`. Same.                                                           |

You usually do not need to create chats by hand. Sending a message with `POST /messaging/message` finds or creates the chat for that user and prisoner pair automatically.

#### POST /chat/chat

Body: `{"user": 1, "prisoner": 2}`. Neither id is checked for existence, and duplicates are not prevented: posting the same pair twice creates two chats (Known issues 18). Prefer letting the messages endpoint create chats.

```json
{
	"data": {
		"id": 41,
		"user": 1,
		"prisoner": 2,
		"updatedAt": "2026-09-11T16:40:20.097Z",
		"createdAt": "2026-09-11T16:40:20.097Z"
	},
	"info": "Successfully created chat",
	"success": true,
	"status": 200,
	"name": "chat create"
}
```

#### GET /chat/chats

Parameters: `user`, `prisoner`, `full`, `page`, `page_size`. If both `user` and `prisoner` are given, `user` wins and `prisoner` is ignored.

```bash
curl -s 'http://localhost:3000/chat/chats?user=1' -H "Authorization: Bearer $TOKEN"
```

```json
{
	"data": [
		{
			"user": 1,
			"prisoner": 1,
			"id": 1,
			"createdAt": "2026-09-11T16:39:42.422Z",
			"updatedAt": "2026-09-11T16:39:42.422Z",
			"prisonerId": null,
			"userId": null
		}
	],
	"info": "Successfully retireved chats list",
	"success": true,
	"status": 200,
	"name": "chat many"
}
```

Filtering by a user or prisoner that does not exist returns a controller error such as `"error": "User 9999 not found"`.

`full=true` adds `messages`, `user_details`, and `prisoner_details` to each chat, but they are always `[]`, `null`, and `null` (Known issues 17).

#### GET /chat/chat

Two ways to call it:

- By id: `?id=1`. **Returns an array** containing the single chat, not a bare object.
- By pair: `?user=1&prisoner=1`. Returns a bare object, or `null` if that pair has no chat.

```bash
curl -s 'http://localhost:3000/chat/chat?user=1&prisoner=1' -H "Authorization: Bearer $TOKEN"
```

```json
{
	"data": {
		"user": 1,
		"prisoner": 1,
		"id": 1,
		"createdAt": "2026-09-11T16:39:42.422Z",
		"updatedAt": "2026-09-11T16:39:42.422Z",
		"prisonerId": null,
		"userId": null
	},
	"info": "Success getting chat",
	"success": true,
	"status": 200,
	"name": "chat one"
}
```

Failure modes:

- Only one of `user` / `prisoner`, or no parameters: returns `200` with `"data": {}`. The code contains error messages for these cases but never raises them (Known issues 16).
- `?id=1&full=true`: fails with an alias error (Known issues 14). `?user=1&prisoner=1&full=true` succeeds but the embedded records are empty.

#### PUT /chat/chat

**Broken.** Any update fails with `SQLITE_ERROR: no such column: chat` (Known issues 15).

#### DELETE /chat/chat

Body: `{"id": 41}`. Deletes messages whose `chat` matches, then the chat. Returns the number of chats deleted.

### Messages

| Method | Path                  | Auth  | Status  | Purpose                                     |
| ------ | --------------------- | ----- | ------- | ------------------------------------------- |
| POST   | `/messaging/message`  | Token | Works   | Send a message (creates the chat if needed) |
| GET    | `/messaging/messages` | Token | Partial | List messages                               |
| GET    | `/messaging/message`  | Token | Broken  | Get one message by id                       |
| PUT    | `/messaging/message`  | Token | Partial | Update a message                            |
| DELETE | `/messaging/message`  | Token | Works   | Delete a message                            |

#### Message fields

| Field         | Type    | Notes                                                                                      |
| ------------- | ------- | ------------------------------------------------------------------------------------------ |
| `id`          | integer | Auto-assigned.                                                                             |
| `chat`        | integer | Id of the chat. Set automatically from `user` + `prisoner`; do not send it.                |
| `messageText` | string  | The letter body.                                                                           |
| `sender`      | string  | Required. `user` or `prisoner`.                                                            |
| `user`        | integer | Required. Id of the user side of the conversation.                                         |
| `prisoner`    | integer | Required. Id of the prisoner side.                                                         |
| `chatId`      | integer | Always `null`. Artifact of a mismatched association (Known issues 17). Ignore; use `chat`. |

#### POST /messaging/message

This is the main write endpoint of the product. Before the message is saved, the server looks up a chat for the `user` and `prisoner` pair and creates one if none exists, then stores the message under it.

```bash
curl -s -X POST http://localhost:3000/messaging/message \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"messageText":"Hello from the docs","sender":"user","prisoner":1,"user":1}'
```

```json
{
	"data": {
		"id": 41,
		"messageText": "Hello from the docs",
		"sender": "user",
		"prisoner": 1,
		"user": 1,
		"updatedAt": "2026-09-11T16:40:20.201Z",
		"createdAt": "2026-09-11T16:40:20.201Z",
		"chat": 1
	},
	"info": "Successfully created message",
	"success": true,
	"status": 200,
	"name": "message create"
}
```

`chat` in the response tells you which thread the message landed in. Sending to a new pair returns a freshly created chat id.

Failure modes:

- `sender` other than `user` / `prisoner`: validation error `"Sender must either be user or prisoner."`
- Missing `user` or `prisoner`: a controller error with `"error": "WHERE parameter \"user\" has invalid \"undefined\" value"`. The chat lookup runs before validation, so you get a database error instead of the schema's friendlier message.
- Neither `user` nor `prisoner` is checked for existence.

#### GET /messaging/messages

Parameters: `id`, `chat`, `prisoner`, `user`, `page`, `page_size`, `full`. Filters take precedence in that order; only the first one present is used.

The unfiltered list works and is paginated:

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
			"createdAt": "2026-09-11T16:39:42.464Z",
			"updatedAt": "2026-09-11T16:39:42.464Z",
			"chatId": null
		}
	],
	"info": "Successfully retireved message list",
	"success": true,
	"status": 200,
	"name": "message many"
}
```

**Every filter is effectively broken.** `?chat=1`, `?prisoner=1`, `?user=1`, and `?id=1` all succeed with `"data": []` even when matching rows exist, because the controller shifts its arguments by one and the database ends up skipping the first ten rows (Known issues 12). Filtering by a `chat`, `prisoner`, or `user` id that does not exist correctly returns `"error": "Chat 9999 not found"`.

Until this is fixed, a client that needs a thread's messages should page through the unfiltered list and filter by `chat` on its own side.

#### GET /messaging/message

**Broken.** Fails with `Message.getMessageByID is not a function` (Known issues 13).

#### PUT /messaging/message

Body must include `id`, **and** `user` **and** `prisoner`, because the automatic chat lookup also runs on update. A body such as `{"id": 2, "messageText": "Edited"}` fails with the same `WHERE parameter "user"` error as a create without those fields.

```bash
curl -s -X PUT http://localhost:3000/messaging/message \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":2,"messageText":"Edited via docs","sender":"user","prisoner":2,"user":2}'
```

#### DELETE /messaging/message

Body: `{"id": 41}`. Returns the deleted-row count.

### Chapters

| Method | Path                | Auth  | Status | Purpose                       |
| ------ | ------------------- | ----- | ------ | ----------------------------- |
| POST   | `/chapter/chapter`  | Token | Works  | Create a chapter              |
| GET    | `/chapter/chapters` | Token | Works  | List all chapters (no paging) |
| GET    | `/chapter/chapter`  | Token | Works  | Get one chapter by id         |
| PUT    | `/chapter/chapter`  | Token | Works  | Update a chapter              |
| DELETE | `/chapter/chapter`  | Token | Works  | Delete a chapter              |

#### Chapter fields

| Field             | Type    | Notes                                                          |
| ----------------- | ------- | -------------------------------------------------------------- |
| `id`              | integer | Auto-assigned.                                                 |
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
		"updatedAt": "2026-09-11T16:40:20.277Z",
		"createdAt": "2026-09-11T16:40:20.277Z"
	},
	"info": "Successfully created chapter",
	"success": true,
	"status": 200,
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
			"createdAt": "2026-09-11T16:39:42.513Z",
			"updatedAt": "2026-09-11T16:39:42.513Z"
		}
	],
	"info": "Successfully retireved chapter list",
	"success": true,
	"status": 200,
	"name": "chapter many"
}
```

#### GET /chapter/chapter, PUT /chapter/chapter, DELETE /chapter/chapter

`?id=1` for GET; `{"id": 2, ...}` in the body for PUT and DELETE. All work. A GET for a missing id returns `"data": null`.

## Known issues

These are the problems a client will run into today. Each number is referenced from the endpoint sections above. File and line references, root causes, and suggested fixes are in the [developer guide](docs/DEVELOPER.md#bug-catalog).

1. **Every controller response crashes** with `this.hasOwn is not a function`, status 400. Introduced by an automated lint fix in June 2025. Until this one-line fix lands, no endpoint in this document works. The rest of this list assumes it is fixed.
2. **Tokens are not checked against the user table.** A token signed with the server's secret is accepted even if the user id inside it does not exist or was deleted.
3. **Registration is public and accepts `role: "admin"`.**
4. **Roles are never enforced.** Any valid token can read, create, change, and delete anything, including users.
5. `GET /auth/users` returns empty objects.
6. `GET /auth/users?role=...` crashes.
7. `POST /auth/user` without `role` crashes with a `TypeError` instead of a validation message.
8. Passwords changed through `PUT /auth/user` are stored unhashed and break login for that account.
9. `full=true` on prisons, and `?prison=` or `full=true` on rules, fail with an alias error.
10. `PUT /prison/rule` crashes, so rules cannot be attached to prisons.
11. `GET /prisoner/prisoners?prison=` fails.
12. All filters on `GET /messaging/messages` return empty lists.
13. `GET /messaging/message` crashes.
14. `GET /chat/chat?id=&full=true` fails with an alias error.
15. `PUT /chat/chat` fails.
16. `GET /chat/chat` with incomplete parameters returns success with `{}` instead of an error.
17. All embedded relations (`full=true`) come back empty or `null` because the associations point at unused `userId` / `prisonerId` / `chatId` / `prisonId` columns instead of the real `user` / `prisoner` / `chat` / `prison` columns. Those unused columns also appear in every response.
18. Duplicate chats for the same user and prisoner pair can be created.
19. `GET /auth/protected` is listed in the route constants but returns a 404.
20. Path-style ids (`/prison/prison/1`) are accepted by the router and then fail. Use query strings.
21. Non-numeric `page` or `page_size` values cause a database error.
22. "Not found" is reported inconsistently: `200` with `null` for most lookups, `400` for users, `200` with `0` for deletes.
23. Error responses use status 400 for everything, including server faults, and include full stack traces.
24. `status` on prisoners and string lengths on users are not validated even though the schema tries to.
25. The whole database is wiped and reseeded on every server start.
26. CORS is hardcoded to `http://localhost:3001`.

## Postman collection

`ABC-3.postman_collection.json` in the repository root predates several changes and needs updating before it is useful:

- Login requests send `name`; the server expects `username`.
- Chat requests target `/messaging/chat`; chats now live at `/chat/chat`.
- Some requests use path ids (`/prisoner/prisoner/1`); use `?id=1` instead.
- It contains a stale hardcoded JWT variable; replace it with a token from `POST /auth/login`.

`ABC-3.postman_collection_old.json` is an even older snapshot kept for reference.

## Further reading

- [Developer guide](docs/DEVELOPER.md): architecture, request lifecycle, data model, tooling, and a bug catalog with file and line references.
- [GitHub repository](https://github.com/Aye-Bee-See/sqlite-express-api)
