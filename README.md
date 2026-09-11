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

| Term               | Meaning                                                                                                                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User**           | An account. Has a `role` of `admin`, `user`, `chapter`, or `banned`. A `user` is a person on the outside writing letters; a `chapter` is a partner organisation that prints and mails them; an `admin` manages everything.                                     |
| **Prison**         | A correctional facility. Has a name and a free-form JSON `address`.                                                                                                                                                                                            |
| **Prisoner**       | An incarcerated person that users can write to. Belongs to one prison. Stores birth name, chosen name, inmate ID, release date, a bio, and a status.                                                                                                           |
| **Rule**           | A mail rule a prison enforces, such as "No pictures". A rule can be attached to many prisons and a prison can have many rules.                                                                                                                                 |
| **Chat**           | A thread between exactly one user and one prisoner. Chats are created automatically the first time a message is sent between a pair, and can also be created directly.                                                                                         |
| **Message**        | One letter or text within a chat. `sender` is either `user` or `prisoner`. A letter has a lifecycle `status` (`queued`, `printed`, `mailed`; replies are `received`) and a relay group that prints and mails it; see [Letter lifecycle](#letter-lifecycle).    |
| **Managed writer** | A `user` account a group created for someone who writes through it (for example at a letter-writing night). The group sends letters on the writer's behalf until the writer claims the account with a one-time token; see [Managed writers](#managed-writers). |
| **Chapter**        | A local chapter of the partner non-profit. Has a name, a JSON `location`, and some statistics fields. Note that chapter _accounts_ are users with the `chapter` role; the Chapter resource describes the organisation itself.                                  |

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

These work without a token:

- `POST /auth/user` registers an account. It always gets the `user` role.
- `POST /auth/login` returns a token.
- `GET /auth/claim` and `POST /auth/claim` check and use a claim token; see [Managed writers](#managed-writers).
- Every **GET** on prisons, prisoners, rules, and chapters (the public directory). Anonymous callers see only records whose `recordStatus` is `published`; see [Record status](#record-status).
- `GET /health`.

Everything else, including every write, requires a bearer token. A token that is present but invalid is rejected with `401` even on public routes.

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

| Action                                                     | `user`                | `chapter`                         | `admin` |
| ---------------------------------------------------------- | --------------------- | --------------------------------- | ------- |
| Read published prisons, prisoners, rules, chapters         | Yes (and anonymous)   | Yes                               | Yes     |
| Read draft and pending directory records                   | No                    | Yes                               | Yes     |
| Create, update, delete prisons, prisoners, rules, chapters | No                    | Yes                               | Yes     |
| Attach a rule to a prison                                  | No                    | Yes                               | Yes     |
| Read, create, update, delete chats and messages            | **Own threads only**  | **Managed writers' threads only** | All     |
| Send a message as the prisoner side (`sender: prisoner`)   | No (forced to `user`) | Yes                               | Yes     |
| Create managed writers, issue claim tokens                 | No                    | Own group                         | Yes     |
| Read, edit, delete a group's unclaimed managed writers     | No                    | Own group                         | Yes     |
| Read own user record; update or delete own account         | Yes                   | Yes                               | Yes     |
| Read, update, delete other users; list users               | No                    | No                                | Yes     |
| Change a role, or create a non-`user` account              | No                    | No                                | Yes     |

"Own threads" means chats whose `user` is the caller's id, and messages whose `user` is the caller's id. For a `user`:

- List endpoints silently filter to the caller; a `user` or `prisoner` query parameter cannot widen the result.
- Fetching, updating, or deleting someone else's chat or message returns `403`.
- Creating a chat or message always uses the caller's own id as `user`, whatever the body says, and messages are always sent as `user`.

Every refusal is a `403` with the general error shape.

A `chapter` account is scoped to its group. It sees the threads of the writers its group manages (see [Managed writers](#managed-writers)) and the threads holding letters its group relays (see [Letter lifecycle](#letter-lifecycle)), can send letters for its writers and transcribe prisoner replies on either, and sees nothing else. A `chapter` account that is not yet a member of a group (no `chapterId`) has no threads at all and cannot create writers; an admin puts it in a group with `PUT /auth/user`.

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

List responses add three fields beside `data`:

```json
{
	"data": [{ "id": 3 }, { "id": 4 }],
	"info": "Successfully retireved prisons list",
	"success": true,
	"status": 200,
	"name": "prison many",
	"total": 52,
	"page": 2,
	"page_size": 2
}
```

`total` is the number of rows that match the request across all pages (after any visibility or filter rules), so the last page number is `Math.ceil(total / page_size)`.

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

`GET /prison/prisons?page=2&page_size=2` returns the third and fourth prisons. Every list response includes `total`, `page`, and `page_size` (see [Response envelope](#response-envelope)). Invalid values return a validation error:

```json
{
	"success": false,
	"errors": ["page must be a positive integer.", "page_size must be an integer between 1 and 100."]
}
```

All list endpoints are paginated, including `GET /chapter/chapters`.

### Searching, filtering, and sorting lists

Directory lists accept these in addition to `page` and `page_size`:

| Parameter      | Where                                              | Effect                                                                                                                                                                                                                                |
| -------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `q`            | prisons, prisoners, rules, chapters, users (admin) | Case-insensitive substring match. Prisons match `prisonName`; prisoners match `birthName` or `chosenName`; rules match `title` or `description`; chapters match `name`; users match `username`, `email`, or `name`. Blank is ignored. |
| `sort`         | prisons, prisoners, rules, chapters                | `name` (alphabetical: prison name, prisoner chosen then birth name, rule title, chapter name), `newest`, or `oldest`. Default is ascending id.                                                                                        |
| `status`       | prisoners                                          | `pretrial`, `incarcerated`, or `free`.                                                                                                                                                                                                |
| `country`      | prisoners, prisons, chapters                       | Exact match on the `country` field.                                                                                                                                                                                                   |
| `featured`     | prisoners                                          | `true` or `false`.                                                                                                                                                                                                                    |
| `routing`      | prisons                                            | `direct`, `scan_only`, `direct_and_scan`, or `relay_only`.                                                                                                                                                                            |
| `service`      | chapters                                           | One service key (see [Chapter fields](#chapter-fields)); matches groups whose `services` include it.                                                                                                                                  |
| `prison`       | prisoners, rules                                   | Only records attached to that prison.                                                                                                                                                                                                 |
| `recordStatus` | prisons, prisoners, chapters (staff only)          | See below.                                                                                                                                                                                                                            |
| `role`         | users (admin)                                      | One role.                                                                                                                                                                                                                             |

Parameters combine, `total` reflects the filtered result, and every invalid value is reported together in one validation error:

```bash
curl -s 'http://localhost:3000/prisoner/prisoners?q=smith&status=incarcerated&sort=name&page_size=5'
```

Chats are not searchable, but they are always ordered by most recent activity; see [GET /chat/chats](#get-chatchats).

### Record status

Prisons, prisoners, and chapters carry a `recordStatus` of `draft`, `pending`, or `published`. It controls visibility:

| Caller                    | Sees                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anonymous, or role `user` | Published records only. A draft or pending record is a `404` by id, absent from lists, absent from `full=true` embeds, and its dependents (`?prison=` filters) are `404`s too. |
| Role `chapter` or `admin` | Everything. Add `?recordStatus=draft` (or `pending`, `published`) to a list to filter.                                                                                         |

New records default to `published` until the moderation workflow exists. Staff can pass `recordStatus` on create or update to make a record `draft` or `pending`. Rules have no status of their own; they are visible wherever the prison they are attached to is.

### The `full` parameter

Most read endpoints accept `full=true` to embed related records. The string must be exactly `true`; anything else is treated as `false`.

| Endpoint                     | `full=true` adds                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Users (list, by id, by role) | `chats`                                                                            |
| Prisons (list, by id)        | `prisoners`, `rules`, `relay_groups`                                               |
| Prisoners (list, by id)      | `prison_details`, `support_groups` (each with a `PrisonerSupport.description`)     |
| Prisoners by prison          | `prison_details`, `support_groups`, plus `chats` for admin callers only            |
| Rules (list, by id)          | `prisons`                                                                          |
| Chapters (list, by id)       | `supported_prisoners` (each with a `PrisonerSupport.description`), `relay_prisons` |
| Chats (list, by id, by pair) | `messages`, `user_details`, `prisoner_details`                                     |
| Messages                     | accepted but ignored                                                               |

Embedded rules and prisons carry a `RulePassthrough` object describing the link (see the prison example below). Embedded users never include the password hash. For anonymous and `user`-role callers, embedded prisoners, prisons, and chapters are limited to published ones, chats are never embedded, and the staff-only `verificationNotes` field is omitted from prisoners and prisons everywhere.

### Deletes and referential integrity

Foreign keys are enforced with `RESTRICT`. Deleting a record that other records still reference fails with status `400` and `"name": "SequelizeForeignKeyConstraintError"`:

- A user with chats or messages.
- A prisoner with chats or messages.
- A prison with prisoners.
- A chat with messages, **except** through `DELETE /chat/chat`, which deletes the chat's messages first.

Deleting a rule or a prison removes its rule-to-prison links automatically. Creating or updating a record that points at a nonexistent user, prisoner, chat, or prison fails the same way.

## Endpoint reference

The **Auth** column says who may call the endpoint: _Public_ (no token needed; directory reads show published records only without a staff token), _Any_ (any valid token), _Admin or chapter_, _Admin_, _Self or admin_ (your own record, or an admin), _Group_ (a `chapter` account that belongs to a group, or an admin), _Scoped_ (any token; a `user` sees their own threads, a `chapter` its group's managed writers' threads, an admin everything).

### Users

| Method | Path                 | Auth          | Purpose                                                                        |
| ------ | -------------------- | ------------- | ------------------------------------------------------------------------------ |
| POST   | `/auth/user`         | Public        | Register (role `user`); admins may set other roles                             |
| POST   | `/auth/login`        | Public        | Log in and receive a token                                                     |
| GET    | `/auth/users`        | Admin         | List users, optionally by role                                                 |
| GET    | `/auth/user`         | Self or admin | Get one user by id, email, or username; a group may read its unclaimed writers |
| PUT    | `/auth/user`         | Self or admin | Update a user; a group may edit its unclaimed writers' name, email, note       |
| DELETE | `/auth/user`         | Self or admin | Delete a user; a group may delete its unclaimed writers                        |
| POST   | `/auth/writer`       | Group         | Create a managed writer under the caller's group                               |
| GET    | `/auth/writers`      | Group         | List the group's managed writers (admins: all, or `?chapter=`)                 |
| POST   | `/auth/writer/token` | Group         | Generate or regenerate a writer's claim token                                  |
| DELETE | `/auth/writer/token` | Group         | Revoke a writer's claim token                                                  |
| GET    | `/auth/claim`        | Public        | Check a claim token                                                            |
| POST   | `/auth/claim`        | Public        | Claim a managed account                                                        |

#### User fields

| Field                      | Rules                                                                                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `username`                 | Required, unique, 3 to 16 characters.                                                                                                                                              |
| `password`                 | Required, 7 to 255 characters. Stored as a bcrypt hash. Never returned by any endpoint.                                                                                            |
| `email`                    | Required, unique, must look like an email address.                                                                                                                                 |
| `role`                     | `admin`, `user`, `chapter`, or `banned`. Case-insensitive. Defaults to `user`. Only an admin may set anything else or change it later.                                             |
| `name`                     | Optional display name, 3 to 32 characters.                                                                                                                                         |
| `bio`                      | Optional, 12 to 2400 characters.                                                                                                                                                   |
| `managedBy`                | Id of the group holding this account in custody (a managed writer). `null` for independent accounts and once claimed. Admin-only to set directly.                                  |
| `claimedAt`, `claimedFrom` | When the writer claimed the account and from which group; both `null` until then. Read-only.                                                                                       |
| `anonymousForChapter`      | Set on the one anonymous-writer account each group gets; see [Managed writers](#managed-writers). Read-only.                                                                       |
| `managerNote`              | Free-text note the managing group keeps about a writer. Returned only to admins and to the managing group; absent from every other response.                                       |
| `chapterId`                | Id of the chapter (group) this account belongs to. Only an admin can set it, on create or update; anyone else's value is ignored on registration and refused with `403` on update. |

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

Admin only. Parameters: `role`, `q`, `full`, `page`, `page_size`.

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

A non-admin may only fetch their own record, except that a group's `chapter` account may fetch the group's unclaimed managed writers; anything else is a `403`. No parameter at all is a `400`; no match is a `404`.

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

Body must include `id`; every other field present is written. A non-admin may only update their own record and may not include `role`, `chapterId`, `managedBy`, `claimedAt`, `claimedFrom`, or `anonymousForChapter`. A group's `chapter` account may also update its unclaimed managed writers, but only `name`, `email`, and `managerNote`; anything else in that body is a `403`. Changing `password` is supported and re-hashes it.

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

Body: `{"id": 43}`. Returns `"data": 1`. A user who still has chats or messages cannot be deleted (see [Deletes and referential integrity](#deletes-and-referential-integrity)). A group's `chapter` account may delete the group's unclaimed managed writers.

### Managed writers

A group often writes on behalf of people who have no account: someone at a letter-writing night, or someone who wants the group to handle everything. A **managed writer** is a `user` account the group creates for such a person. Until the writer claims it:

- The account cannot log in. It has a generated username (`writer-…`), an unguessable password, and, if no email was given, a placeholder address ending in `@managed.example`.
- The group's `chapter` accounts see its threads, send letters as it, record prisoner replies, and may edit its `name`, `email`, and `managerNote` or delete it.
- The group can hand the writer a **claim token** (valid 72 hours, shown once). The writer visits the claim page, picks a username and password, and the account becomes theirs: the group loses access to it and its threads, and `claimedAt` / `claimedFrom` record the hand-over.

Every group also has one **anonymous writer**, created the first time a `chapter` account sends a letter or creates a chat without naming a `user`. It is a managed writer like any other (it appears in the list and can even be claimed), and all of the group's anonymous letters share it.

#### POST /auth/writer

Body: `{"name": "Sam", "email": "sam@example.com", "managerNote": "Comes on Tuesdays"}`. `name` is required (3 to 32 characters); `email` and `managerNote` are optional. Admins must add `"chapter": <group id>`; a `chapter` account's own group is used and any `chapter` in its body is ignored. Returns `201` with the new user record.

```bash
curl -s -X POST http://localhost:3000/auth/writer \
  -H "Authorization: Bearer $CHAPTER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Sam","managerNote":"Comes on Tuesdays"}'
```

```json
{
	"data": {
		"id": 58,
		"username": "writer-3f9a1c2e",
		"email": "writer-3f9a1c2e@managed.example",
		"name": "Sam",
		"role": "user",
		"managedBy": 1,
		"claimedAt": null,
		"claimedFrom": null,
		"managerNote": "Comes on Tuesdays",
		"createdAt": "2026-09-11T20:30:00.000Z",
		"updatedAt": "2026-09-11T20:30:00.000Z"
	},
	"info": "Successfully created managed writer.",
	"success": true,
	"status": 201,
	"name": "user createWriter"
}
```

#### GET /auth/writers

Parameters: `page`, `page_size`, `q` (matches username, email, or name). A `chapter` account gets its group's writers, claimed ones excluded. An admin gets every unclaimed managed writer, or one group's with `chapter=<id>`. Each row carries `claimToken`: `{ "expiresAt": … }` while a token is live, otherwise `null`. The token itself is never listed.

#### POST /auth/writer/token

Body: `{"writer": 58}`. Generates a token for the writer and returns it once; generating again replaces the previous token. `409` if the account is not an unclaimed managed writer, `403` if another group manages it.

```json
{
	"data": {
		"writer": 58,
		"token": "7K3MQ9X2VD5WF0PR8HZG1AB4",
		"expiresAt": "2026-09-14T20:30:00.000Z"
	},
	"info": "Claim token generated. Show it to the writer once.",
	"success": true,
	"status": 201,
	"name": "user createToken"
}
```

Tokens are 24 characters from a case-insensitive alphabet without `I`, `L`, `O`, or `U`, so they can be read aloud or written on paper. Only a hash is stored.

#### DELETE /auth/writer/token

Body: `{"writer": 58}`. Revokes the live token; `404` if there is none.

#### GET /auth/claim

Public. `?token=…` returns who the token is for, so the claim page can show it before asking for credentials:

```json
{
	"data": {
		"writer": { "id": 58, "name": "Sam" },
		"chapter": { "id": 1, "name": "Portland Chapter" },
		"expiresAt": "2026-09-14T20:30:00.000Z"
	},
	"info": "Claim token is valid.",
	"success": true,
	"status": 200,
	"name": "user claimInfo"
}
```

An unknown or revoked token is a `404`; a used or expired one is a `410`, and `info` says which.

#### POST /auth/claim

Public. Body: `{"token": "…", "username": "sam", "password": "longenough", "email": "sam@example.com"}`. `username` and `password` follow the [user field rules](#user-fields); `email` is optional and replaces a placeholder address. On success (`201`) the account is independent: `managedBy` is `null`, `claimedAt` and `claimedFrom` are set, the token is marked used, and the writer can log in. Validation failures (a short password, a taken username) leave the token usable.

### Prisons

| Method | Path              | Auth             | Purpose                            |
| ------ | ----------------- | ---------------- | ---------------------------------- |
| POST   | `/prison/prison`  | Admin or chapter | Create a prison                    |
| GET    | `/prison/prisons` | Public           | List prisons                       |
| GET    | `/prison/prison`  | Public           | Get one prison by id               |
| PUT    | `/prison/prison`  | Admin or chapter | Update a prison                    |
| PUT    | `/prison/rule`    | Admin or chapter | Attach a rule to a prison          |
| DELETE | `/prison/rule`    | Admin or chapter | Detach a rule from a prison        |
| PUT    | `/prison/relay`   | Admin or chapter | Attach a relay group to a prison   |
| DELETE | `/prison/relay`   | Admin or chapter | Detach a relay group from a prison |
| DELETE | `/prison/prison`  | Admin or chapter | Delete a prison                    |

#### Prison fields

| Field               | Type     | Notes                                                                                          |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `prisonName`        | string   | Required.                                                                                      |
| `country`           | string   | Free text.                                                                                     |
| `routing`           | string   | How mail reaches the facility: `direct`, `scan_only`, `direct_and_scan`, or `relay_only`.      |
| `scanService`       | string   | Details of the scan service, if any.                                                           |
| `notes`             | string   | Public notes, e.g. delivery risk.                                                              |
| `verifiedBy`        | integer  | Id of the chapter that last verified the record. Must exist.                                   |
| `verifiedAt`        | datetime | When it was verified.                                                                          |
| `verificationNotes` | string   | **Staff only.** Never returned to anonymous or `user`-role callers.                            |
| `recordStatus`      | string   | `draft`, `pending`, or `published` (default). Staff only. See [Record status](#record-status). |
| `address`           | object   | Required. Free-form JSON; the seeds use `{"street": "..."}`.                                   |

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

Parameters: `page`, `page_size`, `full`, `q`, `sort`, and (staff) `recordStatus`.

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

(Embedded objects abbreviated.) An unknown rule or prison id is a `404`.

#### DELETE /prison/rule

Body: `{"rule": 1, "prison": 1}`. Detaches the rule; `404` if the link (or either record) does not exist. The rule itself is kept.

#### PUT /prison/relay and DELETE /prison/relay

Body: `{"prison": 1, "chapter": 2}`. Attaches or detaches a relay group (a chapter that prints and mails letters for this facility). Attaching is idempotent and returns the prison with `prisoners`, `rules`, and `relay_groups` embedded under `updatedRows`; detaching returns `1`, or `404` if there was no link.

#### DELETE /prison/prison

Body: `{"id": 53}`. Fails with `400` while the prison still has prisoners.

### Prisoners

| Method | Path                  | Auth             | Purpose                              |
| ------ | --------------------- | ---------------- | ------------------------------------ |
| POST   | `/prisoner/prisoner`  | Admin or chapter | Create a prisoner                    |
| GET    | `/prisoner/prisoners` | Public           | List prisoners, optionally by prison |
| GET    | `/prisoner/prisoner`  | Public           | Get one prisoner by id               |
| PUT    | `/prisoner/prisoner`  | Admin or chapter | Update a prisoner                    |
| PUT    | `/prisoner/support`   | Admin or chapter | Link a support group to a prisoner   |
| DELETE | `/prisoner/support`   | Admin or chapter | Unlink a support group               |
| DELETE | `/prisoner/prisoner`  | Admin or chapter | Delete a prisoner                    |

#### Prisoner fields

| Field               | Type     | Notes                                                                                 |
| ------------------- | -------- | ------------------------------------------------------------------------------------- |
| `birthName`         | string   | Legal name.                                                                           |
| `chosenName`        | string   | Name the person goes by.                                                              |
| `prison`            | integer  | Id of an existing prison. A nonexistent id is refused.                                |
| `inmateID`          | string   | Facility-issued identifier. Free text.                                                |
| `releaseDate`       | datetime | ISO-8601 string.                                                                      |
| `bio`               | string   |                                                                                       |
| `status`            | string   | `pretrial`, `incarcerated`, or `free`. Optional; anything else is a `400`.            |
| `statusNotice`      | string   | Free text shown on the profile, e.g. "In transit, location unconfirmed".              |
| `aliases`           | string[] | Alternate names or spellings.                                                         |
| `country`           | string   | Country of imprisonment. Free text.                                                   |
| `detainedSince`     | datetime | ISO-8601.                                                                             |
| `sentence`          | string   | Free text, e.g. "10 years".                                                           |
| `charges`           | string   | Free text.                                                                            |
| `estimatedRelease`  | string   | Free text, e.g. "2033", "~2029", "Unknown". `releaseDate` remains for a precise date. |
| `interests`         | string[] | Tags shown on the profile.                                                            |
| `photoUrl`          | string   | Must be a URL. Uploads are not supported yet.                                         |
| `supportWebsite`    | string   | Must be a URL.                                                                        |
| `donationInfo`      | string   | Free text.                                                                            |
| `featured`          | boolean  | Shown on the home page. Default `false`.                                              |
| `verifiedBy`        | integer  | Id of the chapter that last verified the record. Must exist.                          |
| `verifiedAt`        | datetime | When it was verified.                                                                 |
| `verificationNotes` | string   | **Staff only.** Never returned to anonymous or `user`-role callers.                   |
| `recordStatus`      | string   | `draft`, `pending`, or `published` (default). Staff only.                             |

All fields are optional at the database level. Array and object fields are validated for shape; `aliases` and `interests` must be arrays of non-empty strings.

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

Parameters: `prison`, `status`, `q`, `sort`, `full`, `page`, `page_size`, and (staff) `recordStatus`.

```bash
curl -s 'http://localhost:3000/prisoner/prisoners?prison=1' -H "Authorization: Bearer $TOKEN"
```

Returns only prisoners whose `prison` matches. A `prison` id that does not exist (or is not published, for non-staff) is a `404`. Without `prison`, all prisoners are listed. With `full=true` each row gains `prison_details` and `support_groups` (and, for admins filtering by prison, `chats`):

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

#### PUT /prisoner/support and DELETE /prisoner/support

Body: `{"prisoner": 1, "chapter": 2, "description": "Letter collection, US Pacific Northwest"}`. Links a support group to a prisoner; sending the same pair again updates the description. The response embeds the prisoner with its `support_groups`, each carrying `PrisonerSupport.description`. `DELETE` with `{"prisoner": 1, "chapter": 2}` removes the link and returns `1`, or `404` if there was none. Unknown ids are `404`.

#### PUT /prisoner/prisoner and DELETE /prisoner/prisoner

Body `{"id": 41, "chosenName": "Doc Updated"}` and `{"id": 41}` respectively. A prisoner with chats or messages cannot be deleted.

### Rules

| Method | Path          | Auth             | Purpose                          |
| ------ | ------------- | ---------------- | -------------------------------- |
| POST   | `/rule/rule`  | Admin or chapter | Create a rule                    |
| GET    | `/rule/rules` | Public           | List rules, optionally by prison |
| GET    | `/rule/rule`  | Public           | Get one rule by id               |
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

Parameters: `prison`, `q`, `sort`, `full`, `page`, `page_size`. `?prison=1` returns the rules attached to prison 1 (`404` if the prison does not exist). `full=true` embeds `prisons` on the unfiltered list.

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

| Method | Path          | Auth   | Purpose                                     |
| ------ | ------------- | ------ | ------------------------------------------- |
| POST   | `/chat/chat`  | Scoped | Create a chat between a user and a prisoner |
| GET    | `/chat/chats` | Scoped | List chats, optionally by user or prisoner  |
| GET    | `/chat/chat`  | Scoped | Get one chat by id or by user + prisoner    |
| PUT    | `/chat/chat`  | Scoped | Update a chat                               |
| DELETE | `/chat/chat`  | Scoped | Delete a chat and its messages              |

"Scoped" means: a `user` sees and acts on their own threads; a `chapter` account on the threads of the writers its group manages and on threads holding a letter its group relays; an admin on everything. Reading, updating, or deleting a thread outside the scope is a `403`.

#### Chat fields

| Field      | Type    | Notes                       |
| ---------- | ------- | --------------------------- |
| `user`     | integer | Id of an existing user.     |
| `prisoner` | integer | Id of an existing prisoner. |

You usually do not need to create chats by hand. Sending a message with `POST /messaging/message` finds or creates the chat for that user and prisoner pair automatically.

#### POST /chat/chat

Body: `{"user": 1, "prisoner": 9}`. For a `user`-role caller the `user` field is replaced with their own id. A `chapter` account may name one of its group's managed writers, or omit `user` to use the group's anonymous writer; any other id is a `403`. Nonexistent ids are refused. Duplicates are not prevented; the message endpoint's find-or-create always uses the oldest chat for a pair, so prefer letting it create chats.

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

Parameters: `user`, `prisoner`, `full`, `page`, `page_size`. `user` and `prisoner` combine. A `user`-role caller always gets their own chats, whatever `user` says, and may narrow with `prisoner`. A `chapter` account gets its group's managed writers' chats; a `user` outside that set is a `403`. A `user` or `prisoner` id that does not exist is a `404`.

Chats are ordered by most recent message first; chats with no messages come last. Every row carries two extra fields for inbox views:

- `lastMessageAt`: timestamp of the newest message, or `null`.
- `last_message`: `{ id, sender, messageText, status, createdAt }` of the newest message, or `null`. `sender` tells you the direction (`user` means sent, `prisoner` means received).

```json
{
	"user": 1,
	"prisoner": 1,
	"id": 1,
	"createdAt": "2026-09-11T18:21:43.400Z",
	"updatedAt": "2026-09-11T18:21:43.400Z",
	"lastMessageAt": "2026-09-11T18:21:43.426Z",
	"last_message": {
		"id": 1,
		"sender": "user",
		"messageText": "Hello",
		"createdAt": "2026-09-11T18:21:43.426Z"
	}
}
```

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

| Method | Path                  | Auth                 | Purpose                                             |
| ------ | --------------------- | -------------------- | --------------------------------------------------- |
| POST   | `/messaging/message`  | Scoped               | Send a message (creates the chat if needed)         |
| GET    | `/messaging/messages` | Scoped               | List messages                                       |
| GET    | `/messaging/message`  | Scoped               | Get one message by id                               |
| PUT    | `/messaging/message`  | Scoped               | Update a message (while still queued, unless admin) |
| PUT    | `/messaging/status`   | Relay group or admin | Move a letter to `printed` or `mailed`              |
| DELETE | `/messaging/message`  | Scoped               | Delete a message (while still queued, unless admin) |

The scope is the same as for chats: own messages for a `user`; the group's managed writers' messages plus the letters the group relays for a `chapter` account; everything for an admin.

#### Letter lifecycle

Every message carries a `status`:

| Status     | Meaning                                             | Set by                                                 |
| ---------- | --------------------------------------------------- | ------------------------------------------------------ |
| `queued`   | Written, waiting for the relay group to print it    | The server, on every new letter (`sender: user`)       |
| `printed`  | Printed by the relay group                          | `PUT /messaging/status` by the relay group or an admin |
| `mailed`   | In the post                                         | Same, from `printed` only                              |
| `received` | A prisoner reply, transcribed or scanned by a group | The server, on every reply (`sender: prisoner`)        |

Moves are forward only: `queued` to `printed` to `mailed`. Anything else, including moving a reply, is a `409` with `"name": "LetterStatusError"`. Every change is recorded: `statusChangedAt` and `statusChangedBy` on the message, and a history you can read with `full=true` on `GET /messaging/message`.

While a letter is `queued` its writer may still edit or delete it. Once printed, only an admin can. Replies stay editable by whoever can see them.

**Relay group.** `relayChapter` names the group that prints and mails the letter. It must be one of the facility's relay groups (see [PUT /prison/relay](#put-prisonrelay-and-delete-prisonrelay)). When the body omits it, the server picks one:

1. the caller's own group, if a `chapter` account is sending and its group relays for that facility;
2. otherwise the facility's only relay group, if it has exactly one;
3. otherwise none, unless the facility's `routing` is `relay_only`, in which case the letter is refused with a validation error telling the writer to choose a group (or that the facility has no relay group yet).

A relay group sees the letter and its whole thread, can record the prisoner's reply on it, and is the only group that can move its status. It cannot write new letters as an independent writer.

#### Message fields

| Field                                | Type    | Notes                                                                                                                                                                                                                    |
| ------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chat`                               | integer | Id of the chat. Set automatically from `user` + `prisoner`; do not send it.                                                                                                                                              |
| `messageText`                        | string  | The letter body.                                                                                                                                                                                                         |
| `sender`                             | string  | Required. `user` or `prisoner`. A `user`-role caller is always recorded as `user`.                                                                                                                                       |
| `user`                               | integer | Id of the user side. A `user`-role caller's own id is used regardless of body. A `chapter` account may name one of its group's managed writers, or omit it to send as the group's anonymous writer. Required for admins. |
| `status`                             | string  | Read-only here; see [Letter lifecycle](#letter-lifecycle). Change it with `PUT /messaging/status`.                                                                                                                       |
| `relayChapter`                       | integer | Group that prints and mails the letter. Optional; resolved from the facility's relay groups when omitted, validated against them when given.                                                                             |
| `relayNote`                          | string  | Optional instructions for the relay group (page count, language, "include the photo"). Never part of the letter.                                                                                                         |
| `statusChangedAt`, `statusChangedBy` |         | Read-only. When the status last changed and which account changed it.                                                                                                                                                    |
| `prisoner`                           | integer | Required. Id of the prisoner side.                                                                                                                                                                                       |

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
- A `relayChapter` that does not relay for the facility, or a `relay_only` facility with no resolvable group: validation error (see [Letter lifecycle](#letter-lifecycle)).

#### GET /messaging/messages

Parameters: `id`, `chat`, `prisoner`, `user`, `status`, `relayChapter`, `page`, `page_size`. The selectors `id`, `chat`, `prisoner`, `user` take precedence in that order; only the first one present is used. `status` and `relayChapter` narrow whichever selection results, so a group's print queue is `?relayChapter=<its id>&status=queued`. A filter naming a chat, prisoner, or user that does not exist is a `404`; an unknown `status` is a validation error. A `user`-role caller only ever receives their own messages, whatever filter they pass; a `chapter` account only messages within its scope.

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

Parameters: `id` (required), `full`. Returns the message object, `404` if missing, `403` if it is outside the caller's scope. With `full=true` the response also embeds `relay_group` (`{ id, name }` or `null`) and `status_history`, oldest first:

```json
{
	"status_history": [
		{
			"id": 7,
			"message": 41,
			"fromStatus": null,
			"toStatus": "queued",
			"changedBy": 43,
			"createdAt": "…"
		},
		{
			"id": 9,
			"message": 41,
			"fromStatus": "queued",
			"toStatus": "printed",
			"changedBy": 5,
			"createdAt": "…"
		}
	]
}
```

#### PUT /messaging/message

Body must include `id`; any of `messageText`, `sender`, `user`, `prisoner`, `relayChapter`, `relayNote` may follow. Partial updates work: `{"id": 1, "messageText": "Edited"}` changes only the text. Changing `user` or `prisoner` moves the message to the chat for the new pair, creating it if needed. A `relayChapter` is validated as on create. `status` and the status timestamps are ignored here; use `PUT /messaging/status`. A `user`-role caller cannot change `user`. Once a letter is `printed` or `mailed`, only an admin may update it; anyone else gets a `403`.

```json
{
	"data": { "updatedRows": [1], "newMessage": { "id": 1, "messageText": "Edited" } },
	"info": "Succeessfully updated message",
	"success": true,
	"status": 200,
	"name": "message update"
}
```

#### PUT /messaging/status

Body: `{"id": 41, "status": "printed"}`. Allowed for admins and for `chapter` accounts whose group is the letter's `relayChapter`; anyone else gets a `403`. Returns the message with `relay_group` and `status_history` embedded (the `full=true` shape). A move the lifecycle does not allow is a `409`:

```json
{
	"success": false,
	"name": "LetterStatusError",
	"info": "Error updating letter status.",
	"status": 409,
	"error": "A mailed letter cannot move to printed."
}
```

#### DELETE /messaging/message

Body: `{"id": 41}`. Returns `"data": 1`. Once a letter is `printed` or `mailed`, only an admin may delete it.

### Chapters

| Method | Path                | Auth             | Purpose               |
| ------ | ------------------- | ---------------- | --------------------- |
| POST   | `/chapter/chapter`  | Admin or chapter | Create a chapter      |
| GET    | `/chapter/chapters` | Public           | List chapters         |
| GET    | `/chapter/chapter`  | Public           | Get one chapter by id |
| PUT    | `/chapter/chapter`  | Admin or chapter | Update a chapter      |
| DELETE | `/chapter/chapter`  | Admin or chapter | Delete a chapter      |

#### Chapter fields

| Field             | Type     | Notes                                                                                                                                                                                |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`            | string   | Required.                                                                                                                                                                            |
| `location`        | object   | Required. Free-form JSON.                                                                                                                                                            |
| `prisoners`       | object   | Optional JSON blob. Not a relation. Only settable through PUT.                                                                                                                       |
| `lettersSent`     | string   | Optional. Only settable through PUT.                                                                                                                                                 |
| `averageTimeDays` | integer  | Optional. Only settable through PUT.                                                                                                                                                 |
| `subregion`       | string   | City, region, or area, e.g. "Portland, OR".                                                                                                                                          |
| `country`         | string   | Free text.                                                                                                                                                                           |
| `about`           | string   | Free text.                                                                                                                                                                           |
| `website`         | string   | Must be a URL.                                                                                                                                                                       |
| `email`           | string   | Public contact email. Must be an email address.                                                                                                                                      |
| `socialLinks`     | object   | Keys `instagram`, `mastodon`, `bluesky`, `x`, `youtube`; string values (empty means unset).                                                                                          |
| `services`        | string[] | Any of `letter_collection`, `letter_writing_nights`, `domestic_mailing`, `international_mailing`, `international_relay`, `translation_assistance`, `legal_support`, `book_programs`. |
| `announcement`    | string   | One current announcement for the public profile.                                                                                                                                     |
| `vouchedBy`       | integer  | Id of the chapter that vouched this group into the network. Must exist.                                                                                                              |
| `recordStatus`    | string   | `draft`, `pending`, or `published` (default). Staff only.                                                                                                                            |

`prisoners` (a JSON blob) is deprecated in favour of the `support_groups` relation and will be removed. `lettersSent` and `averageTimeDays` are free statistics fields.

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

Parameters: `page`, `page_size`, `q`, `sort`, and (staff) `recordStatus`.

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

`?id=1` for GET (add `full=true` to embed `supported_prisoners` and `relay_prisons`); `{"id": 2, ...}` in the body for PUT and DELETE. A missing id is a `404` on all three.

## Known quirks

None of these break anything, but clients should know about them.

1. Several `info` strings contain typos ("retireved", "Succeessfully") that clients may already match on. They are left as-is for now.
2. `PUT /prison/rule` returns the prison object under a key named `updatedRows`.
3. Embedded rules and prisons include a `RulePassthrough` object describing the link row.
4. `full=true` is accepted but ignored on message endpoints.
5. Chats are not unique per user and prisoner pair when created through `POST /chat/chat`. The message endpoint always reuses the oldest chat for a pair.
6. There is no endpoint to detach a rule from a prison.
7. Seeded ids are not stable across databases. Read them from responses.

## Postman collection

`ABC-3.postman_collection.json` in the repository root matches the current API. Import it, then:

1. Run **Users › Login (seeded admin)**. Its test script stores the token in the `{{jwt}}` collection variable and the admin's id in `{{userId}}`.
2. Every other request sends `{{jwt}}` as a bearer token automatically.
3. Ids in request bodies are examples from the seed data; adjust them from list responses.

`ABC-3.postman_collection_old.json` is a historical snapshot and does not match the API.

## Further reading

- [Developer guide](docs/DEVELOPER.md): architecture, request lifecycle, data model, authorization internals, tooling, and how to add a resource.
- [GitHub repository](https://github.com/Aye-Bee-See/sqlite-express-api)
