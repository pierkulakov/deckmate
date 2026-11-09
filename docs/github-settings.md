# Release runbook

Maintainer notes for [pierkulakov/deckmate](https://github.com/pierkulakov/deckmate). Preparation date: 2026-11-06.

## One-time setup before the repository goes public

### Repository settings

- Enable Issues and Discussions; disable the Wiki.
- Enable automatic deletion of merged branches.
- Set Actions workflow permissions to **Read repository contents and packages**. Disable **Allow GitHub Actions to create and approve pull requests**. Individual workflows declare the additional permissions they need.
- Enable Dependabot alerts and security updates. [dependabot.yml](../.github/dependabot.yml) also checks npm packages and Actions weekly.
- Keep the repository **Description** consistent with the description in [package.json](../package.json). Use its keywords as **Topics** in the repository's About panel so GitHub and npm describe the same product.
- Review [social-preview.png](social-preview.png) now; upload it under **Settings → General → Social preview** right after the repository is public, because GitHub shows that section only for public repositories (2026-11-07). It must be 1280×640 and smaller than 1 MiB. Regenerate the demo screenshots and preview with `npm run build`, then `npm run shots`; review all six screenshots and the preview at full size and at 320×160 before uploading.
- Keep the website field empty until the npm package exists; then use `https://www.npmjs.com/package/deckmate`.

Committing the image does not install it as the repository's social preview. Confirm the uploaded image in Settings; the GraphQL repository field `usesCustomOpenGraphImage` should be `true`. Anonymous chat crawlers cannot produce the public preview before the repository is public. After opening it, test the repository URL in the intended chat and allow for cached previews. The local application and `social-preview.html` are not a public website; GitHub and npm supply the public search and link metadata.

The preview was refreshed on 2026-11-08 with the Desktop release artwork. [social-preview.png](social-preview.png) stays 1280×640 and is rebuilt by the capture script from [social-preview.html](social-preview.html); review it at full size and at 320×160 before re-uploading.

### Visibility, CI and branch protection

Pushing `main` runs [CI](../.github/workflows/ci.yml) on Ubuntu and Windows; it does not publish a release.

If repository rules are unavailable before public opening, configure branch protection afterward:

1. Require pull requests and the successful `checks (ubuntu-latest)` and `checks (windows-latest)` status checks for `main`.
2. Block force pushes and branch deletion. Add the CLA check after its first pull-request run establishes the check name.
3. Enable **Private vulnerability reporting** under **Settings → Security**, matching [SECURITY.md](../SECURITY.md).
4. Enable available secret scanning and push protection.

[CodeQL](../.github/workflows/codeql.yml) cannot run its analysis while the repository is private. The `public` event starts analysis when the repository is opened; `workflow_dispatch` allows a manual rerun. Keep the workflow on the default branch and wait for its successful analysis before the first public release. This workflow uses advanced setup; a second default-setup workflow is unnecessary.

Changing visibility and publishing the first version are separate maintainer actions. Open the repository only after the owner approves the final snapshot.

### CLA signature storage

The CLA workflow stores signatures on the separate `cla-signatures` branch. Create that branch before accepting pull requests and leave it writable by the workflow; the `main` branch's protection rules should not cover it. It only needs a README initially. Let the pinned CLA Assistant action create `signatures/version1/cla.json` itself, then maintain that file from contributor signature comments.

Verify the workflow on a pull request: a missing branch or a write-permission error is a setup failure, while an unsigned contributor is an expected failing status. A `recheck` comment reruns the check. Do not record signatures on behalf of contributors.

The pinned action reports a failing check on the run that first creates the signature file, even when every author is allowlisted. After confirming that the file was created successfully, rerun the check; an allowlisted-only pull request should then pass with no signatures added.

### npm access for the first release

Create the credential **before pushing a release tag**. A local `npm login` is not needed for GitHub Actions.

1. Sign in to [npmjs.com](https://www.npmjs.com/), verify the account email, then open your avatar → **Access Tokens → Generate New Token**.
2. Name the token `deckmate-release` and enable **Bypass two-factor authentication** for noninteractive publication.
3. Under **Packages and scopes**, choose **Read and write (publish and stage)**. For the first unpublished package, use **All Packages**; the specific-package picker lists existing packages. Replace this token with access limited to `deckmate` after the first release.
4. Leave **Organizations** at **No access** and **Allowed IP Ranges** empty for GitHub-hosted runners. Choose a short expiration that covers the planned release, for example seven days.
5. Generate the token and copy it immediately; npm shows the full value only once.
6. Open [New repository secret](https://github.com/pierkulakov/deckmate/settings/secrets/actions/new), enter **Name: `NPM_TOKEN`**, paste the token into **Secret**, and save. Never put the token into chat, source files or a commit.

A registry 404 does not reserve `deckmate` or prove publication rights. The release workflow checks repository visibility, token presence and `npm whoami` in `preflight`, before the Windows build; the registry makes the final package-name and permission decision.

Official instructions: [create a granular token](https://docs.npmjs.com/creating-and-viewing-access-tokens/) and [access-token capabilities](https://docs.npmjs.com/about-access-tokens/).

### Updater signing identity and offline recovery copy

Set up signing **before the first Tauri release or signed dry run**. Minisign updater signing is separate from Windows Authenticode/SmartScreen. Installed apps trust the public key in `desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.

1. Use the original private key corresponding to that public key. Only when provisioning a new identity **before any app with that identity has shipped**, generate it with the pinned desktop Tauri CLI (`npm run tauri -- signer generate --write-keys <secure-path-outside-the-checkout>` from `desktop/`). Choose a nonempty password and copy the generated public key into the config. Never regenerate the identity just to fix a missing CI secret.
2. Keep an **offline, recoverable copy of both the private key and its password**, outside the repository and CI artifacts. Verify a restore by signing disposable bytes and verifying with the configured public key; keep access limited to the release owner. Losing either means no installed copy trusting that key can receive a newly signed update; a new key requires manual reinstallation for those users.
3. In **Settings → Secrets and variables → Actions**, create `TAURI_SIGNING_PRIVATE_KEY` with the complete Tauri-generated private-key file contents and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` with its password. Use the secret-entry UI or secure stdin, never source files, command history, logs or chat. GitHub secrets are write-only: the original values cannot be retrieved from GitHub for recovery. Restore them from the offline copy.
4. The workflow exposes these secrets only to the signing-secret check and Tauri build steps. The signing job does not restore Cargo registry/git caches from other workflows; all Rust commands use `desktop/src-tauri/rust-toolchain.toml`.

Owner recommendation: configure a protected `release` **environment with a required reviewer** and permitted release refs, then associate the secret-consuming `preflight`, `desktop` and `release` jobs with it and move their secrets there. This is repository-owner setup, not enabled by the workflow automatically. Also add a tag ruleset for `v*`: restrict tag creation to release maintainers and block tag updates/deletion. Allow the intended manually selected candidate ref in the environment when testing a dry run.

## Every release

### Verify the release candidate

Use Node.js 26 or newer and install from the lockfile:

```sh
npm run quiet -- npm ci
npm run quiet -- npm run typecheck
npm run quiet -- npm test
npm run quiet -- npm run build
npm run quiet -- npm pack --ignore-scripts --dry-run
```

The package contains the compiled client in `dist/client/`, server and CLI tools in `dist/`, templates, public skills and required license notices. Install the actual tarball into a fresh directory and check `deckmate --version`, `deckmate init`, the project/skills/agents commands, and the HTTP application before publishing. A source-checkout run alone does not verify the package contents.

Keep `package.json`, `package-lock.json`, `desktop/package.json`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml`, the `deckmate-desktop` entry in `Cargo.lock` and the intended `v<version>` tag consistent. Both [CHANGELOG.md](../CHANGELOG.md) and [CHANGELOG.ru.md](../CHANGELOG.ru.md) need the same dated release section; set the date to the actual publication date. Require successful hosted CI on the exact candidate commit.

### Publish and recover

With the current token-based workflow, confirm that `NPM_TOKEN` is present, unexpired and permitted to publish, and that both updater-signing secrets and their offline recovery copy are available. After owner approval and successful CI/CodeQL, create and push the version tag from the verified commit:

```sh
git tag -a v0.6.0 -m "Deckmate 0.6.0"
git push origin v0.6.0
```

[release.yml](../.github/workflows/release.yml) runs `preflight → desktop → release`:

1. `preflight` checks public visibility and npm authentication, every version source and both dated changelogs, then runs checks and packs npm. It records the tag commit's timestamp for the updater `pub_date`.
2. `desktop` builds on the pinned Rust toolchain, signs and self-tests the Windows installer and portable zip, and generates `latest.json` **once** with a canonical base64 signature and both languages' notes. All files, including the `.sig` and manifest, travel together in the `desktop-release` artifact (seven-day retention). Repeating manifest generation with the same inputs and commit date produces identical bytes.
3. `release` downloads the artifacts and verifies the installer signature again against the checked-in public key, the signed version and the unchanged manifest. It finds or creates a **draft** using the paginated REST release list and the numeric REST `id`; an already published release stops the job before npm/GHCR publication. It checks npm integrity, builds the container, publishes npm with provenance and pushes GHCR. It uploads the npm tarball, installer and zip, checking API names, `state=uploaded`, sizes, SHA-256 `digest` when supplied and downloaded bytes. The manifest's installer URL must match GitHub's actual name and `browser_download_url`. It uploads `latest.json` last, rechecks assets and publishes by numeric ID with explicit `make_latest`.
4. After publication it anonymously downloads `/releases/download/<tag>/latest.json` and, for a stable version, `/releases/latest/download/latest.json`, comparing both byte for byte with the build artifact. Prereleases explicitly use `make_latest=false`, npm's `next` tag and no container `latest` tag. Adding secrets or pushing `main` alone publishes nothing.

If publication stops while the release is still a **draft**, fix the reported access or service problem and rerun the **same tag's** failed jobs while the artifacts remain available. If artifacts expired, rerun all jobs from the same immutable commit. An already published npm version is skipped only when its integrity matches the tarball; a mismatch requires a new version. Identical draft assets are reused; incomplete or different draft assets are deleted and uploaded again, so rebuilding a signed installer does not burn the version. Any old `latest.json` is removed before asset repair and uploaded last again. API authentication, transport or service errors stop lookup instead of being interpreted as “release not found.” Multiple drafts for one tag stop the job for owner inspection.

If the release was already published (including from the UI), the workflow refuses to mutate it: releases are published only through a tag push. If only the post-publication download check failed, inspect the public endpoints against the retained `latest.json` artifact after propagation; do not rerun publication or replace live bytes. If bytes really differ, publish a corrective version. Keep published tags fixed: npm versions are immutable, so code changes or different package bytes require a new version. Do not use unpublishing or a moved tag as rollback.

After success, verify the npm version/provenance, installation from npm, the GitHub tarball, and anonymous access to the GHCR image. The first release push creates the GHCR package as private (GitHub's default; linking it to the repository does not copy the repository's visibility), so before announcing the release open the package settings → **Change visibility** → **Public** and verify an anonymous `docker pull` of `ghcr.io/pierkulakov/deckmate:0.6.0` and `ghcr.io/pierkulakov/deckmate:latest`. Set the repository website to the npm package page and replace/revoke the broad bootstrap token.

### Signed dry run before a real tag

In Actions → **Release → Run workflow**, select the reviewed candidate ref and leave `dry_run=true` (the default). Version sources and both dated changelogs must already agree. `preflight` and `desktop` run normally, including npm access validation, real signing secrets and self-tests. `release` exercises the same draft API, uploads and byte/digest/signature checks using `v<version>-dryrun.<run_id>`, then deletes the draft. The draft targets the checked-out commit; no Git tag is created because it is never published. There is no npm publication, container build/push, release publication or public updater endpoint in this mode. `workflow_dispatch` with `dry_run=false` is rejected; real publication requires a matching tag push.

Cleanup runs even after an asset check fails. If the runner is forcibly terminated or GitHub is unavailable during cleanup, inspect and remove the leftover dry-run **draft** by its numeric ID, or rerun the same run to resume and clean it up. Never publish a dry-run draft in the UI.

### Desktop artifacts

The `desktop` job in [release.yml](../.github/workflows/release.yml) builds, signs and self-tests the Windows Tauri shell before any publication. The installer is named `Deckmate.Setup.<version>.exe` **before upload**, so GitHub does not rewrite spaces in its filename. It and `Deckmate-<version>-win-x64.zip` carry `THIRD-PARTY-NOTICES.txt` beside `Deckmate.exe`; the job also self-tests the installer and uninstaller and checks notices inside the zip. Check the Release page for both files, the npm tarball and `latest.json`.

### Inspecting and recovering a draft

Use the workflow's retry path above for asset recovery and publication; it shares [github-release.mjs](../desktop/scripts/github-release.mjs) with the dry run and repeats every check. Do not manually publish a partially completed release or upload an unsigned local `npm run dist` build. If signing secrets are missing, restore them from the offline key/password copy; GitHub cannot reveal the old secret values. Without that backup, stop rather than inventing a new key for already installed clients.

For read-only inspection with an authenticated maintainer `gh` session:

```pwsh
$tag = 'v0.6.0'
$raw = gh release view $tag --json databaseId,isDraft
if ($LASTEXITCODE -ne 0) { throw 'Release lookup failed; do not create another draft.' }
$release = $raw | ConvertFrom-Json
if (-not $release.isDraft) { throw 'Already published: use a corrective version, not live asset replacement.' }
$releaseId = $release.databaseId
if ("$releaseId" -notmatch '^\d+$') { throw 'Expected a numeric REST database ID.' }
gh api "repos/{owner}/{repo}/releases/$releaseId"
gh api --paginate "repos/{owner}/{repo}/releases/$releaseId/assets" --jq '.[] | {id,name,state,size,digest,browser_download_url}'
```

The REST “release by tag” endpoint does not resolve drafts. `gh release view --json id` returns a GraphQL node ID, **not** the REST ID; use `databaseId` as above, or the numeric `id` returned by the REST release list/create response. The workflow never falls back from an arbitrary lookup failure to creating another draft. Repair and final publication remain in the tag-triggered workflow, using that numeric ID and explicit `make_latest=true` for stable or `false` for prerelease.

### Move to trusted publishing after bootstrap

npm documents removal of direct publication with bypass-2FA granular tokens in **January 2027**. Once `deckmate` exists, configure its [trusted publisher](https://docs.npmjs.com/trusted-publishers/) for GitHub repository `pierkulakov/deckmate` and workflow `release.yml`, then update this workflow's token preflight/publication authentication and remove `NPM_TOKEN`. Make this a verified follow-up before that deadline. The existing `id-token: write` permission supports provenance; it alone does not configure trusted publishing. Provenance requires the source repository to be public.
