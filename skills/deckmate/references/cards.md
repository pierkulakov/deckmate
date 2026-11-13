# Cards and native files

Use one card as the source of truth for its result, properties, questions, decisions and reports. Create or change cards only after approval of the specific list: create with `deckmate project create` or MCP `create_cards`, change state or properties with `deckmate project update` or MCP `update_card`; card text and other operations without a command or tool follow [HTTP](api.md). Never write card files by hand or through SQLite. Reading and the guarded CLI `next`, `brief`, `question`, `report`, `state`, `ask`, `answer` and `apply` still work without a server.

## Task

A Task delivers one verifiable result.
- Give it a short outcome title, one owner responsible for the next action, and `Visible` / `Work` / `Done` sections. In `Done`, state numeric tolerances and the exact check command or playtest scenario so acceptance needs no guesswork. If the project's cards already use another heading for the result (for example `## Acceptance`), follow the project's convention.
- For gameplay, verify the integrated playable build, not only an isolated asset. For a prototype, name one hypothesis, the cheapest observable test, and success and stop criteria.
- Use a checklist for steps with the same owner and verification. Make a child card when an item needs its own owner, verification, dependency, or Run.
- Set `effort` on every Task: a finite relative number ≥ 0, with 0 for trivial work; compare with an accepted card of the same type. Unset effort has weight 1 only in a Hero's child-progress calculation; Planning/Run/Hand effort sums use known estimates, and Planning lists `unestimated` separately.
- Read `priority: high | medium | low` as required / medium / bonus for delivery. Owner and Hand are independent; assignment never launches an agent.

## Hero

A Hero is an integrated game object or system that needs several child cards.
- Title the playable or visible outcome, then give each child Task its own verifiable result, owner, effort, priority, dependencies, Run and milestone; do not assume planning values inherit from the Hero.
- Prefer one small end-to-end increment over parallel parts that meet only at the end, so the Hero demonstrates the result in the assembled build.
- A Hero has no parent and no ordinary Task workflow. Completion derives from eligible child Tasks; a native Hero without counted children can carry a manual `done` mark, cleared with `not-started`.
- Keep Heroes one level deep: a Task/Doc can have one active top-level Hero/Doc parent, and a child cannot have children.

## Doc

A Doc holds a small rule or reference without a delivery workflow state.
- Name the rule or topic directly; state the decision, scope, exceptions and verification references close to the work they govern. Keep Docs small enough to read before implementation.
- Docs have `state: null` and normally `effort: null` and `priority: null`; owner may name the person who maintains the rule.
- Keep a rule Doc top-level when other cards use its rules. Questions and decisions stay on the card they concern; structural parenting does not move them to the Doc.

## Card file format

This format is a reference for reading existing cards, not instructions to create or edit card files by hand. Create cards and change their properties with the MCP tools (`create_cards`, `update_card`) or `deckmate project create` / `update`, with no running server; card text, dependencies, Hand, tags, Runs and milestones stay with the running server (UI / [HTTP](api.md)).

A native card is one UTF-8 file at `cards/<uuid>.md`; the filename UUID must exactly match frontmatter `id`. Its canonical ID is `card:<uuid>`; UUIDv4 and deterministic UUIDv8 are supported. Commands accept that full ID or the c-ref they print, but file links use full canonical IDs.

Required frontmatter keys are `deckmate: card`, `schema: 1`, `id`, `kind: task | hero | doc`, single-line `title`, `state`, `owner`, `deckId`, `trackIds`, and `parentId`. YAML strings are quoted, especially titles containing colons; unset state/owner/deck/parent use explicit `null`, and no Tracks uses `[]`. Optional keys are `iteration` (nonnegative integer or null), `dependsOn` (unique canonical card IDs), `effort` (finite number ≥ 0 or null), `priority` (`high | medium | low` or null), and Journey provenance managed by Deckmate. Markdown after the closing `---` is the card body. New Tasks start `not-started`; change an existing card's state with `deckmate project state`, which records the transition and its reason.

Example dependent Task:

```yaml
---
deckmate: "card"
schema: 1
id: "33333333-3333-4333-8333-333333333333"
kind: "task"
title: "Verify the tide-gate glow in the harbor"
state: "not-started"
owner: "Build Agent"
deckId: "production"
trackIds: ["first-playable"]
parentId: "card:11111111-1111-4111-8111-111111111111"
iteration: null
dependsOn: ["card:22222222-2222-4222-8222-222222222222"]
effort: 1
priority: "medium"
---
## Visible
The player can follow the gate glow across the harbor.

## Work
Check the accepted glow prototype in the integrated harbor scene.

## Done
The route is visible at 1280×720 from the ferry to the gate; run the harbor playtest and record its result.
```

Manifest `members` is the team registry (`id`, `label`, `kind`, `aliases`); `membership` holds deck links/overrides for imported cards. Use a registered `kind: agent` entry's `id` for agent commands; register one with approval as described in [team setup](../workflows/team.md). When the person names someone missing from the registry, ask whether to act as an existing id or to register the new one; never act under an unregistered id.

Choose `deckId`, Track IDs and parent IDs from `map`/`show`; do not add native cards to manifest `membership`. `owner` accepts a person/agent label or explicit alias and does not manage Hand membership. Deck compatibility is strict:

| Deck kind | Accepted card kinds |
|---|---|
| `asset` | Hero |
| `task` | Task |
| `knowledge` | Doc |
| `mixed` | Task, Hero, Doc |

Only existing active prerequisites outside `done` block; missing, archived and deleted ones do not. Nevertheless, fix broken links: `map` warns about an unknown/incompatible deck, missing parent, or missing dependency. Malformed YAML or an ID/filename mismatch produces a warning and the file is not loaded as a card. Invalid states, duplicate dependency entries, negative/non-numeric effort, and unknown priority values are rejected in file warnings; reread after correcting them.

Check `map` warnings after writes, then take each new c-ref from the `created` list `create` prints or from `find "<title>" --fields brief`; refs do not exist before the first read.

Hand, tags, Run, milestone and due date are card options, not front matter: they live in `tasks/deckmate-card-options.md` under `cards:` keyed by canonical ID (`card:<uuid>:` → `handMemberIds: [builder]`, `handOrder: { builder: 0 }` for the position in each Hand, `run: <run-id>`, `milestone: <id>`, `dueDate: YYYY-MM-DD`, `tags: [...]`). Change them only through the running server's UI or `bulk-edit-cards` ([HTTP](api.md)); do not edit shared card options by hand.

Check `map` warnings again after editing card options. Keep writes to one card sequential: “The source changed in the files” is the stale-hash guard, not permission to overwrite; reread before retrying.

## Report block

`report <c-ref> --file <UTF-8-report.md> --member <id> --state review` appends `#### Report <YYYY-MM-DD> · <member>` and can move the Task to `review` in one event. Use `#####` or deeper headings inside the supplied report; levels 1–4 are refused because they would break the card/report structure.

Keep the report to 60 lines: lead with a five-line Summary naming card, absolute date, assignee, result, changed files, checks and reread baseline. Give every tolerance a row with required/actual units and evidence, include exact launch or reproduction steps, and list skipped checks under Not checked rather than reporting them as zero errors.

## Questions and decisions

Keep one top-level list item per question in the concerned card's Open questions section (legacy `Открыто`); native cards and ordinary Docs use H2, while imported Hero/Task bodies use H4. Nested options are not separate questions. The section ends at the next heading of the same or shallower depth, a numbered Task H3, or a generated `#### Report` heading.

- `ask` stores the question on that card with an optional human `@member` addressee and an optional target (`c-ref` or `c-ref#section`; the same card by default); it does not create a separate Task.
- `question <c-ref#N>` returns the chat package and exact target range; discuss it with the addressee, which may be null if no human is registered.
- `answer <c-ref#N> … --as <human>` records the approved answer in `## Decided` (legacy `## Решено`) and removes the open item.
- All unapplied decisions form the pool returned by `next` before ordinary Tasks; any Task with an open question waits in `next`, even if no addressee is named.
- Edit the supplied target, then `apply <c-ref> <index>` / MCP `apply_decision` with its zero-based decision index; the brief shows open questions and decisions still to apply.
- Match saved question text exactly. Question punctuation is Markdown-escaped in the file (for example, `\?`, `\,`), while commands return plain text.
