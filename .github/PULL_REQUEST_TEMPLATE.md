<!-- Describe one concrete problem and the resulting behavior. Link an existing issue when relevant. -->

## What and why

<!-- What does this PR change, and why? Link the issue: Closes #123 -->

## Validation

<!-- List the checks run and their results. For a bug fix, describe the failing case that now passes. -->

## Checklist

- [ ] I have signed the [Contributor License Agreement](https://github.com/pierkulakov/deckmate/blob/main/CLA.md) (first pull request only; the bot will ask)
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (new/updated tests for parser or write-path changes)
- [ ] `npm run build` passes
- [ ] Packaging changes: a packed tarball starts outside the repository
- [ ] Data writes preserve unchanged bytes, BOM, and line endings; stale hashes are rejected (or not applicable)
- [ ] Markdown remains the source of truth; SQLite is a rebuildable index
- [ ] UI changes: screenshots attached (light and dark theme)

## Screenshots

<!-- For UI changes, drag images here. -->
