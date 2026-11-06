# Deckmate

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Small game and software teams made of people and AI agents. Members take cards, keep their own Hand, hand results in for review and accept each other's work. Agents such as Claude, Codex or GLM work with the same Markdown files directly, with or without the app running. Nothing in the product assumes a single user or a single project.

## Product Purpose

A local project board with the core of a card-based production tool — decks, Hero cards with Sub Cards, Hands, Runs, Milestones, Journeys and a Vision canvas — over plain files, with a calmer and more cohesive look and work that is ready for agents.

Agent-ready work means one shared workspace: readable tasks and acceptance criteria in Markdown, owners, personal queues, repeatable Journeys, reports handed in for review, and a compact CLI that gives an agent just the card and rules it needs without a running server.

## Positioning

A general board for file-based projects. Pages and cards are views of the project's own files: Markdown stays the source of truth, and the SQLite index holds only rebuildable projections and full-text search. Spaces, decks, tracks and members are recorded in `tasks/deckmate.md` inside the project. The interaction model is adapted for Markdown repositories and agents.

## Operating Context

A local web app on `127.0.0.1`, usually opened in a desktop browser window. The dark theme is the default; the light theme uses the same tokens and stays fully functional. The interface is English by default, with Russian in the app menu. Edits are written directly into the project folder and git is the safety net; an optional separate test copy is available for those who want one, and the Original / Test copy switch appears only with it.

## Capabilities and Constraints

React 19, TypeScript, Vite, Fastify, Milkdown, shadcn/ui and Tailwind. A save changes only the bytes of the edited block. File changes reach open pages within a second. Out of scope: cloud sync, accounts, built-in AI features and automatic commits.

A Journey template and its running instance are different things: changing a template never rewrites cards already created from it. Vision keeps a canvas with links to cards; Timeline shows Runs and Milestones on a calendar.

Licensed AGPL-3.0-only: free to use and change; a modified version offered as a network service must publish its source.

## Brand Commitments

The name is Deckmate. Interface text uses Source Sans 3; numbers and counters use Geist Mono; the card editor uses Roboto Mono; all fonts are bundled locally. The mark is a pixel deck: a violet card with a golden diamond pip, a 16–32 px version and a master version from 64 px, with separate colors for dark and light themes. Hero cards are saturated warm gold with near-black numbers.

Cards have a matte top and a metallic bottom band with a faint sheen; tilt turns off while dragging. Decks have a configurable cover with an image window, a color band and a count plate. Cards in Decks, Board and Hand share one material. Notion influences the editor and document reading.

## Product Principles

- The file is the only source of truth; SQLite can always be rebuilt.
- A space groups decks; a card belongs to at most one deck; tracks cross decks.
- A Doc, a Hero and a Task mean different things; progress counts only tasks.
- Rules of the work are read before implementation details.
- Saving never touches neighboring blocks.
- Every operation shows its state; a conflict is never overwritten silently.
