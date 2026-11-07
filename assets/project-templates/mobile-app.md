---
deckmate: project-template
schema: 1
id: mobile-app
title: Mobile App
description: Screens, platform notes, store releases and bugs for an iOS and Android app.
category: software
genre: null
order: 13
spaces:
  - id: spec
    title: Product Spec
    kind: gdd
  - id: production
    title: Production
    kind: tasks
decks:
  - id: screens
    space: spec
    title: Screens
    kind: asset
    icon: image
    color: "#5e7bd6"
    art: ui
    description: "Screen purpose, layout, states and navigation."
  - id: platform-notes
    space: spec
    title: Platform Notes
    kind: asset
    icon: layers
    color: "#5e7bd6"
    art: knowledge
    description: "iOS and Android differences, permissions and device coverage."
  - id: store-releases
    space: spec
    title: Store Releases
    kind: asset
    icon: flag
    color: "#5e7bd6"
    art: rules
    description: "Store listings, review notes, rollouts and version history."
  - id: bugs
    space: spec
    title: Bugs
    kind: asset
    icon: bug
    color: "#5e7bd6"
    art: bugs
    journey: bug-fix
    description: Defects by device and build, with reproduction steps.
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
  - name: ios
    color: "#687e9c"
    emoji: 🍎
  - name: android
    color: "#5e9c76"
    emoji: 🤖
  - name: release
    color: "#e0a63e"
    emoji: 🚀
  - name: bug
    color: "#b64c5b"
    emoji: 🐞
samples:
  - deck: screens
    title: Onboarding
    markdown: "Four screens: welcome, notification opt-in, first sync and a short tutorial. Skipping keeps the tutorial available from settings, and the flow fits the smallest supported phone."
  - deck: platform-notes
    title: Camera permissions
    markdown: "iOS shows the system prompt once; Android 13+ needs a runtime permission per session. A denial on either platform still allows importing through the file picker."
  - deck: bugs
    title: Sync stalls on poor network
    markdown: "Background sync stops reporting progress when the connection drops mid-upload on Android; it recovers only after an app restart. iOS shows an error toast instead."
---

A lean mobile pipeline: screens, platform notes and store releases in the spec; engineering and quality in production. The Bugs deck runs the Bug Fix Journey from reproduction to verified fix. Platform tags keep iOS and Android work visible apart.
