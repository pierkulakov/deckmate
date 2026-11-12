# Changelog

Notable changes are grouped by version using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Russian version: [CHANGELOG.ru.md](CHANGELOG.ru.md).

## [Unreleased]

## [0.8.0] - 2026-11-13

### Agents

- **MCP server.** `deckmate mcp` serves MCP clients over standard input and output with eleven tools: `next`, `brief`, `create_cards`, `update_card`, `report`, `ask`, `question`, `answer`, `apply_decision`, `search` and the read-only `organize`. The project comes from `--data`, `DECKMATE_DATA` or the nearest project folder, and the acting member from the call, a configured default or the recognized client; `rev` rejects writes over newer edits, `create_cards` is retry-safe, and every error names its next step. `deckmate project create`, `update` and `organize` run the same operations; `skills install` registers the server where a portable launch line exists and protects differing entries and local skill edits from replacement without `--force`.
- **Questions and decisions.** `ask` writes a question on the card it concerns, with an answer target; a Task with an open question is not eligible for `next` until it is answered. `question` returns the question context for a `c-…#N` ref, `answer` records the approved answer, `next` returns a pending decision before ordinary cards with its exact target, and `apply_decision` records the incorporation once the target has been edited.
- **Board layout and `organize`.** One shared rule set now reaches the installed AGENTS.md block, the `/deckmate` skill and MCP instructions; the read-only `organize` tool and `deckmate project organize` audit placement or recommend a deck, Hero/Sub Card and rule Doc with source pointers. Install also lists possible board-rule conflicts outside its managed AGENTS.md block without changing them.
- **Skill writes through MCP or the CLI.** The `/deckmate` skill creates and changes cards with the MCP tools or `deckmate project create` / `update`; HTTP stays for operations without a tool or command, such as card text, dependencies, Hand, Runs and milestones, Journeys and boards. docs/catalog.md, docs/api.md and the READMEs now point agents at the MCP route first.

### Data reliability and security

- **Questions and decisions on every card.** Questions keep an inline addressee and optional answer target on Task, Hero and Doc cards without creating Decision Tasks. Recorded answers retain the question and its options, enter a pending-application pool and are marked applied separately; legacy answers remain applied. Guarded writes, target line pointers and activity support retrying without duplicates.
- **Coordinated writes.** Agent operations discover the running server by project, or write directly when none is running; an interprocess lock prevents writes to the same project from interleaving. Direct writes skip the project's Python board script and say so, while writes through a running board keep its normal rebuild.
- **Batched card creation.** Batched card creation sends one write request per batch, uses one interprocess lock, and refreshes the catalog index once afterward, reducing per-card requests and refreshes.
- **Safer MCP operations.** MCP `report.file` must be inside the project. Loading `.env.local` is restricted, and MCP messages have a size limit. On Windows a Job Object contains the server process; Desktop warns before updating while agents are connected.
- **Write-lock recovery.** The project write lock and its recovery guard are published complete in one atomic step, so a process paused while recovering a dead lock can no longer remove the lock of a writer that started meanwhile.

### Performance

- **Faster server start.** The server answers its first request before the project is loaded and waits for the project only where a request needs it; the SQLite index is reused when the files are unchanged, and Node's compile cache is enabled. In measurements the first response came 21–58% sooner and a cold catalog 37–41% sooner.
- **Faster MCP handshake.** `deckmate mcp` answers `initialize`, `tools/list` and `ping` without opening the project, about five times faster; the project opens on the first tool call.
- **Faster catalog reads.** Cards are parsed in one pass with bounded reads and a content-verified parse cache; a cold read of 10,000 cards dropped from 18 to 11.5 seconds with identical results.
- **Smaller first load.** Heavy screens and editors load on demand while the previous screen stays visible; the initial JavaScript is 16% smaller and the initial CSS 22% smaller.
- **Faster checks.** Browser tests reuse one browser per run with a disposable context per page, `npm run test:fast` overlaps unit tests with three browser shards on one fixture build, and CI balances its browser shards by measured time and caches Rust build output; the full local suite now finishes in minutes instead of most of an hour.
- **Immediate desktop window.** The desktop window appears at once; when the last project opens automatically, a startup screen shows while the bundled server starts in parallel.

### Interface

- **Questions panel and decisions to apply.** Questions are excluded from reading text: the open card's rail has a Questions tab with a count, and a Task awaiting an answer shows a note that opens it. **Answer** records the decision; the question-link action copies its link, and decisions show their to-apply/applied state. Card tiles also show open-question counts; the main menu's To apply item and its trigger show the pending-decision pool and count.
- **Doc word counts.** Doc tiles, the open card, Hand and Vision show a localized word count of the readable Markdown, so document sizes are comparable at a glance.
- **Card details.** Agent activity has an avatar, and the new Sub Card form has a material band.
- **Board details.** Deck tiles count tasks in review separately from open cards; the sidebar has a focus ring, and family rows show the tag icon.
- **Server-status capsule.** The server-status capsule shows connection and save states without shifting the header.
- **Keyboard hints.** Shortcut labels adapt to the platform and expose readable key names to assistive technology across the board and the editor.
- **Screen polish.** Touch targets no longer overlap in Manual zones, the Table and Focus Mode; Hand and Timeline show dates and remaining effort again, and the Hand queue and Milestone hints stay on screen; Sub Card rows, mobile menus, long document paths, CSV import and keyboard focus in Journey and the start screen were tidied.
- **Question drafts.** A typed answer or question survives a click outside the panel, and an answer is never saved to a different question after the card changes on disk.

### Desktop shell

- **MCP without a separate runtime.** `Deckmate.exe mcp` runs the bundled Node.js runtime, so Windows clients need no separate install; pass the executable's path in the client configuration.
- **Update coordination.** Before an in-app update, Desktop warns about active Desktop MCP sessions and starts no new ones during installation; continuing can interrupt them. Direct Node sessions and a manual portable replacement are not covered.
- **Process cleanup.** Windows starts the server, the project initializer and the Desktop MCP child inside a Job Object before execution, so their process trees close with the shell.

### Documentation

- **MCP guide.** docs/mcp.md describes the `deckmate mcp` server for MCP clients: connecting through `skills install` or a manual launch line (including `Deckmate.exe mcp` and `--check`), how the project and the acting member are found, the eleven tools with their parameters and response shapes, rev guards, retry-safe creation, error `next` steps, response limits, and the matching `deckmate project` commands.
- **Board and data guides.** The catalog contract describes the question and decision format with its write actions, the API reference lists those actions and the CLI question commands, the UI map and design notes cover the Questions panel and the to-apply pool, and the README screenshots are refreshed.

## [0.7.1] - 2026-11-11

### Agents

- **Board rules in the project.** `deckmate skills install` adds a marked block to the project's `AGENTS.md`: the commands for taking and handing in a card, one way to create cards through the running board with a ready request, and when to open the skill. Text outside the markers is never touched; a repeated install rewrites only its own block, and `skills status` reports its state.
- **One way to create cards.** The skill no longer suggests writing card files by hand: cards are created and changed through the running board, and the rules say what to do when no board answers.

### Desktop

- **Documented port.** Desktop serves the open project on port 4317 first, its last port second and any free port last, so an agent or script that follows the documentation finds the board. A shell that used another port moves once; the theme, panel width and acting member kept in the board's browser storage start afresh.

## [0.7.0] - 2026-11-11

### Interface

- **Card tiles.** The row of small icons in the tile body is gone. The bottom band keeps one height on every tile — 24 px for a Task, 29 px for a Hero with its step strip — and the owner's medallion no longer grows it: Effort sits on the left as a kettlebell mark with a bold number (a Hero counts its Sub Cards), Priority on the right as chevrons by level, now on Hero too, and a click on either opens Quick Settings at its own tab. The face names no workflow state — the band and the accessible name do; only blockers and a Doc's open questions keep a quiet line, dates stay in the open card and the Overdue word in the tile's accessible name — and a Hand slot keeps its fan of three cards with the slot number. A started Task turns its band to steel blue and a Task in review to amethyst — on the tile, in Hand, in Vision and on the open card; on the tile the review band also wears a holographic foil of small eyes that lights up under the pointer — a Doc's text fades out instead of being cut, people wear initials in their avatar, and the small selection checkbox appears on hover, dimmed on the other tiles while a selection runs. A Sub Card still carries its Hero's name on a gold strip; glare, the holographic finish of an accepted Hero and the done medallion are unchanged.
- **Open cards.** The card id chip answers "Copied", and Journey and Edit sit in one row with it beside the text. The material band shows Effort, the owner and Priority — Sub Card progress for a Hero, the word count for a Doc — and a Hero's header carries its Sub Cards chip. The Hand button names who holds the card and in which slot: a click opens that Hand, Ctrl+click or H adds the card to your Hand or removes it. The Connections section is gone: tags lie on the card as they are, and their editing — together with Run, Milestone, the due date and Hand slots — lives in Properties, while dependencies and links to the card keep their panels. Open questions appear once as a quiet list, and on narrow screens the card and editor take priority over the deck shelf.
- **Hero and Sub Cards panel.** The Hero and its Sub Cards use one row design with the material stripe on the left and state, blockers and due dates on the right; the rows now carry their tags, and a Sub Card bound by a Journey no longer shows an inactive detach button. Search and list actions sit beside the heading.
- **Tags.** One marker travels with a tag: its emoji or icon stands before the card title, its colors share a single dot beside the tile face with a tooltip naming every tag, and the "+N" chip opens the remaining tags as a menu. Properties pick tags from one search — selected names first, each with its card count — and Configure tags edits the look. Search suggests tags as you type and lifts the ones that matched; the deck tags panel pairs Show with Select, keeps the All/Any modes and per-tag counters, adds a reset and lists the pick among the deck's removable filters; the tag order in Ordering is named "By first tag"; and deck automation picks its auto-tag from the same list, or takes a new name, with the draft kept when the window closes.
- **Light theme.** Softer tinted backgrounds, clearer text and more consistent panels and fields make the board easier to read.
- **Hover feedback.** Moving quickly between buttons, tabs and action rails no longer leaves flashing or lingering highlights; controls keep their size.
- **Notifications.** A bell opens notifications on demand, with a member selector and a scrollable list, instead of stacks permanently covering the board.
- **Quick capture.** New Tasks go to the configured Inbox regardless of the deck's name. If none is assigned, choose an existing Task or Mixed deck in the capture form.
- **Hand.** Section tabs sit above the cards. The Done pile expands into a list and shows the current week's count and effort; cards can be removed from focus slots or the reserve directly.
- **Timeline.** A compact header and expandable details and statistics leave more room for cards; the calendar opens from the local toolbar.
- **Vision.** Explicit 100% and fit-selection controls make navigation clearer, and the canvas follows the interface language when first opened and reopened.
- **Shared marks.** The kettlebell of Effort and the chevrons of Priority are one pair on every screen — tiles, the open card, the new-card form, Hand, search, Vision, Quick Settings and bulk actions — and the divider that widens the card column keeps its place beside the panel while the deck scrolls.

### People and agents

- **Agent queue.** `project next` selects only executable Tasks from the member's Hand, skipping review, accepted, cancelled, blocked and stale work as well as Hero and Doc cards. It returns `card: null` when none qualify.
- **Independent acceptance.** The server rejects a known agent accepting its own card or work it previously reported. An independent reviewer can accept another member's work; people can still accept their own cards, subject to the deck's Guardian rules.
- **Questions.** `project ask` returns warnings even on an unchanged retry: a question does not automatically block the source Task. Without a rule Doc, a supported native card keeps the question in its own text, with an explicit warning that no Decision Task was created and that `--to`, if supplied, was not used.

### Agent skill

- **Cases first.** The skill routes from a situation to one short scenario: starting a project for a genre and engine, cutting a feature into cards, planning a milestone and Run, taking a card through work and review, asking a blocking question, keeping a design document in cards, running a Journey, and handling playtest feedback and bugs.
- **One reference per fact.** `references/cli.md` lists every `deckmate project` command with its output fields and errors, `references/cards.md` describes Task, Hero and Doc files, and `references/api.md` keeps only what the CLI cannot do.
- **Genres and engines.** Each genre names a first playable and the cheapest test for it; each engine explains how to verify a card before review.
- **Checked structure.** A test keeps links, anchors and command names in the skill in step with the CLI.

### Data reliability

- **Text edits.** Editing legacy cards handles CR-only files and preserves BOM and untouched line endings, including unchanged prefixes and suffixes in mixed-line-ending bodies. Title-only edits in the card editor also keep leading body blank lines and original CRLF line endings.
- **Recorded decisions.** Question links and answers preserve surrounding text in files with BOM, CR or mixed line endings; report headings remain boundaries of question sections.
- **Run carry-over.** Cancelled Tasks (`wont-do`) stay out of the next Run when finishing manually or advancing a schedule; they are not marked accepted.

### Windows desktop

- **File drops.** Files dragged from Windows reach the board's file-drop controls again.
- **Links.** HTTP(S) links that request a new window open in the browser, including local document and card-reference links.
- **Window recovery.** Restoring the window checks that its title bar is on a connected monitor, so an off-screen title bar no longer leaves the window out of reach.

### Cleanup

- **Launch scripts.** Removed the old PowerShell/VBS launch and shortcut-installation scripts; Desktop and the `deckmate` CLI remain the entry points.
- **Release checks.** Browser tests run on Windows with Edge, the engine of the desktop app, and a fixture gets a longer first load on slow runners; unit tests still run on Ubuntu and Windows.

## [0.6.0] - 2026-11-10

### Added

- **Deckmate Desktop.** The Windows app now uses Tauri 2; its installer is about 32 MB instead of 121 MB. The installer automatically removes the old Electron installation while keeping `%APPDATA%\Deckmate`, including settings, recent projects and language.
- **Updates.** Installed Desktop downloads updates in the background and verifies their update signature; you can install later or skip a version. The portable build only notifies you and offers the download page.
- **What's new.** A window shows the changes after an update; you can also open it from Help.
- **Workspace.** Pin, remove and reorder projects on the start screen or in the board's side panel; Ctrl+1–9 opens the first nine. The side panel shows shortcut labels and project initials; Ctrl+Shift+P opens the start screen.
- **Deck covers.** Six new covers: Characters, Levels, Story, Agents, Releases and Ideas.
- **Unsaved work.** Desktop warns before closing, switching projects or installing an update if you have unsaved changes. Windows shows why Deckmate is blocking shutdown so you can cancel it and save.
- **Third-party licenses.** Desktop includes licenses for Node.js, Rust dependencies and WebView2 in `THIRD-PARTY-NOTICES.txt` next to the app.
- **Spaces.** Delete a space with no decks from its header.

### Changed

- **Start screen.** Navigate project lists with the keyboard; workspace projects no longer repeat under Recent. The start screen, menus and dialogs use clearer wording, including that Create project makes a sample project.
- **Refreshed look.** Controls, chips, tabs and panels have sharper, flatter shapes instead of pill shapes; the server status badge remains a capsule.
- **Card proportions.** On larger screens, the open-card column is wider and fills the available height, with larger reading text; covers on the open-deck shelf are larger.
- **Card state row.** Four buttons (`▷ [!] [?] ✓`) use their fill to show work, blockers, review and acceptance without a separate state label; `[!]` opens dependencies. `[?]` submits for review or, in Review, offers Accept review and Request changes; requesting changes requires a reason and returns the card to Not started.
- **Card sections.** Properties, Sub Cards, Dependencies, Attachments and History open in a column beside the card's icon rail, over the deck.
- **Card filters.** In All cards and open decks, one row shows the count, removable filters and Clear all. The In progress and In review figures in the project pulse open filtered All cards; Back and Forward restore the view.
- **Smoother board.** Opening and closing decks and cards, moving between cards and hovering tiles do much less work per frame, and these transitions no longer shift the layout. The deck gallery has refreshed hover and focus feedback and a cleaner opening transition; Hand reordering is steadier, and opening or closing a deck no longer shows an unwanted tooltip or focus ring.
- **Installer.** The installer and the Windows app list show the publisher, homepage and license. Deleting app data when you uninstall now also removes `%APPDATA%\Deckmate`. The bundled server is smaller.
- **Agent skill.** The `/deckmate` skill's commands, states and references match the CLI, and the HTTP actions it relies on ship inside the skill, so agents no longer need files from the Deckmate repository. Its project profile also supports software, and the documentation walks through an agent's work from picking a card to review.
- **Release checks.** Releases are prepared as drafts, the update signature is checked before publication, and the update manifest is uploaded last. `npm run desktop:updater-e2e` checks updates end to end, and screenshot capture has timeouts. CI runs browser tests in three parallel shards on Ubuntu and Windows, and a release tag publishes only a commit with green CI instead of running the tests again.
- **Dependency blocking.** Only an existing, active, unfinished prerequisite blocks a card; archived, deleted and missing prerequisites do not. The board, agent briefs and activity history use the same rule.
- **CLI options.** Commands now reject options that do not apply to them and suggest the available options. `--help` works across commands and subcommands; each `project` command has an example.
- **Skill installation.** `deckmate skills install` now refuses to replace locally changed or added files without `--force`; move your changes out first if you want to keep them.
- **README links.** Documentation links and images work from the npm package page.

### Fixed

- **Long paths.** Projects in Windows folders with paths longer than 260 characters can be opened and created.
- **Page recovery.** A page that keeps crashing no longer reloads endlessly: choose Reload or Start screen. A page that stops responding offers Reload or Wait.
- **Board preferences.** Saved card drafts and board preferences remain available after a restart or project switch when the saved local port is free.
- **Desktop settings.** A setting that could not be saved no longer looks applied, and a damaged `desktop.json` is kept as a dated copy before the defaults are used.
- **Drive roots.** A project at the root of a drive is named after the drive instead of showing an empty name.
- **Agent briefs.** Answers recorded under an English `## Decided` heading now appear in `deckmate project brief`.
- **Attachments.** A failed check after publishing the attachment registry no longer deletes the uploaded file. The attachments panel refreshes when another tab or agent changes attachments.
- **Partial saves.** A conflict after an earlier save step now warns that some changes were saved instead of reporting a simple failure; internal conflict codes are hidden.
- **Card state retries.** Repeating a state change completes unfinished Owner, Hand and acceptance-date steps; repeating start does not move a card already in Hand.
- **Review feedback.** Return reasons are recorded even for cards without a deck, and `deckmate project brief` shows agents the latest recorded return feedback.
- **Review shortcuts.** Space and W open review choices rather than accidentally accepting a card in Review.
- **Card refresh.** Ordinary card switches no longer flash a loading label, and short Quick Settings saves no longer flash the card's controls.
- **Manifest writes.** The manifest uses the same guarded writer as cards. Deck, space and Track forms detect changes made since opening and keep the entered values on conflict.
- **Dependencies.** The dependency graph is reread before saving, so a cycle introduced during the request is rejected.
- **CSV import.** Tags are saved in batches, and a repeated import completes missing tags on matching cards.
- **Journey saves.** An operation journal lets a later write targeting the Journey resume an interrupted save. A conflicting external edit names the file; the API can abandon the unfinished operation without rolling back files.
- **Tabs and Vision.** Switching tabs keeps the selected deck, search and Ordering; clicking the active tab no longer closes the deck. Vision refreshes card references and selection properties after edits.
- **Interface text.** Connection errors follow the interface language, Hand keeps its name in Russian, and card tiles no longer show a native title tooltip on hover.
- **Steadier layout.** Rapid filtering no longer duplicates cards; table rows stay together, Quick Settings menus no longer jump or clip, and save-status labels no longer overlap.
- **First load.** The light theme no longer flashes before the saved theme, and the header no longer shifts on first load.
- **Desktop shortcuts.** Menu shortcuts work with focus in the page: Ctrl+Shift+P, Ctrl+O, Ctrl+1–9, Ctrl+R, Ctrl+Q and F11.
- **Desktop reliability.** Update cleanup leaves unrelated folders alone; a stuck project creation times out and can be cancelled by quitting; if the server port is taken, Desktop retries on another port.

### Removed

- Removed: deck piles; all decks are shown on the Decks home screen; existing `piled` keys are ignored.

## [0.5.0] - 2026-11-09

### Added

- **Spaces.** Reorder spaces with Move up and Move down in the space header or the Position field in space settings.
- **Hero done by hand.** A Hero without Task Sub Cards can be marked done and unmarked; with Task Sub Cards it is done once they are all accepted, and the server rejects a manual mark.

### Changed

- **Doc Cards.** A Doc tile reads as a page: copper band with the notebook icon and word count, a chapter mark and the start of the text on its face; the open Doc card uses the same copper.
- **Decks.** Hero Cards come first when a deck is grouped by priority or state.
- **Accepted Hero.** The band keeps the working Hero's gold metal and ribbon; the holographic finish stays on the face and rim.

### Fixed

- The Hero strip on Sub Card tiles starts level with the card title.
- The open editor no longer jumps while a card is dragged between lanes.
- Browser tests wait up to 45 s for headless Chrome on CI instead of about 10 s.

## [0.4.0] - 2026-11-09

### Added

- **Templates in Russian.** Bundled Journey and project templates carry Russian titles and descriptions (`locales.ru` in the template header); the pickers show them in the Russian interface, and importing into a Russian-format project names the Journey in Russian.
- **Accepted Hero foil.** An accepted Hero tile carries a holographic foil and an iridescent rim that follow the pointer; with reduced motion or touch it stays still.
- **Attachments.** Deleting an attachment that is inserted in the card text offers to remove its links as well.
- **Task to Hero.** Dropping a top-level Task without Sub Cards into an Asset deck asks whether to make it a Hero; the server's `promote-parent` accepts an empty Sub Card list for this.

### Changed

- **Decks home.** The document and card counts moved from a footer under the decks to a quiet line under the project name; source warnings open from that line.
- **Hero family.** Doc Sub Cards show in the Hero's family; progress and the finished family count Task Sub Cards only. The Sub Cards panel counts and marks Sub Cards without a deck.
- **Cards.** Tiles tilt up to 8°. A Hero tile's Sub Card progress is a quiet line whose steps are sized by each Sub Card's effort.

### Fixed

- The open Hero card's band again uses the Hero gold for its owner medallion and labels, and an accepted Hero band its accepted metal (regressed in 0.3.0).
- An image in card text whose file is gone shows a "file not found" chip instead of a broken image; pasted images use the same link format as the insert menu.
- Native select lists are readable in the dark theme, and the Sub Card composer's deck picker shows one focus frame.
- `npm run dev` proxies only `/api/` and `/r/` to the server, so the dev board loads again.
- Notification state keeps a member whose id is `constructor` in the file instead of on `Object.prototype`; Journey templates are read only inside the project folder.
- Steadier browser tests on CI (reduced motion on Windows runners, toast animation timing) and test helpers that pass data as arguments instead of building code strings.

## [0.3.0] - 2026-11-09

### Added

- **Desktop projects.** Switch directly to another recent project from the board's project menu.
- **Development.** `npm run dev` runs the watched server and Vite with hot reload.
- **Attachments.** Insert an attachment into card text from the editor, or copy its Markdown link from the attachments panel.

### Changed

- **Inbox and Sub Cards.** A Task or Mixed deck can be designated as Inbox for compatible cards created without a chosen deck; otherwise cards remain Unassigned. Sub Cards can belong to working decks independently of their Hero.
- **Journeys.** Hero cards show compact step mini-cards and a Journey menu; opening a step shows its Sub Card in the Sub Cards tab, with Esc returning to the Hero. The Sub Card displays a step note.
- **Cards and materials.** Open-card properties offer quick settings and clickable tag chips; the card number moves to the footer. Metallic cards gain cursor lighting and tilt.
- **Card attachments.** Card covers were removed; legacy cover entries remain preserved. Deck and planning covers are unaffected.

### Fixed

- Improved narrow layouts, contrast, focus and scrolling, and refined Russian interface wording; added tests for these flows and accessibility.

## [0.2.0] - 2026-11-08

### Added

- **Deckmate Desktop.** An Electron shell for Windows in `desktop/`: launches from an icon, opens a start screen with Open folder, Create project and recent projects, and reopens the last project on launch. It runs the same local server on a free port inside the app, remembers zoom (Ctrl+wheel, Ctrl+=/−/0) and window size, and has an EN/RU menu. It builds as a portable folder and an unsigned NSIS installer.
- **Clean shutdown.** The server stops cleanly on a `shutdown` message from the desktop shell.

### Changed

- **README.** Leads with the desktop flow (Quick start: Desktop, then CLI) and has a Start screen section with a screenshot.
- **Social preview.** Mentions the desktop app.

## [0.1.0] - 2026-11-07

First public release.

### Added

- **Board over Markdown.** Project files are the source of truth; a rebuildable SQLite index, file watching and block edits that preserve untouched bytes, BOM and line endings. Stale writes are rejected by hash instead of overwriting.
- **Decks and cards.** Spaces, typed decks with covers, Task/Hero/Doc cards, Sub Card families, owners, effort, priority, dependencies, tags, deck summaries, ordering and zones, bulk actions, CSV import and export.
- **Project pulse.** The Decks home screen shows work in progress, the review queue, accepted tasks over 14 days, current Run progress and cards without a deck, with direct links to the relevant views.
- **Manual deck piles.** Keep active decks on the shelf and move others into a pile within their space. Search by deck name also finds piled decks.
- **Planning.** Per-member Hands with seven focus slots, an ordered reserve and a weekly done pile; Runs and Milestones on a Timeline with carry-over, burndown and velocity; Quick Settings for owner, Run, Milestone, effort and priority.
- **Journeys.** Reusable step templates with instructions for people or agents, dependencies, lessons and metrics; 42 built-in templates, from bug fixes and playtests to genre-specific production.
- **Starter templates.** Starters for games (Action, Adventure, Platformer, Puzzle, Roguelike, RPG, Simulation, Sports, Strategy and Survival) and software (pet projects, web apps and libraries) on the Games and Software shelves of **Start from template**, with decks, Journeys and optional example Heroes.
- **Vision.** Excalidraw boards with live card and progress nodes, images, attachments and Markdown document previews.
- **Search and flow.** Global search with filters, keyboard shortcuts for every common action, activity history, watching and due-date notifications.
- **Agents.** `deckmate project` gives compact JSON for the next card, a card brief, questions and reports without a running server; the `/deckmate` skill in the open Agent Skills format installs with `deckmate skills install`; `deckmate agents run` prepares assignments for configured launchers.
- **Two languages.** The interface is English with Russian in the app menu; the file format reads English and Russian words and writes the project's own.
- **Install and run.** `npx deckmate` with `init` for a demo studio, `--data`, `--port`, `--read-only` and `--no-open`; a Docker image; CI on Ubuntu and Windows; release automation for GitHub Releases, GHCR and npm.
- **Docker runtime.** The image uses Node 26 on Debian Bookworm Slim and includes a `HEALTHCHECK`.
- **Genre guides.** The `/deckmate` skill adds guides for action, adventure, puzzle, roguelike, simulation, sports, strategy and survival.
- **Support guide.** [SUPPORT.md](SUPPORT.md) routes questions, bug reports and vulnerability disclosures.

### Changed

- **Deck covers.** Compact 132×180 covers with saved image cropping, task progress, soft hover lighting and a distinct current-deck contour; mouse and keyboard reordering share the shelf.
- **Documentation.** English and Russian READMEs describe the current Decks screen and use refreshed screenshots captured from a real demo project. Security and API documentation describe the default loopback binding and Docker's host-loopback port mapping accurately. Local project data and release-working notes are excluded from Git staging and Docker build context; asset origins and CLA storage setup are documented.
- **Security hardening.** The server accepts IPv6 loopback `[::1]` in the `Host` header, and unexpected 500 responses use generic error text instead of raw internal messages.
- **CodeQL.** Static analysis now covers Python alongside JavaScript and TypeScript.
- **Social preview.** Text stays readable at chat-thumbnail size and shows one complete row of real demo cards; screenshot capture records the client build hash and checks the preview upload-size limit.
- **Demo studio.** The sample Run belongs to a recurring schedule, and initial task transitions are recorded in the activity journal so the project pulse shows its current Run, acceptances and review age.

### Fixed

- Opening a Run from Hand or the project pulse selects that Run on the Timeline.
- Saving a Journey template uses the shared guarded writer and rejects symlink/junction ancestors, including a directory replaced before publication.
- Empty-deck guidance aligns with the first action-rail button, including narrow layouts.
- Source Sans 3's license notice includes the Adobe copyright embedded in the shipped fonts.
- The initial HTML language matches the default English interface.
- Browser capture sends the native Enter activation event, so keyboard navigation can be verified reliably.
- CI normalizes Windows temporary-directory aliases, waits for the WebSocket client's close event during shutdown tests, and grants CodeQL access to workflow-run metadata.
- The app refuses to be framed by other sites (`frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`), so a hostile page cannot steer clicks in the local interface.
- The catalog scan no longer follows a linked `docs`, `features` or `tasks` folder out of the project, warns about the skipped folder and reads every Markdown file through the guarded reader.
- Agent launchers are argument lists (`run: [executable, ...args]`) started without a shell, so a folder name cannot run shell commands. On Windows, npm `.cmd` shims start through `cmd.exe` with quoted arguments, and values containing `%`, `!`, `"` or line breaks are refused for them; a bare executable is looked up in `PATH` only; a shell string needs an explicit `shell: true` and receives the paths in `DECKMATE_PROMPT` and `DECKMATE_CWD`.
- Manifest writes patch only the changed values and keep comments and hand-written YAML; a stale Journey step removal or card import fails before writing anything.
- A WebSocket upgrade with an unparsable URL no longer crashes the server, and filesystem errors no longer put absolute paths into API replies.
- `deckmate agents run` refuses to overwrite an edited assignment in the same `--out` folder, and `rebuild-board.py` keeps the BOM and CRLF line endings of the files it rewrites.
- Card history keeps loaded pages and the scroll position across refreshes, and pasting several images keeps every link.
- The Russian interface no longer shows leftover English labels in card screens, the Sub Card composer or screen-reader labels.
- Status colors and Journey buttons reach 4.5:1 contrast in both themes, and the deck table fits phone widths without horizontal scrolling.
- Third-party notices: `dist/client/third-party-licenses.md` now carries full license texts for bundled packages that ship no license file and for code embedded in prebuilt packages (Chevrotain, Langium, the vscode-languageserver libraries and lodash-es inside `@mermaid-js/parser`, js-yaml inside `mermaid`); the build fails on an empty section or on undeclared embedded code.
- Source-checkout instructions also open the demo, and the `/deckmate` analyze and audit workflows move new cards to `discussing` after creating them.

[Unreleased]: https://github.com/pierkulakov/deckmate/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/pierkulakov/deckmate/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/pierkulakov/deckmate/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/pierkulakov/deckmate/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/pierkulakov/deckmate/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/pierkulakov/deckmate/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/pierkulakov/deckmate/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/pierkulakov/deckmate/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/pierkulakov/deckmate/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pierkulakov/deckmate/releases/tag/v0.1.0
