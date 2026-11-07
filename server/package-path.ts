import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineText, serverText } from './i18n.ts';

const messages = defineText({
  packageMissing: "Cannot find the Deckmate package root.",
}, {
  packageMissing: "Не найдена корневая папка пакета Deckmate.",
});

// 2026-11-05: source and compiled modules share one package asset location.
let packageRoot = path.dirname(fileURLToPath(import.meta.url));
while (!existsSync(path.join(packageRoot, 'package.json'))) {
  const parent = path.dirname(packageRoot);
  if (parent === packageRoot) throw new Error(serverText(messages).packageMissing);
  packageRoot = parent;
}

export function packagePath(...segments: string[]): string {
  return path.join(packageRoot, ...segments);
}
