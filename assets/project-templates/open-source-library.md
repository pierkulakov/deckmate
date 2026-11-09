---
deckmate: project-template
schema: 1
id: open-source-library
title: Open-Source Library
description: Public API, issues, documentation and releases for a library others depend on.
locales:
  ru:
    title: Open-source-библиотека
    description: Публичный API, issues, документация и релизы для библиотеки, от которой зависят другие.
category: software
genre: null
order: 14
spaces:
  - id: spec
    title: Product Spec
    kind: gdd
  - id: production
    title: Production
    kind: tasks
decks:
  - id: api
    space: spec
    title: API
    kind: asset
    icon: code
    color: "#5e7bd6"
    art: technologies
    description: "The public surface: functions, types, parameters and breaking changes."
  - id: docs
    space: spec
    title: Docs
    kind: asset
    icon: book
    color: "#5e7bd6"
    art: knowledge
    description: "Guides, examples and the getting-started path."
  - id: issues
    space: spec
    title: Issues
    kind: asset
    icon: bug
    color: "#5e7bd6"
    art: bugs
    journey: bug-fix
    description: Bug reports and feature requests from the community.
  - id: releases
    space: spec
    title: Releases
    kind: asset
    icon: flag
    color: "#5e7bd6"
    art: rules
    description: "Version history, migration notes and deprecations."
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
  - name: good first issue
    color: "#5e9c76"
    emoji: 🌱
  - name: breaking
    color: "#d57240"
    emoji: ⚠️
  - name: docs
    color: "#5d9ba4"
    emoji: 📚
samples:
  - deck: api
    title: retry(fn, attempts)
    markdown: "Call fn up to attempts times with backoff between tries. Throws the last error after the final attempt; attempts below 1 throws immediately. Public since 2.1."
  - deck: issues
    title: retry() ignores AbortSignal
    markdown: "retry() keeps retrying after the caller aborts. It should reject on abort and stop further attempts; reproduction and discussion link on the card."
  - deck: docs
    title: Getting Started
    markdown: "Install the package, create a client with one option and make the first call in under five minutes. Ends with fixes for the three most common setup errors."
---

For a library other people build on: the public API, community issues, docs and release notes in the spec; engineering and quality in production. Issues run the Bug Fix Journey so every defect ends with a regression test. Release cards carry migration notes and breaking-change tags.
