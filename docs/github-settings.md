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

A registry 404 does not reserve `deckmate` or prove publication rights. The release workflow checks token authentication before publishing; the registry makes the final package-name and permission decision.

Official instructions: [create a granular token](https://docs.npmjs.com/creating-and-viewing-access-tokens/) and [access-token capabilities](https://docs.npmjs.com/about-access-tokens/).

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

Keep `package.json`, `package-lock.json`, the intended `v<version>` tag and the dated section in [CHANGELOG.md](../CHANGELOG.md) consistent. Set the changelog date to the actual publication date. Require successful hosted CI on the exact candidate commit.

### Publish and recover

With the current token-based workflow, confirm that the `NPM_TOKEN` repository secret is present, unexpired and permitted to publish before every release tag. After owner approval, successful CI/CodeQL and npm-secret setup, create and push the version tag from the verified commit:

```sh
git tag -a v0.1.0 -m "Deckmate 0.1.0"
git push origin v0.1.0
```

[release.yml](../.github/workflows/release.yml) requires a public repository and a working `NPM_TOKEN`. It validates the version and notes, runs checks, builds the package and container, publishes npm with provenance, pushes GHCR, then creates the GitHub Release. Prereleases use npm's `next` tag and do not update the container's `latest` tag. Adding the secret or pushing `main` alone publishes nothing.

If publication stops partway through, fix the reported access or service problem and rerun the **same tag's** workflow. An already published npm version is skipped only when its integrity matches the newly built tarball; a mismatch stops the run. An existing GitHub Release has its tarball uploaded again. Keep published tags fixed: npm versions are immutable, so code changes or different package bytes require a new version. Do not use unpublishing or a moved tag as rollback; publish a corrective patch release instead.

After success, verify the npm version/provenance, installation from npm, the GitHub tarball, and anonymous access to the GHCR image. The first release push creates the GHCR package as private (GitHub's default; linking it to the repository does not copy the repository's visibility), so before announcing the release open the package settings → **Change visibility** → **Public** and verify an anonymous `docker pull` of `ghcr.io/pierkulakov/deckmate:0.1.0` and `ghcr.io/pierkulakov/deckmate:latest`. Set the repository website to the npm package page and replace/revoke the broad bootstrap token.

### Move to trusted publishing after bootstrap

npm documents removal of direct publication with bypass-2FA granular tokens in **January 2027**. Once `deckmate` exists, configure its [trusted publisher](https://docs.npmjs.com/trusted-publishers/) for GitHub repository `pierkulakov/deckmate` and workflow `release.yml`, then update this workflow's token preflight/publication authentication and remove `NPM_TOKEN`. Make this a verified follow-up before that deadline. The existing `id-token: write` permission supports provenance; it alone does not configure trusted publishing. Provenance requires the source repository to be public.
