# Keep the GDD as linked cards

**When:** Turn game rules and objects into Docs, Heroes and Tasks, or organize an existing Markdown design document. **Not this:** Cut one approved feature into delivery cards → [plan](plan.md); repeat a production chain → [Journey](journey.md).
**Person:** Approve the exact mechanics, objects, decks, Tracks and card list; answer rule questions and review diagrams in the UI.
**Agent:** Inventory the sources, identify their card projection, propose the structure, create or link cards after approval, and verify the result.

## Steps
1. Inspect the current structure — `deckmate project map --data <project>` ([command](../references/cli.md#map)).
   → Reuse space, deck and Track IDs. Check each deck's `kind` before assigning cards.
2. Inspect one source by its title — `deckmate project find "<title>" --fields brief --limit 20 --data <project>` ([command](../references/cli.md#find)).
   → Read `id`, `path`, `kind` and `parentId`; supported Markdown already appears as cards, without an import:
   - A legacy mechanics document in `features/**/*.md` or `docs/**/*.md` turns numbered `##` headings into `hero:<path>#<section>` and `### X.Y` slices into `task:<path>#<X.Y>`, with the Hero as parent. The whole file also appears as `doc:<path>`.
   - Other supported legacy Markdown appears as one `doc:<path>`; a native `cards/<uuid>.md` appears as one `card:<uuid>` of its declared kind, with no second Doc. See the [native card format](../references/cards.md#card-file-format).
3. Record the baseline — `deckmate project summary --limit 20 --data <project>` ([command](../references/cli.md#summary)).
   → Compare `counts.kind` with the source inventory; inspect every group's `total` and `truncated` rather than treating listed cards as the whole project.
4. Propose the specific source-to-card mapping and get approval. Include deck assignments, one rule Doc per mechanic, object Heroes, discipline Tasks, Tracks and diagrams; do not copy cards that already have a source projection.
5. Create approved cards with `deckmate project create "<title>" --kind <task|hero|doc> --deck <deck-id> --parent <c-ref> --member <you>` ([create](../references/cli.md#create); MCP `create_cards` is the same step) and change state or properties with [update](../references/cli.md#update); never write card files by hand. Check `map` warnings, then `find` for c-refs. Keep legacy sources and their projections, not copies; arrange decks through UI / [HTTP](../references/api.md#members-spaces-and-decks), which has no command or tool. Register missing owners in the [members roster](team.md).
6. Write each mechanic's top-level rule Doc with the rule, measurable examples, `## Open questions` and `## Decided`. Keep one question per top-level list item and use the [question and decision contract](../references/cards.md#questions-and-decisions) to close it.
7. Build one Hero per game object and child Tasks per discipline. Keep the Hero in an Asset deck, each Task in its Task/Mixed discipline deck, and write each Task's outcome and verification from the [card anatomy](../references/cards.md#task).
   → Verify with `deckmate project show <hero-ref> --data <project>` → `context.children` → `deckmate project show <child-id> --data <project>` for every child. Compare canonical `parentId`, deck and dependencies with the approved inventory; for Journey children also check `journey.stepId` and `journey.version`. A Hero-title search does not enumerate its family.
8. Create cross-deck Tracks through UI / [HTTP create-track](../references/api.md#members-spaces-and-decks), then assign the approved cards and verify — `deckmate project track <track-id> --fields brief --limit 100 --data <project>` ([command](../references/cli.md#track)); take IDs from `map`, not titles.
   → Check the intended cards' `trackIds`; linking a Hero does not implicitly link its children.
9. Draw approved Vision diagrams with live card nodes via UI / the [boards endpoint](../references/api.md#vision-boards), then list them — `deckmate project boards --data <project>` ([command](../references/cli.md#boards)).
   → Take the exact `v-ref`; `linkedCardIds` shows direct card links.
10. Inspect the selected scene — `deckmate project board <v-ref> --data <project>` ([command](../references/cli.md#board)).
   → Check `path`, `linkedCardIds` and `scene`; image binaries are not embedded in this output.

## Done when
- `show <hero-ref>` lists the approved family in `context.children`; `show <child-id>` confirms every child's canonical `parentId`, `deckId`, dependencies and any Journey step/version, with no duplicate source card.
- `deckmate project summary --limit 20 --data <project>` matches the approved inventory, and every truncated group has been followed with a suitable filter or limit.
- Every mechanic has one top-level rule Doc; every object has its discipline Tasks with owners and checks; open questions have explicit decisions once answered.
- `deckmate project track <track-id> --fields brief --limit 100 --data <project>` shows the explicit links, and `deckmate project board <v-ref> --data <project>` opens the expected diagram and card links.

## Rules

Use the shared [card anatomy](../references/cards.md) for Task/Hero/Doc structure and estimates.

- Keep one small top-level rule Doc per mechanic and resolve its questions before downstream production — shared decisions prevent cross-discipline rework.
- Preserve existing source projections and link rather than copy — duplicated rules drift and legacy IDs depend on paths.
- Use Vision for diagrams and live card links, but store real prerequisites in `dependsOn` — drawing an arrow does not change scheduling.
- Prove one integrated, playable object before mass production — the assembled game verifies rules that prose alone cannot.

## Pitfalls
- A mechanics search returns `doc:features/…` beside its Hero and Tasks → this is the whole-file Doc; use it as the rule Doc when appropriate instead of creating a duplicate.
- A newly discovered source card has `deckId: null` → its folder is not a deck; assign the projected card with `deckmate project update <c-ref> --deck <deck-id>` or through the UI.
- A text search returns several kinds from the same file → filter with `--kind` and inspect `id` and `path` before editing.
