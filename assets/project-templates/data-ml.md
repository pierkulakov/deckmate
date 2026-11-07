---
deckmate: project-template
schema: 1
id: data-ml
title: Data / ML
description: Datasets, experiments, models and metrics for a data or machine-learning project.
category: software
genre: null
order: 18
spaces:
  - id: spec
    title: Product Spec
    kind: gdd
  - id: production
    title: Production
    kind: tasks
decks:
  - id: datasets
    space: spec
    title: Datasets
    kind: asset
    icon: box
    color: "#5e7bd6"
    art: knowledge
    description: "Sources, schemas, licensing and freshness for each dataset."
  - id: experiments
    space: spec
    title: Experiments
    kind: asset
    icon: activity
    color: "#5e7bd6"
    art: research
    description: "Hypotheses, setup, results and what was learned."
  - id: models
    space: spec
    title: Models
    kind: asset
    icon: layers
    color: "#5e7bd6"
    art: technologies
    description: "Model cards: purpose, inputs, outputs, limits and version."
  - id: metrics
    space: spec
    title: Metrics
    kind: asset
    icon: flag
    color: "#5e7bd6"
    art: rules
    description: "The numbers that matter: definitions, targets and dashboards."
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
  - name: dataset
    color: "#5d9ba4"
    emoji: 📊
  - name: experiment
    color: "#5e7bd6"
    emoji: 🧪
  - name: model
    color: "#94713e"
    emoji: 🧠
  - name: metric
    color: "#5e9c76"
    emoji: 🎯
samples:
  - deck: datasets
    title: Support tickets export
    markdown: "A nightly export of closed tickets with text, category and satisfaction score. Free text is anonymized before training; freshness and license recorded on the card."
  - deck: experiments
    title: "Baseline: keyword classifier"
    markdown: "TF-IDF with logistic regression on 10k labeled tickets, F1 0.61 — the number to beat. Split and seed are recorded so the run can be reproduced."
  - deck: models
    title: Ticket router v1
    markdown: "Routes incoming tickets to queues with a confidence score. Known limit: mixed-language tickets fall back to the general queue; version and rollback noted on the card."
---

For data and ML work: datasets, experiments, models and metrics in the spec; engineering and quality in production. Experiment cards record setup and results so runs can be compared; model cards carry limits and versions. No Journeys — the loop is hypothesis, run, metric, decision.
