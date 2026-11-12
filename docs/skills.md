# Deckmate skill

The Deckmate skill is an agent skill in the open Agent Skills format. It teaches any compatible coding agent to work on a Deckmate board through the same Markdown files people use and the `deckmate project` CLI. Most work needs no server or account; project files are the source of truth.

## Install and use

With Node.js 26+ and an existing Deckmate project:

```sh
deckmate skills install --project <folder>
deckmate skills status --project <folder>
```

Install copies the skill to `.claude/skills/deckmate` and `.agents/skills/deckmate`; status compares both copies with the package. Reinstall to update. Local changes in a copy stop replacement: `deckmate skills install --project <folder> --force` replaces them and loses those changes. Keep project-specific guides in `tasks/`, not the managed copies.

Installation also adds or updates the board rules in the project's `AGENTS.md` between `<!-- deckmate:agent-rules:start -->` and `<!-- deckmate:agent-rules:end -->`, preserving everything outside the markers. Status checks this block as well.

Ask for `/deckmate <workflow>` in a compatible agent, or simply describe the situation. The agent chooses the workflow and asks before creating or changing a proposed list of cards. Use `--data <project>` on project commands to select the project explicitly. From a source checkout, `npm run project -- <command> … --data <project>` is equivalent.

## What do you want to do?

| When you want to… | Command | What you get |
|---|---|---|
| Start a game board | `/deckmate start` | A starter, team, profile and approved first playable cards. |
| Describe the project | `/deckmate profile` | An approved profile with genre, references and goals. |
| Split a feature | `/deckmate plan` | A Hero and independently verifiable child Tasks. |
| Plan a delivery or close a Run | `/deckmate milestone` | A dated plan or reconciled Run with approved changes. |
| Take or rework a Task | `/deckmate work <member or c-ref>` | A checked result submitted for review. |
| Resolve a blocker | `/deckmate ask <c-ref>` | A concrete question and a route to a recorded decision. |
| Check another member's submission | `/deckmate review <c-ref>` | An independent review, return or recommendation for acceptance. |
| Inspect board health | `/deckmate audit <deck, p-ref or project>` | Findings and proposals for the selected scope. |
| Check board layout or where a new thing belongs | `/deckmate organize [about]` | A layout audit or a Deck/Hero/Sub Card/rule Doc proposal with source pointers, without moving cards. |
| Investigate a game area | `/deckmate analyze <area>` | Evidence, options and proposed cards. |
| Structure a game design document | `/deckmate gdd` | A game design document as decks, Heroes and rule Docs. |
| Make a repeatable production process | `/deckmate journey` | A repeatable pipeline for objects of one type. |
| Turn playtest observations into action | `/deckmate playtest` | A playtest, triaged feedback and confirmed fixes. |
| Set up people and agents | `/deckmate team` | A roster, Hands and review rhythm. |

## One card through review

This is a simulated pass on a temporary demo, not a claim that game assets were produced. Create it with `deckmate init <folder>`; in the checked run the equivalent was `node bin/deckmate.mjs init <folder>`. Add `{ id: builder, label: Builder Agent, kind: agent, aliases: [] }` to `members` in `tasks/deckmate.md`. Maya already exists in the demo. Put the Task “Plan sound for Tidekeeper Ferry” into builder's Hand in the UI or through the HTTP Hand action; ownership alone does not add it. The checked run used HTTP `bulk-edit-cards` with `change: { kind: hand, memberId: builder, mode: add }` and fresh hashes. See [HTTP actions](../skills/deckmate/references/api.md) and [team](../skills/deckmate/workflows/team.md); Hand membership is the one HTTP-only step here, while the commands below are the same operations the MCP server exposes as tools ([mcp.md](mcp.md)). Use the c-ref printed by your own demo; refs can differ.

The following commands use `--data <project>` for the demo. Excerpts omit other fields:

```sh
deckmate project next builder --data <project>
# {"member":"builder","card":{"ref":"c-58gsp6mfu4","title":"Plan sound for Tidekeeper Ferry","state":"not-started",...}}
deckmate project brief c-58gsp6mfu4 --budget 1500 --data <project>
# State not-started · owner Leo Park · due 2026-11-13 · iteration —
# Dependencies: none recorded
deckmate project state c-58gsp6mfu4 started --member builder --data <project>
# "from": "not-started", "state": "started"
```

The agent reads the ranges named in the brief, does the work and writes a UTF-8 `report.md` with headings at level 5 or deeper. In this demonstration the first draft listed only a departure cue:

```sh
deckmate project report c-58gsp6mfu4 --file <project>/report.md --member builder --state review --data <project>
# "requestedState": "review", "warnings": []
deckmate project state c-58gsp6mfu4 not-started --member maya --reason "Cue sheet misses arrival and boarding; add both actions and inspect the list." --data <project>
# "from": "review", "state": "not-started"
```

The agent reads the return, starts again, adds boarding and arrival to the draft and rewrites `report.md`. Maya independently checks the resubmission and accepts it:

```sh
deckmate project state c-58gsp6mfu4 started --member builder --data <project>
# "from": "not-started", "state": "started"
deckmate project report c-58gsp6mfu4 --file <project>/report.md --member builder --state review --data <project>
# "requestedState": "review", "warnings": []
deckmate project state c-58gsp6mfu4 done --member maya --data <project>
# "from": "review", "state": "done"
```

The example's original owner remains Leo; Hand membership is separate from ownership.

## Boundaries and extensions

The skill does not accept its own work, start a model merely because a card has an owner, or edit SQLite. The SQLite index is disposable; Markdown is authoritative. Deckmate itself refuses `done` from an agent that owns the card or wrote its report; a person may accept their own card.

Start with [SKILL.md](../skills/deckmate/SKILL.md) for routing; every command, its options and output fields are in [the CLI reference](../skills/deckmate/references/cli.md), and `deckmate project <command> --help` prints the syntax. Add project genres under `tasks/deckmate-genres/` and lenses under `tasks/deckmate-lenses/`; project guides override matching bundled guides. See [agent configuration](agents-config.md) for optional launchers and routing.
