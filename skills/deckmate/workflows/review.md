# Review — 2026-11-10

- Read the card, specification tolerances, and the five-line Summary; from the rest of the report, read the measurements table and Not checked. Open full logs only to investigate discrepancies.
- Run `brief <c-ref> --budget 1500` and follow its required ranges. Its latest recorded return block includes the reason, actor (or explicitly unknown), UTC time and state transition, even outside the last three event summaries. Read the full journal range if feedback is marked truncated; do not infer absent legacy reasons or assume that historical feedback is still unresolved. `hand` metadata is not a substitute for reports or feedback.
- Match every specification tolerance to a fact, unit, and evidence. “Done,” a missing measurement, or a failed test does not establish acceptance.
- Record the branch's initial state. Compare `git status --short --untracked-files=all` with the allowed files; do not attribute pre-existing changes by others to the assignee.
- Run `git diff --stat <base> -- <owned-paths>` and `git diff <base> -- <owned-paths>`; use the base from the assignment or the start of work. Read new untracked files separately: a normal diff does not show them.
- For data writes, verify zero changed bytes outside the allowed block, including BOM and line endings. Use the project's contracts and `references/api.md` in this skill; do not assume Deckmate repository files are in the user's project.
- Run the specification's required commands and one test pass using the project's actual test runner. Only if it uses Vitest, for example: `npx vitest run <test-file> -t "<scenario>"`. Record the exit code and check count. Do not run typecheck for documentation alone unless required.
- Do not repeat confirmed checks on the same revision without a reason; new edits or failures require checks of the affected behavior.
- If the application changed, exercise the specification's scenario and check the browser console and server log for new errors. Report the scenario and error count; list any skipped run under Not checked.
- For gameplay or content, inspect the integrated result against the profile's principles and stated playability and performance criteria; use observed playtest behavior rather than opinions alone, and add no polish outside the specification.
- For public or release material, require a card or milestone for each promise and verify claimed current behavior in the actual build; return unsupported claims.
- For visual changes, give the project owner the exact screen and action from the specification. Check readability, states, and the visible result. Screenshots and tests do not replace the owner's visual acceptance; this does not apply to documentation alone.
- An agent report does not mean `done` (accepted): the reviewer gives a technical assessment, and the human project owner accepts the result and appearance. Keep the card in `review` (review) until that decision. `accepted` is a label, not a valid state ID: `state <c-ref> accepted` is invalid.
- On failure, return the specific tolerance, actual measurement, and minimum fix; add no scope. Respect the assignment's iteration limit.
- Return with `state <c-ref> not-started --member <you> --reason "<returnReason>"` (prefix and explicit `--data` as in `workflows/work.md`): both CLI and server require a nonblank, one-line reason of ≤500 characters for an actual departure from `review` to neither `review` nor `done`. Repeating `review` is a no-op; `done` is acceptance. The reviewer's decision does not mean the owner is already working. `started` remains accepted for compatibility, but performs start effects, including placing the card first in the reviewer's Hand; prefer `not-started`, and let the owner start when resuming. The reason is saved in activity, not the card body, and CLI `--reason` does not add a Journey lesson.
- Acceptance is `state <c-ref> done --member <ID>` after the human owner's decision; in a deck with guardians, that actor must be a guardian. A guardian is a configured member, not necessarily the human owner. Task `wont-do` is also supported, but leaving `review` for it still requires a reason. `report --state` cannot bypass that requirement and has no `--reason` flag. The commands keep actor and hash protection; on conflict reread instead of overwriting, and inspect saved warnings because activity remains secondary. The code does not prevent self-acceptance in an unguarded deck, but this workflow does: never mark your own work accepted.

```text
Return: <c-ref>; state: not-started; recipient: <owner-member>.
returnReason: <tolerance>: required <number and unit>, actual <number and unit>; fix <action>; verify <command or scenario>.
Not checked: <check and reason, or none>.
```
