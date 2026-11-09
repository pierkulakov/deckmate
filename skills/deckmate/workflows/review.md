# Review — 2026-11-06

- Read the card, specification tolerances, and the five-line Summary; from the rest of the report, read the measurements table and Not checked. Open full logs only to investigate discrepancies.
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
- An agent report does not mean `done` (accepted): the reviewer gives a technical assessment, and the human project owner accepts the result and appearance. Keep the card in `review` (review) until that decision.
- On failure, return the specific tolerance, actual measurement, and minimum fix; add no scope. Respect the assignment's iteration limit.
- Return with `state <c-ref> started --member <you> --reason "<returnReason>"` (prefix and explicit `--data` as in `workflows/work.md`): CLI departure from `review` without acceptance requires a one-line reason of ≤500 characters. Acceptance is `state <c-ref> done --member <ID>` after the human owner's decision; in a deck with guardians, that actor must be a guardian. A guardian is a configured member, not necessarily the human owner. The command keeps actor and hash protection; on conflict reread instead of overwriting. The code does not prevent self-acceptance in an unguarded deck, but this workflow does: never accept your own work.

```text
Return: <c-ref>; state: <started / not-started>; recipient: <member>.
returnReason: <tolerance>: required <number and unit>, actual <number and unit>; fix <action>; verify <command or scenario>.
Not checked: <check and reason, or none>.
```
