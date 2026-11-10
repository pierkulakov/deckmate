# HTTP actions used by this skill

Use the UI if HTTP access is unavailable. These are API actions, not `deckmate project` commands. A running local Deckmate server must have the intended project open; do not write to an unrelated server.

## Read and authorize

1. Use the running server's loopback URL (default `http://127.0.0.1:4317`; its port may differ). `GET /api/snapshot?source=sandbox` returns `token`, `editMode`, and write availability. A read-only restriction is not permission to restart in writable mode.
2. `GET /api/catalog?source=sandbox` returns canonical card/Journey IDs, members, and hashes. Resolve c-refs/p-refs against these objects using CLI `show`/`pipeline` if necessary; writes use canonical IDs. Catalog reads in writable mode may perform housekeeping. For read-only research, prefer CLI commands with `--read-only` or an already read-only server.
3. Send `POST /api/catalog` with JSON, `Content-Type: application/json`, `x-deckmate-token: <token>`, and `x-deckmate-actor: <registered member ID>`. Every action below sends `source: "sandbox"` and the fresh `manifestHash` from the catalog, plus the listed fields. Card updates also need that card's current `sourceHash`.
4. On 409, reread and reconcile before retrying. On `saved: true`, a write or stage landed: inspect the persisted result before retrying. On success inspect `warnings` and use the returned fresh hashes. Keep the same creation UUID when retrying the same card; never overwrite a different card.

## Create cards and decks after approval

- `create-card`: `cardId: "card:<new UUIDv4>"`, `kind: "task" | "hero" | "doc"`, `title`, `markdown`, `deckId`, `trackIds`, `parentId`, `owner`, `effort`, `priority`. Use explicit null for unset `deckId`, `parentId`, `owner`, `effort`, and `priority`, and `[]` for no tracks. A null deck selects a compatible Inbox or leaves the card unassigned. Explicit decks must accept the kind: Asset → Hero, Task → Task, Knowledge → Doc, Mixed → any.
- Tasks start `not-started`; Hero/Doc start with null state. A Task/Doc can have an active top-level Hero/Doc parent; children cannot themselves have children. Heroes have no parent. Owner is a label/name, not Hand membership. Effort is a nonnegative number or null; priority is `high`, `medium`, `low`, or null.
- `create-deck`: `title`, existing `spaceId`, `kind: "asset" | "task" | "knowledge" | "mixed"`, `icon`, `color`, `description`. Use the UI for choosing supported icons and appearance.
- `delete-space` (after approval): existing `spaceId`, fresh `manifestHash`; optional `optionsHash` guards CardOptions freshness. Every Deck referencing the Space, including inactive/legacy piled Decks, must first be moved or deleted (otherwise 422). Unknown Space → 422; stale hashes → 409. The last Space may be deleted. Only its manifest entry is removed; its title is kept in the Properties activity journal. Reread the catalog instead of reusing removed Space IDs.
- After creating an analysis Task, use CLI `state <c-ref> discussing --member <you>` only when writes are authorized; omit research-only `--read-only`. Do not move Hero/Doc to a Task state.

## Questions and answers

- Prefer CLI `ask <c-ref> "<question>" --member <you> --to <human ID>`. It locates the rule Doc, appends the question, and raises a Decision Task. A native Task without a rule Doc keeps the question locally and warns that no Decision Task was created; contact the person directly.
- `raise-decision`: `cardId` of the top-level rule Doc, its `sourceHash`, zero-based `questionIndex`, exact `questionText`, new `taskCardId: "card:<UUIDv4>"`, compatible Task/Mixed `deckId`, and human `memberId`. It creates a child Decision Task, adds it to that human's Hand, and links it from the question. Keep the same `taskCardId` on retry.
- `record-decision`: rule Doc's `cardId`, `sourceHash`, `questionIndex`, exact `questionText`, `answer`, human `memberId`. With that human's approval, it moves the answer to `## Decided` (legacy `## Решено`), removes the open item, and accepts its Decision Task. If only acceptance failed, inspect the saved answer and use normal acceptance for the existing Task; do not duplicate it.
- Read the saved rule Doc to verify the answer. `brief` may omit context; absence of an answer there does not prove that the human has not answered.

## Audit reads

- `GET /api/activity?source=sandbox&deckId=<deck ID>&limit=10` → `{ events, nextCursor, warnings }`. Follow `cursor=<URL-encoded nextCursor>` even after an empty page until `nextCursor` is null. Limit is 1–50.
- `GET /api/card-activity?source=sandbox&cardId=<canonical card ID>` reads that card's history, including state transitions without a deck (`deckIds: []`); pages contain up to 20 events. `actorMemberId` is the author, not Owner; absent/null means unknown. `changes <c-ref> --since <ISO-with-timezone|sourceHash>` returns card events with structured reasons and details. A hash has no date, so it returns all card events with a warning. Activity is secondary: a failed journal write warns after the card saves; it is not crash-safe feedback storage.
- `GET /api/journey-metrics?source=sandbox&journeyId=<canonical UUID>` → `{ journeyId, steps, warnings }`; obtain the UUID with `pipeline <p-ref>`. Includes all Journey versions and Archive, excludes Trash; returns use structured review transitions only. Old or missing events do not prove there were no returns.

## Brief and Hand

- `brief <c-ref> --budget 1500` (or `GET /api/brief?source=sandbox&cardId=<c-ref>&budget=1500`) includes the verbatim Task, bounded rules, latest report, agent questions, current Journey step and recent event summaries. It also selects the latest recorded structured review return with a nonblank reason for this card, even outside the three-event summary: reason, acting member (or explicitly unknown), UTC time and `from → to`. This is historical feedback, not a claim that it is still unresolved. Legacy exits without reasons do not produce a feedback block; do not invent their reason.
- The budget can omit feedback text: an explicit feedback-truncation marker and `readNext` range point to the full journal file. Increase `--budget` or read the range before rework. `--json` exposes `markdown`, `tokens`, `truncated`, `readNext`; required card text is never silently cut. A minimum-budget error needs a larger budget or source ranges, not skipped criteria.
- CLI `hand <member> --limit 20` returns bounded card metadata, not bodies, reports or return reasons; inspect each hand's `total`/`truncated` (maximum limit 100), then run `brief`. The Hand UI shows seven open slots and a queue; its Done pile is accepted active cards selected by Owner, not a drop-target for acceptance. Dragging/Space on a drag handle reorders Hand only. Open a card to change its state; Hand tiles do not wire a start shortcut.

## State and review

- CLI `state <c-ref> <state> --member <ID> [--reason "<text>"]` uses `set-card-state` with `cardId`, `sourceHash`, `state`, and optional `returnReason`. Both CLI and server require a nonblank reason for an actual departure from `review` to neither `review` nor `done`, including bulk state changes. A supplied reason must be one line, at most 500 characters, and only for that departure. Repeating the same state needs no reason and creates no state transition.
- Recommend `state <c-ref> not-started --member <reviewer-ID> --reason "<criterion: required, actual; minimum fix; verification>"`: the reviewer's return decision does not start the owner's work. `started` remains accepted for compatibility, but has start effects (including placing the card first in the acting member's Hand). Acceptance means `done`: use `state <c-ref> done --member <ID>`, never `state <c-ref> accepted` (invalid).
- Task states: `not-started`, `discussing`, `in-iteration`, `started`, `review`, `done`, `wont-do`. Repeating the current state is a no-op. Docs have no state. A native Hero accepts only `done` or `not-started` (clear manual mark), with completion derived from eligible child Tasks when present.
- Submit with `report <c-ref> --file <UTF-8-report.md> --member <you> --state review`. `report` has no `--reason` flag and cannot bypass the server's review-return rule through `--state`; use `state … --reason …` for a return. CLI `state --reason` does not add a Journey lesson.
- A deck's guardians restrict acceptance to those members. Without guardians, the CLI does not enforce a human-only actor or prevent self-acceptance: this skill still requires independent review and the human owner's decision. Never accept your own submitted work.
