# Switching to end-to-end encryption

A checklist for moving a running Aye Bee See API from `ENCRYPTION_MODE=server` to `ENCRYPTION_MODE=e2e`. Read it all once before starting; the steps are in order, and the last one is the only one that cannot be undone.

## What changes, in one paragraph

Letters are already stored encrypted. In server mode each letter's content key is wrapped with the server's `ENCRYPTION_KEY`, so the API can open letters for readers. In end-to-end mode the content key is sealed to each reader's own public key instead, and the API only stores and hands out ciphertext. Letter bodies and attachment files are never touched by the switch; only the small "envelope" rows that hold the wrapped keys are added, and finally the server's copies are removed.

## Who needs keys, and who you have to reach

Everyone who reads letters needs a keypair: every writer, every group member, and each group (one keypair per group, shared among its members). Unclaimed managed writers cannot sign in, so their group makes keys for them. Admins and each group's anonymous-writer account never have keys.

**You do not have to reach all of them.** Keys are made at sign-in, which is the only moment they can be made (the private key is wrapped with a key derived from the password, and sign-in is when the client holds the password). So the clients do it without being asked: sign in, no keys yet, generate them, show the recovery code, save. The one thing a person has to do is keep the recovery code.

The switch needs exactly one thing to be true: **every active group that relays mail has its group key.** After the switch nothing can be sealed to a group without one, so nobody could send through it. That is a short list of groups you know, and `GET /auth/encryption-readiness` names them.

Everybody else can turn up late:

- A writer who has not signed in since the switch cannot send anything anyway. Their first sign-in makes their keys.
- Their old letters wait under the server's key. The moment they (or their group) get keys, the API seals those letters to them, and drops its own copy of each letter once every reader has theirs. Nothing is lost by waiting.
- A reply that arrives for a writer who has no keys yet can still be recorded, for the group alone. When the writer gets keys, a member's client adds the writer's envelope (`GET /messaging/envelopes/missing`, then `POST /messaging/envelope`).
- Retention helps: mailed letters are deleted after 90 days by default, so the pile of letters waiting for someone shrinks by itself.

## Before you start

- [ ] The API is on a release that includes this guide's endpoints (`/auth/encryption-readiness`, `/messaging/envelopes/missing`) and has been running in server mode with it. The two modes share one database layout.
- [ ] Both clients are on the e2e contract (README, "End-to-end mode"): they send `ciphertext`, `nonce`, and `envelopes`, read them back, encrypt attachments, and **set up keys automatically at sign-in** (see step 1). The mode is one server-wide setting: from the moment of the switch a client that still sends plaintext is refused, so an older phone app must be made to update first. Until then, do not go past step 2.
- [ ] You have a recent backup of `database.sqlite`, the uploads directory, and `.env`. **Keep `ENCRYPTION_KEY` in `.env` after the switch**: it is what lets the API hand a latecomer their old letters.

## Step 1: keys appear as people sign in (weeks, no downtime)

Ship this in the clients while the API is still in server mode. The key endpoints work in either mode; the API stores the keys and keeps using its own for reading in the meantime.

What each client does after a successful sign-in, without asking:

1. `GET /auth/keys`. If `publicKey` is null: generate a keypair, wrap the private key under the password and under a recovery code, **show the recovery code and make the person confirm they saved it**, then `PUT /auth/keys`. The response's `caughtUp` says how many existing letters were sealed to them on the spot.
2. For a group member: if `orgKey.chapterPublicKey` is null, the group has no key. Generate one and `PUT /auth/chapter-keys`.
3. For a group member who holds the group key: `GET /auth/member-keys?chapter=`, and for each member with a `publicKey` and `holdsGroupKey: false`, seal the group key to them with `PUT /auth/member-key`. (A member who has their own keys but not the group's yet sees `orgKey.wrappedOrgPrivateKey: null` and waits for any holder to sign in.)
4. For a group member, on the writers list: for each unclaimed writer without a `publicKey`, generate a keypair and store the public key plus the group-sealed private key through `PUT /auth/user` with `orgKeyVersion`.
5. After the switch only: `GET /messaging/envelopes/missing`, and for each item open the group's `wrappedKey`, seal the content key to `publicKey`, and `POST /messaging/envelope`.

Watch progress as an admin:

```bash
curl -s http://localhost:3000/auth/encryption-readiness -H "Authorization: Bearer $TOKEN"
```

- `ready` and `blockers`: whether the switch can go ahead, and which groups stop it. A group blocks if it is active, relays mail (`networkRole` is not `collecting`, or it is attached to a facility), and has no key. These are the people to phone.
- `groups.withoutKey`, `groups.membersWaitingForGroupKey`, `groups.unclaimedWritersWithoutKeys`: the rest of the group picture.
- `writers.withoutKeysWithLetters`: writers who have something waiting for them. `letters.serverHeld`, `waitingForWriters`, `waitingForGroups`: how much still waits, and on how many people.

## Step 2: re-wrap, as often as you like

Still in server mode. Signing in already seals each person's own letters to them; this sweeps up everything else in one go, and is safe to repeat.

```bash
npm run encryption:rewrap -- --dry-run
```

```bash
npm run encryption:rewrap
```

It seals each letter's content key to its writer, its relay group, and the group managing the writer, for every reader that has a public key, and lists the letters that still wait, naming who for (`letter 41: no public key for user 7`). Server mode keeps working exactly as before, because the server's own copies are still there. You can stay at this step indefinitely.

## Step 3: switch

When `ready` is `true` and both clients are on the e2e contract. You do not need the waiting list to be empty.

1. Announce a short maintenance window and stop the API. (A letter written in server mode in the last seconds before the switch would be handled like any other waiting letter, so this is tidiness, not safety.)
2. Run the re-wrap once more and drop the server's copy of every letter that no longer needs it:

   ```bash
   npm run encryption:rewrap -- --drop-server-keys
   ```

   It only deletes the server envelope of letters whose every required reader has one of their own. Letters still waiting for someone are reported and kept.

3. In `.env`, set `ENCRYPTION_MODE=e2e`. **Leave `ENCRYPTION_KEY` where it is.**
4. Start the API. The boot log says how many letters still wait for a reader; that is expected, not an error.
5. Smoke test from a client: sign in and confirm the key bundle comes back, open an existing letter, send a new one, open it as the relay group, upload and download an attachment.

## Step 4: latecomers (months)

Nothing to do. Each person's first sign-in makes their keys and hands them their old letters; the API drops its copy of a letter as soon as every reader has their own. The readiness report shows the pile shrinking.

If a group never comes back, its writers' old letters are still sealed to the writers; only the group's own way in is missing, and an admin may prefer to suspend the group.

## Step 5: end the wait (optional, and final)

When you decide nobody else is coming, for example after the 90 days in which retention has removed most mailed letters anyway:

```bash
npm run encryption:rewrap -- --drop-all-server-keys --dry-run
```

```bash
npm run encryption:rewrap -- --drop-all-server-keys
```

The dry run lists every letter that still waits and who for. The real run deletes the server's remaining copies: those readers can never open those letters (other readers of the same letter, such as the group that relayed it, keep their own way in). After it, `ENCRYPTION_KEY` opens nothing in the live database and only matters for restoring old backups.

## Rolling back

- While the server still holds a copy of every letter's key (before step 3.2): set `ENCRYPTION_MODE=server` and restart. That is the whole rollback; the reader envelopes you added are harmless in server mode.
- After step 3.2 the server has let go of the letters whose readers are all covered, so it cannot read those again and server mode cannot be restored from the live database. Rolling back means restoring the backup from before the switch, which loses anything written since.

## What is different afterwards

- Admins cannot read letters. Moderation works on metadata, status, and the directory only.
- A writer who forgets their password and their recovery code loses their letters; there is no reset. The group that relayed a letter still holds its own envelope, so it can reprint from its side.
- `POST /messaging/message` refuses `messageText`; `GET` returns `messageText: null` with `ciphertext`, `nonce`, and `envelopes`.
- Attachment downloads return ciphertext as `application/octet-stream` with an `X-Encrypted: e2e` header.
- Seed data no longer includes letters (`messages: 0 seeded` on a fresh database).
- A writer who has not set up keys sees that a letter exists (`envelopes: []`) and cannot open it until they do. Clients should say so, rather than showing an empty letter.
- Removing a member from a group's key (`DELETE /auth/member-key`) only stops handing it out. To revoke someone who already opened it, a remaining key holder rotates the group key from the front end (README, "Rotating a group key"); plan to do this whenever a member leaves.
