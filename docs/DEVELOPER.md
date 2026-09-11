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
- **Prisons** and their **Rules** (mail restrictions).
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

1. `index.js` middleware runs in order: `cors` (origins from `CORS_ORIGIN`), `bodyParser.json`, `bodyParser.urlencoded`, `passport.initialize`.
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
│   ├── LoudError.js                  Error subclass that prints a colored banner; used by the controller interface check.
│   └── Utilities.js                  isUndefined, resolveSequential (used by seeds), objectToStringButSafe (unused).
├── routes/
│   ├── constants.js                  endpoints{} (paths) and messages{} (strings) for every resource.
│   ├── services/
│   │   ├── auth.services.js          LocalStrategy, JwtStrategy, JWT creation; registers both strategies with passport.
│   │   ├── authz.services.js         requireRole, requireSelfOrAdmin, optionalAuthenticate, ownOnly, ownsRecord, forbidden(), unauthorized().
│   │   └── error.services.js         ErrorService.handler, the final error middleware.
│   ├── controllers/
│   │   ├── route.controller.js       Base class: pagination, requireFound/requireAffected, handleSuccess, handleErr.
│   │   ├── user.controller.js        Plus login, registration role policy, password stripping.
│   │   ├── prison.controller.js      Plus addRule.
│   │   ├── prisoner.controller.js
│   │   ├── rule.controller.js
│   │   ├── chat.controller.js        Ownership checks for the user role.
│   │   ├── message.controller.js     Ownership checks for the user role.
│   │   └── chapter.controller.js
│   ├── user/user.js                  Route classes. All seven follow the same template.
│   ├── prison/prison.js
│   ├── prisoner/prisoner.js
│   ├── rule/rule.js
│   ├── chat/chat.js
│   ├── message/message.js
│   └── chapter/chapter.js
└── database/
    ├── connection.js                 The Sequelize instance; no models, so the CLI can import it alone.
    ├── migrate.js                    createMigrator(), runMigrations() (reset + adoption logic), CLI entry point.
    ├── migrations/                   <timestamp>.<name>.js files exporting up/down; applied ones recorded in SequelizeMeta.
    ├── sql-database.js               Init + associate models; runMigrations; seed; ensureAdmin; exports `ready`.
    ├── bootstrap-admin.js            ensureAdmin(): creates the ADMIN_* account when it does not exist.
    ├── models/
    │   ├── all.model.js              Re-exports every model; has a comment explaining Sequelize associations.
    │   ├── models.service.js         modelInstanceExists(modelName, pk): instance or NotFoundError.
    │   ├── user.model.js             defaultScope hides the password; getUserWithPassword for login.
    │   ├── prison.model.js           addRule.
    │   ├── prisoner.model.js
    │   ├── rule.model.js
    │   ├── chat.model.js             Readers accept an extra where-clause for ownership filtering.
    │   ├── message.model.js          Same; updateMessage re-resolves the chat.
    │   └── chapter.model.js
    ├── schemas/
    │   ├── all.schema.js             Schemas class with one static per model.
    │   └── <model>.schema.js         Plain objects of Sequelize column definitions.
    ├── hooks/
    │   ├── all.hooks.js              Hooks class; only user and message have hooks.
    │   ├── user.hooks.js             beforeCreate and beforeUpdate: bcrypt-hash the password.
    │   └── message.hooks.js          beforeValidate: find-or-create the chat for user + prisoner (create only).
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

| Export          | Env var          | Default                 | Used by                                                               |
| --------------- | ---------------- | ----------------------- | --------------------------------------------------------------------- |
| `secretOrKey`   | `JWT_SECRET`     | none                    | `auth.services.js` to sign and verify tokens. Login fails without it. |
| `sysPort`       | `PORT`           | none                    | `index.js` `app.listen`. Unset means a random free port.              |
| `adminUsername` | `ADMIN_USERNAME` | none                    | `bootstrap-admin.js`                                                  |
| `adminPassword` | `ADMIN_PASSWORD` | none                    | `bootstrap-admin.js`                                                  |
| `adminEmail`    | `ADMIN_EMAIL`    | none                    | `bootstrap-admin.js`                                                  |
| `corsOrigins`   | `CORS_ORIGIN`    | `http://localhost:3001` | `index.js`; comma-separated, trimmed, empties dropped.                |
| `dbReset`       | `DB_RESET`       | `false`                 | `sql-database.js`: drop all tables and replay every migration.        |
| `dbSeed`        | `DB_SEED`        | `true`                  | `sql-database.js`: whether to run `createSeeds()`.                    |
| `dbLogging`     | `DB_LOGGING`     | `false`                 | `sql-database.js`: Sequelize `logging`.                               |
| `dbStorage`     | `DB_STORAGE`     | `database.sqlite`       | `sql-database.js`: SQLite file, or `:memory:`.                        |
| `quietBoot`     | `NODE_ENV=test`  | `false`                 | Suppresses boot-time console output under the test runner.            |

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
4. `createApp()` mounts `/health`, the routers, the JSON 404 catch-all, and `ErrorService.handler`; `index.js` then calls `app.listen(PORT)` and logs `Ready to serve requests.` when `ready` resolves.

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
- `DB_RESET=true` is the escape hatch in development; it drops everything and replays the history.

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
	put: { update: '/prison', addRule: '/rule' },
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
		// get many, get one (authenticate only), put update, put addRule, delete remove (authenticate + role gate)
	}
}
export default PrisonRoutes;
```

- The class is never instantiated. The static initialization block runs at import time and fills the static `Router`, which `index.js` mounts.
- Every route except `POST /auth/user` and `POST /auth/login` starts with `passport.authenticate('UsrJStrat', { session: false, failWithError: true })`. `failWithError` routes auth failures into the JSON error handler.
- Write routes on prisons, prisoners, rules, and chapters add `AuthzService.requireRole(ADMIN, CHAPTER)`. User routes use `requireRole(ADMIN)` for the list and `requireSelfOrAdmin` for get, update, and delete. Registration uses `optionalAuthenticate` so an admin token can unlock other roles while anonymous callers still get through. Chat and message routes have no route-level gate; ownership is enforced inside their controllers.
- The controller method passed as the final handler must be a bound function whose `name` is `bound <method>`; see the next section.
- Strategies are registered once at the bottom of `auth.services.js` (`auth.services.js:66`), not per route file.

### Mounts

From `index.js`:

| Prefix       | Router           |
| ------------ | ---------------- |
| `/auth`      | `UserRoutes`     |
| `/prison`    | `PrisonRoutes`   |
| `/prisoner`  | `PrisonerRoutes` |
| `/rule`      | `RuleRoutes`     |
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

From the chosen layer the base class derives `callerName` (`getOne`, `getMany`, `create`, `update`, `remove`, `login`, `addRule`), maps `getOne` / `getMany` to `one` / `many`, reads the HTTP method, and looks up `messages[controllerName][method][msgRef]`. Three things must therefore line up: the controller name passed to `super()`, the method names on the class (all bound), and the key structure in `routes/constants.js`.

`handleSuccess` sends status 201 when `msgRef === 'create'`, 200 otherwise. `handleErr`:

1. If `ValidationError.messagesFrom(err)` returns messages (our `ValidationError` or Sequelize's), respond `400 { success: false, errors }`.
2. Otherwise `status = HttpError.statusOf(err)`: an explicit `status` or `statusCode` wins; `SequelizeUniqueConstraintError` and `SequelizeForeignKeyConstraintError` are 400; everything else is 500.
3. Look up `info` for the endpoint and condition (falling back to `par`), and send `{ success: false, name, info, status }` plus `error: err.message` for 4xx. For 5xx the error is logged with `console.error`, and `error` and `stack` are included only when `NODE_ENV=development`.

### Per-resource controllers

Each method destructures `req.query` or `req.body`, calls one static model method inside `try`, and delegates to `#handleSuccess` / `#handleErr`. The private fields `#handleSuccess` and `#handleErr` are aliases for the inherited methods. Things that differ:

- **User** (`user.controller.js`): `create` (`:149`) accepts `next`, lower-cases `role` (default `user`), and returns `AuthzService.forbidden(...)` through `next` when a non-admin asks for anything else. `update` refuses `role` from non-admins the same way and never echoes `password`. `#stripPassword` (`:38`) converts an instance with `toJSON` and deletes `password`; it is applied to list, single, create, and login responses as belt-and-braces on top of the model's default scope. `getMany` with `role` validates it against the schema's list and returns `200 []` for no matches. `login` reads `req.authInfo.token` set by the local strategy.
- **Prison**: `addRule` is bound and calls `Prison.addRule`, which returns the prison with prisoners and rules embedded.
- **Prisoner / Rule**: `getMany` branches on a `prison` query parameter.
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
2. Refuses users whose role is `banned` (`auth.services.js:27`).
3. `bcrypt.compare(password, user.password)`.
4. On match, builds a token with `#createJWT(user)` and calls `done(null, user, { token })`. The third argument becomes `req.authInfo`, which the route enables with `authInfo: true` and the controller reads.
5. Otherwise `done(null, false)`, which with `failWithError` becomes a 401.

Missing `username` or `password` never reaches the verify function; passport-local fails with a 400 that renders as `{ name: 'AuthenticationError', info: 'Bad Request', status: 400 }`.

### Token creation

`#createJWT` (`auth.services.js:13`) signs `{ id: user.id, expiry }` with `expiresIn: '1w'` (HS256). The custom `expiry` claim in milliseconds duplicates the standard `exp`; only `exp` is checked. The login response returns `{ token, expires }`.

### Token verification (`JwtStrategy`)

`authService.authorize` (`auth.services.js:46`). `passport-jwt` verifies the signature and expiry first. The callback is `async`: it rejects a payload without an `id` claim, awaits `User.getUser({ id })`, and rejects a missing or banned user (`auth.services.js:52`). On success `req.user` is the User instance loaded through the default scope, so it never carries the password hash. Lookup errors are passed to passport as errors rather than escaping.

Consequences: a deleted user's tokens stop working immediately; banning a user revokes their existing tokens; there is still no logout or refresh, and a compromised token is valid until it expires.

## Authorization internals

`routes/services/authz.services.js` is a class of static helpers used by route files and controllers:

| Member                     | Line   | What it does                                                                                                                                  |
| -------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN`, `CHAPTER`, `USER` |        | Role name constants.                                                                                                                          |
| `forbidden(message)`       |        | Builds an `Error` with `name: 'AuthorizationError'`, `status: 403`.                                                                           |
| `unauthorized(message)`    |        | Same with `AuthenticationError` / 401.                                                                                                        |
| `hasRole(req, ...roles)`   |        | Does `req.user.role` match one of the roles?                                                                                                  |
| `isAdmin(req)`             |        | Shorthand.                                                                                                                                    |
| `ownOnly(req)`             | `:67`  | True for the plain `user` role: the caller is confined to records they own.                                                                   |
| `ownsRecord(req, record)`  | `:78`  | Compares `record.user` to `req.user.id` as strings.                                                                                           |
| `targetsSelf(req)`         |        | Does the request's `id` / `email` / `username` (query for GET, body otherwise, same precedence as the user controller) match the caller?      |
| `requireRole(...roles)`    | `:118` | Middleware: 403 unless the caller holds one of the roles.                                                                                     |
| `requireSelfOrAdmin`       | `:130` | Middleware: allow admins, or any caller whose own record is the target.                                                                       |
| `optionalAuthenticate`     | `:142` | Middleware: if an `Authorization` header is present, verify it with the JWT strategy and set `req.user`; a bad token is a 401, not anonymous. |
| `isStaff(req)`             |        | Admin or chapter.                                                                                                                             |
| `publishedOnly(req)`       |        | True for anonymous callers and the `user` role: directory reads are limited to published records.                                             |

The policy, as implemented:

- Registration is public and always yields `role: user`; other roles need an admin token.
- Banned users are refused at login and at token verification, so `hasRole` never sees them.
- User management is admin-only, except that anyone may read, update, or delete their own record and non-admins may not change `role`.
- Reads of prisons, prisoners, rules, and chapters need no token (`optionalAuthenticate`). Anonymous callers and the `user` role see published records only; staff see everything and may filter by `recordStatus`. `AuthzService.publishedOnly(req)` decides, and `readOptions(req, config)` in `routes/controllers/directory.helpers.js` turns it, plus `q`, `sort`, `recordStatus`, and per-resource exact-match filters, into `{ publishedOnly, where, order }` for the model readers. Each directory controller declares its `READ_CONFIG` (search fields, sort orders, allowed filters) at the top of the file; add to that object to expose a new filter. Writes need `admin` or `chapter`.
- Chats and messages: `user` sees only their own; `admin` and `chapter` see everything. Enforced in the controllers because it depends on the record, not just the route.

To change the policy, edit the route files (which roles guard which routes) and the two controllers (ownership). `requireRole` is deliberately dumb so that the policy stays visible in the route definitions.

## Data layer

### Sequelize setup

`database/sql-database.js` builds everything and exports the Sequelize instance, each initialized model, and `ready`. Models are initialized (Chat, Message, Prison, Prisoner, Rule, User, Chapter) and then associated; `associate` needs all classes to exist, which they do by then.

Tables: `User` (explicit `tableName`), `Prisons`, `Prisoners`, `Rules`, `Chats`, `Messages`, `Chapters`, and the join table `RulePassthrough`. Every table gets `id`, `createdAt`, and `updatedAt`. SQLite enforces the foreign keys because Sequelize turns `PRAGMA foreign_keys` on for every connection.

### Schemas

`database/schemas/<model>.schema.js` files export plain objects passed to `Model.init`:

| Model    | Columns (beyond id and timestamps)                                                                                           | Validation                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| User     | `name`, `username` (unique, not null), `password` (not null), `email` (unique, not null), `bio` TEXT, `role` (not null)      | `username` len 3-16, `name` len 3-32, `bio` len 12-2400, `password` len 7-255, `email` isEmail, `role` in admin/user/chapter/banned. |
| Prison   | `prisonName` (not null), `address` JSON (not null), `recordStatus` (not null, default published)                             | `recordStatus` in draft/pending/published                                                                                            |
| Prisoner | `birthName`, `chosenName`, `prison` INT (FK), `inmateID`, `releaseDate` DATE, `bio`, `status`, `recordStatus`                | `status` in pretrial/incarcerated/free; `recordStatus` in draft/pending/published                                                    |
| Rule     | `title`, `description`                                                                                                       | none                                                                                                                                 |
| Chat     | `user` INT (FK), `prisoner` INT (FK), explicit `id`                                                                          | none                                                                                                                                 |
| Message  | `chat` INT (FK, not null), `messageText`, `sender` (not null), `prisoner` INT (FK, not null), `user` INT (FK, not null)      | `chat`/`prisoner`/`user` isInt + notNull; `sender` in user/prisoner                                                                  |
| Chapter  | `name` (not null), `location` JSON (not null), `prisoners` JSON, `lettersSent` STRING, `averageTimeDays` INT, `recordStatus` | `recordStatus` in draft/pending/published                                                                                            |

The foreign-key columns are declared as plain integers in the schemas; the `references` and `ON DELETE` clauses come from the associations below. `recordStatus` is defined once in `database/record-status.js` and spread into the three schemas.

### Associations

Declared in each model's `associate(models)`. Every pair uses the column the schema already has, with `onDelete: 'RESTRICT', onUpdate: 'CASCADE'`:

| Declaration                                                                                                         | Column                            |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `Chat.belongsTo(User, { as: 'user_details', foreignKey: 'user' })`                                                  | `Chats.user`                      |
| `Chat.belongsTo(Prisoner, { as: 'prisoner_details', foreignKey: 'prisoner' })`                                      | `Chats.prisoner`                  |
| `Chat.hasMany(Message, { as: 'messages', foreignKey: 'chat' })`                                                     | `Messages.chat`                   |
| `Message.belongsTo(Chat, { as: 'chat_details', foreignKey: 'chat' })`                                               | `Messages.chat`                   |
| `Message.belongsTo(User, { as: 'user_details', foreignKey: 'user' })`                                               | `Messages.user`                   |
| `Message.belongsTo(Prisoner, { as: 'prisoner_details', foreignKey: 'prisoner' })`                                   | `Messages.prisoner`               |
| `User.hasMany(Chat, { as: 'chats', foreignKey: 'user' })`                                                           | `Chats.user`                      |
| `User.hasMany(Message, { as: 'messages', foreignKey: 'user' })`                                                     | `Messages.user`                   |
| `Prisoner.belongsTo(Prison, { as: 'prison_details', foreignKey: 'prison' })`                                        | `Prisoners.prison`                |
| `Prisoner.hasMany(Chat, { as: 'chats', foreignKey: 'prisoner' })`                                                   | `Chats.prisoner`                  |
| `Prisoner.hasMany(Message, { as: 'messages', foreignKey: 'prisoner' })`                                             | `Messages.prisoner`               |
| `Prison.hasMany(Prisoner, { as: 'prisoners', foreignKey: 'prison' })`                                               | `Prisoners.prison`                |
| `Prison.belongsToMany(Rule, { as: 'rules', through: 'RulePassthrough', foreignKey: 'prison', otherKey: 'rule' })`   | `RulePassthrough.prison`, `.rule` |
| `Rule.belongsToMany(Prison, { as: 'prisons', through: 'RulePassthrough', foreignKey: 'rule', otherKey: 'prison' })` | same                              |
| `Chapter.associate()`                                                                                               | nothing yet                       |

The join table's own foreign keys cascade, so deleting a rule or prison removes its links. `RESTRICT` everywhere else was a deliberate choice: letters should never disappear as a side effect of deleting an account or a facility. Switch an association to `SET NULL` or `CASCADE` only after deciding what the product wants.

When you add an `include`, the `as` must match these aliases exactly; Sequelize throws an `EagerLoadingError` otherwise.

### User scopes

`User.init` sets `defaultScope: { attributes: { exclude: ['password'] } }` and a `withPassword` scope. Every `User.findOne` / `findAll` and every include of User from another model therefore omits the hash without the caller doing anything. `User.getUserWithPassword(where)` uses the scope explicitly and exists for the local login strategy only. If you write new code that needs the hash, use that method, never `User.unscoped()`.

`User.updateUser` runs with `individualHooks: true` (so the `beforeUpdate` hook can hash a changed password) and returns only `[count]`, because with individual hooks Sequelize also hands back the affected instances.

### Model classes

Each `database/models/<model>.model.js` exports a class extending Sequelize's `Model` with `static init`, `static associate`, and static CRUD helpers. Naming is not uniform across models (`get` vs `read`, `ByID` vs `ById`); when adding methods, follow whatever the file already does.

Worth knowing:

- Chat and Message list readers accept a trailing `extraWhere = {}` that is spread **last** into the where-clause. The controllers use it for the ownership filter, and spreading it last guarantees a query parameter cannot override it.
- `Chat.getChatByID`, `Message.getMessageByID` are `findByPk` wrappers used for ownership checks and single reads.
- `Chat.readChatById` uses `findOne` and returns an object, like `readChatByUserAndPrisoner`.
- `Message.updateMessage` (`message.model.js:139`) re-resolves the chat when `user` or `prisoner` changes, merging with the stored row so changing only one of them still lands in the right chat. It has to do this itself because Sequelize's static `update` discards attribute changes made by `beforeValidate` hooks.
- `Prison.addRule(ruleId, prisonId)` (`prison.model.js:110`) loads both, throws `NotFoundError` for a missing one, calls the `addRule` mixin (idempotent), and returns the prison with its rules loaded.
- `models.service.js` provides `modelInstanceExists(modelName, pk)`, which returns either the instance or a `NotFoundError` (returned, not thrown; callers check `instanceof Error` and throw). It knows all seven models.

### Hooks

Registered through `database/hooks/all.hooks.js`:

- **User `beforeCreate`** and **`beforeUpdate`**: replace `password` with `bcrypt.hash(password, 10)`. The update hook only runs when `record.changed('password')`, so unrelated updates do not re-hash the hash. It fires for `User.updateUser` because that call passes `individualHooks: true`.
- **Message `beforeValidate`** (`message.hooks.js:15`): calls `Chat.findOrCreateChat(user, prisoner)` and writes the chat id onto the instance. Skipped when either id is missing so the schema's `notNull` messages surface. Only effective on create; see `updateMessage` above.

### Deletion semantics

There is no `paranoid` mode; every `destroy` is a hard delete, and the foreign keys decide whether it is allowed. `Chat.deleteChat` deletes the chat's messages first, then the chat, which is why it succeeds where a raw delete would be refused.

## Seeds

`database/seeds/all.seeds.js` runs seed functions sequentially in dependency order: User, Prison, Prisoner, Rule, Chat, Message, Chapter. Each checks `count === 0` before inserting, so seeding is idempotent and safe to leave enabled. After running it logs one line, for example `Seed data: users: 41 seeded, prisons: 52 seeded, ...` or `users: already populated, ...`.

Each `<model>.seed.js` reads its sibling `<model>Seed.json` (`{ "seeds": [ ... ] }`) and calls the model's `createBulkXs`, which is `bulkCreate` with `individualHooks: true` (so user passwords get hashed) and `ignoreDuplicates: true`. Messages use `validate: true` instead; their `chat` is resolved by the message hook at insert time.

Row counts: 41 users, 52 prisons, 40 prisoners, 44 rules, 40 chats, 40 messages, 1 chapter. Prisoner N is in prison N, chat N pairs user id N with prisoner N. Seeded rules are not attached to any prison.

User ids do not come out in seed-file order; in one run `admin` received id 3. Do not hardcode seeded ids in tests.

## Pagination and the `full` flag

`handleLimits` in the base controller validates `page` and `page_size` and turns them into Sequelize `limit` and `offset`. Every list controller calls it; there are no private copies of the arithmetic any more.

List readers return `findAndCountAll` results, `{ rows, count }`, and controllers send them through `RouteController.handlePage(res, result, limits)`, which puts `rows` in `data` and adds `total`, `page`, and `page_size` to the envelope. Counts use `distinct: true` wherever a has-many include could multiply rows.

The directory models (Prison, Prisoner, Rule, Chapter) take an options object: `getAllPrisons({ full, limit, offset, publishedOnly, where })`, `getPrisonByID(id, { full, publishedOnly })`, and so on. `publishedOnly` adds `recordStatus = 'published'` to the query and to the embedded prisoners/prisons, and hides chats from prisoner embeds. Chat, Message, and User readers are still positional `(…, limit, offset)`; convert them to the same style when you next touch them.

Chat list readers add a `lastMessageAt` attribute (a correlated `MAX(createdAt)` subquery) and order by it descending with empty chats last; the literal is repeated in `ORDER BY` rather than referenced by alias so it survives the subquery Sequelize wraps around limited queries with includes. `Chat.attachLastMessages(rows)` then fetches the newest message per chat in one query and sets a `last_message` summary on each row. Text search uses `Op.like` with `%term%`; SQLite's `LIKE` is case-insensitive for ASCII, and `%`/`_` in the term act as wildcards.

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
- `engines.node` is `>=18` (Express 5, static class blocks, `Object.hasOwn`).
- On Apple Silicon, make sure `node -p process.arch` prints `arm64`; an Intel Node under Rosetta will fail to load arm64 binaries and vice versa. After switching, `rm -rf node_modules && npm ci`.

### Tests

`npm test` runs `node --test "test/**/*.test.js"` (a glob, because Node 22 and 24 do not expand a bare directory argument). There are no test dependencies: the built-in runner, `node:assert`, and global `fetch`.

- `test/helpers.js` pins the environment (`DB_STORAGE=:memory:`, `DB_SEED=false`, a test JWT secret, blank `ADMIN_*`) **before** importing `app.js`, because `constants.js` reads `process.env` at import time. It exports `startServer()` (awaits `ready`, listens on an ephemeral port), `stopServer()`, thin `get`/`post`/`put`/`del` helpers that send JSON and parse the response, `makeUser()` (creates through the model so the password is hashed, then logs in), and `makeFixtures()` (admin, chapter, two users, a prison with two prisoners, a rule).
- Each test file is its own process, so each gets a fresh in-memory database. Files: `auth`, `authorization`, `directory`, `messaging`, `users` (HTTP-level), `errors` (pure unit tests of the error classes and `ErrorService`), and `bootstrap` (boots with `ADMIN_*` set; cannot use the helper).
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
2. **Detach a rule from a prison.** There is `addRule` but no `removeRule`.
3. **Message `full=true`** is accepted and ignored; an include for `chat_details` / `user_details` / `prisoner_details` is a few lines now that the associations exist.
4. **Typos in `info` strings** ("retireved", "Succeessfully") and the `updatedRows` key on the attach-rule response. Fix together with a front-end release, since clients may match on them.
5. **Token lifecycle.** No refresh, no logout, no revocation short of banning; a week-long token is generous.
6. **Chapter-scoped data.** Chapter accounts currently see and edit everything; if chapters should only handle their own region's letters, that needs a relation between Chapter and users or prisons and a filter like the user ownership one.
7. **Rate limiting and request logging.** None.
8. **`RulePassthrough` in responses.** The join-row object rides along inside embedded rules and prisons; hide it with `through: { attributes: [] }` on the includes if clients find it noisy.
9. **Positional model signatures.** Replace `(…, full, limit, offset)` with an options object to prevent the argument-order bugs this codebase has had before.
10. **Leftovers.** `Utilities.objectToStringButSafe` is unused; `ABC-3.postman_collection_old.json` can go once nobody needs it for reference.
