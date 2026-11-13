# Start a new project

**When:** an empty folder should become a Deckmate board for a game of a chosen genre and engine, or for a software product. **Not this:** trying Deckmate on a ready-made demo → `deckmate init <folder>` (a sample game with its own cards and members — never the base of a real project); adding work to an existing board → `workflows/plan.md`.
**Person:** chooses genre, engine, template, and members; approves every card list before it is created.
**Agent:** runs the CLI checks, installs the skill, drafts the profile and the first cards after approval.

Run commands from the project folder with `deckmate project <command> … --data <project>`; details in `references/cli.md#init`.

## Steps
1. List the starters — `deckmate project init --data <project>`
   → each entry has `id`, `title`, `description`, `decks`, `journeys`; pick the closest game template — for a software product, a software starter, keeping `genre` empty and engine `none` unless the person names an applicable engine.
2. Preview it — `deckmate project init <template> --dry --samples --data <project>`
   → `items` lists every Space, Deck, Journey, and sample card with `status: create`; nothing is written. Without `--samples` the preview omits the sample cards.
3. Apply the approved starter — `deckmate project init <template> --samples --member <id> --data <project>`; its guarded write finds the project's running server or writes the files ([common options](../references/cli.md#common-options)).
   → works in an empty folder without a manifest; Journeys come with the template either way, `--samples` adds example Heroes with their Tasks; the board lands with the manifest at `tasks/deckmate.md`. For a quick look at a filled board instead, run `deckmate init <folder>` (demo project, not a starter).
4. Install this skill after initialization — `deckmate skills install --project <project>`; it needs the manifest.
   → `deckmate skills status --project <project>` verifies both installed copies ([entry points](../references/cli.md#other-entry-points)).
5. Register the team — preserve existing entries in the manifest's `members:` list (schema below); `members` is the roster, not `membership` (imported-card deck links). Verify with `hand <member>`; online, use [configure-members](../references/api.md#members-spaces-and-decks).
6. Write the project profile — `workflows/profile.md` → `tasks/deckmate-project.md`; its `genre` key selects the genre guide.
7. Read `genres/<key>.md` and `engines/<engine>.md` for the first playable and its checks; if the board is separate from the engine project, use the engine the person names, not failed file detection.
8. Propose the first playable: one Hero for the core hypothesis with 3–5 child Tasks, each with one verifiable result (`references/cards.md#task`); get the person's approval of the exact list.
9. Create the approved cards with `deckmate project create "<title>" --kind <task|hero|doc> --deck <deck-id> --parent <hero-c-ref> --member <you>` ([create](../references/cli.md#create); MCP `create_cards` is the same step); never write card files by hand.
   → Check `map` warnings first, then `find <title> --fields brief` for the saved cards and c-refs.
10. Put the first Tasks in the builder's Hand — UI drag or HTTP Hand membership (`references/api.md`).
    → `hand <member>` lists them; `next <member>` returns the first ready one.

```yaml
members:
  - { id: maya, label: Maya Chen, kind: human, aliases: [Maya] }
  - { id: builder, label: Builder Agent, kind: agent, aliases: [] }
```

## Done when
- `map` shows the template's Spaces and Decks, and `find` finds the sample cards.
- `next <member>` answers for every registered member (`card: null` or a ready Task).
- `show <hero-ref>` lists the Hero and its 3–5 children with ids in `context.children`; a title search can miss children.

## Rules
- One Hero per hypothesis, 3–5 child Tasks — a hypothesis is the smallest unit of progress, not a component list.
- For a software project, skip the game-only genre and first-playable assumptions: agree one integrated product slice and the exact first card list instead.
- Every child Task carries one checkable result — a card without a check cannot be reviewed (`references/cards.md#task`).
- Pick the starter by structure, not by name — `shooter` starts from `action`, `rts`/`4x`/`tactics` from `strategy`; `survival` has its own template.
- Genre guides give the starting hypothesis and references; the project profile overrides them where it disagrees.
- Create cards only after the person approves the list — writes land in files immediately.
- Register every worker before assigning work — actors and Hand membership resolve only registry ids (`references/cli.md#task-states`).
- Optional launchers live in `tasks/deckmate-agents.md`; see [team setup](team.md) and `deckmate agents run --help`. No launcher means manual work, not a failed assignment.
- Keep sample cards until replaced — they model good Heroes, Tasks, and Journeys for this genre.

## Pitfalls
- `--dry` or `--samples` without a template ID is rejected — list templates first.
- `--member` must be an id-like string (`maya`), not a label (`Maya Chen` → `Invalid member ID.`, exit 1); it only records the actor and creates no member.
- Re-applying a template reuses existing Spaces and Decks (`status: reuse` in `--dry`) instead of duplicating them.
