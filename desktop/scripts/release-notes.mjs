// The one parser that turns a Keep a Changelog release section into notes. Shared by the
// "Validate release version and notes" step of .github/workflows/release.yml and
// desktop/scripts/updater-manifest.mjs, so the GitHub Release and the updater manifest never
// drift apart (2026-11-09).

// Returns the body of the `[version] - date` section: everything below its heading up to the next
// `## `, trimmed. Throws when the section is missing or carries no notes.
export function extractReleaseNotes(changelog, version, file = 'CHANGELOG.md') {
  const section = changelog.split(/^## /m).find((entry) => entry.startsWith(`[${version}] - `));
  if (!section || !section.includes('\n')) {
    throw new Error(`${file} needs a dated [${version}] release section.`);
  }
  const notes = section.slice(section.indexOf('\n') + 1).trim();
  if (!notes) throw new Error(`Release notes in ${file} for [${version}] must not be empty.`);
  return notes;
}
