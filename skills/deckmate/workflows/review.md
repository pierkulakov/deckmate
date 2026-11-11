# Review a submitted result

**When:** another member submits a Task in `review`. **Not this:** doing or reworking the Task yourself → [work](work.md).
**Person:** the project owner checks the result and appearance; the owner or a configured deck guardian records acceptance.
**Agent:** independently compares the submission with the agreed tolerances, checks changes and evidence, then returns it or recommends acceptance.

## Steps

1. Confirm the registered reviewer and any assigned paths, iteration limit and Git base. If paths are absent, inspect those named in the report; do not invent a limit or base.
   Run `git status --short --untracked-files=all` when Git is available.
   → Compare with the recorded initial state; do not attribute pre-existing changes by others to the assignee.
2. Read `deckmate project brief <c-ref> --budget 1500 --data <project>`.
   → Read the [Task](../references/cards.md#task), required ranges and latest [report](work.md#report-no-more-than-60-lines). Follow [show](../references/cli.md#show) for omissions. A self-sufficient card can be reviewed without profile, engine or Git; record these limits under **Not checked**, not as automatic failures.
   Match every agreed tolerance to a required value, actual measurement, unit, and evidence. Open full logs for discrepancies. On resubmission, compare recorded return feedback with the current result; read any truncated feedback's full journal range.
3. With Git and an agreed base, run `git diff --stat <base> -- <owned-paths>`.
   → Check that the changed paths fit the assignment; use the agreed base, not an arbitrary recent commit.
4. With that same base, run `git diff <base> -- <owned-paths>`; otherwise read the reported paths directly; a reported path that does not exist is failed evidence, not a skipped check.
   → Inspect the changes themselves. Read new untracked files separately; a normal diff omits them. Without Git or a usable base, compare available saved copies and report the review limit instead of claiming an empty diff.
   For data writes, verify zero changed bytes outside the allowed block, including BOM and line endings; a normalized text diff is not sufficient. Use the user's project contracts and [write protections](../references/api.md).
5. Run the specification's required commands and one filtered test pass using the project's actual runner; a card that names no command is reviewed on its evidence alone.
   → Record exact commands, exit codes, check counts, and discrepancies. Do not assume the project uses Deckmate's scripts; do not add typecheck for documentation alone unless required.
6. Inspect the delivered scenario when applicable:
   - **Application:** exercise the specified actions; check the browser console and server log for new errors, recording the scenario and error count.
   - **Gameplay or content:** inspect the integrated playable build against the profile's principles and playability/performance tolerances; use observed behavior, not an isolated asset check.
   - **Visual change:** give the owner the exact screen and action; check readability, states, and the visible result. Require the owner's visual decision, not just screenshots or passing tests.
   - **Public or release material:** require a card or milestone for each promise and verify claimed current behavior in the actual build; return unsupported claims.
   Put skipped scenarios under **Not checked**; documentation alone does not require application or visual checks unless specified.
7. If a tolerance fails or lacks evidence, return it with `deckmate project state <c-ref> not-started --member <reviewer> --reason "<tolerance: required, actual; fix; verify>" --data <project>`.
   → Inspect warnings and verify the saved return ([state](../references/cli.md#state)). Name the minimum fix and how to verify it; do not add scope. The return does not start the owner's work; hand back to [work](work.md).
8. Otherwise record the acceptance recommendation on the card: `deckmate project report <c-ref> --file <review.md> --member <you> --data <project>` without `--state` (the Task stays in `review`, the owner sees it in `brief`), and tell the person. Guarded decks list `guardianIds` on their entry in `tasks/deckmate.md`.
   → Acceptance follows the [acceptance policy](#acceptance-policy); in a guarded deck the accepting member must be a guardian ([state](../references/cli.md#state)). Check the saved state, not just the command's exit code.

For a return, send this compact handoff alongside the saved reason:

```text
Return: <c-ref>; state: not-started; recipient: <owner-member>.
returnReason: <tolerance>: required <number and unit>, actual <number and unit>; fix <action>; verify <command or scenario>.
Not checked: <check and reason, or none>.
```

## Acceptance policy

- An agent never accepts its own work; the human project owner accepts — or a configured deck guardian on a guarded deck — in the UI or with `state <c-ref> done --member <id>`.
- A solo person may accept their own card after a separate self-check against the card's Done criteria.
- Whether acceptance must stay human-only is a project decision, recorded in the project profile or the team setup.
- Deckmate enforces the first rule: `done` from an agent that owns the card or wrote its report is refused with 422 ("An agent cannot accept its own work…") through `state`, `report --state done` and bulk changes. A human may accept their own card; an independent agent reviewer can technically accept, so the project decision above still applies.

## Done when

- A return is saved as `not-started` with actionable feedback, or an independent acceptance recommendation reaches the owner with the card still in `review` until their decision.
- `deckmate project brief <c-ref> --budget 1500 --data <project>` verifies the resulting state and recorded return feedback; acceptance completes only under the [acceptance policy](#acceptance-policy).

## Rules

- Judge the agreed outcome, not new polish — review must not expand scope.
- Treat missing measurements or failed checks as gaps, not passes — confidence is not evidence.
- Do not repeat confirmed checks on the same revision without cause — new edits or failures justify another affected check.
- Keep result review separate from a process retrospective — each must end in an actionable decision.
- Respect an explicitly agreed iteration limit; if none exists, do not invent one. Route unresolved choices to [ask](ask.md) — repeated returns cannot settle an undecided rule.
- Leave appearance acceptance with the project owner — technical evidence cannot replace that judgment.

## Pitfalls

- Return rejected for an absent or multi-line `--reason` → keep the card in `review` and rewrite one actionable line ([state](../references/cli.md#state)).
