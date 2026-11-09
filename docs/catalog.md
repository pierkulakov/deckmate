# File catalog, pipelines, and agents — 2026-11-04

Rename compatibility — 2026-11-05: legacy `FREETION_*` variables are still read, but only while no `DECKMATE_*` variable is set (the two sets never mix), and legacy variables produce one warning per process. Registries use the new `tasks/deckmate*` names, falling back to `tasks/freetion*` when absent; writes preserve existing paths, and new projects use the new names. Existing `freetion/sandbox` branches remain valid; new sandboxes use `deckmate/sandbox`. Legacy YAML markers for cards/Journeys/templates, Vision fields, and attachment links work without data migration; the old activity author appears as Deckmate. On first read, the browser migrates old localStorage/sessionStorage values while preserving the new key's precedence.

Edit modes — 2026-11-05: without `DECKMATE_WRITE`, `direct` mode writes to `DECKMATE_DATA`; Git is optional, and commits provide a recovery point. With `DECKMATE_WRITE`, `sandbox` mode writes only to a separate copy outside the project on `deckmate/sandbox` or `freetion/sandbox`. `--read-only` and `DECKMATE_READ_ONLY=1` override the copy and prohibit writes. In the HTTP API, `source: sandbox` means the writable source in both modes; `source: live` rejects writes. The snapshot returns `editMode: direct | sandbox | read-only`; the source switch appears only in `sandbox` mode.

Markdown and other project files are the primary data; SQLite is a rebuildable index. This document describes the current Deckmate implementation and its limits.

## Model

| Entity | Rule |
|---|---|
| Space | Groups decks by purpose. GDD / Tasks / Knowledge / QA / Custom presets set the initial deck type. |
| Deck | A card has zero or one primary deck. A work area is not a Markdown file. |
| Task | An imported `### X.Y` slice or a separate native card. Has its own state and owner. |
| Hero | A top-level parent of Task/Doc cards; task progress is computed from its children. Has no task workflow; nested Heroes are prohibited. |
| Doc | A document without a task workflow; can be a top-level parent of Task/Doc cards or a subcard without children. |
| Track | A cross-deck topic: a card can belong to several tracks. |
| Tags | Independent string labels on a card; do not replace Track, Run, or Milestone. |
| Hand | Explicit membership in one or more registered participants' hands, separate from Owner. |
| Journey / pipeline | A versioned step template with instructions and dependencies, applied to a specific Hero. |
| Vision | An Excalidraw canvas with diagrams, external images, and card links. |

Asset accepts Hero, Task accepts Task, Knowledge accepts Doc, and Mixed accepts all three kinds. Deckmate does not automatically promote ordinary cards to Hero. Hero/Doc `state` and `range` are null; Owner can be explicitly assigned to any card kind.

An imported Hero comes from a numbered `##` heading; its tasks are the source slices. Without an explicit override, an imported Task's parent follows the file structure. Membership `parentId` can assign another Hero/Doc or explicitly detach the card with null. A native card stores `parentId` in its own file. Deck membership, parenthood, and a participant's hand are separate relationships. Track counts unique directly included tasks: including a Hero does not automatically include all its children.

## Primary files

| Path in the data project | Responsibility |
|---|---|
| `features/**/*.md`, `docs/**/*.md`, top-level `tasks/*.md` | Existing documents; the mechanics adapter also extracts Heroes and slices. |
| `tasks/deckmate.md` | Spaces, Decks, Tracks, project members, deck appearance, imported card membership, and Sub Card order. |
| `tasks/deckmate-card-options.md` | The sole source of new CardOptions for native and legacy cards: Hand, Bookmark, Tags, Run, Milestone, Due Date, Archive/Trash, and legacy kind overrides. |
| `tasks/deckmate-runs.md`, `tasks/deckmate-milestones.md` | Run and Milestone registries with dates; do not replace the iteration log. |
| `tasks/deckmate-planning-history.md` | Append-only daily observations of Runs and Milestones for burndown and velocity. |
| `tasks/deckmate-notifications.md` | Per-member notification seen/dismiss marks and card watch lists. |
| `tasks/deckmate-assets/cards/<key>/attachments.md` and adjacent binary files | One card's attachment registry; key is a native UUID or `legacy-<first 16 characters of the ID's SHA-256>`. Legacy cover entries are preserved but not shown (2026-11-09). |
| `cards/<uuid>.md` | One native card: YAML metadata and a Markdown body. |
| `tasks/journeys/<uuid>/index.md` | Pipeline metadata, version, and ordered step links. |
| `tasks/journeys/<uuid>/steps/<stepId>.md` | Properties and full instructions for one step. |
| `assets/journey-templates/<id>/**` | Bundled Journey templates in the Deckmate repository, not the data project. |
| `tasks/journey-templates/<uuid>/index.md` + `steps/*.md` | A project Journey template created with Save as Template. |
| `assets/project-templates/<id>.md` | Bundled starter templates for **Start from template**, in the Deckmate repository, not the data project. |
| `boards/<uuid>.excalidraw` | A Vision scene and external image references. |
| `tasks/deckmate-assets/covers/<uuid>.<ext>` | Deck cover and Vision images: PNG, JPEG, WebP; unrelated to card attachments. |
| `tasks/deckmate-activity/<UTC timestamp>-<uuid>.md` | One Deckmate activity event; the application does not rewrite existing events. |

Symbolic links are not traversed. Managed writes validate the root, parents, and destination; nested directories are created one at a time. Native files are published without overwriting an existing destination.

### Starter project templates — 2026-11-05

`assets/project-templates/<id>.md` is one bundled starter shown by **Start from template**: YAML frontmatter (`deckmate: project-template`, `schema: 1`, `id`, `title`, `description`, `category`, `genre`, `order`, `spaces`, `decks`, `tags`, `samples`) and a Markdown picker body. `category: games | software` selects the shelf — Games or Software — and defaults to `games` when the field is absent; `order` (1–30) sorts the shelf; `genre` is the project profile genre key or null. The picker opens the project's own shelf: a profile genre means Games, otherwise the remembered tab, otherwise Games. Applying through one `apply-project-template` action is additive: same-named spaces, decks and tags are reused, a Journey is skipped when its deck already has one, and optional example Heroes run the bundled Journeys.

Optional `locales: { ru: { title, description } }` immediately after the English `description` localizes the two picker fields (title up to 200 characters, description up to 2000). Values are trimmed, blank values are omitted, and each missing field falls back to English. Other locale keys are ignored for future compatibility.

### Manifest

`tasks/deckmate.md` contains YAML frontmatter followed by free-form Markdown.

### Two-language file format — 2026-11-05

`formatLanguage: en | ru` selects the words written to project files. The first manifest created in a folder, including the demo and a starter template on an empty folder, records `formatLanguage: en`. An existing manifest without the field is legacy Russian and is not given the field during unrelated edits. A folder without a manifest is a new English project. Activity summaries and details, and the Markdown header of a newly created registry (card options, tags, notifications, Runs, Milestones, planning history, attachments), use the project language as well, never the interface language of the request (2026-11-06); readers accept journal lines of both languages and parse registries by their YAML alone.

Inside Deckmate, and in API and JSON CLI responses, a Task state is always its English id. Readers accept both the id and its Russian file word; writers use the project language. Unknown words fail with the valid words of both languages.

| State id | English file word | Russian file word |
|---|---|---|
| `not-started` | `not-started` | `план` |
| `discussing` | `discussing` | `обсуждаем` |
| `in-iteration` | `in-iteration` | `итерация` |
| `started` | `started` | `в работе` |
| `review` | `review` | `приёмка` |
| `done` | `done` | `принято` |

The same read-both/write-project-language rule applies to these Markdown markers:

| Marker | English | Russian |
|---|---|---|
| Open-questions H2 | `## Open questions` | `## Открыто` |
| Decision Task title | `Decision: …` | `Решение: …` |
| Workflow assignment H2 | `## Assignment: <role>` | `## Задание: <role>` |
| Recorded decisions H2 | `## Decided` | `## Решено` |
| Journey step lessons H2 | `## Lessons` | `## Грабли` |

A new question is appended to an existing open-questions section under either spelling; its heading is not renamed. State changes and activity `transitions` likewise write the project language and return English ids. The legacy owner marker `**Кто:**` is read-only compatibility syntax and is not translated.

```yaml
schema: 1
formatLanguage: en
spaces:
  - { id: production, title: Development, kind: tasks, icon: code }
decks:
  - id: audio
    spaceId: production
    title: Audio
    kind: task
    description: Events and voice-over
    color: '#f0a33e'
    icon: audio
    style: symbol
tracks:
  - { id: sound, title: Audio, description: Cross-deck work }
membership:
  - card: 'task:features/sound.md#3.0'
    deck: audio
    tracks: [sound]
subCardOrder:
  'hero:features/sound.md#3': ['task:features/sound.md#3.0']
```

Imported card text and states are not copied here. Membership can store explicit `parentId`, `owner`, `effort`, and `priority` overrides: an omitted field retains the source value; null explicitly clears the assignment. In particular, `owner: null` clears Owner in the projection instead of restoring the legacy `Кто` field. The UI changes the required YAML values while preserving the BOM, line endings, and remaining file. Native card membership lives only in its own file; a duplicate manifest entry is ignored with a warning.

A Deck may carry `piled: true` (2026-11-06): the Decks home screen shows it in the pile at the end of its Space instead of on the shelf. Only `set-deck-pile` sets it, and only by hand; returning the deck to the shelf removes the key instead of writing `false`, so a deck that was never piled has no trace of it. The write adds or removes that one key and keeps every other byte, comments included. The pile changes neither the deck's place in `decks`, nor `deckOrder`, nor any card; a value other than true or false fails the manifest read with the deck's ID.

### Members and Owner

The project defines its team in the `members` YAML field of `tasks/deckmate.md`. This optional field defaults to an empty list; members are project data, not a built-in provider list. Example agent configuration:

```yaml
members:
  - { id: kimi, label: Builder, kind: agent, aliases: [] }
  - { id: fable, label: Reviewer, kind: agent, aliases: [] }
  - { id: opus, label: Planner, kind: agent, aliases: [] }
  - { id: glm, label: Researcher, kind: agent, aliases: [] }
  - { id: astra, label: Tester, kind: agent, aliases: [] }
```

A member has id, label, kind (`agent` or `human`), and explicit aliases. `POST /api/catalog` with `action: configure-members`, members, source, and manifestHash replaces only the roster in YAML, preserving the remaining manifest fields. The Owner filter and step assignee picker use member labels; humans and agents appear in separate groups. Assignment alone does not start an agent.

Legacy `Кто` can contain a long note. The canonical owner comes from an unambiguous label or explicit alias at the start of the assignment; the original text is available separately as `ownerNote`. Mentioning an agent inside a note does not assign it. Names are mapped only through explicit aliases, never inferred. Without an explicit override, an unmatched legacy owner is null, and the full text remains in ownerNote. For native cards, a known alias is normalized in the projection while preserving the raw value in ownerNote; an unknown explicitly assigned owner is retained. Configuring the roster does not rewrite source cards.

`set-card-properties` accepts Owner for Task, Hero, and Doc. A known label/alias is normalized to the member label; an unknown name is allowed as a nonempty string of up to 120 characters without CR, LF, or NUL. null clears Owner. The quick UI offers the roster and Unassigned, retaining an existing name outside the roster as a separate option. Assignment does not establish authorship of activity events.

### CardOptions and inactive cards — 2026-11-03

New planning properties use the same storage for native and legacy cards: `tasks/deckmate-card-options.md`. They are not duplicated in native YAML or membership. Existing Owner/Effort/Priority, deck, tracks, and parent retain their previous storage locations. The CardOptions file does not become a Doc Card or enter full-text search as a standalone document.

```yaml
---
schema: 1
cards:
  'task:features/audio.md#1.2':
    handMemberIds: [kimi]
    bookmarked: true
    tags: [sfx, review]
    run: 'Run 2'
    milestone: Demo
    dueDate: '2026-11-20'
    archived: false
    deleted: false
---
Description for people and agents; not a copy of card content.
```

`handMemberIds` references registry members; Bookmark is a shared project boolean, not a signed-in user's personal bookmark. Tags are a separate list of unique strings. Run and Milestone link a card to the `tasks/deckmate-runs.md` and `tasks/deckmate-milestones.md` registries; they do not automatically assign an iteration. Due Date is a valid `YYYY-MM-DD` calendar date used by the calendar and due-date notifications. For legacy cards, `kindOverride: task|doc|hero` changes the projection while preserving the original ID and Markdown grammar. A promoted Hero no longer inherits the structural parent of its H3. Native cards change kind in their own YAML.

An omitted patch field remains unchanged; null, false, and an empty list clear the corresponding value. A write may retain null/false/[] to preserve comments and keep the edit local, but reads normalize them as no assignment. Validation rejects unknown keys, invalid dates/types, and duplicates. Existing YAML is patched by range: other keys, comments, Markdown body, BOM, and EOL are preserved. `optionsHash` is the SHA-256 of these bytes; an empty string means no file. It is a separate revision from manifestHash/sourceHash.

`archived` and `deleted` are reversible and do not delete Markdown. By default, Decks, Hand, `/api/cards`/CLI find/track search, and summary show only cards without these flags; Decks has separate Archive/Trash views. The full catalog, source files, and `show` retain access to hidden card metadata. Summary retains clearly marked context for hidden dependencies of active tasks. Deleting/restoring a top-level Hero or Doc includes its current children; archiving alone does not cascade. There is no physical file purge or automatic Trash expiration. When a running server serves the writable source (`GET /api/catalog`), it archives Tasks accepted more than 30 days ago, except those linked from an open question, and records the change in the activity log.

### Tag appearance — 2026-11-04

`tasks/deckmate-tags.md` stores the appearance registry: `schema: 1`, a `tags` map keyed by the exact string from `card.tags`, and properties `color: '#RRGGBB'` and optional `iconSvg`. Assignments remain solely in CardOptions. Existing tags absent from the registry remain searchable and selectable with a neutral color; creating an appearance does not rename or rewrite assignments. The registry does not become a Doc Card.

`CatalogView.projectTags` returns `{ name, color, iconSvg? }[]`; `tagsHash` is the SHA-256 of the original bytes or an empty string if the file is absent. `POST /api/catalog` with `action: save-project-tag`, `source: sandbox`, `manifestHash`, `tagsHash`, and `tag` creates or updates the appearance of one exact name. Writes use the shared token/source/editMode guard and catalog queue; the branch is checked in `sandbox` mode, and a stale hash returns 409. Preparation does not write; publication rechecks the hash and uses guarded atomic create/replace. Other tags, YAML comments outside the changed field, BOM, EOL, and Markdown body are preserved. Editing an existing tag cannot change its name; there is no separate rename action.

SVG is limited to 16 KB, 256 elements, and basic geometry: svg/g/path/circle/ellipse/rect/line/polyline/polygon. Numeric coordinates, path, transform, and restricted colors are allowed. Scripts, foreignObject, style, href, event handlers, external resources, entities, and XML instructions are rejected on API writes and file reads. The UI validates the icon again and renders it only as an `img` with an encoded SVG data URL; it never inserts HTML.

In the card preview, Tags offers registry and existing-assignment search, individual additions/removals, and color/SVG settings. Bulk selection retains exact strings, including names with commas, and uses the existing guarded `bulk-edit-cards` / `tags` add/remove operation. Other tags are not cleared.

### Hand — 2026-11-03

Hand is an explicit hand for a participant in the `members` registry, separate from Owner and deck. `handMemberIds` contains member IDs; one card can belong to several Hands. Assigning Owner does not add it to Hand. An unknown ID does not create a member; an empty roster does not generate hands from historical `Кто` labels.

Primary assignments for native and legacy cards live in `tasks/deckmate-card-options.md`. The global Hand tab displays cards by member; its selector shows one hand or the whole team. `/?view=hand&catalogSource=sandbox&handMember=kimi` opens the selected participant; opening a card preserves the live/sandbox source. Archived and deleted cards are excluded; accepted active cards remain. `reorder-hand` saves personal queue order; agents do not start automatically.

For agents:

```text
npx deckmate project hand --limit 5
npx deckmate project hand kimi --limit 10 --source sandbox
npx deckmate project hand "Designer" --source live
```

Members are selected by exact ID, name, or explicit alias, without substring matching against Owner. Output includes exact total/truncated values for each hand and compact cards with short references; limit is 0–100 per hand. Read the Markdown body separately with `show <c-ref>`.

`summary` also excludes archived/deleted cards from its main counts and groups. If an active task explicitly depends on a hidden card, that card remains in `dependencies` with `archived: true` or `deleted: true` and its state, preserving blocking context. Hand, Bookmark, Tags, Run, Milestone, and Due Date appear in compact output when set; `show` retains access to all metadata, including hidden cards.

### Native cards

```yaml
---
deckmate: card
schema: 1
id: 437a9d85-a359-4eb6-8fa3-7482eb6816c4
kind: task
title: Check character footsteps
state: not-started
owner: Researcher
deckId: audio
trackIds: [sound]
parentId: 'hero:features/soldier-life.md#10'
iteration: null
dependsOn: []
effort: 2
priority: medium
---
Instructions, expected result, and verification.
```

The filename must match the UUID in the frontmatter. The canonical ID is `card:<uuid>`; one file produces one card and one document entry, with no second Doc card. UUIDv4 and deterministic UUIDv8 are supported. A Task's byte range covers only its body; `sourceHash` covers the entire file. For native Hero/Doc cards, range, state, and version are null.

`effort` is an optional finite number ≥ 0; `priority` is optional `high` / `medium` / `low`. Omission means unset. These fields are read into the catalog and SQLite, never inferred from text length or state. API creation also accepts null and omits those values from YAML. `update-card-content` does not change effort, priority, or other properties.

`assign-deck` / `set-tracks` require a native card's current `sourceHash`, change only YAML, and preserve the body, BOM, and EOL byte for byte. An invalid or stale hash prevents writing. Unknown/malformed files appear in warnings. Native cards are created through `create-card`, by applying a Journey, or manually using the format above.

The UI changes Deck through Quick Settings. Properties has no separate Tracks form; API commands update track links: `set-tracks`, or `set-card-links` to change deckId and trackIds together in one source-file or manifest write. An invalid or stale hash prevents writing and protects external changes.

Bulk operations `bulk-assign-deck` and `bulk-add-track` accept `cards: [{ cardId, sourceHash }]`, with 1–1000 unique cards, and a shared `manifestHash`. The first sets `deckId` (null means no deck); the second adds `trackId` to existing links. All cards, hashes, and assignment constraints are checked before writing; an incompatible card rejects the entire set. Legacy membership is saved with one manifest replacement; native cards use separate source files. There is no cross-file transaction: partial I/O returns an explicit UI warning with saved and pending IDs. Retrying after rereading skips completed work; tracks are not duplicated.

Legacy IDs remain `task:<path>#<version>`, `hero:<path>#<section>`, and `doc:<path>`. They depend on paths: renaming requires explicit link migration. A native UUID is stable inside a correctly saved file; it does not automatically migrate legacy data.

### Creating and editing content

`GET /api/card-content?source=sandbox&cardId=<URL-encoded ID>` returns `{ cardId, title, markdown, sourceHash }`. Source defaults to `sandbox` and can be `live`; both support reads. `sourceHash` is the SHA-256 of the entire source file, not just the selected card. Editors must read the full title and text here, not from the catalog's shortened preview. ID is required; resolve a short c-ref to the canonical ID first.

Both write commands use `POST /api/catalog`, the `x-deckmate-token` header from `GET /api/snapshot`, and shared JSON fields `source: "sandbox"` and `manifestHash`. Success returns an updated `CatalogView`, including any warnings.

| action | Required fields in addition to shared fields |
|---|---|
| `create-card` | `cardId: "card:<uuid>"`, `kind: "task" \| "hero" \| "doc"`, `title`, `markdown`, `deckId`, `trackIds`, `parentId`, `owner`, `effort`, `priority` |
| `update-card-content` | `cardId`, `sourceHash`, `title`, `markdown` |

Title is a nonempty single-line string of up to 1000 characters; Markdown is a string of up to 200000 characters and can be empty. `trackIds` is a list of unique existing tracks. An explicit `deckId` must name an existing compatible deck. `deckId: null` uses the project's Inbox if it accepts the card kind, otherwise creates an Unassigned card (`deckId: null`); this also applies to Sub Cards. For Task/Doc, `parentId` is null or an active top-level Hero/Doc. Hero is always created without a parent; nested families are prohibited. Task starts in `not-started`; Hero/Doc state remains null. Owner for any card kind accepts null or a name following the rules above. Send unset `parentId`, `owner`, `effort`, and `priority` explicitly as null, and `trackIds` as `[]`.

`set-inbox-deck` accepts only Task or Mixed decks (or null to clear). Legacy Inbox decks of other kinds remain readable and receive only compatible card kinds. Changing the Inbox deck to a kind that cannot take Tasks clears `inboxDeckId` with a warning. Starter templates choose their first compatible Task deck when no Inbox is set; the demo uses Production.

The client generates the creation UUID and retains it until a confirmed response. The server publishes `cards/<uuid>.md` without overwriting the destination. Repeating the same ID with identical metadata and text is safe and creates no duplicate; an existing ID with different content returns 409. Every request still checks the current manifestHash and, when assigning a parent, verifies that the parent's source is unchanged before publication.

The server computes text-edit boundaries from fresh bytes:

| Card | Editable content |
|---|---|
| Native | The YAML title value and Markdown after the frontmatter; other keys, comments, ID, and links are preserved. |
| Legacy Hero | The numbered H2 title and introduction up to the next heading; child slices are excluded. |
| Legacy Task | The H3 title and slice body; the number, state marker, and associated annotations are preserved. |
| Legacy Doc | H1 and body without YAML; if H1 was absent, a real edit inserts it after the frontmatter. |

`tasks/deckmate.md`, `tasks/iteration-board.md`, and `tasks/journeys/**` are protected from the general text editor and return 422 with an explanation. Use their dedicated mechanisms. For mechanics documents, reparsing rejects edits that add, remove, or renumber slices, change their states, or change their parents. This API does not restructure mechanics documents.

Unchanged ranges, BOM, and original line endings are preserved byte for byte. A title-only edit leaves the body intact even with mixed CRLF/LF; repeating an unchanged request does not write the file. Changed body text adopts the source file's line endings; a separating newline before an adjacent heading is added when necessary. Reads and publication reject symbolic links and junctions in the path; destination and hash are checked again before atomic replacement.

Stale sourceHash or manifestHash returns 409 without writing. `update-card-content` does not automatically merge external edits: the draft is retained, and refreshing the source and retrying are explicit actions. Invalid request shape returns 400, invalid content returns 422, and a prohibited live write or missing token returns 403; reading a missing card returns 404. After saving a mechanics document, the derived board is rebuilt and checked if the project contains `Tools/board.py`. Board or index failure does not roll back Markdown: the response includes a warning, or 503 with `saved: true` if the catalog cannot be reread. This result must not be treated as an unsaved change.

A mechanics document is a legacy Markdown source with numbered Hero sections and Task slices; Deckmate reads its cards, while `tasks/iteration-board.md` is the derived board. After a supported mechanics edit, Deckmate uses the project's `Tools/board.py` through Python to rebuild and check that board. Without `Tools/board.py`, no Python command runs. Omit that file to disable the integration: `DECKMATE_PYTHON` only selects the interpreter, and leaving it unset uses the default `python` command rather than disabling the board check.

### Parenthood, state, and quick properties

Commands use the same `POST /api/catalog` with `source: "sandbox"`, token, and `manifestHash`. Each also sends `cardId` and the full source card's `sourceHash`. The server rereads the catalog, validates revisions, and rechecks the source before publication. A stale request returns 409; repeating a request without an actual change neither writes a file nor creates an activity event.

| action | Additional fields | Change boundary |
|---|---|---|
| `set-card-parent` | `expectedParentId`, `parentId`, `parentSourceHash` | Task/Doc without children: attach to a top-level Hero/Doc, change parent, or detach with null. |
| `set-card-state` | `state`, optional `returnReason` | Task only: `discussing`, `in-iteration`, `started`, `review`, `done`, `not-started`. |
| `set-card-properties` | `owner`, `effort`, `priority` | Send all three fields explicitly; each accepts null to clear its value. |

`expectedParentId` records the selected Task/Doc's original parent. Attaching requires `parentSourceHash`, which validates the target Hero/Doc's file; detaching uses null. Changing parent preserves the card's deck, tracks, and Markdown. Legacy membership receives an override; the original H2 and slice location are not rearranged. Families have one level: a Task/Doc child cannot have children, and a Hero/Doc parent cannot have parentId. Nesting checks include archived and deleted descendants so restoring them cannot create a nested family. Restore archived/deleted parents and children first. Once a Journey is applied, changing or removing the parent is prohibited to preserve the instance relationship. Repeating the current assignment is a valid no-op.

`set-card-state` works with native Tasks and imported mechanics slices. For legacy cards, only the H3 marker changes: Unicode word boundaries prevent `принятость` from being treated as a state, and CR, LF, or CRLF defines the line ending. The remaining body, adjacent slices, BOM, and unchanged bytes are preserved. The legacy `in-iteration` marker uses the current number from `tasks/iterations.md`, with that file rechecked before writing; acceptance is dated in Europe/Moscow. For native cards, the command changes only state and preserves the separate iteration field: no sprint number is assigned automatically. Cards have no `blocked` state; blocked remains a dependency calculation in summaries.

Native properties are patched in YAML without reserializing the body or unrelated keys. Legacy Owner/Effort/Priority are stored in membership; null differs from a missing override. Effort is a finite number ≥ 0 or null; Priority is `high`, `medium`, `low`, or null. A quick-properties draft retains its original hashes: the watcher does not refresh write authorization for the user. A conflict preserves input and offers an explicit reload of current data.

Attach Sub Cards selects existing childless Task/Doc cards across decks, shows their current parent, and confirms reassignment. It is a sequence of individual guarded `set-card-parent` calls, not a cross-file transaction. The first error stops further writes; confirmed cards remain attached and leave the selection, while the rest remain with an explicit count. Refresh the selection and check current relationships before retrying. Detaching an individual Sub Card also requires explicit confirmation. Knowledge can remain in a Knowledge deck while its family links tasks from Task/Mixed decks: deck kind does not change the parent's role.

### Open rule questions — 2026-11-04

The sole source of an open question is a list item in the rule Doc card's `## Open questions` section. One top-level list item is one question; nested options do not count, and the section ends at the next H1/H2 or a card report heading (`#### Report <date> · <member>`). The ❓N counter comes from these items, not task states. Each catalog Doc card's `openQuestions` (`{ text, taskRef }[]`) and `openQuestionWarnings` fields are populated by `src/open-questions.ts`; if the section is absent, so are the fields and icon. Warnings identify items linking to a task missing from the catalog or to an accepted task whose question remains; parser warnings for empty items and duplicate links appear there too.

Both commands use `POST /api/catalog` with `source: "sandbox"`, token, and `manifestHash`:

| action | Required fields | Result |
|---|---|---|
| `raise-decision` | `cardId` (Doc), `sourceHash`, `questionIndex`, `questionText`, `taskCardId`, `deckId`, `memberId` | Turns the question into a decision Task with the `Decision: …` prefix; see the stages below. |
| `record-decision` | `cardId` (Doc), `sourceHash`, `questionIndex`, `questionText`, `answer`, `memberId` | Adds an answer to `Decided` (`Решено`), removes the item from `Open questions`, and accepts the task. |

`raise-decision` has three retryable stages, keyed by `taskCardId` (the client retains the UUID):

1. Create a Task titled `Decision: <question text>` in `deckId` using the same code as `create-card`; the deck must accept Task. Its parent is the Doc itself, which must be top-level; a Doc subcard cannot have its own questions because families have one level. Owner is the `memberId` participant's `label`; the member must be human (`kind: human`). The Task body links to the Doc and includes the question item with its options.
2. Add the same member to the hand (`handMemberIds`) using the `bulk-edit-cards` / hand mechanism; preserve other hands.
3. Append ` — [Decision](/r/c-…)` to the Doc item using `src/open-questions.ts` with `sourceHash` protection; preserve the remaining file byte for byte.

If the task already exists, skip stage one; if the link already exists, stage three does not write. `questionText` is compared with the fresh file: a changed item returns conflict 422 without writing. A partial failure names the completed and pending stages; retrying the same `taskCardId` completes the remainder without duplicates. A `taskCardId` occupied by an unrelated card is rejected.

`record-decision` writes the answer through `recordDecision`, using the human member's `label` as author and the server's local operation date in YYYY-MM-DD format. It adds `- <answer> — <author>, <date>` to `Decided` (`Решено`; created above `Open questions` in the project language if needed) and removes the answered item and its options from `Open questions`. If the item had a task, the task is then accepted with normal `set-card-state` and `done`. If a retry finds the item gone and the answer line already in `Decided`, it succeeds without writing (the comparison ignores the date); a changed item conflicts without overwriting. If the Doc was saved but accepting the task failed, the response names that stage. Retrying does not duplicate the answer; normal `set-card-state` completes acceptance.

### Persistent Sub Card order — 2026-11-03

The optional `subCardOrder` YAML field in `tasks/deckmate.md` maps a top-level Hero/Doc's canonical ID to an ordered list of its Task/Doc IDs. It works identically for native and legacy cards; `GET /api/catalog` returns this map, or `{}` when absent. Order remains primary Markdown data, not a SQLite or browser setting.

`POST /api/catalog` with `action: "reorder-subcards"` accepts the active top-level Hero/Doc's `cardId`, its source-file `sourceHash`, and `cardIds`: **a complete unique permutation of all active Task/Doc children**, including those in other decks. Shared `source: "sandbox"`, `manifestHash`, and token are required. The list accepts up to 1000 IDs; an empty list is valid only for a parent with no active children. Duplicates and invalid format are rejected; missing or unrelated children and stale hashes return conflict 409. A filtered visible subset cannot replace the full list.

Before publication, the server rechecks the manifest, CardOptions, parent file, child set, and child source hashes read at the start of the operation. A concurrently attached native card also causes a conflict even if the parent file did not change. Repeating a saved order with current hashes is a no-op without rewriting or an event; the first explicit order is saved even if it matches the original sequence. If the manifest is absent, `tasks/deckmate.md` is created.

The write changes only the selected parent's list in `subCardOrder` or adds the missing key. With an unchanged list length, individual string IDs are replaced while preserving comments at their positions; when length changes, only that list is reserialized. Other bytes, BOM, line endings, other families, and Markdown after the frontmatter are preserved. Implicit YAML aliases or edits that would change unrelated values through shared references are rejected. A narrow race remains between the final external-writer check and rename; there is no interprocess compare-and-swap.

Cards do not physically move: their files, `parentId`, deck, tracks, state, `dependsOn`, and Journey instance remain unchanged. Sub Card order controls family display, not pipeline execution order. When reading the family panel, stale IDs are ignored and new children are appended in source order. Attaching and detaching do not rewrite the saved list; the next reorder sends the full current set. This is not manual ordering of every Task in a deck.

### Hand and deck order — 2026-11-04

`reorder-hand` in `POST /api/catalog` accepts `memberId` and `cards: [{ cardId, sourceHash }]` with `source: "sandbox"`, `manifestHash`, and token. This is a complete unique permutation of open cards explicitly in the participant's hand; Owner does not add a card to the hand. Changed membership or a stale hash is rejected as a conflict. Order is stored in each card's CardOptions as `handOrder: { <memberId>: <index> }`; other participants' slots are preserved, and repeating the current order does not write. Hand shows seven top slots and a queue. The Done pile is computed from Owner on accepted active cards, including cards outside the hand; weekly counts and Effort use `doneAt`.

`set-deck-default-order` accepts `deckId` and `defaultOrder: string | null` with the shared catalog write fields. The string is stored on the manifest's Deck object in URL-parameter form, such as `order=state&direction=asc`: up to 200 characters, matching only `^[a-zA-Z0-9=&.,%]*$`. null or an empty string clears the setting; absence defaults to Priority sorting. Repeating the value does not write. This is a view setting; manual order and zones are stored separately in `deckOrder`. Moving a native card changes `deckId` in its YAML and `deckOrder` in the manifest; legacy moves change membership and manifest order. CardOptions remains the separate property store.

## Bulk actions — 2026-11-03

`POST /api/catalog` with `action: "bulk-edit-cards"` accepts `cards: [{ cardId, sourceHash }]` (1–1000 unique cards), `manifestHash`, `optionsHash`, and `change`. Shared source=sandbox and token are required. UI actions open a compact form with explicit application; mixed values do not automatically clear fields. Read-only Copy refs and CSV are available without writing project data.

| `change.kind` | Fields and behavior |
|---|---|
| `properties` | One or more of `owner`, `effort`, `priority`; omitted fields stay unchanged, null clears them. |
| `state` | `state`; Task only. UI Done sets `done`; undo sets `not-started`. |
| `parent` | `parentId`, `parentSourceHash`; an existing top-level Hero/Doc, or null to detach. |
| `create-parent` | Client-generated `cardId`, `title`, `deckId`; creates a Hero and assigns the selected Task/Doc cards as its children. |
| `promote-parent` | Future Hero's `cardId`, `sourceHash`, `expectedParentId`; explicit Asset/Mixed `deckId` or null. Promotes an existing card and attaches the selected Task/Doc cards. Each `cards` entry must also provide the child's `expectedParentId` for this branch. |
| `hand` | `memberId`, `mode: add|remove`; an explicit hand from the registry, without changing Owner. |
| `tags` | `tags`, `mode: add|remove`; unions or removes only the specified tags. |
| `track` | `trackId`, `mode: add|remove`; individual links to an existing Track. |
| `options` | A partial `patch` for Bookmark, Run, Milestone, Due Date, Archive/Trash. |
| `convert` | `cardKind: task|doc`, compatible `deckId` or null; Hero/Journey cards cannot be converted. |
| `duplicate` | `deckId`, `properties`, `copies: [{ cardId, newCardId }]`; creates new native cards. |

Convert works with native Task/Doc cards and legacy `task:<path>#<version>` slices: a legacy kind override preserves the original grammar and ID. This action cannot turn an ordinary `doc:<path>` document into a Task. A Doc with Sub Cards cannot become a Task; restore archived/deleted cards first. Task→Doc sets state to null; Effort/Priority and full source text are retained as optional metadata.

Promote & Select is a separate action from Convert. A Task/Doc candidate can be a Sub Card: promotion removes its previous parent and Task state while preserving ID, full Markdown, Owner, Effort/Priority, and other metadata. Children remain in their decks; the new Hero's deck assignment is explicit. Archived, deleted, and Journey candidates are prohibited, as are cycles and nested families. Native cards receive targeted YAML scalar edits; legacy cards receive `kindOverride: hero` and a targeted membership patch without changing their source document. The Hero role is published first, then child links. With partial I/O, children remain in `bulkOutcome.pending` until all required publications finish; an already promoted Hero can be retried with the same ID and current hashes/expectedParentId. No new card or ID is created.

Copy Cards reads full text through the content API and creates `cards/<new-uuid>.md` for both native and legacy sources; it does not rewrite the original. Copies can include selected Owner/Effort/Priority/Tags/Run/Milestone/Due Date/Tracks. A Task copy starts in `not-started`; Journey provenance is not copied. A Hero is copied without children; a subcard retains an eligible parent. The client retains UUIDs: retrying the same data creates no extra card; a mismatch with an existing file conflicts. There is no Attachments selection or separate binary-asset cloning mechanism; this does not transfer media between projects.

CSV is generated from selected visible cards and selected columns: UTF-8 BOM, `;`, CRLF, and spreadsheet-formula escaping. The Markdown column requires the full content API for each card. Links include the live/sandbox source. CSV import through `POST /api/catalog-import` supports preview and explicit application; Copy refs, Copy Cards, CSV export, and CSV import are separate actions.

The server validates the full set and prepares all candidates, including sidecars, then rechecks sources before each publication. State changes to several legacy slices in one file use one patch; membership uses one manifest replacement. A no-op neither writes files nor creates an event. There is no cross-file transaction: `bulkOutcome` distinguishes `applied`, `unchanged`, `pending`, `created`, and `warnings`. After partial I/O, published files remain; retrying requires a fresh catalog and hashes. An action whose copy file exists but whose selected CardOptions are not yet saved remains pending until both publications complete. Index refresh failure does not undo Markdown.

### Card attachments — 2026-11-09

`GET /api/attachments?source=sandbox&cardId=<id>` returns `{ hash, files, warnings }`; `live` reads are also available. The registry and binary UUID files live in `tasks/deckmate-assets/cards/<key>/`. PNG/JPEG/WebP/GIF/PDF files are allowed up to 10 MiB each, with a maximum of 500 registry entries per card.

`POST /api/catalog` actions send token, `source: "sandbox"`, `manifestHash`, `cardId`, and `attachmentsHash`:

- `upload-attachment`: `dataUrl`, optional `fileName` and `addedBy`; the `x-deckmate-actor` member takes precedence over `addedBy`.
- `remove-attachment`: `file`; updates the registry and deletes the binary file.

Card covers were removed on 2026-11-09. Existing registries still read, but legacy `cover` entries are opaque data: never returned or shown, never validated as active attachments, and preserved byte for byte during uploads and removals, even when their image is removed. Only the `files` block changes; BOM, line endings, other metadata, comments and Markdown body remain unchanged. New registries omit `cover`. Deck, Run and Milestone covers and Vision images remain separate features.

Each attachment row offers **Copy link for the card text**: Markdown relative to the card file, embedding images and linking PDFs, with short copied feedback. It is available in read-only views too.
In the card text editor, the paperclip menu can insert the same attachment Markdown directly.

`attachmentsHash` protects the registry revision: an empty string means no file; a stale hash returns 409. This API branch requires `manifestHash` in the request shape but does not check its freshness or `sourceHash`: writes follow a separate path guarded by token, edit mode, and attachment hash; the branch is checked in `sandbox` mode. The shared catalog queue and activity event writing do not apply to attachment operations. The card body is not rewritten.

## Deckmate activity log

After a mutation actually saves changes, the application creates a new Markdown file in `tasks/deckmate-activity/`. YAML contains `schema: 1`, event UUID, UTC `at`, action, `actor: Deckmate`, summary, card references, affected deckIds, and details; an ordinary agent can read the body. The API does not edit or delete existing events. This is append-only application behavior, not protection of local files against external edits. The log does not become a Doc Card or enter the cards' text index.

Events describe confirmed changes, not button presses: no-op, rejected, and unwritten mutations create no history. Moving a card includes its old and new decks; changing parent also includes the old and new Hero's decks. Assignment history is not duplicated across neighboring decks merely because their order indices shift. Events are limited to the command's cards or a legacy operation's source file: concurrent external edits to another file are not attributed to Deckmate. Owner is not used as event author; history from other editors and Git is not reconstructed automatically.

The `reorder-subcards` event reports a changed Sub Card order, references the Hero and its children, lists the saved order in details, and belongs to the Hero's and children's decks. Other families are excluded from this command's event. If the entire family is outside decks, no deck activity event is created.

If Markdown saves but the derived board fails to rebuild, the log reflects the saved change and the original board error remains visible. If writing the log itself fails, the primary edit is not rolled back: the response warns of saved data and incomplete history. That warning does not mean the main action should be retried.

`GET /api/activity?source=sandbox&deckId=<id>&limit=10&cursor=<cursor>` returns `{ events, nextCursor, warnings }`. Source selects the same data root as the catalog; limit is 1–50, default 10. Events are newest first; cursor is the last viewed filename, opaque to the client. Invalid parameters are rejected; malformed entries are skipped with a warning. A request scans at most 500 files, so an empty page with `nextCursor` does not yet mean the end of history.

Latest activity shows the selected deck's log with absolute dates, full timestamps in tooltips, clickable card titles, and expandable details. Show more loads batches of 10 without duplicate IDs; switching source/deck or revision resets pages and cancels old requests. Empty history explains that it begins with the first change through Deckmate.

Since 2026-11-04, state-change events include `transitions: [{ cardId, from, to, reason? }]`, including bulk changes and recorded decisions. `set-card-state` accepts optional `returnReason: string | null`: one line up to 500 characters; a nonempty reason is allowed only when leaving `review` for a state other than `done`. Repeating the same state is a no-op. The reason is stored in the event, not the card text. Old events without `transitions` are not used to infer transitions from free-form details.

## Journey / pipeline

A template belongs to an Asset/Mixed deck. `index.md` contains `deckmate: journey`, `schema: 1`, UUID, title, version, deckId, and a list of `steps/<stepId>.md`. A step contains YAML fields id/title/deckId/owner/dependsOn and a Markdown instruction after the frontmatter. Step names use ASCII `[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}`; Windows device names and case-insensitive duplicates are rejected. There is no legacy parallel writer to `tasks/journeys/<uuid>.md`.

### Additional Journey fields — 2026-11-04

Steps also accept optional `effort` (finite number ≥ 0), `priority` (`high`/`medium`/`low`), and `zoneId`. Journey frontmatter accepts `description` (up to 2000 characters) and `zones` (up to 20 `{ id, title }` entries, id matching `[a-z0-9][a-z0-9-]{0,59}`). Legacy files without these fields remain valid: reads return effort/priority = null, and a step without zoneId belongs to `default`. Empty `zones` permits only `default`; with a nonempty list, each step's zone must exist in it. Writes omit null values so legacy files do not accumulate empty keys. Applying a Journey copies the step's effort and priority to the new Sub Card.

`update-journey` (`POST /api/catalog`) saves the entire template from the editor: `journeyId`, aggregate `journeyHash`, title, description, zones, and the full steps list are required. The server validates the DAG, steps' Task/Mixed decks, and zones, increments the version by 1, and publishes a diff: new steps are created, changed steps are rewritten in full, unchanged files are not written, and removed files are deleted after `index.md` is published last. Cards created from previous versions are unaffected. A Journey or manifest hash conflict returns 409 without writing.

### Journey template catalog — 2026-11-04

A template is not bound to decks: each step names a role, and import maps roles to decks. Bundled templates live in `assets/journey-templates/<id>/` in the Deckmate repository; project templates live in `tasks/journey-templates/<uuid>/` in the data project. Both use the same format. `index.md` contains `deckmate: journey-template`, `schema: 1`, id (`[a-z0-9][a-z0-9-]{0,59}`, UUID for project templates), title, description, category, tags, author, updated (`YYYY-MM-DD`), roles, zones, and a list of `steps/<stepId>.md`. Each step has YAML id/title/roleId/dependsOn/effort/priority/zoneId and an instruction. `CatalogView.journeyTemplates` returns both sources (`source: bundled | project`) with an aggregate `fileHash` over index and all steps; a broken template produces a warning rather than failing the catalog.

Optional `locales: { ru: { title, description } }` immediately after the English `description` localizes picker text (title up to 200 characters, description up to 2000), with trimmed values, omitted blank strings, English fallbacks, and unknown locale keys ignored. When import creates a Journey, these fields follow the project's `formatLanguage`; project-made templates saved from a Journey do not write `locales`.

`import-journey-template` accepts `deckId`, `templateId`, `templateSource`, `templateHash`, `mode`, `roleMapping`, and, for an existing Journey, `journeyId` + `journeyHash`. Each role used by steps maps to an existing Task/Mixed deck or to `createDeck { title, spaceId }`; a new Task deck uses the same code as `create-deck`. `mode: add` with `journeyId: null` creates a new Journey in `deckId` using the template title; with `journeyId`, it appends template steps to the existing Journey (ID collisions get `-2`, `-3`… suffixes, dependencies are remapped, zones are merged without duplicate IDs, and version increments by 1). `mode: replace` replaces the selected Journey's steps and zones like `update-journey`. A stale `templateHash` returns `TEMPLATE_CONFLICT` (409).

`save-journey-template` (`journeyId`, `journeyHash`, title, description, category, tags) writes a project template to `tasks/journey-templates/<uuid>/`. It creates one role per distinct step deck (`id` = deck id, `title` = deck title), sets `author: Project` (`Проект` in a Russian-format project), and sets `updated` to the save date. Steps and index retain instruction Markdown, including `%PARENT_TITLE%`. Files are written without overwriting existing files, index last.

The UI creates and edits saved Journeys: instructions, owner, target deck, dependencies, effort/priority, and zones. Steps expand in the shared Markdown editor; new steps get short IDs `step-01`, `step-02`, and so on. Saving through `update-journey` explicitly increments the version and does not rewrite existing Tasks. A project Journey and its source portable template are separate entities.

Application is allowed only to an existing top-level Hero in the template's deck. A Doc can have Sub Cards, but a Journey cannot be applied to it. Preview lets users select steps and target Task/Mixed decks; dependencies must be selected or already created. Before writing, the server checks the complete DAG, references, deck kinds, collisions, `manifestHash`, Hero source hash, and `journeyHash`. The last covers index and every listed step file's bytes, so editing an instruction after preview causes a conflict.

Each new task gets its own file, state `not-started`, step owner, Hero parentId, real dependency IDs, iteration=null, and `journeyId/version/stepId/instanceId` provenance. `%PARENT_TITLE%` is replaced by the Hero title. ID is deterministic from Hero, Journey, version, and step: reapplying finds existing files, preserves manual changes, and creates only missing files. This materializes tasks; it does not start an assignee or automatically accept the result. When instructions are copied, relative Markdown links and images are rebased from the step file to the card file; only URL ranges change. Code, external URLs, anchors, and remaining markup are preserved.

New template steps are published first, `index.md` last as the readiness marker. With partial I/O, created files are not deleted; an incomplete template without index is invisible to the catalog. Partial application returns saved/missing step status; IDs make retries safe. Editing a template does not rewrite existing instances.

### Journey lessons and metrics — 2026-11-04

`POST /api/catalog` with `action: "add-journey-step-lesson"` accepts `journeyId`, `journeyHash`, `stepId`, `cardId`, `text`, and shared write fields. `x-deckmate-actor` must identify a known registry member. The card must belong to the specified Journey/step, and the step must exist; text is a nonempty string up to 500 characters. The command appends `- <text> — <author>, YYYY-MM-DD ($c-ref)` to the step file's `## Lessons` (`## Грабли`) section, creating it in the project language if absent. YAML frontmatter remains byte for byte unchanged; the Journey hash is checked again before writing. An identical full line is a no-op. The Journey version does not increase, but its aggregate hash changes. New instances receive lessons with their instructions; existing Tasks are not rewritten. Save as Template includes this text; there is no reverse synchronization to the source template.

`GET /api/journey-metrics?source=sandbox&journeyId=<uuid>` returns `{ journeyId, steps, warnings }`; source can also be `live`, and a missing Journey returns 404. A step contains `stepId`, `instances`, `accepted`, `returns`, `cycleHours: { median, average, samples } | null`, `owners`, `actors`, and `lastReturns: [{ at, cardId, reason, actor }]`. Instances from all Journey versions are included, including Archive but excluding Trash. Only steps with instances are returned: first in current Journey order, then removed steps.

Returns counts every departure from `review` except acceptance; a reason is optional. An accepted card's cycle time runs from its first `started` to its last `done`; results include average, median, and sample count. At most three recent reasons are returned per step. Metrics read structured log transitions; events before 2026-11-04 without transitions provide no history for this calculation. Complete historical statistics are unavailable for those cards.

## Vision and covers

Vision saves a real Excalidraw scene in `boards/<uuid>.excalidraw`. Images are stored as local assets; the scene on disk has `files: {}` and `externalFiles`, with no embedded base64. Reads assemble binary data for the editor. PNG/JPEG/WebP are allowed with MIME/signature validation and a 5 MiB limit per image; a scene is limited to 5000 elements and 20 MiB of serialized JSON.

Saving checks the current hash and returns the exact saved revision without rereading after rename. Unsaved drawings and titles guard navigation; a conflict retains the draft in the editor. The UI holds a new board's UUID until a confirmed save, so retrying after a lost response does not create a second object.

A card node stores `customData.deckmateCardId` and displays live card data in Lane/Mini/Full modes; clicking opens the source card. Smart Node shows computed progress. Shapes do not become copies of primary card properties. Diagram arrows do not automatically create `dependsOn`.

Decks support a custom image, color, icon, symbol/artwork/minimal composition, and image position. Replacing a cover does not delete the old asset: another deck or board may need it. There is no automatic cleanup of unused images.

## SQLite, short references, and the agent interface

The server stores derived SQLite data in `index-<identity>.sqlite` in the cache folder — `DECKMATE_INDEX`, by default `~/.cache/deckmate/` — outside the data project. FTS5 indexes text; catalog rows retain properties, parent/deck/track, iteration, dependencies, Journey provenance, effort, priority, and CardOptions from canonical Markdown files. Search excludes archived/deleted cards by default. Files remain the sole source of truth; a corrupt cache is recreated, and the first request rereads sources. The implementation uses Node 26's built-in `node:sqlite`. Do not edit SQLite to change Hand or properties: the next rebuild restores file values.

After a write, the catalog is invalidated and the index is rebuilt from files. To rebuild persistent SQLite manually, stop the server, delete only the matching `index-<identity>.sqlite` and its `-wal`/`-shm` files, then start the server and request the catalog. Identity is the first 24 hexadecimal characters of the SHA-256 of the absolute data-root path together with the interface language; live and sandbox use separate indexes. Do not delete data-project files. Locks or insufficient permissions are not treated as corruption and do not trigger automatic cache deletion.

CLI commands `map/show/summary/hand/pipelines/pipeline/step` read fresh files without building SQLite; `boards/board` read scenes without scanning the catalog. Only `find/track/rebuild` build an independent in-memory index: neither queries nor `rebuild` replace the running server's persistent database. Direct reads return an empty `indexedAt` instead of inventing an indexing time. If the watcher fails, the server stops trusting its cache and warns that a manual refresh is needed.

`shortReference(kind, id)` returns a compact deterministic alias: `c-` for a card, `p-` for a pipeline, and `v-` for Vision. Canonical IDs remain in files. Aliases resolve against the current catalog, and ambiguity is rejected; they are not access tokens. HTTP `/r/<ref>?source=sandbox` opens the target card, Journey, or board; use `source=live` explicitly for the original.

Run the commands from the project folder; from elsewhere add `--data <project>`, and add `--read-only` (or set `DECKMATE_READ_ONLY=1`) for read-only work. The data folder is chosen as for the board: `--data`, then `DECKMATE_DATA`, then the current folder; `.env.local` of the current folder is read. From a Deckmate source checkout, `npm run project -- <command>` is the same command. `deckmate --help` lists every command, including the agent commands `next`, `brief`, `changes`, `ask`, `report`, `state`, `inbox` and `init <template>`. `state <c-ref> <state> --member <id> [--reason <text>]` is `set-card-state` with the member as actor; leaving `review` without acceptance needs `--reason`.

```sh
npx deckmate project map
npx deckmate project summary --track sound --limit 5
npx deckmate project find --text "footsteps" --kind task
npx deckmate project track sound
npx deckmate project show "task:features/soldier-life.md#10.3"
npx deckmate project pipelines
npx deckmate project pipeline "<full-id-or-p-ref>"
npx deckmate project step "<full-id-or-p-ref>" step-01
npx deckmate project boards
npx deckmate project board "<full-id-or-v-ref>"
npx deckmate project rebuild --source live
```

Results are JSON. `show` accepts a full ID or c-ref and returns Markdown, hash/range, document, parent/children, and deck/space/tracks. `pipelines` lists individual instruction paths; `pipeline` returns an overview and step properties without Markdown. `step <p-ref> <stepId>` returns one complete instruction with owner, target deck, dependencies, and file path. `board` returns the scene and references without image base64.

`find` combines filters with AND; text is a literal FTS query, and owner is the canonical member name; search comparisons are case-insensitive. For unmatched native owners, the UI retains an Other group. `summary` selects the entire catalog or a track by ID/unambiguous title and returns counts, doing/review/blocked/ready/planned, and external dependencies. Each group has total/truncated; limit is 0–100, default 5. Groups can overlap: blocked is computed from missing/unaccepted dependencies. Ready requires an explicit iteration and state `in-iteration`; summaries neither assign work nor start agents.

Read API: `GET /api/catalog`, `/api/cards`, `/api/card-content?cardId=...`, `/api/summary?track=...&limit=5`, `/api/activity?deckId=...`, `/api/boards`, `/api/boards/:id`, `/api/file`; each selects source. `POST /api/catalog` updates metadata/covers, card content, state, properties, and links, creates native cards, configures members, and creates/applies Journeys; `POST /api/boards` saves scenes. Writes require the local session token, relevant hashes, and `source: sandbox`; `direct` writes to the project without a branch check, while `sandbox` mode checks for `deckmate/sandbox` or `freetion/sandbox`. Writes are rejected in `read-only` mode and for live POST requests.

Minimal agent context (2026-11-05): `brief <c-ref>` → the required `show <c-ref> --lines a-b` range → on return, `changes <c-ref> --since <ISO|sourceHash>`. Use `summary` to select work and `step <p-ref> <step-id>` for full Journey instructions. Assigning an owner does not start an agent; an assignee's report does not mean accepted. Files can be read without Deckmate.

### Agent context package — 2026-11-05

`brief <c-ref> [--budget N] [--json]` reads fresh primary files and defaults to Markdown with a budget of 1500 estimated tokens. JSON contains `markdown`, `tokens`, `truncated`, and `readNext`; each next range has `path`, inclusive `from`/`to`, `title`, and `tokens`. The package includes the verbatim slice, Hero introduction and subcard rows with states, neighbors/dependencies, relevant rules and code, up to three related cards, and recent events. Omissions are explicit and available as ranges. The estimate is approximate: Cyrillic characters / 2.7 + other characters / 3.8, rounded up; it is not a model tokenizer.

Required verbatim text is never truncated: if it exceeds the budget, the command reports the required minimum and fails (HTTP 422). Increase the budget or request file lines. `find --fields brief` and `/api/cards?fields=brief` use a read-only in-memory index, without auto-archiving or Run rollover.

`show <c-ref> --lines a-b` reads source-file lines, not card-relative lines, and returns `path`, `from`, `to`, `totalLines`, `markdown`, fresh `sourceHash`, and `tokens`. Lines are numbered from 1, both boundaries inclusive; CRLF/LF and the first line's BOM are preserved. An optional final newline is not added. Invalid or out-of-file boundaries are rejected.

`find <text> --fields brief` returns compact `{ cards, tokens }`; each card retains its previous fields except Markdown and adds up to three `hits: [{ line, text }]` with absolute file line numbers and excerpts of up to 200 characters. `show --fields brief` and `summary --fields brief` add `tokens` to the previous object. These JSON estimates count the compact representation before adding their own `tokens` field. New fields require an explicit flag to preserve previous CLI responses byte for byte without new parameters; ordinary `find` remains an array in the previous format.

`changes <c-ref> --since <ISO|sourceHash>` does not write an agent checkpoint. An ISO timestamp with a time zone selects card events strictly after that instant; a full SHA-256 compares current bytes (`previousSourceHash`, `sourceHash`, `changed`). A hash contains no time: `eventScope: all-card-events` and a warning explicitly state that the full card log is returned. For ISO, `changed: null`. Sidecar property edits can change the log without changing the source-file hash. The latest three `git log` entries for the path supplement the log; missing Git or read failures are reported separately. The log does not track arbitrary external edits; use Git to read text diffs.

HTTP uses the same functions: `/api/brief?cardId&source&budget`, `/api/changes?cardId&source&since`, `/api/file?path&source&from&to`. The last returns a raw Markdown range. `/api/cards?fields=brief` returns an array of existing properties without `markdown`, with `hits`; without `fields`, the format is unchanged. `brief`/`changes` do not run catalog housekeeping or write anything to the data project. No MCP or persisted agent checkpoints are added.

## Interface and limits

The UI provides Space presets, space/deck creation and editing, cover uploads, deck dragging within/between Spaces, neighboring decks, toolbar, Summary, compact cards, and a table. An open deck's rail contains New Card, Info, Ordering, Tags, and Activity. Panels support mouse/keyboard resize and collapse; Focus Mode opens a separate full-screen card layer with the shared editor. The URL restores selected area, card, search, layout, and kind/state/owner filters. Hide Sub Cards hides a child only when its parent is in the same filtered result; membership, total count, and progress are preserved. The family panel offers search, sorting, open-task filtering, cross-deck navigation, and Task/Doc creation, attachment, and detachment.

A card opens a formatted preview on the left while the list or grid remains on the right; Content and Properties replace each other in one sheet, and Journey opens as a modal. Task has quick state actions; bottom Effort/Priority and Owner controls open separate settings. Changing Deck through header Quick Settings saves immediately; Owner/Effort/Priority use an explicit button. A normal click on an internal Markdown file opens an in-app preview with back navigation, rendered/source modes, and return to the previous draft. API commands (`set-tracks`, `set-card-links`) update track links; Properties has no separate form, and external edits do not silently authorize overwriting new links.

The overview separates decks, all cards, and cross-deck tracks. Inside a deck, search is explicitly limited to its contents; filters have a count and reset control. Checkbox/Shift selects a range in displayed order; hidden cards do not enter bulk actions. With a nonempty selection, a normal click toggles selection, and groups can be selected together. Ctrl/Cmd+A selects visible cards, I inverts selection, X toggles the hovered card, and Escape clears selection. These commands do not intercept input in editors, forms, or menus. The bulk bar replaces the normal header in the same sticky slot; filtering retains the intersection of visible selected IDs. Available operations are listed under “Bulk actions”; manual Zones are available in Ordering. Notifications support seen/dismiss, without Snooze.

The neighboring-cover strip scrolls away; the deck toolbar stays below global tabs. Summary, list, preview, and bulk-action offsets use their actual heights. Close/Focus remain pinned in long previews; narrow screens have no nested panel scrolling. File-change events are batched in a bounded 160 ms window without indefinite postponement; stale responses from another source cannot replace current data. Parent/child relationships, counts, and search text are computed once per catalog revision.

Timeline displays dated Runs, Milestones, and card due dates. A selected Run or Milestone opens its cards, statistics, and actions below the timeline. There is no separate Sprint tab; legacy `?view=sprint` opens Timeline at the current Run. Calendar registries are separate Markdown files, and card assignments live in CardOptions. Scheduled Runs advance on their own: once a minute the running server checks the Run registry and, when a Run has passed its Finish at time or a schedule has fewer upcoming Runs than set, finishes it with frozen statistics, moves the unfinished cards chosen in the schedule (review/blocked/other) to the current Run and creates the next periods; reading the catalog never does this, and read-only mode never writes. Finish Run is the same action ahead of time, with its own choice of groups. Automatic rollover remains only for legacy standalone Runs: started, unfinished Tasks (`discussing`, `started`, `review`) move to the current or nearest Run, and the move is logged. Timeline opens the viewer's last selected Run or milestone from browser storage. Legacy iteration and `tasks/iterations.md` remain separate data, not a source of invented completion dates.

The text editor supports native Task/Hero/Doc and legacy cards within the boundaries described above. Promote & Select, manual deck order/zones, Journey editing, Hand order/slots, and deck deletion are implemented. Nested families, starting an agent from a card or Owner (agents start only through `deckmate agents run`), space deletion, and automatic legacy-ID migration after rename are not implemented. Owner, due-date, and Watching notifications work: a member watches single cards or whole decks, live @-mentions included, and the Watching stack lists major changes only. Run configuration is complete: a schedule finishes Runs and carries the chosen cards on its own, as described above, and the selected Run's statistics include a burndown of recorded daily observations and seven-day velocity; finished Runs keep frozen snapshots. Bookmark is not personalized. Hash checking before rename leaves a narrow external-writer race; this is not interprocess compare-and-swap.
