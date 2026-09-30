# Error codes

Generated from `services/error-codes.js` by `npm run errors:docs -- --write`. Do not edit by hand.

A refused request answers in English and always will. `errors` holds the sentences; `problems` holds
the same failures in the form a client translates from, one entry per sentence and in the same order:

```json
{
	"success": false,
	"errors": ["penName must be between 3 and 40 characters."],
	"problems": [
		{ "field": "penName", "code": "length_out_of_range", "params": { "min": 3, "max": 40 } }
	]
}
```

- **`field`** is the name of the field in the request, or `null` when the failure is about the request as a whole.
- **`code`** is one of the codes below, and never changes meaning. A code a client does not know yet is
  shown as the English sentence from `errors`.
- **`params`** carries limits and names to interpolate, never the value that was sent: a password or a
  letter's text must not come back in an error body.
- **`validation_failed`** means the API has no more specific code for that refusal yet. Show the sentence.
  Codes are added over time and never removed, so this one appears less as the API grows.

| Code                    | What it means                                                                                                                                                                                                                     | `params`     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `validation_failed`     | Something about the request is wrong and has no more specific code yet. Show the sentence from `errors`.                                                                                                                          | —            |
| `required`              | A field the request cannot do without is missing or empty.                                                                                                                                                                        | —            |
| `length_out_of_range`   | Text is shorter or longer than the field allows.                                                                                                                                                                                  | `min`, `max` |
| `out_of_range`          | A number is outside the range the field allows.                                                                                                                                                                                   | `min`, `max` |
| `not_a_number`          | A number was expected.                                                                                                                                                                                                            | —            |
| `not_a_date`            | A date was expected, in ISO-8601.                                                                                                                                                                                                 | —            |
| `not_a_url`             | A URL was expected.                                                                                                                                                                                                               | —            |
| `not_an_email`          | An email address was expected.                                                                                                                                                                                                    | —            |
| `not_allowed_value`     | The value is not one of the ones this field takes.                                                                                                                                                                                | `allowed`    |
| `not_unique`            | Something with this value already exists, and the field has to be unique.                                                                                                                                                         | `fields`     |
| `wrong_type`            | The value is of the wrong kind altogether (text where a list belongs, and so on).                                                                                                                                                 | `expected`   |
| `reserved_value`        | The value is one the API keeps for itself (a username shape the groups use, a placeholder email address).                                                                                                                         | —            |
| `not_eligible`          | The record named exists, but cannot be used for this: a letter that was not returned, an account that cannot be claimed.                                                                                                          | —            |
| `not_settable_here`     | The field is real but not this endpoint's to write; the message says where it belongs.                                                                                                                                            | —            |
| `already_set`           | The field can be set once and already has a value.                                                                                                                                                                                | —            |
| `wrong_encryption_mode` | The request is in the wrong shape for the mode the server runs in: plaintext to an end-to-end server, or ciphertext to one holding the keys. `GET /health` says which mode it is. A client bug, not something the person can fix. | —            |
| `not_an_auth_key`       | A split account sends a derived auth key where a password would go, and this is not one. A client bug, never something the person can fix: do not show it under the password box.                                                 | —            |
| `unknown_reference`     | The request names a record that does not exist.                                                                                                                                                                                   | —            |

## Refusals that are not about a field

A `403`, `404`, `409`, `410` or `422` where the request was well formed and the answer is still no
carries `name`, often `condition`, and a `code` composed from the two:

```text
code = family + ("." + condition, when the refusal has one)
```

`family` is the error name in snake_case with `Error` dropped, so `InviteCodeError` + `used` is
`invite_code.used`, and `NotFoundError` on its own is `not_found`. **Match the whole code, or just the
family before the dot**: a refusal may grow a finer `condition` later, and a build that matched the
family keeps working. `name` and `condition` are still sent and are not going away.

A `5xx` is a fault rather than a refusal and carries no `code`.

| Family                | What a refusal in it means                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `account_delete`      | An account cannot be deleted yet; the condition says what stands in the way.                                                                                                                 |
| `auth_scheme`         | A sign-in scheme that cannot be used here, or a split account's fields missing.                                                                                                              |
| `authentication`      | Not signed in, or a token that is no longer good.                                                                                                                                            |
| `authorization`       | Signed in, and not allowed to do this.                                                                                                                                                       |
| `claim`               | A managed writer that cannot be claimed.                                                                                                                                                     |
| `claim_token`         | A claim code that is unknown, expired, or already used.                                                                                                                                      |
| `duplicate_rule`      | A mail rule that already exists, or reads like one that does.                                                                                                                                |
| `encryption_key`      | A letter the server can no longer open with the key it has.                                                                                                                                  |
| `encryption_mode`     | The request does not match the mode the server runs in.                                                                                                                                      |
| `envelope`            | A letter key sealed to the wrong reader, or one that is missing.                                                                                                                             |
| `group_block`         | The group that would mail this letter has blocked its writer.                                                                                                                                |
| `http`                | A refusal with no finer family of its own.                                                                                                                                                   |
| `idempotency`         | An Idempotency-Key that is in flight, reused, or whose letter is gone.                                                                                                                       |
| `invitation`          | An invitation that is unknown, expired, revoked, or already accepted.                                                                                                                        |
| `invite_code`         | An invite code that is unknown, expired, cancelled, or used.                                                                                                                                 |
| `invite_quota`        | A group's unused invite codes are at their limit.                                                                                                                                            |
| `key_change`          | A key that may not be set or replaced in the way asked.                                                                                                                                      |
| `key_version`         | Sealed to a group key that is no longer current; re-seal and send again.                                                                                                                     |
| `letter_held`         | A letter held because the person was moved or freed.                                                                                                                                         |
| `letter_status`       | A status move that is not allowed, or that somebody else made first.                                                                                                                         |
| `not_found`           | No such record, or none this caller may see.                                                                                                                                                 |
| `reference`           | A record this request points at does not exist, or one it would remove is still pointed at by something else. SQLite does not say which column or which direction, so the message says both. |
| `owner`               | Only a group's owner-admin may do this.                                                                                                                                                      |
| `pen_name_limit`      | A pen name change refused by the cooldown or the yearly count.                                                                                                                               |
| `rate_limit`          | Too many requests; Retry-After says when to come back.                                                                                                                                       |
| `request_body`        | The body could not be read at all: not JSON, too large, or in an encoding the server does not take.                                                                                          |
| `recovery`            | A recovery code or challenge that does not fit.                                                                                                                                              |
| `reply_reference`     | A reply reference that fails its checksum or is unknown.                                                                                                                                     |
| `rotation_incomplete` | A group key rotation that did not carry everything it must.                                                                                                                                  |
| `rule_in_use`         | A mail rule a facility still carries; retire it instead.                                                                                                                                     |
| `rule_tag`            | A mail rule tag that cannot change, or is not the shape of one.                                                                                                                              |
| `submission_changed`  | The proposal was revised while it was being reviewed.                                                                                                                                        |
| `submission_state`    | A proposal that is not in a state this decision fits.                                                                                                                                        |
| `validation`          | Input that fails a rule; these also carry `problems` (above).                                                                                                                                |
