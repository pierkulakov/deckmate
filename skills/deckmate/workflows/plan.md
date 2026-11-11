# Cut a feature into cards

**When:** a person names a feature, supplies a Hero/Doc c-ref, or asks to change an existing card's owner, effort, deck, dependencies or parent. **Not this:** Scheduling a release or closing a Run → [milestone](milestone.md).
**Person:** Clarifies the outcome, chooses owners and approves the specific cards and placements.
**Agent:** Reads the project context, proposes the split, creates approved cards and checks the result.

## Steps
1. Agree on the feature's observable result and limits; confirm the authorized project or separate writable copy. Given a title instead of a c-ref, find it with `deckmate project find "<title words>" --fields brief --data <project>` and confirm the match with the person. With a c-ref, run [brief](../references/cli.md#brief): `deckmate project brief <c-ref> --budget 1500 --data <project>`.
   → Read its rules and requested ranges using [show](../references/cli.md#show); an absent profile does not block a self-sufficient brief. Ask only for missing scope or rules.
2. Find the project's deck and Track IDs with [map](../references/cli.md#map): `deckmate project map --data <project>`.
   → Check each relevant deck with [find](../references/cli.md#find): `deckmate project find --deck <deck-id> --fields brief --limit 100 --data <project>`. Compare existing work before proposing duplicates; if the limit is reached, narrow the search or use the UI.
3. Draft one top-level Hero for the result and child Tasks for independently verifiable work. Reuse a supplied top-level Hero rather than duplicating it. For a supplied Doc, keep it as the governing rule and propose a separate top-level Hero linked to it; do not nest the Hero under the Doc.
4. Show the person the Hero and every Task: result, owner, deck, effort, priority, checks and prerequisites. Ask whether this project uses Tracks, Runs, milestones or tags; propose those assignments only when used, otherwise leave them unset. Include prototype success/stop criteria when needed; obtain approval of the exact list and placement.
5. Create approved cards only through the running server's UI / HTTP [create-card](../references/api.md#card-content), following the [server startup rule](../references/api.md); never write card files by hand. Create the Hero first, then Tasks; generate UUIDs for HTTP, let the UI allocate its own, and read back canonical IDs before linking. Set dependencies through the UI or HTTP `set-card-dependencies`; apply approved tags in the UI and Run/milestone assignments via [milestone](milestone.md).
6. Check `map` warnings, then the saved cards with [find](../references/cli.md#find): `deckmate project find --deck <deck-id> --fields brief --limit 100 --data <project>`.
   → Compare owners, parent IDs, decks, Tracks, effort, priority and dependencies with the approved list; inspect the Hero's children with [show](../references/cli.md#show). Check [summary](../references/cli.md#summary) for blocked work.
7. If the person wants work queued, add the Task to the member's Hand through the running server's UI or [HTTP Hand membership](../references/api.md#hand-membership-and-order), then check [next](../references/cli.md#next): `deckmate project next <member> --data <project>`. Owner alone neither adds it to Hand nor starts an agent.
8. Change an existing card (owner, effort, deck, dependencies, parent) keeping its id, only through the running server's UI or [HTTP](../references/api.md), never by hand. Check `map` warnings afterwards. Restore an archived or deleted card in the UI's Archive or Trash instead of recreating it.

## Done when
- The approved Hero and Tasks exist once, their checks and placements match the proposal, and the person has their c-refs.
- Dependencies point to the intended prerequisites; the summary shows Tasks with unfinished active prerequisites as blocked. If a Task was placed in Hand, `next` follows the eligible queue and may select another Task first.

## Rules
- Card anatomy, checklist splitting, deck compatibility, family depth and estimate rules live in [the card contract](../references/cards.md#task); follow it rather than restating it per card.
- Use Tracks and tags for cross-deck topics, not as substitutes for decks, Runs or milestones.
- Resolve governing rule questions before downstream production; use a prototype to learn and the [work workflow](work.md) to raise blockers — unresolved rules cause rework.
- Add a dependency only when the next result needs it and leave other work parallel; which links block is defined by [card files](../references/cards.md#card-file-format).
- For feedback, preserve its source and observed behavior, have the person triage it before adding scope, and communicate the outcome to the requester — feedback is not automatic commitment.

## Pitfalls
- An owned Task is absent from `next` → check explicit Hand membership, then `summary` → `groups.blocked` for unaccepted prerequisites; assignment is not a queue.
