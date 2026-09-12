# Switching to end-to-end encryption

A checklist for moving a running Aye Bee See API from `ENCRYPTION_MODE=server` to `ENCRYPTION_MODE=e2e`. Read it all once before starting; the steps are in order, and the last one is the only one that cannot be undone.

## What changes, in one paragraph

Letters are already stored encrypted. In server mode each letter's content key is wrapped with the server's `ENCRYPTION_KEY`, so the API can open letters for readers. In end-to-end mode the content key is sealed to each reader's own public key instead, and the API only stores and hands out ciphertext. Letter bodies and attachment files are never touched by the switch; only the small "envelope" rows that hold the wrapped keys are added, and finally the server's copies are removed.

## Before you start

- [ ] The API is on a release that includes the e2e code (pull request #74 or later) and has been running in server mode with it. Nothing about the switch needs to be rushed; the two modes share one database layout.
- [ ] The front end is on the e2e contract (README, "End-to-end mode"): it sends `ciphertext`, `nonce`, and `envelopes`, reads them back, encrypts attachments, generates keypairs and claim tokens for managed writers, and has a "set up your keys" step and a group-key bootstrap step. Until it does, do not go past step 3.
- [ ] You have a recent backup of `database.sqlite`, the uploads directory, and `.env`. Keep `ENCRYPTION_KEY` in that backup; after the switch it is the only way to read any letter that was not re-wrapped.
- [ ] You know how you will reach every active group: the first member of each group has to bootstrap the group keypair from their browser, and someone has to generate keypairs for any managed writers who have not claimed their accounts.

## Step 1: everyone sets up keys (weeks, not minutes)

Nothing here needs downtime. Keys can be created while the API is still in server mode; the API stores them and keeps using its own key for reading in the meantime.

- Writers: at next login the front end generates a keypair, wraps the private key under the password and a recovery code, shows the recovery code once, and calls `PUT /auth/keys`.
- Groups: the first member calls `PUT /auth/chapter-keys` (from the front end) with a new group keypair sealed to their own key, then hands the group key to each other member with `PUT /auth/member-key`. `GET /auth/member-keys?chapter=` shows who is still missing it.
- Unclaimed managed writers: those accounts cannot log in, so the group's browser generates a keypair for each one and stores the public key plus the group-sealed private key on the writer (the same fields `POST /auth/writer` takes in e2e mode, sent through `PUT /auth/user` by the managing group). The front end needs a "prepare for encryption" action on the writers list for this. Claimed writers are ordinary accounts and follow the writer flow.

Check progress from the server:

```bash
sqlite3 database.sqlite "SELECT COUNT(*) AS users_without_keys FROM User WHERE publicKey IS NULL AND role != 'banned' AND anonymousForChapter IS NULL;"
```

```bash
sqlite3 database.sqlite "SELECT id, name FROM Chapters WHERE publicKey IS NULL AND accountStatus = 'active';"
```

Anonymous-writer accounts (one per group) never get keys; their letters are sealed to the group only.

## Step 2: rehearse the re-wrap

With the API still in server mode, from the API directory:

```bash
npm run encryption:rewrap -- --dry-run
```

It prints how many envelopes it would create and lists every letter it cannot fully cover, naming the reader who still has no keys, for example `letter 41: no public key for user 7`. Nothing is written. Run it as often as you like while people set up keys; the list should shrink to nothing.

## Step 3: re-wrap for real

Still in server mode:

```bash
npm run encryption:rewrap
```

This seals each letter's content key to its writer, its relay group, and the group managing the writer, for every reader that has a public key. It is safe to repeat; it only adds envelopes that are missing. Server mode keeps working exactly as before, because the server's own copies are still there. You can stay at this step indefinitely.

Check that no letter is left behind:

```bash
npm run encryption:rewrap -- --dry-run
```

The output should say `0 letter(s) still need reader keys`.

## Step 4: switch

Only when the front end is on the e2e contract and step 3 reports nothing outstanding.

1. Announce a short maintenance window. Letters written in server mode during the last seconds before the switch would get a server envelope and no reader envelopes; stopping writes avoids that. Stop the API.
2. Run the re-wrap one last time and drop the server's copies:

   ```bash
   npm run encryption:rewrap -- --drop-server-keys
   ```

   It only deletes the server envelope of letters whose every required reader now has one of their own; anything else is reported and kept.

3. In `.env`, set:

   ```text
   ENCRYPTION_MODE=e2e
   ```

   `ENCRYPTION_KEY` may stay in the file; the API ignores it in e2e mode, and you still want it in your backups.

4. Start the API and read the boot log. It prints a warning if any letter still carries a server envelope. If you see one, stop, set the mode back to `server`, and go back to step 3; nothing has been lost yet.

5. Smoke test from the front end: log in and confirm the key bundle comes back, open an existing letter, send a new one, open it as the relay group, upload and download an attachment.

## Rolling back

- Before step 4.2 (server envelopes still present): set `ENCRYPTION_MODE=server` and restart. That is the whole rollback; the reader envelopes you added are harmless in server mode.
- After step 4.2: the server has no copies of the content keys, so it cannot read letters again and server mode cannot be restored from the live database. Rolling back means restoring the backup from before the switch, which loses anything written since. This is why step 3 and the boot warning exist: do not drop the server keys until the dry run is clean.

## What is different afterwards

- Admins cannot read letters. Moderation works on metadata, status, and the directory only.
- A writer who forgets their password and their recovery code loses their letters; there is no reset. The group that relayed a letter still holds its own envelope, so it can reprint from its side.
- `POST /messaging/message` refuses `messageText`; `GET` returns `messageText: null` with `ciphertext`, `nonce`, and `envelopes`.
- Attachment downloads return ciphertext as `application/octet-stream` with an `X-Encrypted: e2e` header.
- Seed data no longer includes letters (`messages: 0 seeded` on a fresh database).
- The developer guide's open items list what is not built yet: rate limiting on the recovery endpoints and a way for a group to rotate its keypair.
