# Set up the team

**When:** a project needs its roster and working rhythm defined. **Not this:** starting a board → `workflows/start.md`; taking or reviewing a card → `workflows/work.md`, `workflows/review.md`.
**Person:** chooses the setup, registers members, and owns acceptance.
**Agent:** edits the roster files when asked; assigning an owner never starts a model.

Members live in the `members:` list of `tasks/deckmate.md` — `id`, `label`, `kind` (`human` or `agent`), `aliases`; preserve existing entries. This registry is not `membership` (imported-card deck links). Edit the file while no server runs; with a server running use [configure-members](../references/api.md#members-spaces-and-decks), which replaces the whole list. Leave demo members that still own cards until the person retires them. Owner alone does not put a card in a Hand: Hand membership has no command or tool — change it through the running server's UI or [HTTP](../references/api.md#hand-membership-and-order). Create cards with [create](../references/cli.md#create) and change them with [update](../references/cli.md#update), never by writing files by hand; new Tasks follow [plan](plan.md). Commands `hand`, `next`, `state`, `report` and `ask` in `references/cli.md` still work without a server.

## 1. Solo developer
- **Members:** one human. A new game starts from a genre starter ([start](start.md)), not from the `deckmate init` demo, whose sample cards and members belong to another game.
- **Hand:** one Hand of 3–5 open cards, refilled when they are done (accepted cards stay listed in the Hand's Done pile; `next` skips them); decks hold possibilities, the Hand holds what is next.
- **Review:** submit with `report <c-ref> --file <report.md> --member <you> --state review`, then run a separate self-check against the card's Done criteria before deciding.
- **Accept:** [acceptance policy](review.md#acceptance-policy) — a solo person may accept their own card after that self-check.
- **Ceremonies:** none — no Runs or milestones until a date or a buffer starts to matter.

```yaml
members:
  - { id: maya, label: Maya Chen, kind: human, aliases: [Maya] }
```

## 2. Small team
- **Members:** one human per discipline (code, art, design, audio); agent members optional for mechanical work.
- **Hand:** each member keeps their own 3–5-card Hand; owners pick cards at planning so planned effort matches what was accepted in past Runs.
- **Review:** never the builder of the card; return with `state <c-ref> not-started --member <reviewer> --reason "<criterion: required, actual; minimum fix; verify>"`.
- **Accept:** [acceptance policy](review.md#acceptance-policy); this setup records human-only acceptance. Set guardians on release-critical decks so only they can accept (`set-deck-guardians`, `references/api.md`).
- **Ceremonies:** one weekly Run with one written goal; blockers go to the person immediately via `ask`; at closure keep retro actions to three or fewer, each with an owner (`references/api.md` for Runs).

```yaml
members:
  - { id: maya, label: Maya Chen, kind: human, aliases: [Maya] }
  - { id: leo, label: Leo Park, kind: human, aliases: [Leo] }
  - { id: build-agent, label: Build Agent, kind: agent, aliases: [] }
```

## 3. One person with several agents
- **Members:** the human plus agent members (`kind: agent`), one agent per card.
- **Hand:** each agent's own Hand, filled by the person; an agent works the Task chosen by `next <agent>`, or a specific c-ref the person explicitly hands over — the [readiness checks](work.md) apply to both.
- **Review:** a separate reviewer agent checks reports and returns with a reason; an agent never reviews its own submitted work.
- **Accept:** [acceptance policy](review.md#acceptance-policy); this setup records that the human accepts every card, so guardians stay unnecessary.
- **Launchers:** optional `tasks/deckmate-agents.md` uses YAML front matter: `deckmate: agents`, `schema: 1`, `launchers` with `run` argv lists, `routing` from role to launcher, and `limits.parallel` / `limits.startGapSeconds`; `{prompt}` becomes the assignment path. See `deckmate agents run --help`.
- **Assignments:** preview `analyze`/`audit` with `deckmate agents run <workflow> <area> --dry --project <project>`. Launch only with permission; when roles print `manual: no launcher`, do their saved assignments yourself in sequence. Owner assignment never launches anything.
- **Loop:** builder `next` → `state … started` → `report … --state review` ([work](work.md)); reviewer checks and returns with `state … not-started --reason` or recommends acceptance ([review](review.md)); the human accepts per the [acceptance policy](review.md#acceptance-policy).
- **Ceremonies:** the same weekly Run as a small team.

```yaml
members:
  - { id: maya, label: Maya Chen, kind: human, aliases: [Maya] }
  - { id: builder, label: Builder Agent, kind: agent, aliases: [] }
  - { id: reviewer, label: Reviewer Agent, kind: agent, aliases: [] }
```

## Done when
- `hand <member>` answers for every registered member and `next <member>` returns a ready Task or `card: null`.
- Every deck with restricted acceptance has its guardians configured (`references/api.md`).

## Rules
- Keep Hands at 3–5 cards — a Hand is what is next, not the whole backlog, and clutter hides overload.
- Plan a Run from the effort accepted in past Runs, not from wishes — until three or four Runs exist, plan less and compare.
- Acceptance follows the [acceptance policy](review.md#acceptance-policy) — independent review catches what building cannot see.
- Raise a blocker the moment it appears — waiting for a ceremony costs the card's whole wait.
- Record retro actions as cards with owners — an action without an owner is a wish, not a decision.
