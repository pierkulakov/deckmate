# Cards and native files

Use one card as the source of truth for its result, properties, questions and reports. Create or change cards only after approval of the specific list; use the CLI, UI, HTTP, or the native format below rather than SQLite.

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
- Keep a rule Doc top-level when its open questions need Decision Tasks. Put a Task structurally under that Doc when `ask` must route there; a prose link does not create this relationship.

## Card file format

A native card is one UTF-8 file at `cards/<uuid>.md`; the filename UUID must exactly match frontmatter `id`. Its canonical ID is `card:<uuid>`; UUIDv4 and deterministic UUIDv8 are supported. Commands accept that full ID or the c-ref they print, but file links use full canonical IDs.

Required frontmatter keys are `deckmate: card`, `schema: 1`, `id`, `kind: task | hero | doc`, single-line `title`, `state`, `owner`, `deckId`, `trackIds`, and `parentId`. Quote YAML string values, especially titles containing colons; use explicit `null` for an unset state/owner/deck/parent and `[]` for no Tracks. Optional keys are `iteration` (nonnegative integer or null), `dependsOn` (unique canonical card IDs), `effort` (finite number ≥ 0 or null), `priority` (`high | medium | low` or null), and Journey provenance managed by Deckmate. Markdown after the closing `---` is the card body. Write `state` by hand only in a new file (`not-started` for a Task); change an existing card's state with `deckmate project state`, which records the transition and its reason.

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

Check `map` warnings after writing card files, then take each new c-ref from `find "<title>" --fields brief`; refs do not exist before the first read.

Hand, tags, Run, milestone and due date are card options, not front matter: they live in `tasks/deckmate-card-options.md` under `cards:` keyed by canonical ID (`card:<uuid>:` → `handMemberIds: [builder]`, `handOrder: { builder: 0 }` for the position in each Hand, `run: <run-id>`, `milestone: <id>`, `dueDate: YYYY-MM-DD`, `tags: [...]`). While no server is running you may add or edit only your card's block by hand, keep the YAML valid and check `hand <member>` and `map` afterwards; with a server running use the UI or `bulk-edit-cards` ([HTTP](api.md)), because a hand edit there races the server's writes.

Check `map` warnings again after editing card options. Keep writes to one card sequential: “The source changed in the files” is the stale-hash guard, not permission to overwrite; reread before retrying.

## Report block

`report <c-ref> --file <UTF-8-report.md> --member <id> --state review` appends `#### Report <YYYY-MM-DD> · <member>` and can move the Task to `review` in one event. Use `#####` or deeper headings inside the supplied report; levels 1–4 are refused because they would break the card/report structure.

Keep the report to 60 lines: lead with a five-line Summary naming card, absolute date, assignee, result, changed files, checks and reread baseline. Give every tolerance a row with required/actual units and evidence, include exact launch or reproduction steps, and list skipped checks under Not checked rather than reporting them as zero errors.

## Rule Doc and questions

Keep one top-level list item per question in `## Open questions` (legacy `## Открыто`); nested options are not separate questions. The section ends at the next H1/H2 or a `#### Report` heading. `ask` appends and links a Decision Task only for a top-level rule Doc; without one, contact the person directly rather than waiting.

`ask` stores question punctuation Markdown-escaped (for example, `\?`, `\,`); match the saved bytes exactly when editing the question in a file.

With the person's approval, HTTP `record-decision` moves the exact answer into `## Decided` (legacy `## Решено`), removes the open item, and accepts its Decision Task. Read the saved rule Doc to verify the answer; a bounded `brief` can omit it. See [HTTP actions](api.md).
