#!/usr/bin/env node

// 2026-11-05: keep the version check in plain JS, before importing node:sqlite.
const majorVersion = Number(process.versions.node.split('.')[0]);
if (majorVersion < 26) {
  console.error(`Deckmate requires Node.js 26 or newer; found ${process.versions.node}.`);
  process.exitCode = 1;
} else {
  // cli-entry.js needs only node:path and node:url, so it reports errors of every later import as one line.
  const { reportCliError } = await import('../dist/server/cli-entry.js');
  try {
    const { runCli } = await import('../dist/server/cli.js');
    const code = await runCli();
    if (code) process.exitCode = code;
  } catch (error) {
    reportCliError(error, 'Deckmate: ');
  }
}
