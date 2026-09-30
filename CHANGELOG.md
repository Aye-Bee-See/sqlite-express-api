# Changelog

What changed in the letters.support API, newest first, in plain words. Each entry says what it means for the people using it, not only what moved in the code: the clients read this to know what to build, and the owner to know what is live.

**Every change adds an entry here**, in the same pull request that makes the change ([docs/DEVELOPER.md](docs/DEVELOPER.md), "Changelog"). Entries are grouped by the day they reached `main`, in UTC (a merge after 17:00 in California is the next day here), newest first within a day. Deployment events (a server moved, a database reset) belong here too, marked **Deployment**, because they change what the test server answers even when no code changed.

The public test server follows `main` within the hour, so anything below is live at `https://abctest.letters.support` unless an entry says otherwise.

---

## 2026-09-30

### A superadmin can require two-factor sign-in (#174)

Decided 30 September. Every switch starts off, so nothing changes until a
superadmin uses one. A superadmin can require two-factor sign-in for all
superadmins (having switched on their own first), for the group admins of every
group, or for the group admins of chosen groups (`PUT /auth/two-factor/policy`,
`PUT /auth/two-factor/group`, `GET /auth/two-factor/policy`). Someone it is
required for who has not set it up can still sign in, and is told so
(`twoFactor.setupRequired` in the sign-in answer), but every request except
setting it up and signing out is `403`, code
`two_factor_required.setup_required`, including in sessions that began before
the requirement. While required, it cannot be switched off. A superadmin can
reset someone's two-factor sign-in for a lost phone
(`DELETE /auth/two-factor/user`). Writers are never required to use it.

**For clients:** on sign-in, `twoFactor.setupRequired` means go straight to the
set-up screen. Any request answering `two_factor_required.setup_required` means
the same, mid-session. `GET /auth/two-factor` now says `required` and
`requiredBecause`; hide "switch off" when it is required. The web admin needs the
policy screen and the per-group switch, and a reset on an account.

### Two-factor sign-in, optional for everyone (#173)

Decided 30 September. Any account can switch on a second step at sign-in: a
six-digit code from an authenticator app, with ten one-time recovery codes for a
lost phone. `POST /auth/two-factor/setup` gives the secret and an `otpauth://`
link for a QR code; `POST /auth/two-factor/confirm` with the first code switches
it on and shows the recovery codes once. With it on, `POST /auth/login` answers a
five-minute `twoFactor.challenge` instead of a session, and
`POST /auth/login/two-factor` with the challenge and a code (or a recovery code)
finishes the sign-in with the usual answer. Codes work once, tries are counted
like failed sign-ins, and switching it off needs a code. Superadmins making it
required comes next.

**For clients:** handle `data.twoFactor` in the sign-in answer: ask for the code,
with "Use a recovery code" beside it, then call `POST /auth/login/two-factor`.
A settings screen: set up (show the QR code from `otpauthUri`), confirm, show
and ask the person to keep the recovery codes, make new ones, switch it off.
Nothing changes for an account that has not switched it on.

### A group can recommend a site-wide block, and a superadmin decides (#172)

Decided 30 September. Beside blocking a writer from its own letters (#171), a
group admin can recommend that a writer be blocked everywhere:
`POST /moderation/ban-recommendation` with the writer and a required reason,
which is for the superadmin and not shown to the writer. It waits in the
moderation queue (`GET /moderation/ban-recommendations`, and
`pendingBanRecommendations` in the moderation summary), and every superadmin is
told. A superadmin decides with `PUT /moderation/ban-recommendation`: `ban`
gives the writer the existing `banned` role, which ends their sessions at once,
and settles every recommendation waiting for them; `dismiss` settles that one.
The recommending group is told either way, with the superadmin's note.

**For clients:** group admins need "Recommend a site-wide block" beside "Block
from our group", with a reason, and a list of their group's recommendations and
what became of them. The superadmin view (web admin) needs the queue with Ban and
Dismiss. Word `ban.recommended` and `ban.decided`.

### A group can block a writer from its letters (#171)

Decided 30 September. A group admin can stop a writer who is misusing the
system from sending letters through their group: `POST /chapter/block` with the
writer and a required reason, which the writer is told. It reaches that group
only; a superadmin stops an account everywhere with the existing ban. While the
block stands, the writer's letters waiting in the group's queue are held
(`writer_blocked`), and a new letter to that group is `403`, code `group_block`.
Any group admin of the group, or a superadmin, lifts it with
`DELETE /chapter/block`, and the held letters go back into the queue.
`GET /chapter/blocks` lists them. The writer gets `writer.block`, the group's
admins `group.block`; both events are audited in the two-year window.

**For clients:** group admins need "Block from our group" on a writer (from a
letter or thread), with a reason, and a list of blocked writers with "Unblock".
Writers need to word `writer.block`, the `group_block` refusal (suggest another
group where the facility has one), and the `writer_blocked` hold.

### A group can decline to mail a letter, and say why (#170)

Decided 30 September. A group admin may refuse to mail a letter their group
relays, with `PUT /messaging/status` (or the batch endpoint) and the new status
**`declined`**. A reason is required: `facility_rule` (naming one of the
facility's own mail rules in `rule`), `content` (inappropriate or unsafe), or
`other`, with an optional note to the writer of up to 200 characters. A letter
can be declined while queued or printed, paper and held letters included, never
once mailed; `declined` is final. Only the group that relays the letter can
decline it: a superadmin cannot read it, and cannot decline it. The writer is
notified with the reason and may write it again with `resendOf`, as after a
return. Declines are audited as `letter.decline`, in the two-year window.

**For clients:** the queue and the letter screen need a "Don't send" action for
group admins: choose the reason, pick the rule from the facility's list when it
is a rule, and add a note. Writers see `declined` with `declineReason`,
`declineRule` and `declineNote`, and a "Write it again" that sends `resendOf`.
Word the three reasons yourselves, as with return reasons.

### A server can install without the development tools (#169)

`npm ci --omit=dev` used to fail: the `prepare` script ran `husky`, which is a
development tool and not installed that way. So the test server installed
everything, ESLint, Prettier and Husky included, on every hourly update. The
script is now `husky || true`: on a developer's machine it installs the commit
hook as before, and where Husky is absent it does nothing. Checked in a clean
copy: `npm ci --omit=dev` succeeds, installs no development tools, and the server
boots and answers `/health`.

**Deployment:** once this is merged, change `npm ci` to `npm ci --omit=dev` in
abctest's update script. Not before: the old `prepare` would fail the install
and the update would roll back.

**For clients:** nothing to change.

### A pen name is required to make an account (#168)

Decided 30 September. `POST /auth/user` (for a writer), `POST /auth/join`,
`POST /invitation/accept` and `POST /auth/claim` now refuse a request without a
`penName`: `400`, `required` on `penName`, with nothing made and no code or
invitation spent. A managed writer the group already named keeps that name at
claim and need not send one; a staff account an admin makes signs no letters and
needs none. `POST /auth/writer` is unchanged. `GET /auth/claim?token=` now also
answers `writer.penName`, so a claim form can fill it in, or require it when it
is `null`. Without a pen name, the printed
reference line fell back to the person's display name, which may be their real
one.

Found while doing it: an invitation acceptance that failed part way removed the
account but kept the pen name it had reserved, so the retry was told the
person's own name was taken. The name is released with the account now.

**For clients:** every sign-up, join, claim and invitation form must send
`penName`, and should ask for it on the same screen as the username. Nudge towards
two parts without enforcing it. Ask an existing account that has none at its next
sign-in (`GET /auth/pen-name` answers `penName: null`). A client that does not
send it yet can no longer make accounts.

## 2026-09-27

### Ownership only passes to someone who holds the key (#167)

`PUT /auth/chapter-owner` could make a group admin who did not hold the chapter
key its owner. From then on nobody could hand the key to anyone, take it back,
or rotate it: the old owner had lost the right, and the new one had nothing to
seal. Only a superadmin moving ownership back undid it. Once a chapter has a
key, ownership now goes only to a group admin who holds it; anyone else is
`409 OwnerError`, `condition: "no_key"` (`code: "owner.no_key"`), whether the
owner or a superadmin asks. A chapter with no key yet is unaffected. Decided 27
September.

**For clients:** in the "pass ownership" screen, offer only group admins who
hold the key (`GET /auth/member-keys`), or explain `owner.no_key` as "hand them
the key first".

### Every group admin may add a photo (#166)

Photo upload (`POST /prisoner/photo`, `DELETE /prisoner/photo`) was a
superadmin or the group-owner admin. It is now a superadmin or **any group
admin of an active group** (decided 27 September). A member of a group that is
not active is refused and told why; writers are refused as before.

**For clients:** show photo upload to every group admin, and ask before sending.
A group admin confirms the person has agreed to the photo going up. A superadmin
confirms it comes from a public support page the person's supporters published,
and puts that source in `credit`. The API does not check the confirmation; the
clients are where it happens.

### An update cannot switch a server-mode deployment to end-to-end unasked (#162)

`ENCRYPTION_MODE` has defaulted to `e2e` since #126. A deployment that never
set it, and has been running in server mode, would have switched on its next
update without anyone choosing to: clients sending `messageText` refused from
that moment. Now a database that holds letters written in server mode does not
boot on the default. It stops, says how many such letters there are, and asks
for `ENCRYPTION_MODE=server` (carry on) or `ENCRYPTION_MODE=e2e` (switch). A new
database, or one whose mode is set, boots as before.

**Deployment:** abctest sets `ENCRYPTION_MODE=e2e`, so nothing changes there.

### The audit log is indexed, purged in batches, and not compacted every run (#163)

Three costs the retention run and the audit endpoint paid on a large log.

- **No index on `action` or time.** `GET /moderation/audit?action=`, the
  retention run's list of actions, and its purge each read the whole table.
  One index on the pair serves all three (migration
  `2026.09.28T01.00.00.audit-log-action-index.js`).
- **The purge was one `DELETE`.** The first run on a large log held the write
  lock until every old entry was gone, and letters waited. It now deletes a
  thousand at a time, letting go of the lock between them.
- **Every run that deleted anything ran `VACUUM`**, which rewrites the whole
  file with every other write held out. It was there so deleted letters could
  not be read back out of a copy of the file. `secure_delete` now does that at
  the moment of deletion, on every connection (checked: 199 copies of a
  deleted text left in the file without it, none with it), and `VACUUM` runs
  only when a quarter or more of the file is free.

**For clients:** nothing to change.

### A replay or a server fault does not use up a write limit (#164)

The hourly limits on signed-in writes (#128) counted every request, including
a retry with the same `Idempotency-Key` that was answered with the letter
already made, and a request the server failed with a `5xx`. A client doing
exactly what it was told (retry a `5xx` with the same key) spent its allowance
twice over for one letter. Both are now given back once they are answered. A
refusal (`4xx`) still counts, so a wrong body buys no extra tries.

**For clients:** nothing to change; retrying with the same key is as safe for
the limit as it is for the letter.

### Backups made before #138 become readable by the copier too (#165)

The change in #138 made finished backups group-readable so an off-site copier
could fetch them without sudo, but only in a backup directory it created: an
existing one stayed `0700`, and the archives already in it `0600`, so on abctest
the copier could read nothing until somebody ran `chmod` by hand. Each backup
run now adds group read (and, for the directory, group search) where it is
missing, to the directory and to every archive in it. Nothing is ever made
readable to other users, and anything in the directory that is not an archive
is left alone.

**Deployment:** abctest's next nightly backup fixes its directory. Off-site
copying itself is still deferred until there is production data.

### A NUL character is refused, not a server error (#160)

`?id=%00` answered `500` on every endpoint that looks a record up: Sequelize
writes a lookup's value into the SQL, and SQLite stops reading at a NUL, which
leaves the quoted value open. Nothing the API takes can contain a NUL
(ciphertext travels as base64), so one anywhere in the query or the body,
including multipart fields and a key rotation, is now refused before any route
runs: `400`, `wrong_type` on the field that holds it.

**For clients:** nothing to change.

### A search for `%` finds a percent sign (#159)

`q` on the prisoner, facility, group and (admin) user lists was used as a SQL
`LIKE` pattern, so `%` and `_` were wildcards: `?q=%` or `?q=_` listed every
record. `q` is now plain text to find. Case is folded for ASCII letters only,
as before, so searches in Greek or Cyrillic match exactly as they did.

**For clients:** nothing to change.

### Recovery cannot be guessed at by sending the username as a list (#158)

Account recovery is limited per username, but only a username sent as text was
counted. Sent as a list (`?username=alice&username=alice`, or `["alice"]` in
the body), it was not counted at all, and the lookup still found the account,
so recovery codes could be guessed without limit. Sent as an object, it
answered `500`. `GET /auth/recover`, `POST /auth/recover` and
`GET /auth/login-params` now refuse a username that is not text: `400`,
`wrong_type` on `username`. Sign-in already refused one; its refusal now names
the field.

**For clients:** nothing to change; a client sends a username as text.

### A group account cannot test which emails have accounts (#157)

`GET /auth/user?email=` (or `?username=`, `?id=`) is open to a group account
for the writers its group looks after. For anyone else's account it answered
`403`, and for an address with no account `404`, so any group login could
check whether a given email or username is signed up. Both are now the same
`404`. A member of a group that is not active is told why, as before, and now
gets that same answer whether or not the account exists.

**For clients:** nothing to change.

### A hidden prisoner cannot be found by writing to it (#156)

A writer sees only published prisoners, but `POST /chat/chat`,
`POST /messaging/message` and moving a letter with `PUT /messaging/message`
accepted a pending or draft one, and made the thread or letter. A prisoner
that did not exist was refused instead, so a script could walk the ids and
learn which hidden records exist. Both are now the same `404`
(`not_found`, "Prisoner N not found"), and nothing is made. Staff, who can see
pending records, are unchanged, except that a prisoner that does not exist is
now `404 not_found` for them too, where it was `400 reference`.

The seed data had 17 of its 40 threads, and the letters in them, addressed to
pending prisoners; they now go to published ones. This changes new databases
only.

**For clients:** a letter or thread for a prisoner that is gone answers `404`
with code `not_found`, rather than `400` with code `reference`.

### A relay group reads only the letters it relays (#155)

A group sees a writer's thread because it relays a letter in it. Reading the
thread (`GET /chat/chat?full=true`, `GET /chat/chats?full=true`) returned
**every** letter in it, including those the writer sent the same prisoner
through another group or directly; on a server-mode deployment that was their
text. The inbox line's `last_message` was the thread's newest letter, whoever
it went through, and `heldCount` counted all of them. All three now cover only
the letters the group relays (or, end to end, holds an envelope for), which is
what `GET /messaging/messages` already did.

**For clients:** nothing to change. A group's inbox line now shows the newest
letter it can read, rather than a blanked-out newer one it cannot.

### Error codes: the rule holds, and no sentence goes without a field (#153)

Four gaps in the error-code work (#133–#142).

- **`code` and `condition` could disagree.** A condition that came from the
  endpoint rather than the error was sent as `condition` but left out of
  `code`, so the documented rule (`code = family + "." + condition`) was false.
  It holds now: `GET /auth/user?id=` that finds nobody is `not_found.id`
  (`.mail`, `.name` for the other lookups), where it was `not_found`.
- **55 hand-written refusals still had no field or code.** #140 said none were
  left; its search did not allow for Prettier putting the sentence on the next
  line. Every one now says which field and why, with the codes already in
  `docs/ERRORS.md`, and a test reads the source so a new one cannot slip in.
  Three missing-parameter refusals that were thrown as bare `400`s
  (`GET /auth/user` with no id, `GET /chat/chat` without both user and
  prisoner) are now validation failures like the rest, with the sentence in
  `errors` and `required` in `problems`.
- **A body that is not JSON answered `code: "http"`** and logged a line on the
  server for every such request. It is now `request_body.not_json` (and
  `.too_large` and so on), with nothing logged.
- **A NOT NULL the database enforces answered empty `errors` and `problems`.**
  It now names the column, `required`. SQLite reports these as unique clashes
  with nothing in them, which #142 had started treating as validation failures.

**For clients:** if you match `not_found` exactly, match the family before the
dot instead, as the README has always said. For the three missing-parameter
`400`s, read `errors[0]` rather than `error`. Anything that showed
`validation_failed` with no field should now have one.

### A hostile news feed can no longer stall the server (#152)

The news reader (#124) parsed the feed with regular expressions that, given a
tag with no end (`<item>`, `<title>`, `<script`, or a bare `<`), searched the
rest of the document again from every one. The feed comes from another site,
and parsing runs on the thread that answers every request: a 1.4 MB body built
that way held the whole API for minutes. The reader now makes one pass,
finding each closing tag with a plain search and stopping the moment one is
missing; the same bodies take a few milliseconds. It reads at most 200 items.

A numeric entity naming no character (`&#99999999;`) used to throw and fail
the whole pull; it now reads as `�` and the rest of the feed is kept.

**For clients:** nothing to change; `GET /news` answers the same items as before.

### Photos: gone when taken down, and nothing hidden in the file (#151)

Five fixes to directory photos (#130).

- **A photo taken down or replaced stayed visible for a day.** Its URL never
  changed and was cached for 24 hours. The URL now carries `&v=`, which changes
  with every upload, and the picture is served `no-cache` with an `ETag`: kept,
  but checked each time it is shown (a `304` with no body while unchanged).
- **A staff-only photo was marked `public`**, so a shared cache could have kept
  a pending record's photo and handed it to anyone. It is now `private`.
- **Nothing after the end of a JPEG is kept.** Phones append a second picture
  with its own EXIF, or a motion photo's video; the stripper kept both. A JPEG
  or WebP that cannot be read to the end is now refused rather than stored with
  whatever it failed to recognise. Checked on 77 real JPEGs: every one decodes
  to the same pixels after stripping.
- **Deleting a prisoner deletes its photo file**, which it used to leave behind.
- **Rows no longer carry `photoFile` or `photoAddedBy`**, the file's name on disk
  and the uploader's account id. Also: an upload is read only up to the photo
  limit (it was 20 MiB) and only once the uploader is known to be allowed, and
  the two plain-sentence refusals have codes (`not_allowed_value`, `out_of_range`).

**For clients:** use `photo.url` exactly as given; do not build it from the id,
or a replaced photo will look unchanged. A photo that is refused with
`wrong_type` on `photo` should be re-saved (or screenshotted) and sent again.

### The changelog's dates, and some stale documentation (#150)

Documentation only. Entries were dated inconsistently, five of them a day that
had not yet come; they are now grouped by the day each reached `main`, in
UTC. (This entry first said Pacific time; the dates were always UTC.) #142, #143 and #144 had no entries and now do. Two older entries
said more than was true: #122's seed data has Greek in five facilities'
addresses but no Cyrillic in any name or address, and #123's `lines` is an
optional field no seeded facility has yet, while its "audit fixes" were
`npm audit fix`. In the README, the boot output matches what a new database
prints, the example account no longer collides with the seeded `chapter1`, and
the settings table says that `0` for a rate limit means the default.

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

### Three audit actions are kept two years instead of 180 days (#144)

Handing a group's key to a member (`chapter.member-key`), taking it back
(`chapter.member-key.remove`), and the retention run's own record of what it
deleted (`retention.run`) move from the 180-day window to the 730-day one. The
first two are the access-control events that matter most, and slipped through
because the prefix list said `chapter.keys`; the third is the only record that
a deletion happened at all. The README prints the full classification of every
action. (This PR also said the test guarding the classification had been
widened; it had not, and #146 does it.)

**For clients:** nothing to change.

### The history of one record (#143)

`GET /prisoner/history?id=`, `GET /prison/history?id=` and
`GET /chapter/history?id=` answer what has happened to one directory record,
newest first and paginated, each entry `{ id, at, action, actor, changes?, details? }`,
with `changes` as `{ field: { from, to } }`. Staff only: a superadmin, or a
group admin of an active group.

Underneath, audit entries now record **what changed** rather than what a
request sent: a form re-sent whole records the one field that moved, and an
edit that changes nothing records the write with no changes. An approved
proposal writes the record's own entry with the old values, so a history is
complete without the moderation log. Values are cut at 1000 characters, dates
compare as instants, and `actor` is `null` for the server itself or an account
since deleted.

**For clients:** these entries are kept 180 days (`AUDIT_KEEP_DAYS`), so a
history screen should not present itself as the whole life of a record.

### A taken username says which field (#142)

Reported from the iOS client (#141). A unique clash — a taken username, email,
pen name or mail-rule tag — fell through to the general error path and was
answered with no field and no code. It is now a validation failure like any
other: `errors: ["Username already in use."]` and
`problems: [{ field: "username", code: "not_unique", params: { fields: ["username"] } }]`.

A foreign-key violation used to answer the storage engine's own words
(`SQLITE_CONSTRAINT: FOREIGN KEY constraint failed`). It now answers
`code: "reference"` and a sentence that is true whichever way it happened: a
record the request points at does not exist, or one it would remove is still
in use.

**For clients:** for a taken username, read `errors[0]` and `problems[0]`, not
`error`. Android's `400` path already prefers `errors`; iOS gets the field it
asked for.

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

### A finished backup is group-readable (#138)

So that a copy can be fetched off the machine by something that is not root. A backup and the directory it sits in are now `0640` in a `0750` directory, owned as before; the working directory that briefly holds the database in the clear stays `0700`. What is inside an archive is encrypted to `BACKUP_PUBLIC_KEY`, whose private half is not on the server, so group-read gives away nothing — and it means a scheduled copier can run as an ordinary member of the service's group instead of needing `sudo` in a cron job.

Nothing changes for a deployment that keeps backups on the server only.

### A photo is hosted here, or there is no photo (#137)

`photoUrl` is gone from prisoner records. It held a link to a picture on another site, from before photos were hosted here; **no client was ever built to load one**, nothing in the seed data set it, and no record on the test server carried one. A third-party image would also have told that host who was looking at which prisoner, which is the thing hosting them here avoids.

**For clients:** `photo` is unchanged and is still the only field to read — `{ url, hosted, credit, updatedAt }` or `null`. `hosted` is now always `true`; it stays in the object so that a client written against the first shape of the field keeps working. `photoUrl` no longer appears in a prisoner row and can no longer be written, by an update or by a moderation proposal.

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

## 2026-09-26

### A letter is one write, with its Idempotency-Key (#132)

The last of the September audit's three leftovers. A letter used to be built in steps — the row, its envelopes, its reply reference, its first history row, the thread, then the note of what its `Idempotency-Key` made — and a failure part way was patched up by deleting what had already been written. Between the letter existing and its key pointing at it there was a window: if recording the key failed (a busy database), the letter was sent and the claim went stale, and a retry with the same key could send a **second copy** to the same prisoner.

All of it is now one transaction. Either the letter and the note of its key are both there, or neither is.

**For clients:** a `5xx` on `POST /messaging/message` now means the letter was **not** sent, whatever failed, and the key is free again — so retrying with the same `Idempotency-Key` is right and safe. Nothing else changes: a successful send, a replay, the `409` for a double click and the `422` for a reused key are all as they were.

Checked on a file database as well as in memory: sixty letters sent at once, from six writers to four prisoners, all succeeded, every retry replayed rather than creating anything, and no pair ended up with two threads.

### The audit log no longer grows for ever, and a pair has one thread (#131)

Two pieces of housekeeping from the September audit.

**The audit log is swept by the retention run.** It is append-only and nothing ever removed an entry, so it grew for the life of the deployment. Entries about accounts, keys, invitations, decisions made about somebody, and anything deleted are kept for 730 days (`AUDIT_SECURITY_KEEP_DAYS`); the routine day-to-day for 180 (`AUDIT_KEEP_DAYS`). `0` keeps that kind for ever. The run reports what it removed as `auditEntries`, in its log line and in its own `retention.run` entry.

**One thread per writer and prisoner.** `POST /chat/chat` used to make a second thread for a pair, while the letter endpoint quietly filed letters under the oldest one, so the newer thread sat empty in somebody's inbox. Asking for a thread that exists now answers with that thread, and a unique index makes a second one impossible even from another process. Threads that were already doubled are merged by the migration, keeping every letter and notification. Known quirk 3 in the README is gone.

**For clients:** nothing breaks. `POST /chat/chat` answers `201` with the pair's thread whether it was made now or already there, so a client that called it twice stops creating litter.

### Photographs in the directory (#130)

A prisoner's record can carry a photo, hosted here rather than linked from another site, so nobody else is told who is looking at whom. A superadmin, or the group-owner admin of an active group, uploads it with `POST /prisoner/photo` (multipart: `photo`, `prisoner`, optional `credit`); `DELETE /prisoner/photo` takes it down. One photo per record, replaced rather than added to, JPEG, PNG or WebP up to `PHOTO_MAX_BYTES` (5 MiB), and the type is read from the file's own bytes.

**Everything describing the picture is removed before it is stored**: EXIF (where it was taken, when, on which camera), XMP, IPTC, comments, PNG text chunks. Colour profiles and gamma stay, and the pixels are never re-encoded. EXIF orientation goes with the rest, so **clients should rotate a photo before uploading it**, which a crop step does anyway.

**For clients:** every prisoner row now carries `photo` — `{ url, hosted, credit, updatedAt }` or `null` — and that is the field to use. A hosted `url` goes straight into an `<img>` tag: no token, cached for a day, with an `ETag` that changes when the photo does. A photo on a `draft` or `pending` record is served to staff only. Photos are included in backups.

### Limits on what a signed-in account may write (#128)

The endpoints that need no token have been limited since #84, but nothing limited a signed-in account: one script, or one stolen token, could post letters, attachments, proposed changes, invitations and key rotations until the disk filled. Every write is now counted per account over one hour, with the numbers set well above a busy letter night: 240 letters, 60 attachments, 600 envelopes, 60 proposed changes, 60 managed writers, 20 invitations or invite-code batches together, 5 key rotations, 30 device registrations, and 20 sign-ups per address. Staff are counted too, since a group's or an admin's token is the one worth stealing; an admin creating accounts with a token is not counted against the sign-up limit. Directory writes by an admin stay unlimited, which is what a seeding script does. Every setting is a `RATE_LIMIT_*` environment variable (README, "Limits on signed-in writes").

**For clients:** handle `429` on writes, not only on sign-in. Read `Retry-After` (seconds) and say when to try again. A letter refused with `429` was not saved, so retrying is safe, with the same `Idempotency-Key` if one was used.

### Pen name changes are limited (#127)

A pen name once used is never given to anyone else, which is what lets a reply addressed to an old name still find its writer — and it meant an account could rename itself in a loop and empty a namespace everybody shares. A change now waits 90 days after the one before (`PEN_NAME_COOLDOWN_DAYS`), and at most two brand-new names may be taken in a rolling year (`PEN_NAME_NEW_PER_YEAR`). Going back to a name the account has used before costs nothing from the namespace, so it does not count, but still waits out the cooldown. The name chosen at sign-up is the first, not a change, and is free of both. A superadmin, and a group for the unclaimed writers it looks after, may rename past the limits, which is what a writer being harassed needs; those overrides go to the audit log as `user.penName`.

**For clients:** `GET /auth/pen-name` now also answers `changeAllowedAt`, `newNamesLeft`, `newNamesWindowEnds`, `cooldownDays` and `newPerYear`. Read it when the settings screen opens and say so before anyone types. A refusal is `409` `PenNameLimitError` with `condition` `cooldown` or `new_names`.

## 2026-09-25

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

### Answers to the web client's questions (#123)

An address may carry `lines`, the exact lines to print in the order the facility asks for (optional; no seeded facility has them yet). `GET /prisoner/filters` and `GET /prison/filters` give the values a filter UI should offer, so no client has to compile a list. A group's page embeds the facility of each supported prisoner. One rule now covers every typed code (upper case, letters and digits, `O`→`0`, `I`/`L`→`1`), stated in the README with an Argon2id test vector so the clients derive identical keys. Also `npm audit fix` (lockfile only) and sqlite3 6.0.1, which needs Node 20.17 or later.

## 2026-09-23

### Real prisoners and facilities in the seed data (#122)

The made-up directory is gone. A fresh database now holds 58 real prisoner profiles and 45 real facilities in eleven countries, transcribed from support-site profiles with a source recorded on each record. Three things for the clients: addresses have `street`, `city` and `postalCode` (some pending records only `city`); the five Greek facilities' addresses are written in Greek (no name or address is in Cyrillic); and 20 of the 58 records are `pending`, so only staff see them, with `verificationNotes` and each facility's `notes` worth showing prominently.

### Deployment: the test server moved to letters.support

The public test API is `https://abctest.letters.support`. The old name and its certificate were retired. It follows `main` within the hour, keeps a daily encrypted backup, and rolls itself back to the previous code and database if an update does not come back healthy.

---

### Before this log

The API was revived from 2026-09-11 and rewritten heavily through #60–#121: encryption at rest and then end-to-end, retention, moderation, invitations, invite codes, group roles, paper letters, pen names and the reply reference, the split sign-in scheme, encrypted backups, and the audit fixes of #101–#103. The README is the reference for all of it; the pull requests hold the reasoning.
