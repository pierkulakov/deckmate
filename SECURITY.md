# Security Policy

Deckmate is a **local application**: the server binds to loopback (`127.0.0.1`) only, there are no accounts and no remote access. Still, it reads and writes files in your real project, so its write path is treated as security-relevant.

## Local trust model

The application deliberately trusts a single local user's session. Requests that change data require a session token, but the token is available from `GET /api/snapshot` without authentication. Any local process can obtain it and claim any member's identity, including a guardian's, through `x-deckmate-actor` or the acceptance fields. Action authors are not authenticated; member and guardian rules support workflow correctness, not identity verification or a tamper-proof audit trail.

Connect only trusted project folders through `DECKMATE_DATA` and `DECKMATE_WRITE`. The server executes the project's `Tools/board.py` with the configured `DECKMATE_PYTHON` interpreter when checking a writable project at startup and rebuilding/checking the board after supported mechanic edits. This runs project-supplied Python code with your user privileges; a separate worktree is not an execution sandbox.

## Supported versions

The latest release line is supported, currently 0.1.x. Security fixes land on the current `main` branch and are published as new patch versions; please run the latest patch.

## Reporting a vulnerability

Please do **not** open a public issue for security reports.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab → **Report a vulnerability**, or contact [the repository owner](https://github.com/pierkulakov) directly via GitHub.

Include what you can of: a description of the issue, steps or a script to reproduce, affected paths (`client/`, `server/`, `tools/`), and your OS/Node version. You will get an initial response within a few days; fixes are released on `main` and credited in the report unless you prefer otherwise.

## What the write path guarantees

These are the properties Deckmate's guarded writes are designed around:

- The server listens on loopback only; it never exposes a remote endpoint.
- The default `direct` mode writes to `DECKMATE_DATA` without requiring git. Keep commits for recovery; Deckmate does not create them. Optional `sandbox` mode writes exclusively to a separate `DECKMATE_WRITE` copy on branch `deckmate/sandbox`, verified before writes. `--read-only` or `DECKMATE_READ_ONLY=1` disables writes and takes precedence over a configured copy.
- HTTP writes require a local session token and current content hashes (`manifestHash`/`sourceHash`). A stale hash fails with `409` — Deckmate never silently overwrites an externally edited file.
- Publication is an atomic replace, re-verified immediately before rename; unchanged bytes, BOM and line endings are preserved.

## What is explicitly *not* a security boundary

Deckmate is a local tool, and Markdown files are the source of truth:

- Anyone (or anything) with access to your user session can edit the project files directly, bypassing Deckmate entirely. The session token protects against accidental writes, not against a hostile local process.
- Agents are expected to read and edit the same files. The members registry, sandbox branch and hash guards are correctness mechanisms — they do not sandbox a malicious agent on your machine. Run agents you trust.
- Physical deletion, automatic cleanup and backup are your responsibility: use git commits to preserve history; Deckmate does not manage backups or commit automatically.

If you believe one of the "guarantees" above does not hold, that is precisely a security report — please write to us.
