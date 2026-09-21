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

| Term               | Meaning                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User**           | An account. Has a `role` of `admin`, `user`, `chapter`, or `banned`. A `user` is a person on the outside writing letters; a `chapter` is a partner organisation that prints and mails them; an `admin` manages everything.                                                                                                                                                  |
| **Prison**         | A correctional facility. Has a name and a free-form JSON `address`.                                                                                                                                                                                                                                                                                                         |
| **Prisoner**       | An incarcerated person that users can write to. Belongs to one prison. Stores birth name, chosen name, inmate ID, release date, a bio, and a status.                                                                                                                                                                                                                        |
| **Mail rule**      | What a prison's mail room enforces, such as "no polaroids". There is one master list of rules, kept in the database and extended by admins; a prison has one or more of them. Page limits, photo limits, and accepted languages are typed fields on the prison.                                                                                                             |
| **Chat**           | A thread between exactly one user and one prisoner. Chats are created automatically the first time a message is sent between a pair, and can also be created directly.                                                                                                                                                                                                      |
| **Message**        | One letter or text within a chat. `sender` is either `user` or `prisoner`. A letter has a lifecycle `status` (`queued`, `printed`, `mailed`; replies are `received`) and a relay group that prints and mails it; see [Letter lifecycle](#letter-lifecycle).                                                                                                                 |
| **Managed writer** | A `user` account a group created for someone who writes through it (for example at a letter-writing night). The group sends letters on the writer's behalf until the writer claims the account with a one-time token; see [Managed writers](#managed-writers).                                                                                                              |
| **Chapter**        | A local chapter of the partner non-profit. Has a name, a JSON `location`, and some statistics fields. Carries a network role (collecting or relay) and an account status that an admin flips from `pending` to `active` to admit it to the network. Note that chapter _accounts_ are users with the `chapter` role; the Chapter resource describes the organisation itself. |

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

| Variable                                      | Required | Default                                   | Purpose                                                                                                                                                             |
| --------------------------------------------- | -------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                                  | Yes      | none                                      | Secret used to sign and verify login tokens. Login fails without it.                                                                                                |
| `PORT`                                        | Yes      | none                                      | TCP port to listen on.                                                                                                                                              |
| `ADMIN_USERNAME`                              | No       | none                                      | Together with the next two: an administrator account created on boot if no user with this username exists. All three must be set.                                   |
| `ADMIN_PASSWORD`                              | No       | none                                      | Password for that account, at least 7 characters.                                                                                                                   |
| `ADMIN_EMAIL`                                 | No       | none                                      | Email for that account.                                                                                                                                             |
| `CORS_ORIGIN`                                 | No       | `http://localhost:3001`                   | Browser origins allowed by CORS, comma-separated.                                                                                                                   |
| `DB_RESET`                                    | No       | `false`                                   | `true` drops every table and replays all migrations on boot. All data is lost, and every token issued before stops working.                                         |
| `DB_SEED`                                     | No       | `true`                                    | `false` skips loading the seed files. Seeding only ever fills empty tables, so leaving it on is safe.                                                               |
| `DB_LOGGING`                                  | No       | `false`                                   | `true` prints every SQL statement **with its values** (password hashes, token hashes, wrapped keys). Development only.                                              |
| `DB_STORAGE`                                  | No       | `database.sqlite`                         | Path of the SQLite file. `:memory:` gives a throwaway database (the test suite uses this).                                                                          |
| `UPLOAD_DIR`                                  | No       | `uploads`                                 | Directory for attachment files, relative to the working directory or absolute. Created on first upload. Back it up with the database.                               |
| `UPLOAD_MAX_BYTES`                            | No       | `20971520`                                | Largest accepted upload (20 MiB).                                                                                                                                   |
| `RATE_LIMIT_*`                                | No       | see [Rate limits](#rate-limits)           | Limits on login, claim checks, and recovery; `RATE_LIMIT_ENABLED=false` turns them off.                                                                             |
| `ROTATION_MAX_BYTES`                          | No       | `33554432` (32 MB)                        | Largest body of `POST /auth/chapter-rotation`, which re-seals every letter of a group in one request (about 150 bytes a letter). Other JSON bodies stay at 100 KB.  |
| `BACKUP_PUBLIC_KEY`                           | No       | none                                      | The public half of the backup key (`npm run backup:keygen`, run on your own computer). Without it no backups are made. See [Backups](#backups).                     |
| `BACKUP_DIR`                                  | No       | `backups`                                 | Where backups are written. Ideally another disk.                                                                                                                    |
| `BACKUP_KEEP`                                 | No       | `14`                                      | How many backups to keep.                                                                                                                                           |
| `BACKUP_EVERY_HOURS`                          | No       | off                                       | Let the running server make a backup whenever the newest is older than this. Leave unset when cron does it.                                                         |
| `TRUST_PROXY`                                 | No       | none                                      | Express "trust proxy" value when the API sits behind a reverse proxy (`1` for one hop), so rate limits see the client address.                                      |
| `ENCRYPTION_MODE`                             | No       | `server`                                  | How letters are encrypted; see [Encryption](#encryption). `e2e` is reserved for the browser-side design.                                                            |
| `ENCRYPTION_KEY`                              | Yes      | none                                      | Base64 of 32 random bytes; `npm run keygen` prints one. Wraps every letter's content key. Losing it means losing every letter.                                      |
| `RETENTION_DEFAULT_DAYS`                      | No       | `90`                                      | Days a writer's letters and replies stay after mailing when the writer has not chosen a window. `0` keeps everything. See [Retention](#retention).                  |
| `RETENTION_MAX_DAYS`                          | No       | none                                      | Caps what a writer may choose, including \"forever\".                                                                                                               |
| `IDEMPOTENCY_DAYS`                            | No       | `30`                                      | How long an `Idempotency-Key` is remembered. Long, so a phone that was offline for weeks still cannot send a second copy.                                           |
| `INVITATION_DAYS`                             | No       | `14`                                      | How long an invitation token works. See [Invitations](#invitations).                                                                                                |
| `INVITATION_AUTO_ACTIVATE`                    | No       | `false`                                   | `true` makes a group that joins by invitation active and listed at once, on the strength of the vouch. By default it waits for an admin.                            |
| `FCM_SERVICE_ACCOUNT_FILE`                    | No       | none                                      | Path to a Firebase service-account key (JSON), kept out of git. Without it devices may register and no push is sent. See [Push notifications](#push-notifications). |
| `PUSH_IOS_ALERT_TITLE`, `PUSH_IOS_ALERT_BODY` | No       | `New activity`, `Open the app to see it.` | The only visible words a push ever carries (iOS). Keep them bland.                                                                                                  |
| `NOTIFICATION_DAYS`                           | No       | `30`                                      | How long an entry stays in an account's notification feed.                                                                                                          |
| `NODE_ENV`                                    | No       | none                                      | `development` adds the underlying error message and stack trace to `500` responses. Leave unset elsewhere.                                                          |

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
Seed data: users: 41 seeded, prisons: 52 seeded, prisoners: 40 seeded, chats: 40 seeded, messages: 40 seeded, chapters: 1 seeded.
Created admin account "bootadmin" (id 42).
Database ready.
```

The server accepts connections as soon as the first line prints. `GET /health` answers `503 {"status":"starting","encryptionMode":"server","push":[]}` until the database is ready and `200 {"status":"ok","encryptionMode":"server","push":[]}` afterwards; it needs no token. `push` lists the push services the API can send through today (`["fcm"]` once a key is configured; see [Push notifications](#push-notifications)). `encryptionMode` is `server` or `e2e`, so a client can tell which letter contract to speak before it posts anything.

If the database cannot be prepared at start-up (a migration fails, the file cannot be opened, `ENCRYPTION_KEY` is wrong), the server logs why and **exits with code 1**; `/health` answers `503` until then and never `200`. On `SIGTERM` or `SIGINT` it finishes the requests in flight (up to 10 seconds) and exits `0`, so a restart does not cut a letter off half sent.

### Running the tests

```bash
npm test
```

The suite runs against an in-memory database and needs no `.env`. It takes a couple of seconds.

### Data persistence

Data lives in `database.sqlite` in the repository root and **survives restarts**. On the second boot the seed line reads `users: already populated, ...` and nothing is inserted. To start over, delete the file or boot once with `DB_RESET=true`.

While the server runs, SQLite keeps two files beside the database: `database.sqlite-wal` and `database.sqlite-shm` (write-ahead log; git-ignored). Recent writes live in the `-wal` file until SQLite folds them in, so **never back up by copying `database.sqlite` alone while the server is up**. Use `npm run backup` ([Backups](#backups)), which asks SQLite for a consistent copy and is safe while the server runs.

Attachment files live under `UPLOAD_DIR` (default `./uploads`, git-ignored) and are referenced by rows in the `Attachments` table; back up both together. Deleting a message or chat through the API removes its files.

### Backups

Everything is one database file, the uploads folder, and the keys in `.env`. `npm run backup` puts the first two into **one encrypted file**; the keys are kept apart, by people, on purpose.

A backup is encrypted to a **public key**. The server holds only that, so it can make backups and cannot open them: whoever breaks into the server does not also get every backup. The private key stays with the people who run the site, off the server.

**Set-up, once**

1. On **your own computer** (not the server), in a checkout of this repository:

   ```bash
   npm run backup:keygen
   ```

   It writes `abc-backup-private.key` and prints a `BACKUP_PUBLIC_KEY=…` line. Keep the private key file off the server, and keep a second copy in another place (a password manager, a USB stick in a drawer). **Without it the backups are noise; nobody can recover it for you.**

2. Put the `BACKUP_PUBLIC_KEY=…` line in the server's `.env`, and restart the API.
3. Make backups happen, one of:
   - `BACKUP_EVERY_HOURS=24` in `.env`: the running server makes one whenever the newest is older than that. Nothing else to set up.
   - or cron, which also works when the API is down: `15 3 * * * cd /srv/abc-api && npm run --silent backup`
4. **Get the files off the machine.** A backup on the same disk protects against a bad migration, not against a dead disk. Point `BACKUP_DIR` at a mounted second disk, or copy `backups/` elsewhere after each run (`rsync`, `rclone`, a bucket with write-only credentials). The files are safe to store anywhere: they are useless without the private key.
5. Keep `ENCRYPTION_KEY` and `JWT_SECRET` (the server's `.env`) somewhere safe **and separate from the backup private key**. They are not in the backup. In server mode, a backup plus `ENCRYPTION_KEY` is every letter in plain text; in end-to-end mode it is not.

**Commands**

| Command                                                              | Where                | What it does                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run backup`                                                     | Server               | Makes `backups/abc-backup-<date>.abcbak`: a consistent copy of the database (taken by SQLite, safe while the API runs) and every attachment file it refers to. Removes all but the newest `BACKUP_KEEP` (14). An attachment whose file is missing is reported and does not stop the backup. |
| `npm run backup:status -- --max-age-hours 26`                        | Server               | Prints the newest backup and its age; **exits 1** when there is none or it is too old. For monitoring. Admins also see this under `backups` in `GET /moderation/summary`.                                                                                                                   |
| `npm run backup:info -- <file>`                                      | Anywhere             | When it was made and for which key. Needs no key.                                                                                                                                                                                                                                           |
| `npm run backup:verify -- <file> --key abc-backup-private.key`       | Your computer        | Opens it, checks every file against its checksum, runs SQLite's integrity check, and checks that every attachment in the database has its file. Leaves nothing behind. **Do this now and then: a backup nobody has opened is a hope, not a backup.**                                        |
| `npm run backup:restore -- <file> --key <key file> --to <new dir>`   | Wherever you restore | Unpacks and checks it into a **new** directory. It never writes over anything; it prints the four steps to put the files in place (stop the API, move the old files aside, copy, start).                                                                                                    |
| `npm run backup:decrypt -- <file> --key <key file> --out backup.tar` | Your computer        | A plain `tar` archive any tool opens, with or without this repository. It is the whole database in the clear: delete it when you are done.                                                                                                                                                  |

After a restore, everyone who signed in since the backup was made is signed out ([Signing out and revoking tokens](#signing-out-and-revoking-tokens)), and whatever was written since is gone: that is what the age of the newest backup means.

The file format (a tar stream, encrypted in chunks with libsodium's secretstream to a sealed key) is described at the top of `services/backup-archive.js`. A changed byte, a missing end, or the wrong key is refused with a message that says which.

### Retention

Letters do not stay forever. Once a letter has been `mailed` or `returned` (or a prisoner reply recorded) for longer than the writer's window, the API deletes it, with its attachments, envelopes, and status history, and removes a chat left empty. Queued and printed letters are never touched, and neither is a letter the writer pinned with `keep: true`. Every run that deletes something writes one `retention.run` entry to the audit log with the counts, then compacts the database file so the deleted pages do not linger.

The window is per writer: `retentionDays` on the account, else `RETENTION_DEFAULT_DAYS` (90). `0` means forever. `RETENTION_MAX_DAYS`, when set, caps every choice including forever. A writer's window covers the prisoner replies in their threads, since they sit in the writer's account. A managing group sets the window for its unclaimed managed writers and for its anonymous writer through `PUT /auth/user`, the same way it edits their names. `GET /messaging/retention` tells a client the default, the cap, and the caller's effective window.

The job runs when the API boots and every six hours. To preview what a run would remove:

```bash
npm run retention -- --dry-run
```

### Encryption

Letters are never stored in the clear. Each message gets its own random content key; the body, the relay note, and every attachment file are encrypted with it (XChaCha20-Poly1305, libsodium's `crypto_aead_xchacha20poly1305_ietf` with no associated data), and the content key is stored wrapped, once per reader, in the `LetterKeys` table.

There are two modes, chosen by `ENCRYPTION_MODE`:

- **`server`** (the default): the only reader is the server, and the content keys are wrapped with `ENCRYPTION_KEY`. The API decrypts letters for authorised callers, and the request and response shapes are exactly what this document describes (`messageText`, `relayNote`, plain file downloads). This protects a copied database file or upload directory, which hold ciphertext only. It does not protect against someone with the running server and its key.
- **`e2e`**: readers hold the keys. Every account and every group has an X25519 keypair; the browser encrypts each letter with a fresh content key and seals that key to each reader's public key (the _envelopes_). The server stores ciphertext and envelopes, returns each caller the envelopes they can open, and never sees a password-derived key, a recovery code, or an unwrapped private key. `messageText` and `relayNote` are always `null`; clients send and receive `ciphertext` and `nonce` instead, and attachment files travel as ciphertext. See [End-to-end mode](#end-to-end-mode).

The storage shape is the same in both modes, so switching is a re-wrap of content keys, never a re-encryption of letters. The step-by-step procedure, with its checks and its rollback limits, is in [docs/E2E-MIGRATION.md](docs/E2E-MIGRATION.md). In short: clients make keys at sign-in, and each person's existing letters are sealed to them as they do. The switch needs only that every active group that relays mail has its key (`GET /auth/encryption-readiness`); `npm run encryption:rewrap` sweeps up the rest and, with `--drop-server-keys`, removes the server envelopes no longer needed. Then set `ENCRYPTION_MODE=e2e` and restart, keeping `ENCRYPTION_KEY`: letters still waiting for a reader stay under it and become theirs at their first sign-in. `--drop-all-server-keys` ends the wait for good.

Operational rules:

- Generate the key once with `npm run keygen`, put it in `.env`, and back it up somewhere other than the server. Migrations, seeds, and the first boot all need it.
- Every server envelope records a fingerprint of the key that wrapped it. A letter wrapped under a different key is refused with a `500` and `"name": "EncryptionKeyError"` rather than served as garbage.
- Key rotation (re-wrapping the server envelopes under a new key) is not scripted yet.
- In `e2e` mode the plaintext seed letters are skipped, since only a browser can encrypt.

Schema changes ship as migrations and are applied automatically on boot, so pulling a new version and starting the server upgrades an existing database in place. A database created before migrations existed is adopted on first boot (you will see `Existing database adopted` once).

### CORS

The server only sends CORS headers for the origins in `CORS_ORIGIN`. Browser clients served from other origins are blocked by the browser. Non-browser clients such as `curl`, Postman, or server-to-server calls are unaffected.

## Seed data and test accounts

On a fresh database the JSON files in `database/seeds/` are loaded:

| Resource  | Rows | Notes                                                                                                                                                                                                                          |
| --------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Users     | 41   | One admin plus forty regular users.                                                                                                                                                                                            |
| Prisons   | 52   | "Test Prison", then Greek-letter names ("Alpha Prison", "Beta Prison", ...), all in the United States with `direct` routing and a one-line street address. **Mail rules are seeded here**, as tags on each prison (see below). |
| Prisoners | 40   | Prisoner N is in prison N. Each has a birth name, chosen name, inmate ID, release date, bio, country, interests, and a `status` (28 `incarcerated`, 7 `pretrial`, 5 `free`), so the status filter has something to find.       |
| Chats     | 40   | Chat N pairs user N with prisoner N.                                                                                                                                                                                           |
| Messages  | 40   | One short greeting per chat, all sent by the user side.                                                                                                                                                                        |
| Chapters  | 1    | "Test Chapter": active, `networkRole` `both`, three services. No `chapter`-role account is seeded; create one as the admin (`POST /auth/user` with `role` and `chapterId`) or through an [invitation](#invitations).           |

### Seeded mail rules

There is no rules seed file, for two different reasons. The **master list** of 39 rules is not seed data at all: a migration puts it in the `MailRules` table, so production has it too, and admins extend it from there ([Mail rules](#mail-rules)). Which rules each seeded prison **has** is seed data, and lives with the prisons in `database/seeds/prisonSeed.json`, as a list of tags that the seeder links to the master list:

- Every seeded prison has `mailRules`: most carry the common ones (`return_address_required`, `full_name_and_number`, `mail_read_by_staff`, `no_enclosures`) plus two to six others. 34 of the 39 rules are in use somewhere; 6 prisons are `no_photos`.
- 38 prisons have a `pageLimit` (5, 10, or 20), 41 a `photoLimit` (3, 5, or 10; never together with `no_photos`), and 22 a `mailLanguages` list (`["en"]` or `["en", "es"]`).
- "Test Prison" has a fixed, readable set for trying things out: `return_address_required`, `full_name_and_number`, `plain_envelopes`, `ink_blue_or_black`, `no_polaroids`, `mail_read_by_staff`, with `pageLimit` 10, `photoLimit` 5, and `mailLanguages` `["en", "es"]`.

Seeding only fills empty tables. A database created before mail rules became tags keeps its prisons, with `mailRules: []`; boot once with `DB_RESET=true` to get the rules above.

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
- Every **GET** on prisons, prisoners, and chapters (the public directory), and the master list of mail rules. Anonymous callers see only records whose `recordStatus` is `published`; see [Record status](#record-status).
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

### Rate limits

The endpoints that need no token are limited, so nobody can guess passwords, enumerate usernames through recovery, or scan claim and invitation tokens at speed. A limited request gets `429` with a `Retry-After` header (seconds) and the general error shape, `"name": "RateLimitError"`. Counts live in the API process and reset on restart.

| What                                           | Default           | Environment variable                                                                           |
| ---------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| Failed sign-ins per username                   | 10 per 15 minutes | `RATE_LIMIT_LOGIN_FAILURES_PER_USER`, `RATE_LIMIT_LOGIN_WINDOW_MINUTES`                        |
| Sign-in attempts per address                   | 60 per 15 minutes | `RATE_LIMIT_LOGIN_PER_IP`                                                                      |
| Claim token checks per address                 | 20 per hour       | `RATE_LIMIT_CLAIM_PER_IP`, `RATE_LIMIT_CLAIM_WINDOW_MINUTES`                                   |
| Invitation checks and acceptances per address  | 20 per hour       | `RATE_LIMIT_INVITE_PER_IP`, `RATE_LIMIT_INVITE_WINDOW_MINUTES`                                 |
| Recovery starts per username                   | 5 per hour        | `RATE_LIMIT_RECOVER_START_PER_USER`, `RATE_LIMIT_RECOVER_WINDOW_MINUTES`                       |
| Recovery starts per address                    | 30 per hour       | `RATE_LIMIT_RECOVER_START_PER_IP`                                                              |
| Recovery finishes per username                 | 5 per hour        | `RATE_LIMIT_RECOVER_FINISH_PER_USER`                                                           |
| Recovery finishes per address                  | 30 per hour       | `RATE_LIMIT_RECOVER_FINISH_PER_IP`                                                             |
| Wrong passwords when deleting your own account | 10 per 15 minutes | the sign-in settings (`RATE_LIMIT_LOGIN_FAILURES_PER_USER`, `RATE_LIMIT_LOGIN_WINDOW_MINUTES`) |

Successful sign-ins never count against a username; once the failure limit is reached, even the right password is refused until the window ends. Usernames are compared case-insensitively. Set `RATE_LIMIT_ENABLED=false` to switch limiting off, and set `TRUST_PROXY` when the API is behind a reverse proxy, otherwise every client appears to come from the proxy's address and shares one budget.

### Signing out and revoking tokens

Tokens last a week, and each one carries an id, so a token can be ended early:

- `POST /auth/logout` with the token to end: that token stops working immediately; the account's other devices are unaffected. With `{"everywhere": true}` every token for the account stops working. The response says which happened.
- `POST /auth/revoke` `{"user": 43}` (admin): every token for that account stops working, without banning it. The account can log in again straight away. Use it for a lost phone or a shared computer.
- Changing a password (`PUT /auth/user`) ends every existing session for that account. When the account holder changes their own, the response carries a fresh `token` so they stay signed in; an admin reset carries none.
- Finishing recovery (`POST /auth/recover`) ends every existing session.

Tokens are also tied to the database that issued them, not only to `JWT_SECRET`. The database records the spans of time in which it issued tokens, and a token issued at a time it has no record of is refused:

- after `DB_RESET=true`, or on a new database, every earlier token is refused, even though the secret is the same and an account with the same id exists again;
- after a **restore from backup**, tokens issued between the backup and the restore are refused (the backup never saw them, and their user ids may belong to different accounts now), while tokens from before the backup keep working;
- an ordinary restart changes nothing: people stay signed in.

Clients need no special handling: it is the same `401` as an expired token, answered by sending the person to sign in. Deploying this to a database that already has accounts does not sign anybody out.

A revoked token gets `401` like any bad token. Logged-out token ids are kept only until the token would have expired anyway, then dropped. Tokens issued before this feature existed have no id and can only be ended with `everywhere`, a revocation, or a password change.

### What each role can do

| Action                                                                  | `user`                | `chapter`                                                                           | `admin` |
| ----------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------- | ------- |
| Read published prisons, prisoners, chapters                             | Yes (and anonymous)   | Yes                                                                                 | Yes     |
| Read draft and pending directory records                                | No                    | Yes                                                                                 | Yes     |
| Create, update, delete prisons, prisoners, chapters                     | No                    | Yes                                                                                 | Yes     |
| Set a prison's mail rules                                               | No                    | Yes                                                                                 | Yes     |
| Add to, reword, retire, or delete from the master list of mail rules    | No                    | No                                                                                  | Yes     |
| Read, create, update, delete chats and messages                         | **Own threads only**  | **Managed writers' threads only** (threads it only mails: read, and record replies) | All     |
| Send a message as the prisoner side (`sender: prisoner`)                | No (forced to `user`) | Yes                                                                                 | Yes     |
| Propose a directory change or record ([Moderation](#moderation))        | Yes                   | Yes                                                                                 | Yes     |
| Approve or reject proposals; read the audit log and summary             | No                    | No                                                                                  | Yes     |
| Move a letter to `printed` / `mailed`                                   | No                    | As its relay group                                                                  | Yes     |
| Create managed writers, issue claim tokens                              | No                    | Own group                                                                           | Yes     |
| Invite a new group (vouching for it) or a new member of one's own group | No                    | Own group, if active                                                                | Yes     |
| Approve a group that joined by invitation (`accountStatus`)             | No                    | No                                                                                  | Yes     |
| Read, edit, delete a group's unclaimed managed writers                  | No                    | Own group                                                                           | Yes     |
| Read own user record; update or delete own account                      | Yes                   | Yes                                                                                 | Yes     |
| Read, update, delete other users; list users                            | No                    | No                                                                                  | Yes     |
| Register own devices; read and mark own notification feed               | Yes                   | Yes                                                                                 | Yes     |
| Revoke every session of another account                                 | No                    | No                                                                                  | Yes     |
| Change a role, or create a non-`user` account                           | No                    | No                                                                                  | Yes     |

"Own threads" means chats whose `user` is the caller's id, and messages whose `user` is the caller's id. For a `user`:

- List endpoints silently filter to the caller; a `user` or `prisoner` query parameter cannot widen the result.
- Fetching, updating, or deleting someone else's chat or message returns `403`.
- Creating a chat or message always uses the caller's own id as `user`, whatever the body says, and messages are always sent as `user`.

Every refusal is a `403` with the general error shape.

A `chapter` account has these rights **through its group**: while the group is `pending` or `suspended` its accounts read what the public reads (published records, no staff-only fields) and write nothing, group keys included.

A `chapter` account is scoped to its group. It sees the threads of the writers its group manages (see [Managed writers](#managed-writers)) and the threads holding letters its group relays (see [Letter lifecycle](#letter-lifecycle)), can send letters for its writers and transcribe prisoner replies on either, and sees nothing else. A `chapter` account that is not yet a member of a group (no `chapterId`), or whose group is not yet `active` (see [Chapter fields](#chapter-fields)), can read what anyone can but cannot write the directory, create writers, or send and relay letters; every such refusal is a `403` whose `info` says which it is. An admin puts an account in a group with `PUT /auth/user` and activates a group with `PUT /chapter/chapter`.

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

| Prefix        | Resource                   | Singular path            | Plural path                            |
| ------------- | -------------------------- | ------------------------ | -------------------------------------- |
| `/auth`       | Users                      | `/auth/user`             | `/auth/users`                          |
| `/prison`     | Prisons                    | `/prison/prison`         | `/prison/prisons`                      |
| `/prisoner`   | Prisoners                  | `/prisoner/prisoner`     | `/prisoner/prisoners`                  |
| `/chat`       | Chats                      | `/chat/chat`             | `/chat/chats`                          |
| `/messaging`  | Messages                   | `/messaging/message`     | `/messaging/messages`                  |
| `/chapter`    | Chapters                   | `/chapter/chapter`       | `/chapter/chapters`                    |
| `/moderation` | Submissions, audit log     | `/moderation/submission` | `/moderation/submissions`              |
| `/invitation` | Invitations                | `/invitation/invitation` | `/invitation/invitations`              |
| `/auth`       | Devices, notification feed | `/auth/device`           | `/auth/devices`, `/auth/notifications` |

Note the odd one out: messages are mounted at `/messaging`, while chats are at `/chat`.

### How to pass identifiers and filters

- **GET** requests take everything as **query-string parameters**: `GET /prison/prison?id=1`.
- **PUT** and **DELETE** requests take the `id` (and any fields) in a **JSON body**. Yes, `DELETE` requests carry a body.
- Path-style ids such as `GET /prison/prison/1` are not supported and return a `404`.
- **One id is one value.** A list where one record's id belongs (`?id=1&id=2`, `{"id": [1, 2]}`; the same for `user`, `prisoner`, `prison`, `chat`, `message`, `chapter`, `target`, and the like) is a `400`, and so is a `PUT` or `DELETE` without its `id`.

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
| `name`    | The resource and operation, for example `user create`, `chat many`, `prison remove`, `prison addRelay`.      |

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

| Situation                                                                                                                   | Status |
| --------------------------------------------------------------------------------------------------------------------------- | ------ |
| Create                                                                                                                      | 201    |
| Read, update, delete, login, attach relay group                                                                             | 200    |
| Validation failed, bad pagination, unknown role filter                                                                      | 400    |
| Duplicate username or email                                                                                                 | 400    |
| Referential integrity refused the change (see below)                                                                        | 400    |
| Missing or invalid token, banned or deleted user, wrong password                                                            | 401    |
| Role or ownership does not permit the action                                                                                | 403    |
| No record with that id (read, update, or delete), or unknown parent in a list filter, or unknown path                       | 404    |
| State conflict: a letter status move the lifecycle forbids, a submission already decided, a key already set                 | 409    |
| Claim or invitation token used or expired; an `Idempotency-Key` whose letter was since deleted                              | 410    |
| An `Idempotency-Key` reused for a different request                                                                         | 422    |
| Rate limited on login, claim checks, or recovery; `Retry-After` gives the wait in seconds (see [Rate limits](#rate-limits)) | 429    |
| Internal fault                                                                                                              | 500    |

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

| Parameter        | Where                                       | Effect                                                                                                                                                                                          |
| ---------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `q`              | prisons, prisoners, chapters, users (admin) | Case-insensitive substring match. Prisons match `prisonName`; prisoners match `birthName` or `chosenName`; chapters match `name`; users match `username`, `email`, or `name`. Blank is ignored. |
| `sort`           | prisons, prisoners, chapters                | `name` (alphabetical: prison name, prisoner chosen then birth name, chapter name), `newest`, or `oldest`. Default is ascending id.                                                              |
| `status`         | prisoners                                   | `pretrial`, `incarcerated`, or `free`.                                                                                                                                                          |
| `country`        | prisoners, prisons, chapters                | Exact match on the `country` field.                                                                                                                                                             |
| `featured`       | prisoners                                   | `true` or `false`.                                                                                                                                                                              |
| `routing`        | prisons                                     | `direct`, `scan_only`, `direct_and_scan`, or `relay_only`.                                                                                                                                      |
| `stale`          | prisoners, prisons                          | `true`: records never verified, or verified more than six months ago (`verifiedAt`). For re-verification worklists.                                                                             |
| `addressInDoubt` | prisoners (staff only; ignored for others)  | `true`: a letter came back as transferred, released, or undeliverable in the last 60 days and the record has not been edited since.                                                             |
| `service`        | chapters                                    | One service key (see [Chapter fields](#chapter-fields)); matches groups whose `services` include it.                                                                                            |
| `networkRole`    | chapters                                    | `collecting` or `relay`; groups marked `both` match either.                                                                                                                                     |
| `accountStatus`  | chapters                                    | `pending`, `active`, or `suspended`.                                                                                                                                                            |
| `relay`          | prisons                                     | `true`: facilities with at least one active relay group; `false`: facilities with none.                                                                                                         |
| `mailRule`       | prisons                                     | One tag from the [master list of mail rules](#mail-rules): facilities carrying it. A tag that is not on the list matches nothing; anything not shaped like a tag is a `400`.                    |
| `language`       | prisons                                     | A two-letter ISO 639-1 code: facilities that accept mail in that language, which includes every facility with no language restriction.                                                          |
| `prison`         | prisoners                                   | Only records attached to that prison.                                                                                                                                                           |
| `recordStatus`   | prisons, prisoners, chapters (staff only)   | See below.                                                                                                                                                                                      |
| `role`           | users (admin)                               | One role.                                                                                                                                                                                       |

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

New records default to `published` until the moderation workflow exists. Staff can pass `recordStatus` on create or update to make a record `draft` or `pending`.

### The `full` parameter

Most read endpoints accept `full=true` to embed related records. The string must be exactly `true`; anything else is treated as `false`.

| Endpoint                     | `full=true` adds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Users (list, by id, by role) | `chats`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Prisons (list, by id)        | `prisoners`, `relay_groups`. Mail rules are plain fields on the prison and need no `full`                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Prisoners (list, by id)      | `prison_details`, `support_groups` (each with a `PrisonerSupport.description`). Without `full`, list rows still carry a small `prison_details` (`id`, `prisonName`, `country`, `routing`) for "Held at" lines                                                                                                                                                                                                                                                                                                                |
| Prisoners by prison          | `prison_details`, `support_groups`, plus `chats` for admin callers only. Without `full`, rows carry the same small `prison_details` summary as the main list                                                                                                                                                                                                                                                                                                                                                                 |
| Chapters (list, by id)       | `supported_prisoners` (each with a `PrisonerSupport.description`), `relay_prisons`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Chats (list, by id, by pair) | `messages` (each with `relay_group`), `user_details` (the writer as everyone in the thread may see them: `id`, `name`, `username`, `bio`, `role`, `chapterId`, `managedBy`, `claimedAt`, `anonymousForChapter`, `publicKey`; no email, no manager's note), `prisoner_details` (with `prison_details`; staff-only fields only for staff). Without `full`, every chat row still carries a light `prisoner_details` (`id`, `birthName`, `chosenName`, `status`, `prison`) with `prison_details` (`id`, `prisonName`, `country`) |
| Messages                     | On the single read: `relay_group`, `status_history`, `attachments`. Every message row carries `relay_group` (`{ id, name }` or `null`) regardless of `full`; lists ignore `full` otherwise                                                                                                                                                                                                                                                                                                                                   |

Embedded users never include the password hash. For anonymous and `user`-role callers, embedded prisoners, prisons, and chapters are limited to published ones, chats are never embedded, and the staff-only `verificationNotes` field is omitted from prisoners and prisons everywhere.

### Deletes and referential integrity

Foreign keys are enforced with `RESTRICT`. Deleting a record that other records still reference fails with status `400` and `"name": "SequelizeForeignKeyConstraintError"`:

- A prisoner with chats or messages.
- A prison with prisoners.
- A chat with messages, **except** through `DELETE /chat/chat`, which deletes the chat's messages first.

A **user is the exception**: `DELETE /auth/user` removes the account together with its threads and letters (see [DELETE /auth/user](#delete-authuser)).

Creating or updating a record that points at a nonexistent user, prisoner, chat, or prison fails the same way.

## Endpoint reference

The **Auth** column says who may call the endpoint: _Public_ (no token needed; directory reads show published records only without a staff token), _Any_ (any valid token), _Admin or chapter_, _Admin_, _Self or admin_ (your own record, or an admin), _Group_ (a `chapter` account that belongs to a group, or an admin), _Scoped_ (any token; a `user` sees their own threads, a `chapter` its group's managed writers' threads, an admin everything).

### Users

| Method | Path                         | Auth                  | Purpose                                                                                       |
| ------ | ---------------------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| POST   | `/auth/user`                 | Public                | Register (role `user`); admins may set other roles                                            |
| POST   | `/auth/login`                | Public                | Log in and receive a token                                                                    |
| POST   | `/auth/logout`               | Any                   | End this token, or every token for the account with `{"everywhere": true}`                    |
| POST   | `/auth/revoke`               | Admin                 | End every token for an account without banning it                                             |
| GET    | `/auth/users`                | Admin                 | List users, optionally by role                                                                |
| GET    | `/auth/user`                 | Self or admin         | Get one user by id, email, or username; a group may read its unclaimed writers                |
| PUT    | `/auth/user`                 | Self or admin         | Update a user; a group may edit its unclaimed writers' name, email, note                      |
| DELETE | `/auth/user`                 | Self or admin         | Delete a user; a group may delete its unclaimed writers                                       |
| POST   | `/auth/writer`               | Group                 | Create a managed writer under the caller's group                                              |
| GET    | `/auth/writers`              | Group                 | List the group's managed writers (admins: all, or `?chapter=`)                                |
| POST   | `/auth/writer/token`         | Group                 | Generate or regenerate a writer's claim token                                                 |
| DELETE | `/auth/writer/token`         | Group                 | Revoke a writer's claim token                                                                 |
| GET    | `/auth/claim`                | Public                | Check a claim token                                                                           |
| POST   | `/auth/claim`                | Public                | Claim a managed account                                                                       |
| GET    | `/auth/keys`                 | Any                   | The caller's key bundle (wrapped private key, salts, KDF parameters, group key)               |
| PUT    | `/auth/keys`                 | Any                   | Set the public key once; re-wrap the private key (password change, recovery code)             |
| GET    | `/auth/public-key`           | Any                   | A user's or group's public key, to seal an envelope to                                        |
| GET    | `/auth/recover`              | Public                | Start password recovery: recovery-wrapped key plus a sealed challenge                         |
| POST   | `/auth/recover`              | Public                | Finish recovery with the opened challenge and a re-wrapped key                                |
| PUT    | `/auth/chapter-keys`         | Group member or admin | Give a group its keypair (once) and the first member the wrapped group key                    |
| PUT    | `/auth/member-key`           | Key holder or admin   | Hand the wrapped group key to a member                                                        |
| DELETE | `/auth/member-key`           | Key holder or admin   | Stop handing it out (does not revoke a key already opened; the last holder cannot be removed) |
| GET    | `/auth/member-keys`          | Group member or admin | Which members hold the group key                                                              |
| GET    | `/auth/chapter-rotation`     | Key holder            | Everything sealed to the group key, for re-sealing                                            |
| POST   | `/auth/chapter-rotation`     | Key holder            | Replace the group keypair; members left out lose access                                       |
| GET    | `/auth/encryption-readiness` | Admin                 | Who still has to set up keys, and whether the switch to e2e can go ahead                      |

#### User fields

| Field                      | Rules                                                                                                                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `username`                 | Required, unique, 3 to 16 characters. Names starting `anon-` or `writer-` are kept for the accounts groups manage, and so are `@managed.example` addresses.                                                                                                                      |
| `password`                 | Required, 7 to 255 characters. Stored as a bcrypt hash. Never returned by any endpoint.                                                                                                                                                                                          |
| `email`                    | Required, unique, must look like an email address.                                                                                                                                                                                                                               |
| `role`                     | `admin`, `user`, `chapter`, or `banned`. Case-insensitive. Defaults to `user`. Only an admin may set anything else or change it later.                                                                                                                                           |
| `name`                     | Optional display name, 3 to 32 characters.                                                                                                                                                                                                                                       |
| `bio`                      | Optional, 12 to 2400 characters.                                                                                                                                                                                                                                                 |
| `managedBy`                | Id of the group holding this account in custody (a managed writer). `null` for independent accounts and once claimed. Admin-only to set directly.                                                                                                                                |
| `claimedAt`, `claimedFrom` | When the writer claimed the account and from which group; both `null` until then. Read-only.                                                                                                                                                                                     |
| `anonymousForChapter`      | Set on the one anonymous-writer account each group gets; see [Managed writers](#managed-writers). Read-only.                                                                                                                                                                     |
| `managerNote`              | Free-text note the managing group keeps about a writer. Returned only to admins and to the managing group; absent from every other response.                                                                                                                                     |
| `retentionDays`            | How long this writer's letters and replies stay after mailing, in days; `null` means the site default and `0` means forever (unless the site caps it). Set by the account holder, or by the managing group for its unclaimed and anonymous writers. See [Retention](#retention). |
| `chapterId`                | Id of the chapter (group) this account belongs to. Only an admin can set it, on create or update; anyone else's value is ignored on registration and refused with `403` on update.                                                                                               |

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

See [Logging in](#logging-in). `username` and `password` go in the JSON body, as text. In the URL they would be written to access logs, so that is a `400`.

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

Delete an account **and everything the person wrote or received through it**: every letter whatever its status (queued, printed, or mailed), every reply recorded for them, the attachments and their files, the envelopes, the status history, and the threads. It cannot be undone, and nothing is kept: the username and email are free again at once.

Body: `{"id": 43, "password": "…"}`.

| Who                         | May delete                                                                   | `password`                                                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anyone                      | Their own account                                                            | **Required**: the account's current password, so that a borrowed phone or a stolen token is not enough. A wrong one is a `403` and deletes nothing; guesses are limited like failed sign-ins (`429`). |
| A group's `chapter` account | The group's **unclaimed** managed writers, with the letters written for them | Not needed                                                                                                                                                                                            |
| Admin                       | Anyone else                                                                  | Not needed                                                                                                                                                                                            |

```json
{
	"data": { "deleted": 1, "letters": 3, "replies": 1, "attachments": 1, "threads": 2 },
	"info": "Successfully deleted user.",
	"success": true,
	"status": 200,
	"name": "user remove"
}
```

What goes with the account: its devices, notification feed, claim tokens, idempotency keys, and its copy of a group key. What stays, without the person's name on it: what they did as staff (audit entries, proposals and decisions, invitations, status changes on other people's letters). The audit log records that an account was deleted, by whom (`self`, `group`, or `admin`), and how many letters went; it never records the username. Every token of the account stops working with the request.

Refused with `409` `AccountDeleteError`:

- **the only admin account** (make another admin first);
- **the last holder of a group's key** in end-to-end mode (hand the key to another member with `PUT /auth/member-key` first, or the group could never read its letters again);
- **a group's shared anonymous account**, for everyone: it holds the anonymous letters of all the people the group wrote for.

Clients should say in words what will happen before sending this, and in end-to-end mode remind the person that their recovery code and keys become useless.

### Managed writers

A group often writes on behalf of people who have no account: someone at a letter-writing night, or someone who wants the group to handle everything. A **managed writer** is a `user` account the group creates for such a person. Until the writer claims it:

- The account cannot log in. It has a generated username (`writer-…`), an unguessable password, and, if no email was given, a placeholder address ending in `@managed.example`.
- The group's `chapter` accounts see its threads, send letters as it, record prisoner replies, and may edit its `name`, `email`, and `managerNote` or delete it.
- The group can hand the writer a **claim token** (valid 72 hours, shown once). The writer visits the claim page, picks a username and password, and the account becomes theirs: the group loses access to it and its threads, and `claimedAt` / `claimedFrom` record the hand-over.

Every group also has one **anonymous writer**, created the first time a `chapter` account sends a letter or creates a chat without naming a `user`. It appears in the writers list like a managed writer, and all of the group's anonymous letters share it. **It can never be claimed**: it is not one person, and whoever claimed it would own the anonymous letters of everyone the group ever wrote for, and receive the next ones. `POST /auth/writer/token` for it is a `409` (`ClaimError`), and it never has keys. When someone who wrote anonymously wants an account of their own, create a managed writer for them (`POST /auth/writer`), send their next letters under it, and hand that account over; their earlier anonymous letters stay with the group.

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

Public. Body: `{"token": "…", "username": "sam", "password": "longenough", "email": "sam@example.com"}`. `username` and `password` are required and follow the [user field rules](#user-fields); `email` is optional and replaces a placeholder address. On success (`201`) the account is independent: `managedBy` is `null`, `claimedAt` and `claimedFrom` are set, the token is marked used, and the writer can log in. Validation failures (a short password, a taken username) leave the token usable. Of two requests with the same token, one wins and the other gets `410`.

### End-to-end mode

Everything in this section applies only when `ENCRYPTION_MODE=e2e`. The primitives are libsodium's: X25519 keypairs, sealed boxes (`crypto_box_seal`) for envelopes and wrapped keys, XChaCha20-Poly1305 (`crypto_aead_xchacha20poly1305_ietf`, no associated data; not `crypto_secretbox`, which is XSalsa20) for bodies and files. The server never runs a key derivation; the client chooses one (the design recommends Argon2id) and stores its salt and parameters beside each wrapped key as `kdfSalt` / `kdfParams`. The parameters are opaque to the server except for their shape: an object with a string `kdf` naming the function, otherwise a `400`. The agreed schema, shared by the web and Android clients so an account made on one unlocks on the other, is `{ "kdf": "argon2id", "alg": 2, "opslimit": 2, "memlimit": 67108864 }`: `alg` is libsodium's algorithm id (Argon2id 1.3 is 2) so a future library default cannot silently change how an old key was wrapped, and the costs are stored per account so they can be raised later without touching existing accounts. The same shape applies to `recoveryKdfParams` and `claimKdfParams`.

#### What it protects against, and what it does not

A key made on one device works on another because the private key lives on the server, locked: every client fetches the same bundle (`wrappedPrivateKey`, `kdfSalt`, `kdfParams`) and opens it with a key derived from the same password. The server never sees that derived key, a recovery code, a claim secret, or an unlocked private key.

| Threat                                                        | Protected? |
| ------------------------------------------------------------- | ---------- |
| The database or a backup is stolen                            | Yes        |
| An admin, or the hosting company, browses the data            | Yes        |
| A demand for stored data                                      | Yes        |
| The running server is modified to record passwords at sign-in | **No**     |

The last row is a real limit of what is built. `POST /auth/login` receives the password itself (it has to, to check it against the bcrypt hash), and the password is what the locking key is derived from. A server that has been tampered with could therefore record a password and unlock that account's private key. The fix is for clients to derive two values from the password, one to sign in with and one that locks the key and never leaves the device; it changes the sign-in contract for every client, so it is a proposal under discussion rather than something the API can do alone. Until it is adopted, do not describe this mode as protecting against a compromised server. Two limits no API change removes: a web client runs whatever code its host serves, and the server always sees who writes to whom and when.

#### Account keys

Register with the key fields (`publicKey`, `wrappedPrivateKey`, `kdfSalt`, `kdfParams`, `recoveryWrappedPrivateKey`, `recoverySalt`, `recoveryKdfParams`) or set them afterwards with `PUT /auth/keys`. The public key can be set once and never changes; every envelope is sealed to it. Login returns the caller's key bundle under `keys`, and `GET /auth/keys` returns it again:

```json
{
	"publicKey": "…",
	"wrappedPrivateKey": "…",
	"kdfSalt": "…",
	"kdfParams": { "kdf": "argon2id", "alg": 2, "opslimit": 2, "memlimit": 67108864 },
	"hasRecovery": true,
	"orgKey": {
		"chapterId": 1,
		"chapterName": "Portland ABC",
		"chapterPublicKey": "…",
		"wrappedOrgPrivateKey": "…"
	}
}
```

User records never carry wrapped keys; only `publicKey` is visible, and `GET /auth/public-key?user=` or `?chapter=` fetches one to seal to. `PUT /auth/user` refuses key fields (use `PUT /auth/keys`), and in e2e mode a password change through it must carry `wrappedPrivateKey`, `kdfSalt`, and `kdfParams` re-wrapped under the new password; an admin cannot reset the password of an account that has keys (recovery is the path).

#### Group keys

A group's first member calls `PUT /auth/chapter-keys` with the group's new `publicKey` and the group private key sealed to their own public key (`wrappedOrgPrivateKey`); an admin may do it naming the member with `user`. From then on any member holding the group key hands it to another member with `PUT /auth/member-key` (sealing it to that member's public key; send `keyVersion`, the version of the group key you wrapped, and a copy of a key that was rotated away meanwhile is refused with `409` instead of stored). The group key is only ever handed to `chapter`-role accounts of that group. `DELETE /auth/member-key` stops the hand-out but cannot revoke a key a member already opened, and the last holder cannot be removed; rotation (below) does both. The first member must already have a public key of their own. `GET /auth/member-keys?chapter=` lists who holds it. A member reads letters addressed to the group by opening `orgKey.wrappedOrgPrivateKey` from their bundle, then the group's envelope.

Every group key has a version: `keyVersion` is `0` until the group has keys, `1` after set-up, and one more after each rotation. `GET /auth/public-key?chapter=` returns it beside the key, and so do the member's bundle (`orgKey.keyVersion`) and `GET /auth/member-keys` (with `keyRotatedAt`). The server cannot look inside a sealed box, so anything sealed to a group names the version it was sealed to: `keyVersion` on a group envelope, `orgKeyVersion` beside a writer's `orgWrappedPrivateKey`. A missing version is a `400`; a version the group has rotated away is a `409` named `KeyVersionError`, and the client fetches the public key again, re-seals, and retries. A group with no keys cannot be sealed to (`400`).

#### Rotating a group key

Rotation replaces the group's keypair, and it is how a member is really removed: whoever is left out of the new key can open nothing stored from then on. Only a member who holds the group key can do it, because every item has to be opened with the old key; an admin cannot.

1. `GET /auth/chapter-rotation?chapter=` returns `keyVersion`, the current `publicKey`, `envelopes` (`id`, `message`, `wrappedKey` for every letter the group can read), `writers` (`id`, `orgWrappedPrivateKey` for every unclaimed writer whose keypair the group holds), and `members` (`id`, `publicKey`, `holdsGroupKey`).
2. The client generates a new group keypair, opens each `wrappedKey` and `orgWrappedPrivateKey` with the old group key and seals it to the new public key, and seals the new group private key to each member who keeps access.
3. `POST /auth/chapter-rotation` sends it all at once:

```json
{
	"chapter": 3,
	"keyVersion": 1,
	"publicKey": "<new group public key>",
	"envelopes": [{ "id": 41, "wrappedKey": "<re-sealed>" }],
	"writers": [{ "id": 12, "orgWrappedPrivateKey": "<re-sealed>" }],
	"members": [{ "user": 7, "wrappedOrgPrivateKey": "<new group private key sealed to user 7>" }]
}
```

The server applies it in one transaction or not at all. It answers `200` with the new `keyVersion`, counts, the `members` who now hold the key, and the holders `removed`. It refuses with `400` for a malformed body, the current public key sent as the new one, an empty `members`, or a member who is not in the group; `403` for anyone but a key holder of that group; `409` `KeyVersionError` when `keyVersion` is not the current one (someone else rotated first); and `409` `RotationIncompleteError` when the envelopes or writers sent are not exactly the ones the group holds, which is what happens when a letter arrives or a writer claims their account between steps 1 and 3. After either `409`, start again from step 1.

What rotation cannot do: the server checks that everything was re-sealed, not that it was re-sealed correctly, so the client should open one re-sealed item with the new key before posting. And a member who copied content keys or the old private key before leaving can still read the letters they already had; rotation protects everything stored or sent afterwards. Clients holding the old public key get a `409` on their next send and recover by fetching the new one.

#### Sending and reading letters

`POST /messaging/message` takes `ciphertext`, `nonce`, optional `relayNoteCiphertext` and `relayNoteNonce`, and `envelopes` (each `{ readerType, readerId, wrappedKey }`, plus `keyVersion` when the reader is a group). The server checks the readers: the writer (required once the writer has a public key; never for a group's anonymous writer), the relay group (required when the letter has one), the group managing the writer, and any active relay group of the facility. Anything else is a `400`. `messageText` is refused.

Ciphertext and nonce always travel as a pair, for the body and for the relay note. In e2e mode a letter's `user`, `prisoner`, and `relayChapter` cannot change after sending, because the envelopes fix its readers; forward instead. Every read returns `ciphertext`, `nonce`, and `envelopes` filtered to the caller: a writer gets their own; a group member gets the group's, plus the envelopes of unclaimed writers the group manages (it holds their sealed keys); admins get them all but can open none. `last_message` on chat rows carries the same, and a thread's embedded messages are limited to the ones the caller holds an envelope for (a group that was forwarded one letter does not receive the rest of the thread's ciphertext). Editing a queued letter means sending new `ciphertext` and `nonce` under the same content key.

`POST /messaging/envelope { message, readerType, readerId, wrappedKey, keyVersion }` lets a current reader forward the letter to one more permitted reader, typically a partner relay group (`keyVersion` is that group's): `201`, `400` for a reader the letter may not have, `403` for a caller without an envelope, `409` if that reader already has one or has rotated its key. In server mode this endpoint is a `409`.

A **writer who has no keys yet** (they have not signed in since the switch) can still receive a reply: the group records it with the group's envelope alone, and an envelope for a writer without a public key is a `400`. The writer sees that the letter exists, with `envelopes: []`, and cannot open it until they set up keys and a member of the group adds their envelope. `GET /messaging/envelopes/missing` (a member of an active group) lists what is waiting: `[{ message, chat, readerType: "user", readerId, publicKey, wrappedKey, keyVersion }]`, where `wrappedKey` is the group's own envelope for that letter. The member's client opens it, seals the content key to `publicKey`, and posts it to `/messaging/envelope`. Group clients should do this quietly after sign-in.

#### Attachments

Encrypt the file with the letter's content key and upload the ciphertext with a `nonce` form field; the declared type describes the plaintext and is not sniffed. Downloads return the ciphertext as `application/octet-stream` with an `X-Encrypted: e2e` header, and every attachment row carries its `nonce`.

#### Managed writers and claiming

The group's browser generates the writer's keypair: `POST /auth/writer` requires `publicKey`, `orgWrappedPrivateKey` (the private key sealed to the group), and `orgKeyVersion` (the group key version it was sealed to; the same goes for setting `orgWrappedPrivateKey` through `PUT /auth/user`), and `GET /auth/writers` returns `orgWrappedPrivateKey` to the managing group so it can read and print for the writer. Giving an existing writer their **first** keys is for a member who holds the group key (whoever makes a keypair knows its private half, and the writer's earlier letters are sealed to it next). A keyed writer cannot be moved to another group by an admin: the key is sealed to the group that has it. The browser also makes the claim token: `POST /auth/writer/token` takes `tokenHash` (SHA-256 hex of the upper-cased token), `claimWrappedPrivateKey`, `claimSalt`, and `claimKdfParams`; the response has no token, because the server never learns it. `GET /auth/claim?token=` returns that material with the writer's `publicKey`, and `POST /auth/claim` requires the private key re-wrapped under the new password and a recovery code. Claiming clears the group's sealed copy; the group keeps the envelopes it already holds on letters it relayed.

#### Latecomers

Nobody has to be chased for keys. When an account first becomes able to read what is sealed to it (`PUT /auth/keys` with its first `publicKey`, which must come with `wrappedPrivateKey`, `kdfSalt`, and `kdfParams`; a bare public key is a `400`, because letters sealed to it could never be opened), when a group gets its key (`PUT /auth/chapter-keys`), and when a group gives an unclaimed writer keys (`PUT /auth/user`, where the first `publicKey` must come with `orgWrappedPrivateKey` and `orgKeyVersion` for the same reason), the API seals to that reader every letter it still holds a key for and they are a reader of, then answers with `caughtUp: { letters, sealed, dropped }` (`null` once `ENCRYPTION_KEY` has been removed, because then there is nothing the server could open). In e2e mode it also drops its own copy of a letter as soon as every required reader has theirs. This works in both modes, so people pick up their old letters as they sign in, before or after the switch.

`GET /auth/encryption-readiness` (admin) answers "can we switch, and who is missing":

```json
{
	"mode": "server",
	"serverKeyConfigured": true,
	"ready": false,
	"blockers": [
		"Group 3 (Riverside ABC) relays mail and has no group key: after the switch nobody could send through it."
	],
	"groups": {
		"active": 4,
		"withKey": 3,
		"withoutKey": [
			{
				"id": 3,
				"name": "Riverside ABC",
				"networkRole": "relay",
				"relayFacilities": 2,
				"members": 2,
				"membersWithKeys": 1,
				"blocksTheSwitch": true
			}
		],
		"membersWaitingForGroupKey": [],
		"unclaimedWritersWithoutKeys": [{ "id": 1, "name": "Test Chapter", "writers": 4 }]
	},
	"writers": { "total": 40, "withKeys": 31, "withoutKeys": 9, "withoutKeysWithLetters": 6 },
	"letters": { "serverHeld": 12, "waitingForWriters": 6, "waitingForGroups": 1 }
}
```

`ready` is the only hard requirement: every active group that relays mail (its `networkRole` is not `collecting`, or it is attached to a facility) has a group key, because nothing can be sealed to a group without one. Writers without keys block nothing. The operator's steps are in [docs/E2E-MIGRATION.md](docs/E2E-MIGRATION.md).

#### Recovery

`GET /auth/recover?username=` returns the recovery-wrapped private key and a random challenge sealed to the account's public key, valid ten minutes and single use. The browser unwraps the key with the recovery code, opens the challenge, and calls `POST /auth/recover` with `username`, the opened `challenge` (base64), the new `password`, and the private key re-wrapped under it (optionally a new recovery pair). A wrong or stale challenge is a `401`. Only the holder of the recovery code can complete this; the server learns nothing.

### Prisons

| Method | Path                 | Auth             | Purpose                                                  |
| ------ | -------------------- | ---------------- | -------------------------------------------------------- |
| POST   | `/prison/prison`     | Admin or chapter | Create a prison                                          |
| GET    | `/prison/prisons`    | Public           | List prisons                                             |
| GET    | `/prison/prison`     | Public           | Get one prison by id                                     |
| PUT    | `/prison/prison`     | Admin or chapter | Update a prison                                          |
| GET    | `/prison/mail-rules` | Public           | The master list of mail rules: tags, categories, wording |
| POST   | `/prison/mail-rule`  | Admin            | Add a rule to the master list                            |
| PUT    | `/prison/mail-rule`  | Admin            | Reword, recategorise, retire, or restore a rule          |
| DELETE | `/prison/mail-rule`  | Admin            | Delete a rule no facility carries                        |
| PUT    | `/prison/relay`      | Admin or chapter | Attach a relay group to a prison                         |
| DELETE | `/prison/relay`      | Admin or chapter | Detach a relay group from a prison                       |
| DELETE | `/prison/prison`     | Admin or chapter | Delete a prison                                          |

#### Prison fields

| Field               | Type     | Notes                                                                                                                                                                                           |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisonName`        | string   | Required.                                                                                                                                                                                       |
| `country`           | string   | Free text.                                                                                                                                                                                      |
| `routing`           | string   | How mail reaches the facility: `direct`, `scan_only`, `direct_and_scan`, or `relay_only`.                                                                                                       |
| `scanService`       | string   | Details of the scan service, if any.                                                                                                                                                            |
| `mailRules`         | array    | The tags of this facility's rules, each one an entry of the [master list](#mail-rules). Default `[]`. Read in master-list order; `mail_rule_details` carries the same rules with their wording. |
| `pageLimit`         | integer  | Most single-sided pages per letter; `null` for no limit. At least 1.                                                                                                                            |
| `photoLimit`        | integer  | Most loose photographs per envelope; `null` for no stated limit. At least 1. Cannot be set on a facility tagged `no_photos`.                                                                    |
| `mailLanguages`     | array    | Two-letter ISO 639-1 codes, lower case, that mail must be written in, for example `["en", "es"]`; `null` or `[]` for no restriction.                                                            |
| `notes`             | string   | Public notes, e.g. delivery risk.                                                                                                                                                               |
| `verifiedBy`        | integer  | Id of the chapter that last verified the record. Must exist.                                                                                                                                    |
| `verifiedAt`        | datetime | When it was verified.                                                                                                                                                                           |
| `verificationNotes` | string   | **Staff only.** Never returned to anonymous or `user`-role callers.                                                                                                                             |
| `recordStatus`      | string   | `draft`, `pending`, or `published` (default). Staff only. See [Record status](#record-status).                                                                                                  |
| `address`           | object   | Required. Free-form JSON; the seeds use `{"street": "..."}`.                                                                                                                                    |

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
		"country": "United States",
		"routing": "direct",
		"mailRules": ["return_address_required", "full_name_and_number", "no_polaroids"],
		"pageLimit": 10,
		"photoLimit": 5,
		"mailLanguages": ["en", "es"],
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
		"relay_groups": []
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

#### Mail rules

There is one master list of mail rules, and a facility has one or more of them. A facility never has rule text of its own: `mailRules` on a facility is a list of references into the master list, written as each rule's `tag`. `"only_english"` and `"english_only"` cannot both exist, because a tag that is not on the list is refused, and the list itself refuses a second rule that says what an existing one says.

The master list is a database table (`MailRules`), and the link between a facility and its rules is a join table with foreign keys (`PrisonMailRules`), so the database enforces it as well as the API. Three rules carry a value rather than a yes or no, and are typed fields on the facility instead: `pageLimit`, `photoLimit`, and `mailLanguages`. So "English only" is `mailLanguages: ["en"]`, not a rule on the list.

##### The master list

```bash
curl -s http://localhost:3000/prison/mail-rules
```

```json
{
	"data": {
		"categories": [
			"addressing",
			"paper_and_ink",
			"content",
			"photos",
			"enclosures",
			"publications",
			"senders",
			"handling"
		],
		"rules": [
			{
				"id": 20,
				"tag": "no_polaroids",
				"category": "photos",
				"label": "No polaroids",
				"description": "Instant-film photographs are refused because the backing can hide contraband.",
				"retired": false
			}
		],
		"conflicts": [["typed_letters_allowed", "handwritten_only"]],
		"parameters": {
			"pageLimit": { "type": "integer", "minimum": 1, "label": "Page limit", "description": "..." },
			"photoLimit": {
				"type": "integer",
				"minimum": 1,
				"label": "Photo limit",
				"description": "..."
			},
			"mailLanguages": {
				"type": "array",
				"items": "ISO 639-1 language code, lower case",
				"label": "Accepted languages",
				"description": "..."
			}
		}
	},
	"success": true,
	"status": 200,
	"name": "prison mailRules"
}
```

(`rules` abbreviated. A new database starts with 39 rules, put there by a migration, so production has them too; they are not seed data.) Rules are listed category by category, in the order of `categories`, which is also the order a facility's `mailRules` come back in. `label` and `description` are default English wording; a client with its own translations keys them on `tag`, which never changes. Because admins can add rules, a client should fetch this list rather than compile it in, and show the `label` for a tag it has no translation for. Retired rules are left out; staff get them too with `?retired=true`.

##### A facility's rules

Every facility read carries `mailRules` (the tags) and `mail_rule_details` (the same rules with `id`, `tag`, `category`, `label`, `description`, `retiredAt`), including a facility embedded in a prisoner or group read. Rules are set with the ordinary `POST /prison/prison` and `PUT /prison/prison` (admin or chapter), and proposed by anyone signed in through [moderation](#moderation), like any other facility field:

```bash
curl -s -X PUT http://localhost:3000/prison/prison \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":1,"mailRules":["no_polaroids","ink_blue_or_black"],"pageLimit":10,"mailLanguages":["en","es"]}'
```

`mailRules` is replaced whole, so send the full list. A `400` follows a tag that is not on the master list, a duplicate, both tags of a conflicting pair, a retired rule the facility does not already have, a limit below 1, a language that is not a two-letter lower-case code, or `photoLimit` on a facility tagged `no_photos`. `GET /prison/prisons?mailRule=no_photos` and `?language=es` filter the list (see [Searching, filtering, and sorting lists](#searching-filtering-and-sorting-lists)).

##### Changing the master list (admin)

```bash
curl -s -X POST http://localhost:3000/prison/mail-rule \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"tag":"no_crayon","category":"paper_and_ink","label":"No crayon","description":"Letters or drawings in crayon are refused."}'
```

| Field         | Notes                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `tag`         | Required, unique, lower_snake_case, 3 to 40 characters. **Never changes once created**, because clients key translations and icons on it. |
| `category`    | Required; one of `categories`.                                                                                                            |
| `label`       | Required, 3 to 80 characters.                                                                                                             |
| `description` | Optional.                                                                                                                                 |

`POST` returns `201` with the rule. It answers `409` `DuplicateRuleError`, naming the existing rule, when the list already says the same thing in other words: the same words in another order (`only_english` beside `english_only`), a singular for a plural (`no_polaroid` beside `no_polaroids`), or a label that matches an existing tag or label that way. That check catches slips, not synonyms ("No instant photos" would pass), which is why only admins can add rules.

`PUT /prison/mail-rule {"id": 40, "label": "...", "category": "...", "description": "...", "retired": true}` rewords, recategorises, retires, or restores a rule, and returns it with `prisons`, the number of facilities that carry it. Facilities hold a link, not a copy, so new wording shows everywhere at once. Sending a different `tag` is a `409` `RuleTagError`. A **retired** rule stays on the facilities that have it and can be kept through edits, but cannot be added to another facility and leaves the public list.

`DELETE /prison/mail-rule {"id": 40}` works only for a rule no facility carries; otherwise it is a `409` `RuleInUseError` that says how many do, and the rule should be retired instead. Deleting a facility removes its links, never a rule. All three are recorded in the audit log (`mail-rule.create`, `.update`, `.delete`).

#### PUT /prison/relay and DELETE /prison/relay

Body: `{"prison": 1, "chapter": 2}`. Attaches or detaches a relay group (a chapter that prints and mails letters for this facility). Attaching is idempotent and returns the prison with `prisoners` and `relay_groups` embedded under `updatedRows`; detaching returns `1`, or `404` if there was no link.

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

**When an edit moves or frees someone** (a new `prison`, or `status` becoming `free`), by a direct edit or by an approved proposal, their writers' mail follows (see [Moved and freed](#moved-and-freed)), and the answer says what this edit did under `mail` (`held` and `released` count letters it newly held or let go): `{ "moved": true, "freed": false, "rerouted": 1, "held": 0, "released": 0 }`.

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

Chats are ordered by most recent message first; chats with no messages come last. Every row carries `prisoner_details` (`id`, `birthName`, `chosenName`, `status`, `prison`) with a nested `prison_details` (`id`, `prisonName`, `country`) so an inbox line can name the person and the facility without another request (`null` for a non-staff caller when the record is not published, like every other embed); `full=true` replaces it with the complete prisoner and adds `user_details` and `messages`. Every row also carries two extra fields for inbox views:

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
				"bio": null,
				"role": "user",
				"chapterId": null,
				"managedBy": null,
				"claimedAt": null,
				"anonymousForChapter": null,
				"publicKey": null
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

Body: `{"id": 1, "prisoner": 5}`; only `user` and `prisoner` can change. For the writer, the group that manages the writer, or an admin: a group that only mails a letter in the thread can read it and gets a `403` here. A `user` may not move a chat to another user, and nobody but an admin moves a thread that already has letters (each letter names its own writer and prisoner). Nonexistent ids are refused.

#### DELETE /chat/chat

Body: `{"id": 41}`. Deletes the chat's messages, then the chat. Returns `"data": 1`. For the writer, the group that manages the writer, or an admin (not a group that only mails the thread), and, as with a single letter, only an admin deletes a thread that holds a `printed` or `mailed` letter.

### Messages

| Method | Path                           | Auth                 | Purpose                                                                     |
| ------ | ------------------------------ | -------------------- | --------------------------------------------------------------------------- |
| POST   | `/messaging/message`           | Scoped               | Send a message (creates the chat if needed)                                 |
| GET    | `/messaging/messages`          | Scoped               | List messages                                                               |
| GET    | `/messaging/message`           | Scoped               | Get one message by id                                                       |
| PUT    | `/messaging/message`           | Scoped               | Update a message (while still queued, unless admin)                         |
| PUT    | `/messaging/status`            | Relay group or admin | Move a letter to `printed` or `mailed`                                      |
| DELETE | `/messaging/message`           | Scoped               | Delete a message (while still queued, unless admin)                         |
| POST   | `/messaging/attachment`        | Scoped               | Upload a file to a message (multipart)                                      |
| GET    | `/messaging/attachments`       | Scoped               | List a message's attachments                                                |
| GET    | `/messaging/attachment`        | Scoped               | Download one attachment                                                     |
| GET    | `/messaging/retention`         | Any                  | The retention rules and the window that applies to the caller               |
| GET    | `/messaging/envelopes/missing` | Group (e2e)          | Letters the group can open whose writer has keys by now and no envelope yet |
| DELETE | `/messaging/attachment`        | Scoped               | Delete one attachment                                                       |

The scope is the same as for chats: own messages for a `user`; the group's managed writers' messages plus the letters the group relays for a `chapter` account; everything for an admin.

#### Letter lifecycle

Every message carries a `status`:

| Status     | Meaning                                             | Set by                                                      |
| ---------- | --------------------------------------------------- | ----------------------------------------------------------- |
| `queued`   | Written, waiting for the relay group to print it    | The server, on every new letter (`sender: user`)            |
| `printed`  | Printed by the relay group                          | `PUT /messaging/status` by the relay group or an admin      |
| `mailed`   | In the post                                         | Same, from `printed` only                                   |
| `received` | A prisoner reply, transcribed or scanned by a group | The server, on every reply (`sender: prisoner`)             |
| `returned` | The post brought it back. Carries `returnReason`    | `PUT /messaging/status` with a `reason`, from `mailed` only |

Moves are forward only: `queued` to `printed` to `mailed`, and from `mailed` to `returned` if the letter comes back. Anything else, including moving a reply, is a `409` with `"name": "LetterStatusError"`. Every change is recorded: `statusChangedAt` and `statusChangedBy` on the message, and a history you can read with `full=true` on `GET /messaging/message`.

While a letter is `queued` its writer may still edit or delete it. Once printed, only an admin can. Replies stay editable by whoever can see them.

**Returned mail.** Prison mail comes back: refused, the person was moved or released, the address was wrong. The relay group (or an admin) records it with `PUT /messaging/status {"id": 41, "status": "returned", "reason": "transferred", "note": "Stamped NOT HERE"}`. `reason` is required and one of:

| `reason`         | Meaning                                               |
| ---------------- | ----------------------------------------------------- |
| `refused`        | The mail room would not pass it on, and named no rule |
| `rule_violation` | It broke one of the facility's mail rules             |
| `transferred`    | The person is held somewhere else now                 |
| `released`       | The person is no longer held                          |
| `bad_address`    | Undeliverable as addressed                            |
| `unknown`        | It came back and nothing says why                     |

These are codes for clients to word in the reader's language. `note` is optional, at most 200 characters, shown to the writer, and **not encrypted in any mode**: say what the envelope said, nothing about what the letter said. The letter then carries `returnReason`, its history row carries `reason` and `note`, the writer gets a `letter.status` notification with `{ "status": "returned", "reason": "transferred" }`, and `GET /messaging/messages?status=returned` lists such letters. A returned letter is a record like a mailed one (only `keep` can change, only an admin deletes it) and retention removes it after the writer's window, counted from the day it came back.

**Sending it again.** There is no copy button on the server (in end-to-end mode it could not read the letter to copy it): the client sends a new letter with `"resendOf": 41`. That must be one of the same writer's `returned` letters to the same prisoner, or the request is a `400`. The new letter is routed afresh, so it goes wherever the directory now says the person is. Read with `full=true`, the returned letter lists what replaced it under `resent_as` (`id`, `status`, `createdAt`).

##### Moved and freed

When the directory learns that someone was **moved to another facility**:

- everyone with a thread to them gets a `prisoner.moved` notification (`{ "prisoner": 12, "prison": 7, "held": 0 }`: ids and a count, as always);
- their letters still `queued` go where a new letter would go now. The group that was going to mail one keeps it if it serves the new facility too; otherwise the letter is routed again and the new group is told it is waiting (`letter.queued`). Printed and mailed letters are on paper already and are left alone;
- where nothing can be decided for the writer, the letter is **held** (`heldReason` on the letter, `null` otherwise):

| `heldReason`    | Why                                                                                                                             | What lifts it                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `choose_relay`  | The new facility only takes relayed mail and has several relay groups, or none                                                  | The writer picks one: `PUT /messaging/message {"id": 41, "relayChapter": 3}`      |
| `reseal_needed` | End-to-end mode: the letter is sealed to a group that does not serve the new facility, and the server cannot seal it to another | The writer's client deletes the queued letter and sends it again                  |
| `prisoner_free` | They were freed (below)                                                                                                         | The group prints it on purpose, the writer deletes it, or the status is corrected |

When someone's `status` becomes **`free`**, their writers get `prisoner.status` (`{ "prisoner": 12, "status": "free", "held": 2 }`) and their queued letters are held as `prisoner_free`: a letter posted to a prison someone has left may never be forwarded. If the status goes back to `incarcerated` or `pretrial`, those holds are lifted.

A held letter stays `queued`. Moving it to `printed` is refused with `409` `LetterHeldError` unless the request says `"release": true`, so that printing it is a decision and not an oversight. `GET /messaging/messages?held=true` lists held letters (`held=false` the rest). Nobody can set or clear a hold by editing the letter.

**What returns tell the directory.** A return for `transferred`, `released`, or `bad_address` within the last 60 days, on a prisoner whose record nobody has edited since, puts that address in doubt: staff list such records with `GET /prisoner/prisoners?addressInDoubt=true`, and the moderation summary counts them (`addressInDoubt.prisoner`). Editing the record, to correct it or just to confirm it, answers the doubt. Nothing changes by itself, and the public never sees this (the parameter is ignored for them).

**Relay group.** `relayChapter` names the group that prints and mails the letter. It must be one of the facility's relay groups (see [PUT /prison/relay](#put-prisonrelay-and-delete-prisonrelay)). When the body omits it, the server picks one:

1. the caller's own group, if a `chapter` account is sending and its group relays for that facility;
2. otherwise the facility's only relay group, if it has exactly one;
3. otherwise none, unless the facility's `routing` is `relay_only`, in which case the letter is refused with a validation error telling the writer to choose a group (or that the facility has no relay group yet).

A relay group sees the letter and its whole thread, can record the prisoner's reply on it, and is the only group that can move its status. It cannot write new letters as an independent writer.

#### Message fields

| Field                                   | Type     | Notes                                                                                                                                                                                                                    |
| --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chat`                                  | integer  | Id of the chat. Set automatically from `user` + `prisoner`; do not send it.                                                                                                                                              |
| `messageText`                           | string   | The letter body. Stored encrypted; see [Encryption](#encryption).                                                                                                                                                        |
| `ciphertext`, `nonce`                   | string   | End-to-end mode only: the encrypted body and its nonce (base64), sent by the client and returned on every read.                                                                                                          |
| `relayNoteCiphertext`, `relayNoteNonce` | string   | End-to-end mode only: the relay note, encrypted with the same content key.                                                                                                                                               |
| `envelopes`                             | object[] | End-to-end mode only. On create: `[{ readerType, readerId, wrappedKey }]`, the letter's content key sealed to each reader. On reads: the envelopes this caller can open.                                                 |
| `sender`                                | string   | Required. `user` or `prisoner`. A `user`-role caller is always recorded as `user`.                                                                                                                                       |
| `user`                                  | integer  | Id of the user side. A `user`-role caller's own id is used regardless of body. A `chapter` account may name one of its group's managed writers, or omit it to send as the group's anonymous writer. Required for admins. |
| `status`                                | string   | Read-only here; see [Letter lifecycle](#letter-lifecycle). Change it with `PUT /messaging/status`.                                                                                                                       |
| `relayChapter`                          | integer  | Group that prints and mails the letter. Optional; resolved from the facility's relay groups when omitted, validated against them when given.                                                                             |
| `relay_group`                           | object   | Read-only. `{ id, name }` of the relay group, or `null`, on every message row (lists, thread reads, single reads).                                                                                                       |
| `relayNote`                             | string   | Optional instructions for the relay group (page count, language, "include the photo"). Never part of the letter.                                                                                                         |
| `statusChangedAt`, `statusChangedBy`    |          | Read-only. When the status last changed and which account changed it.                                                                                                                                                    |
| `keep`                                  | boolean  | Pinned: exempt from retention. The only field a writer may change on a mailed letter.                                                                                                                                    |
| `returnReason`                          | string   | Read-only. Why a `returned` letter came back; `null` otherwise. Set through `PUT /messaging/status`.                                                                                                                     |
| `heldReason`                            | string   | Read-only. Why a queued letter is held (`choose_relay`, `reseal_needed`, `prisoner_free`), or `null`. See [Moved and freed](#moved-and-freed).                                                                           |
| `resendOf`                              | integer  | Optional, on create only: the id of the writer's `returned` letter to the same prisoner that this one replaces.                                                                                                          |
| `prisoner`                              | integer  | Required. Id of the prisoner side.                                                                                                                                                                                       |

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

Body must include `id`; any of `messageText`, `user`, `prisoner`, `relayChapter`, `relayNote`, `keep` may follow (in end-to-end mode, the cipher fields instead of the text ones). Anything else is ignored: a letter's `sender`, `chat`, and dates never change. The writer, the group that manages the writer, or an admin may edit; a group that only mails the letter may not, except to correct a reply (`sender: prisoner`) it recorded. Partial updates work: `{"id": 1, "messageText": "Edited"}` changes only the text. In server mode, changing `user` or `prisoner` moves the message to the chat for the new pair, creating it if needed; a `relayChapter` is validated as on create, and a letter moved to another `prisoner` without one is routed again as a new letter would be. **In end-to-end mode `user`, `prisoner`, and `relayChapter` cannot change** (`400`): the letter's envelopes were sealed for the readers those three imply, and the server cannot re-seal them. Delete the queued letter and send it again, or add a reader with `POST /messaging/envelope`. `status` and the status timestamps are ignored here; use `PUT /messaging/status`. A `user`-role caller cannot change `user`. Once a letter is `printed` or `mailed`, only an admin may update it; anyone else gets a `403`.

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

Body: `{"id": 41, "status": "printed"}`, or `{"id": 41, "status": "returned", "reason": "refused", "note": "…"}` (see [Letter lifecycle](#letter-lifecycle); `reason` and `note` go with `returned` only, a `400` otherwise). A [held](#moved-and-freed) letter needs `"release": true` to be printed. Allowed for admins and for `chapter` accounts whose group is the letter's `relayChapter`; anyone else gets a `403`. Returns the message with `relay_group` and `status_history` embedded (the `full=true` shape). A move the lifecycle does not allow is a `409`:

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

Body: `{"id": 41}`. Returns `"data": 1`. The same people as an edit. Once a letter is `printed` or `mailed`, only an admin may delete it. The status is part of the delete itself, so a letter that is marked printed while the request is on its way is not deleted (`403`). The message's attachment files are removed with it.

#### Attachments

A message can carry files: a scan of a prisoner's reply, a photo enclosed with a letter, a PDF to print. Accepted types are `application/pdf`, `image/jpeg`, `image/png`, and `image/webp`; the server checks the file's leading bytes against the declared type and refuses a mismatch. One upload is limited to `UPLOAD_MAX_BYTES` (default 20 MiB).

Attachments follow the message's scope: whoever can read the message can list and download them, and whoever can edit it can add or delete them. Once a letter is `printed` or `mailed`, only an admin can add or remove its files; downloading still works.

Every attachment row looks like:

```json
{
	"id": 3,
	"message": 41,
	"originalName": "reply.pdf",
	"mimeType": "application/pdf",
	"size": 48213,
	"uploadedBy": 5,
	"createdAt": "2026-09-12T10:00:00.000Z",
	"updatedAt": "2026-09-12T10:00:00.000Z"
}
```

`GET /messaging/message?id=…&full=true` embeds the same rows under `attachments`.

#### Sending exactly once: `Idempotency-Key`

A client that retries after a lost connection, sends an outbox when it comes back online, or is clicked twice can otherwise mail a prisoner two copies of a letter. Send a header with a value the client makes up **once per letter** (a UUID is ideal) and repeat it on every retry of that letter:

```bash
curl -s -X POST http://localhost:3000/messaging/message \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 6f1c2a0e-8d1b-4a53-9c0e-2f6b7f0d9a11' \
  -d '{"messageText":"Hello","sender":"user","prisoner":1}'
```

| Situation                                                              | Answer                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First request with this key                                            | Processed as usual: `201`.                                                                                                                                                                                                                               |
| The same key again, after the first succeeded                          | `201` with the **letter the first attempt made**, as it is now (its status may have moved on), and the header `Idempotent-Replayed: true`. Nothing is created, audited, or notified twice.                                                               |
| The same key while the first is still being processed (a double click) | `409` `IdempotencyError` with `Retry-After: 1`. Try again in a second and get the letter.                                                                                                                                                                |
| The same key for a different request                                   | `422` `IdempotencyError`. "Different" means another writer, prisoner, or sender, or (server mode) another text. In end-to-end mode ciphertext is not compared, because a retry may have been encrypted afresh; the stored letter is the first attempt's. |
| The same key after the letter was deleted                              | `410`: it is not sent again.                                                                                                                                                                                                                             |
| A refused or failed first attempt (`400`, `403`, `409`, `5xx`)         | The key is free again, so the corrected request may reuse it.                                                                                                                                                                                            |
| A malformed key                                                        | `400`. Keys are 8 to 128 printable characters without spaces.                                                                                                                                                                                            |

Keys belong to the account that sent them, and are remembered for `IDEMPOTENCY_DAYS` (30). The server keeps the key, a hash of who the letter was from and to, and the id of the letter; never the letter. The header is optional, and without it nothing changes. `POST /messaging/attachment` takes it too (same letter, file name, and size must match), so a retried upload returns the file already stored. Browsers may send it and read `Idempotent-Replayed` (CORS allows both).

#### POST /messaging/attachment

`multipart/form-data` with a `message` field (the letter's id) and exactly one file in a field named `file`. Returns `201` with the attachment row.

```bash
curl -s -X POST http://localhost:3000/messaging/attachment \
  -H "Authorization: Bearer $TOKEN" \
  -F message=41 -F file=@reply.pdf
```

Failure modes, all `400` with the validation shape unless noted: a type outside the accepted list; content that does not match the declared type; a file above the size limit; no file, or a file in a field other than `file`; a missing `message`. A message the caller cannot see is a `403`; one that does not exist is a `404`.

#### GET /messaging/attachments

Parameter: `message` (required). Returns the message's attachment rows, oldest first.

#### GET /messaging/attachment

Parameter: `id` (required). Streams the file with its `Content-Type`, `Content-Length`, and a `Content-Disposition: attachment; filename="…"` header carrying the original name. A row whose file is missing from disk is a `404`.

#### DELETE /messaging/attachment

Body: `{"id": 3}`. Removes the row and the file. Returns `"data": 1`.

### Chapters

| Method | Path                | Auth             | Purpose                                          |
| ------ | ------------------- | ---------------- | ------------------------------------------------ |
| POST   | `/chapter/chapter`  | Admin or chapter | Create a chapter                                 |
| GET    | `/chapter/chapters` | Public           | List chapters                                    |
| GET    | `/chapter/chapter`  | Public           | Get one chapter by id                            |
| PUT    | `/chapter/chapter`  | Admin or chapter | Update a chapter (a chapter: only its own group) |
| DELETE | `/chapter/chapter`  | Admin or chapter | Delete a chapter (a chapter: only its own group) |

#### Chapter fields

| Field             | Type     | Notes                                                                                                                                                                                                                                                                             |
| ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`            | string   | Required.                                                                                                                                                                                                                                                                         |
| `location`        | object   | Required. Free-form JSON.                                                                                                                                                                                                                                                         |
| `prisoners`       | object   | Optional JSON blob. Not a relation. Only settable through PUT.                                                                                                                                                                                                                    |
| `lettersSent`     | string   | Optional. Only settable through PUT.                                                                                                                                                                                                                                              |
| `averageTimeDays` | integer  | Optional. Only settable through PUT.                                                                                                                                                                                                                                              |
| `subregion`       | string   | City, region, or area, e.g. "Portland, OR".                                                                                                                                                                                                                                       |
| `country`         | string   | Free text.                                                                                                                                                                                                                                                                        |
| `about`           | string   | Free text.                                                                                                                                                                                                                                                                        |
| `website`         | string   | Must be a URL.                                                                                                                                                                                                                                                                    |
| `email`           | string   | Public contact email. Must be an email address.                                                                                                                                                                                                                                   |
| `socialLinks`     | object   | Keys `instagram`, `mastodon`, `bluesky`, `x`, `youtube`; string values (empty means unset).                                                                                                                                                                                       |
| `services`        | string[] | Any of `letter_collection`, `letter_writing_nights`, `domestic_mailing`, `international_mailing`, `international_relay`, `translation_assistance`, `legal_support`, `book_programs`.                                                                                              |
| `announcement`    | string   | One current announcement for the public profile.                                                                                                                                                                                                                                  |
| `networkRole`     | string   | What the group does in the mail flow: `collecting` (gathers letters and forwards them to relay partners), `relay` (prints and mails), or `both`. Default `collecting`. A group may change its own.                                                                                |
| `accountStatus`   | string   | Network membership: `pending` (default for new groups), `active`, or `suspended`. Only an admin may set it. A `chapter` account can only act (write the directory, create writers, send or relay letters) while its group is `active`; until then it gets a `403` explaining why. |
| `vouchedBy`       | integer  | Id of the chapter that vouched this group into the network. Must exist.                                                                                                                                                                                                           |
| `recordStatus`    | string   | `draft`, `pending`, or `published` (default). Staff only.                                                                                                                                                                                                                         |

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

### Moderation

Anyone signed in can propose a new prisoner, facility, or group, or a change to an existing one. Admins review the queue and approve (optionally editing first), or reject with a reason. Every decision, and every direct staff write to the directory, lands in an append-only audit log.

| Method | Path                      | Auth               | Purpose                                                       |
| ------ | ------------------------- | ------------------ | ------------------------------------------------------------- |
| POST   | `/moderation/submission`  | Any                | Propose a new record or a change to one                       |
| GET    | `/moderation/submissions` | Any                | Admins: the queue (pending by default); others: own proposals |
| GET    | `/moderation/submission`  | Submitter or admin | One proposal, with the target's current values                |
| PUT    | `/moderation/submission`  | Submitter or admin | Revise a pending proposal                                     |
| DELETE | `/moderation/submission`  | Submitter or admin | Withdraw a pending proposal                                   |
| PUT    | `/moderation/approve`     | Admin              | Apply a proposal, with optional reviewer edits                |
| PUT    | `/moderation/reject`      | Admin              | Reject a proposal with a reason                               |
| GET    | `/moderation/audit`       | Admin              | The audit log, newest first                                   |
| GET    | `/moderation/summary`     | Admin              | Dashboard counts                                              |

#### Submission fields

| Field                                          | Notes                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resource`                                     | `prisoner`, `prison`, or `chapter`.                                                                                                                                                                                                                      |
| `kind`                                         | Set by the server: `update` when `target` was given, else `create`.                                                                                                                                                                                      |
| `targetId`                                     | The record an update proposes to change. For a create, filled in with the new record's id once approved.                                                                                                                                                 |
| `payload`                                      | The proposed field values. Only the resource's public fields may be proposed; `recordStatus`, `verifiedBy`, `verifiedAt`, `verificationNotes`, `vouchedBy`, and the group statistics are reviewer-only. `GET /moderation/summary` lists what is allowed. |
| `evidence`                                     | Free text: where the information comes from (links, documents, "I am their lawyer").                                                                                                                                                                     |
| `note`                                         | A message to the reviewer.                                                                                                                                                                                                                               |
| `status`                                       | `pending`, `approved`, `rejected`, or `withdrawn`. Only `pending` proposals can be revised, approved, rejected, or withdrawn; anything else is a `409` with `"name": "SubmissionStateError"`, including the loser of two simultaneous decisions.         |
| `submitter`, `reviewer`                        | Embedded `{ id, username, name, role }`, or `null`. Non-admins never receive the reviewer-only fields in `appliedChanges`, and `current` shows only records they could read directly.                                                                    |
| `reviewedAt`, `decisionNote`, `appliedChanges` | Set on decision. `appliedChanges` is exactly what was written: the payload plus any reviewer edits.                                                                                                                                                      |

#### POST /moderation/submission

```bash
curl -s -X POST http://localhost:3000/moderation/submission \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"resource":"prisoner","target":41,"fields":{"chosenName":"Sam","interests":["chess"]},"evidence":"Letter from counsel, 1 Sept 2026","note":"Legal name change"}'
```

Returns `201` with the submission. Omit `target` to propose a brand-new record. Either way the `fields` are run through the resource's own validation at filing, without saving anything, so a submitter hears about a problem immediately as a `400` with an `errors` array: a new record is checked whole (a prison needs `prisonName` and `address`, a group `name` and `location`), and an edit has its proposed fields checked against the target (a prisoner `status` of `flying` is refused). A reviewer-only field, an unknown resource, empty `fields`, or a `target` that does not exist (or that the caller cannot see: non-staff may only propose changes to published records) are `400` or `404` at filing time. Checks that need the database, such as a `prison` id on a new prisoner, happen when the proposal is approved.

#### GET /moderation/submissions

Parameters: `status` (`pending`, `approved`, `rejected`, `withdrawn`, or `all`), `resource`, `submittedBy` (admin only), `page`, `page_size`. Admins get every proposal, `pending` by default, oldest first. Anyone else gets their own proposals in every status. Rows carry `submitter` and `reviewer`.

#### GET /moderation/submission

Parameter: `id`. Adds `current`: for an update, the target's present values of the proposed fields (so a reviewer can see the diff); `null` for a create or a target that has since been deleted.

#### PUT /moderation/submission and DELETE /moderation/submission

Body `{"id": 7, "fields": {...}, "evidence": "...", "note": "..."}` replaces the parts given. New `fields` are validated as on filing, so an invalid value is a `400` and the proposal keeps its old payload; if the record an edit targets has since been deleted, revising its `fields` is a `404`. `{"id": 7}` on DELETE withdraws; the row stays with `status: withdrawn`.

#### PUT /moderation/approve

Body `{"id": 7, "fields": {...}, "decisionNote": "..."}`. `fields` are reviewer edits merged over the payload and may include the reviewer-only fields, so "edit then approve" and "approve and mark verified" are one call. The record is written through the same model code as a direct write, so its validation applies again here (the target may have changed since filing, and reviewer edits have not been checked yet); a failure is a `400` and the proposal stays pending. New records are created `published` unless `fields.recordStatus` says otherwise. Returns the submission with `appliedChanges`. The submitter may revise a proposal until it is decided, so send `ifUnchangedSince` (the `updatedAt` of the submission as you read it): if it was revised since, the answer is `409` `SubmissionChangedError` and nothing is applied.

#### PUT /moderation/reject

Body `{"id": 7, "decisionNote": "..."}`. The note is required.

#### GET /moderation/audit

Parameters: `actor`, `action`, `resource`, `target`, `page`, `page_size`. Newest first. Each entry is `{ id, actor, action, resource, targetId, details, createdAt, actor_details }`. Actions recorded:

| Action                                                                     | When                                                                       |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `submission.create`, `.update`, `.approve`, `.reject`, `.withdraw`         | Moderation events; `approve` also logs the resulting record write below    |
| `prisoner.create`, `.update`, `.delete`, `.support.add`, `.support.remove` | Staff writes, direct or via an approved proposal (`details.viaSubmission`) |
| `prison.create`, `.update`, `.delete`, `.relay.add`, `.relay.remove`       | Same                                                                       |
| `chapter.create`, `.update`, `.delete`                                     | Same                                                                       |
| `letter.status`                                                            | A status move (`details.from`, `details.to`)                               |
| `user.update`                                                              | An admin changed a role or group membership                                |
| `writer.create`, `writer.claim`                                            | A managed writer was created, or claimed (no actor)                        |

#### GET /moderation/summary

```json
{
	"pendingSubmissions": { "prisoner": 2, "prison": 0, "chapter": 1 },
	"records": {
		"prisoner": { "draft": 1, "pending": 0, "published": 40 },
		"prison": { "draft": 0, "pending": 2, "published": 52 },
		"chapter": { "draft": 0, "pending": 0, "published": 1 }
	},
	"staleVerification": { "prisoner": 38, "prison": 52 },
	"addressInDoubt": { "prisoner": 2 },
	"backups": {
		"configured": true,
		"count": 14,
		"newest": {
			"name": "abc-backup-20260921T031500Z.abcbak",
			"at": "2026-09-21T03:15:00.000Z",
			"bytes": 8123456
		},
		"ageHours": 7.5
	},
	"resources": {
		"prisoner": { "submittable": ["birthName", "..."] },
		"prison": { "submittable": ["..."] },
		"chapter": { "submittable": ["..."] }
	}
}
```

`staleVerification` matches the `stale=true` list filter on prisoners and prisons; `addressInDoubt` matches `addressInDoubt=true` on prisoners ([returned mail](#letter-lifecycle)). Not yet built: anonymous corrections from the public footer and site settings.

### Push notifications

A push from this API is a doorbell and nothing else. It passes through Google and Apple and may land on a lock screen, so it never carries letter text, a name, a facility, or even an id: the whole payload is `{"type": "sync"}`, the same for every event. What happened is in the account's **notification feed**, which the app fetches over its own connection after the push wakes it. In end-to-end mode the server could not put letter text in a push even if it wanted to.

What Google and Apple still learn is that the device has this app and when it is rung. That cannot be avoided with their services. A person can stay out of it by not registering a device; the feed works without push.

| Method | Path                       | Auth | Purpose                                                |
| ------ | -------------------------- | ---- | ------------------------------------------------------ |
| POST   | `/auth/device`             | Any  | Register this device for pushes, or refresh it         |
| GET    | `/auth/devices`            | Any  | The caller's devices (never their tokens)              |
| PUT    | `/auth/device`             | Any  | Mute or rename one of the caller's devices             |
| DELETE | `/auth/device`             | Any  | Stop pushes to a device                                |
| GET    | `/auth/notifications`      | Any  | The caller's feed, newest first, with the unread count |
| PUT    | `/auth/notifications/read` | Any  | Mark entries read                                      |

#### Registering

```bash
curl -s -X POST http://localhost:3000/auth/device \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"token":"<FCM registration token>","platform":"android","label":"Pixel"}'
```

`platform` is `android`, `ios`, or `web`; `provider` is `fcm` (the default, and the only one today; iOS is reached through FCM as well). The response has the device without its token, `created`, and `deliverable`: whether the API can actually send through that provider today (`GET /health` lists the same under `push`). Call this **after every sign-in, after a password change, and whenever the push service issues a new token**; registering the same token again only refreshes it. A token belongs to one account at a time: when someone else signs in on the same phone, it moves to them and the previous account stops ringing there.

Signing out removes the device that signed in; "log out everywhere", an admin's revocation, a password change, and recovery remove all of the account's devices. A token the push service reports as unregistered is forgotten. `PUT /auth/device {"id": 3, "muted": true}` silences one device without signing out.

#### What is sent

- **Android and web:** a data-only, high-priority message (for a browser, Web Push `Urgency: high`). The app or service worker wakes, fetches the feed, decrypts if needed, and words the notification itself, on the device.
- **iOS:** Apple throttles or drops silent pushes, so a visible alert goes with it: `PUSH_IOS_ALERT_TITLE` / `PUSH_IOS_ALERT_BODY` ("New activity" / "Open the app to see it."), marked `mutable-content` so the app's notification service extension can fetch the feed and replace the wording on the device.
- One collapse key, so a burst of events rings once.

A push is never awaited and never fails a request: the letter is saved first, and a missed doorbell is logged. Each request to the push service is given ten seconds, a few devices are rung at a time, and one event never waits behind another. Just before a device is rung the API checks that it is still that account's and still unmuted, so a phone that changed hands a moment ago does not ring for its previous owner.

#### The feed

```bash
curl -s 'http://localhost:3000/auth/notifications?since=41' -H "Authorization: Bearer $TOKEN"
```

```json
{
	"data": [
		{
			"id": 43,
			"event": "letter.status",
			"chat": 12,
			"message": 88,
			"submission": null,
			"detail": { "status": "mailed" },
			"readAt": null,
			"createdAt": "2026-09-19T10:02:11.000Z"
		},
		{
			"id": 42,
			"event": "letter.reply",
			"chat": 12,
			"message": 91,
			"submission": null,
			"detail": null,
			"readAt": null,
			"createdAt": "2026-09-19T09:40:00.000Z"
		}
	],
	"total": 2,
	"page": 1,
	"page_size": 10,
	"unread": 2,
	"success": true,
	"status": 200,
	"name": "notification many"
}
```

`since` is the id of the newest entry the client already has; `unread=true` filters; `page` and `page_size` work as everywhere. Entries hold ids and states, never letter content. `PUT /auth/notifications/read` takes `{"ids": [42, 43]}`, `{"upTo": 43}`, or `{}` for everything, and answers `{ "marked": 2, "unread": 0 }`. Entries are kept for `NOTIFICATION_DAYS` (30), and an entry about a letter goes when the letter does (retention, deletion).

| Event                | Who is told                                                             | `detail`                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `letter.reply`       | The writer, when a prisoner's reply is recorded on their thread         | none                                                                                                                                                     |
| `letter.status`      | The writer, when their letter is printed, mailed, or returned           | `{ "status": "printed" }`; for a return, `{ "status": "returned", "reason": "transferred" }`                                                             |
| `letter.queued`      | The members of the relay group, when a letter arrives for them to print | none                                                                                                                                                     |
| `submission.decided` | The person who proposed a change, when it is approved or rejected       | `{ "status": "approved", "resource": "prison" }`                                                                                                         |
| `prisoner.moved`     | Everyone with a thread to a prisoner whose facility changed             | `{ "prisoner": 12, "prison": 7, "held": 0 }` (`held`: how many of their queued letters to this person are waiting for them now, whenever they were held) |
| `prisoner.status`    | The same people, when the prisoner's status becomes `free`              | `{ "prisoner": 12, "status": "free", "held": 2 }`                                                                                                        |

The account that did the thing is never told about it, and accounts nobody can sign in to (unclaimed and anonymous writers, banned accounts) are skipped.

#### Turning it on

Create a Firebase project, add the Android (and later iOS) app to it, and download a **service-account key** (Project settings, Service accounts, Generate new private key). Put the JSON file somewhere outside the repository and point `FCM_SERVICE_ACCOUNT_FILE` at it. The boot log says `Push: FCM ready for project …`, and `GET /health` shows `"push": ["fcm"]`. A missing or broken file, including a private key that cannot sign, is reported at boot and the API runs on without push.

Then ask Google whether it accepts the key, without needing a phone:

```bash
npm run push:check
```

It sends one message to a deliberately fake device token. The good answer is `OK. Google accepted the credentials and the request, and refused the fake token`: Google can only say the token is invalid after accepting the service account and understanding the request, and nothing is delivered to anyone. A refusal names the cause (for example the Cloud Messaging API (V1) not being enabled). To ring a real device, pass its registration token: `npm run push:check -- <token> [android|ios|web]`. An unknown platform is refused before anything is sent. For iOS, upload an APNs authentication key to the same Firebase project; nothing changes in the API.

Phones without Google services cannot receive FCM. The sender takes pluggable providers (`services/push.js`), so an open one such as UnifiedPush can be added beside it; until then those devices rely on fetching the feed.

### Invitations

Groups are not registered; they are invited. A member of an active group invites a new group, and by doing so their group vouches for it. The same mechanism lets a group add its own members, which otherwise only an admin could do. The vouching itself happens between people, off the platform; the API records it and turns it into a group and a first account.

| Method | Path                      | Auth                    | Purpose                                                            |
| ------ | ------------------------- | ----------------------- | ------------------------------------------------------------------ |
| POST   | `/invitation/invitation`  | Group or admin          | Create an invitation; the response carries the token, once         |
| GET    | `/invitation/invitations` | Group or admin          | A group's own invitations; admins see all                          |
| PUT    | `/invitation/invitation`  | Inviting group or admin | Renew: a fresh token and expiry, the old token stops working       |
| DELETE | `/invitation/invitation`  | Inviting group or admin | Withdraw a pending invitation                                      |
| GET    | `/invitation/invitation`  | Public                  | What a token invites its holder to                                 |
| POST   | `/invitation/accept`      | Public                  | Accept: creates the account and, for a group invitation, the group |

The token is the credential, like a claim token: 24 characters that read aloud well, stored only as a hash, valid for `INVITATION_DAYS` (14). **The API never sends it anywhere.** The inviter hands it over in person or through a channel the two already trust. `inviteeEmail` and `note` are the inviter's own notes and are never shown to the invitee. The two public endpoints are [rate limited](#rate-limits).

#### POST /invitation/invitation

```bash
curl -s -X POST http://localhost:3000/invitation/invitation \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"kind":"group","inviteeName":"Riverside ABC","note":"Met at the bookfair; two of us know them"}'
```

| Field                  | Notes                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`                 | `group`: a new group joins the network, vouched for by the caller's group. `member`: a person joins the caller's group.                                                |
| `inviteeName`          | Required. Who or what is being invited.                                                                                                                                |
| `inviteeEmail`, `note` | Optional, private to the inviting group and admins.                                                                                                                    |
| `chapter`              | Admins only: the vouching group (`group`; may be omitted, so nobody vouches) or the group being joined (`member`; required). A group always invites on its own behalf. |

Returns `201` with the invitation and `token`. The token appears in this response and in the renew response, nowhere else. Only a member of an **active** group can invite (`403` otherwise), and an admin cannot make a pending or suspended group vouch (`409`). List rows carry `state`: `pending`, `expired`, `accepted`, or `revoked`; filter with `status`, `kind`, and (admin) `chapter`.

#### GET /invitation/invitation?token=

```json
{
	"data": {
		"kind": "group",
		"inviteeName": "Riverside ABC",
		"chapter": { "id": 1, "name": "Test Chapter" },
		"expiresAt": "2026-10-01T12:00:00.000Z",
		"activation": "admin_review",
		"groupFields": [
			"name",
			"location",
			"subregion",
			"country",
			"about",
			"website",
			"email",
			"socialLinks",
			"services",
			"announcement",
			"networkRole"
		]
	},
	"success": true,
	"status": 200,
	"name": "invitation one"
}
```

`chapter` is the group that vouches (`group`) or the group being joined (`member`); `null` when an admin invited with nobody vouching. `activation` tells the client what to say after accepting: `immediate`, or `admin_review` when the new group must wait for an admin. `groupFields` lists what the acceptance form may send about the new group. An unknown token is `404`; an expired, used, or withdrawn one is `410`, and so is one whose inviting group is no longer active, because a vouch is only as good as the group behind it.

#### POST /invitation/accept

```bash
curl -s -X POST http://localhost:3000/invitation/accept -H 'Content-Type: application/json' -d '{
  "token": "7K2M9QX4T8VB3N6Y1RZC5WDH",
  "username": "riverside", "password": "longenough", "email": "riverside@example.com",
  "group": { "name": "Riverside ABC", "location": { "city": "Riverside" }, "country": "Canada", "services": ["letter_writing_nights"] }
}'
```

`username`, `password`, `email`, and optional `name` follow the [user field rules](#user-fields); the account gets role `chapter`. In [end-to-end mode](#end-to-end-mode) the body may also carry the account's key fields, exactly as registration does. `group` is required for a `group` invitation and refused for a `member` one; it takes the fields listed in `groupFields`, so an invitee cannot approve, verify, or choose the voucher of their own group.

Returns `201` with `user`, `chapter` (`id`, `name`, `accountStatus`), and `activation`.

- A **member** joins the inviting group and can act at once.
- A **group** is created with `vouchedBy` set to the inviting group. By default it starts with `accountStatus: "pending"` and `recordStatus: "pending"`: its account can sign in but not act, and it is not in the public directory. An admin approves it with `PUT /chapter/chapter {"id": 7, "accountStatus": "active", "recordStatus": "published"}`; `GET /moderation/summary` counts groups waiting (`groups.pendingApproval`), and `GET /chapter/chapters?accountStatus=pending` lists them. With `INVITATION_AUTO_ACTIVATE=true` the invitation is enough and the group is active and listed at once. That includes an admin's invitation with no vouching group: only an admin can issue one (a group that sends `chapter: null` gets `403`), so an admin has already decided.

An invitation works once: of two simultaneous acceptances one gets `410`. A refused acceptance (a taken username, a weak password, an unknown service) leaves nothing behind and the invitation still usable, so the invitee can correct the form and send it again.

## Known quirks

None of these break anything, but clients should know about them.

1. Several `info` strings contain typos ("retireved", "Succeessfully") that clients may already match on. They are left as-is for now.
2. `PUT /prison/relay` returns the prison object under a key named `updatedRows`.
3. `full=true` is accepted but ignored on message endpoints.
4. Chats are not unique per user and prisoner pair when created through `POST /chat/chat`. The message endpoint always reuses the oldest chat for a pair.
5. Seeded ids are not stable across databases. Read them from responses.

## Postman collection

`ABC-3.postman_collection.json` in the repository root matches the current API. Import it, then:

1. Run **Users › Login (seeded admin)**. Its test script stores the token in the `{{jwt}}` collection variable and the admin's id in `{{userId}}`.
2. Every other request sends `{{jwt}}` as a bearer token automatically.
3. Ids in request bodies are examples from the seed data; adjust them from list responses.

`ABC-3.postman_collection_old.json` is a historical snapshot and does not match the API.

## Further reading

- [Developer guide](docs/DEVELOPER.md): architecture, request lifecycle, data model, authorization internals, tooling, and how to add a resource.
- [Switching to end-to-end encryption](docs/E2E-MIGRATION.md): the operator checklist for moving from `server` to `e2e` mode.
- [GitHub repository](https://github.com/Aye-Bee-See/sqlite-express-api)
