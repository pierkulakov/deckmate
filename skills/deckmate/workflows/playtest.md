# Run a playtest, triage feedback and bugs, fix and confirm

**When:** players tried (or are about to try) a build, and their observations must become decisions, cards and confirmed fixes. **Not this:** planning a feature with no test sessions yet → `workflows/plan.md`; doing or reviewing one card → `workflows/work.md`, `workflows/review.md`.
**Person:** sets the playtest question and the decision it should change, triages every observation (fix / test hypothesis / defer / reject), applies Journeys in the UI, accepts fixes.
**Agent:** creates approved Heroes or Tasks, records observations, prepares triage, works fixes and reports back.

Run commands with `deckmate project <command> … --data <project>`; command details in `references/cli.md#track`. Evidence is attachments or links in the project folder, never loose claims.

## Steps
1. Fix the question first: with the person, write what this playtest must answer and which decision the answer changes. "Collect impressions" is not a question; no content is prepared before the question is agreed.
2. Propose one top-level playtest Hero in an Asset/Mixed deck and the Journey's selected steps; get approval of that exact list. Create or change cards only through the running server's UI / HTTP [create-card](../references/api.md#card-content), following the [server startup rule](../references/api.md); never write card files by hand. Check `map` warnings, then `find` for its c-ref. Do not also hand-create protocol/build/scenario/session Tasks.
3. Import bundled `playtest` into the project with UI / HTTP `import-journey-template`, then apply the resulting Journey to the Hero with `apply-journey` ([import and apply](journey.md#steps), [HTTP](../references/api.md#journeys)). Map roles to Task/Mixed decks; let the Journey create the step Tasks (goal → build → scenario → run → review → decisions). Read them with `pipelines` and `step <p-ref> <step-id>`.
4. Record actions, words and struggles without hints in the generated session Task, tied to its build and recording; agree separate session Tasks only for additional builds. Submit with `report <c-ref> --file <report.md> --member <you> --state review` ([reports](work.md#report-no-more-than-60-lines)). For a retrospective test, mark missing build, environment, recording or reproduction facts unknown and create an approved clarification Task; never reconstruct them by guesswork.
5. Preserve feedback's source, observed behavior and player impact separately from the proposed solution. Use a Feedback Track and compatible Inbox for Tasks; create missing Tracks via UI / [HTTP create-track](../references/api.md#members-spaces-and-decks), then take their IDs from `map`, not their titles.
6. Triage with the owner: fix (step 7), test a hypothesis (new playtest or prototype), defer (low priority, milestone only if used), or reject (`wont-do` Task with reason, or no card). Save each reason in the generated decisions Task or a linked protocol Doc; filing alone does not approve scope.
7. Keep one card per defect: steps, expected/actual, build, environment, evidence and severity in text. A simple bug is one Task without a Journey; a bug needing `bug-fix` is a top-level Hero whose Journey creates the Tasks — never both representations. Create approved cards through the running server as in step 2, check `map` warnings then `find`, and assign the Bug Track's ID from `map`. Merge duplicate sources into the same card.
8. For bug Heroes only, import `bug-fix` first, then apply its project Journey as in step 3 (reproduce → cause → fix → regression → author-check). Simple bug Tasks go directly to [work](work.md); neither route creates a second copy of the defect.
9. Confirm and close the loop: review includes the regression check — the original scenario re-run on a build with the fix (`workflows/review.md`). Report the outcome to the reporter in the card report; new observations from that exchange become new feedback Tasks, not edits of closed cards.

## Done when
- Every goal question has an answer with evidence, and every triaged observation has one recorded decision with a reason.
- `deckmate project track <bug-track-id> --data <project>` shows one main Task or Hero per defect; inspect Hero children separately. Each accepted fix re-ran the reporter's scenario.
- The reporter received the outcome; anything new they raised is a separate Task.
- Triage alone is not a completed fix loop: report missing build evidence, unconfirmed fixes and pending reporter replies explicitly.

## Rules
- For planned sessions, fix build, platform, controls, scenario and audience first — results from mixed conditions cannot be compared.
- Observe without helping and tie each recording to its build — an explained demo masks real comprehension problems.
- Severity (harm, in text) and priority (fix order) are chosen separately — urgency is not a diagnosis.
- Evidence lives as supported attachments or links; only the agreed summary leaves the project — a local board is not a public page.
- Card, defect and report anatomy follow [the card contract](../references/cards.md); the playtest-specific fields are listed in steps 4, 6 and 7.

## Pitfalls
- `track bug` fails even with a Track titled Bug → use its actual ID from `map`: `track <bug-track-id>`.
- A bundled template is not a project Journey → import it before `apply-journey`; application accepts only a compatible top-level Hero, never a Task.
- A bug Task without a rule Doc keeps `ask` questions local and creates no Decision Task — tell the person directly, as the `ask` warning says.
- `find <text>` searches card text, not Tracks — use `track <bug-track-id>` or `find --track <bug-track-id>`.
