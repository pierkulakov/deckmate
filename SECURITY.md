# Security Policy

Deckmate is a **local application**: the server binds to loopback (`127.0.0.1`) by default and has no accounts or remote-user authentication. It reads and writes files in your real project, so its write path is treated as security-relevant.

## Local trust model

Build a local Docker image with `docker build -t deckmate .`, or run the published image from a project folder with `docker run --rm -p 127.0.0.1:4318:4318 -e DECKMATE_READ_ONLY=1 -v "$PWD:/data:ro" ghcr.io/pierkulakov/deckmate:latest`. The Docker image sets `DECKMATE_HOST=0.0.0.0` so the host can reach the container. Publish its port on host loopback, as in `-p 127.0.0.1:4318:4318`. Keep the host port equal to the container port (or `DECKMATE_PORT`): the server accepts only a `Host` header of `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`; any other mapping makes all requests fail with 403. Outside Docker, keep the default binding. Binding to all interfaces or forwarding the port to a network makes the API accessible to anyone who can reach it: `Host` and `Origin` checks protect browser requests, not against a remote HTTP client that supplies its own headers. The session token is not remote authentication.

The application deliberately trusts a single local user's session. Requests that change data require a session token, but the token is available from `GET /api/snapshot` without authentication. Any local process can obtain it and claim any member's identity, including a guardian's, through `x-deckmate-actor` or the acceptance fields. Action authors are not authenticated; member and guardian rules support workflow correctness, not identity verification or a tamper-proof audit trail.

Connect only trusted project folders through `DECKMATE_DATA` and `DECKMATE_WRITE`. The server executes the project's `Tools/board.py` with the configured `DECKMATE_PYTHON` interpreter when checking a writable project at startup and rebuilding/checking the board after supported mechanic edits. This runs project-supplied Python code with your user privileges; a separate worktree is not an execution sandbox.

Two more entry points execute project-supplied code. `deckmate agents run` reads launcher commands from the project's `tasks/deckmate-agents.md` and runs them through the system shell with the project folder as the working directory. And `deckmate` and its subcommands load `.env.local` from the folder they are started in, which can set `DECKMATE_PYTHON`, `DECKMATE_DATA` and `DECKMATE_WRITE`. Cloning someone else's project and running Deckmate inside it therefore executes that project's code with your user privileges — run Deckmate only in folders you trust.

## Deckmate Desktop

Deckmate Desktop (the Electron shell in `desktop/`) wraps the same local server and inherits the same trust model. The installer and portable builds are not code-signed, so Windows SmartScreen warns about an unknown publisher; download them only from the repository's Releases page, and when a checksum is published for a release, compare the size/checksum of your download against it before running the installer. Inside the app the server still listens only on `127.0.0.1` on a random free port, and any local process of the same user can talk to it, exactly as with the CLI. Application settings and the server log live in the user's profile (`%APPDATA%\Deckmate\desktop.json` and `server.log`); project data stays in the project folder. Vulnerabilities in the desktop shell itself are reported through the same channel described below.

## Supported versions

The latest release line is supported, currently 0.2.x (the CLI, the npm package and the desktop shell share one version). Security fixes land on the current `main` branch and are published as new patch versions; please run the latest patch.

## Reporting a vulnerability

Please do **not** open a public issue for security reports.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab → **Report a vulnerability**, or go directly to https://github.com/pierkulakov/deckmate/security/advisories/new .

Include what you can of: a description of the issue, steps or a script to reproduce, affected paths (`client/`, `server/`, `tools/`), and your OS/Node version. You will get an initial response within a few days; fixes are released on `main` and credited in the report unless you prefer otherwise.

## What the write path guarantees

These are the properties Deckmate's guarded writes are designed around:

- The default server binding is loopback. Docker uses all container interfaces and relies on the documented host-loopback port mapping to keep access local.
- The default `direct` mode writes to `DECKMATE_DATA` without requiring git. Keep commits for recovery; Deckmate does not create them. Optional `sandbox` mode writes exclusively to a separate `DECKMATE_WRITE` copy on branch `deckmate/sandbox`, verified before writes. `--read-only` or `DECKMATE_READ_ONLY=1` disables writes and takes precedence over a configured copy.
- HTTP mutations require a local session token. Project-file edits also require the content hashes specified by their action (`manifestHash`/`sourceHash`, for example); notification seen/dismiss actions and shutdown do not take file hashes. A stale hash fails with `409` rather than overwriting an externally edited file.
- Publication is an atomic replace, re-verified immediately before rename; unchanged bytes, BOM and line endings are preserved.

## What is explicitly *not* a security boundary

Deckmate is a local tool, and Markdown files are the source of truth:

- Anyone (or anything) with access to your user session can edit the project files directly, bypassing Deckmate entirely. The session token protects against accidental writes, not against a hostile local process.
- Agents are expected to read and edit the same files. The members registry, sandbox branch and hash guards are correctness mechanisms — they do not sandbox a malicious agent on your machine. Run agents you trust.
- Physical deletion, automatic cleanup and backup are your responsibility: use git commits to preserve history; Deckmate does not manage backups or commit automatically.

If you believe one of the "guarantees" above does not hold, that is precisely a security report — please write to us.
