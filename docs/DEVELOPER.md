# Aye Bee See API: Developer Guide

This guide is for people changing the code in this repository. It explains how the service is put together, how a request travels through it, how authentication and authorization work, how the data layer is wired, what tooling is in place, and what is still open. If you only want to call the API, read the [README](../README.md) instead.

It describes `main` after pull requests #60 and #61 (September 2026). Line references point at that state; they drift as files change, so treat them as a starting point for `grep`, not gospel. Every behavioral claim was verified by running the server.

## Contents

- [What this service is](#what-this-service-is)
- [Quick start for developers](#quick-start-for-developers)
- [Architecture overview](#architecture-overview)
- [Repository map](#repository-map)
- [Module path aliases](#module-path-aliases)
- [Configuration](#configuration)
- [Boot sequence](#boot-sequence)
- [Routing layer](#routing-layer)
- [Controller layer](#controller-layer)
- [Response and error contract](#response-and-error-contract)
- [Authentication internals](#authentication-internals)
- [Authorization internals](#authorization-internals)
- [Data layer](#data-layer)
- [Seeds](#seeds)
- [Pagination and the `full` flag](#pagination-and-the-full-flag)
- [Tooling](#tooling)
- [How to add a new resource](#how-to-add-a-new-resource)
- [Conventions and gotchas](#conventions-and-gotchas)
- [History: what was fixed in 2026](#history-what-was-fixed-in-2026)
- [Open items](#open-items)

## What this service is

Aye Bee See lets people send physical letters to incarcerated people from a phone or browser. The user writes a message; a partner non-profit chapter prints it and mails it; replies are transcribed back into the same thread. This repository is the API that the front end (expected at `http://localhost:3001` in development) talks to. It owns:

- **Users** (outside correspondents, chapter accounts, admins) and login.
- **Prisons**, each with its mail rules: links to a master list kept in the database, plus typed limits (see [Mail rules](#mail-rules)).
- **Prisoners** and which prison each is in.
- **Chats** (one user, one prisoner) and the **Messages** inside them.
- **Chapters** of the partner organization.

It is a single Node.js process using Express 5, Passport (local and JWT strategies), Sequelize 6, and SQLite. There is no queue, no cache, and no background job. The mailing side (printing, postage, tracking) is not represented in this codebase yet; the nearest thing is the `lettersSent` and `averageTimeDays` columns on Chapter.

## Quick start for developers

```bash
git clone https://github.com/Aye-Bee-See/sqlite-express-api.git
cd sqlite-express-api
npm ci
cp .env.example .env      # then edit JWT_SECRET at minimum
npm run dev
```

Notes:

- `npm ci` works and is preferred; the lockfile is in sync. `bcrypt` and `sqlite3` are native modules with prebuilt binaries for Intel and Apple Silicon Macs; their install scripts are pre-approved in `package.json` (see [Tooling](#tooling)).
- Verified on Node 24 and Node 26. `engines.node` is `>=18`. Node 26 specifically needs `jsonwebtoken` 9.0.3 or newer (already pinned) because it removed `SlowBuffer`.
- `npm ci` runs the `prepare` script, which installs the Husky pre-commit hook.
- The database is created and seeded on first boot and persists afterwards. `DB_RESET=true npm start` wipes it.
- To get an admin token, log in as the seeded `admin` / `abcpassword`, or set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ADMIN_EMAIL` in `.env`.

`npm test` runs the suite against an in-memory database in a couple of seconds and needs no `.env`. See [Tests](#tests). Schema changes are migrations; see [Migrations](#migrations).

## Architecture overview

Layers, top to bottom:

```text
index.js                          Calls createApp() and listens
app.js                            Express app, global middleware, /health, JSON 404 catch-all, mounts one Router per resource
  routes/<resource>/<resource>.js     Route class: binds paths to passport + authorization gates + controller methods
    routes/services/auth.services.js    Passport strategies (local login, JWT) and token creation
    routes/services/authz.services.js   Role, self, and ownership checks
    routes/controllers/<resource>.controller.js   Controller: reads req, calls model, formats response
      routes/controllers/route.controller.js         Base class: pagination, 201/200 success, status-aware errors, 404 helpers
    database/models/<resource>.model.js            Sequelize Model subclass with static CRUD helpers
      database/schemas/<resource>.schema.js          Column definitions and validators
      database/hooks/<resource>.hooks.js             Lifecycle hooks (password hashing, chat lookup)
  database/connection.js           The Sequelize instance (shared by the app and the migration CLI)
  database/migrate.js              Umzug migrator: runMigrations() at boot, CLI for npm run migrate*
  database/migrations/*.js         Schema history; the initial one reproduces the pre-migration sync() schema
  database/sql-database.js         Inits models, runs migrations, seeds, bootstraps an admin
  database/bootstrap-admin.js      ensureAdmin()
routes/constants.js                Every path string and every success/error message
routes/services/error.services.js  Final Express error handler
services/HttpError.js              HttpError (status-carrying) and NotFoundError
services/ValidationError.js        ValidationError, rendered like Sequelize validation failures
```

Two design choices shape everything else:

1. **All user-facing strings and paths live in one nested object** in `routes/constants.js`, keyed by resource, HTTP method, and operation. Controllers do not know their own messages; the base controller looks them up at response time by inspecting Express's route stack to find which handler is running. See [Controller layer](#controller-layer).
2. **Models are classes with static methods.** Nothing calls `new Prison()`. Controllers call `Prison.getPrisonByID(id, full)` and the model wraps Sequelize's `findOne` / `findAll` / `update` / `destroy`. Associations are declared in a static `associate(models)` method run once at boot.

### Request lifecycle

`GET /prison/prison?id=1` with a valid bearer token:

1. `app.js` middleware runs in order: the response headers (`Cache-Control: no-store`, `nosniff`, no framing), `cors` (origins from `CORS_ORIGIN`), `bodyParser.json` (100 KB; it skips `POST /auth/chapter-rotation`, whose route parses up to `ROTATION_MAX_BYTES` after authenticating the caller), `bodyParser.urlencoded`, `singleIds`, `passport.initialize`.
2. Express matches the `/prison` prefix and hands off to `PrisonRoutes.Router`.
3. The path `/prison` matches. The first handler is `passport.authenticate('UsrJStrat', { session: false, failWithError: true })`.
4. The JWT strategy in `auth.services.js` verifies the signature and expiry against `JWT_SECRET`, loads the user by the `id` claim, and rejects the request if the user is missing or banned. On success `req.user` is the User instance (without its password hash) and the next handler runs. On failure, `failWithError` sends an `AuthenticationError` to `next(err)`, which `ErrorService.handler` renders as a 401.
5. Reads have no role gate, so the next handler is `controller.getOne`, bound to the controller instance in its constructor. Write routes would first pass through `AuthzService.requireRole(...)` here.
6. The controller reads `id` and `full` from `req.query`, calls `Prison.getPrisonByID(id, fullBool)`, passes the result through `this.requireFound(prison, 'Prison ' + id)` (which throws `NotFoundError` on `null`), and then `this.#handleSuccess(res, prison)`.
7. `RouteController.handleSuccess` walks `res.req.route.stack`, finds the layer whose function name is `bound getOne`, maps `getOne` to the message key `one`, reads the HTTP method from the layer, and looks up `messages.prison.get.one.success.condition.par` in `routes/constants.js`. It sends `{ data, info, success: true, status: 200, name: 'prison one' }`. For `create` handlers the status is 201.
8. If anything throws, the controller's `catch` wraps non-Error values in an `Error` and calls `this.#handleErr(res, err)`, which does the same stack walk for the error message, picks the HTTP status with `HttpError.statusOf(err)` (404 for the `NotFoundError` above, 400 for validation and constraint errors, 500 otherwise), and sends `{ success: false, name, info, status, error }`.

Nothing in that path reads `req.params`; all identifiers travel in the query string or body.

## Repository map

```text
.
├── index.js                          Entry point. createApp() then listen.
├── app.js                            createApp(): middleware, /health, routers, JSON 404, error handler; also re-exports `ready`.
├── constants.js                      Loads .env; exports JWT secret, port, admin bootstrap values, CORS origins, DB flags.
├── package.json                      ESM, path aliases under "imports", scripts, allowScripts, engines.
├── package-lock.json                 In sync; npm ci works.
├── .github/workflows/test.yml        CI: npm ci, eslint, npm test on Node 22 and 24.
├── test/                             node --test suite; helpers.js boots the app on an in-memory database.
├── .env.example                      Every environment variable with a comment.
├── eslint.config.js                  ESLint 9 flat config: JS, JSON, Markdown, CSS, Prettier.
├── .prettierrc.json                  Tabs, single quotes, width 100, no trailing commas.
├── .husky/pre-commit                 Runs lint-staged (Husky 9 format).
├── README.md                         API consumer documentation.
├── docs/DEVELOPER.md                 This file.
├── ABC-3.postman_collection.json     Postman collection, current.
├── ABC-3.postman_collection_old.json Historical snapshot; does not match the API.
├── services/
│   ├── HttpError.js                  HttpError(status, message), NotFoundError, HttpError.statusOf(err).
│   ├── ValidationError.js            ValidationError(messages), ValidationError.messagesFrom(err).
│   ├── crypto.js                     libsodium: content keys, encrypt/decrypt, wrap/unwrap with ENCRYPTION_KEY, sealTo (e2e), assertConfigured.
│   ├── keygen.js                     `npm run keygen`: prints a fresh ENCRYPTION_KEY.
│   ├── files.js                      Attachment storage: ALLOWED_TYPES, sniffType(buffer), storeFile, storedPath, removeFile under UPLOAD_DIR.
│   ├── LoudError.js                  Error subclass that prints a colored banner; used by the controller interface check.
│   └── Utilities.js                  isUndefined, resolveSequential (used by seeds), objectToStringButSafe (unused).
├── routes/
│   ├── constants.js                  endpoints{} (paths) and messages{} (strings) for every resource.
│   ├── services/
│   │   ├── auth.services.js          LocalStrategy, JwtStrategy, JWT creation (jti, issued), tokenLive() revocation check; registers both strategies with passport.
│   │   ├── authz.services.js         requireRole, requireSelfOrAdmin, requireGroupMember, optionalAuthenticate, chapterOf, activeChapterOf, groupRefusal, mayManageUser, refusalFor, forbidden(), unauthorized().
│   │   ├── scope.services.js         threadScope(req) and resolveWriter(): who may see and write which chats and messages.
│   │   ├── error.services.js         ErrorService.handler, the final error middleware.
│   │   ├── upload.services.js        uploadSingle(field): multer (memory) with size and type limits, errors rendered as ValidationError.
│   │   ├── audit.services.js         audit(req, action, resource, targetId, details): append to AuditLog with req.user as actor.
│   │   └── ratelimit.services.js     limit() and the configured limiters for login, claim checks, and recovery; in-memory, 429 + Retry-After.
│   ├── controllers/
│   │   ├── route.controller.js       Base class: pagination, requireFound/requireAffected, handleSuccess, handleErr.
│   │   ├── user.controller.js        Plus login, registration role policy, password/note stripping, managed writers, claim tokens (with key material in e2e mode).
│   │   ├── invite-code.controller.js Invite codes: issue/list/cancel batches for a chapter; public check and join (POST /auth/join makes a sponsored account).
│   │   ├── keys.controller.js        e2e key material: own bundle, public keys, recovery challenge, group keys, member keys.
│   │   ├── prison.controller.js      Plus the master list of mail rules (read; admin create/update/delete), addRelay, removeRelay.
│   │   ├── prisoner.controller.js
│   │   ├── chat.controller.js        Scope checks via threadScope().
│   │   ├── message.controller.js     Scope checks via threadScope().
│   │   ├── chapter.controller.js
│   │   ├── moderation.controller.js  create/getMany/getOne/update/remove (proposals), approve/reject, audit, summary.
│   │   ├── invitation.controller.js  Invitations: create, list, renew, withdraw; public token check and accept.
│   │   └── notification.controller.js  Devices and the notification feed, under /auth.
│   ├── user/user.js                  Route classes. All seven follow the same template.
│   ├── prison/prison.js
│   ├── prisoner/prisoner.js
│   ├── chat/chat.js
│   ├── message/message.js
│   ├── chapter/chapter.js
│   ├── moderation/moderation.js   Proposals, review, audit log, summary.
│   ├── invitation/invitation.js   Invitations; the token check and accept are public and rate limited.
│   ├── notification/notification.js  Device registration and the feed (third router mounted at /auth).
│   └── keys/keys.js               Key routes, mounted under /auth beside the user routes.
└── database/
    ├── connection.js                 The Sequelize instance; no models, so the CLI can import it alone.
    ├── migrate.js                    createMigrator(), runMigrations() (reset + adoption logic), CLI entry point.
    ├── migration-helpers.js          withForeignKeysOff(): guards SQLite table rebuilds against cascading deletes. Separate from migrate.js to avoid a circular import.
    ├── letter-status.js              Letter lifecycle statuses and transitions.
    ├── rewrap-e2e.js                 `npm run encryption:rewrap`: seal server-held content keys to readers before switching to e2e.
    ├── backup.js                     runBackup(), verifyBackup(), restoreBackup(), backupStatus(), scheduleBackups().
    ├── backup-cli.js                 `npm run backup[:status|:keygen|:info|:verify|:restore|:decrypt]`; opens the database alone (no migrations, no server).
    ├── erase-account.js              eraseAccount(), eraseRefusal(): delete a person and everything they wrote or received.
    ├── retention.js                  runRetention(), purgeIfUnpinned(), windowFor(): purge mailed letters and replies past the writer's window.
    ├── retention-cli.js              `npm run retention [-- --dry-run]`: awaits `ready`, then runs the purge (separate file: sql-database.js imports retention.js).
    ├── rekey.js                      rekeyServerEnvelopes(): move every server envelope from ENCRYPTION_KEY_PREVIOUS to ENCRYPTION_KEY; rekey-cli.js is `npm run encryption:rekey`.
    ├── migrations/                   <timestamp>.<name>.js files exporting up/down; applied ones recorded in SequelizeMeta.
    ├── sql-database.js               Init + associate models; runMigrations; seed; ensureAdmin; exports `ready`.
    ├── bootstrap-admin.js            ensureAdmin(): creates the ADMIN_* account when it does not exist.
    ├── models/
    │   ├── all.model.js              Re-exports every model; has a comment explaining Sequelize associations.
    │   ├── models.service.js         modelInstanceExists(modelName, pk): instance or NotFoundError.
    │   ├── user.model.js             defaultScope hides the password; getUserWithPassword for login; managed-writer helpers.
    │   ├── claim-token.model.js      ClaimToken: issue/revoke/lookup one-time claim tokens (hashes only).
    │   ├── invite-code.model.js      InviteCode: batches of single-use join codes per chapter, quota under a serial queue, counts only (hashes only, no link to the account).
    │   ├── prison.model.js           addRelay, removeRelay, the no_photos / photoLimit check.
    │   ├── prisoner.model.js
    │   ├── chat.model.js             Readers accept an extra where-clause for ownership filtering.
    │   ├── message.model.js          Same; updateMessage re-resolves the chat; createLetter, resolveRelayChapter, changeStatus, readLetter.
    │   ├── message-status.model.js   MessageStatus: one row per status change.
    │   ├── attachment.model.js       Attachment: attach (encrypt + store + row), readBytes (decrypt), withFile, listForMessage, remove, purgeForMessages.
    │   ├── letter-key.model.js       LetterKey: content-key envelopes; server mode (issueServerKey, contentKeysFor, encryptFields, decryptRows) and e2e (validateEnvelopes, issueEnvelopes, envelopeMap, envelopesFor, canRead).
    │   ├── org-member-key.model.js   OrgMemberKey: the group private key sealed per member.
    │   ├── revoked-token.model.js    RevokedToken: logged-out token ids until they expire; revoke, isRevoked, sweep.
    │   ├── session-run.model.js      SessionRun: when this database issued tokens; recordIssue, covers, sweep.
    │   ├── invitation.model.js       Invitation: issue, renew, revoke, lookup, consume / release / complete.
    │   ├── mail-rule.model.js        MailRule: the master list; resolve tags, lookalike check, retire, usage.
    │   ├── device.model.js           Device: push tokens per signed-in device; register (moves with the phone), reachable, forget*.
    │   ├── notification.model.js     Notification: the per-account feed; record, feed, markRead, sweep.
    │   ├── idempotency-key.model.js  IdempotencyKey: claim (unique index decides a race), complete, release, sweep.
    │   ├── chapter.model.js
    │   ├── submission.model.js       Submission: RESOURCES registry (fields, submittable, create/update), propose, revise, approve, reject, withdraw, currentValues, pendingCounts.
    │   └── audit-log.model.js        AuditLog: record, list (newest first). Append-only, no updatedAt.
    ├── schemas/
    │   ├── all.schema.js             Schemas class with one static per model.
    │   └── <model>.schema.js         Plain objects of Sequelize column definitions.
    ├── hooks/
    │   ├── all.hooks.js              Hooks class; only user and message have hooks.
    │   ├── user.hooks.js             beforeCreate and beforeUpdate: bcrypt-hash the password.
    │   ├── message.hooks.js          beforeValidate: default status, chat lookup; beforeCreate/afterCreate: encrypt + server envelope; afterFind: decrypt.
    │   └── chat.hooks.js             afterFind: decrypt embedded messages (includes skip the included model's hooks).
    └── seeds/
        ├── all.seeds.js              Runs the seed functions in dependency order and prints a one-line summary.
        ├── <model>.seed.js           Reads <model>Seed.json and bulk-creates if the table is empty.
        └── <model>Seed.json          Seed rows.
```

## Module path aliases

`package.json` defines Node subpath imports so files can import each other without relative paths. All start with `#`:

| Alias              | Resolves to              | Example                                                    |
| ------------------ | ------------------------ | ---------------------------------------------------------- |
| `#constants`       | `./constants.js`         | `import { secretOrKey, sysPort } from '#constants'`        |
| `#/*`              | `./*`                    |                                                            |
| `#db/*`            | `./database/*`           | `import { User } from '#db/sql-database.js'`               |
| `#models/*`        | `./database/models/*`    | `import Prison from '#models/prison.model.js'`             |
| `#schemas/*`       | `./database/schemas/*`   |                                                            |
| `#hooks/*`         | `./database/hooks/*`     |                                                            |
| `#seeds/*`         | `./database/seeds/*`     |                                                            |
| `#routes/*`        | `./routes/*`             | `import { prisonEnd } from '#routes/constants.js'`         |
| `#rtControllers/*` | `./routes/controllers/*` |                                                            |
| `#rtServices/*`    | `./routes/services/*`    | `import AuthzService from '#rtServices/authz.services.js'` |
| `#services/*`      | `./services/*`           | `import { NotFoundError } from '#services/HttpError.js'`   |

Each alias lists several extension fallbacks. Include the `.js` extension in imports anyway; it keeps resolution unambiguous. IDEs may need to be told about `package.json` `imports` to follow them.

## Configuration

`constants.js` calls `dotenv/config` and exports:

| Export                 | Env var                  | Default                        | Used by                                                                                           |
| ---------------------- | ------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `secretOrKey`          | `JWT_SECRET`             | none                           | `auth.services.js` to sign and verify tokens. Login fails without it.                             |
| `sysPort`              | `PORT`                   | none                           | `index.js` `app.listen`. Unset means a random free port.                                          |
| `adminUsername`        | `ADMIN_USERNAME`         | none                           | `bootstrap-admin.js`                                                                              |
| `adminPassword`        | `ADMIN_PASSWORD`         | none                           | `bootstrap-admin.js`                                                                              |
| `adminEmail`           | `ADMIN_EMAIL`            | none                           | `bootstrap-admin.js`                                                                              |
| `corsOrigins`          | `CORS_ORIGIN`            | `http://localhost:3001`        | `index.js`; comma-separated, trimmed, empties dropped.                                            |
| `dbReset`              | `DB_RESET`               | `false`                        | `sql-database.js`: drop all tables and replay every migration.                                    |
| `dbSeed`               | `DB_SEED`                | `true`                         | `sql-database.js`: whether to run `createSeeds()`.                                                |
| `dbLogging`            | `DB_LOGGING`             | `false`                        | `sql-database.js`: Sequelize `logging`.                                                           |
| `dbStorage`            | `DB_STORAGE`             | `database.sqlite`              | `sql-database.js`: SQLite file, or `:memory:`.                                                    |
| `quietBoot`            | `NODE_ENV=test`          | `false`                        | Suppresses boot-time console output under the test runner.                                        |
| `uploadDir`            | `UPLOAD_DIR`             | `uploads`                      | `services/files.js`: where attachment files are written.                                          |
| `uploadMaxBytes`       | `UPLOAD_MAX_BYTES`       | `10485760`                     | `upload.services.js`: multer file size limit.                                                     |
| `retentionDefaultDays` | `RETENTION_DEFAULT_DAYS` | `90`                           | `database/retention.js`: window when the writer chose none; 0 = forever.                          |
| `retentionMaxDays`     | `RETENTION_MAX_DAYS`     | none                           | Cap on any writer's choice, including forever.                                                    |
| `encryptionMode`       | `ENCRYPTION_MODE`        | `server`                       | `services/crypto.js`: `server` (API holds the key) or `e2e` (browsers hold the keys).             |
| `encryptionKey`        | `ENCRYPTION_KEY`         | none (required in server mode) | `services/crypto.js`: base64 32-byte key that wraps content keys; the rewrap script needs it too. |

The three `db*` values go through `envBool` (`constants.js:22`), which accepts `true/false`, `1/0`, `yes/no`, `on/off` in any case and otherwise returns the default. `NODE_ENV=development` is read directly by the two error renderers to decide whether 500 responses include the underlying message and stack.

Hardcoded: the SQLite file path `database.sqlite` relative to the process working directory (start from the repo root); the one-week token lifetime in `auth.services.js`; the default page size (10) and maximum (100) in `route.controller.js`.

## Boot sequence

The database is set up as a side effect of importing `database/sql-database.js`, which happens through the import graph:

1. `index.js` imports `app.js`, which imports `#rtServices/auth.services.js` (for its side effect of registering the passport strategies) and the seven route modules.
2. `auth.services.js` imports `{ User } from '#db/sql-database.js'`.
3. Evaluating `sql-database.js`:
   - creates the Sequelize instance (`logging` from `DB_LOGGING`);
   - calls `Model.init(sequelize, Sequelize)` for all seven models (each reads its schema and hooks);
   - calls `associate(Models)` on all seven;
   - starts the async chain exported as `ready`: `runMigrations()` (dropping everything first when `DB_RESET` is set), then `createSeeds()` unless `DB_SEED=false`, then `ensureAdmin()`, then logs `Database ready.` A failure anywhere is logged as `Database setup failed:`.
4. `createApp()` mounts `/health`, the routers, the JSON 404 catch-all, and `ErrorService.handler`; `index.js` then calls `app.listen(PORT)` and logs `Ready to serve requests.` when `ready` resolves. `ready` **rejects** when setup fails: `index.js` then closes the server and exits with code 1 (`/health` stayed `503`), and a script that awaits `ready` stops instead of working on nothing. `SIGTERM` and `SIGINT` close the server, wait up to `SHUTDOWN_GRACE_MS` for open requests, and exit 0.

Requests are accepted before `ready` resolves. `GET /health` returns 503 until then and 200 afterwards, so deployment tooling and the test helper can wait on it.

Without `DB_RESET`, pending migrations are applied to whatever is already there, so an existing database is upgraded in place. `sequelize.sync()` is no longer used anywhere.

### Migrations

The schema is owned by the files in `database/migrations/`, run by [Umzug](https://github.com/sequelize/umzug) with `SequelizeStorage` (applied names live in the `SequelizeMeta` table). The models describe the same columns for the ORM, and `test/migrations.test.js` fails if the two disagree on column names, nullability, or primary keys.

| Command                                             | Effect                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| `npm run migrate`                                   | Apply pending migrations to the database named by `.env`                    |
| `npm run migrate:down`                              | Revert the most recent one                                                  |
| `npm run migrate:status`                            | List pending, then applied                                                  |
| `npm run migrate:create -- --name add-something.js` | Create `database/migrations/<timestamp>.add-something.js` from the template |

Rules:

- Every migration exports `async up({ context: queryInterface })` and `async down(...)`, and `down` must genuinely revert `up`; the test suite reverts and re-applies the whole history.
- Never edit an applied migration; add a new one. The initial migration is frozen: it reproduces exactly what `sequelize.sync()` used to create, which is what lets `runMigrations()` adopt a pre-migration database by recording that migration as applied (it checks for tables and an empty `SequelizeMeta`).
- Change the model and its schema file in the same commit as the migration, and run `npm test` to prove they match.
- SQLite cannot alter most column properties in place. Umzug's `queryInterface.changeColumn` works for simple cases; for anything else, create a new table, copy, drop, rename, inside the migration.
- `removeColumn` and `changeColumn` on SQLite rebuild the table by copying, dropping, and renaming. With foreign keys on, the drop fires `ON DELETE CASCADE` on every table that references the one being rebuilt and silently empties them (the encryption migration lost every `LetterKeys` and `Attachments` row this way before the guard existed). Wrap such calls in `withForeignKeysOff(queryInterface, fn)` from `database/migration-helpers.js`.
- A migration must not import `database/migrate.js`: that module runs the CLI with a top-level `await`, so the circular import deadlocks and Node exits with "unsettled top-level await". Shared helpers live in `migration-helpers.js`.
- `DB_RESET=true` is the escape hatch in development; it drops everything and replays the history.

**Never a bare `queryInterface.removeColumn` or `changeColumn`.** On SQLite Sequelize rebuilds the table from `describeTable()`, which knows nothing of `ON DELETE` / `ON UPDATE` rules, `AUTOINCREMENT`, or indexes, and all three are gone afterwards; with foreign keys on, dropping the old table also cascades through every table that points at it. That happened to `Messages` and `Prisons`: deleting a relay group failed on the foreign key instead of setting `relayChapter` to `NULL`, and the id of a deleted newest letter was given to the next one (which an `Idempotency-Key`, a notification, or an audit entry would then point at). Two ways to drop a column safely, both in `database/migration-helpers.js`: `dropColumn()` (SQLite's own `ALTER TABLE ... DROP COLUMN`, which rebuilds nothing, and which SQLite refuses for a column that is a foreign key, indexed, or unique), or the Sequelize call inside `withForeignKeysOff()`, which notes every table's rules, `AUTOINCREMENT`, id counter, and indexes before the change and puts back what the rebuild cost. Every `up` and `down` that removes a column is wrapped, so rolling back does not strip the tables again. `2026.09.20T01.00.00.repair-rebuilt-tables.js` mends the databases that were damaged before the helper did this, and starts each id counter above every id still written down somewhere (audit log, idempotency keys, notifications), so an id is not reused even if its rows were purged long ago. The migrations test fails if any table has a `REFERENCES` without an `ON DELETE` or an `id` without `AUTOINCREMENT`, after migrating and after rolling back.

### Admin bootstrap

`ensureAdmin()` (`database/bootstrap-admin.js:24`) runs after seeding:

- If `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ADMIN_EMAIL` are all set and no user with that username exists, it creates the account with the admin role and logs `Created admin account "..." (id N).`
- If the username exists it is left untouched, even when it is not an admin (logged as a warning), so a stray env value can never escalate an account.
- If the variables are not set and the database has no admin at all, it prints a loud banner and the server keeps running.

## Routing layer

### Path definitions

Every path is defined once in the `endpoints` object in `routes/constants.js`, keyed `resource.method.operation`:

```js
prison: {
	get: { many: '/prisons', one: '/prison' },
	post: { create: '/prison' },
	put: { update: '/prison', addRelay: '/relay' },
	delete: { remove: '/prison' }
}
```

Identifiers and filters never travel in the path. GET handlers read `req.query`; PUT and DELETE handlers read `req.body`. A URL like `/prison/prison/1` matches nothing and gets the JSON 404.

The `messages` object in the same file mirrors this structure with `success.condition.par` and `error.condition.par` strings (plus a few extra conditions such as `param` / `empty` for chat lookups and `id` / `mail` / `name` / `empty` for user lookups). The operation keys under `messages` must equal the controller method names, because that is how the base controller finds them. This is why the rule-attachment key is `addRule`, not `rule`.

### Route classes

All seven route files follow one template. `routes/prison/prison.js`:

```js
class PrisonRoutes {
	static Router;
	static #Controller;

	static {
		this.#Controller = new prisonCrtlr();
		this.Router = express.Router();
		this.#router();
	}

	static #router() {
		this.Router.post(
			prisonEnd.post.create,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			AuthzService.requireRole(AuthzService.ADMIN, AuthzService.CHAPTER),
			this.#Controller.create
		);
		// get many, get one (authenticate only), put update, put addRelay, delete remove (authenticate + role gate)
	}
}
export default PrisonRoutes;
```

- The class is never instantiated. The static initialization block runs at import time and fills the static `Router`, which `index.js` mounts.
- Every route except `POST /auth/user` and `POST /auth/login` starts with `passport.authenticate('UsrJStrat', { session: false, failWithError: true })`. `failWithError` routes auth failures into the JSON error handler.
- Write routes on prisons, prisoners, and chapters add `AuthzService.requireRole(ADMIN, CHAPTER)`. User routes use `requireRole(ADMIN)` for the list and `requireSelfOrAdmin` for get, update, and delete. Registration uses `optionalAuthenticate` so an admin token can unlock other roles while anonymous callers still get through. Chat and message routes have no route-level gate; ownership is enforced inside their controllers.
- The controller method passed as the final handler must be a bound function whose `name` is `bound <method>`; see the next section.
- Strategies are registered once at the bottom of `auth.services.js`, not per route file.

### Mounts

From `index.js`:

| Prefix       | Router           |
| ------------ | ---------------- |
| `/auth`      | `UserRoutes`     |
| `/prison`    | `PrisonRoutes`   |
| `/prisoner`  | `PrisonerRoutes` |
| `/messaging` | `MessageRoutes`  |
| `/chat`      | `ChatRoutes`     |
| `/chapter`   | `ChapterRoutes`  |

After the routers, `app.js` adds a catch-all that calls `next(new NotFoundError('Cannot ' + req.method + ' ' + req.path))`, then `ErrorService.handler`.

## Controller layer

### RouteController base class

`routes/controllers/route.controller.js`. Every controller extends it and calls `super('<resource>')` with the key used in `routes/constants.js`.

**Interface check.** The constructor verifies the subclass has `getOne`, `getMany`, `update`, `remove`, and `create` and throws a `LoudError` at boot otherwise.

**`handleLimits(page, page_size)`** (`:49`) turns the two query parameters into `{ limit, offset }`. Blank values default to page 1 and `DEFAULT_PAGE_SIZE` (10). Anything that is not a positive integer, or a `page_size` above `MAX_PAGE_SIZE` (100), throws a `ValidationError` listing each problem. Controllers call it before their `try` block; the thrown error propagates to `ErrorService.handler`, which renders it in the same validation shape.

**`requireFound(record, what)`** (`:118`) throws `NotFoundError(what + ' not found')` when `record` is null or undefined, otherwise returns it. **`requireAffected(count, what)`** (`:132`) does the same for an update or delete row count (Sequelize's update returns `[count]`). Every `getOne`, `update`, and `remove` uses them, which is where the 404s come from.

**`handleSuccess(res, outObj, condition = 'par')`** (`:89`) and **`handleErr(res, errMsg, msgType = 'par')`** (`:144`) both call the private `#findStack(res)` (`:78`):

```js
#findStack(res) {
	let stack;
	res.req.route.stack.forEach((layer) => {
		const fname = layer.name.substr(6); // strip "bound "
		if (Object.hasOwn(this, fname)) {
			stack = layer;
		}
	});
	return stack;
}
```

It walks the Express route's handler layers, strips the six-character `bound ` prefix from each function name, and picks the layer whose stripped name is an own property of the controller instance. This works because each controller constructor does `this.create = this.create.bind(this)` for every handler, which both fixes `this` and makes the bound function an own property named `bound create`. Middleware layers (`authenticate`, `roleGate`, `requireSelfOrAdmin`, `optionalAuthenticate`) are skipped because their stripped names are not own properties.

From the chosen layer the base class derives `callerName` (`getOne`, `getMany`, `create`, `update`, `remove`, `login`, `addRelay`), maps `getOne` / `getMany` to `one` / `many`, reads the HTTP method, and looks up `messages[controllerName][method][msgRef]`. Three things must therefore line up: the controller name passed to `super()`, the method names on the class (all bound), and the key structure in `routes/constants.js`.

`handleSuccess` sends status 201 when `msgRef === 'create'`, 200 otherwise. `handleErr`:

1. If `ValidationError.messagesFrom(err)` returns messages (our `ValidationError` or Sequelize's), respond `400 { success: false, errors }`.
2. Otherwise `status = HttpError.statusOf(err)`: an explicit `status` or `statusCode` wins; `SequelizeUniqueConstraintError` and `SequelizeForeignKeyConstraintError` are 400; everything else is 500.
3. Look up `info` for the endpoint and condition (falling back to `par`), and send `{ success: false, name, info, status }` plus `error: err.message` for 4xx. For 5xx the error is logged with `console.error`, and `error` and `stack` are included only when `NODE_ENV=development`.

### Per-resource controllers

Each method destructures `req.query` or `req.body`, calls one static model method inside `try`, and delegates to `#handleSuccess` / `#handleErr`. The private fields `#handleSuccess` and `#handleErr` are aliases for the inherited methods. Things that differ:

- **User** (`user.controller.js`): `create` (`:149`) accepts `next`, lower-cases `role` (default `user`), and returns `AuthzService.forbidden(...)` through `next` when a non-admin asks for anything else. `update` refuses `role` from non-admins the same way and never echoes `password`. `#stripPassword` (`:38`) converts an instance with `toJSON` and deletes `password`; it is applied to list, single, create, and login responses as belt-and-braces on top of the model's default scope. `getMany` with `role` validates it against the schema's list and returns `200 []` for no matches. `login` reads `req.authInfo.token` set by the local strategy.
- **Prison**: `addRelay` / `removeRelay` are bound and call the model, which returns the prison with prisoners and relay groups embedded. `mailRules` serves the static vocabulary.
- **Prisoner**: `getMany` branches on a `prison` query parameter.
- **Chat** (`chat.controller.js`): `#loadOwned(req, id)` (`:41`) loads a chat and throws a 403 when the caller is a restricted `user` who does not own it. `getMany` filters restricted callers to their own id (a `prisoner` parameter narrows within that). `getOne` accepts `id` or `user` + `prisoner` (defaulting `user` to the caller for restricted callers), throws `HttpError(400, ...)` for incomplete parameters, and uses the constants' `param` / `empty` conditions for `info`. `create` forces `user` to the caller for restricted callers; `update` refuses to reassign a chat to another user; `remove` checks ownership. 403s are passed to `next(err)` so they render through `ErrorService`.
- **Message** (`message.controller.js`): `#ownerFilter(req)` (`:38`) returns `{ user: req.user.id }` for restricted callers, which every list call merges into its where-clause last, so no query parameter can widen it. `#loadOwned` mirrors the chat version. `create` forces `user` to the caller and `sender` to `user` for restricted callers; `update` pins `user` to the caller.
- **Chapter**: the simplest; no pagination, no `full`.

## Response and error contract

The README documents the shapes from the client's point of view. Where they come from:

| Shape                                            | Produced by                                        | Status               |
| ------------------------------------------------ | -------------------------------------------------- | -------------------- |
| `{ data, info, success: true, status, name }`    | `RouteController.handleSuccess`                    | 201 create, else 200 |
| `{ success: false, errors: [...] }`              | `handleErr` or `ErrorService.handler`, validation  | 400                  |
| `{ success: false, name, info, status, error? }` | `handleErr` (controller errors)                    | `HttpError.statusOf` |
| `{ success: false, name, info, status }`         | `ErrorService.handler` (anything passed to `next`) | `HttpError.statusOf` |

`ErrorService.handler` (`routes/services/error.services.js:24`) is the last middleware. It delegates when headers were already sent, renders validation errors in the shared shape, otherwise picks the status with `HttpError.statusOf`, uses `err.message` (or the HTTP-status default from `routes/constants.js`) as `info`, logs 5xx, and hides 5xx details unless `NODE_ENV=development`. Passport's failures arrive here with `status` already set (401 for bad or missing tokens and wrong credentials, 400 for missing login fields).

`HttpError` and `NotFoundError` live in `services/HttpError.js`; throw them from controllers or models for client-caused failures. Anything thrown without a status is treated as a 500, which is the right default for programmer errors.

## Authentication internals

`routes/services/auth.services.js` defines a class with static members only and registers both strategies with passport at module scope.

### Login (`LocalStrategy`)

`authService.login` is a `passport-local` strategy with `usernameField: 'username'`. Its verify function:

1. `User.getUserWithPassword({ username })`, the one query in the codebase that selects the password hash (see [User scopes](#user-scopes)).
2. Refuses users whose role is `banned`, and unclaimed managed writers.
3. `bcrypt.compare(password, user.password)`.
4. On match, builds a token with `#createJWT(user)` and calls `done(null, user, { token })`. The third argument becomes `req.authInfo`, which the route enables with `authInfo: true` and the controller reads.
5. Otherwise `done(null, false)`, which with `failWithError` becomes a 401.

**Auth schemes** (`services/auth-scheme.js`). The verify function does not care which scheme an account uses: for a `split` account what arrives as `password` is the auth key, and bcrypt compares it like any other. Everything scheme-specific happens where a password is _set_: the controllers call `schemeFrom(body)` (absent means `plain`; `REQUIRE_SPLIT_AUTH` makes `plain` a 400), `checkPassword(scheme, password)` (a split password must be 44 characters of base64 decoding to 32 bytes, and no other rule), `requireKeysForSplit(scheme, fields)` (the auth key is derived from the same `kdfSalt`/`kdfParams` as the wrap key, so they must travel together), and on changes `refuseDowngrade(stored, requested)`. `GET /auth/login-params` (`UserController.loginParams`, `limiters.loginParams`) hands out the salt: the account's own for a split account, `fakeSalt(username)` (an HMAC of the normalised name under `JWT_SECRET`) otherwise, so existence is not revealed. The server derives nothing; the test client's `splitKeys` shows the client's side, and `test/auth-split.test.js` pins the two `crypto_kdf` derivations to the vectors in the proposal.

Missing `username` or `password` never reaches the verify function; passport-local fails with a 400 that renders as `{ name: 'AuthenticationError', info: 'Bad Request', status: 400 }`.

### Rate limits

`routes/services/ratelimit.services.js` is a small fixed-window limiter kept in a `Map` (swept every minute; when full, the oldest bucket makes room, never the whole table, or a flood of made-up usernames would wipe the counts that protect real ones). `limit({ name, what, windowMs, perIp, perSubject, subject, failuresOnly })` builds a middleware; `limiters` holds the four in use: `login` (failures per username: counted when the request arrives and given back unless the answer is a 4xx, so parallel guesses cannot all slip under the limit; all attempts per address; `bodyCredentialsOnly` runs first, because passport-local would also read credentials from the URL), `claimCheck`, `recoverStart`, and `recoverFinish`. Every number comes from `rateLimits` in `constants.js` (`RATE_LIMIT_*`), and `RATE_LIMIT_ENABLED=false` disables it, which the test helper does; `test/ratelimit.test.js` opts back in with small values. A refusal is `next(new HttpError(429, ..., 'RateLimitError'))` after setting `Retry-After`. `app.set('trust proxy', trustProxy)` makes `req.ip` meaningful behind a proxy. One process only: a second API instance would need a shared store.

### Token creation

Each token's payload carries `id`, `jti` (16 random bytes, hex), `issued` (milliseconds; finer than the standard `iat`), and the legacy `expiry`; `jwt.sign` adds `iat` and `exp` (one week). `authService.issueToken(user)` makes one outside the login flow (after a self password change), and `authService.tokenPayload(req)` decodes the bearer token of a request that already passed the strategy.

`#createJWT` in `auth.services.js` signs that payload with `expiresIn: '1w'` (HS256). The custom `expiry` claim in milliseconds duplicates the standard `exp`; only `exp` is checked for expiry. The login response returns `{ token, expires }` (plus `keys` in e2e mode).

### Token verification (`JwtStrategy`)

After the signature and expiry, `authService.tokenLive(payload, user)` refuses a token whose `jti` is in `RevokedTokens` (single logout) or whose `issued` is earlier than `User.sessionsRevokedAt` (logout everywhere, admin `POST /auth/revoke`, any password change, recovery finish; set by `User.revokeSessions`). A pre-feature token with neither `issued` nor `iat` counts as older than any revocation. `RevokedToken.sweep()` drops ids whose token has expired; it runs at boot, on every logout, and every hour. This is the "denylist with a TTL" that Redis would provide, kept in SQLite because the table never holds more than a week of logouts.

`tokenLive` also asks `SessionRun.covers(issued)`: a token is honoured only if its `issued` time falls inside a run this database remembers. A `SessionRuns` row is `{ startedAt, lastIssuedAt }` in milliseconds. `authService.#createJWT` (now `async`, as is `issueToken`) awaits `SessionRun.recordIssue(issued)` before handing the token out: the first token a process issues creates its run, later ones push `lastIssuedAt` forward. Recording is queued so simultaneous first logins make one run, and the check reads memory first and falls back to the table before refusing, so it costs no query for a good token and stays right if another process issued it. This is what ties a token to a database rather than only to `JWT_SECRET`: after a reset or on a new database there is no run at all; after a restore, tokens issued since the backup fall after the last run the backup knows and before the first token of the new run. Without it such a token is accepted for whichever account now holds its user id (seen on Android after `DB_RESET`). A run starts at the first token, not at boot, so the retention and rewrap scripts, which await the same `ready`, leave no trace. The migration gives a database that already has accounts one run covering everything up to then, so an upgrade signs nobody out; a new or reset database has no accounts when migrations run and gets none. Runs older than the token lifetime are swept at boot and hourly with `RevokedTokens`. `SessionRun.forget()` drops the in-memory state, which is how the tests restart.

`authService.authorize` is the strategy. `passport-jwt` verifies the signature and expiry first. The callback is `async`: it rejects a payload without an `id` claim, awaits `User.getUser({ id })`, rejects a missing or banned user, then applies `tokenLive`. On success `req.user` is the User instance loaded through the default scope, so it never carries the password hash or key material. Lookup errors are passed to passport as errors rather than escaping.

Consequences: a deleted user's tokens stop working immediately; banning a user revokes their existing tokens; a logged-out token, or any token issued before a revocation, password change, or recovery, is refused; a compromised token that nobody notices is valid until it expires (one week), since there is no refresh to shorten that window. `sessionsRevokedAt` cannot be written through `PUT /auth/user`; only `User.revokeSessions` sets it. Expired denylist rows are swept at boot, on every logout, and hourly by an unref'd timer in `sql-database.js`.

## Authorization internals

`routes/services/authz.services.js` is a class of static helpers used by route files and controllers:

| Member                     | Line   | What it does                                                                                                                                                                                                   |
| -------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN`, `CHAPTER`, `USER` |        | Role name constants.                                                                                                                                                                                           |
| `forbidden(message)`       |        | Builds an `Error` with `name: 'AuthorizationError'`, `status: 403`.                                                                                                                                            |
| `unauthorized(message)`    |        | Same with `AuthenticationError` / 401.                                                                                                                                                                         |
| `hasRole(req, ...roles)`   |        | Does `req.user.role` match one of the roles?                                                                                                                                                                   |
| `isAdmin(req)`             |        | Shorthand.                                                                                                                                                                                                     |
| `ownOnly(req)`             |        | True for the plain `user` role. Chats and messages no longer use it; see `scope.services.js` below.                                                                                                            |
| `ownsRecord(req, record)`  |        | Compares `record.user` to `req.user.id` as strings.                                                                                                                                                            |
| `chapterOf(req)`           |        | The `chapterId` of a `chapter`-role caller, or `null` (no status check; used for ownership tests such as `managerNote` visibility).                                                                            |
| `activeChapterOf(req)`     |        | Async: the same id only when that group's `accountStatus` is `active`; the scope service, letter relay defaults, status changes, and `requireRole` use it.                                                     |
| `groupRefusal(req)`        |        | Async: the 403 to raise for a chapter caller with no group, a pending group, or a suspended group.                                                                                                             |
| `requireGroupMember`       |        | Middleware (async): admins pass; `chapter` callers must belong to an `active` group, otherwise `groupRefusal(req)` says whether the account has no group, a pending group, or a suspended group.               |
| `mayManageUser(req, user)` |        | Async: admin, self, or the active chapter that manages this still-unclaimed writer. `refusalFor(req)` gives the matching 403.                                                                                  |
| `targetsSelf(req)`         |        | Does the request's `id` / `email` / `username` (query for GET, body otherwise, same precedence as the user controller) match the caller?                                                                       |
| `requireRole(...roles)`    |        | Middleware (async): 403 unless the caller holds one of the roles; a `chapter` caller must also belong to an `active` group (`activeChapterOf`), otherwise `groupRefusal(req)` explains which condition failed. |
| `requireSelfOrAdmin`       |        | Middleware: allow admins, any caller whose own record is the target, and any group member (the controller then re-checks with `mayManageUser` once the record is loaded).                                      |
| `optionalAuthenticate`     | `:142` | Middleware: if an `Authorization` header is present, verify it with the JWT strategy and set `req.user`; a bad token is a 401, not anonymous.                                                                  |
| `isStaff(req)`             |        | Admin or chapter.                                                                                                                                                                                              |
| `publishedOnly(req)`       |        | True for anonymous callers and the `user` role: directory reads are limited to published records.                                                                                                              |

The policy, as implemented:

- Registration is public and always yields `role: user`; other roles need an admin token.
- Banned users are refused at login and at token verification, so `hasRole` never sees them.
- User management is admin-only, except that anyone may read, update, or delete their own record and non-admins may not change `role`, `chapterId`, or the custody columns. A group's `chapter` account may read, edit (`name`, `email`, `managerNote` only), and delete the group's unclaimed managed writers.
- Reads of prisons, prisoners, and chapters need no token (`optionalAuthenticate`). Anonymous callers and the `user` role see published records only; staff see everything and may filter by `recordStatus`. `AuthzService.publishedOnly(req)` decides, and `readOptions(req, config)` in `routes/controllers/directory.helpers.js` turns it, plus `q`, `sort`, `recordStatus`, and per-resource exact-match filters, into `{ publishedOnly, where, order }` for the model readers. Each directory controller declares its `READ_CONFIG` (search fields, sort orders, allowed filters) at the top of the file; add to that object to expose a new filter. Writes need `admin` or `chapter`.
- Chats and messages follow `threadScope(req)` in `routes/services/scope.services.js`: `{ kind: 'all' | 'managed' | 'own', where, messageWhere, allowsUser(id), allows(chat) (async), allowsMessage(message) }`. Admins get everything; a `chapter` caller gets `user IN (ids of writers its group manages)` **or** `relayChapter = its group` (for chats: chats holding such a message, via a literal subquery); a `user` gets their own id. Controllers spread `scope.where` / `scope.messageWhere` **last** into list queries, call `allows` / `allowsMessage` before single-record reads, updates, and deletes, and use `resolveWriter(req, scope, body.user, { sender, prisoner })` on create (user role: self; chapter: a managed writer, the group's anonymous writer when omitted, or an independent writer only for a `prisoner` reply on a thread the group relays; admin: as given). Enforced in the controllers because it depends on the record, not just the route.
- Attachments (`Attachment` model, `MessageController.createAttachment` / `attachments` / `getAttachment` / `removeAttachment`): scoped exactly like the message they belong to via `allowsMessage`; adding or removing requires the letter to be `isOpen` unless the caller is an admin. Uploads go through `uploadSingle('file')`, are sniffed with `sniffType`, and must match the declared MIME type. `Message.deleteMessage` and `Chat.deleteChat` call `Attachment.purgeForMessages` first because the database cascade cannot unlink files.
- Letter lifecycle (`database/letter-status.js`, `Message.createLetter` / `changeStatus`, `MessageController.updateStatus`): every message has `status`; letters start `queued`, replies `received`; `PUT /messaging/status` moves queued to printed to mailed for admins or the letter's `relayChapter`; `MessageStatus` rows record every change. `Message.resolveRelayChapter(prisonerId, requested, callerChapter)` validates an explicit group against the facility's relay groups (`Prisoner.relayGroupsFor`) and otherwise defaults to the caller's group, then the single relay group, then none unless the facility is `relay_only`. Non-admins may edit or delete a letter only while `isOpen(status)`.
- Moderation (`moderation.controller.js`, `Submission`): any authenticated account may propose; `Submission.RESOURCES` maps `prisoner`/`prison`/`chapter` to their model, full field list, submittable subset (everything except `recordStatus`, `verifiedBy`, `verifiedAt`, `verificationNotes`, `vouchedBy`, and the group statistics), and create/update functions. `propose` and `revise` validate the payload without saving (`#validatePayload`): a create is built and validated whole, an edit is laid over the target with `set()` and validated with `fields` limited to the proposed keys, so a bad value is a `400` for the submitter rather than a surprise for the reviewer. Approval merges reviewer `fields` (any field) over the payload and writes through the model's normal create/update, so validation is identical to a direct write and runs again (the target can change between filing and review, and reviewer edits are new input); a `SequelizeValidationError` leaves the proposal pending. Submitters read, revise, and withdraw their own pending proposals; admins do everything. `audit()` in `routes/services/audit.services.js` records moderation events, directory writes (create, update, delete, link/unlink), letter status moves, admin role/group changes, and managed-writer creation and claiming. `staleVerificationWhere()` in `database/record-status.js` backs the `stale=true` filter and the summary.
- Group membership gates every chapter action: `requireRole` (directory writes, group and writer management), `mayManageUser` (editing or deleting managed writers), and `threadScope` / `resolveWriter` (letters) consult `activeChapterOf`; every refusal on those paths comes from `groupRefusal` / `scope.deny()` so the message names the condition. A chapter account may create groups (they start pending) but edits or deletes only its own group record; and `Prisoner.relayGroupsFor` only returns active relay groups, so a pending group cannot be chosen or defaulted as a letter's relay. `accountStatus` is admin-only on create and update and reviewer-only in moderation; `networkRole` (collecting, relay, both; value lists in `database/validators.js`) is the group's own choice.
- Managed writers (`user.controller.js`, `User.createManagedWriter` and friends, `ClaimToken`): a group creates an account with `managedBy` set; the local strategy refuses login while `managedBy && !claimedAt`; `POST /auth/claim` sets credentials, `claimedAt`, `claimedFrom`, and clears `managedBy`, after which the group is out of scope. `User.anonymousWriterFor(chapterId)` find-or-creates the one account with `anonymousForChapter = chapterId`. `managerNote` is stripped from every response except to admins and the managing group (`#stripPassword(user, req)` in the user controller).

To change the policy, edit the route files (which roles guard which routes) and the two controllers (ownership). `requireRole` is deliberately dumb so that the policy stays visible in the route definitions.

## Data layer

### Sequelize setup

`database/sql-database.js` builds everything and exports the Sequelize instance, each initialized model, and `ready`. Models are initialized (Chat, Message, Prison, Prisoner, User, Chapter) and then associated; `associate` needs all classes to exist, which they do by then.

Tables: `User` (explicit `tableName`), `Prisons`, `Prisoners`, `Chats`, `Messages`, `Chapters`, and the join tables. Every table gets `id`, `createdAt`, and `updatedAt`. SQLite enforces the foreign keys because Sequelize turns `PRAGMA foreign_keys` on for every connection.

`database/connection.js` sets three things about how SQLite is used, and `test/sqlite-settings.test.js` holds them in place:

- **Write-ahead log.** `enableWriteAheadLog()` runs before the migrations. Readers no longer wait for a writer, and a writer no longer waits for readers; with the old rollback journal one slow inbox read held up every write. It is stored in the file, so it is set once; an in-memory database ignores it. The cost is the `-wal` and `-shm` side files, which is why a backup uses `.backup` (README, Data persistence). `synchronous` stays at SQLite's default (`FULL`): a letter acknowledged to a phone must survive a power cut.
- **Waiting for the lock happens in JavaScript** (`LOCK_RETRY`: Sequelize retries a statement refused with `SQLITE_BUSY`, 50 times over about ten seconds), and SQLite's own busy timeout is set to **0** on every connection. SQLite's wait blocks the thread that runs the statement, Node gives all database work four threads, and node-sqlite3 waits one second by default: a handful of writers waiting for the lock held every thread, the transaction that _had_ the lock could not run its next statement, and nobody moved until the timeouts expired, only to start again. That is how a fresh seeded start (forty letters saved at once, each opening a transaction in a hook) never became ready between #101 and #107. A refused statement has done nothing, so trying again is safe; with `BEGIN IMMEDIATE` only a `BEGIN` or a write outside a transaction can be refused. Two rules follow: **no implicit transactions in hot paths** (`Model.findOrCreate` opens one of its own: `Chat.findOrCreateChat` uses an in-process queue instead, `RevokedToken.revoke` the unique index), and **never raise the busy timeout** to "fix" a `SQLITE_BUSY`.
- **`BEGIN IMMEDIATE`** (`transactionType`). A transaction that reads and then writes takes the write lock when it starts. With the default (`DEFERRED`), two such transactions could both read, and the second to write failed with `SQLITE_BUSY` however long the timeout, because SQLite cannot let it wait without breaking the first one's snapshot.

**Indexes.** Sequelize indexes primary keys and `unique` columns only; foreign keys get none. `2026.09.20T00.00.00.hot-path-indexes.js` adds the ones the everyday queries need (a thread's letters by date, a writer's and a group's letters, the mailing queue by status, envelopes by reader, members of a group, prisoners of a facility, and the foreign keys a delete has to check) and runs `ANALYZE`. At 300,000 letters the inbox query went from 99 ms to under 0.1 ms. When a new query filters or sorts a large table on something else, add an index in a migration and check it with `EXPLAIN QUERY PLAN`; the migrations test asserts the list by name.

### Schemas

`database/schemas/<model>.schema.js` files export plain objects passed to `Model.init`:

| Model           | Columns (beyond id and timestamps)                                                                                                                                                                                                                                                                                                                                                                                                                 | Validation                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| User            | `name`, `username` (unique, not null), `password` (not null), `email` (unique, not null), `bio` TEXT, `role` (not null)                                                                                                                                                                                                                                                                                                                            | `username` len 3-16, `name` len 3-32, `bio` len 12-2400, `password` len 7-255, `email` isEmail, `role` in admin/user/chapter/banned. |
| Prison          | `prisonName` (not null), `address` JSON (not null), `country`, `routing`, `scanService` TEXT, `mailRules` VIRTUAL (the tags of its linked `MailRules`), `pageLimit` INT, `photoLimit` INT, `mailLanguages` JSON, `notes` TEXT, `verifiedBy` INT (FK Chapters, SET NULL), `verifiedAt` DATE, `verificationNotes` TEXT (staff only), `recordStatus`                                                                                                  | `routing` in the ROUTING_METHODS list; `recordStatus`                                                                                |
| Prisoner        | `birthName`, `chosenName`, `prison` INT (FK), `inmateID`, `releaseDate` DATE, `bio`, `status`, `aliases` JSON, `country`, `detainedSince` DATE, `sentence`, `charges` TEXT, `estimatedRelease`, `interests` JSON, `photoUrl`, `supportWebsite`, `donationInfo` TEXT, `statusNotice`, `featured` BOOL (not null, default false), `verifiedBy` INT (FK Chapters, SET NULL), `verifiedAt` DATE, `verificationNotes` TEXT (staff only), `recordStatus` | `status`; `aliases`/`interests` arrays of strings; URLs; `recordStatus`                                                              |
| Chat            | `user` INT (FK), `prisoner` INT (FK), explicit `id`                                                                                                                                                                                                                                                                                                                                                                                                | none                                                                                                                                 |
| Message         | `chat` INT (FK, not null), `messageText`, `sender` (not null), `prisoner` INT (FK, not null), `user` INT (FK, not null)                                                                                                                                                                                                                                                                                                                            | `chat`/`prisoner`/`user` isInt + notNull; `sender` in user/prisoner                                                                  |
| Chapter         | `name` (not null), `location` JSON (not null), `prisoners` JSON, `lettersSent` STRING and `averageTimeDays` INT (both counted, read-only), `lettersCounted` INT, `lettersSentBefore` INT, `subregion`, `country`, `about` TEXT, `website`, `email`, `socialLinks` JSON, `services` JSON, `announcement` TEXT, `vouchedBy` INT (FK Chapters, SET NULL), `recordStatus`                                                                              | `website` isUrl, `email` isEmail, `socialLinks` object of allowed keys, `services` subset of CHAPTER_SERVICES; `recordStatus`        |
| User (addition) | `chapterId` INT (FK Chapters, SET NULL)                                                                                                                                                                                                                                                                                                                                                                                                            | admin-only                                                                                                                           |
| PrisonerSupport | `prisoner` + `chapter` (composite PK, FKs CASCADE), `description` TEXT                                                                                                                                                                                                                                                                                                                                                                             | none                                                                                                                                 |
| PrisonRelay     | `prison` + `chapter` (composite PK, FKs CASCADE)                                                                                                                                                                                                                                                                                                                                                                                                   | none                                                                                                                                 |

The foreign-key columns are declared as plain integers in the schemas; the `references` and `ON DELETE` clauses come from the associations below. `recordStatus` is defined once in `database/record-status.js` and spread into the three schemas. The letter lifecycle (statuses, allowed transitions, `initialStatusFor`, `isOpen`) lives in `database/letter-status.js`. Value lists and the array/object validators for the directory fields live in `database/validators.js`. `PrisonerSupport` is a real model (it carries `description`); `PrisonRelay` is a string-named through table.

### Associations

Declared in each model's `associate(models)`. Every pair uses the column the schema already has, with `onDelete: 'RESTRICT', onUpdate: 'CASCADE'`:

| Declaration                                                                                                                                                  | Column                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `Chat.belongsTo(User, { as: 'user_details', foreignKey: 'user' })`                                                                                           | `Chats.user`                       |
| `Chat.belongsTo(Prisoner, { as: 'prisoner_details', foreignKey: 'prisoner' })`                                                                               | `Chats.prisoner`                   |
| `Chat.hasMany(Message, { as: 'messages', foreignKey: 'chat' })`                                                                                              | `Messages.chat`                    |
| `Message.belongsTo(Chat, { as: 'chat_details', foreignKey: 'chat' })`                                                                                        | `Messages.chat`                    |
| `Message.belongsTo(User, { as: 'user_details', foreignKey: 'user' })`                                                                                        | `Messages.user`                    |
| `Message.belongsTo(Prisoner, { as: 'prisoner_details', foreignKey: 'prisoner' })`                                                                            | `Messages.prisoner`                |
| `Message.belongsTo(Chapter, { as: 'relay_group', foreignKey: 'relayChapter', onDelete: 'SET NULL' })`                                                        | `Messages.relayChapter`            |
| `Message.belongsTo(User, { as: 'status_changed_by', foreignKey: 'statusChangedBy', onDelete: 'SET NULL' })`                                                  | `Messages.statusChangedBy`         |
| `Message.hasMany(MessageStatus, { as: 'status_history', foreignKey: 'message', onDelete: 'CASCADE' })`                                                       | `MessageStatuses.message`          |
| `User.hasMany(Chat, { as: 'chats', foreignKey: 'user' })`                                                                                                    | `Chats.user`                       |
| `User.hasMany(Message, { as: 'messages', foreignKey: 'user' })`                                                                                              | `Messages.user`                    |
| `Prisoner.belongsTo(Prison, { as: 'prison_details', foreignKey: 'prison' })`                                                                                 | `Prisoners.prison`                 |
| `Prisoner.hasMany(Chat, { as: 'chats', foreignKey: 'prisoner' })`                                                                                            | `Chats.prisoner`                   |
| `Prisoner.hasMany(Message, { as: 'messages', foreignKey: 'prisoner' })`                                                                                      | `Messages.prisoner`                |
| `Prison.hasMany(Prisoner, { as: 'prisoners', foreignKey: 'prison' })`                                                                                        | `Prisoners.prison`                 |
| `Prisoner.belongsTo(Chapter, { as: 'verified_by_group', foreignKey: 'verifiedBy', onDelete: 'SET NULL' })`                                                   | `Prisoners.verifiedBy`             |
| `Prisoner.belongsToMany(Chapter, { as: 'support_groups', through: PrisonerSupport, foreignKey: 'prisoner', otherKey: 'chapter' })`                           | `PrisonerSupport`                  |
| `Prison.belongsToMany(Chapter, { as: 'relay_groups', through: 'PrisonRelay', foreignKey: 'prison', otherKey: 'chapter' })`                                   | `PrisonRelay`                      |
| `Prison.belongsTo(Chapter, { as: 'verified_by_group', foreignKey: 'verifiedBy', onDelete: 'SET NULL' })`                                                     | `Prisons.verifiedBy`               |
| `Chapter.belongsToMany(Prisoner, { as: 'supported_prisoners', ... })`, `Chapter.belongsToMany(Prison, { as: 'relay_prisons', ... })`                         | same tables                        |
| `Chapter.belongsTo(Chapter, { as: 'vouched_by_group', foreignKey: 'vouchedBy', onDelete: 'SET NULL' })`                                                      | `Chapters.vouchedBy`               |
| `Chapter.hasMany(User, { as: 'members', foreignKey: 'chapterId', onDelete: 'SET NULL' })`, `User.belongsTo(Chapter, { as: 'chapter' })`                      | `User.chapterId`                   |
| `User.belongsTo(Chapter, { as: 'managing_chapter', foreignKey: 'managedBy', onDelete: 'SET NULL' })`                                                         | `User.managedBy`                   |
| `User.belongsTo(Chapter, { as: 'claimed_from_chapter', foreignKey: 'claimedFrom', onDelete: 'SET NULL' })`                                                   | `User.claimedFrom`                 |
| `User.belongsTo(Chapter, { as: 'anonymous_for_chapter', foreignKey: 'anonymousForChapter', onDelete: 'CASCADE' })` (unique)                                  | `User.anonymousForChapter`         |
| `ClaimToken.belongsTo(User, { as: 'writer', foreignKey: 'userId', onDelete: 'CASCADE' })`, `{ as: 'issuer', foreignKey: 'createdBy', onDelete: 'SET NULL' }` | `ClaimTokens.userId`, `.createdBy` |

The join tables' own foreign keys cascade, so deleting a prison or group removes its links. `RESTRICT` everywhere else was a deliberate choice: letters should never disappear as a side effect of deleting an account or a facility. Switch an association to `SET NULL` or `CASCADE` only after deciding what the product wants.

When you add an `include`, the `as` must match these aliases exactly; Sequelize throws an `EagerLoadingError` otherwise.

### User scopes

`User.init` sets `defaultScope: { attributes: { exclude: ['password'] } }` and a `withPassword` scope. Every `User.findOne` / `findAll` and every include of User from another model therefore omits the hash without the caller doing anything. `User.getUserWithPassword(where)` uses the scope explicitly and exists for the local login strategy only. If you write new code that needs the hash, use that method, never `User.unscoped()`.

`User.updateUser` runs with `individualHooks: true` (so the `beforeUpdate` hook can hash a changed password) and returns only `[count]`, because with individual hooks Sequelize also hands back the affected instances.

### Model classes

Each `database/models/<model>.model.js` exports a class extending Sequelize's `Model` with `static init`, `static associate`, and static CRUD helpers. Naming is not uniform across models (`get` vs `read`, `ByID` vs `ById`); when adding methods, follow whatever the file already does.

Worth knowing:

- Chat and Message list readers accept a trailing `extraWhere = {}` that is spread **last** into the where-clause. The controllers use it for the ownership filter, and spreading it last guarantees a query parameter cannot override it.
- `Chat.getChatByID`, `Message.getMessageByID` are `findByPk` wrappers used for scope checks and single reads.
- `User.createManagedWriter`, `anonymousWriterFor`, `managedWriterIds`, `listManagedWriters`, `claim`, `isUnclaimedManaged`, `isClaimable` (unclaimed, and not a group's shared anonymous account: that one holds many people's letters, so `createToken`, the claim check, and `claim` itself all refuse it), and the placeholder-email helpers live in `user.model.js` under "Managed writers". Generated usernames are `writer-` plus 8 hex characters (the column allows 16) and `anon-<chapterId>`.
- **Paper letters.** `Messages.paper` (migration `2026.09.24T00.00.00.paper-letters.js`). `Message.createLetter` reads the flag through `#paperFlag` (`true`; `false`, `null`, and omitted are the ordinary letter, as `null` is for `relayChapter` and `resendOf`; anything else is a 400; outgoing only), refuses a paper letter whose relay group resolved to nothing, and takes its initial status from `initialStatusFor(sender, { paper })` in `database/letter-status.js` (`printed`). The `beforeValidate` hook keeps an explicit outgoing status, so nothing else changes. `MessageController.#attachableMessage` lets non-admins change the files of a paper letter while it is `printed`; the idempotency fingerprint appends `'paper'` only when set, so older fingerprints are unchanged; `#announce` adds `detail: { paper: true }` to the group's `letter.queued`.
- **Error conditions.** `RouteController.handleErr` puts a `condition` on the general error body when the error object carries one (`err.condition`, as `AccountDeleteError` in `database/erase-account.js` and the invite-code controller set it) or when the handler passed a `msgType` other than `par` (the claim and invitation conditions). Treat `name` + `condition` as the client contract and the sentences as free to change.
- **Inbox counts.** `Chat.attachHeldCounts(chats)` runs one grouped query over the page's chat ids and sets `heldCount` / `heldReasons` on each row; called beside `attachLastMessages` on the list and on the single read. `Messages.returnNote` is written with `returnReason` in `Message.changeStatuses`, and the migration `2026.09.23T01.00.00.return-note.js` backfilled it from the newest `returned` history row.
- `InviteCode` (`database/models/invite-code.model.js`) is the front door for writers. `issue({chapterId, count, label, days, createdBy})` runs under a serial queue so the quota (`INVITE_CODES_OUTSTANDING` unused codes per chapter) is checked and the rows written as one step; codes are 12 Crockford characters stored as SHA-256 of `'invite:' + normalizeCode(code)` (upper-cased, dashes and spaces dropped, `O`→`0`, `I`/`L`→`1`), returned once. `lookup(code)` gives `{ record, state }` with `state` in `valid|used|cancelled|expired|unknown`; `consume(id, { transaction })` is a conditional UPDATE (`usedAt IS NULL AND cancelledAt IS NULL AND expiresAt > now`) so two joins with one code make one account; the controller runs it and `User.createSponsored` in one `inTransaction`, so a failed insert or a crash leaves the code unspent and the quota count never sees a spent code without its account. `batches(chapterId)` counts per batch and never returns hashes; nothing on the row points at the account. `POST /auth/join` (`routes/controllers/invite-code.controller.js`) validates the account fields with `User.build(...).validate()` before consuming the code, then `User.createSponsored`, which sets `sponsoredBy` once; `UserController.update` refuses any body naming `sponsoredBy`. `POST /auth/user` without an admin token is a 403 unless `OPEN_REGISTRATION=true` (the test helpers pin it to `true`; `test/registration-closed.test.js` checks the default).
- `ClaimToken.issue(userId, createdBy)` deletes any unused token, stores a SHA-256 hash of a 24-character base32 token (Crockford alphabet, upper-cased before hashing so input is case-insensitive) with an expiry of `CLAIM_TOKEN_DAYS` (14), and returns the plaintext once. `lookup(token)` returns `{ record, state }` with `state` one of `valid`, `used`, `expired`, `unknown`; the controller maps `unknown` to 404 and the others to 410.
- `Chat.readChatById` uses `findOne` and returns an object, like `readChatByUserAndPrisoner`.
- `Message.updateMessage` (`message.model.js:139`) re-resolves the chat when `user` or `prisoner` changes, merging with the stored row so changing only one of them still lands in the right chat. It has to do this itself because Sequelize's static `update` discards attribute changes made by `beforeValidate` hooks.
- `models.service.js` provides `modelInstanceExists(modelName, pk)`, which returns either the instance or a `NotFoundError` (returned, not thrown; callers check `instanceof Error` and throw). It knows all seven models.

### Encryption at rest

`services/crypto.js` wraps libsodium. The data shape is the end-to-end design's, run today with the server as the sole reader:

- Every message has a random 32-byte content key. `beforeCreate` encrypts `messageText` and `relayNote` (both `VIRTUAL` attributes on the model) into `ciphertext`/`nonce` and `relayNoteCiphertext`/`relayNoteNonce`; `afterCreate` writes the `LetterKeys` row (`readerType: 'server'`, `readerId: null`, `wrappedKey` = the content key boxed with `ENCRYPTION_KEY`, `keyLabel` = a fingerprint of that key).
- Reads decrypt in `LetterKey.decryptRows`, called from the Message `afterFind` hook for direct reads and from the Chat `afterFind` hook for embedded `messages` (Sequelize does not run the included model's hooks). In `server` mode it also deletes the ciphertext columns from `dataValues`, because nested rows are serialised without the model's `toJSON`.
- `Message.updateMessage` re-encrypts changed text under the letter's existing key (static updates bypass instance hooks). Attachments are encrypted with the parent letter's key and their own nonce (`Attachment.attach` / `readBytes`); files on disk are ciphertext and the row's `nonce` is hidden by the default scope.
- A `keyLabel` that does not match the running key raises `EncryptionKeyError` (500) instead of returning garbage.
- `sql-database.js` awaits `crypto.ready` and calls `assertConfigured()` before migrations, so a missing or malformed key fails the boot with a plain message. The encryption migration converts existing plaintext rows and files and needs the key too.

### Mail rules

There is one master list of rules and a facility links to entries of it; a facility has no rule text of its own.

- **Tables.** `MailRules` (`tag` unique and immutable, `category`, `label`, `description`, `retiredAt`, `createdBy`) and the join table `PrisonMailRules` (`prison` → Prisons `CASCADE`, `rule` → MailRules `RESTRICT`, so a rule in use cannot be deleted even by hand). `Prison.belongsToMany(MailRule, { as: 'mail_rule_details' })`. The 39 starting rules are inserted by the `2026.09.19T00.00.00.mail-rules-table` migration from a snapshot inside it: they are reference data every deployment needs, not seeds.
- **What stays in code** (`database/mail-rules.js`): `MAIL_RULE_CATEGORIES` (the allowed categories and their display order), `MAIL_RULE_CONFLICTS` (pairs of tags that contradict each other), `MAIL_RULE_PARAMETERS` and the validators for the three typed limits (`pageLimit`, `photoLimit`, `mailLanguages`), which are columns on `Prisons`. The photo rule refers to the tag `no_photos` by name; if an admin deleted that rule the check would simply never fire.
- **`Prison.mailRules` is a VIRTUAL field**, which keeps the client contract (`mailRules: [tags]`) while the storage is rows. Its getter returns tags set on the instance (a write, or a proposal being validated) or else the tags of the loaded `mail_rule_details`, in master-list order (`MailRule.inListOrder`: category order, then id). Its validator is async and calls `MailRule.resolve`, so everything that validates a facility (create, `Submission.propose`'s `build().validate()` and `existing.validate()`) checks tags against the table with no extra code.
- **Reads.** Every facility read includes `MailRule.detailsInclude()`: `Prison.#includes` for lists and single reads (with or without `full`), and the nested include on `prison_details` (prisoner reads) and `relay_prisons` (group reads). A new place that embeds a whole facility must add it too, or `mailRules` comes back `undefined` there. Sequelize runs no hooks for included models, so `mail_rule_details` is sorted (in `afterFind`) only on direct facility reads; `mailRules` is sorted everywhere. Lists already used `distinct: true`, so the extra join does not inflate `total`.
- **Writes.** Everything that changes the master list or a facility's links runs through one in-process queue, `oneRuleChangeAtATime` (exported by `mail-rule.model.js`): `createRule`, `updateRule`, `deleteRule`, `createPrison`, and the rule-touching path of `updatePrison`. So a rule cannot be deleted between a facility resolving it and linking to it, two admins cannot both pass the look-alike check, and two partial updates cannot each pass the photo check and clash together. Inside the queue, `createPrison` validates and resolves the tags, then writes the row and its links in one transaction (`inTransaction`), and returns a fresh read; `createBulkPrisons` (seeds) goes through it one facility at a time. `updatePrison` splits `mailRules` from the columns; with neither rules nor `photoLimit` involved it is a plain `Model.update` (which validates by default). Otherwise it resolves the tags (a retired rule may stay if the facility already has it, never arrive), checks the photo rule against whichever half was not sent, and writes columns and links in one transaction. It returns `[1]` or `[0]` like `Model.update`, so the controller's 404 handling is unchanged. The columns update is given the new tags as the virtual field so the model-level `photoRules` validator sees the rules as they will be. An explicit `mailRules: null` is refused by a model-level validator (`mailRulesNotNull`), because Sequelize skips a field's own validators for null.
- **Transactions.** `inTransaction(sequelize, work)` in `services/serial.js` runs one transaction at a time in the process, because an in-memory database has a single connection and a second `BEGIN` on it fails. Group key rotation uses it too. Take your own queue first and this one second, always in that order. On a file database a transaction has its own connection, takes the write lock at `BEGIN IMMEDIATE`, and other requests' writes try again until it is done (`LOCK_RETRY`, Sequelize setup); these transactions are a handful of statements.
- **Master list management** (`MailRule.createRule`, `updateRule`, `usage`; `PrisonController.createMailRule` / `updateMailRule` / `removeMailRule`, admin only). `lookalike` refuses a rule whose tag or label has the same words as an existing one, ignoring order, case, punctuation, and a plural `s`. It catches slips, not synonyms. `tag` is immutable (409 `RuleTagError`). Delete is refused while `usage > 0` (409 `RuleInUseError`); retiring sets `retiredAt`.
- **Filters.** `mailRule` checks the value against the tag pattern (`MAIL_RULE_TAG`) before it reaches the SQL literal, then matches through the join; a well-formed tag that is not on the list matches nothing. `language` is unchanged.
- **History.** Rules were free-text `Rules` records with their own `/rule` endpoints until `2026.09.17T01.00.00.mail-rule-tags`, which made them tags in a JSON column checked against a list in code. `2026.09.19T00.00.00.mail-rules-table` moved the list into the database and the column into a join table; a stored string that was not on the list is kept as words in the facility's `notes`. Both migrations can be reverted.

### Push notifications

Content-free by design: a push is a doorbell, the feed says what happened.

- **`services/push.js`.** `SYNC_DATA` (`{ type: 'sync' }`) is the entire payload for every event; `fcmMessage(device)` builds what FCM is asked to deliver (Android and web: data-only, high priority; iOS: the same data plus a generic visible alert from `PUSH_IOS_ALERT_*`, `mutable-content`, because Apple does not deliver silent pushes reliably). Do not add fields to it: anything here reaches Google, Apple, and lock screens. `createFcmProvider` speaks FCM's HTTP v1 API with a service-account key and no SDK: an RS256 JWT (the existing `jsonwebtoken` dependency) exchanged at `oauth2.googleapis.com/token` for an access token that is cached until a minute before it expires. `fetch` and `now` are injectable, which is how `test/push.test.js` checks the request shape without credentials; on 19 September 2026 it was run against the real service with `npm run push:check` (`services/push-check.js`): the token exchange and the send request were accepted and a fake device token was refused with `INVALID_ARGUMENT`, as it should be; delivery to a real device is the part still to be seen. Only the error code `UNREGISTERED` forgets a device: `INVALID_ARGUMENT` could be a bug in our payload and `SENDER_ID_MISMATCH` a wrong key, and neither should wipe tokens. Providers are pluggable (`use`, `reset`, `available`); `configure` loads FCM from `FCM_SERVICE_ACCOUNT_FILE` at `createApp()` and a bad file is reported, not fatal. `configure` also signs a probe JWT, so a key that cannot sign is reported at boot rather than at the first push. `ring(devices, { confirm, forget })` returns at once: each call is its own piece of work (events never queue behind each other), at most `PARALLEL_SENDS` devices at a time, and every request carries `AbortSignal.timeout(SEND_TIMEOUT_MS)`. The device list is a snapshot, so `confirm` (`Device.stillReachable`: same row, same account, same token, unmuted) runs just before each send, and `forget` (`Device.forgetExactly`) removes only the row as it was rung, never a registration the token has since moved to. `idle()` lets tests wait for everything in flight. A browser gets a `webpush` block (`Urgency: high`, `Topic: sync`), because FCM ignores `android` for Web Push.
- **`routes/services/notify.services.js`.** `notify(userIds, what, { actor })` drops duplicates, the actor, banned accounts, and accounts nobody can sign in to (`User.isUnclaimedManaged`), writes one `Notifications` row per recipient, and rings their unmuted devices. It never throws. Call sites: `MessageController.#announce` (a prisoner's reply tells the writer; a new letter with a relay group tells `membersOf` that group), `updateStatus` (`letter.status` with `detail.status`), and `ModerationController.#announceDecision`. To add an event, add it to `NOTIFICATION_EVENTS` and call `notify`.
- **Tables.** `Devices` (`token` unique; the default scope hides `token` and `sessionId`, `withToken` is for the sender) and `Notifications` (`chat`, `message`, `submission` all `CASCADE`, so retention and deletion take the entries with them; `detail` is small non-secret JSON). `Notification.sweep` runs with the session sweeps.
- **Sessions.** A device remembers the `jti` that registered it. Single logout calls `Device.forgetSession(jti)`; `User.revokeSessions` (logout everywhere, admin revocation, password change, recovery) calls `Device.forgetUser`, which is why clients register again after a password change. `Device.register` upserts by token and moves the token to the new account when a phone changes hands, resetting `muted` and `label`.
- **Controller.** `NotificationController` maps the base interface onto two resources: `create` registers a device, `getOne` lists the caller's devices, `remove` deletes one, `getMany` is the feed, `update` marks read; `updateDevice` is the extra.

### Idempotency keys

`Idempotency-Key` on `POST /messaging/message` and `POST /messaging/attachment`, so a retried send cannot become a second letter in a prisoner's hands. `routes/services/idempotency.services.js` `begin(req, res, scope, parts)` returns `null` (no header), `{ replay: id }` (the first attempt made this), or `{ complete, release }` for a first attempt. The controller calls it after validation that needs no database write and as late as possible before the create, reports back with `complete(id)`, and calls `release()` from its `catch`, so a key is remembered only for an attempt that made something.

- **No bodies are stored.** `IdempotencyKeys` holds `(userId, scope, key)` (unique), a SHA-256 `fingerprint` of the parts that must match on a retry, `state`, and `resourceId`. A replay re-reads the letter; storing the response would have put plaintext letters (server mode) in a new table. If the resource is gone the answer is 410, never a re-creation.
- **Races.** `IdempotencyKey.claim` inserts and lets the unique index decide; the loser reads the row: another fingerprint is 422, `processing` is 409 with `Retry-After`, `done` is a replay. A `processing` row older than `STALE_ATTEMPT_MS` (its process died) is taken over with a conditional update on `updatedAt < cutoff`, which also moves `updatedAt`, so only one retry wins. Two things keep a claim from being freed or taken over while its letter exists. `Message.createLetter` is all or nothing: if the envelopes, the history row, or the server key fail after the insert, the row is taken back before the error is returned, so releasing the claim is true. And once the letter exists the claim is never released: `recordResult` writes the result with a few spaced attempts and does not throw. What is left is a database that is down for all of them; the client was told `201` and has no reason to retry, and the failure is logged with both ids. (Putting the letter and the claim in one transaction would close that too; it means threading a transaction through the message hooks and the envelope code, which has not been done.)
- **What is fingerprinted.** For a letter: sender, prisoner, resolved writer, and in server mode the text. Not ciphertext: an outbox may encrypt again before retrying. For an attachment: letter, file name, and (server mode) size.
- A replay returns before `#announce`, so it writes no audit entry, no feed entry, and rings nobody; `test/idempotency.test.js` holds that in place. `IdempotencyKey.sweep` runs with the other sweeps (`IDEMPOTENCY_DAYS`). `app.js` lists `idempotency-key` in the CORS `allowedHeaders` and exposes `Idempotent-Replayed` and `Retry-After`; without the first a browser refuses to send the header at all.

### Invitations

`Invitations` rows are `kind` (`group` | `member`), `chapterId` (the vouching group, or the group being joined; null only for an admin's unvouched group invitation), the inviter's notes (`inviteeName`, `inviteeEmail`, `note`), `tokenHash` (SHA-256 of the upper-cased token, shared with claim tokens via `hashToken`; excluded by the default scope), `expiresAt`, `status` (`pending` | `accepted` | `revoked`; `expired` is derived by `Invitation.stateOf`), `invitedBy`, and what acceptance produced (`acceptedAt`, `acceptedUser`, `createdChapter`). The server makes the token, because unlike a claim token it wraps no key: the invitee generates their own keys when they accept. Mounted at `/invitation` (`InvitationRoutes`).

- Creating, listing, renewing, and withdrawing sit behind `requireRole(ADMIN, CHAPTER)`, which already refuses members of groups that are not active. `#managed` limits a group to invitations whose `chapterId` is its own.
- `#usable(token)` is the gate for both public endpoints: unknown is 404; expired, accepted, revoked, or an inviting group that is no longer active is 410.
- `accept` validates first (`Chapter.build().validate()`, `User.build().validate()`, `KeysController.keyFields`), then takes the invitation with a conditional update (`Invitation.consume`: pending and unexpired), then creates the group and the account. Uniqueness can only be found by inserting, so a failure at any step after the consume is compensated: the new account (if it got that far) and the new group are destroyed, in that order, and `Invitation.release` makes the invitation pending again. The audit entry is written last, so the log never describes an acceptance that was undone. This is compensation rather than a transaction; it predates `inTransaction` in `services/serial.js`, which would now be the tidier way to do it.
- The new group's fields come from `GROUP_PROFILE_FIELDS`, which is the moderation `submittable` list for chapters: the profile, never `accountStatus`, `recordStatus`, `vouchedBy`, or verification. `vouchedBy` is set from the invitation. `#activatesAtOnce` is the one rule for both the public view's `activation` and the statuses the group is created with: a member always, a group when `invitationAutoActivate` (`INVITATION_AUTO_ACTIVATE`) is set, including an admin's unvouched invitation, which only an admin can issue. It chooses between `pending`/`pending` and `active`/`published` for `accountStatus`/`recordStatus`; an admin approves with the ordinary chapter update.
- `handleSuccess` answers 201 for `accept`, as for `claim`.
- Audit actions: `invitation.create`, `.renew`, `.revoke`, `.accept` (the last with no actor).

### Returned mail

`database/letter-status.js` holds the lifecycle: `returned` is reachable from `mailed` only and is terminal; `RETURN_REASONS` are the codes, `ADDRESS_RETURN_REASONS` the three that say the person may not be where the directory says. `Message.changeStatus(message, status, by, { reason, note })` demands a reason for a return and refuses one for anything else, writes `returnReason` on the letter (so lists need no join) and `reason` / `note` on the `MessageStatuses` row. No new notification event: a return is a `letter.status` with `reason` in its detail, so a client that knows the event keeps working. `resendOf` (a self-reference, `SET NULL`) is checked in `createLetter` (same writer, same prisoner, status `returned`) and is not in `EDITABLE`, so an edit cannot forge it; `readLetter` embeds `resent_as`. `Prisoner.addressInDoubtWhere()` is a subquery over the history (indexed by `toStatus, createdAt`) that compares the return's date with the prisoner's `updatedAt`, which is how an edit answers the doubt without a flag to clear; it names the outer table by Sequelize's alias `Prisoner`, so use it only in queries on that model.

### Moved and freed

`routes/services/prisoner-change.services.js`. Every path that edits a prisoner calls `watchPrisoner(id)` before the write and `afterPrisonerChange(req, before)` after it: today the prisoner controller's `update` and the moderation controller's `approve` (for an update of a prisoner). A new path that can change `prison` or `status` must do the same; the comparison of before and after is what decides that anything happened, so calling it on an edit that moved nobody costs two small reads. It never throws (the directory edit is committed). For a move it re-routes each `queued` letter with the same `Message.resolveRelayChapter` a new letter uses, keeping the current group when it serves the new facility too; each write is conditional on the letter still being `queued`. Holds are `Messages.heldReason` (`HELD_REASONS` in `letter-status.js`): not a status, so the lifecycle and every status filter are untouched. `changeStatus` refuses to move a held letter without `release: true` and clears the hold on any move; `updateMessage` clears a `choose_relay` hold when a relay group is chosen; `heldReason` is not in `EDITABLE`. In end-to-end mode a letter whose group does not serve the new facility is held as `reseal_needed` and its `relayChapter` is left alone: the server must not hand a group a letter it holds no envelope for.

### Backups

`services/backup-archive.js` is the file format and nothing else: a minimal ustar writer and reader, and the encryption (a random key for libsodium's secretstream, sealed to `BACKUP_PUBLIC_KEY`; the magic and the header are associated data of every chunk; the last chunk carries the FINAL tag, and the reader reads to the end of the stream even after the tar has ended, because only then has truncation been ruled out). Everything streams; nothing holds more than one 256 KiB chunk. `database/backup.js` is what goes into it: `VACUUM INTO` a working directory inside `BACKUP_DIR` (one read transaction, so it is consistent and safe beside a running server, WAL or not), then the list of attachment files **read from that copy**, not from the live table, so the database and the files in one backup always agree. The file is written under a working name and renamed when complete, so nothing half-made ever matches the backup name pattern; the working directory (the database in the clear) is removed in a `finally`. `verifyBackup` unpacks into the system's temporary directory and removes it whatever happens. `restoreBackup` refuses a directory that is not empty and never touches the live files. `.env` is never included. The CLI imports `connection.js` and not `sql-database.js`, so it runs no migrations and starts no timers; `scheduleBackups()` is called from `index.js` only, so scripts and tests that await `ready` never start it.

### Letter nights

`Message.changeStatuses(messages, status, by, options)` is every status move (`changeStatus` is a batch of one, so that two requests for one letter cannot both succeed and a letter is counted as mailed once): `#checkMove` (the rules of one move, shared with `changeStatus`; in a batch its sentences name the letter) runs for every letter before anything is written, then one `inTransaction` does a conditional `UPDATE` per letter whose `WHERE` holds everything that was checked (`status`, `heldReason`, `relayChapter`: a letter held or handed to another group in between is not moved) and writes its history row in the same transaction; a count of 0 throws and rolls everything back. The controller loads all the letters in one query, answers 404 and 403 with the ids concerned, writes one audit entry, and groups the letters by writer for `#announceBatch`. `Message.attachPrintDetails(rows, publishedOnly)` is what `full=true` adds to message reads: it loads the page's prisoners (with facility and mail rules) and writers in two queries and sets them on the rows, the way `Chat.attachLastMessages` does, instead of adding includes to five list queries.

### Group statistics

A group's public numbers are counted. `Chapters.lettersCounted` goes up by one in `Message.changeStatus` and by the batch's count inside `changeStatuses`' transaction, whenever the new status is `mailed` (`Chapter.countMailed`). It is a counter and not a `COUNT(*)` because retention deletes mailed letters after the writer's window, and an account deletion takes letters with it: the number of letters a group has sent must not fall. `lettersSentBefore` is the group's own figure for the time before the site. `Chapter.recount(id)` writes the public `lettersSent` (still the text column clients have always read): the sum, or `NULL` below `Chapter.PUBLIC_FROM` (20). Storing the public value, instead of deciding per reader, keeps every read, embed, and sort as it was; the two figures behind it are `CHAPTER_STAFF_ONLY` and are excluded for non-staff through `Chapter.publicAttributes(publishedOnly)` in the chapter reads and in the `support_groups` and `relay_groups` embeds. `Chapter.refreshMailingTimes()` runs at boot, on the timer, and at the end of any retention run that deleted something (so `npm run retention` does it too); it asks the database for the last 90 days only: a median (not a mean: one letter that waited a month would dominate) of queued-to-mailed days over 90 days, `NULL` under `MIN_SAMPLES` (5) or while the count is hidden. Neither public column is in `CHAPTER_FIELDS` any more.

### Group roles

Three tiers, decided on 22 September 2026: **superadmin** (role string `admin`), **group-owner admin** (role `chapter` plus `Chapters.ownerId`), **group admin** (role `chapter`). The role strings are what clients match on and did not change; the owner is a column, `Chapter.setOwner(chapterId, userId, from)` sets it conditionally on the owner it replaces (so two transfers cannot both win), and `Chapter.groupAdminIds(chapterId)` is who a change concerns. In `KeysController`, `#requireOwner(req, chapter)` guards `putMemberKey`, `remove`, both rotation endpoints, and `chapterOwner` (a superadmin passes `chapterOwner` only); `chapterKeys` refuses superadmins outright and makes the first key setter owner when there is none. Every change goes through `KeysController.tellGroup(chapterId, what, actor)`: `group.key`, `group.owner`, `group.waiting`. `noteWaiting(userId)` fires `group.waiting` once when a group admin can first open a key and has none of the chapter's (`PUT /auth/keys`, accepting a member invitation, a superadmin moving them into a chapter). Ownership is cleared when the owner leaves the chapter or stops being a group admin (`UserController.update`) and by `ON DELETE SET NULL`; `eraseRefusal` refuses an owner whose chapter has other group admins. The migration gives existing chapters their earliest key holder, else their earliest group admin.

### Retention

`database/retention.js` exports `windowFor(writer)` (the writer's `retentionDays`, else the default, capped; `null` means keep forever) and `runRetention({ dryRun, now, log })`. The run selects messages whose status is one of `SETTLED_STATUSES` (`mailed`, `received`, `returned`), `keep = false`, and a date older than the shortest window anybody has (`shortestWindow`: the site default or the smallest `retentionDays`, so the database leaves out everything that cannot be due yet; nothing is read at all when every window is "forever"), loads their writers in batches, resolves each writer's window, and deletes those whose `statusChangedAt` is older than it with `purgeIfUnpinned`: a conditional `destroy` (`keep = false` and still settled at that instant, so a pin made after the snapshot wins) after listing the attachment files, which are unlinked once the row is gone (envelope and history rows cascade). Runs in one process never overlap (`runRetention` reuses an in-flight run); a concurrent manual run in another process only ever double-counts nothing, because each deletion is conditional. A cap of `0` is refused (it would read as the forever sentinel). Chats emptied by the run are destroyed, one `retention.run` audit entry records the counts, and `VACUUM` follows so freed pages leave the file. `sql-database.js` runs it at boot and every six hours on an unref'd timer; `npm run retention [-- --dry-run]` runs it by hand. `PUT /auth/user` validates `retentionDays` (whole number, not negative, within the cap) and lets a managing group set it for its unclaimed and anonymous writers; `PUT /messaging/message` accepts `{ id, keep }` on a mailed letter from anyone in scope, the one edit allowed after mailing.

### Changing the server key

`ENCRYPTION_KEY` wraps exactly one kind of thing: the `server` rows of `LetterKeys`, each holding one letter's content key and a `keyLabel` (a fingerprint of the key that wrapped it). `crypto.serverKeyNamed(label)` answers `current`, `previous` (`ENCRYPTION_KEY_PREVIOUS`), or `null`, and `unwrapForServer(wrapped, label)` opens with the key the label names, so every caller passes the label. Nothing is ever _written_ with the previous key. `database/rekey.js` walks the rows that do not carry the current label by id, in batches of 500, each batch one transaction, each `UPDATE` conditional on the label it read (`keyLabel IS :label`, so a second run or the API cannot be overwritten); a row no configured key opens is counted, left exactly as it is, and makes the command exit 1. The dry run opens every row too, so it reports what the run will; rows it leaves are `unknown_key` (labelled for a key the server was not given: supplying it fixes them) or `does_not_open` (labelled for a key it has: damaged or mislabelled, and no key will help). The audit entry is written inside the first batch's transaction and updated in each later one, so a stopped run has recorded exactly what it committed. It uses `connection.js` and raw SQL, not the models, so it runs no migrations and can run beside the API. `runMigrations` refuses to start with `ENCRYPTION_KEY_PREVIOUS` set while the two migrations that read letters with the key itself are pending on a database that has letters: they know one key and no labels. Anything else that is ever encrypted with the server key directly (a second-factor secret, say) must carry a label the same way and be added to this script.

### End-to-end mode

**Sign-in and the private key.** A `plain` account sends its password to the API, and the locking key for `wrappedPrivateKey` is derived from that same password, so a server modified to record passwords could read that account's letters. A `split` account (see the auth-scheme paragraph under Login) sends an auth key instead and keeps the wrap key on the device; that is the mode every new account should use, and `REQUIRE_SPLIT_AUTH` makes it the only one. What no API change removes: a web client runs whatever code its host serves, and the server sees who writes to whom and when.

`crypto.isE2E()` switches the same code paths to browser-held keys:

- Key material lives on `User` (`publicKey` visible; `wrappedPrivateKey`, `kdfSalt`, `kdfParams`, the recovery pair, `orgWrappedPrivateKey`, and the recovery challenge hidden by the default scope and read through the `withKeys` scope / `User.getUserWithKeys`), on `Chapter.publicKey`, on `OrgMemberKeys` (group private key sealed per member), and on `ClaimTokens` (writer private key wrapped with the token). `KEY_COLUMNS` / `KEY_INPUT` in `user.model.js` name them; `#stripPassword` deletes every key column from user responses. `keys.controller.js` (mounted at `/auth`; its handlers are named `getOne` / `update` / `create` / `remove` / `getMany` to satisfy the base interface: own bundle, re-wrap, recovery finish, member-key removal, member list) plus `publicKey`, `recoverChallenge`, `chapterKeys`, `putMemberKey`, `rotationMaterial`, `rotate`.
- Letters: the Message `beforeCreate` hook refuses plaintext and keeps the client's `ciphertext` / `nonce`; `Message.createLetter` computes `allowedReaders` (writer, relay group, managing group, active relay groups of the facility), validates `envelopes` with `LetterKey.validateEnvelopes` (writer envelope required unless the writer is a group's anonymous account; relay envelope required when set), and stores them with `issueEnvelopes`. `afterFind` leaves ciphertext in place and nulls the virtual text fields. Controllers attach `envelopes` for the caller via `LetterKey.envelopesFor` (writer: own; chapter member: the group's plus those of unclaimed writers it manages; admin: all). `Message.addEnvelope` backs `POST /messaging/envelope` for forwarding. The thread scope treats a group holding an envelope as a reader (`envelopedMessageIds` in `scope.services.js`; `allowsMessage` is async for it), so a partner group sees the letter after forwarding.
- Group key versions and rotation: `Chapters.keyVersion` (0 = no key, 1 at set-up, +1 per rotation) and `keyRotatedAt`; `LetterKeys.keyVersion` on chapter envelopes. The server cannot verify what a sealed box was sealed to, so the client declares it: `LetterKey.validateEnvelopes` checks each group envelope's `keyVersion` against `allowed.chapterVersions` (from `Message.allowedReaders`), and `KeysController.requireCurrentGroupKey` checks `orgKeyVersion` wherever a writer's `orgWrappedPrivateKey` is written (`createWriter`, the custody branch of the user update). A stale version is a 409 `KeyVersionError`. `Message.createLetter` and `addEnvelope` re-check after writing (`LetterKey.staleGroupEnvelopes`) and take the row back if a rotation landed in between. `rotate` (`POST /auth/chapter-rotation`) runs in a Sequelize transaction (through `inTransaction`, shared with facility rule writes): it first claims the rotation with a conditional update on `(id, keyVersion, publicKey)`, then compares the submitted envelope and writer ids with what is stored (`#sealedToGroup`), inside the transaction, and throws (rolling back) on any difference; then rewrites `LetterKeys.wrappedKey`, the writers' `orgWrappedPrivateKey` (only while still non-null, so a claim in the meantime aborts it), and replaces the group's `OrgMemberKeys`. `withGroupKeyLock` (`routes/services/groupkey.services.js`) is one in-process queue for everything that must not straddle a rotation: rotations themselves, the two writes of a group-sealed writer key (the version check and the insert or update run inside it together), and member-key removal (count and delete together, so two removals cannot both find a holder to spare). In-process is enough for a single Node process on SQLite, which has one writer, and an in-memory database has a single connection that cannot nest transactions; a multi-process deployment would need a database-level lock. With `DB_STORAGE=:memory:` (tests) every query shares that connection, so a query from another request during a rotation would run inside its transaction; a file database gives the transaction its own connection. Chapter create and update refuse `publicKey`, `keyVersion`, and `keyRotatedAt`.
- Attachments pass through: `Attachment.attach` stores the uploaded bytes as-is with the client's `nonce`, `readBytes` returns them, the controller skips sniffing, and the default scope exposes `nonce`.
- Managed writers: `createWriter` requires `publicKey` + `orgWrappedPrivateKey`; `createToken` takes the client's `tokenHash` and claim-wrapped key (`ClaimToken.issueFromClient`); `claimInfo` returns them; `claim` requires the re-wrapped keys and `User.claim` clears `orgWrappedPrivateKey`. `GET /auth/writers` adds `orgWrappedPrivateKey` for the managing group (`User.orgWrappedKeysFor`).
- Recovery: `recoverChallenge` seals 32 random bytes to the account's public key and stores their SHA-256 (`recoveryChallengeHash`, ten-minute expiry); `create` (`POST /auth/recover`) verifies the opened bytes, sets the password (hashed by the hook) and the re-wrapped key, and clears the challenge.
- Latecomers: the switch does not wait for everyone. `catchUpReader({ readerType, readerId })` in `database/rewrap-e2e.js` seals to a reader every letter the server still holds a key for and they read (a user: letters they wrote; a group: letters it relays and those of writers it manages), and in e2e mode destroys the server envelope once every required reader is covered. It shares `sealToReaders` with the full script. `KeysController.catchUp` wraps it (a failure is logged, never returned, because the keys are already saved) and is called when a reader first becomes able to read: `PUT /auth/keys` (`becameUsable`), `PUT /auth/chapter-keys`, and the custody branch of the user update (`custodyKeyed`). It returns `null` when `ENCRYPTION_KEY` is gone. It runs inside `withGroupKeyLock`, and re-checks `LetterKey.staleGroupEnvelopes` before destroying a server envelope, so a rotation cannot leave a letter sealed only to a key nobody holds. The trigger is the account becoming able to open what is sealed to it (`becameUsable`: a wrapped private key arriving where there was none); a first `publicKey` without `wrappedPrivateKey` is a 400, and a group keying an unclaimed writer must send `orgWrappedPrivateKey` with the first `publicKey`, for the same reason: a public key whose private half nobody holds would swallow letters. `LetterKey.validateEnvelopes` requires the writer's envelope only when the writer has a public key, and refuses one for a writer who has none; `LetterKey.missingForWriters(chapterId)` (behind `GET /messaging/envelopes/missing`) finds letters the group holds an envelope for whose writer has keys by now and no envelope, for the group's client to fill in through `Message.addEnvelope`. The server cannot do that part: it never had those letters' keys. `KeysController.readiness` is a handful of aggregate queries; "blocks the switch" means active, relays mail, and keyless. At boot in e2e mode remaining server envelopes are reported with `log`, not `warn`: they are expected. `rewrapForE2E({ dropAllServerKeys })` is the final cut-off and reports `abandoned`.
- Switching: see `docs/E2E-MIGRATION.md` for the operator checklist. `database/rewrap-e2e.js` (`rewrapForE2E`, `npm run encryption:rewrap [--dry-run] [--drop-server-keys | --drop-all-server-keys]`) unwraps each server envelope with `ENCRYPTION_KEY` and seals the content key to every reader that has a public key, reporting the rest. `--drop-server-keys` deletes the server's copy only where every required reader is covered; `--drop-all-server-keys` is the final cut-off and deletes the rest too. Boot in e2e mode reports (with `log`, not `warn`) how many letters still wait for a reader: that is expected while latecomers exist. Seeds skip messages in e2e mode.
- Tests: `test/e2e-client.js` plays the browser (scrypt from `node:crypto` as the KDF, libsodium for the rest); `test/e2e.test.js` pins `ENCRYPTION_MODE=e2e` before importing the helpers (which respect a preset mode); `test/rewrap.test.js` exercises the switch from server mode.

### Hooks

Registered through `database/hooks/all.hooks.js`:

- **User `beforeCreate`** and **`beforeUpdate`**: replace `password` with `bcrypt.hash(password, 10)`. The update hook only runs when `record.changed('password')`, so unrelated updates do not re-hash the hash. It fires for `User.updateUser` because that call passes `individualHooks: true`.
- **Message `beforeCreate` / `afterCreate` / `afterFind`** and **Chat `afterFind`**: see Encryption at rest above.
- **Message `beforeValidate`**: on a new record, sets `status` from the sender (`received` for a prisoner reply, `queued` for a letter unless a valid outgoing status was given, so seeds and backfills work); then calls `Chat.findOrCreateChat(user, prisoner)` and writes the chat id onto the instance. Skipped when either id is missing so the schema's `notNull` messages surface. Only effective on create; see `updateMessage` above.

### Deletion semantics

There is no `paranoid` mode; every `destroy` is a hard delete, and the foreign keys decide whether it is allowed. `Chat.deleteChat` deletes the chat's messages first, then the chat, which is why it succeeds where a raw delete would be refused.

**Accounts.** `database/erase-account.js` deletes a person: `eraseAccount(id)` removes, in one transaction, their letters in batches (envelopes, history, attachment rows, and notifications about them cascade), their threads, any envelope sealed to them, and the row; files leave the disk after the commit. Everything else that points at `User` is either `CASCADE` (devices, notifications, claim tokens, idempotency keys, member keys) or `SET NULL` (what they did as staff), so a new table that references `User` must choose one of the two, never `RESTRICT`, or deleting an account breaks. `eraseRefusal(user)` holds the three cases that are refused (the only admin, the last holder of a group key, a group's anonymous account). The controller runs the refusal check and the delete as one step under `withGroupKeyLock` (two admins, or two key holders, leaving at the same moment must not each count the other as the one who stays; it is the lock every change of key holders takes). It asks for the password when people delete themselves, behind `limiters.deleteAccount` (which counts only requests that target the caller's own account), and writes the audit entry without an actor in that case (the row it would point at is gone).

## Seeds

`database/seeds/all.seeds.js` runs seed functions sequentially in dependency order: User, Prison, Prisoner, Chat, Message, Chapter. Each checks `count === 0` before inserting, so seeding is idempotent and safe to leave enabled. After running it logs one line, for example `Seed data: users: 41 seeded, prisons: 52 seeded, ...` or `users: already populated, ...`.

Each `<model>.seed.js` reads its sibling `<model>Seed.json` (`{ "seeds": [ ... ] }`) and calls the model's `createBulkXs`, which is `bulkCreate` with `individualHooks: true` (so user passwords get hashed) and `ignoreDuplicates: true`. Messages use `validate: true` instead; their `chat` is resolved by the message hook at insert time.

Row counts: 41 users, 52 prisons, 40 prisoners, 40 chats, 40 messages, 1 chapter. Prisoner N is in prison N, chat N pairs user id N with prisoner N. Every seeded prison has `mailRules` (tags the seeder links to the master list, which the migration provides) and, for many, limits; "Test Prison" has a fixed, readable set.

User ids do not come out in seed-file order; in one run `admin` received id 3. Do not hardcode seeded ids in tests.

## Pagination and the `full` flag

`handleLimits` in the base controller validates `page` and `page_size` and turns them into Sequelize `limit` and `offset`. Every list controller calls it; there are no private copies of the arithmetic any more.

List readers return `findAndCountAll` results, `{ rows, count }`, and controllers send them through `RouteController.handlePage(res, result, limits)`, which puts `rows` in `data` and adds `total`, `page`, and `page_size` to the envelope. Counts use `distinct: true` wherever a has-many include could multiply rows.

The directory models (Prison, Prisoner, Chapter) take an options object: `getAllPrisons({ full, limit, offset, publishedOnly, where })`, `getPrisonByID(id, { full, publishedOnly })`, and so on. `publishedOnly` adds `recordStatus = 'published'` to the query and to the embedded prisoners/prisons/chapters, hides chats from prisoner embeds, and drops the staff-only columns (`Prisoner.publicAttributes()` / `Prison.publicAttributes()` exclude `verificationNotes`). Create helpers take the whole body and `pick` the allowed field list (`PRISONER_FIELDS`, `PRISON_FIELDS`, `CHAPTER_FIELDS`), so adding a column means adding it to the schema, the migration, and that list. Chat, Message, and User readers are still positional `(…, limit, offset)`; convert them to the same style when you next touch them.

Chat list readers add a `lastMessageAt` attribute (a correlated `MAX(createdAt)` subquery) and order by it descending with empty chats last; the literal is repeated in `ORDER BY` rather than referenced by alias so it survives the subquery Sequelize wraps around limited queries with includes. `Chat.attachLastMessages(rows)` then finds each chat's newest message id with one indexed query, loads only those rows (so only those are decrypted), and sets a `last_message` summary on each row. Text search uses `Op.like` with `%term%`; SQLite's `LIKE` is case-insensitive for ASCII, and `%`/`_` in the term act as wildcards.

`full` is a string in the query; controllers compare `full === 'true'`. Message endpoints accept it and ignore it (there is no message eager-load yet).

## Tooling

### npm scripts

| Script            | Command                                             | Notes                                          |
| ----------------- | --------------------------------------------------- | ---------------------------------------------- |
| `npm start`       | `node index.js`                                     |                                                |
| `npm run dev`     | `nodemon index.js`                                  | Restarts on file changes.                      |
| `npm test`        | `echo "echo the test"`                              | Placeholder. There are no tests.               |
| `npm run lint`    | `eslint --fix "**/*.+(js\|mjs)"`                    | Autofixes. Review the diff (see below).        |
| `npm run format`  | `prettier --write "**/*.+(js\|mjs\|json\|css\|md)"` |                                                |
| `npm run prepare` | `husky`                                             | Runs automatically after `npm ci` / `install`. |

### ESLint

`eslint.config.js` is an ESLint 9 flat config. It ignores everything in `.gitignore` plus `package*.json`, and applies `@eslint/js` recommended to JS with Node globals, `@eslint/json` to JSON, `@eslint/markdown` to Markdown (GFM), `@eslint/css` to CSS, and `eslint-plugin-prettier`. The Markdown rules mean **documentation files are linted too**: fenced code blocks need a language, heading levels must not skip, and table rows must have consistent column counts (escape pipes inside table cells as `\|`).

A cautionary tale: in June 2025 the `no-prototype-builtins` autofix turned `this.hasOwnProperty(fname)` into `this.hasOwn(fname)` in the base controller, which crashed every response for a year (see [History](#history-what-was-fixed-in-2026)). Review `--fix` diffs and boot the server before committing them.

### Prettier, Husky, lint-staged

`.prettierrc.json`: tabs, width 100, single quotes, semicolons, no trailing commas. Prettier also formats Markdown and JSON, including the seed files and the Postman collection.

`.husky/pre-commit` runs `npx lint-staged --allow-empty`, which runs `eslint --fix` on staged JS and `prettier --write` on staged JS, JSON, CSS, and Markdown, then re-stages the result. Husky 9 is installed by the `prepare` script.

### Dependencies, native modules, and Node versions

- `npm ci` works; keep `package-lock.json` in sync when changing `package.json` by running `npm install` and committing the lockfile.
- npm 11 gates packages with install scripts. The approvals live in `package.json` under `allowScripts` (pinned by version: `bcrypt`, `sqlite3`, `quick-lint-js`, `fsevents`). When one of those packages is upgraded, run `npm install-scripts approve <pkg>` again and commit the change.
- `sqlite3` needs `prebuild-install` 7.1.3 or newer (pinned in the lockfile) to pick the right prebuilt binary on Node 24 and later; older versions compared N-API versions as strings and asked for a build that does not exist, then fell back to a source build that fails on Python 3.12+ (no `distutils`).
- Node 26 removed `SlowBuffer`; `jsonwebtoken` 9.0.3 (via `jws` 4 / `jwa` 2) no longer loads the module that used it. Do not downgrade below 9.0.3.
- `libsodium-wrappers` (WebAssembly, no install scripts) provides the same primitives the browser will use in `e2e` mode, so ciphertext produced now stays readable by browser code later. Node's own `crypto` lacks XChaCha20-Poly1305 and sealed boxes. The symmetric cipher is `crypto_aead_xchacha20poly1305_ietf` (no associated data), not `crypto_secretbox` (XSalsa20-Poly1305): the two share key and nonce sizes but are different algorithms, and the `2026.09.13T02.00.00.xchacha.js` migration converted early server-mode data from the latter. `crypto.legacy` exists only for that migration.
- `multer` 2 parses multipart uploads (Express 5 compatible, no install scripts). Files are held in memory (`memoryStorage`) up to `UPLOAD_MAX_BYTES`, sniffed, then written by `services/files.js`; raise the limit with care since each in-flight upload occupies that much memory.
- `engines.node` is `>=18` (Express 5, static class blocks, `Object.hasOwn`).
- On Apple Silicon, make sure `node -p process.arch` prints `arm64`; an Intel Node under Rosetta will fail to load arm64 binaries and vice versa. After switching, `rm -rf node_modules && npm ci`.

### Tests

`npm test` runs `node --test "test/**/*.test.js"` (a glob, because Node 22 and 24 do not expand a bare directory argument). There are no test dependencies: the built-in runner, `node:assert`, and global `fetch`.

- `test/helpers.js` pins the environment (`DB_STORAGE=:memory:`, `DB_SEED=false`, a test JWT secret, blank `ADMIN_*`) **before** importing `app.js`, because `constants.js` reads `process.env` at import time. It exports `startServer()` (awaits `ready`, listens on an ephemeral port), `stopServer()`, thin `get`/`post`/`put`/`del` helpers that send JSON and parse the response, `upload()` (multipart via `FormData`) and `getBytes()` (raw download), a per-process temporary `UPLOAD_DIR` (removed by `stopServer()`) with a 64 KiB `UPLOAD_MAX_BYTES`, a fixed test `ENCRYPTION_KEY`, `makeUser()` (creates through the model so the password is hashed, then logs in), and `makeFixtures()` (admin; an active Chapter record `group` with a `chapter`-role member and an unclaimed managed `writer`; two independent users `alice` and `bob`; a prison with two prisoners; a rule).
- Each test file is its own process, so each gets a fresh in-memory database. Files: `attachments`, `auth`, `authorization`, `directory`, `directory-fields`, `e2e`, `encryption`, `groups`, `letters`, `messaging`, `migrations`, `moderation`, `ratelimit`, `retention`, `sessions`, `public`, `search`, `users`, `writers` (HTTP-level), `errors` (pure unit tests of the error classes and `ErrorService`), and `bootstrap` (boots with `ADMIN_*` set; cannot use the helper).
- Seeded data is not used by the tests; fixtures are created explicitly, so tests never depend on seed ids.
- CI (`.github/workflows/test.yml`) runs `npm ci`, ESLint, and the suite on Node 22 and 24 for every pull request and push to `main`.

When adding a feature, add a test in the matching file; when fixing a bug, add the failing case first. Keep assertions on response shapes strict (status, `name`, `errors`), since clients code against them.

### Postman

`ABC-3.postman_collection.json` matches the current API. Collection-level bearer auth reads a `{{jwt}}` collection variable that the **Login (seeded admin)** request's test script fills in. `ABC-3.postman_collection_old.json` is historical.

### Branches

`api-documentation` carries the README and this guide. `bugfixes` was merged in #60. Older ticket-named branches (`ABS-nn-...`, `11-protect-the-necessary-routes`, ...) predate the 2026 work and are mostly superseded; check before reviving one.

## How to add a new resource

Using a hypothetical `Letter` resource (a printed, mailed artifact):

1. **Schema and migration.** Create `database/schemas/letter.schema.js` exporting a column object with validators under `validate`, and add `static letter = letterSchema` to `database/schemas/all.schema.js`. Then `npm run migrate:create -- --name create-letters.js` and write the `createTable` / `dropTable` pair; `npm test` will tell you if the model and the table disagree.
2. **Hooks (optional).** Create `database/hooks/letter.hooks.js` and register it in `database/hooks/all.hooks.js`. Models read `Hooks.<name> || null`.
3. **Model.** Create `database/models/letter.model.js` with `static init`, `static associate`, and the static CRUD helpers. Declare associations with `foreignKey` set to the column your schema defines, an explicit `as`, and an explicit `onDelete`. Add it to `database/models/all.model.js` and to the `switch` in `models.service.js`.
4. **Wire it up.** In `database/sql-database.js`, add `export const Letter = Models.Letter.init(sequelize, Sequelize);` and `Letter.associate(Models);`.
5. **Seeds.** Add `database/seeds/letterSeed.json` and `letter.seed.js`, and insert `createLetterSeed` into the array in `all.seeds.js` after everything it depends on. Add the name to the summary list there.
6. **Paths and messages.** In `routes/constants.js` add a `letter` key to **both** `endpoints` and `messages`. `messages.letter` must have `get.many`, `get.one`, `post.create`, `put.update`, and `delete.remove`, each with `success.condition.par` and `error.condition.par`. Any extra handler (like `addRule`) needs a key with exactly the method's name. Add `letter: letterMsg` and `letter: letterEnd` to the two destructuring exports at the bottom.
7. **Controller.** Create `routes/controllers/letter.controller.js` extending `RouteController`, call `super('letter')`, and **bind every handler** in the constructor. Use `this.#handleLimits` for lists, `this.requireFound` in `getOne`, and `this.requireAffected` in `update` and `remove`. Throw `HttpError` / `NotFoundError` / `ValidationError` for client faults.
8. **Routes.** Copy `routes/chapter/chapter.js` to `routes/letter/letter.js`, swap the imports and constants, keep `passport.authenticate('UsrJStrat', ...)` on every route, and add `AuthzService.requireRole(...)` on writes. If a `user` should only see their own letters, add ownership checks in the controller following the chat controller.
9. **Mount.** In `index.js`, import the route class and `app.use('/letter', LetterRoutes.Router)` before the 404 catch-all.
10. **Document.** Add the resource to the README's endpoint reference and to the Postman collection.

## Conventions and gotchas

- **ES modules everywhere.** `package.json` has `"type": "module"`. Use `import`/`export` and include file extensions.
- **Tabs, single quotes, width 100.** Prettier enforces it on commit.
- **Bind your handlers.** The response formatter finds the running handler by looking for a bound function that is an own property of the controller. Unbound methods or arrow-function class fields will not be found.
- **Keys must match names.** `super('<name>')` must equal the key in `routes/constants.js`; handler names must match the keys under `messages.<name>.<method>` (with `getOne` / `getMany` mapping to `one` / `many`).
- **Query strings for GET, JSON body for everything else,** including the `id` on DELETE. Never read `req.params`; there are no path parameters.
- **Throw typed errors for client faults.** `NotFoundError` for missing things, `HttpError(400, ...)` for malformed requests, `ValidationError([...])` for input rules. A plain `Error` is a 500 and will be logged as a server fault.
- **Never select the password hash** except through `User.getUserWithPassword`. Never put an instance that might carry it into a response without `#stripPassword`.
- **Ownership filters are spread last.** When adding a where-clause parameter to a model reader for authorization, merge it after the caller-supplied filters.
- **Models return Sequelize instances.** `res.json` serializes them through `toJSON`. Update helpers return `[affectedCount]`.
- **`full` is a string.** Compare `full === 'true'`.
- **Errors are returned, not thrown, by `modelInstanceExists`.** Check `instanceof Error` and throw yourself.
- **Schema changes are migrations.** Model, schema file, and migration change together; `npm test` checks they agree.
- **The database file is relative to cwd.** Start the server from the repo root.

- **A request body is never spread into a write.** Where a write takes its values from a request (`createX` / `updateX` in the models, which the controllers and approved submissions call), they pass through `pick()` (`database/pick.js`) with that model's list of fields (`PRISONER_FIELDS`, `UPDATABLE` in the user model, `EDITABLE` in the message model). A column that is not on the list cannot be reached by naming it; when you add a column clients may set, add it to the list. `updateById` keeps a 404 truthful when nothing on the list was sent. Writes whose values the server chooses itself (a status change, the recovery challenge, a claim, key set-up, sweeps) call Sequelize directly with a literal object, and that is fine: the rule is about where the values come from, not a wrapper every write must use.
- **One id is one value.** `singleIds` (`routes/services/request-shape.services.js`, mounted in `app.js`) refuses a list where an id belongs, because Sequelize would turn it into `IN (...)` behind a permission check that looked at one row. A new id-carrying parameter name goes on its list. A missing id surfaces as Sequelize's "WHERE parameter has invalid undefined value", which `ValidationError.messagesFrom` renders as a `400`.
- **Seeing is not owning.** `threadScope().allows*` answers "may read". Changing or deleting a thread or a letter also needs `scope.allowsUser(record.user)` (`#loadOwned` in the chat controller, `#requireOwnSide` in the message controller): a relay group reads the threads it mails and owns none of them. The rules that depend on a letter's status are part of the delete itself (`Message.deleteMessage(id, { openOnly })`, `Chat.deleteChat(id, { openOnly })`), not a look beforehand: a relay group can mark a letter printed between the two.
- **Staff through the group.** `AuthzService.isStaff` (and so `publishedOnly`) is true for a chapter account only when `req.user.groupActive` is, which the JWT strategy sets from the group's `accountStatus` on every request (`noteGroupStanding`). Never test the role alone for a staff right.
- **Embeds need their own attribute lists.** An `include` does not inherit what a controller strips from the top-level record. Use `Prisoner.publicAttributes(publishedOnly)`, `Prison.publicAttributes`, and an explicit list for users (`WRITER_EMBED` in the chat model).
- **Lookups keyed by user input use `Object.hasOwn`.** `sorts[sort]` with `sort=constructor` finds `Object.prototype.constructor`.

## History: what was fixed in 2026

The codebase was idle from June 2025 to September 2026. The first thing the revival found was that it could not return a single response. Everything below landed in pull request #60 (`bugfixes`, 15 commits) and #61, one concern per commit; each commit message records what was verified.

| Area       | Problem                                                                                                                                | Commit    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Blocker    | `this.hasOwn` (an eslint autofix) crashed every response                                                                               | `c2c1b8f` |
| Security   | JWT callback never awaited the user lookup; any signed token was accepted, `req.user` was a Promise                                    | `9ea8bdd` |
| Security   | Public registration accepted `role: admin`; no role checks anywhere; banned users fully authorized                                     | `9a8f43e` |
| Security   | Any user could read, edit, delete, or spoof anyone's chats and messages                                                                | `41d934e` |
| Security   | `PUT /auth/user` stored passwords in plain text                                                                                        | `d0d04b5` |
| Security   | Password hashes leaked through `user_details` includes and the update response                                                         | #61       |
| Bootstrap  | No way to obtain an admin once registration was locked down                                                                            | `1085a0c` |
| Broken     | Message list filters shifted their arguments; get-one called a nonexistent method                                                      | `a7c54e9` |
| Broken     | Associations pointed at phantom `...Id` columns, so `full=true` returned nulls; rule/prison aliases wrong; rules could not be attached | `4c71da4` |
| Broken     | User list returned empty objects; role filter crashed                                                                                  | `5b35385` |
| Broken     | Prisoners-by-prison swapped arguments; chat update targeted a nonexistent column                                                       | `1b2eff2` |
| Validation | Pagination unvalidated; prisoner status and user string lengths not enforced; message hook masked validation messages                  | `20520f9` |
| Contract   | Everything was 400 with a stack trace; no 201, no 404, no 500; HTML for unknown routes                                                 | `d516d26` |
| Hygiene    | Every boot wiped the database; SQL logging on; CORS hardcoded                                                                          | `fbc7fef` |
| Hygiene    | Dead files, per-route express apps, unrouted paths, never-read path segments, unused column                                            | `b128414` |
| Tooling    | Lockfile drift, Husky 8, npm 11 script gating, Node 26 incompatibilities, stale Postman collection                                     | `4a1e811` |

## Open items

Known gaps, roughly in the order they are worth tackling:

1. **Chat uniqueness.** `POST /chat/chat` can create duplicate user/prisoner pairs; the message hook always picks the oldest. A unique index on `(user, prisoner)` plus `findOrCreate` in the controller would close it.
2. **Mail rule follow-ups.** The letter form does not yet check a letter against the facility's rules server-side (clients do).
3. **A print batch as a record** ("what did we send on the 14th?"): proposal 5 left it for the groups to ask for. `PUT /messaging/status/batch` moves letters together and keeps no record of the batch beyond its audit entry.
4. **Typos in `info` strings** ("retireved", "Succeessfully") and the `updatedRows` key on the attach-relay response. Fix together with a front-end release, since clients may match on them.
5. **Token refresh.** Logout and revocation exist; there is still no refresh, so a week-long token simply expires and the client logs in again.
6. **Key rotation and e2e follow-ups.** In e2e mode: rotation material is returned in one response (page it if a group ever holds tens of thousands of letters), an admin path for a group that has lost every key holder (its old letters are unrecoverable; it would need its key cleared to start again), and group-only envelopes for anonymous-writer letters whose account has no keys.
7. **Moderation follow-ups.** Anonymous corrections from the public footer (a submission with no `submittedBy`, rate-limited), a second vouch or a limit on vouches per group if the network wants one, site settings, and email or in-app notification of decisions to submitters.
8. **Storage.** Attachment files live on local disk; object storage would be a change inside `services/files.js` only. Directory writes to facilities and prisoners are still open to every active chapter account (groups may only edit their own group record).
9. **Request logging.** None. Rate limiting covers the unauthenticated endpoints only and lives in one process' memory; authenticated write endpoints are not limited, and a second API instance would need a shared store.
10. **Positional model signatures.** Replace `(…, full, limit, offset)` with an options object to prevent the argument-order bugs this codebase has had before.
11. **Leftovers.** `Utilities.objectToStringButSafe` is unused; `ABC-3.postman_collection_old.json` can go once nobody needs it for reference.
