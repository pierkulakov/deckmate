# Work on a card

Run the commands below with `npx deckmate project <command> --data <absolute-project>` (in a Deckmate source checkout: `npm run project -- <command> --data <project>`). Substitute actual references and a registered member; HTTP actions and conflicts are described in `references/api.md` in this skill.
Use `--source sandbox`: the project in direct mode, or the separate writable copy when `DECKMATE_WRITE` is set. Read live only if the assignment names it. Confirm the authorized source root before editing; `--data` does not disable a configured sandbox. Do not edit SQLite.

## Workflow

If the argument is a c-ref or full card ID, start at step 2 for that card; do not pass it to `next` as a member. If the argument is a member, start at step 1. Ask for the acting registered member when it is not specified; never infer authorship from the card's owner.

1. Run `next <member>`: JSON returns the first eligible card explicitly in that member's Hand, excluding `review`, `done`, and stale started Tasks, with no existing active unfinished dependencies. Archived, deleted and missing prerequisites do not block. Stale defaults to 24 hours; `--stale-hours <hours>` changes the cutoff. `card: null` means nothing is ready: tell the coordinator. `next <member> --brief` returns Markdown instead of JSON when a card exists. `hand <member> --limit 20` shows up to 20 metadata rows, not bodies, reports or feedback; inspect `total`/`truncated` and increase the limit up to 100 when needed. If it selects a Hero, Doc or `wont-do` Task, ask the coordinator rather than starting it: `next` does not currently exclude `wont-do`. Owner alone does not add a card to Hand or launch agents. The Hand UI has seven open slots, a queue and an Owner-based Done pile; dragging reorders only, and state changes require opening the card (no start shortcut on Hand tiles).
2. Run `brief <c-ref> --budget 1500`: it returns the card and bounded context such as the latest report, questions, current Journey step and latest recorded review-return feedback. Before rework, read the reason, acting member (or explicitly unknown), UTC time and `from → to`; the feedback is selected across the card's journal, not just the three-event summary. It is historical feedback, not proof that it remains unresolved. If its reason is omitted for budget, the explicit truncation marker and `readNext` range lead to the full journal file; read it or increase the budget. Missing legacy reasons are not invented. If the verbatim card needs a larger budget, retry with the reported minimum. Use `--json` for `markdown`, `tokens`, `truncated`, and `readNext`. Check criteria, neighbors, and accepted (`done`) examples; `accepted` is not a valid CLI state. Save the sourceHash, current ISO timestamp with timezone, and Git base if available. A Doc's body may be omitted: read its required ranges, not a whole plain `show` response.
3. Run `show <c-ref> --lines <start>-<end>` with inclusive, 1-based source-file lines, not card-relative lines; it returns JSON with exact Markdown, bounds, and sourceHash. For each Read next path, use a card from that file (`find --fields brief`), or read that path's range directly. A Journey step is not a card: run `pipelines`, then `step <p-ref> <step-id>` for full instructions, owner, target deck, and dependencies; `pipeline <p-ref>` is only an overview. Its current template version may differ from the version copied into the Task: follow the assigned card and flag discrepancies. When actively starting the Task, run `state <c-ref> started --member <you>`; `next` itself does not start it.
4. If a question blocks work, run `ask <c-ref> "<question>" --member <you> --to <human-ID>`: JSON returns the question, link, and any warnings. Without `--to`, it chooses the first registered human. The question must be 1–900 characters; a rule Doc must be top-level to receive a child Decision Task. An identical open question with its Decision link is a no-op; retrying an incomplete linked question can finish pending stages. A native Task without a rule Doc keeps the question locally and creates no Decision Task: tell the person directly. `ask` does not change the original Task's state or dependencies and does not automatically block `next`; pausing dependent work is your responsibility. `inbox <member> --since <ISO-with-timezone>` returns a bounded Markdown notification summary, not a complete message log. Do not continue dependent work until answered. The human records the answer through the UI or HTTP `record-decision` (not a CLI command); verify the rule Doc's `## Decided` (legacy `## Решено`) directly if the answer is absent from `brief`.
5. Run the checks the assignment names; bring the summary and errors into context and read the full log only on failure. Use the user's project's commands, not assumed Deckmate npm scripts. For gameplay, also check the integrated build against playability and performance criteria; an isolated asset check does not prove the assembled result.
6. After verification, save a nonempty UTF-8 report and submit it: `report <c-ref> --file <absolute-report-path.md> --member <you> --state review` appends a `#### Report` block and sets the Task to `review` in one event. Headings inside it use `#####` or deeper; higher headings are refused. The JSON response includes warnings and `via: files | server`; inspect warnings, and reread after conflicts or a possibly saved failure. `report` has no `--reason` option and `--state` cannot bypass the server's required reason for a review return. A reviewer returns through `state … not-started --reason …`, as in `workflows/review.md`; the owner starts with `state … started` only when actually resuming. Do not set `done` yourself; never mark your own work accepted, and stop until independent acceptance.

## Limit context

- Do not read an entire mechanic document: use ranges, Read next links, and only the required step. Do not skip mandatory rules or criteria to fit a budget.
- Use `--budget 1500` with `brief`; prefer its default Markdown output, and use `--json` for machine processing. Existing `hand/show/find` commands return JSON; do not add an unsupported `--budget`.
- `truncated` means an incomplete response: follow the required links; do not treat omitted content as absent.
- On return, rerun `brief` and read its latest recorded feedback and required ranges, then run `changes <c-ref> --since <ISO-with-timezone-or-sourceHash>` for structured reasons and details. A sourceHash has no date: it returns all card events with a warning. Use `git diff <saved-commit> -- <path>` for changes outside Deckmate. Without a base, reread the required ranges. Save the date, sourceHash, and commit: an empty event log does not rule out external Markdown edits or a failed secondary activity write.
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
