# HTTP API — 2026-11-05

Legacy `FREETION_*` variables are read only while no `DECKMATE_*` variable is set: the two sets never mix (2026-11-05). Clients send `x-deckmate-token` and `x-deckmate-actor`; reload an older client before writing.

A short reference for agents working with a Deckmate project over HTTP. The Markdown files of the data project stay the single source of truth; this API edits them under hash guards. File formats and boundaries: [catalog.md](catalog.md).

## Two-language file format — 2026-11-05

The manifest field `formatLanguage: en | ru` selects stored state words and Markdown markers. New manifests, including demo/starter projects, use `en`; an existing manifest without the field remains Russian, and Deckmate does not add the field during unrelated edits. A folder without a manifest is a new English project.

API input, `state:` search and CLI `--state` accept both languages. API responses, activity `transitions` and JSON CLI output use English ids. Writes to native cards, legacy H3 markers and the activity journal use the project language.

| Id / marker | English file word | Russian file word |
|---|---|---|
| `not-started` | `not-started` | `план` |
| `discussing` | `discussing` | `обсуждаем` |
| `in-iteration` | `in-iteration` | `итерация` |
| `started` | `started` | `в работе` |
| `review` | `review` | `приёмка` |
| `done` | `done` | `принято` |
| Open questions | `## Open questions` | `## Открыто` |
| Decision Task | `Decision: …` | `Решение: …` |
| Workflow assignment | `## Assignment: <role>` | `## Задание: <role>` |
| Recorded decisions | `## Decided` | `## Решено` |
| Journey step lessons | `## Lessons` | `## Грабли` |

See [catalog.md](catalog.md#two-language-file-format--2026-11-05) for byte-preservation and existing-section rules.

## Run and address

- `npx deckmate --data <project>` (from a source checkout: `npm run build`, then `npm start -- --data <project>`) → `http://127.0.0.1:4317/` (loopback by default; `--port` or `DECKMATE_PORT` overrides the port).
- `DECKMATE_HOST=0.0.0.0` is used inside the Docker image. Publish the container port on host loopback (`-p 127.0.0.1:4318:4318`); the API has no remote-user authentication. See [the local trust model](../SECURITY.md#local-trust-model).
- `DECKMATE_DATA` — the project folder. Default `direct` mode edits it in place without requiring git; use git commits for recovery.
- `DECKMATE_WRITE` enables `sandbox` mode: a separate worktree outside the project, on branch `deckmate/sandbox` or `freetion/sandbox`. Only this copy is writable; the original stays read-only.
- `--read-only` or `DECKMATE_READ_ONLY=1` selects `read-only` mode and overrides `DECKMATE_WRITE`.
- Every endpoint takes `source=live|sandbox` (query parameter or body field, default `sandbox`). The internal name `sandbox` means the writable source: the project itself in `direct`, the separate copy in `sandbox`. Writes to `source=live` are rejected.

## Token and actor

| Header | Value |
|---|---|
| `x-deckmate-token` | Required on every non-GET request. Take `token` from `GET /api/snapshot?source=sandbox`; it is regenerated at each server start. |
| `x-deckmate-actor` | Optional. A member ID from the registry (`CatalogView.members`, pattern `[a-z0-9][a-z0-9-]{0,79}`). It is recorded as `actorMemberId` in the activity journal and names the uploader of an attachment. Without it the record shows an unknown author. |

Requests whose `Host` is not `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`, or with a foreign `Origin`, are rejected with 403. For Docker, the host-side published port must match the container port (or `DECKMATE_PORT`): a different mapping makes every request fail with 403 because the `Host` header does not match the configured port.

These header checks protect browser access; they do not authenticate remote clients. A client that can reach the port can supply an allowed `Host`, omit `Origin`, and obtain the token from `/api/snapshot`.

## Hash guards (optimistic concurrency)

Catalog, card, board and attachment edits carry the SHA-256 hashes required by their action. A stale hash is rejected with `409` and nothing is written; re-read, take fresh hashes, repeat the action once. Empty string `""` means "file absent / nothing yet". All values are lowercase hex. Notification seen/dismiss actions do not take source hashes.

| Field | SHA-256 of | Where to read | Used by |
|---|---|---|---|
| `manifestHash` | `tasks/deckmate.md` bytes | `CatalogView.manifestHash` | Catalog writes and import; attachment actions require the field but check only `attachmentsHash` for freshness |
| `sourceHash` | Whole source file of the card (`cards/<uuid>.md` or the mechanic/page file) | `card.sourceHash`, `/api/card-content` | Card edits, `cards[]` selections, `reorder-hand` |
| `optionsHash` | `tasks/deckmate-card-options.md` | `CatalogView.optionsHash` | `bulk-edit-cards`, `catalog-import` |
| `tagsHash` | `tasks/deckmate-tags.md` | `CatalogView.tagsHash` | `save-project-tag` |
| `attachmentsHash` | The card's attachment registry | `GET /api/attachments` → `.hash` | `upload-attachment`, `remove-attachment` |
| `journeyHash` | Journey index + ordered step files (aggregate) | `journey.fileHash` | `apply-journey`, `update-journey`, `save-journey-template`, `add-journey-step-lesson` |
| `templateHash` | Journey template index + steps (aggregate) | `journeyTemplate.fileHash` | `import-journey-template` |
| `parentSourceHash` | Target parent card's `sourceHash` | `card.sourceHash` | `set-card-parent` (null when detaching) |
| `runsHash`, `milestonesHash` | `tasks/deckmate-runs.md`, `tasks/deckmate-milestones.md` | `CatalogView.runsHash`, `.milestonesHash` | `POST /api/planning` |
| `watchHash` | The member's watch list in `tasks/deckmate-notifications.md` | `GET /api/notifications` → `watchHash` | `POST /api/notifications/watch` |
| `hash` (boards) | `boards/<id>.excalidraw` bytes | `GET /api/boards/:id` → `hash` | `POST /api/boards` (`""` for a new board) |

On success a write returns the updated `CatalogView` — its `manifestHash` is the base for your next write. A `503` with `saved: true` means the Markdown write landed but a follow-up step (index, journal, board rebuild) failed: do **not** repeat create-style actions blindly, re-read first. `create-card` retries are safe when `cardId` and content are identical; a different content under the same ID is a `409`.

## Read endpoints

All accept `?source=live|sandbox`.

| Endpoint | Returns |
|---|---|
| `GET /api/snapshot` | Workspace snapshot + `token`: `editMode` (`direct`, `sandbox`, `read-only`), effective `source`, `writable`, project name and iteration. The UI shows a source switch only in `sandbox` mode. |
| `GET /api/catalog` | Full `CatalogView`: cards, spaces, decks, tracks, journeys, journeyTemplates, members, subCardOrder, runs, milestones, warnings, hashes. Reading the writable source may perform server housekeeping writes (Run carry-over and automatic archiving) without a client token; no client-supplied data is written. |
| `GET /api/cards` | Indexed search. Query: `text`, `deckId`, `trackId`, `kind=task|hero|doc`, `state`, `owner`, `limit` (≤1000). Excludes archived/deleted. |
| `GET /api/cards?fields=brief` | Same search and card properties, without `markdown`, with `hits: [{ line, text }]`: up to 3 excerpts per card, each at most 200 characters. Lines are absolute, 1-based source-file lines. Without `fields` the original response is unchanged. |
| `GET /api/brief` | `cardId` (full ID or `c-ref`), optional `budget` (positive integer, default 1500) → `{ markdown, tokens, truncated, readNext }`. Fresh source text, family, relevant rules/code, related cards and history. |
| `GET /api/changes` | `cardId` (full ID or `c-ref`), required `since` (ISO timestamp with timezone or full 64-digit SHA-256) → current `sourceHash`, journal events, Git history and explicit checkpoint scope. Never writes a checkpoint. |
| `GET /api/card-content` | `{ cardId, title, markdown, sourceHash }` for one card — the full editable text, not the catalog excerpt. |
| `GET /api/summary` | `track` (ID or unique title) and `limit` (0–100, default 5) → counts, groups `doing/review/blocked/ready/planned`, `dependencies`. |
| `GET /api/activity` | Deck journal page `{ events, nextCursor, warnings }`; `deckId` required, `limit` 1–50 (default 10), `cursor` opaque. |
| `GET /api/card-activity` | One card's history page; page ≤ 20 events. |
| `GET /api/attachments` | `{ hash, files, warnings }` of one card. Legacy cover entries are not returned (2026-11-09). |
| `GET /api/project-pulse` | Decks home pulse, `ProjectPulse` in `src/pulse-contracts.ts`: `inProgress { count, ownerIds }` (started Tasks; owners' member IDs, most frequent first, at most six), `review { count, oldestSince, deckId }` (the oldest last entry into review known to the journal), `accepted { days, total }` (14 project-local days, oldest first; a card counts once, on its last move into done, while it stays accepted), `run` (the first schedule's current Run with accepted and all Tasks, or null), `withoutDeck`. Archived and Trash cards are left out, except that an archived acceptance still counts. Like `GET /api/catalog`, reading the writable source may perform the same server housekeeping writes (Run carry-over and automatic archiving) without a client token; no client-supplied data is written. |
| `GET /api/journey-metrics` | `journeyId` required; `{ journeyId, steps, warnings }` with instances, accepted, returns, cycle hours, owners, actors and up to three recent return reasons per step. All versions, excluding Trash; structured transitions only. |
| `GET /api/notifications` | Notification stacks for `member` (default: "me" — first human of the registry). |
| `GET /api/boards`, `GET /api/boards/:id` | Vision boards; `:id` returns the scene with images inlined as data URLs. |
| `GET /api/file` | Raw project file; `path` must start with `features/`, `docs/`, `tasks/` or `cards/`, extension `.md .png .jpg .jpeg .webp .svg .gif .pdf`. |
| `GET /api/file?path=…&from=…&to=…` | Exact Markdown line range, inclusive and 1-based. Both bounds are required, must exist and be ordered. Keeps BOM on line 1, CRLF/LF and the final line ending. Without bounds returns the original whole file. |
| `GET /api/onboarding-facts` | `{ agentSkill }` for the onboarding quests: whether the `/deckmate` skill is installed in the project folder. |
| `GET /api/project-templates`, `GET /api/project-templates/:id/plan` | Bundled starter templates; `plan` lists what `apply-project-template` would create in this project, with its `templateHash`. 404 for an unknown ID. |
| `GET /api/health` | `{ app, version, pid }`. |
| `GET /r/<ref>` | Short link (`c-…` card, `p-…` pipeline, `v-…` board) → redirect into the app. 404 when unknown. |
| `WS /api/events?token=…` | Push on file changes: `{ type: "changed", source, relativePath, detectedAt }`, and `{ type: "watcher-error", source }`. |

### Agent context — 2026-11-05

Start with `GET /api/brief?cardId=<c-ref>`, follow a `readNext` entry through `/api/file?path=…&from=…&to=…`, then call `/api/changes?cardId=<c-ref>&since=<checkpoint>` when returning to the task. `readNext` entries carry `path`, inclusive `from`/`to`, `title` and estimated `tokens`. A brief is a bounded selection, not a substitute for omitted rules; `truncated` reports omissions. Its `tokens` estimates Markdown using Cyrillic characters / 2.7 plus other characters / 3.8, rounded up; it is not a model tokenizer.

The card's mandatory verbatim text is never silently cut. If it cannot fit the requested budget, `brief` fails with the required minimum (HTTP 422); increase the budget or read a file range. Nonpositive budgets fail validation. Brief search uses a disposable read-only index, so `fields=brief` does not trigger automatic archival or Run carry-over.

An ISO checkpoint filters journal events strictly after that instant. A hash checkpoint compares the current source bytes (`previousSourceHash`, `sourceHash`, `changed`), but cannot establish an event timestamp: `eventScope: "all-card-events"` explicitly returns the full card journal and a warning. With an ISO checkpoint `changed` is `null`. Sidecar property changes may appear in the journal without changing the source hash. Git supplies the last three commits touching the source path; journal events do not capture arbitrary external edits. An unavailable Git history is reported explicitly. The context endpoints do not create notifications, receipts or files in `tasks/`.

CLI equivalents (JSON except the default `brief` Markdown), run from the project folder or with `--data <project>`; they need no running server. From a Deckmate source checkout, `npm run project -- <command>` is the same command.

```text
npx deckmate project brief <c-ref>
npx deckmate project brief <c-ref> --budget 1500 --json
npx deckmate project show <c-ref> --lines 212-217
npx deckmate project find fuel --fields brief
npx deckmate project changes <c-ref> --since 2026-11-01T00:00:00Z
```

To keep pre-existing CLI JSON byte-compatible, `find`, `show` and `summary` expose token counts only with the new `--fields brief` option. `find --fields brief` returns compact `{ cards, tokens }`, retaining old non-Markdown properties and adding `hits`; `show --fields brief` and `summary --fields brief` add `tokens` to their original object. These estimates describe the compact JSON before adding the `tokens` field. `show --lines` returns `{ path, from, to, totalLines, markdown, sourceHash, tokens }` and preserves the exact source line endings inside `markdown`. Old calls without new parameters keep their original shapes and bodies.

## Write endpoints

### POST /api/catalog

The write path for the catalog; Runs and Milestones use `POST /api/planning` below. Body: `action`, `source: "sandbox"`, `manifestHash`, plus the action's required fields. On success returns the updated `CatalogView` (bulk actions add `bulkOutcome: { applied, unchanged, pending, created?, warnings }`).

| `action` | Required fields |
|---|---|
| `bulk-edit-cards` | `cards`, `optionsHash`, `change` |
| `set-card-state` | `cardId`, `sourceHash`, `state`; optional `returnReason` (one line, ≤500 characters, only leaving review without acceptance). In a deck with guardians, `done` needs a guardian as `x-deckmate-actor` (without the header, as `acceptedBy`). A native Hero takes only `done` (manual mark, refused while it has Task Sub Cards other than `wont-do`) and `not-started` (removes the mark) |
| `set-card-properties` | `cardId`, `sourceHash`, `owner`, `effort`, `priority` |
| `set-card-parent` | `cardId`, `sourceHash`, `expectedParentId`, `parentId`, `parentSourceHash` |
| `reorder-subcards` | `cardId`, `sourceHash`, `cardIds` |
| `configure-members` | `members` |
| `save-project-tag` | `tagsHash`, `tag` |
| `raise-decision` | `cardId`, `sourceHash`, `questionIndex`, `questionText`, `taskCardId`, `deckId`, `memberId` |
| `record-decision` | `cardId`, `sourceHash`, `questionIndex`, `questionText`, `answer`, `memberId` |
| `set-card-links` | `cardId`, `deckId`, `trackIds`, `sourceHash` |
| `bulk-assign-deck` | `cards`, `deckId` |
| `bulk-add-track` | `cards`, `trackId` |
| `create-space` | `title` |
| `create-deck` | `title`, `spaceId`, `kind`, `icon`, `color`, `description`; optional `deckId` (UUID for an idempotent create followed by upload), `style`, `coverPosition` (0–100, retained by a later cover upload) |
| `update-space` | `spaceId`, `title`, `kind`, `icon` |
| `update-deck` | `deckId`, `title`, `icon`, `color`, `description`, `style`, `cover`, `coverPosition` |
| `set-deck-kind` | `deckId`, `kind` (asset/task/knowledge/mixed) |
| `set-deck-default-order` | `deckId`, `defaultOrder` (URL-parameter string ≤200 characters, or null to clear) |
| `upload-cover` | `deckId`, `dataUrl` (image ≤ 5 MB) |
| `move-deck` | `deckId`, `spaceId`, `beforeDeckId` |
| `move-space` | `spaceId`, `beforeSpaceId` (Space ID, or null to append); reorders only `spaces`, leaving Decks unchanged; the current position is a no-op |
| `delete-deck` | `deckId`; its cards lose the deck, a deck with a Journey cannot be deleted |
| `set-deck-zones` | `deckId`, `zones` (full ordered list) |
| `move-cards-in-deck` | `deckId`, `cards`, `zoneId`, `beforeCardId` |
| `set-inbox-deck` | `deckId` (null clears): the deck for cards created without one |
| `set-deck-watchers` | `deckId`, `watcherIds` (full replacement list) |
| `set-deck-pile` | `deckId`, `piled`: true moves the deck to the pile at the end of its space, false returns it to the shelf and removes the key; deck order and cards stay, a repeat does not write |
| `set-deck-guardians` | `deckId`, `guardianIds`: only these members accept cards of the deck |
| `set-deck-automation` | `deckId`, `autoTag`, `autoTagKeep`, `templateMarkdown`, `templateOwner`, `templateEffort`, `templatePriority` |
| `apply-project-template` | `templateId`, `templateHash`, `samples` |
| `create-journey` | `deckId`, `title`, `steps` |
| `apply-journey` | `cardId`, `journeyId`, `journeyHash`, `stepIds`, `deckAssignments`, `sourceHash` |
| `update-journey` | `journeyId`, `journeyHash`, `title`, `description`, `zones`, `steps` |
| `import-journey-template` | `deckId`, `templateId`, `templateSource`, `templateHash`, `mode`, `journeyId`, `journeyHash`, `roleMapping` |
| `save-journey-template` | `journeyId`, `journeyHash`, `title`, `description`, `category`, `tags` |
| `add-journey-step-lesson` | `journeyId`, `journeyHash`, `stepId`, `cardId`, `text` (≤500 characters); a known `x-deckmate-actor` is required. Appends to the step's `## Lessons` (`## Грабли`) without increasing Journey version. |
| `create-track` | `title`, `description` |
| `assign-deck` | `cardId`, `deckId` (null detaches) |
| `set-tracks` | `cardId`, `trackIds` |
| `upload-attachment` | `cardId`, `attachmentsHash`, `dataUrl` (file ≤ 10 MB, PNG/JPEG/WebP/GIF/PDF; `fileName` optional) |
| `remove-attachment` | `cardId`, `attachmentsHash`, `file` |
| `update-card-content` | `cardId`, `title`, `markdown`, `sourceHash` |
| `add-card-report` | `cardId`, `sourceHash`, `markdown`; optional `state` — the HTTP form of `deckmate project report` |
| `create-card` | `cardId` (`card:<uuid>`, generated by the caller), `kind`, `title`, `markdown`, `deckId`, `trackIds`, `parentId`, `owner`, `effort`, `priority` |
| `set-card-dependencies` | `cardId`, `sourceHash`, `dependsOn` (full replacement list) |
| `reorder-hand` | `memberId`, `cards: [{ cardId, sourceHash }]` — the complete unique permutation of the member's open Hand cards; writes only that member's `handOrder` slots in CardOptions |

Field notes:

- `cards` selections are `[{ cardId, sourceHash }]`, 1–1000 unique entries; only `bulk-edit-cards` with `change.kind: "promote-parent"` allows `cards: []` to promote a card without attaching children. Nullable fields are passed explicitly as `null`, empty lists as `[]`.
- `create-card.deckId: null` means automatic placement: Inbox if it accepts `kind`, otherwise Unassigned (`deckId: null`), including Sub Cards. An explicit deck must exist and accept the card kind. `set-inbox-deck` allows only Task or Mixed decks; null clears it. Legacy Inbox kinds remain readable. Changing the Inbox to a kind that cannot take Tasks clears it with a warning.
- `bulk-edit-cards.change`: `kind` one of `properties, state, parent, create-parent, promote-parent, options, hand, tags, convert, duplicate, track` — each kind brings its own fields (see `src/bulk-contracts.ts`).
- `state`: English ids `not-started`, `discussing`, `in-iteration`, `started`, `review`, `done`; the Russian words from the table above are accepted as input too. Responses always use ids. `priority`: `high|medium|low` or null. `effort`: number ≥ 0 or null.
- Card `title` ≤ 1000 chars, no line breaks; `markdown` ≤ 200000 chars. Titles of spaces/decks/tracks/journeys/templates ≤ 120 chars. `description`, `questionText`, `answer` ≤ 2000 chars.
- Attachment actions run through the attachment module; with `x-deckmate-actor` the uploader is the actor, not `addedBy` from the body.
- Card covers were removed on 2026-11-09. Uploads and removals replace only the registry's `files` block; legacy `cover` entries remain byte-for-byte unchanged and are not shown. New registries have no `cover` field. Deck, Run and Milestone covers and Vision images are unaffected.

### Other writes

| Endpoint | Body → result |
|---|---|
| `POST /api/catalog-import` | CSV import (one row → one native card). `{ source: "sandbox", manifestHash, optionsHash, deckId, cards[1..5000] }` → report `{ created, unchanged, skipped, warnings }`. |
| `POST /api/boards` | `{ source, id?, title, hash, scene }` → saved `BoardDocument` with the new `hash`. Scene ≤ 5000 elements / 20 MB. |
| `POST /api/planning` | `{ source: "sandbox", action, … }`: `update-run`, `save-run-configuration`, `finish-run`, `delete-run`, `resume-runs`, `create-milestone`, `update-milestone`, `delete-milestone`, `pin-milestone`, guarded by `runsHash` / `milestonesHash` (plus `optionsHash` / `manifestHash` where cards or the manifest change) → updated `CatalogView`. Fields: `server/planning-schema.ts`. |
| `POST /api/notifications/dismiss` | `{ source, memberId, at, cardId? \| stack?: "owned" \| "watching" }`; writes `tasks/deckmate-notifications.md`. |
| `POST /api/notifications/watch` | `{ source, memberId, cardId, watching, watchHash }` watches or unwatches one card in the same file. |
| `POST /api/shutdown` | Stops the server. |

## Errors and limits

Response shape: `{ code, message }`, codes `CATALOG`, `CONTENT`, `IMPORT`, `MODEL`, `BOARD`, `READ_ONLY`, `SERVER` (a few 403/404 and `/api/planning` errors carry only `message`); `saved: true` marks a partially completed write.

| Status | Meaning |
|---|---|
| 400 | Malformed request or schema violation (e.g. missing field, non-string title/markdown). |
| 403 | Missing/wrong token, foreign `Host`/`Origin`, write to `live`, read-only mode or a sandbox branch that does not permit writes. |
| 404 | Unknown card, board, file, or short reference. |
| 409 | Stale hash of any guarded file, a `cardId` taken by different content, or a changed board file; the body carries a plain message (with `code: "CATALOG"` outside `/api/planning`), not an internal conflict name. Re-read and repeat once. |
| 422 | Invalid value or domain failure (bad state, title limits, edit that breaks mechanic structure, undecodable data URL). |
| 503 | Write landed, follow-up failed (`saved: true`) — re-read instead of repeating. |
| 500 | Unexpected server error. |

Body limits: 512 KB default; `/api/catalog` 16 MB; `/api/catalog-import` 24 MB; `/api/boards` 21 MB. Attachment registry ≤ 500 files per card. Writes are serialized server-side, so concurrent requests cannot interleave; each confirmed mutation appends an event to `tasks/deckmate-activity/`.

## Examples

```bash
BASE=http://127.0.0.1:4317
TOKEN=$(curl -s "$BASE/api/snapshot?source=sandbox" | python -c "import sys, json; print(json.load(sys.stdin)['token'])")
curl -s "$BASE/api/catalog?source=sandbox" > view.json
# view.json: take manifestHash, the card's sourceHash, and optionsHash
```

Change a card's state:

```bash
curl -s -X POST "$BASE/api/catalog" \
  -H "Content-Type: application/json" -H "x-deckmate-token: $TOKEN" -H "x-deckmate-actor: glm" \
  -d '{"action":"set-card-state","source":"sandbox","manifestHash":"'"$MANIFEST"'",
       "cardId":"card:437a9d85-a359-4eb6-8fa3-7482eb6816c4","sourceHash":"'"$SOURCE"'","state":"started"}'
```

Add a card to a member's hand:

```bash
curl -s -X POST "$BASE/api/catalog" \
  -H "Content-Type: application/json" -H "x-deckmate-token: $TOKEN" \
  -d '{"action":"bulk-edit-cards","source":"sandbox","manifestHash":"'"$MANIFEST"'","optionsHash":"'"$OPTIONS"'",
       "cards":[{"cardId":"card:437a9d85-a359-4eb6-8fa3-7482eb6816c4","sourceHash":"'"$SOURCE"'"}],
       "change":{"kind":"hand","memberId":"glm","mode":"add"}}'
```

Create a card (retry-safe with the same `cardId` and content):

```bash
curl -s -X POST "$BASE/api/catalog" \
  -H "Content-Type: application/json" -H "x-deckmate-token: $TOKEN" -H "x-deckmate-actor: glm" \
  -d '{"action":"create-card","source":"sandbox","manifestHash":"'"$MANIFEST"'",
       "cardId":"card:9f8b0f6e-1111-4c22-8d33-9a0b2c4d5e6f","kind":"task",
       "title":"Check journey steps","markdown":"Steps to verify.","deckId":"audio",
       "trackIds":[],"parentId":null,"owner":null,"effort":null,"priority":null}'
```

The response is the updated `CatalogView`: its `manifestHash` is the base for the next write. A `409` means files changed underneath — re-read and rebuild the request with fresh hashes.
