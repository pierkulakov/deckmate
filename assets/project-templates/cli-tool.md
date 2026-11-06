---
deckmate: project-template
schema: 1
id: cli-tool
title: CLI Tool
description: Commands, flags, compatibility and documentation for a tool developers run daily.
category: software
genre: null
order: 15
spaces:
  - id: spec
    title: Product Spec
    kind: gdd
  - id: production
    title: Production
    kind: tasks
decks:
  - id: commands
    space: spec
    title: Commands
    kind: asset
    icon: tasks
    color: "#5e7bd6"
    art: technologies
    description: "Every command, its arguments, flags and exit codes."
  - id: compatibility
    space: spec
    title: Compatibility
    kind: asset
    icon: layers
    color: "#5e7bd6"
    art: rules
    description: "Supported shells, operating systems, versions and migration notes."
  - id: docs
    space: spec
    title: Docs
    kind: asset
    icon: book
    color: "#5e7bd6"
    art: knowledge
    description: "Reference pages, examples and cookbook recipes."
  - id: issues
    space: spec
    title: Issues
    kind: asset
    icon: bug
    color: "#5e7bd6"
    art: bugs
    journey: bug-fix
    description: Defects and rough edges reported by users.
  - id: engineering
    space: production
    title: Engineering
    kind: task
    icon: code
    color: "#5e1f8b"
    art: coding
    roles:
      - code
    description: Implementation, data integration and developer tooling.
  - id: quality
    space: production
    title: Quality
    kind: task
    icon: bug
    color: "#b64c5b"
    art: bugs
    roles:
      - qa
    description: Reproductions, regression checks and release verification.
tags:
  - name: bug
    color: "#b64c5b"
    emoji: 🐞
  - name: shell
    color: "#5e7bd6"
    emoji: 🐚
  - name: breaking
    color: "#d57240"
    emoji: ⚠️
  - name: polish
    color: "#94713e"
    emoji: ✨
samples:
  - deck: commands
    title: deploy --preview
    markdown: "Print the planned changes without touching the remote. Exits 0 with a diff summary; --preview implies --dry-run and cannot be combined with --force."
  - deck: compatibility
    title: PowerShell 5.1
    markdown: "ANSI colors are stripped when the console reports legacy mode, and paths print with backslashes. The fallback keeps script output parsing stable."
  - deck: issues
    title: Flags after -- are parsed as flags
    markdown: "Arguments following a -- separator should be treated literally, but the parser keeps reading them as flags. Reproduction: build -- --verbose prints the verbose log."
---

For command-line and developer tools: commands, compatibility notes and docs in the spec; engineering and quality in production. Issues run the Bug Fix Journey from reproduction to a regression test. Every command card records its flags and exit codes so scripts can rely on them.
