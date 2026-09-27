# Changelog

What changed in the letters.support API, newest first, in plain words. Each entry says what it means for the people using it, not only what moved in the code: the clients read this to know what to build, and the owner to know what is live.

**Every change adds an entry here**, in the same pull request that makes the change ([docs/DEVELOPER.md](docs/DEVELOPER.md), "Changelog"). Entries are grouped by the day they reached `main`. Deployment events (a server moved, a database reset) belong here too, marked **Deployment**, because they change what the test server answers even when no code changed.

The public test server follows `main` within the hour, so anything below is live at `https://abctest.letters.support` unless an entry says otherwise.

---

## 2026-09-27 (evening)

### A group's key and invite history is its own (#149)

`GET /chapter/history` (#143) let any group admin read another group's whole
history: who was handed the group's key and who had it taken back, ownership
transfers, key rotations, and invite codes issued, cancelled and used. Another
group now sees only what it would see of a prison or a prisoner, the edits to
the directory record (`chapter.create`, `chapter.update`, `chapter.delete`),
and `total` counts only those. The group's own members and a superadmin still
see everything.

**For clients:** nothing to change. A history screen shown for somebody else's
group will be shorter.
### Saving a profile no longer trips the pen-name limit (#148)

Two ways the pen-name limits (#127) refused people they were not meant for.

- **Sending the current name again was refused as a change.** A profile form
  that saves every field it shows, the pen name among them, got a `409`
  `pen_name_limit.cooldown` for the 90 days after any change, and **nothing on
  the form was saved**. The current name, in any spelling that folds to it, is
  now not a change: the rest of the form saves, and the name keeps the spelling
  it was first given.
- **A writer who claimed their account started with no new names left.** Every
  name after the first counted, so the group's names for the writer and the one
  the writer chose at the claim used up the year's two. Now nothing up to and
  including the claim counts; the writer's own changes afterwards count as
  anyone's do. The cooldown still starts at the claim, as it does at sign-up.

**For clients:** nothing to change; a form that sends the pen name on every save
now works. `GET /auth/pen-name` answers `newNamesLeft: 2` for a writer who has
just claimed.
### A signed-in account can no longer sign people up without limit (#147)

Sign-ups (`POST /auth/user`) are limited per address wherever open registration
is on. The limit meant to let an admin through, but it let through **any**
request with a token: one ordinary account could create accounts as fast as it
liked. Now only an admin's token skips the count; a writer's or a group's is
counted like a sign-up without one.

**For clients:** nothing to change. A client never signs up while signed in.

### The audit-window test can see every action (#146)

Tests only. #144 moved three audit actions into the two-year window and said the
test guarding that classification had been widened to see hyphenated and
camelCase actions. It had not: the pattern was unchanged, so nine actions,
including the key hand-over that prompted #144, were still never checked. The
three moves themselves did land, and were asserted by name.

The test now uses the wider pattern, and it records **which window each action
belongs in**, not only its name. It fails if an action is added without a
window, if a listed action can no longer be found in the source (the pattern
going blind again), or if a change to the classification moves an action
without the table saying so. Checked both ways: put back the old pattern, or
move `chapter.member-key` back to the short window, and it fails.

**For clients:** nothing to change.

### Starting a thread no longer stalls letters (#145)

A fix for a deadlock that only a database on disk could show. Sending a letter
holds the database's write lock while it files the letter under a thread; asking
for a new thread on its own (`POST /chat/chat` for a pair with no thread yet)
took an in-process queue and then waited for that lock, while the letter waited
for the queue. Each such thread request answered **500 after about ten seconds**,
and letters sent at the same moment waited behind it. The in-memory test
database has one connection, so the test suite could never see it.

The queue is gone. The unique index on the pair (added in #131) is
what now stops two requests from making two threads: the second insert is
refused, and that request reads the thread the first one made.

**For clients:** nothing to change. A `POST /chat/chat` that used to fail with a
500 under load now answers 201 with the thread, as documented.

## 2026-09-28 (late)

### Every refusal now says which field and why (#140)

The last of the error-code work. The remaining 55 hand-thrown validation
messages carry a field and a code: the end-to-end key bundle (`publicKey`,
`kdfSalt`, `kdfParams`, the wrapped keys), envelopes, moderation proposals,
notifications and devices, mail rules, the sign-in scheme, file uploads, and
**pagination**, which every list shares — `page` and `page_size` now answer
`out_of_range` with the range they take.

No new codes were needed: the eighteen already in `docs/ERRORS.md` covered all
of it, which is the argument for coarse codes rather than one per message.

**For clients:** `validation_failed` should now be rare. Anything still
answering it is a custom validator nobody has classified, so the sentence in
`errors` remains the thing to show — and it is worth reporting, because it can
be given a code in an afternoon. Nothing about the shape changed, and no
sentence was reworded.

## 2026-09-28 (night)

### A test vector for a typed code (#139)

Documentation and tests only. The README pinned a vector for the password path
(`password → master → wrapKey, authKey`) but none for the **typed code** path,
which starts one step earlier: at a person reading a claim or recovery code off a
slip of paper and typing it in. Both phone clients turned out to normalise such a
code without folding the look-alike characters (`O` for `0`, `I`/`L` for `1`), so
a code typed with a capital O derived a different key and the person was told
their correct code was invalid — worst for a recovery code, where they have
already lost their password. The derivation vector could not catch that, because
it begins after normalisation.

So there is now a vector for the whole path: printed `0123-4567-89AB-CDEF-GHJK-MNPQ`,
typed `" o123-4567-89ab-cdef-ghjk-mnpq "`, normalising to `0123456789ABCDEFGHJKMNPQ`
and deriving `XZ7IeQJcWF00Cy2UxN9UfA2624gzWabkGTldGLHXKyU=` with the documented
salt and parameters.

**For clients:** check your normaliser against it. If your codes are 24
characters of the Crockford alphabet, the missing `I`, `L`, `O` and `U` are
precisely the characters a person will type wrongly, and folding them is the
point. Filed as `Aye-Bee-See/android-client#15` and `Aye-Bee-See/ios-client#12`.

## 2026-09-28 (evening)

### A finished backup is group-readable (#138)

So that a copy can be fetched off the machine by something that is not root. A backup and the directory it sits in are now `0640` in a `0750` directory, owned as before; the working directory that briefly holds the database in the clear stays `0700`. What is inside an archive is encrypted to `BACKUP_PUBLIC_KEY`, whose private half is not on the server, so group-read gives away nothing — and it means a scheduled copier can run as an ordinary member of the service's group instead of needing `sudo` in a cron job.

Nothing changes for a deployment that keeps backups on the server only.

## 2026-09-28 (later)

### A photo is hosted here, or there is no photo (#137)

`photoUrl` is gone from prisoner records. It held a link to a picture on another site, from before photos were hosted here; **no client was ever built to load one**, nothing in the seed data set it, and no record on the test server carried one. A third-party image would also have told that host who was looking at which prisoner, which is the thing hosting them here avoids.

**For clients:** `photo` is unchanged and is still the only field to read — `{ url, hosted, credit, updatedAt }` or `null`. `hosted` is now always `true`; it stays in the object so that a client written against the first shape of the field keeps working. `photoUrl` no longer appears in a prisoner row and can no longer be written, by an update or by a moderation proposal.

## 2026-09-28

### One key for every refusal (#136)

Step 3 of the error codes, and the last of the shape work. A refusal that is not about a field — `403`, `404`, `409`, `410`, `422` — now carries a `code` beside the `name` and `condition` it has always sent:

```json
{
	"success": false,
	"name": "InviteCodeError",
	"condition": "used",
	"code": "invite_code.used",
	"status": 410
}
```

The code is composed by one rule: the error's name in snake_case with `Error` dropped, then the `condition` after a dot when there is one. So `NotFoundError` is `not_found`, `AccountDeleteError` with `condition: "group_owner"` is `account_delete.group_owner`, and a pen name refused by its cooldown is `pen_name_limit.cooldown`. Every family is listed in [docs/ERRORS.md](docs/ERRORS.md), and a test fails when the code throws an error name that has none.

**`name` and `condition` are still sent and are not being removed** — both clients asked for that, since installed builds word these refusals from the pair today.

**For clients:** match the whole code, or just the family before the dot. The family is the stable half: a refusal may grow a finer `condition` later, and a build that matched the family keeps working. A `5xx` is a fault, not a refusal, and carries no code; a `400` about a field answers with `problems` instead. So there is exactly one thing to key on, whichever kind of refusal it is.

## 2026-09-27 (evening)

### Codes on the flows people actually meet (#134)

Step 2 of the error codes, in the order the Android and iOS reviews asked for: **pen names** (including `reasonCode` on the availability check), **joining, claiming and accepting an invitation**, **attachments**, **sending a letter**, and **a group's own forms**. Forty-seven refusals now carry a field and a code where they carried only an English sentence, and five codes join the catalogue:

| Code                    | Where you will meet it                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reserved_value`        | a username shaped like the ones groups manage (`writer-…`), a placeholder email address                                                           |
| `not_eligible`          | a record that exists but cannot be used here: a letter that was not returned, `paper` on a reply, a relay group that does not serve that facility |
| `not_settable_here`     | a real field that belongs to another endpoint (keys go through `PUT /auth/keys`)                                                                  |
| `already_set`           | a field that can be written once and has been                                                                                                     |
| `wrong_encryption_mode` | plaintext sent to an end-to-end server, or ciphertext to one holding the keys. A client bug; `GET /health` says which mode it is                  |

A moderation proposal now reports the path too (`fields.prisonName`, not `prisonName`), so **`field` is always the path in the request body** with no exceptions. Asked for by the Android review; a form bound to `fields` strips the prefix in one line.

**For clients:** the sentences are unchanged, so nothing breaks. What is new is that these refusals can be worded by the client and pointed at the right input. What still answers `validation_failed` is mostly deep in the key endpoints, where the refusal means the client sent the wrong shape rather than something a person can fix.

### Validation failures carry a field and a code (#133)

A refused request used to answer with English sentences and nothing else, so a client wanting to highlight the right input, or say it in Spanish, had to match on the text. Alongside `errors`, a `400` now carries `problems`: one entry per sentence, in the same order, each with the `field`, a stable `code`, and the `params` to interpolate.

```json
{
	"success": false,
	"errors": ["penName must be between 3 and 40 characters."],
	"problems": [
		{ "field": "penName", "code": "length_out_of_range", "params": { "min": 3, "max": 40 } }
	]
}
```

Everything a **schema rule** refuses — a missing field, a length, a URL, a value outside a fixed set — has a real field and code from today, because Sequelize already says which field and which rule failed. Sentences thrown **by hand** are being converted flow by flow; until one is, its entry is `{ field: null, code: "validation_failed" }` and the sentence in `errors` is the thing to show. Three are converted already (pen name length and type, credentials that are not text, a missing `prisoner` on a photo).

`errors` is unchanged, so nothing that reads it notices. The catalogue is [docs/ERRORS.md](docs/ERRORS.md), generated from one source file by `npm run errors:docs -- --write`; a test fails when the file drifts, when the code answers with a code the catalogue has never heard of, and when a code is misspelled at a throw site.

**For clients:** key your strings on `code`, fall back to the sentence in `errors`, and treat `params` as the numbers to interpolate. **The API never translates**, so no wording fix waits on a deploy here. Codes never change meaning or disappear.

After the Android and iOS reviews: `problems` is always exactly as long as `errors` and **every `400` carries it**, including refusals thrown as general errors (which keep their `condition`); a field inside an object is named with its path (`group.name`); a limit that does not apply is left out rather than sent as `null`; `GET /auth/pen-name-available` answers `reasonCode` beside `reason`; the lost-race `409` on a letter status move carries `condition: "changed_meanwhile"` so nobody has to match the sentence; and a split account's `password` that is not an auth key answers the new code `not_an_auth_key` **with no field**, since it is a client bug and must never appear under a person's password box.

## 2026-09-27 (later)

### A letter is one write, with its Idempotency-Key (#132)

The last of the September audit's three leftovers. A letter used to be built in steps — the row, its envelopes, its reply reference, its first history row, the thread, then the note of what its `Idempotency-Key` made — and a failure part way was patched up by deleting what had already been written. Between the letter existing and its key pointing at it there was a window: if recording the key failed (a busy database), the letter was sent and the claim went stale, and a retry with the same key could send a **second copy** to the same prisoner.

All of it is now one transaction. Either the letter and the note of its key are both there, or neither is.

**For clients:** a `5xx` on `POST /messaging/message` now means the letter was **not** sent, whatever failed, and the key is free again — so retrying with the same `Idempotency-Key` is right and safe. Nothing else changes: a successful send, a replay, the `409` for a double click and the `422` for a reused key are all as they were.

Checked on a file database as well as in memory: sixty letters sent at once, from six writers to four prisoners, all succeeded, every retry replayed rather than creating anything, and no pair ended up with two threads.

## 2026-09-27

### The audit log no longer grows for ever, and a pair has one thread (#131)

Two pieces of housekeeping from the September audit.

**The audit log is swept by the retention run.** It is append-only and nothing ever removed an entry, so it grew for the life of the deployment. Entries about accounts, keys, invitations, decisions made about somebody, and anything deleted are kept for 730 days (`AUDIT_SECURITY_KEEP_DAYS`); the routine day-to-day for 180 (`AUDIT_KEEP_DAYS`). `0` keeps that kind for ever. The run reports what it removed as `auditEntries`, in its log line and in its own `retention.run` entry.

**One thread per writer and prisoner.** `POST /chat/chat` used to make a second thread for a pair, while the letter endpoint quietly filed letters under the oldest one, so the newer thread sat empty in somebody's inbox. Asking for a thread that exists now answers with that thread, and a unique index makes a second one impossible even from another process. Threads that were already doubled are merged by the migration, keeping every letter and notification. Known quirk 3 in the README is gone.

**For clients:** nothing breaks. `POST /chat/chat` answers `201` with the pair's thread whether it was made now or already there, so a client that called it twice stops creating litter.

## 2026-09-26

### Photographs in the directory (#130)

A prisoner's record can carry a photo, hosted here rather than linked from another site, so nobody else is told who is looking at whom. A superadmin, or the group-owner admin of an active group, uploads it with `POST /prisoner/photo` (multipart: `photo`, `prisoner`, optional `credit`); `DELETE /prisoner/photo` takes it down. One photo per record, replaced rather than added to, JPEG, PNG or WebP up to `PHOTO_MAX_BYTES` (5 MiB), and the type is read from the file's own bytes.

**Everything describing the picture is removed before it is stored**: EXIF (where it was taken, when, on which camera), XMP, IPTC, comments, PNG text chunks. Colour profiles and gamma stay, and the pixels are never re-encoded. EXIF orientation goes with the rest, so **clients should rotate a photo before uploading it**, which a crop step does anyway.

**For clients:** every prisoner row now carries `photo` — `{ url, hosted, credit, updatedAt }` or `null` — and that is the field to use. A hosted `url` goes straight into an `<img>` tag: no token, cached for a day, with an `ETag` that changes when the photo does. A photo on a `draft` or `pending` record is served to staff only. Photos are included in backups.

### Limits on what a signed-in account may write (#128)

The endpoints that need no token have been limited since #84, but nothing limited a signed-in account: one script, or one stolen token, could post letters, attachments, proposed changes, invitations and key rotations until the disk filled. Every write is now counted per account over one hour, with the numbers set well above a busy letter night: 240 letters, 60 attachments, 600 envelopes, 60 proposed changes, 60 managed writers, 20 invitations or invite-code batches together, 5 key rotations, 30 device registrations, and 20 sign-ups per address. Staff are counted too, since a group's or an admin's token is the one worth stealing; an admin creating accounts with a token is not counted against the sign-up limit. Directory writes by an admin stay unlimited, which is what a seeding script does. Every setting is a `RATE_LIMIT_*` environment variable (README, "Limits on signed-in writes").

**For clients:** handle `429` on writes, not only on sign-in. Read `Retry-After` (seconds) and say when to try again. A letter refused with `429` was not saved, so retrying is safe, with the same `Idempotency-Key` if one was used.

## 2026-09-25

### Pen name changes are limited (#127)

A pen name once used is never given to anyone else, which is what lets a reply addressed to an old name still find its writer — and it meant an account could rename itself in a loop and empty a namespace everybody shares. A change now waits 90 days after the one before (`PEN_NAME_COOLDOWN_DAYS`), and at most two brand-new names may be taken in a rolling year (`PEN_NAME_NEW_PER_YEAR`). Going back to a name the account has used before costs nothing from the namespace, so it does not count, but still waits out the cooldown. The name chosen at sign-up is the first, not a change, and is free of both. A superadmin, and a group for the unclaimed writers it looks after, may rename past the limits, which is what a writer being harassed needs; those overrides go to the audit log as `user.penName`.

**For clients:** `GET /auth/pen-name` now also answers `changeAllowedAt`, `newNamesLeft`, `newNamesWindowEnds`, `cooldownDays` and `newPerYear`. Read it when the settings screen opens and say so before anyone types. A refusal is `409` `PenNameLimitError` with `condition` `cooldown` or `new_names`.

### End-to-end encryption is the default (#126)

`ENCRYPTION_MODE` now defaults to `e2e`. A deployment that still wants the server to hold the keys must say `ENCRYPTION_MODE=server` in its own settings. Nothing changes for a deployment that already names its mode.

### Seed accounts use the split scheme (#125)

A fresh database now seeds accounts whose password never reaches the server, including a group admin of Test Chapter, so a client built for the split scheme can sign in to a newly seeded server without anything being reset by hand. `npm run auth-key -- <username> <password> [url]` derives the value to send as `password` for curl and scripts.

### The front page's news feed is pulled by the server (#124)

`GET /news` answers the items, fetched by the API from `NEWS_FEED_URL` under a byte cap, so a visitor's browser never talks to the feed's host. Unset, it answers an empty list.

### Deployment: the test server switched to end-to-end mode

`abctest.letters.support` now reports `"encryptionMode":"e2e"` on `/health`. A client that still sends `messageText` is refused from that moment; letters travel as `ciphertext`, `nonce` and `envelopes`. Test Chapter has no group key yet: the first group admin to sign in there with a client that does key set-up creates it, and until then nothing can be relayed through that group.

### Deployment: the test server's database was rebuilt on the real seed data

The old sample directory was replaced with the real one from #122. Every account made before the rebuild is gone, including the test accounts handed out earlier.

## 2026-09-24

### Answers to the web client's questions (#123)

Addresses carry `lines`, ready to print. `GET /prisoner/filters` and `GET /prison/filters` give the values a filter UI should offer, so no client has to compile a list. A group's page embeds the facility of each supported prisoner. One rule now covers every typed code (upper case, letters and digits, `O`→`0`, `I`/`L`→`1`), stated in the README with an Argon2id test vector so the clients derive identical keys. Includes audit fixes found while answering.

## 2026-09-23

### Real prisoners and facilities in the seed data (#122)

The made-up directory is gone. A fresh database now holds 58 real prisoner profiles and 45 real facilities in eleven countries, transcribed from support-site profiles with a source recorded on each record. Three things for the clients: addresses have `street`, `city` and `postalCode` (some pending records only `city`); Greek and Cyrillic appear in names and addresses; and 20 of the 58 records are `pending`, so only staff see them, with `verificationNotes` and each facility's `notes` worth showing prominently.

### Deployment: the test server moved to letters.support

The public test API is `https://abctest.letters.support`. The old name and its certificate were retired. It follows `main` within the hour, keeps a daily encrypted backup, and rolls itself back to the previous code and database if an update does not come back healthy.

---

### Before this log

The API was revived from 2026-09-11 and rewritten heavily through #60–#121: encryption at rest and then end-to-end, retention, moderation, invitations, invite codes, group roles, paper letters, pen names and the reply reference, the split sign-in scheme, encrypted backups, and the audit fixes of #101–#103. The README is the reference for all of it; the pull requests hold the reasoning.
