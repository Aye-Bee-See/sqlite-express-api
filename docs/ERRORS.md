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

| Code | What it means | `params` |
| --- | --- | --- |
| `validation_failed` | Something about the request is wrong and has no more specific code yet. Show the sentence from `errors`. | — |
| `required` | A field the request cannot do without is missing or empty. | — |
| `length_out_of_range` | Text is shorter or longer than the field allows. | `min`, `max` |
| `out_of_range` | A number is outside the range the field allows. | `min`, `max` |
| `not_a_number` | A number was expected. | — |
| `not_a_date` | A date was expected, in ISO-8601. | — |
| `not_a_url` | A URL was expected. | — |
| `not_an_email` | An email address was expected. | — |
| `not_allowed_value` | The value is not one of the ones this field takes. | `allowed` |
| `not_unique` | Something with this value already exists, and the field has to be unique. | `fields` |
| `wrong_type` | The value is of the wrong kind altogether (text where a list belongs, and so on). | `expected` |
| `reserved_value` | The value is one the API keeps for itself (a username shape the groups use, a placeholder email address). | — |
| `not_eligible` | The record named exists, but cannot be used for this: a letter that was not returned, an account that cannot be claimed. | — |
| `not_settable_here` | The field is real but not this endpoint's to write; the message says where it belongs. | — |
| `already_set` | The field can be set once and already has a value. | — |
| `wrong_encryption_mode` | The request is in the wrong shape for the mode the server runs in: plaintext to an end-to-end server, or ciphertext to one holding the keys. `GET /health` says which mode it is. A client bug, not something the person can fix. | — |
| `not_an_auth_key` | A split account sends a derived auth key where a password would go, and this is not one. A client bug, never something the person can fix: do not show it under the password box. | — |
| `unknown_reference` | The request names a record that does not exist. | — |
