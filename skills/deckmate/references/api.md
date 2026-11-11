# HTTP actions used by this skill

Every endpoint here needs a running local Deckmate server with the intended project open. For offline card content use [native files](cards.md#card-file-format); CLI writes probe the [configured port](cli.md#common-options). Do not write to an unrelated server or use these action names as `deckmate project` commands.

## Authorize and protect writes

1. Use the server's loopback URL (default `http://127.0.0.1:4317`, but its port may differ). `GET /api/snapshot?source=sandbox` returns `token`, `editMode`, effective source and write availability. A read-only restriction is not permission to restart in writable mode.
2. `GET /api/catalog?source=sandbox` returns canonical IDs, members, current objects and hashes. Resolve c-refs/p-refs with CLI `show`/`pipeline` when needed. Catalog reads in writable mode may perform housekeeping; for read-only research prefer CLI `--read-only` or an already read-only server.
3. Send writes as JSON to `POST /api/catalog` with `Content-Type: application/json`, `x-deckmate-token: <token>`, and `x-deckmate-actor: <registered-member-id>`. The actor is recorded in activity; without the header it is unknown.
4. Every action sends `action`, `source: "sandbox"`, and fresh `manifestHash`, plus its listed fields. Card updates also need the card's current whole-file `sourceHash`; CardOptions, Run, Milestone, Journey and attachment operations use their respective current hashes.
5. On HTTP 409, reread and reconcile before retrying. On `saved: true` or a nonempty `savedWarning`, a write or stage landed: inspect the persisted result before retrying, even on an error response. On HTTP 200 inspect both `warnings` and `savedWarning`, then use returned fresh hashes. Keep the same creation UUID when retrying the same entity; never overwrite different content.

`optionsHash: ""` is valid when `tasks/deckmate-card-options.md` does not exist yet; send the catalog value unchanged.

## Card content

Use `POST /api/catalog` with the shared fields above; success returns the updated catalog.
- `create-card`: `cardId: "card:<uuid>"`, `kind: "task" | "hero" | "doc"`, `title`, `markdown`, `deckId`, `trackIds`, `parentId`, `owner`, `effort`, `priority`. Send unset parent/owner/effort/priority as `null`, Tracks as `[]`; `deckId: null` uses a compatible Inbox or leaves the card Unassigned. Task starts `not-started`; Hero/Doc state is null.
- `update-card-content`: `cardId`, `sourceHash`, `title`, `markdown`. Read the full editable text first with `GET /api/card-content?source=sandbox&cardId=<URL-encoded canonical ID>` → `{ cardId, title, markdown, sourceHash }`; catalog previews are not complete bodies. Only title/body change, not properties.
- Title: nonempty single line, ≤1000 characters; Markdown: ≤200000 characters, may be empty. Explicit Deck/Track IDs must exist; the Deck must accept the card kind. Hero has no parent; Task/Doc may have one active top-level Hero/Doc parent.

## Change an existing card

Keep the canonical `cardId`; use `POST /api/catalog` with the shared fields and the card's fresh `sourceHash`. Preserve unchanged values in actions that replace a complete property/link list.
- `set-card-properties`: `cardId`, `sourceHash`, `owner`, `effort`, `priority` (all required). Owner is a nonblank single line ≤120 characters or null; effort is finite ≥0 or null; priority is `high | medium | low` or null. Member IDs/aliases resolve to labels on this write, unlike the CLI Owner search filter. Owner does not assign a Hand.
- `set-card-links`: `cardId`, `sourceHash`, `deckId`, `trackIds` (all required). Deck is a compatible existing ID or null; Tracks are the full unique list of existing IDs (≤100), or `[]` to clear. Take IDs from `map`; moving the card preserves its identity.
- `set-card-dependencies`: `cardId`, `sourceHash`, `dependsOn` (all required). Send the full unique list of canonical prerequisite IDs (≤200), or `[]` to clear. Only active native non-Journey cards support this action; prerequisites must exist and be active, with no self-link or cycle. Legacy dependencies stay source-managed; Journey dependencies stay Journey-managed.
- `set-card-parent`: `cardId`, `sourceHash`, `expectedParentId` (current canonical parent ID or null), `parentId` (new canonical parent ID or null), `parentSourceHash` (new parent's fresh `sourceHash`, or null when detaching), all required. The current parent must match; the target must be an active top-level Hero/Doc and the child an eligible Task/Doc without children. A Journey child cannot change parent.
- Planning/options: `bulk-edit-cards` with `cards: [{ cardId, sourceHash }]` (1–1000 unique cards), fresh `optionsHash`, and `change: { kind: "options", patch: { run: "<run-id>", milestone: "<milestone-id>", dueDate: "2026-11-20" } }`. The patch must be nonempty; permitted keys are `bookmarked`, `run`, `milestone`, `dueDate`, `archived`, `deleted`. Flags are booleans; Run/Milestone values are IDs (bounded strings ≤200), and `dueDate` is a real YYYY-MM-DD date; null clears a value. Omitted keys stay unchanged. Tags and Hand membership use their separate change kinds, not this patch. Inspect `bulkOutcome.applied/unchanged/pending/warnings` before retrying.

`find` hides Archive/Trash. Restore an archived/deleted card in the UI's Archive/Trash first, then reread its ID and hashes; never recreate it as a replacement.

## Hand membership and order

These `POST /api/catalog` actions change CardOptions, not Owner, and never launch an agent.
- `bulk-edit-cards`: `cards: [{ cardId, sourceHash }]` (1–1000 unique cards), `optionsHash`, and `change: { kind: "hand", memberId, mode: "add" | "remove" }`. Inspect `bulkOutcome.applied/unchanged/pending/warnings` as well as the catalog warnings.
- `reorder-hand`: `memberId` and `cards: [{ cardId, sourceHash }]` as the complete unique permutation of that member's open Hand cards. Membership changes or stale hashes conflict; the UI exposes seven open slots plus a queue.

## Runs and milestones

Use `POST /api/planning` with `source: "sandbox"`, the token/actor headers, and the listed hashes; success returns an updated catalog.
- Runs: `update-run` (`run`, `runsHash`), `save-run-configuration` (`configuration`, `runsHash`), `finish-run` (`runId`, `carryOver`, `runsHash`, `optionsHash`), `delete-run` (`runId`, `runsHash`, `optionsHash`), and `resume-runs` (`configurationId`, `runsHash`).
- Milestones: `create-milestone` and `update-milestone` (`milestone`, `milestonesHash`), `delete-milestone` (`milestoneId`, `milestonesHash`, `optionsHash`, `manifestHash`), and `pin-milestone` (`milestoneId`, `milestonesHash`, `manifestHash`).
- Preserve the nested object shapes read from the current catalog. Finishing or deleting planning entities can also update CardOptions or the manifest, which is why their extra hashes are required.

For a first schedule, this Node.js example reads a fresh `runsHash` and sends every required configuration field. Set `base` and `actor` for the approved local project/member; confirm the snapshot's project and write availability before running the POST. Choose an unused configuration ID and the approved start date; do not reuse this example to overwrite an existing schedule.

```js
const base = 'http://127.0.0.1:4317';
const actor = 'maya';
const snapshot = await (await fetch(`${base}/api/snapshot?source=sandbox`)).json();
const catalog = await (await fetch(`${base}/api/catalog?source=sandbox`)).json();
const response = await fetch(`${base}/api/planning`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-deckmate-token': snapshot.token, 'x-deckmate-actor': actor },
  body: JSON.stringify({
    source: 'sandbox', action: 'save-run-configuration', runsHash: catalog.runsHash,
    configuration: {
      id: 'production', shortName: 'PROD', color: '#7C5CFF', labelTemplate: 'Run %RUN_NR%',
      startDate: '2026-11-16', durationWeeks: 1, upcomingCount: 2,
      finishTime: '18:00', timeZone: 'UTC',
      carryOver: { review: true, blocked: false, other: false },
    },
  }),
});
const result = await response.json();
console.log(response.status, result);
```

Success returns `runConfigurations` and generated `runs`; inspect warnings as above. Duration and upcoming count are integers 1–52; `shortName` is 1–5 characters, `finishTime` is HH:mm (also accepts `24:00`), and `timeZone` must be a valid time zone. `projectSpecific` is optional; preserve lifecycle-managed `stopDate` unchanged when editing, and omit it for a first schedule. An absent Runs file has `runsHash: ""`.

## Members, Spaces and decks

Use `POST /api/catalog` after approval.
- `configure-members` replaces the full `members` registry in `tasks/deckmate.md`, not `membership`; preserve existing entries. Exact body: `{ "action": "configure-members", "source": "sandbox", "manifestHash": "<current hash>", "members": [{ "id": "builder", "label": "Builder Agent", "kind": "agent", "aliases": [] }] }`. All four member fields are required, even empty `aliases`; `kind` is `human` or `agent`. See [team setup](../workflows/team.md).
- `create-space`: `title`. `create-deck`: `title`, existing `spaceId`, `kind: asset | task | knowledge | mixed`, `icon`, `color`, `description`; optional caller-generated `deckId` makes a create retry safe.
- `create-track`: `title`, `description` (may be empty). Read the generated Track ID from the returned `tracks`; creation is not UI-only.
- `set-inbox-deck`: `deckId` or null; only a Task/Mixed deck can receive new Tasks. `set-deck-guardians`: `deckId`, full `guardianIds`; configured guardians restrict acceptance.
- `set-deck-automation`: `deckId`, `autoTag`, `autoTagKeep`, `templateMarkdown`, `templateOwner`, `templateEffort`, `templatePriority`; template defaults do not overwrite explicit card properties.
- `delete-space`: existing `spaceId`, fresh `manifestHash`, optional `optionsHash`. Move or delete every referring Deck first, including inactive/legacy piled Decks, otherwise 422. Unknown Space → 422; stale hashes → 409. The last Space may be deleted; only its manifest entry is removed, while its title remains in activity. Reread instead of reusing removed IDs.

## Journeys

Use `POST /api/catalog`; obtain canonical IDs and hashes from the catalog or CLI `pipeline`.
- Every `journeyHash` below is the Journey's `fileHash` from `GET /api/catalog` (`journeys[]`); demo boards already contain earlier instances, so compare metrics as a delta.
- `import-journey-template`: required fields are `deckId`, `templateId`, `templateSource`, `templateHash`, `mode`, `journeyId`, `journeyHash`, `roleMapping`, plus shared `action/source/manifestHash`. Choose a template from catalog `journeyTemplates[]`: copy its `id`, `source` (`bundled | project`) and `fileHash` into `templateId`, `templateSource`, `templateHash`. For a new Journey, use an Asset/Mixed `deckId`, `mode: "add"`, `journeyId: null`, `journeyHash: null`, and `roleMapping: { "<role-id>": { "deckId": "<task-deck-id>" } }` for every used role. A role can instead map to `{ "createDeck": { "title": "QA", "spaceId": "<existing-space-id>" } }`; use exactly one target per role. Existing targets must be Task/Mixed decks; unknown roles or missing used roles fail. Imported owners are null: assign them before applying. To append or replace an existing Journey, send its canonical `journeyId`, fresh `journeyHash` and matching `deckId`, with `mode: "add" | "replace"`; this increments its version without rewriting existing Tasks.
- `create-journey`: `deckId`, `title`, `steps`. `apply-journey`: `cardId`, `journeyId`, `journeyHash`, selected `stepIds`, `deckAssignments`, and the Hero's `sourceHash`. Apply to an existing compatible top-level Hero; each selected step creates a Task but does not start an agent.
- Each `steps` element requires `id`, `title`, `markdown`, `deckId`, `owner`, `dependsOn`. Minimal example: `{ "id": "verify", "title": "Verify scene", "markdown": "## Done\nThe scene passes the approved playtest.", "deckId": "production", "owner": null, "dependsOn": [] }`; replace `production` with an existing Task/Mixed deck ID. Step IDs use lowercase letters, digits and hyphens (1–80 characters), title is 1–200 characters, Markdown ≤50000 characters, Owner ≤200 characters or null. Optional `effort` is ≥0 or null, `priority` is `high | medium | low | null`, and `zoneId` identifies a declared zone. There are 1–30 steps; `dependsOn` contains unique step IDs, not card IDs, with no missing reference or cycle.
- `deckAssignments` is a step-ID → Task/Mixed deck-ID object, for example `{ "build": "production" }`; `{}` keeps all step defaults. Entries override step decks; include each selected step's prerequisites unless already created for this Hero/Journey/version.
- `update-journey`: `journeyId`, `journeyHash`, `title`, `description`, `zones`, `steps`. Revising a template does not rewrite cards already created from it.
- `add-journey-step-lesson`: `journeyId`, `journeyHash`, `stepId`, `cardId`, `text` (≤500 characters), with a known actor header. It appends to `## Lessons` (legacy `## Грабли`) without increasing Journey version.
- An unfinished update exposes `pendingOperation` and journal hashes. `abandon-journey-operation` (`journeyId`, `journalHash`) deletes only the saved intent, never rolls back working files; reread after conflicts and inspect `savedWarning` for partial publication.

## Questions and answers

Prefer CLI `ask` when a rule Doc already exists. These actions remain HTTP-only and require a running server.
- `raise-decision`: top-level rule Doc `cardId` and `sourceHash`, zero-based `questionIndex`, exact `questionText`, new `taskCardId: "card:<UUIDv4>"`, compatible Task/Mixed `deckId`, and human `memberId`. It creates a child Decision Task, adds it to that human's Hand, and links it from the question; keep the same task ID on retry.
- `record-decision`: rule Doc `cardId`, `sourceHash`, `questionIndex`, exact `questionText`, `answer`, and human `memberId`. With that human's approval it moves the answer to `## Decided` (legacy `## Решено`), removes the open item, and accepts its Decision Task.
- If only acceptance failed, inspect the saved answer and accept the existing Task normally; do not duplicate it. Read the saved rule Doc to verify the answer because a bounded brief may omit it.

## Vision boards

Vision boards are saved through their own endpoint, not a catalog action: read `GET /api/boards/<id>?source=sandbox`, then `POST /api/boards` with token/actor headers and `{ source: "sandbox", id, title, hash, scene }`, using the returned full scene and current board hash (no `manifestHash`).
For a new board, retain a generated UUID `id`, use `hash: ""` and `scene: { type: "excalidraw", version: 2, elements: [], appState: {}, files: {} }`. Success returns the saved board and fresh hash; never save the CLI's image-stripped scene over a board containing images.

## Audit reads without CLI equivalents

- `GET /api/activity?source=sandbox&deckId=<deck-id>&limit=10` → `{ events, nextCursor, warnings }`. Follow `cursor=<URL-encoded nextCursor>` even after an empty page until it is null; limit is 1–50. Activity is secondary: a journal failure can warn after the card saves.
- `GET /api/card-activity?source=sandbox&cardId=<canonical-card-id>` pages up to 20 events, including transitions without a deck (`deckIds: []`). `actorMemberId` is the acting member, not Owner; absent/null means unknown. Prefer CLI `changes` for a checkpoint-aware read.
- `GET /api/journey-metrics?source=sandbox&journeyId=<canonical-uuid>` → `{ journeyId, steps, warnings }`. It includes all Journey versions and Archive, excludes Trash, and counts structured review transitions only; old or missing events do not prove there were no returns.
