# Project CLI

`deckmate project` reads project Markdown directly; reading, `next`, `brief`, `report`, `state` and `ask` work without a server. Guarded CLI writes first probe the configured port (see [Common options](#common-options)). For card creation and content/property changes use only the running server, following the [HTTP startup rule](api.md); do not write card files by hand. Use an explicit `--data <project>` and references printed by prior commands. JSON is pretty-printed except compact `--fields brief` responses.

## summary

Read project or Track counts and bounded work queues.
`deckmate project summary [track] [--track <id|title>] [--limit <0-100>] [--stale-hours <hours>] [--fields brief] --data <project>`
- `counts` gives active totals by kind, Task state and owner; `track` records the selected filter.
- `groups.doing/review/blocked/ready/planned/stale` and `dependencies` each contain `total`, `truncated` and at most `limit` `cards`; `--stale-hours` defaults to 24.
- `ready` holds only `in-iteration` Tasks with an iteration number and no blocking prerequisite; a `not-started` Task that is free to start appears under `planned`.
- `--fields brief` adds the compact JSON estimate `tokens`. An invalid limit or stale-hours value is rejected.

## map

Locate the manifest and enumerate structural IDs.
`deckmate project map --data <project>`
- `manifest`, `spaces`, `decks`, `tracks` and `rootIdentity` identify the project; each deck includes its `kind`, `spaceId` and card count.
- `documents`, `tasks`, `pipelines` and `boards` summarize available content; inspect `warnings` for malformed cards and links.
- Take deck/Track IDs and labels from this map rather than inventing them; filters use IDs, not titles. For Owner labels, read the cards' `owner` or the manifest's member roster; `map` does not print members.

## find

Search active cards by text and metadata.
`deckmate project find [text] [--deck <id>] [--track <id>] [--kind <task|hero|doc>] [--state <state>] [--owner <stored-label>] [--limit <1-1000>] [--fields brief] --data <project>`
- The default JSON is an array of cards with `id`, `ref`, `path`, `title`, `kind`, `state`, `sourceHash`, links and properties.
- `range: { start, end }` uses zero-based byte offsets in the UTF-8 source file, end exclusive, not line numbers; Hero/Doc ranges are null. `show --lines` instead takes inclusive 1-based source-file lines.
- `--fields brief` returns `{ cards, tokens }`, omits bodies and adds up to three `hits` per card with absolute 1-based source `line` and `text`.
- `--owner` matches the entire stored Owner label, case-insensitively; it does not resolve member IDs or aliases. Use `map` for deck/Track IDs and its `manifest` path or card reads for the stored Owner label.
- Invalid kind/state and limits outside 1–1000 fail. Unknown `--deck`, `--track` or `--owner` return `[]` with exit 0 (`cards: []` with `--fields brief`); an empty result is not proof that omitted archived or deleted cards do not exist.

## track

Run the same bounded search within one Track.
`deckmate project track <track-id> [--text <text>] [--deck <id>] [--kind <task|hero|doc>] [--state <state>] [--owner <stored-label>] [--limit <1-1000>] [--fields brief] --data <project>`
- Output and `hits` have the same shapes as `find`; the positional ID must come from `map`.
- Use this to inventory a theme across decks; Track membership does not include a Hero's children automatically.
- An unknown positional Track ID, invalid kind/state or invalid limit fails. As with `find`, unknown `--deck`/`--owner` return `[]` with exit 0; Owner matches the stored label, not a registry ID/alias. Take deck/Track IDs from `map` before filtering.

## show

Resolve one card and its context, or read exact source lines.
`deckmate project show <c-ref> [--lines <a-b>] [--fields brief] --data <project>`
- Without `--lines`, JSON contains the card's full `markdown`, canonical `id`, `ref`, `sourceHash`, properties and `context` for deck, Space, Tracks, parent and children.
- `--lines` is inclusive and 1-based in the source file; it returns `path`, `from`, `to`, `totalLines`, exact `markdown`, `sourceHash` and `tokens`.
- `--fields brief` adds `tokens` to the normal object. Unknown references and malformed ranges fail; a Hero/Doc has `range: null`, so use its actual file lines.

## brief

Build a bounded execution package for one card.
`deckmate project brief <c-ref> [--budget <tokens>] [--json] --data <project>`
- Default output is Markdown with the verbatim card, dependencies, bounded context, latest reports/questions, Journey state, events and any latest recorded review return.
- `--json` returns `markdown`, `tokens`, `truncated` and `readNext`; each continuation has `path`, inclusive `from`/`to`, `title` and estimated `tokens`.
- The default budget is 1500. `truncated: true` requires following relevant `readNext` ranges; a minimum-budget error requires a larger budget or direct source reads, never skipped criteria.

## changes

Reread a card and its history since a checkpoint.
`deckmate project changes <c-ref> --since <ISO-with-timezone|sourceHash> --data <project>`
- `sourceHash`, `previousSourceHash` and `changed` describe the file comparison; `eventScope`, `events`, `git` and `warnings` describe evidence and its limits.
- An ISO checkpoint returns later events and `changed: null`; a full 64-digit hash compares bytes but returns all card events with `eventScope: all-card-events` and a warning because a hash has no date.
- `--since` is required. Activity can miss external edits or a failed secondary journal write; reread source ranges when evidence is incomplete.

## hand

Inspect one registered member's explicit queue, or every Hand.
`deckmate project hand [member] [--limit <0-100>] --data <project>`
- Each entry in `hands` contains `member`, exact `total`, `truncated`, and bounded `cards`; the default limit is 5 and zero returns metadata with no cards.
- Cards contain `id`, `ref`, `title`, `kind`, `state`, `owner`, deck/parent and planning metadata, not bodies, reports or return reasons; run `brief` next.
- Member selection accepts an exact registry ID, label or alias. Owner does not add Hand membership; change membership through the UI or [HTTP](api.md).

## next

Pick the first eligible Task in a member's Hand without starting it.
`deckmate project next <member> [--stale-hours <hours>] [--brief] --data <project>`
- JSON contains `source`, `member` and `card`; `card: null` means no ready card. A selected card has `ref`, `title`, `state`, `path`, `sourceHash` and `link`.
- Only Tasks are selected: Heroes, Docs, `review`, `done`, `wont-do`, Tasks with an unfinished active prerequisite and stale started Tasks are excluded; stale defaults to 24 hours. `--brief` returns the selected card's brief Markdown instead of JSON.
- An unknown member fails with the available registry IDs.

## step

Read one Journey step's complete assignment template.
`deckmate project step <p-ref> <step-id> --data <project>`
- JSON includes `pipeline`, template `version`, step `path`, `id`, `title`, full `markdown`, `deckId`, `owner`, `dependsOn`, `effort` and `priority`.
- Get the p-ref and exact step ID from `pipelines`; an unknown step fails and lists valid IDs.
- `pendingOperation` and `warnings`, when present, describe an unfinished Journey update; reading does not recover it.

## pipelines

List Journey references and step IDs.
`deckmate project pipelines --data <project>`
- Each item contains `ref`, `title`, `version`, index `path`, and `steps` with `id`, `title`, `dependsOn` and step `path`; there is no `fileHash`.
- Use the printed p-ref with `pipeline` for canonical `id` and fresh `fileHash` before HTTP writes, and `step` for instructions; inspect `pendingOperation` and `warnings` before writing.
- An empty array means no Journeys are published in the project.

## pipeline

Read a Journey overview without step bodies.
`deckmate project pipeline <p-ref> --data <project>`
- JSON includes canonical `id`, `title`, `version`, `deckId`, `description`, `zones`, `path`, `fileHash` and step metadata without `markdown`.
- Use `step` for full instructions; the current template version can differ from the version copied into an assigned Task.
- An unknown p-ref fails with a request for an ID or reference from `pipelines`.

## boards

List Vision boards and their v-refs.
`deckmate project boards --data <project>`
- The array includes `id`, `ref`, `title`, `hash`, `path`, `linkedCardIds`, `updatedAt` and `access`.
- Use the printed v-ref with `board`; scene image binaries are not included in these summaries.
- An empty array means the project has no Vision boards.

## board

Read one Vision board's scene and linked cards.
`deckmate project board <v-ref> --data <project>`
- JSON includes board metadata plus `scene` with `elements`, `appState` and `files`; CLI `files` is emptied so image binaries stay in their local assets.
- Use `linkedCardIds` to resolve associated cards with `show` or `brief`.
- An unknown v-ref fails; no scene write is performed by this command.

## rebuild

Rebuild the disposable search projection in memory.
`deckmate project rebuild --data <project>`
- JSON returns `rebuilt: true`, `storage: memory`, indexed `cards` and `indexedAt`.
- This does not make SQLite authoritative or replace malformed Markdown; fix `map` warnings in the source files.
- Read errors still require correcting the named project file.

## init

List or add starter decks and Journeys to an existing project.
`deckmate project init [template-id] [--dry] [--samples] [--member <id>] --data <project>`
- Without a template, JSON lists available `id`, `title`, `description`, `decks` and `journeys`; this differs from top-level `deckmate init <folder>`.
- `--dry` returns `templateHash`, `manifestHash`, `items` with creation status, and `samples`; include `--samples` in preview if sample Heroes are intended.
- Applying returns `warnings`, `via` and `remaining`; apply only after approval, and inspect `remaining` before retrying because application is additive, not a reset.

## ask

Append a blocking question and, when a rule Doc exists, raise its Decision Task.
`deckmate project ask <c-ref> "<question>" --member <id> [--to <human-id>] --data <project>`
- JSON contains `question`, `link`, `existing` and `warnings`; an identical linked open question is a no-op, while an incomplete linked question can be resumed.
- Text must be 1–900 characters. Without `--to`, the first registered human is selected; asking does not change the original Task's state or dependencies.
- A native Task without a rule Doc keeps a local question and warns that no Decision Task was created; a legacy card without one is rejected. Contact the person directly in either case.

## inbox

Read a bounded Markdown notification summary.
`deckmate project inbox <member> [--since <ISO-with-timezone>] [--limit <0-100>] --data <project>`
- Output groups `owned`, `watching` and `due` stacks with totals, hidden counts, card refs and recent changes; it is not a complete message log.
- `--since` filters events strictly after the timestamp; the notification window is 30 days and at most 1000 events.
- Unknown members, invalid timestamps and limits outside 0–100 fail. Read the linked card or rule Doc before acting.

## report

Append a UTF-8 result report and optionally change a Task's state.
`deckmate project report <c-ref> --file <report.md> --member <id> [--state review] --data <project>`
- JSON includes `id`, `ref`, optional `requestedState`, `warnings` and `via: files | server`; inspect warnings and reread after a conflict or possibly saved failure.
- The report file may live anywhere (an OS temp folder is fine); its text is copied into the card, so links in it must be relative to the card file. It must be nonempty UTF-8. It is appended under `#### Report`; headings inside the supplied file must be `#####` or deeper.
- `--state` works only for Tasks. There is no `--reason` option and `--state` cannot bypass the review-return reason rule; see [card reports](cards.md#report-block).

## state

Move a Task or set/clear a native Hero's manual done mark.
`deckmate project state <c-ref> <state> --member <id> [--reason "<one-line reason>"] --data <project>`
- JSON includes `id`, `ref`, previous `from`, requested `state`, `warnings` and `via`; repeating a state is a no-op without a new transition.
- Leaving `review` for anything other than `review` or `done` requires a nonblank, one-line reason of at most 500 characters, including bulk HTTP changes. Prefer `not-started` for a return; `started` also puts the card first in the acting member's Hand.
- A supplied reason is valid only for that departure; on any other transition `--reason` is rejected ("A reason can only be recorded when returning a card from review"). Docs have no state; Heroes accept only `done` or `not-started`; `accepted` and `blocked` are not state IDs. Deck guardians restrict who may accept; an agent that owns the card or wrote its report cannot set `done` (422, [acceptance policy](../workflows/review.md#acceptance-policy)).

## Common options

- `--data <project>` selects the project; otherwise `DECKMATE_DATA` is used, then the current folder. The CLI does not search ancestors for a manifest.
- `state`, `report`, `ask`, and `init` apply probe `http://127.0.0.1:<port>` using `DECKMATE_PORT` (default 4317; project commands have no `--port`). The same open project writes via `server`; a different one fails with 409, “The server on this port has a different project open.” Stop that server or run with `DECKMATE_PORT=<free port>`; a refused connection writes via `files`. Other probe errors do not bypass the server.
- `--source sandbox|live` defaults to `sandbox`: the project itself in direct mode, or the separate writable copy selected by `DECKMATE_WRITE`. That copy must be a worktree on `deckmate/sandbox` (legacy `freetion/sandbox`); `--data` does not disable it. Read `live` only when authorized; live writes fail.
- `--read-only` (or `DECKMATE_READ_ONLY=1`) overrides `DECKMATE_WRITE` and rejects writes. Do not lift a person's read-only restriction to create cards.
- `--json` exists only for `brief`; most other read commands already emit JSON, while `inbox`, default `brief`, and `next --brief` emit Markdown.

## Task states

`state <c-ref> <state> --member <id>` moves a Task to any ID below; `report --state review` is the usual submission path. Russian file words are accepted as input, but JSON uses these IDs.

| ID | Meaning | Usual way there |
|---|---|---|
| `not-started` | Not active; also the recommended review-return destination | New Task, or `state … not-started` with a reason when returning from review |
| `discussing` | Design or requirements are being discussed | `state … discussing` |
| `in-iteration` | Planned for a positive iteration; ready when unblocked | `state … in-iteration` |
| `started` | Someone is actively working | `state … started` |
| `review` | Result and evidence await independent review | `report … --state review`, or `state … review` |
| `done` | Accepted after independent review and the human owner's decision | `state … done` by an authorized reviewer |
| `wont-do` | Deliberately not doing the Task; never carried into the next Run | `state … wont-do`; returning from review still needs a reason |

Blocked is calculated from existing active unfinished dependencies, not stored as a state; missing, archived and deleted prerequisites do not block. Docs have no state. A native Hero accepts only `done` (manual mark) and `not-started` (clear it); eligible child Tasks determine completion when present.

## Other entry points

- `deckmate init <folder>` creates a demo in a new or empty folder and never replaces existing files; it is not `deckmate project init`.
- `deckmate skills install|status --project <project> [--from <Deckmate-folder>] [--force]` installs into both `.claude/skills/deckmate` and `.agents/skills/deckmate`, or compares them without writing. Install records `deckmateHome` and updates the marked Deckmate rules block in the project's `AGENTS.md`, preserving all text outside it; status also checks that block. Replacing local changes in skill copies needs `--force`, but the rules block is always managed by Deckmate.
- Install needs `tasks/deckmate.md` (or its legacy manifest); otherwise it fails with “cannot read the project manifest”. Create the board first with `deckmate project init <template> --data <project>` or `deckmate init <folder>`, then install.
- `deckmate agents run <workflow> <area> --project <project> [--dry] [--roles research,code] [--lens <file>] [--out <folder>]` writes assignments and optionally launches configured roles. `--dry` never launches but still writes `tz-*.md`.
