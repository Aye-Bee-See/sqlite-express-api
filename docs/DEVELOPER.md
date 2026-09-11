# Aye Bee See API: Developer Guide

This guide is for people changing the code in this repository. It explains how the service is put together, how a request travels through it, how the data layer works, what tooling is in place, and, in detail, what is currently broken and why. If you only want to call the API, read the [README](../README.md) instead.

Everything here describes `main` as of September 2026 (last commit June 2025). Statements about runtime behavior were verified by running the server locally with the single-line crash in `route.controller.js` patched; see [Bug catalog](#bug-catalog) item B1.

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
- [Data layer](#data-layer)
- [Seeds](#seeds)
- [Pagination and the `full` flag](#pagination-and-the-full-flag)
- [Tooling](#tooling)
- [How to add a new resource](#how-to-add-a-new-resource)
- [Conventions and gotchas](#conventions-and-gotchas)
- [Bug catalog](#bug-catalog)
- [Suggested order of work](#suggested-order-of-work)

## What this service is

Aye Bee See lets people send physical letters to incarcerated people from a phone or browser. The user writes a message; a partner non-profit chapter prints it and mails it; replies are transcribed back into the same thread. This repository is the API that the front end (expected at `http://localhost:3001` in development) talks to. It owns:

- **Users** (outside correspondents, admins, chapters) and login.
- **Prisons** and their **Rules** (mail restrictions).
- **Prisoners** and which prison each is in.
- **Chats** (one user, one prisoner) and the **Messages** inside them.
- **Chapters** of the partner organization.

It is a single Node.js process using Express 5, Passport (local + JWT strategies), Sequelize 6, and SQLite. There is no queue, no cache, and no background job. The mailing side (printing, postage, tracking) is not represented in this codebase yet; the nearest thing is the `lettersSent` and `averageTimeDays` columns on Chapter.

## Quick start for developers

```bash
git clone https://github.com/Aye-Bee-See/sqlite-express-api.git
cd sqlite-express-api
npm install
printf 'JWT_SECRET=dev-secret-change-me\nPORT=3000\n' > .env
npx nodemon index.js
```

Notes:

- `npm ci` fails because `package-lock.json` is out of date relative to `package.json` (eslint, husky, and lint-staged ranges drifted). `npm install` works but will rewrite the lockfile; decide whether to commit that.
- `bcrypt` and `sqlite3` are native modules. On a fresh machine npm downloads prebuilt binaries; if that fails you need a C++ toolchain.
- The server was verified on Node 24.20. The code uses static class blocks, private class members, and `Object.hasOwn`, so Node 16.11 or newer is the practical floor.
- `npm install` runs the `prepare` script, which runs `husky install` and creates `.husky/_`. That enables the pre-commit hook described under [Tooling](#tooling).
- To actually get a response from any endpoint you must first apply the fix in [B1](#b1-every-controller-response-throws).

There are no tests to run. `npm test` prints a placeholder string.

## Architecture overview

Layers, top to bottom:

```text
index.js                       Express app, global middleware, mounts one Router per resource
  routes/<resource>/<resource>.js   Route class: binds paths to passport + controller methods
    routes/controllers/<resource>.controller.js   Controller: reads req, calls model, formats response
      routes/controllers/route.controller.js         Base class: success/error formatting, pagination
    database/models/<resource>.model.js            Sequelize Model subclass with static CRUD helpers
      database/schemas/<resource>.schema.js          Column definitions
      database/hooks/<resource>.hooks.js             Lifecycle hooks (password hashing, chat lookup)
  database/sql-database.js         Creates the Sequelize instance, inits models, syncs, seeds
routes/constants.js             Every path string and every success/error message
routes/services/auth.services.js   Passport strategies and JWT creation
routes/services/error.services.js  Final Express error handler
```

The pattern is a conventional MVC-without-views: route → controller → model. Two design choices shape everything else and are worth understanding before you touch anything:

1. **All user-facing strings and paths live in one nested object** in `routes/constants.js`, keyed by resource, HTTP method, and operation. Controllers do not know their own messages; the base controller looks them up at response time by inspecting Express's route stack to discover which handler is running. This is clever and fragile; see [Controller layer](#controller-layer).
2. **Models are classes with static methods.** Nothing calls `new Prison()`. Controllers call `Prison.getPrisonByID(id, full)` and the model wraps Sequelize's `findOne` / `findAll` / `update` / `destroy`. Associations are declared in a static `associate(models)` method run once at boot.

### Request lifecycle

Here is what happens for `GET /prison/prison?id=1` with a valid bearer token:

1. `index.js` middleware runs in order: `cors` (origin `http://localhost:3001`), `bodyParser.json`, `bodyParser.urlencoded`, `passport.initialize`.
2. Express matches the `/prison` prefix and hands off to `PrisonRoutes.Router`.
3. Inside that router, the path template `/prison{/:id}` matches. The first handler is `passport.authenticate('UsrJStrat', { session: false, failWithError: true })`.
4. The JWT strategy in `auth.services.js` extracts the bearer token, verifies its signature and expiry against `JWT_SECRET`, and calls its verify callback. On success `req.user` is set (to a Promise, see [B2](#b2-jwt-verification-does-not-check-the-user-exists)) and the next handler runs. On failure, because of `failWithError`, an `AuthenticationError` is passed to `next(err)` and ends up in `ErrorService.handler`, which sends the 401 JSON.
5. The second handler is `controller.getOne`, which was bound to the controller instance in the constructor. It reads `id` and `full` from `req.query`, calls `Prison.getPrisonByID(id, fullBool)`, and passes the result to `this.#handleSuccess(res, prison)`.
6. `RouteController.handleSuccess` walks `res.req.route.stack`, finds the layer whose function name is `bound getOne`, strips the `bound ` prefix, maps `getOne` to the message key `one`, reads the HTTP method from the layer, and looks up `messages.prison.get.one.success.condition.par` in `routes/constants.js`. It then sends `{ data, info, success: true, status: 200, name: 'prison one' }`.
7. If the model throws, the controller's `catch` wraps non-Error values in an `Error` and calls `this.#handleErr(res, err)`, which does the same stack walk to find `messages.prison.get.one.error.condition.par` and sends a 400.

Nothing in that path touches `req.params`. See [Routing layer](#routing-layer).

## Repository map

```text
.
├── index.js                          Entry point. Builds the app, mounts routers, starts listening.
├── constants.js                      Loads .env and exports JWT_SECRET, PORT, REDIS_SECRET.
├── package.json                      ESM ("type": "module"), path aliases under "imports", scripts.
├── package-lock.json                 Out of sync with package.json (see Tooling).
├── eslint.config.js                  ESLint 9 flat config: JS, JSON, Markdown, CSS, Prettier.
├── .prettierrc.json                  Tabs, single quotes, width 100, no trailing commas.
├── .husky/pre-commit                 Runs lint-staged.
├── .gitignore                        node_modules, database.sqlite, jwt, .env
├── README.md                         API consumer documentation.
├── docs/DEVELOPER.md                 This file.
├── ABC-3.postman_collection.json     Postman collection, partly outdated.
├── ABC-3.postman_collection_old.json Older snapshot.
├── passport.cjs                      Empty file. Dead.
├── middleware/
│   └── ErrorHandler.js               An error middleware that is never registered. Dead.
├── services/
│   ├── LoudError.js                  Error subclass that prints a colored banner when constructed.
│   └── Utilities.js                  isUndefined, resolveSequential (used by seeds), objectToStringButSafe (unused).
├── routes/
│   ├── constants.js                  endpoints{} (paths) and messages{} (strings) for every resource.
│   ├── router.js                     Creates an express app that nothing uses. Dead.
│   ├── services/
│   │   ├── auth.services.js          LocalStrategy, JwtStrategy, JWT creation.
│   │   └── error.services.js         ErrorService.handler, the final error middleware.
│   ├── controllers/
│   │   ├── route.controller.js       Base class: interface check, handleLimits, handleSuccess, handleErr.
│   │   ├── user.controller.js        Plus login and password stripping.
│   │   ├── prison.controller.js      Plus addRule.
│   │   ├── prisoner.controller.js
│   │   ├── rule.controller.js
│   │   ├── chat.controller.js
│   │   ├── message.controller.js
│   │   └── chapter.controller.js
│   ├── user/user.js                  Route classes. All seven follow the same template.
│   ├── prison/prison.js
│   ├── prisoner/prisoner.js
│   ├── rule/rule.js
│   ├── chat/chat.js
│   ├── message/message.js
│   └── chapter/chapter.js
└── database/
    ├── sql-database.js               Sequelize instance; init + associate all models; sync({force:true}); seed.
    ├── models/
    │   ├── all.model.js              Re-exports every model; has a comment explaining Sequelize associations.
    │   ├── models.service.js         modelInstanceExists(modelName, pk) helper.
    │   ├── user.model.js             One class per model, each with static CRUD methods.
    │   ├── prison.model.js
    │   ├── prisoner.model.js
    │   ├── rule.model.js
    │   ├── chat.model.js
    │   ├── message.model.js
    │   └── chapter.model.js
    ├── schemas/
    │   ├── all.schema.js             Schemas class with one static per model.
    │   └── <model>.schema.js         Plain objects of Sequelize column definitions.
    ├── hooks/
    │   ├── all.hooks.js              Hooks class; only user and message have hooks.
    │   ├── user.hooks.js             beforeCreate: bcrypt-hash the password.
    │   └── message.hooks.js          beforeValidate: find-or-create the chat for user + prisoner.
    └── seeds/
        ├── all.seeds.js              Runs the seed functions in dependency order and prints a sample.
        ├── <model>.seed.js           Reads <model>Seed.json and bulk-creates if the table is empty.
        └── <model>Seed.json          Seed rows.
```

## Module path aliases

`package.json` defines Node subpath imports so files can import each other without relative paths. All start with `#`:

| Alias              | Resolves to              | Example                                                  |
| ------------------ | ------------------------ | -------------------------------------------------------- |
| `#constants`       | `./constants.js`         | `import { secretOrKey, sysPort } from '#constants'`      |
| `#/*`              | `./*`                    |                                                          |
| `#db/*`            | `./database/*`           | `import { User } from '#db/sql-database.js'`             |
| `#models/*`        | `./database/models/*`    | `import Prison from '#models/prison.model.js'`           |
| `#schemas/*`       | `./database/schemas/*`   |                                                          |
| `#hooks/*`         | `./database/hooks/*`     |                                                          |
| `#seeds/*`         | `./database/seeds/*`     |                                                          |
| `#routes/*`        | `./routes/*`             | `import { prisonEnd } from '#routes/constants.js'`       |
| `#rtControllers/*` | `./routes/controllers/*` |                                                          |
| `#rtServices/*`    | `./routes/services/*`    | `import authService from '#rtServices/auth.services.js'` |
| `#services/*`      | `./services/*`           | `import Utilities from '#services/Utilities.js'`         |
| `#dbg/*`           | `./debug/*.mjs`          | Directory does not exist. Unused.                        |

Each alias lists several extension fallbacks (`*`, `*.js`, `*.mjs`, `*.cjs`). Note that `#services/*` has a typo in its second entry (`./service/*.js`, singular); it is harmless because every import includes the `.js` extension and matches the first entry. Node does not resolve these aliases for tooling that does not read `package.json` `imports`; ESLint's `js/recommended` does not complain, but an IDE may not follow them without configuration.

## Configuration

`constants.js` calls `dotenv/config` and re-exports three environment variables:

| Export        | Env var        | Used by                                                                                                                   |
| ------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `secretOrKey` | `JWT_SECRET`   | `auth.services.js` to sign and verify tokens. No default; if unset, `jwt.sign` throws on login and every JWT check fails. |
| `sysPort`     | `PORT`         | `index.js` `app.listen`. No default; if unset Express picks a random free port.                                           |
| `redisSecret` | `REDIS_SECRET` | Nothing. Leftover from a planned session store.                                                                           |
| `environ`     | (all)          | Nothing.                                                                                                                  |

Other configuration is hardcoded:

- **Database**: `database/sql-database.js` creates `new Sequelize({ dialect: 'sqlite', storage: 'database.sqlite', ... })`. The `database`, `username`, and `password` keys in that config are ignored by the SQLite dialect. The file path is relative to the process working directory, so always start the server from the repo root. Sequelize's SQL logging is on (the default), which is why every query is printed.
- **CORS**: `index.js` allows only `http://localhost:3001`, methods `GET, POST, OPTIONS, PUT, PATCH, DELETE`, headers `X-Requested-With, content-type, authorization`, no credentials.
- **Token lifetime**: one week, in `auth.services.js`.
- **Default page size**: 10, in `route.controller.js`.

## Boot sequence

Understanding the import graph matters because the database is set up as a **side effect of importing** `database/sql-database.js`, and that import is triggered indirectly.

1. `index.js` imports the seven route modules.
2. Each route module imports `auth.services.js` (for the passport strategies).
3. `auth.services.js` imports `{ User } from '#db/sql-database.js'`.
4. Evaluating `sql-database.js`:
   - creates the Sequelize instance;
   - calls `Model.init(sequelize, Sequelize)` for all seven models (each reads its schema and hooks);
   - calls `associate(Models)` on all seven (this is where `Chapter.associate` prints `{ models: ... }` to the console, a leftover placeholder);
   - calls `sequelize.sync({ force: true })`, which **drops and recreates every table**, and when that resolves calls `createSeeds()`.
5. Back in `index.js`, `app.listen(PORT)` is called **before** the routers are mounted, and long before the sync/seed promise resolves. Express handles this fine because mounting happens synchronously in the same tick, but requests that arrive in the first second or two may hit empty or half-created tables.
6. Routers are mounted, then `ErrorService.handler` is added last as the error middleware.

Console output during boot, in order: the `{ models }` dump, `Express is running on port: N`, DROP/CREATE statements, INSERT statements from seeding, then a banner and one sample row per seeded model, then `End Seed Data`.

Because of `force: true`, **every restart erases all data**. The original README's TODO list already flags this ("Set force: true only in certain destructive environment"). Any work on persistence, migrations, or deploying beyond a laptop starts by making that conditional.

## Routing layer

### Path definitions

Every path is defined once in the `endpoints` object in `routes/constants.js`, keyed `resource.method.operation`. Extract:

```js
prison: {
	get: {
		many: '/prisons{/:full}{/:page}{/:page_size}',
		one: '/prison{/:id}'
	},
	post: { create: '/prison' },
	put: { update: '/prison', rule: '/rule' },
	delete: { remove: '/prison' }
}
```

`{/:id}` is Express 5 syntax (from `path-to-regexp` v8) for an **optional path segment**. It means `/prison` and `/prison/anything` both match this route. However, **no controller reads `req.params`**; every handler reads `req.query`. So the optional segments only make the router accept more URLs, and then the handler runs with an undefined id. `GET /prison/prison/1` reaches `getOne`, which calls `findOne({ where: { id: undefined } })` and Sequelize throws. Either read `req.params` in controllers (with query as fallback) or delete the segments. The original README's TODO ("Switch any GET requests with body requirements to URL parameters") suggests the intent was path parameters; the implementation ended up on query strings.

There is also a `protect: '/protected'` path under `user.get` that no route file registers, so `GET /auth/protected` is a 404 even though the Postman collection includes it.

### Route classes

All seven route files follow one template. `routes/prison/prison.js` is representative:

```js
class PrisonRoutes {
	static Router;
	static #Controller;

	static {
		const app = express(); // created, configured, and never used
		app.use(bodyParser.json());
		app.use(bodyParser.urlencoded({ extended: true }));
		app.use(passport.initialize());

		passport.use('UsrJStrat', authService.authorize); // re-registered by every route file
		this.#Controller = new prisonCrtlr();
		this.Router = express.Router();
		this.#router();
	}

	static #router() {
		this.Router.post(
			prisonEnd.post.create,
			passport.authenticate('UsrJStrat', { session: false, failWithError: true }),
			this.#Controller.create
		);
		// ... get many, get one, put update, put rule, delete remove
	}
}
export default PrisonRoutes;
```

Points to know:

- The class is never instantiated. The static initialization block runs at import time and populates the static `Router` property, which `index.js` mounts: `app.use('/prison', prisonRoutes.Router)`.
- The local `express()` app with its own body parsers is dead code copied between files. The real body parsing is configured once in `index.js`.
- `passport.use('UsrJStrat', ...)` is called by all seven files with the same strategy object. Passport's registry is keyed by name, so this is harmless. The user route file additionally registers `'LStrat'` (the local login strategy).
- Every route except `POST /auth/user` and `POST /auth/login` is wrapped in `passport.authenticate('UsrJStrat', { session: false, failWithError: true })`. `failWithError` is what routes auth failures into the JSON error handler instead of Passport's default plain-text 401.
- The controller method passed as the final handler must be a bound function whose `name` is `bound <method>`; see the next section for why.

### Mounts

From `index.js`:

| Prefix       | Router           | Notes                                      |
| ------------ | ---------------- | ------------------------------------------ |
| `/auth`      | `UserRoutes`     | Users and login.                           |
| `/prison`    | `PrisonRoutes`   |                                            |
| `/prisoner`  | `PrisonerRoutes` |                                            |
| `/rule`      | `RuleRoutes`     |                                            |
| `/messaging` | `MessageRoutes`  | Messages only. Chats used to be here too.  |
| `/chat`      | `ChatRoutes`     | Mounted twice (lines 44 and 45). Harmless. |
| `/chapter`   | `ChapterRoutes`  |                                            |

## Controller layer

### RouteController base class

`routes/controllers/route.controller.js` is the most important file to understand. Every controller extends it and calls `super('<resource>')` with the key used in `routes/constants.js`.

**Interface check.** The constructor verifies the subclass has `getOne`, `getMany`, `update`, `remove`, and `create` (by `in` check against a plain-object "interface") and throws a `LoudError` at boot otherwise. It is a runtime stand-in for an abstract class.

**`handleLimits(page, page_size)`** returns `{ limit: page_size || 10, offset: ((page - 1) || 0) * limit }`. Both inputs are raw query strings; nothing is parsed or validated. `page=0` gives `(0 - 1) || 0` which is `-1`, so offset `-10`, and `page_size=abc` produces `NaN`, which SQLite rejects as `no such column: NaN`.

**`handleSuccess(res, outObj, condition = 'par')`** and **`handleErr(res, errMsg, msgType = 'par')`** are where the response shape comes from. Both call the private `#findStack(res)`:

```js
#findStack(res) {
	let stack;
	res.req.route.stack.forEach((layer) => {
		const fname = layer.name.substr(6);   // strip "bound "
		if (this.hasOwn(fname)) {             // B1: should be Object.hasOwn(this, fname)
			stack = layer;
		}
	});
	return stack;
}
```

This walks the Express route's handler layers, strips the six-character `bound ` prefix from each function name, and picks the layer whose stripped name is an **own property of the controller instance**. That works only because each controller constructor does `this.create = this.create.bind(this)` for every handler, which both fixes `this` and makes the bound function an own property with the name `bound create`. The `passport.authenticate` layer is named `authenticate`; its stripped name `ticate` is not an own property, so it is skipped.

From the chosen layer, `handleSuccess` derives:

- `callerName` = `getOne` / `getMany` / `create` / `update` / `remove` / `login`;
- `msgRef` = `one` / `many` for the two getters, otherwise `callerName` unchanged;
- `method` = the layer's HTTP method (`get`, `post`, `put`, `delete`);

and looks up `messages[controllerName][method][msgRef].success.condition[condition]`. So for messages to resolve, three things must line up: the controller name passed to `super()`, the method names on the class, and the key structure in `routes/constants.js`. A handler that is not bound (like `addRule` in the prison controller) is invisible to `#findStack`, `stack` stays `undefined`, and `stack.name` throws. See [B10](#b10-put-prisonrule-crashes).

`condition` / `msgType` selects among several strings for one endpoint. Most endpoints only define `par` (the default). User `getOne` uses `id`, `mail`, `name`, `empty`; chat `getOne` defines `param` and `empty`; several `remove` endpoints define `absent` but nothing ever passes it.

`handleErr` has one special case before the lookup: if the error is a `SequelizeValidationError`, it short-circuits to `{ success: false, errors: [messages] }` with status 400. Everything else gets status 400 too, with `info`, `type`, `error`, and the full `stack`.

### Per-resource controllers

They are near-identical. Each method destructures `req.query` or `req.body`, calls one static model method inside `try`, and delegates to `#handleSuccess` / `#handleErr`. The private fields `#handleSuccess` and `#handleErr` are just aliases for the inherited methods, assigned in the constructor; the comment about "JS loses where we are" refers to the `this` problem that binding solves.

Things that differ:

- **User**: `create` lower-cases `role` before the `try` (crashes if missing). `#stripPassword` picks `id, email, name, role, username, bio` from a user for responses. `login` reads `req.authInfo.token` set by the local strategy. `getMany` post-processes the list through `#formatUsersList` and `#stripUsersListPasswords`, which is where [B5](#b5-get-authusers-returns-empty-objects) lives.
- **Prison**: has an extra `addRule` handler that is not bound.
- **Prisoner / Rule**: `getMany` branches to `getListByPrison` when `prison` is present, and those helper methods recompute pagination by hand instead of calling `handleLimits`.
- **Message**: `getMany` dispatches on the first present of `id`, `chat`, `prisoner`, `user` to four helper methods, each of which again recomputes pagination and calls a model method with an argument list that does not match the model's signature ([B12](#b12-message-list-filters-shift-their-arguments)).
- **Chat**: `getMany` and `getOne` compute a `{ chatfunc, condition }` pair from the query in private helpers, then `await chatfunc`. When the helper decides the parameters are invalid it returns only a `condition`, and `await undefined` succeeds ([B16](#b16-chat-lookups-with-bad-parameters-succeed)).
- **Chapter**: the simplest one; no pagination, no `full`.

## Response and error contract

The README documents the shapes from the client's point of view. Where they come from:

| Shape                                              | Produced by                                             | Status              |
| -------------------------------------------------- | ------------------------------------------------------- | ------------------- |
| `{ data, info, success: true, status: 200, name }` | `RouteController.handleSuccess`                         | 200                 |
| `{ success: false, errors: [...] }`                | `RouteController.handleErr`, validation branch          | 400                 |
| `{ info, type, error, stack }`                     | `RouteController.handleErr`, general branch             | 400                 |
| `{ success: false, name, info, status }`           | `ErrorService.handler` (anything passed to `next(err)`) | `err.status` or 400 |
| HTML "Cannot GET /x"                               | Express default 404 handler                             | 404                 |

`ErrorService.handler` in `routes/services/error.services.js` is the last middleware. It takes `status` from the error (Passport sets 401 for auth failures and 400 for missing credentials), falls back to 400, takes `message` from the error or the HTTP-status default table in `routes/constants.js`, and sends JSON. It then calls `next(req, res, next)`, which is the wrong signature (it passes `req` as an error object after the response has been sent). Express appears to tolerate this in practice, but the line should go.

`middleware/ErrorHandler.js` is an alternative error handler that was never wired up. Prefer deleting it over leaving two.

Design gaps worth fixing as a set, since clients will code against whatever you choose:

- No 404 for missing records. Most `getOne` calls return 200 with `data: null`; user `getOne` returns 400 with a generic message; deletes of missing rows return 200 with `data: 0`.
- No 201 for creates, no 204 for deletes.
- No 500. Internal faults (a `TypeError` from a bug) are reported as 400 with a stack trace in the body, which leaks file paths.
- `info` strings contain typos ("retireved", "Succeessfully") that clients may already have matched on.

## Authentication internals

`routes/services/auth.services.js` defines a class with static members only.

### Login (`LocalStrategy`)

`authService.login` is a `passport-local` strategy configured with `usernameField: 'username'` and `passwordField: 'password'`. Its verify function:

1. `User.getUser({ username })` (a `findOne` on the `username` column).
2. `bcrypt.compare(password, user.password)`.
3. On match, builds a token with `#createJWT(user)` and calls `done(null, user, { token })`. The third argument becomes `req.authInfo`, which is why the route uses `passport.authenticate('LStrat', { session: false, authInfo: true, failWithError: true })` and the controller reads `req.authInfo.token`.
4. On no user or no match, `done(null, false)`, which with `failWithError` becomes a 401.

Missing `username` or `password` never reaches the verify function; passport-local fails with a 400 "Bad Request", which `ErrorService.handler` renders as `{ name: 'AuthenticationError', info: 'Bad Request', status: 400 }`.

### Token creation

```js
static #createJWT(user) {
	const expiryDateMs = Date.now() + 6.048e8; // one week
	const payload = { id: user.id, expiry: expiryDateMs };
	const token = jwt.sign(payload, secretOrKey, { expiresIn: '1w' });
	return { token, expires: expiryDateMs };
}
```

The payload carries the user id twice-redundant expiry information: a custom `expiry` (ms) and the standard `exp` (s) that `expiresIn` adds. Only `exp` is checked. HS256 is the default algorithm. A decoded token looks like `{ "id": 3, "expiry": 1789749702603, "iat": 1789144902, "exp": 1789749702 }`.

### Token verification (`JwtStrategy`)

```js
static authorize = new JwtStrategy(authService.#jwtOptions, (jwt_payload, next) => {
	let user = User.getUser({ id: jwt_payload.id }); // not awaited
	if (user) {
		next(null, user);
	} else {
		next(null, false);
	}
});
```

`passport-jwt` has already verified the signature and expiry by the time this callback runs. The callback is supposed to confirm the user still exists and hand back the user object. It does not await `User.getUser`, so `user` is a pending Promise, which is truthy, so every token with a valid signature is accepted and `req.user` is a Promise rather than a user. Verified: a token signed for id 9999 (no such user) is accepted. See [B2](#b2-jwt-verification-does-not-check-the-user-exists).

### What is missing

- **Authorization.** No middleware checks `role`. Every authenticated route is equally available to `admin`, `user`, `chapter`, and `banned`. `User.banUser` exists on the model but is not exposed and would have no effect on access anyway.
- **Ownership.** A note in `routes/message/message.js` says "userA should not be able to delete, edit or read userB's messages". Nothing implements that. Because `req.user` is a Promise, controllers cannot currently even find out who is calling.
- **Registration policy.** `POST /auth/user` is unauthenticated and accepts any role.
- **Logout / refresh / revocation.** None. There is an old remote branch `18-logout-route`.
- `authService.register()` is an empty stub.

## Data layer

### Sequelize setup

`database/sql-database.js` builds everything and exports the Sequelize instance plus each initialized model. Models are initialized in this order: Chat, Message, Prison, Prisoner, Rule, User, Chapter; then `associate` is called on each in a different order (Prisoner, Prison, Message, User, Chat, Rule, Chapter). Order only matters for `associate`, which needs all classes to exist, and it does.

Sequelize creates a table per model using the pluralized model name, except User, which sets `tableName: 'User'` explicitly. Tables: `User`, `Prisons`, `Prisoners`, `Rules`, `Chats`, `Messages`, `Chapters`, and the join table `RulePassthrough`. Every table gets `id`, `createdAt`, and `updatedAt` automatically.

### Schemas

`database/schemas/<model>.schema.js` files export plain objects passed to `Model.init`. Summary:

| Model    | Columns (beyond id and timestamps)                                                                                      | Validation                                                                                                                                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User     | `name`, `username` (unique, not null), `password` (not null), `email` (unique, not null), `bio` TEXT, `role` (not null) | `password` len 7 to 255; `email` isEmail; `role` in admin/user/chapter/banned. `min`/`max` on the string columns are numeric validators and do nothing for strings ([B26](#b26-string-length-validators-are-ineffective)). |
| Prison   | `prisonName` (not null), `address` JSON (not null), `deleted` JSON (not null)                                           | none                                                                                                                                                                                                                       |
| Prisoner | `birthName`, `chosenName`, `prison` INT, `inmateID`, `releaseDate` DATE, `bio`, `status`                                | `status` has an `isIn` placed outside `validate`, so it is ignored ([B25](#b25-prisoner-status-is-not-validated)).                                                                                                         |
| Rule     | `title`, `description`                                                                                                  | none                                                                                                                                                                                                                       |
| Chat     | `user` INT, `prisoner` INT, explicit `id`                                                                               | none                                                                                                                                                                                                                       |
| Message  | `chat` INT (not null), `messageText`, `sender` (not null), `prisoner` INT (not null), `user` INT (not null)             | `chat`/`prisoner`/`user` isInt + notNull; `sender` in user/prisoner                                                                                                                                                        |
| Chapter  | `name` (not null), `location` JSON (not null), `prisoners` JSON, `lettersSent` STRING, `averageTimeDays` INT            | none                                                                                                                                                                                                                       |

Some schema entries include `model: 'User'` or `model: 'prisons', key: 'prison_key'` next to `type`. Those keys are not Sequelize column options (the real one is `references: { model, key }`), so they are ignored. **No foreign key constraints exist at the database level** for `user`, `prisoner`, `chat`, or `prison`. That is why deleting a prison leaves prisoners pointing at it and why message creation does not verify the user exists.

### Associations and the duplicate-column problem

Declared in each model's `associate(models)`:

| Declaration                                                                                         | Column it creates        | Column the code actually uses |
| --------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------- |
| `Chat.belongsTo(User, { as: 'user_details', foreignKey: 'userId' })`                                | `Chats.userId`           | `Chats.user`                  |
| `Chat.belongsTo(Prisoner, { as: 'prisoner_details', foreignKey: 'prisonerId' })`                    | `Chats.prisonerId`       | `Chats.prisoner`              |
| `Chat.hasMany(Message, { as: 'messages', foreignKey: 'chatId' })`                                   | `Messages.chatId`        | `Messages.chat`               |
| `Message.belongsTo(Chat, { as: 'chat_details', foreignKey: 'chatId' })`                             | (same)                   | `Messages.chat`               |
| `User.hasMany(Chat, { as: 'chats', foreignKey: 'userId' })`                                         | (same as above)          | `Chats.user`                  |
| `Prisoner.hasMany(Chat, { as: 'chats', foreignKey: 'prisonerId' })`                                 | (same as above)          | `Chats.prisoner`              |
| `Prisoner.belongsTo(Prison, { as: 'prison_details', foreignKey: 'prisonId' })`                      | `Prisoners.prisonId`     | `Prisoners.prison`            |
| `Prison.hasMany(Prisoner, { as: 'prisoners', foreignKey: 'prison' })`                               | uses `Prisoners.prison`  | `Prisoners.prison`            |
| `Prison.belongsToMany(Rule, { through: 'RulePassthrough', foreignKey: 'prison', sourceKey: 'id' })` | `RulePassthrough.prison` | n/a                           |
| `Rule.belongsToMany(Prison, { through: 'RulePassthrough', foreignKey: 'id' })`                      | `RulePassthrough.id`     | n/a (should be a rule key)    |
| `Chapter.associate`                                                                                 | nothing (stub)           |                               |

The schemas define `user`, `prisoner`, `chat`, and `prison` columns, and every `where` clause and every seed row uses those. The associations, however, declare **different** foreign key names, so Sequelize adds a second set of columns (`userId`, `prisonerId`, `chatId`, `prisonId`) that nothing ever writes. Consequences:

- Every response for chats, messages, and prisoners includes a null `...Id` field.
- Every `include` (the `full=true` feature) joins on the null columns and returns `[]` or `null`.
- The only association that lines up is `Prison.hasMany(Prisoner, { foreignKey: 'prison' })`, and even that is contradicted by the `belongsTo` on the other side.

The fix is to make each association use the column the schema already has (`foreignKey: 'user'`, `'prisoner'`, `'chat'`, `'prison'`) on both sides of each pair, and to give the `belongsToMany` pair proper keys (`foreignKey: 'prison', otherKey: 'rule'` and the reverse). That is [B17](#b17-association-foreign-keys-do-not-match-the-schema-columns). Do it once, in both directions, and re-check every `include` alias at the same time ([B9](#b9-include-aliases-do-not-match-association-aliases), [B14](#b14-chat-by-id-with-full-uses-the-wrong-aliases)).

### Model classes

Each `database/models/<model>.model.js` exports a class extending Sequelize's `Model` with:

- `static init(sequelize)`: calls `super.init(Schemas.<model>, { sequelize, hooks, modelName })`.
- `static associate(models)`.
- Static CRUD helpers: `createX`, `createBulkXs`, `countXs`, `getAllXs` / `readAllXs`, `getXByID` / `readXById`, `updateX`, `deleteX`, and resource-specific finders.

Naming is not uniform across models (`get` vs `read`, `ByID` vs `ById`), and the message controller calls a method that does not exist because of that ([B13](#b13-get-messagingmessage-calls-a-method-that-does-not-exist)).

`models.service.js` provides `modelInstanceExists(modelName, pk)`, which does `findByPk` and returns either the instance or an `Error` (returned, not thrown; callers check `instanceof Error` and throw). It does not know about `Chapter`, and an unknown name leaves `model` undefined so the next line throws a `TypeError` instead of the intended message. `User.getUsersByRole` calls it with `'Role'`, which is how [B6](#b6-listing-users-by-role-crashes) happens.

### Hooks

Only two models have hooks, registered through `database/hooks/all.hooks.js`:

- **User `beforeCreate`**: replaces `record.password` with `bcrypt.hash(password, 10)`. Runs for `User.create` (the controller passes `individualHooks: true`, though `create` runs hooks anyway) and for `bulkCreate` in the seed (which also passes `individualHooks: true`). It does **not** run for `User.update`, so `PUT /auth/user` with a `password` field stores plain text ([B8](#b8-password-updates-are-not-hashed)).
- **Message `beforeValidate`**: calls `Chat.findOrCreateChat(record.user, record.prisoner)` and writes the resulting chat id into `instance.chat`. This is the feature that lets clients send a message without first creating a chat. Because it runs before validation, a missing `user` or `prisoner` surfaces as a raw SQL `WHERE parameter ... undefined` error rather than the schema's `notNull` message. Because Sequelize's static `update` validates by default, the same hook runs on `PUT /messaging/message`, which is why updates must include `user` and `prisoner`.

### Deletion semantics

There is no `paranoid` mode. Every `destroy` is a hard delete. `Prison.deleted` is a JSON column that is set to `false` on create and never read; `Prison.deletePrison` does a real `destroy`. `Chat.deleteChat` deletes messages where `chat = id` first, then the chat, using an unusual `.then(await ...)` construction that happens to work. No other delete cascades.

## Seeds

`database/seeds/all.seeds.js` runs seed functions **sequentially** (through `Utilities.resolveSequential`, a hand-rolled promise chain) in dependency order: User, Prison, Prisoner, Rule, Chat, Message, Chapter. Each seed function checks `count === 0` before inserting, which was meant to make seeding idempotent; with `sync({ force: true })` the tables are always empty, so the check is moot until that changes.

Each `<model>.seed.js` reads its sibling `<model>Seed.json` (`{ "seeds": [ ... ] }`) with `readFileSync` and calls the model's `createBulkXs`, which is `bulkCreate` with `individualHooks: true` and (except messages) `ignoreDuplicates: true`. Messages use `validate: true` instead.

Row counts: 41 users, 52 prisons, 40 prisoners, 44 rules, 40 chats, 40 messages, 1 chapter. Prisoner N is in prison N, chat N pairs user N with prisoner N, and message N belongs to chat N (resolved at insert time by the message hook, not by the seed file). Seeded rules are not attached to any prison because there is no working way to do that.

One observed quirk: user ids do not come out in seed-file order (in a verified run `admin` received id 3). Do not hardcode seeded ids in tests; look them up.

After seeding, `all.seeds.js` prints the first row of each model with everything but `dataValues` stripped, under a colored banner. The printing code assumes every seed function returned a non-empty array; if a seed is skipped (count > 0) it will throw on `seedsData[i][0]`.

## Pagination and the `full` flag

`handleLimits` in the base controller turns `page` (1-based) and `page_size` into Sequelize `limit` and `offset`. Several controllers duplicate that arithmetic in helper methods instead of calling it; keep them in sync or, better, delete the copies.

Model read methods mostly take `(…, full, limit, offset)` or `(…, limit, offset)` and build a `findAll` options object. `full` switches on an `include` array. The signatures are not consistent, and controllers do not always match them:

| Controller call                                                                                             | Model signature                                       | Effect                                                                                                           |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Prisoner.getPrisonersByPrison(fullBool, prison, limit, offset)`                                            | `getPrisonersByPrison(prisonId, full, limit, offset)` | `findByPk(false)` throws ([B11](#b11-listing-prisoners-by-prison-swaps-arguments))                               |
| `Message.readMessagesByChat(chat, fullBool, limit, offset)` and the `ByPrisoner`, `ByUser`, `ById` variants | `(id, limit, offset)`                                 | `limit` = boolean, `offset` = 10; first page is skipped ([B12](#b12-message-list-filters-shift-their-arguments)) |
| `Rule.getAllRules(limit, offset)`                                                                           | `getAllRules(limit, offset, full = false)`            | `full` silently ignored on the rule list                                                                         |

Pick one convention (`(filters, { full, limit, offset })` as an options object would remove the whole class of bug) and apply it everywhere.

## Tooling

### npm scripts

| Script               | Command                                             | Notes                                      |
| -------------------- | --------------------------------------------------- | ------------------------------------------ |
| `npm test`           | `echo "echo the test"`                              | Placeholder. There are no tests on `main`. |
| `npm run lint`       | `eslint --fix "**/*.+(js\|mjs)"`                    | Autofixes. This is what introduced B1.     |
| `npm run format`     | `prettier --write "**/*.+(js\|mjs\|json\|css\|md)"` |                                            |
| `npm run pre-commit` | `lint-staged`                                       |                                            |
| `npm run prepare`    | `husky install`                                     | Runs automatically after `npm install`.    |

There is no `start` or `dev` script. Run `node index.js` or `npx nodemon index.js` directly (nodemon is a devDependency).

### ESLint

`eslint.config.js` is an ESLint 9 flat config. It ignores everything in `.gitignore` plus `package*.json`, and applies `@eslint/js` recommended to JS with Node globals, `@eslint/json` to JSON, `@eslint/markdown` to Markdown (GFM), `@eslint/css` to CSS, and `eslint-plugin-prettier` on top. The Markdown rules mean **documentation files are linted too**: fenced code blocks need a language, heading levels must not skip, and table rows must have consistent column counts.

Be careful with `eslint --fix`. The `no-prototype-builtins` rule's autofix turned `this.hasOwnProperty(fname)` into `this.hasOwn(fname)` in commit `dc56059` ("Lint all the things! (but will anything break?)"), which is B1. Review autofix diffs before committing them, and run the server afterward.

### Prettier

`.prettierrc.json`: tabs, width 100, single quotes, semicolons, no trailing commas, `arrowParens: always`, `proseWrap: preserve`. Prettier also formats Markdown and JSON (including the seed files and the Postman collections).

### Husky and lint-staged

`.husky/pre-commit` runs `npx lint-staged --allow-empty`, which runs `eslint --fix` on staged JS and `prettier --write` on staged JS, JSON, CSS, and Markdown, then re-stages the result. The `"husky"` key in `package.json` is the Husky v4 configuration format and is ignored by v8/v9; the `.husky/` directory is what counts. `package.json` asks for `husky ^8` while the lockfile has 9.1.7; the v8-style shim line in the hook (`. "$(dirname -- "$0")/_/husky.sh"`) still works under v9 but prints a deprecation warning.

### Lockfile drift

`npm ci` fails on `main` because `package-lock.json` was generated from a different `package.json` (eslint 9.28 vs 9.39, husky 9.1.7 vs ^8, lint-staged 16.1 vs 16.4, and transitive deps). Running `npm install` regenerates it. Commit the regenerated lockfile in a dedicated change so CI (when there is CI) can use `npm ci`.

### Tests

None on `main`. Remote branches `ABS-61-create-api-unit-tests` and `unit-tests-second-attempt` contain earlier attempts and may be worth mining. When adding tests, the first obstacle is that importing any route module boots the database and starts seeding; you will want a way to construct the app without side effects (see [Suggested order of work](#suggested-order-of-work)).

### Postman

`ABC-3.postman_collection.json` covers every resource but predates the `username` login field, the move of chats from `/messaging` to `/chat`, and the query-string convention. Its `jwt` collection variable is a stale token. Update it or replace it with something generated from an OpenAPI description.

### Branches

`origin` has around forty branches, most named after Linear-style tickets (`ABS-nn-...`) or GitHub issue numbers (`11-protect-the-necessary-routes`, `2-make-ids-uuid-instead-of-incrementing-variables`). There is an old `origin/documentation` branch from May 2024 that describes a completely different file layout (per-resource `*.model.js` and `*.helper.js` files under `routes/`); it is 240 commits behind and not a useful base.

## How to add a new resource

Using a hypothetical `Letter` resource (a printed, mailed artifact) as the example:

1. **Schema.** Create `database/schemas/letter.schema.js` exporting a column object. Add `static letter = letterSchema` to `database/schemas/all.schema.js`.
2. **Hooks (optional).** Create `database/hooks/letter.hooks.js` and register it in `database/hooks/all.hooks.js`. Models read `Hooks.<name> || null`.
3. **Model.** Create `database/models/letter.model.js` with `static init`, `static associate`, and the static CRUD helpers. Follow the `(…, full, limit, offset)` signature consistently. Add it to `database/models/all.model.js`, and if other models need existence checks, to the `switch` in `models.service.js`.
4. **Wire it up.** In `database/sql-database.js`, add `export const Letter = Models.Letter.init(sequelize, Sequelize);` and `Letter.associate(Models);`. If it has a foreign key to another model, make sure the association `foreignKey` names the column your schema defines.
5. **Seeds.** Add `database/seeds/letterSeed.json` and `letter.seed.js`, and insert `createLetterSeed` into the array in `all.seeds.js` **after** everything it depends on.
6. **Paths and messages.** In `routes/constants.js` add a `letter` key to **both** `endpoints` and `messages`. The `messages.letter` object must have `get.many`, `get.one`, `post.create`, `put.update`, and `delete.remove`, each with `success.condition.par` and `error.condition.par`, or `handleSuccess` will throw when it looks them up. Add `letter: letterMsg` and `letter: letterEnd` to the two destructuring exports at the bottom.
7. **Controller.** Create `routes/controllers/letter.controller.js` extending `RouteController`, call `super('letter')`, and **bind every handler** in the constructor (`this.create = this.create.bind(this)` and so on). Any handler you forget to bind will crash at response time.
8. **Routes.** Copy `routes/chapter/chapter.js` to `routes/letter/letter.js`, swap the imports and constants, and wrap each route in `passport.authenticate('UsrJStrat', ...)`.
9. **Mount.** In `index.js`, import the route class and `app.use('/letter', LetterRoutes.Router)` before `app.use(ErrorService.handler)`.
10. **Document.** Add the resource to the README's endpoint reference and to the Postman collection.

## Conventions and gotchas

- **ES modules everywhere.** `package.json` has `"type": "module"`. Use `import`/`export`, and include file extensions in relative and aliased imports.
- **Tabs, single quotes, width 100.** Prettier enforces it on commit.
- **Bind your handlers.** The response formatter finds the running handler by looking for a bound function that is an own property of the controller. Arrow-function class fields would also work (they are own properties, but their `name` lacks the `bound ` prefix, so `substr(6)` would mangle it). Stick with `.bind(this)` in the constructor.
- **Keys must match names.** `super('<name>')` must equal the key in `routes/constants.js`; handler method names must be exactly `create`, `getOne`, `getMany`, `update`, `remove` (and `login` for users) for the message lookup to resolve.
- **Query strings for GET, JSON body for everything else,** including the `id` on DELETE. The optional path segments in the route strings are not read.
- **Models return Sequelize instances.** `res.json` serializes them through `toJSON`, which is why responses include `createdAt`/`updatedAt` and the phantom `...Id` columns. Update helpers return Sequelize's `[affectedCount]` array, which is where `updatedRows: [1]` comes from.
- **`full` is a string.** Controllers compare `full === 'true'`. `full=1` or `full=yes` is false.
- **Errors are returned, not thrown, by `modelInstanceExists`.** Check `instanceof Error` and throw yourself, as the existing callers do.
- **Everything logs.** Sequelize logs every statement; several controllers and models have leftover `console.log` / `console.group` calls (`chapter.model.js` associate, `message.controller.js` getMany, `rule.controller.js` getMany, `user.model.js` getAllUsers). Expect noisy output until those are removed.
- **The database file is relative to cwd.** Start the server from the repo root.

## Bug catalog

Each entry gives the symptom, the cause with file and line, and a suggested fix. Line numbers refer to `main` at commit `2047c3e`. Severity: **Blocker** (nothing works), **Security**, **Broken** (an endpoint or option always fails), **Wrong** (succeeds with incorrect results), **Hygiene**.

### B1. Every controller response throws

- **Severity:** Blocker.
- **Symptom:** every request that reaches a controller returns `{"success":false,"name":"TypeError","info":"this.hasOwn is not a function","status":400}`.
- **Cause:** `routes/controllers/route.controller.js:57` calls `this.hasOwn(fname)`. `hasOwn` is a static method on `Object`, not an instance method. It was `this.hasOwnProperty(fname)` until commit `dc56059`, when `eslint --fix` rewrote it.
- **Fix:** `if (Object.hasOwn(this, fname)) {`. One line. Do this first; nothing else can be verified without it.

### B2. JWT verification does not check the user exists

- **Severity:** Security.
- **Symptom:** any token signed with `JWT_SECRET` is accepted regardless of the `id` inside it; deleted users keep access for up to a week; `req.user` is a Promise.
- **Cause:** `routes/services/auth.services.js:48`, `let user = User.getUser({ id: jwt_payload.id });` is not awaited. A Promise is truthy.
- **Fix:** make the callback `async`, `await` the lookup, and call `next(null, false)` when it is null. Consider also rejecting `role === 'banned'` here.

### B3. Registration is public and accepts any role

- **Severity:** Security.
- **Symptom:** an unauthenticated `POST /auth/user` with `"role": "admin"` creates an admin.
- **Cause:** `routes/user/user.js` registers the create route with no `passport.authenticate`, and `user.controller.js:164` accepts whatever `role` is sent.
- **Fix:** decide on a policy. Typical: public registration forces `role: 'user'`; creating other roles requires an admin token. The original README TODO "When creating server create admin user" suggests bootstrapping the first admin from config or the seed.

### B4. No role or ownership checks

- **Severity:** Security.
- **Symptom:** any token can read or modify any record, including other users.
- **Cause:** no authorization middleware exists. `role` is stored and never read.
- **Fix:** after B2, add a small `requireRole(...roles)` middleware and an ownership check for chats and messages (`req.user.id === chat.user`). The note in `routes/message/message.js` describes the intended rule.

### B5. `GET /auth/users` returns empty objects

- **Severity:** Broken.
- **Symptom:** `data` is `[{}, {}, ...]`.
- **Cause:** `routes/controllers/user.controller.js:50`. `#stripUsersListPasswords` does `Object.entries(usersList).forEach((value) => this.#stripPassword(value))`. Each `value` is a `[key, user]` pair, so destructuring `{ id, email, ... }` from it yields all `undefined`, and `JSON.stringify` drops undefined fields. (`#formatUsersList` first turns the array into an object keyed by id, which is why `entries` was used.)
- **Fix:** `Object.values(usersList)` or skip `#formatUsersList` and map over the original array.

### B6. Listing users by role crashes

- **Severity:** Broken.
- **Symptom:** `GET /auth/users?role=admin` returns `Cannot read properties of undefined (reading 'findByPk')`.
- **Cause:** `database/models/user.model.js:71` calls `modelsService.modelInstanceExists('Role', role)`. There is no Role model, so `model` is undefined. Additionally line 82 includes `model: 'Chat'` as a string, which Sequelize would reject once the first error is gone.
- **Fix:** remove the existence check (validate `role` against the allowed list instead) and use the imported `Chat` class in the include.

### B7. Creating a user without `role` throws a TypeError

- **Severity:** Wrong.
- **Symptom:** `{"name":"TypeError","info":"Cannot read properties of undefined (reading 'toLowerCase')"}` instead of the schema's "Role cannot be null" message.
- **Cause:** `user.controller.js:164`, `req.body.role.toLowerCase()` runs before the `try`.
- **Fix:** `const role = (req.body.role ?? '').toLowerCase()` inside the `try`, or default the role per B3.

### B8. Password updates are not hashed

- **Severity:** Security / Wrong.
- **Symptom:** after `PUT /auth/user` with a `password`, the stored value is plain text and `bcrypt.compare` fails at login.
- **Cause:** `database/hooks/user.hooks.js:4` only defines `beforeCreate`. `User.updateUser` uses the static `Model.update`, which fires bulk hooks, not `beforeCreate`.
- **Fix:** add a `beforeUpdate` hook and call `updateUser` with `individualHooks: true`, or hash in the controller when `password` is present. Also strip `password` from the echoed `newUser` in the update response.

### B9. Include aliases do not match association aliases

- **Severity:** Broken.
- **Symptom:** `GET /prison/prisons?full=true`, `GET /prison/prison?id=1&full=true`, `GET /rule/rules?prison=1`, and `GET /rule/rule?id=1&full=true` fail with `SequelizeEagerLoadingError: ... alias (rules) ... does not match ... (Rules)` (or `prisons` / `Prisons`).
- **Cause:** `prison.model.js:17` and `rule.model.js:17` declare the `belongsToMany` pair without an `as`, so Sequelize's default aliases are the plural model names. The queries at `prison.model.js:41`, `prison.model.js:79`, `rule.model.js:50`, `rule.model.js:69`, and `rule.model.js:87` use lowercase `rules` / `prisons`.
- **Fix:** add `as: 'rules'` and `as: 'prisons'` to the two `belongsToMany` calls. Fix the through-table keys at the same time (B17).

### B10. `PUT /prison/rule` crashes

- **Severity:** Broken.
- **Symptom:** `Cannot read properties of undefined (reading '#handleErr')`.
- **Cause:** `routes/controllers/prison.controller.js` binds `getMany`, `getOne`, `update`, `remove`, and `create` in the constructor (around line 20) but not `addRule` (line 84). Express calls it unbound, `this` is undefined, and the private field access throws. Even once bound, `#findStack` cannot find it (it is not an own property) and `Prison.addRule` at `prison.model.js:96` neither awaits nor returns its promise chain, so the response would be sent before the association is written.
- **Fix:** bind `addRule`; add `rule` under `prison.put` in `routes/constants.js` (it already exists there, so the lookup will work once the layer is found); rewrite `Prison.addRule` as `const [r, p] = await Promise.all([Rule.findByPk(rule), Prison.findByPk(prison)]); return p.addRule(r);` after B9/B17 make the association usable.

### B11. Listing prisoners by prison swaps arguments

- **Severity:** Broken.
- **Symptom:** `GET /prisoner/prisoners?prison=1` returns `Argument passed to findByPk is invalid: false`.
- **Cause:** `routes/controllers/prisoner.controller.js:57` calls `Prisoner.getPrisonersByPrison(fullBool, prison, limit, offset)`; the model at `prisoner.model.js:91` is `(prisonId, full, limit, offset)`.
- **Fix:** swap the first two arguments in the controller.

### B12. Message list filters shift their arguments

- **Severity:** Wrong.
- **Symptom:** `GET /messaging/messages?chat=1` (and `?prisoner=`, `?user=`, `?id=`) returns `[]` even when rows exist.
- **Cause:** `routes/controllers/message.controller.js:79`, `:93`, and the two similar calls below pass `(id, fullBool, limit, offset)`; the model methods at `message.model.js:50`, `:59`, `:72`, `:85` take `(id, limit, offset)`. So `limit` becomes `false`/`true` and `offset` becomes `10`, skipping the first page.
- **Fix:** either add a `full` parameter to the model methods (and an include for `chat_details`) or drop `fullBool` from the calls. Delete the four hand-rolled pagination blocks in favor of `handleLimits`.

### B13. `GET /messaging/message` calls a method that does not exist

- **Severity:** Broken.
- **Symptom:** `Message.getMessageByID is not a function`.
- **Cause:** `message.controller.js:139` calls `getMessageByID`; the model only has `readMessageById` (which returns an array via `findAll`).
- **Fix:** add `static async getMessageByID(id, full) { return this.findByPk(id, full ? { include: [...] } : {}); }` to the model.

### B14. Chat by id with `full` uses the wrong aliases

- **Severity:** Broken.
- **Symptom:** `GET /chat/chat?id=1&full=true` fails with an alias error mentioning `user` vs `user_details`.
- **Cause:** `chat.model.js:184` (`readChatById`) includes `as: 'user'` and `as: 'prisoner'` at lines 195 and 199; the associations at lines 18 and 19 are named `user_details` and `prisoner_details`. The other chat readers use the right names.
- **Fix:** use `user_details` / `prisoner_details`, and change `findAll` to `findOne` so that by-id lookups return an object like the by-pair lookup does.

### B15. Chat update fails

- **Severity:** Broken.
- **Symptom:** `PUT /chat/chat` returns `SQLITE_ERROR: no such column: chat`.
- **Cause:** `chat.model.js:225`. `updateChat` performs a second `update` with `where: { chat: updatedChat }`; `Chats` has no `chat` column, and `updatedChat` is the `[count]` array from the first update.
- **Fix:** delete the second update; the first one already writes `user` and `prisoner`.

### B16. Chat lookups with bad parameters succeed

- **Severity:** Wrong.
- **Symptom:** `GET /chat/chat?user=1` or `GET /chat/chat` returns 200 with `data: {}` instead of the `param` / `empty` error messages defined in `routes/constants.js`.
- **Cause:** `chat.controller.js:125` and the `default` branch return `{ condition }` without a `chatfunc`; line 88 then does `await chatfunc` on `undefined`, which resolves, and the success path runs.
- **Fix:** in `getOne`, `if (!chatfunc) throw new Error(...)` before awaiting, or have the helper return a rejected promise.

### B17. Association foreign keys do not match the schema columns

- **Severity:** Wrong (affects every `full=true` and pollutes every response).
- **Symptom:** `userId`, `prisonerId`, `chatId`, `prisonId` appear in responses and are always null; `full=true` returns `messages: []`, `user_details: null`, `prisoner_details: null`, `prison_details: null`.
- **Cause:** see [Associations and the duplicate-column problem](#associations-and-the-duplicate-column-problem). Declarations at `chat.model.js:18-20`, `message.model.js:15`, `user.model.js:18`, `prisoner.model.js:17-18`, `prison.model.js:16-21`, `rule.model.js:17`.
- **Fix:** set `foreignKey` to `user`, `prisoner`, `chat`, `prison` on both sides of each pair; set `foreignKey: 'prison', otherKey: 'rule'` on `Prison.belongsToMany(Rule)` and `foreignKey: 'rule', otherKey: 'prison'` on the reverse; then remove the stray `model:`/`key:` entries from the schemas and add real `references` if you want database-level constraints.

### B18. Duplicate chats

- **Severity:** Wrong.
- **Symptom:** `POST /chat/chat` with an existing pair creates a second chat; subsequent messages attach to whichever `findOrCreate` finds first.
- **Cause:** `Chat.createChat` is a plain `create`; no unique index on `(user, prisoner)`.
- **Fix:** add `indexes: [{ unique: true, fields: ['user', 'prisoner'] }]` to `Chat.init` options and use `findOrCreateChat` in the controller. Also validate that the user and prisoner exist.

### B19. `/auth/protected` is defined but not routed

- **Severity:** Hygiene.
- **Cause:** `routes/constants.js:6` defines it; `routes/user/user.js` never registers it.
- **Fix:** register it as a token-check endpoint (its success message is already written) or delete the constant and the Postman request.

### B20. `/chat` is mounted twice

- **Severity:** Hygiene. `index.js:44-45`. Delete one line.

### B21. Optional path segments are declared but never read

- **Severity:** Wrong.
- **Symptom:** `GET /prison/prison/1` reaches the handler and fails with `WHERE parameter "id" has invalid "undefined" value`.
- **Cause:** route strings in `routes/constants.js` use `{/:id}` etc.; controllers read `req.query` only.
- **Fix:** choose. To support path ids: `const id = req.params.id ?? req.query.id`. To drop them: remove the `{/:...}` segments so unsupported URLs 404 cleanly.

### B22. Pagination input is not validated

- **Severity:** Wrong. `route.controller.js:36`. Non-numeric values reach SQL. Parse with `Number.parseInt`, clamp to sane bounds, and return a validation error otherwise.

### B23. Not-found and status-code semantics are inconsistent

- **Severity:** Wrong. See [Response and error contract](#response-and-error-contract). `route.controller.js:100` hardcodes 400 for every error; `:97` includes `errMsg.stack`. Introduce a small error class with a `status`, return 404 when a lookup yields null, 201 on create, and never send stacks outside development.

### B24. Error middleware calls `next` with the wrong arguments

- **Severity:** Hygiene. `routes/services/error.services.js:23`. Remove the `next(req, res, next)` line. Also delete `middleware/ErrorHandler.js` (unused) and `routes/router.js` (unused) and `passport.cjs` (empty).

### B25. Prisoner `status` is not validated

- **Severity:** Wrong. `database/schemas/prisoner.schema.js:26` places `isIn` at the column level instead of under `validate`, and its value list is `['pending, pretrial', 'incarcerated', 'free']` (note the comma inside the first string). Move it under `validate: { isIn: { args: [['pretrial', 'incarcerated', 'free']], msg } }`.

### B26. String length validators are ineffective

- **Severity:** Wrong. `database/schemas/user.schema.js:7`, `:22`, `:74` use `min` / `max`, which Sequelize applies as numeric comparisons. A one-character username is accepted (verified). Use `len: { args: [3, 16], msg }`. Also fix the message at line 13 (says 16, arg says 32) and line 91 (omits `chapter` from the allowed-roles message).

### B27. `Prison.deleted` is unused and the wrong type

- **Severity:** Hygiene. `database/schemas/prison.schema.js:12` declares JSON; it only ever holds `false`. Either implement soft delete (`paranoid: true` on the model, drop the column) or remove it.

### B28. Every boot wipes the database

- **Severity:** Wrong (for anything beyond local development). `database/sql-database.js:32`. Make `force` depend on an environment flag (for example `DB_RESET=true`), default to `sync()` without force, and move seeding behind the same flag or a separate script.

### B29. Message hook runs before validation and on update

- **Severity:** Wrong. `database/hooks/message.hooks.js:6`. A missing `user`/`prisoner` produces a SQL error instead of the schema's `notNull` message, and `PUT /messaging/message` requires both fields. Guard the hook (`if (record.user == null || record.prisoner == null) return;`) so validation reports the problem, and skip the lookup on update when `chat` is already set.

### B30. `Message.createMessage` has a misleading signature

- **Severity:** Hygiene. `message.model.js:21` is declared `(messageText, sender)` but the controller passes one object, which is what `create` wants. Rename the parameter.

### B31. Chapter model is a stub in places

- **Severity:** Hygiene. `chapter.model.js:20` logs all models at boot from an empty `associate`. `getAllChapters` has no pagination. `prisoners` is a JSON blob rather than a relation. `modelsService` does not know about Chapter.

### B32. Rule creation accepts a `prison` that is ignored

- **Severity:** Hygiene. `rule.model.js:20` destructures `prison` and passes it to `create`, but Rule has no such column, so Sequelize drops it silently. Remove it, or implement "create rule and attach to prison" properly once B10 works.

### B33. Leftover debug logging and Sequelize query logging

- **Severity:** Hygiene. `message.controller.js:58-60`, `rule.controller.js:41-44`, `user.model.js:65` (`console.log(filters)` in `getAllUsers`), `chapter.model.js:20`. Add `logging: false` (or an env-controlled logger) to the Sequelize config.

### B34. Lockfile and Husky drift

- **Severity:** Hygiene. See [Tooling](#tooling). Regenerate `package-lock.json`; align `husky` to `^9` and update `.husky/pre-commit` to the v9 format (no shim line).

### B35. CORS is hardcoded

- **Severity:** Hygiene. `index.js:20`. Read allowed origins from an environment variable.

### B36. Postman collection is stale

- **Severity:** Hygiene. Uses `name` for login, `/messaging/chat`, path ids, and a hardcoded token.

## Suggested order of work

A reasonable sequence for "fix up the backend", each step small enough to be one pull request:

1. **Make it run.** B1. Add a `start` and `dev` script. Regenerate the lockfile (B34). Commit `.env.example`.
2. **Make it safe to expose.** B2, B3, B4, B8. Stop sending stack traces (part of B23).
3. **Make the data model honest.** B17 with B9 and B14 together, since they all touch the same `associate` calls and includes. Then B10 and B18. Add a unique index on chat pairs and real `references` on foreign keys.
4. **Fix the argument-order bugs.** B11, B12, B13, B15, B16. Consider replacing positional `(…, full, limit, offset)` parameters with an options object while you are in there.
5. **Validation.** B7, B22, B25, B26, B29. Consider a request validation layer (any schema library) in front of the controllers so bad input never reaches Sequelize.
6. **Response contract.** B23. Decide on 201/404/500, remove typos from `info` strings, and version the change so the front end can adapt.
7. **Persistence.** B28. Environment-gated `force`, a seed script separate from boot, and a plan for migrations (Sequelize CLI or Umzug) if the schema will keep changing.
8. **Tests.** Extract app construction from `index.js` so tests can build an app against an in-memory SQLite (`storage: ':memory:'`) without listening or seeding, then cover login, one CRUD cycle per resource, and the message-creates-chat behavior. Wire `npm test` to it and add CI.
9. **Cleanup.** B19, B20, B24, B27, B30 to B33, B35, B36. Delete dead files, remove the per-route `express()` apps, and register the passport strategies once.
10. **The original TODO list.** UUID ids, a default admin, soft deletes, and role-based route protection were all on the previous README's list and are still open.
