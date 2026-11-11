# Take a card through review

**When:** a Task is in your Hand, a person gives you its c-ref, or your submission returns for rework. **Not this:** checking someone else's submission → [review](review.md).
**Person:** approves the scope, adds the Task to the agent's Hand in the UI, orders the queue, and arranges independent review.
**Agent:** reads the card and rules, starts actual work, verifies the result, submits it, and fixes returned tolerances.

## Steps

1. Confirm the acting registered member and authorized project root; use [Common options](../references/cli.md#common-options) to check the source selection.
   For a member argument, run `deckmate project next <member> --data <project>`.
   → Take `card.ref` and confirm it is an approved, ready Task ([next](../references/cli.md#next)); selection does not start it. For a given c-ref, skip selection, not the reads below.
2. Read `deckmate project brief <c-ref> --budget 1500 --data <project>`.
   → Read the Task, dependencies, rules to read next, latest report, and recorded return feedback ([brief](../references/cli.md#brief)). On first read, save its `sourceHash`, the current ISO timestamp with timezone, and a Git base when available. Retain that checkpoint for a return or resumed session.
3. Follow required ranges with `deckmate project show <c-ref> --lines <a-b> --data <project>`.
   → Use a c-ref from each range's own file or read its listed range directly. Check the [Task's](../references/cards.md#task) rules, outcome, tolerances, checks and accepted examples. If self-sufficient, proceed without profile, engine or Git; record unavailable context/history under **Not checked**, asking only if required evidence is blocked.
4. For a Journey Task, run `deckmate project step <p-ref> <step-id> --data <project>`.
   → Read that step's instructions ([step](../references/cli.md#step)); obtain its p-ref from [pipelines](../references/cli.md#pipelines) when needed. Follow the assigned card: its owner and text win over the template's defaults; ask about any other difference from a changed template before working.
5. On a return or resumed session with a saved timestamp, run `deckmate project changes <c-ref> --since <saved-ISO> --data <project>` using that previous checkpoint.
   → Compare events with the return feedback from step 2 ([changes](../references/cli.md#changes)). Read any truncated feedback's full journal range before editing. Compare `git diff <saved-base> -- <owned-paths>` for external edits; without a baseline, reread the required ranges and report the history limit. Save a fresh checkpoint after comparing, not before.
6. When actually beginning or resuming, run `deckmate project state <c-ref> started --member <you> --data <project>`.
   → Confirm `state: started` ([state](../references/cli.md#state)). Record the initial `git status --short --untracked-files=all` when Git is available; preserve unrelated changes.
7. Do the scoped work. If a decision blocks it, follow [ask](ask.md) and pause dependent work until the saved answer resolves it.
   Run the assignment's required checks and one filtered pass of affected tests using the project's actual commands. For gameplay, verify the integrated playable build against the playability and performance criteria, not just an isolated asset.
   → Keep measurements, exact commands, exit codes, check counts, and evidence paths; read full logs to investigate failures, not routine successes.
8. Save a nonempty UTF-8 report using the template below. Include exact launch or reproduction steps and inspectable logs, screenshots, or captures; put skipped checks under **Not checked**.
9. Submit `deckmate project report <c-ref> --file <absolute-report.md> --member <you> --state review --data <project>`.
   → Inspect `warnings` and verify the saved report before retrying an uncertain save ([report](../references/cli.md#report)); use the [review workflow](review.md) for the handoff. On a return, repeat steps 2–9 against the feedback.

## Report: no more than 60 lines

Keep the report within 60 lines, starting with a five-line Summary and one measured row per tolerance. Use `#####` or deeper [headings](../references/cards.md#report-block). Summary date is the local date, matching the CLI's `#### Report <date>` heading; evidence links are relative to the card file, not the input report file.

```markdown
##### Summary
Card: <c-ref>; date: <YYYY-MM-DD>; assignee: <member>.
Result: <what changed>; files: <paths>.
Tolerances: <N>/<N>; checks: <command, exit code, check count>.
Submitted for review; reread baseline: <ISO-date / sourceHash>.

| Specification tolerance | Required | Actual | Evidence |
|---|---|---|---|
| <criterion> | <number, unit> | <number, unit> | <command / file:line> |

##### Not checked
- <what, why, who will check it, and with which scenario; or “none”>.
```

## Done when

- `deckmate project brief <c-ref> --budget 1500 --data <project>` shows `review`; its report range contains the saved report and evidence for the independent reviewer.
- After a return, the resubmitted report measures the requested fixes and any remaining unchecked criteria; the agent stops at `review`, not `done`.

## Rules

- Agree a small working Hand, such as 3–5 next Tasks, and finish before refilling — focus needs a short queue, not a product-enforced limit.
- Change only the approved scope and blocks — neighboring work belongs to someone else.
- Read all mandatory ranges despite a bounded brief — omitted text is not permission to skip criteria.
- Fix the named return tolerances within any explicitly agreed iteration limit; do not invent one — rework must not become new scope.
- Treat return feedback as history, not proof of an unresolved defect — compare it with the current revision.
- Acceptance is not the builder's step — follow the [acceptance policy](review.md#acceptance-policy).

## Pitfalls

- `card: null` → tell the person to resolve blockers or refill Hand; do not take unapproved backlog work.
- A minimum-budget error → retry at the reported minimum; keep all required reads ([brief](../references/cli.md#brief)).
- A report heading is rejected → keep the template's `#####` headings, not document-level headings ([report](../references/cli.md#report)).
