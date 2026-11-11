<p align="center">
  <a id="deckmate" href="https://github.com/pierkulakov/deckmate/releases/latest">
    <img src="https://raw.githubusercontent.com/pierkulakov/deckmate/main/docs/social-preview.png" width="1012" alt="Deckmate — you hold all the cards. A glowing hand of real cards; people and AI agents share Markdown files. Native Windows app on Tauri 2 with Node.js included; npx deckmate for agents and terminals." />
  </a>
</p>

<h3 align="center" id="you-hold-all-the-cards">You hold all the cards.</h3>

<p align="center">
  <b>A local project board for people and AI agents.</b><br />
  Your cards are Markdown files in your repository. Work in the app; your agents work on the same files.
</p>

<p align="center">
  <a href="https://github.com/pierkulakov/deckmate/releases/latest"><b>Download for Windows →</b></a>
  &nbsp; · &nbsp;
  <a href="#cli"><code>npx deckmate</code></a> for agents &amp; terminals
</p>

<p align="center">
  Open a project folder, create a new one, or pick up a recent project.<br />
  <sub>Lightweight native app · Tauri 2 · Node.js included · No terminal needed</sub>
</p>

<p align="center">
  <a href="https://github.com/pierkulakov/deckmate/releases/latest"><img src="https://img.shields.io/github/v/release/pierkulakov/deckmate?style=flat&amp;label=release&amp;color=9258e5&amp;labelColor=27242f" alt="Latest release" /></a>
  <a href="https://github.com/pierkulakov/deckmate/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/pierkulakov/deckmate/ci.yml?branch=main&amp;style=flat&amp;label=CI&amp;labelColor=27242f" alt="CI status" /></a>
  <a href="https://github.com/pierkulakov/deckmate/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-9258e5?style=flat&amp;labelColor=27242f" alt="License: AGPL-3.0-only" /></a>
</p>

<p align="center"><sub>0.7.0 · Early release · macOS planned · Project file format (schema 1) may change before 1.0.</sub></p>

<p align="center">
  <a href="#quick-start">Quick start</a> · <a href="#use-it-with-your-project">Your project</a> · <a href="#how-it-works">Concepts</a> · <a href="#decks-inbox-and-sub-cards">Decks and Inbox</a> · <a href="#working-with-ai-agents">Agents</a> · <a href="#faq">FAQ</a>
</p>

<p align="center"><b>English</b> · <a href="README.ru.md">Русский</a></p>

## Quick start

### Desktop

Deckmate Desktop is a lightweight Tauri 2 app for Windows 10 and 11 (x64); macOS support is planned. Download the installer (`Deckmate.Setup.<version>.exe`) or portable zip (`Deckmate-<version>-win-x64.zip`) from the [latest release](https://github.com/pierkulakov/deckmate/releases/latest). The builds are not Windows code-signed, so SmartScreen may warn about an unknown publisher: choose **More info → Run anyway**.

Run the installer and launch Deckmate from its icon, or unzip the portable build and start `Deckmate.exe`. The app includes Node.js 26 for its local server; no terminal is needed. Open a project folder or choose **Create project…** to fill an empty folder with a sample project.

The interface uses [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/), included with Windows 11 but not necessarily Windows 10. The portable build requires it to be installed already; the installer installs it if missing, which needs internet access. The zip contains `Deckmate.exe`, `node.exe`, `deckmate/` and `THIRD-PARTY-NOTICES.txt`.

When upgrading from Electron (0.5.0 and earlier), the installer removes the old app and leaves `%APPDATA%\Deckmate` and project folders untouched. Recent projects, language, zoom and window position carry over.

### Desktop updates

Desktop checks for updates automatically by default; use **Help → Check for updates…** to check manually or turn automatic checks off in the same menu. The installed app downloads updates and verifies their updater signature and version, then offers to restart and install them. This signature is separate from Windows code signing. You can defer or skip a version.

The portable build only notifies you and offers to open the download page; download and replace it yourself. After an in-app update, **What's new** opens with the changes since the previous version. You can also open it from **Help → What's new**.

### CLI

The CLI works independently of Desktop, for agents and anyone who prefers a terminal. Install [Node.js](https://nodejs.org) 26 or newer (Deckmate is developed and tested on Node 26, the current release line; older versions are not tested), then create the sample project and open it:

```sh
npx deckmate init deckmate-demo
npx deckmate --data deckmate-demo
```

To run from source instead, follow [CONTRIBUTING.md](https://github.com/pierkulakov/deckmate/blob/main/CONTRIBUTING.md): `npm ci && npm run build`, then `node bin/deckmate.mjs init deckmate-demo` creates the demo and `node bin/deckmate.mjs --data deckmate-demo` opens it.

### Ask your agent

Paste this into a coding agent opened in your project folder; it sets Deckmate up for you:

```text
Set up Deckmate (https://github.com/pierkulakov/deckmate) in this folder.
1. Check that `node --version` is 26 or newer; if not, stop and tell me.
2. Start the board with `npx deckmate --no-open` in the background and give me its local URL.
   Keep my existing Markdown files as they are.
3. If the project has no decks yet, ask me what I am making before you create anything.
4. Once there is a deck or a member, run `npx deckmate skills install`.
5. Show me `npx deckmate project --help` and say in two lines how you will pick up cards.
Do not commit, delete or move any file without asking me.
```

The board opens at `http://127.0.0.1:4317/`. The sample is a small fictional game studio: five decks, two Heroes with Sub Cards, people and agents, a Journey, a Run and a Vision board. The browser interface defaults to English; switch to Russian in the app menu. Stop the server with `Ctrl+C`.

## Start screen

![Deckmate Desktop start screen: open a folder, create a project, recent projects](https://raw.githubusercontent.com/pierkulakov/deckmate/main/docs/screenshots/desktop-start.png)

Without a project, choose **Open folder…** to select a folder, or **Create project…** to put the sample in an empty or new folder. Recent projects show their last-opened time and can be removed from the list; language (EN/RU) and theme controls are also available. Desktop initially follows the system locale for English or Russian.

Pin up to 30 projects to **Workspace** from the start screen or the board's project menu. Reorder or remove them without deleting their folders; switch with a click or `Ctrl+1`–`Ctrl+9` for the first nine. Projects are not pinned merely by opening them.

The last local project opens on the next launch if its folder is available; network folders are not reopened automatically. Use **File → Switch project…** (`Ctrl+Shift+P`) to return to the start screen, or `Ctrl+O` to open another folder. Desktop runs the local server on `127.0.0.1`, on port 4317 — the same address the CLI uses, so an agent or script finds the open project's board at `http://127.0.0.1:4317/`. If that port is busy, Desktop reuses its last port or chooses a free one. Project data remains in the project folder.

Settings — workspace, recent projects, language, updates, zoom and window position — live in `%APPDATA%\Deckmate\desktop.json`; the server log is `server.log` next to it, and the disposable index is in `%APPDATA%\Deckmate\index`.

## Use it with your project

**An existing folder.** In Desktop, open the folder from the start screen. With the CLI, run Deckmate from the folder you want to manage; Markdown files you already have stay as they are, and new cards go into `cards/`:

```sh
cd my-project
npx deckmate
```

**A new project.** To start with an empty project in Desktop, choose **Open folder…** and select an empty folder. With the CLI, create an empty folder and open it: `mkdir my-game`, then `npx deckmate --data my-game`. On the Decks tab choose **Start from template** (or click the logo in the top-left corner → **Start from template…**). Starters come for games and for software, on the **Games** and **Software** shelves: ten game genres — Action, Adventure, Platformer, Puzzle, Roguelike, RPG, Simulation, Sports, Strategy and Survival — plus software starters such as pet projects, web apps and libraries. A starter creates decks and Journeys for its kind of project, optionally with example cards.

Built-in project and Journey templates show Russian titles and descriptions in the Russian interface. Importing a Journey into a Russian-format project also gives it a Russian name.

Edits are saved straight into the project folder. Commit with git to keep a history; Deckmate never commits for you. With the CLI, add `--read-only` to look without changing anything.

| Option | What it does |
|---|---|
| `--data <folder>` | Project folder; defaults to `DECKMATE_DATA`, then the current folder. |
| `--port <number>` | Port; defaults to `DECKMATE_PORT`, then 4317. |
| `--read-only` | Disable writes to project files. |
| `--no-open` | Do not open the browser. |

These CLI settings can also live in `.env.local` in the folder you start from — see [.env.example](.env.example).

## How it works

| Concept | Meaning |
|---|---|
| **Deck** | A typed collection of cards — tasks, documents or assets — grouped into spaces. |
| **Card** | A native card is a Markdown file in `cards/`; existing project documents can also appear as cards. A **Task** has a state, owner, effort and priority; a **Doc** holds rules and reference text. |
| **Hero** | A feature card. Its **Sub Cards** are the tasks that build it, and its progress comes from them. |
| **Hand** | A teammate's queue: seven focus slots, an ordered reserve and a pile of accepted cards with weekly counts. |
| **Run** and **Milestone** | A dated iteration and a dated goal on the Timeline. Selected groups of unfinished Tasks carry into the next Run; cancelled Tasks stay behind. |
| **Journey** | A repeatable recipe of steps, such as concept → model → review. Applying it creates Sub Cards, each with its own instructions for a person or an agent. |
| **Track** | A thread that links cards across decks, such as a release or a feature area. |
| **Vision** | An Excalidraw canvas with live links to cards. |

Start on **Decks**: document and card counts sit under the project name; source warnings open from the same line. Jump from the project pulse to work in progress, reviews, the current Run or cards that need a deck. Compact covers count open cards, Tasks in review and accepted Tasks. Arrange decks with the mouse or keyboard. Reorder spaces from their header menus or the Position field in space settings. Search deck names to find a deck even inside a collapsed space.

Open a deck to work with its cards, description, progress and activity:

![An open deck with gold Hero bands, blue started and green accepted Task bands, owner medallions, effort, priority and tag dots](https://raw.githubusercontent.com/pierkulakov/deckmate/main/docs/screenshots/deck.png)

Task tiles keep a matte face: a started Task turns its band to blue steel, a Task in review to amethyst and an accepted Task to green, while only blockers and a Doc's open questions keep a quiet line on the face. The bottom band holds effort beside a weight icon, priority chevrons and the owner's medallion at the seam; people have initials and agents have an agent mark. A colored dot indicates tags, and a fan marks Hand membership. A Hero's gold band shows Sub Card progress as a quiet line, with each step sized by its effort; it is complete when all eligible Task Sub Cards are accepted (`wont-do` tasks are excluded). A completed Sub Card family gives its Hero a check medallion and a continuous progress line. Doc Sub Cards appear in the Hero's family too, but only Task Sub Cards count towards its progress; the Sub Cards panel flags those without a deck. Drop a Task that has no Sub Cards into an Asset deck and Deckmate offers to make it a Hero. A native Hero without eligible Task Sub Cards can be marked done by hand from its Sub Cards bar. Doc Cards read as pages, with a copper band and the start of the text on the tile.

![A completed Hero with a check medallion and continuous progress line for its accepted Task Sub Cards](https://raw.githubusercontent.com/pierkulakov/deckmate/main/docs/screenshots/deck-accepted.png)

Press `?` in the app for keyboard shortcuts: `/` searches, `Shift+1`–`Shift+4` switch between Hand, Decks, Timeline and Vision, and `N` creates a card in a card list. Hover a card and press `O`, `E`, `P` or `,` to open quick settings for its owner, effort, priority or Run.

An open card keeps reading and editing in the main sheet, with tags above the card ID and bottom action row. Use **Properties** to edit tags and other settings, and the side rail to open Sub Cards, attachments, dependencies or history. A Hero shows its Journey as mini-cards; the Journey name opens a menu of steps and assignees. Open a step to see its Sub Card, then press `Esc` to return to the Hero. In the text editor, use the paperclip to insert an attachment, or copy its Markdown link from the attachments panel. Deleting an attachment used in the text offers to remove its links too. An image whose file is missing shows a “file not found” chip. Card covers are not used.

In **Hand**, section tabs sit above the focus slots; the reserve keeps its own order. Expand the Done pile to open accepted cards and see weekly counts and effort. Hand membership is explicit and separate from Owner. The bell opens notifications for the acting member on demand: changes to owned or watched cards and due-date reminders.

<table>
<tr>
<td width="50%" valign="top">
<a href="https://raw.githubusercontent.com/pierkulakov/deckmate/main/docs/screenshots/card.png"><img src="https://raw.githubusercontent.com/pierkulakov/deckmate/main/docs/screenshots/card.png" alt="Build Moonwake Lantern Task with a checklist, production tag, blue band and the Hero's five Sub Cards" width="100%" /></a>
<strong>Cards and Journeys</strong><br />A reading sheet with tags, a Journey step and the Hero's Sub Cards.
</td>
<td width="50%" valign="top">
<a href="https://raw.githubusercontent.com/pierkulakov/deckmate/main/docs/screenshots/timeline.png"><img src="https://raw.githubusercontent.com/pierkulakov/deckmate/main/docs/screenshots/timeline.png" alt="Timeline with the selected First playable Run, its cards and a Milestone marker" width="100%" /></a>
<strong>Runs and Milestones</strong><br />Dates, expandable statistics and configurable carry-over of unfinished Tasks.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<a href="https://raw.githubusercontent.com/pierkulakov/deckmate/main/docs/screenshots/hand.png"><img src="https://raw.githubusercontent.com/pierkulakov/deckmate/main/docs/screenshots/hand.png" alt="A member's Hand with section tabs above seven focus cards, an expanded Done pile and upcoming due dates" width="100%" /></a>
<strong>A Hand for each teammate</strong><br />Seven focus slots, an ordered reserve and an expandable Done pile.
</td>
<td width="50%" valign="top">
<a href="https://raw.githubusercontent.com/pierkulakov/deckmate/main/docs/screenshots/vision.png"><img src="https://raw.githubusercontent.com/pierkulakov/deckmate/main/docs/screenshots/vision.png" alt="Moonwake Vision canvas with creative direction, linked Heroes and Production progress" width="100%" /></a>
<strong>Vision</strong><br />Sketch with live card and progress nodes; use 100% or fit the selection to navigate.
</td>
</tr>
</table>

## Decks, Inbox and Sub Cards

### Deck types

Each deck accepts certain card types:

| Deck type | Cards it accepts |
|---|---|
| Asset | Hero |
| Task | Task |
| Knowledge | Doc |
| Mixed | Hero, Task and Doc |

Use Asset decks for GDD features (Heroes), Task decks for work, and Knowledge decks for reference. Mixed decks can combine them. When moving cards, incompatible decks appear dimmed in the transfer dock.

### Sub Cards

A Sub Card is a Task or Doc linked to a Hero. It usually belongs in a department's working deck, such as Art or Coding, rather than the Hero's Asset deck, so the people doing the work can find it there. The link to the Hero remains across decks.

Open the Hero, choose **New Sub Card**, select a destination under **Create Card in**, enter a title and optional description, and choose **Create**. A Knowledge deck creates a Doc; the other choices create a Task. The initial choice is the current suitable deck if available, then a recently used deck, Inbox, a deck that accepts Tasks, or no deck. A Hero-only Asset deck is not selected.

The automatic option says **Auto: Inbox →** followed by the deck name when Inbox is available, or **No deck (Unassigned)** otherwise. If no suitable deck is available, the Sub Card is still created without a deck.

### Inbox

Inbox is an ordinary deck designated as the receiver, not a separate built-in deck. Open an existing deck's settings and check **Inbox deck**; its cover shows a tray icon. Only Task and Mixed decks can be assigned; the checkbox is disabled for Asset and Knowledge. Changing an Inbox deck to a type that cannot accept Tasks removes its Inbox assignment.

When no deck is selected for a new card, it goes to Inbox only if Inbox accepts its type; otherwise it is created without a deck. The new-card form shows **→ Inbox:** and the deck name, or **→ No deck**. Without an assigned Inbox, cards created without a selected deck are also left without one: find them on the Decks home screen under **Without a deck** and **Sort into decks**.

Starter templates assign Inbox to their first Task deck if none is set; in the demo, Inbox is Production.

The top-bar **+** opens **Quick capture to Inbox** for an idea, bug or finding. It creates a Task in the configured Inbox, whatever that deck is named. If Inbox is missing, choose an existing Task or Mixed deck in the form and set it as Inbox before saving.

### Only an Asset deck?

If you have only an Asset deck, a new Sub Card is created without a deck. For a useful destination, create a Task deck, or designate an existing Task or Mixed deck as Inbox; then move the card into a suitable deck.

## Working with AI agents

An agent reads and edits the same files the board shows. A card looks like this:

```markdown
---
deckmate: card
schema: 1
id: 3c83da5b-a6b4-4b29-9b20-0aace7b274ab
kind: task
title: Tune lantern glow
state: not-started
owner: null
deckId: null
trackIds: []
parentId: null
effort: 2
priority: medium
---
Make the path readable without revealing the whole forest.

- [ ] Check the light at gameplay distance.
- [ ] Ask a teammate to review the result.
```

States are `not-started`, `discussing`, `in-iteration`, `started`, `review` and `done`; `wont-do` marks work decided against. Decks, members and tracks live in `tasks/deckmate.md`; Runs and Milestones in `tasks/deckmate-runs.md` and `tasks/deckmate-milestones.md`; Journeys in `tasks/journeys/`; Vision boards in `boards/`. The file format also has Russian words (`план`, `в работе`, `принято`…): a project writes in the language recorded in its manifest, and Deckmate reads both.

Add people and agents in the logo menu → **Members…**; `<member>` below is a name or ID from there. The `project` command gives an agent compact JSON or Markdown without a running server, so it reads only what the task needs (add `--json` to `brief` for JSON):

```sh
npx deckmate project next <member>        # the next executable Task in a member's Hand
npx deckmate project brief <card-ref>     # the card, its rules and what to read next
npx deckmate project report <card-ref> --file report.md --member <member> --state review
```

`next` follows explicit Hand order and skips Hero and Doc cards, Tasks in review, accepted or cancelled Tasks, open dependencies and stale work. With no eligible Task it returns `card: null`. `ask` returns warnings with its result: saving a question does not automatically block the source Task or remove it from `next`.

Assigning an owner never starts a model. The example submits work for review; a reviewer can then accept it. The server rejects self-acceptance by a known agent that owns the card or authored an earlier report; an independent agent can review another member's work. People are not subject to this self-acceptance restriction. If a deck has Guardians, the accepting member must also be a Guardian. See the [acceptance contract](docs/catalog.md#acceptance-and-agent-reports--2026-11-11) for actor identification and report-specific rules.

Deckmate also ships an agent skill in the open Agent Skills format. Once the project has its first deck or member, `npx deckmate skills install` copies it into the project for Claude Code and other agents; then `/deckmate work <card>`, `/deckmate plan`, `/deckmate review <card>` and other scenarios guide the model through the board. See [docs/skills.md](docs/skills.md), the [data contract](docs/catalog.md) and the [local API](docs/api.md).

Installation also adds or updates the board rules in the project's `AGENTS.md` between `<!-- deckmate:agent-rules:start -->` and `<!-- deckmate:agent-rules:end -->`, preserving all other text.

## FAQ

**Where is my data?** In your project folder: Markdown cards and instructions, the catalog manifest and `.excalidraw` boards. The SQLite index lives in a cache folder and is rebuilt from the files. Desktop keeps its settings and the index separately in `%APPDATA%\Deckmate\` (`desktop.json` and `index`).

**Do I need the internet?** To download Deckmate, install WebView2 when needed, check for Desktop updates, download Excalidraw's handwritten fonts and load external embeds in Vision. The board itself runs locally on `127.0.0.1`; agents can read the files with the server stopped.

**Do I need Python?** Only projects with their own `Tools/board.py` need Python.

**Can a team use it?** Yes, through git: everyone runs Deckmate on their own checkout, and edits merge like any other file. Conflicting saves are rejected rather than overwritten.

**What about Docker?** Clone the repository and build the image in its folder with `docker build -t deckmate .`. Then view a project from its folder: `docker run --rm -p 127.0.0.1:4318:4318 -e DECKMATE_READ_ONLY=1 -v "$PWD:/data:ro" deckmate`. Or run the published image directly: `docker run --rm -p 127.0.0.1:4318:4318 -e DECKMATE_READ_ONLY=1 -v "$PWD:/data:ro" ghcr.io/pierkulakov/deckmate:latest` (releases publish `:<version>` and `:latest`). In PowerShell write `${PWD}` instead of `$PWD`. Keep the host port equal to the container port (or `DECKMATE_PORT`): the server accepts only `Host` values `127.0.0.1:<port>`, `localhost:<port>` and `[::1]:<port>`, so a different mapping returns 403 for every request. Open `http://127.0.0.1:4318/`. The image is Node 26 on bookworm-slim without Python or Git, so projects using the legacy `Tools/board.py` renderer cannot be opened for editing in the container and Git-backed card history is unavailable there; native Deckmate projects and the documented read-only example work.

**How is this different from a cloud board?** Your board is files in your repository: no account, no server to host, and agents read it without an API.

## Contributing

Bug reports, ideas and pull requests are welcome; [SUPPORT.md](https://github.com/pierkulakov/deckmate/blob/main/SUPPORT.md) explains where to ask questions and report bugs. [CONTRIBUTING.md](https://github.com/pierkulakov/deckmate/blob/main/CONTRIBUTING.md) covers running from source, tests and project rules; [AGENTS.md](https://github.com/pierkulakov/deckmate/blob/main/AGENTS.md) is the short guide for coding agents. Please follow the [Code of Conduct](https://github.com/pierkulakov/deckmate/blob/main/CODE_OF_CONDUCT.md) and report vulnerabilities through [SECURITY.md](SECURITY.md), not public issues. Changes are listed in the [changelog](CHANGELOG.md).

For source development, `npm run dev` starts the watched server and Vite with hot reload at `http://127.0.0.1:4318/`; pass server options after `--`, for example `npm run dev -- --data deckmate-demo`.

## License

[AGPL-3.0-only](https://github.com/pierkulakov/deckmate/blob/main/LICENSE) © 2026 pierkulakov and Deckmate contributors. You may use, change and share Deckmate; if you offer a modified version as a network service, you must publish its source. Contributions are accepted under the [Contributor License Agreement](https://github.com/pierkulakov/deckmate/blob/main/CLA.md).

## Acknowledgements

Vision uses [Excalidraw](https://excalidraw.com); the interface uses [shadcn/ui](https://ui.shadcn.com) and Tailwind CSS. See [asset sources and font licenses](assets/README.md) for the logo, AI-generated deck illustrations, demo screenshots and bundled fonts.
