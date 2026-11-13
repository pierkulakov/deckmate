# Deckmate MCP server — 2026-11-12

`deckmate mcp` is a Model Context Protocol server over standard input and output. Clients start the process and exchange JSON-RPC lines. `initialize` returns the route in `instructions`, and the eleven tools share an operations core with `deckmate project` (contract: `src/agent-tools.ts` in the repository); their wrappers and output formats differ. The HTTP API ([api.md](api.md)) serves the application and actions that need a live server; the files and boundaries are described in [catalog.md](catalog.md).

## Connect a client

`deckmate skills install --project <folder>` registers the server where MCP-capable clients read it:

- `.mcp.json` in the project root, and `.cursor/mcp.json` when the `.cursor` folder exists — only with the portable launch line `deckmate mcp`, resolved from PATH on POSIX systems, which keeps working for everyone who clones the project. Windows has no portable line: shell resolution there includes the working directory, so every Windows line names this machine and stays out of shared files.
- A line tied to one machine (for example `Deckmate.exe mcp`, or a Node binary with an absolute path) never reaches shared files: install prints it for manual setup — Claude Code: `claude mcp add --scope local deckmate -- <command> <args…>`; other clients get the `mcpServers.deckmate` JSON fragment and a ready `--check` line.
- Desktop users without their own Node.js 26 have the same entry as `Deckmate.exe mcp` from the installed app (`desktop/README.md` in the repository).

Check any registration with `deckmate mcp --check`: it prints the project folder, the default member, the running server of the project (if any) and the tool list size, then exits.

## Protocol

One JSON-RPC 2.0 message per line over stdio; stdout carries protocol bytes only, diagnostics go to stderr. `initialize` requires `protocolVersion`, `capabilities` and `clientInfo` (`name`, `version`), negotiates a revision (newest: `2025-11-25`) and returns `serverInfo: deckmate` and `instructions`; `tools/list` names the tools; `tools/call` returns compact JSON text. Unknown tools and malformed requests return protocol errors; execution failures carry `isError: true`. Errors with unknown IDs omit `id` in `2025-11-25`, but keep `id: null` in older revisions. Tools run sequentially, limited per session to 60 admissions per 60 seconds and 16 pending calls (including the active call); excess calls receive `-32000` with `data.retryAfterMs`. `ping` and notifications bypass the tool queue, so responses can arrive out of request order.

## Project and member

- Project: `--data <folder>` wins, then `DECKMATE_DATA`, then the nearest ancestor of the current folder containing `tasks/deckmate.md` (legacy `tasks/freetion.md`).
- Member: the call's `member` field wins, then `--member` / `DECKMATE_MEMBER`, then the MCP client name from `initialize`, matched case-insensitively against member IDs, member aliases and launcher names from `tasks/deckmate-agents.md`. An unresolved member fails with the registry IDs and the next step.

## Questions and decisions

- A question lives on the card it concerns; it may name a human addressee as `@member`, and its answer target defaults to that card.
- `ask` accepts 1–900 characters. Without `to`, it selects the first registered human, or leaves the question unaddressed if there is none. Any open question keeps its Task out of `next` until answered, whether or not it has an addressee.
- Repeating `ask` with the same normalized text, addressee and target returns the saved question as `existing` without writing; a different addressee or target asks a new question rather than changing the saved one.
- `question` with `c-…#N` returns the chat package: question, card, optional addressee, `path:from-to` target and three latest decisions.
- `answer` records the answer approved in chat as the named human; it becomes a pending decision, not a separate task.
- `next` returns a pending decision first with its exact target; edit that target, then call `apply_decision` with its card, index and rev.
- `brief` lists open question refs and decisions still waiting to be applied; applied decisions leave the pool.

## Writes

Reads never write. Writes reuse the application's write path: the running server of this project is found by its registration under the Deckmate cache folder and used when present, otherwise the project files are written directly — a different project on a port never interferes, and no port has to be free. All writes to one project run under one interprocess lock, so a CLI command, an MCP call and the open application cannot interleave partially.

## Tools

`rev` is the first 12 hex characters of a card's `sourceHash`; every tool that names a card returns its head, omitting fields at their default: no `kind` is a Task, no `state` is none, no `deck` is Unassigned, no `owner` is unowned.

| Tool | Input | Output |
|---|---|---|
| `next` | `member?`, `budget?` | Decision first: `{decision:{card,index,rev,question,answer,by,target,next}}` (`index` is zero-based, `rev` selects the decision); otherwise `{card, brief?, truncated?, readNext?, next?}` |
| `brief` | `ref*`, `budget?`, `since?` (a rev, a full sourceHash or an ISO time) | `{card, brief, truncated, readNext?, changes?}` |
| `create_cards` | `cards*`: 1–50 × `{title*, body?, kind?, deck?, owner?, priority?, effort?, parent?, tracks?, key?}`; `member?` | `{created[], existing[], failed[], warnings?}` |
| `update_card` | `ref*`, `rev?`, `state?`, `reason?`, `owner?` (null clears), `priority?` (null clears), `effort?` (null clears), `deck?` (null moves to Unassigned), `tracks?` ([] clears), `parent?` (null detaches), `member?` | `{card, changed[], warnings?}` |
| `report` | `ref*`, exactly one of `text` / `file`, `state?`, `rev?`, `member?` | `{card, warnings?}` |
| `ask` | `ref*`, `question*` (1–900 characters), `to?` (human member ID; defaults to first human, null if none), `target?` (`c-ref` or `c-ref#section`), `member?` | `{question, card, assignee, target, existing, warnings?}` |
| `question` | `ref*` (`c-…#N`) | `{rev, question, card:{ref,title}, assignee, target, decisions[≤3]}` |
| `answer` | `ref*` (`c-…#N`), `rev*` (the card's rev from `question`), `answer*`, `as*` (human member) | `{card, index, target}` |
| `apply_decision` | `card*`, `index*` (zero-based), `rev*` (the decision's rev from `next`), `note?` | `{card, index, applied}` |
| `search` | `query?`, `deck?`, `state?`, `owner?`, `kind?`, `limit?` (1–20) | `{hits[], more}` |
| `organize` | `about?` (new things, up to 300 characters) | Without `about`: `{mode:'audit', table[], warnings?}`; one topic: `{mode:'placement', about, card, deck, deckId, hero, heroRef, ruleDoc, reason, readNext[], warnings?}`; several topics: `{mode:'placements', about, placements[], warnings?}`; read-only |

Example responses (compact JSON as the client receives it):

```json
next         {"card":{"ref":"c-58gsp6mfu4","title":"Plan sound for Tidekeeper Ferry","state":"not-started","deck":"Production","owner":"Leo Park","rev":"0123456789ab"},"brief":"# Plan sound…","truncated":false,"readNext":["features/audio.md:12-40"]}
next, empty  {"card":null,"next":"No allowed card. Ask the project owner for work, or create_cards in Inbox."}
next, decision {"decision":{"card":"c-58gsp6mfu4","index":0,"rev":"0123456789ab","question":"Which target FPS?","answer":"60 FPS","by":"maya","target":"features/audio.md:12-18","next":"edit the target, then apply_decision"}}
brief        {"card":{"ref":"c-58gsp6mfu4","title":"Plan sound for Tidekeeper Ferry","state":"started","deck":"Production","rev":"0123456789ab"},"brief":"…","truncated":false,"readNext":["cards/3c83da5b-a6b4-4b29-9b20-0aace7b274ab.md:1-30"],"changes":{"changed":true,"events":[{"at":"2026-11-11T09:20:11.512Z","by":"maya","what":"state review → done"}]}}
create_cards {"created":[{"ref":"c-1a2b3c4d5e","title":"Check audio","rev":"001122334455"}],"existing":[],"failed":[]}
update_card  {"card":{"ref":"c-1a2b3c4d5e","title":"Check audio","state":"started","owner":"builder","deck":"Production","rev":"001122334455"},"changed":["owner","state"]}
report       {"card":{"ref":"c-1a2b3c4d5e","title":"Check audio","state":"review","owner":"builder","rev":"001122334455"}}
ask          {"question":"Which target FPS?","card":"c-58gsp6mfu4","assignee":"maya","target":"c-58gsp6mfu4#Performance","existing":false}
question     {"rev":"0123456789ab","question":"Which target FPS?","card":{"ref":"c-58gsp6mfu4","title":"Plan sound"},"assignee":"maya","target":"features/audio.md:12-18","decisions":[]}
answer       {"card":"c-58gsp6mfu4","index":0,"target":"c-58gsp6mfu4#Performance"}
apply_decision {"card":"c-58gsp6mfu4","index":0,"applied":"2026-11-12"}
search       {"hits":[{"ref":"c-58gsp6mfu4","title":"Plan sound for Tidekeeper Ferry","state":"started","deck":"Production","at":"cards/3c83da5b-a6b4-4b29-9b20-0aace7b274ab.md:1-42","snippet":"…"}],"more":0}
organize     {"mode":"placement","about":"Animate Moonwake Lantern","card":"subcard","deck":"Production","deckId":"production","hero":"Moonwake Lantern","heroRef":"c-…","ruleDoc":"none","reason":"…","readNext":["cards/….md:1-12"]}
```

`readNext` entries and `organize` audit `at` fields are `path:from-to` pointers into project files, 1-based inclusive lines, read with the agent's own file reader. An audit row is `card → deck → Hero → reason`; placement recommendations check existing decks and Heroes and never write.

Question references use a 1-based `#N`; decision indexes returned by `answer` and `next` and passed to `apply_decision` are zero-based. `apply_decision` returns the local application date in `applied` (or an empty value for an already-applied legacy decision with no known date). An optional `note` of at most 2000 characters is saved beside the applied mark as an application note, separate from the answer.

`organize.about` splits compound requests at `and` / `и`, commas, semicolons and numbered or bulleted lists. For example, `механика стрельбы и два образца оружия` returns separate Mechanics and Weapons placements. Each placement links an existing Hero only when its topic matches; otherwise `heroRef` is null. A Hero's `Already works` / `Уже работает` progress section is not treated as a rule specification.

MCP `create_cards` creates only the Hero; it does not apply a Journey step-chain template. Apply the project Journey separately through the UI or HTTP `apply-journey` action.

### Report files

- MCP `report.file`: a regular UTF-8 file inside the project (relative to its root or absolute), at most 200,000 bytes. Symlinks cannot escape the project; UNC, device and ADS paths are rejected.
- CLI `report --file`: unrestricted shell file access, including files outside the project, as before.

## Repeats, rev and errors

- `create_cards` derives the card ID from `key` — or from kind, deck, title and body when no key is passed — so repeating a call never duplicates: an already existing card comes back in `existing`, and nothing is written for it.
- Pass the card's `rev` to `update_card` and `report` to reject writes over newer edits; a stale rev fails with the next step `call brief with since=<rev>, then retry with the new rev`. `answer` and `apply_decision` are selected the same way: `answer` requires the card's rev returned by `question`, and `apply_decision` the decision's rev returned by `next`, which survives target edits but not a different answer at the same index.
- Every failure is `{error, next, saved?}`: `next` names the step that resolves it, `saved: true` marks a partial write (inspect the persisted result instead of repeating blindly), and an unknown input field is rejected with the allowed field list.

## Limits

- Brief budget: default 1500, minimum 200, maximum 4000 estimated tokens; `truncated: true` requires following the relevant `readNext` ranges.
- `create_cards`: at most 50 cards per call.
- `search`: 5 hits by default, limit 1–20; each snippet is cut to 200 characters.
- Any response other than a brief stays within 6000 characters of compact JSON; display titles are capped at 200 characters with `…`. Shortened text and omitted list entries are disclosed in `warnings`, and `search` grows `more` accordingly. References and source pointers are not shortened.
- A `question` chat package is at most 200 estimated tokens; a decision returned by `next` is at most 150. Long prose is ellipsized to those limits.
- `initialize` plus `tools/list` is at most 800 estimated tokens in `tests/agent-token-budget.test.ts`.

Measured on 2026-11-12 by that test on the demo project (the same reproducible estimate on both sides, not a model tokenizer):

| Scenario | MCP | MCP + 794 entry | Direct file reads/writes |
|---|---:|---:|---:|
| Discuss with `question`, record with `answer` | 122 | 916 | 1042 |
| Take with `next`, mark with `apply_decision` | 108 | 902 | 1034 |

## `deckmate project` equivalents

| Tool | Command |
|---|---|
| `next` | `deckmate project next <member> [--brief] [--stale-hours <hours>]` |
| `brief` | `deckmate project brief <c-ref> [--budget N]` (`brief.since` has no direct CLI option; use `changes`) |
| `create_cards` | `deckmate project create "<title>" [--deck] [--kind] [--owner] [--priority] [--effort] [--parent] [--key] [--body-file] [--member]`, or `--file <cards.json>` for a batch |
| `update_card` | `deckmate project update <c-ref> [--state] [--reason] [--owner] [--priority] [--effort] [--deck] [--tracks] [--parent] [--rev] [--member]` |
| `report` | `deckmate project report <c-ref> --file <report.md> --member <id> [--state review]` (the tool also accepts `text`) |
| `ask` | `deckmate project ask <c-ref> "<question>" --member <id> [--to <human-id>] [--target <c-ref[#section]>]` |
| `question` | `deckmate project question <c-ref#N>` |
| `answer` | `deckmate project answer <c-ref#N> "<answer>" --as <human-id> --member <id> --rev <rev>` |
| `apply_decision` | `deckmate project apply <c-ref> <index> --rev <rev> [--note "<text>"]` |
| `search` | `deckmate project find [text] [--deck] [--kind] [--state] [--owner] [--limit]` |
| `organize` | `deckmate project organize [--about "<new thing>"]` |

Commands and tools share the operations core, not identical wrappers or output shapes: CLI `next` adds `source` and `member`, and `--brief` prints Markdown; CLI `report` includes write metadata not returned by MCP. CLI failures use process output, while MCP failures use protocol errors. The CLI also has read-only commands with no tool (`map`, `show`, `changes`, `hand`, `pipelines`, `step`, `boards`, `summary`). Operations that have neither — card text edits, dependencies, Hand, tags, Runs and milestones, members, decks, Journeys, Vision boards — stay on HTTP ([api.md](api.md)). The full agent workflows: [skills.md](skills.md).
