# Work on a card

Contract as of 2026-11-06: `docs/catalog.md`, “SQLite, short references, and the agent interface”; writes and conflicts: `docs/api.md` (`docs/` paths are relative to Deckmate). Run the commands below from the project folder with the `npx deckmate project` prefix (in a Deckmate source checkout: `npm run project -- … --data <project>`); substitute actual references and a registered member.
Use `--source sandbox` for the reads below; read the live project only if the assignment names it. Write only to the root authorized by the assignment. Do not edit SQLite.

## Workflow

1. Run `next <member>` (`--brief` includes the card package): it returns the first card of the hand that is not `review` (review), `done` (accepted), or stale, and whose dependencies are accepted. `card: null` means nothing is ready: tell the coordinator; `hand <member> --limit 20` shows the whole queue. If it returns a Hero or Doc, ask the coordinator which Task to take. Owner and Hand do not launch agents.
2. Run `brief <c-ref> --budget 1500`: it includes the latest report, agent questions and answers, and the Journey step. Check criteria, neighbors, and accepted examples to avoid repeating completed work. For a Doc, get the path from `find` and read the required range directly: plain `show` may return the entire document.
3. Run `show <c-ref> --lines <start>-<end>`. Read source rules and criteria. For a card made from a Journey step, the step path in `brief` is `tasks/journeys/<pipeline-id>/steps/<step-id>.md`; `step <pipeline-id> <step-id>` returns the full instruction with owner, target deck, and dependencies; `pipeline` provides only an overview. Then work within the assignment's scope.
4. If a question blocks work, run `ask <c-ref> "<question>" --member <you> [--to <human>]`: it adds an item to the rule Doc's `Open questions` (Open) section and a `Decision: …` (Decision) task to the person's hand; repeating identical text writes nothing. A Task without a rule Doc keeps the question in its own `Open questions`, and nobody gets a Decision task: the command warns, and you tell the person directly. Read new messages with `inbox <member> --since <ISO>`. Do not continue dependent work until answered: the person answers under the card's Open questions (`record-decision` moves the item to Resolved and accepts the Decision task), and `brief` shows the answer.
5. Run the checks the assignment names; bring the summary and errors into context and read the full log only on failure (in the Deckmate repository: `npm run quiet -- …`, 2026-11-05). For gameplay, also check the integrated build against the card's playability and performance criteria; an isolated asset check does not prove the assembled result.
6. After verification, prepare the report below and submit it: `report <c-ref> --file <report-path.md> --member <you> --state review` writes a `#### Report` block to the card and sets `review` in one event. Headings inside the report use `#####` or deeper; a higher one is refused because it would end the block. Do not set `done` yourself; stop after submission until acceptance.

## Limit context

- Do not read an entire mechanic document: use ranges, Read next links, and only the required step. Do not skip mandatory rules or criteria to fit a budget.
- Use `--budget 1500` with `brief`; prefer its default Markdown output, and use `--json` for machine processing. Existing `hand/show/find` commands return JSON; do not add an unsupported `--budget`.
- `truncated` means an incomplete response: follow the required links; do not treat omitted content as absent.
- On return, run `changes <c-ref> --since <ISO-date-or-sourceHash>`; use `git diff <saved-commit> -- <path>` for changes outside Deckmate. Without a base, reread the required ranges. Save the date, sourceHash, and commit: an empty event log does not rule out external Markdown edits.
- Run one filtered pass of affected tests and the specification's required commands. Bring the summary and errors into context, not the full success log.

## Report: no more than 60 lines

Use the first five lines for the Summary, then give every specification tolerance its own row with a measurement and evidence. Include the exact launch or reproduction steps and links to the logs, screenshots, or captures needed to inspect the result; the reviewer should not have to reconstruct the context. Use absolute dates; do not report a skipped check as zero errors.

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
