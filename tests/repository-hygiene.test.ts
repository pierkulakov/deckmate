import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'rolldown/utils';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const cyrillic = /\p{Script=Cyrillic}/u;
const attribution = /\bthe\x20author(?:'s)?\b/i;
const competitor = /\bcodeck\x73\b/i;
const designSketch = /(?:\bsketch [A-D]\b|(?<![\p{L}\p{N}_])\u044d\u0441\u043a\u0438\u0437(?![\p{L}\p{N}_]))/iu;
const codeFile = /\.(?:ts|tsx|js|mjs|css|rs)$/i;
const scriptFile = /\.(?:ts|tsx|js|mjs)$/i;

// These exact fragments describe product authorship or reproduce a font license, not design decisions.
const productAttribution: Record<string, RegExp[]> = {
  'client/components/AttachmentsPanel.tsx': [/The server sets the\x20author from x-deckmate-actor\./],
  'desktop/launcher/fonts/OFL.txt': [/the Copyright Holder\(s\) or the\x20Author\(s\) of the Font/, /Copyright Holder\(s\) and the\x20Author\(s\) or with their explicit written/],
  'docs/catalog.md': [/null or an absent legacy field means the\x20author is unknown\./, /state IDs and the\x20author's text are not translated\./],
  'skills/deckmate/references/api.md': [/`actorMemberId` is the\x20author, not Owner/],
  'skills/deckmate/workflows/plan.md': [/report the decision or outcome back to the\x20author\./],
};

interface CommentRange { start: number; end: number }

function gitFiles(args: string[]): string[] {
  return execFileSync('git', ['ls-files', '-z', ...args], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}

function publishable(file: string): boolean {
  if (file.startsWith('assets/fonts/') || file.startsWith('assets/journey-templates/')) return false;
  if (path.posix.basename(file) === 'package-lock.json' || /^desktop\/(?:.*\/)?Cargo\.lock$/.test(file)) return false;
  return !/\.(?:png|jpe?g|webp|gif|ico|ttf|woff2?|pdf|zip|exe|dll)$/i.test(file);
}

function sourceText(file: string): string | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path.join(root, file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function skipQuoted(text: string, start: number, quote: string): number {
  let position = start + 1;
  while (position < text.length) {
    if (text[position] === '\\') position += 2;
    else if (text[position++] === quote) break;
  }
  return position;
}

function styleAndRustComments(text: string, rust: boolean): CommentRange[] {
  const comments: CommentRange[] = [];
  let position = 0;
  while (position < text.length) {
    const raw = rust && (text[position] === 'r' || text[position] === 'b') ? /^(?:br|r)(#*)"/.exec(text.slice(position)) : null;
    if (raw) {
      const end = text.indexOf('"' + raw[1], position + raw[0].length);
      position = end < 0 ? text.length : end + 1 + raw[1]!.length;
    } else if (text.startsWith('//', position)) {
      const end = text.indexOf('\n', position);
      comments.push({ start: position, end: end < 0 ? text.length : end });
      position = end < 0 ? text.length : end;
    } else if (text.startsWith('/*', position)) {
      const start = position;
      let depth = 1;
      position += 2;
      while (position < text.length && depth) {
        if (rust && text.startsWith('/*', position)) { depth++; position += 2; }
        else if (text.startsWith('*/', position)) { depth--; position += 2; }
        else position++;
      }
      comments.push({ start, end: position });
    } else if (!rust && /^url\(\s*/i.test(text.slice(position, position + 8))) {
      // An unquoted CSS URL can contain comment-like characters as data.
      position += /^url\(\s*/i.exec(text.slice(position))![0].length;
      while (position < text.length && text[position] !== ')') {
        if (text[position] === '"' || text[position] === "'") position = skipQuoted(text, position, text[position]!);
        else if (text[position] === '\\') position += 2;
        else position++;
      }
      if (position < text.length) position++;
    } else if (text[position] === '"' || (!rust && text[position] === "'")) {
      position = skipQuoted(text, position, text[position]!);
    } else if (rust && text[position] === "'" && /^'(?:\\.|[^'\\\r\n])'/.test(text.slice(position))) {
      position = skipQuoted(text, position, "'");
    } else {
      position++;
    }
  }
  return comments;
}

function commentRanges(file: string, text: string): CommentRange[] {
  if (!scriptFile.test(file)) return styleAndRustComments(text, file.endsWith('.rs'));
  const parsed = parseSync(file, text);
  if (parsed.errors.length) throw new Error(`Cannot inspect comments in ${file}: ${parsed.errors.map(error => error.message).join('; ')}`);
  return parsed.comments;
}

function commentLines(file: string, text: string): number[] {
  if (!cyrillic.test(text)) return [];
  const lines: number[] = [];
  for (const { start, end } of commentRanges(file, text)) {
    const comment = text.slice(start, end);
    if (!cyrillic.test(comment)) continue;
    const firstLine = text.slice(0, start).split('\n').length;
    comment.split('\n').forEach((line, offset) => {
      if (cyrillic.test(line)) lines.push(firstLine + offset);
    });
  }
  return lines;
}

function textViolations(file: string, text: string): string[] {
  return text.split('\n').flatMap((line, index) => {
    const checked = (productAttribution[file] ?? []).reduce((value, allowed) => value.replace(allowed, ''), line);
    const kinds = [attribution.test(checked) && 'attribution', competitor.test(line) && 'competitor', designSketch.test(line) && 'design sketch'].filter(Boolean);
    return kinds.map(kind => `${file}:${index + 1}: ${kind}`);
  });
}

describe('repository hygiene', () => {
  it.each(['components/JourneyCatalog.tsx', 'components/Notifications.tsx', 'components/CardPreview.tsx',
    'components/JourneyMetrics.tsx', 'components/DocumentPreview.tsx', 'components/CardFamily.tsx', 'AttachSubCards.tsx'])('%s uses the shared formatter instead of exposing fetch TypeErrors', file => {
    const source = readFileSync(path.join(root, 'client', file), 'utf8');
    expect(source).toMatch(/import \{ failureMessage \} from ['"].*failure-message\.ts['"]/u);
    expect(source).not.toMatch(/function failureMessage\(/u);
    expect(source).toMatch(/failureMessage\((?:failure|error), /u);
  });

  it('distinguishes comments from localized strings, templates and regular expressions', () => {
    const russian = '\u0442\u0435\u043a\u0441\u0442';
    const script = [`const s = "// ${russian}";`, `const r = /\\/\\/${russian}/;`,
      `const x = <div>${russian}{/* ${russian} */}</div>;`,
      `const t = \`// ${russian} \${1 /* ${russian} */}\`;`, `// ${russian}`, '/* note', ` * ${russian}`, ' */'].join('\n');
    expect(commentLines('example.tsx', script)).toEqual([3, 4, 5, 7]);
    expect(commentLines('example.css', `a { content: "// ${russian}"; background: url(https://x/${russian}); }\n/* ${russian} */`)).toEqual([2]);
    expect(commentLines('example.rs', `let s = r#"// ${russian}"#;\n/* outer /* ${russian} */ end */`)).toEqual([2]);
  });

  it('detects forbidden text without exempting unrelated text on a permitted line', () => {
    const author = ['the', 'author'].join(' ');
    const rival = ['code', 'cks'].join('');
    const russianSketch = '\u044d\u0441\u043a\u0438\u0437';
    expect(textViolations('example.md', `${author}'s choice\n${rival}\n${'sketch ' + 'A'}\n${russianSketch}`)).toHaveLength(4);
    const allowed = `null or an absent legacy field means ${author} is unknown.`;
    expect(textViolations('docs/catalog.md', allowed)).toEqual([]);
    expect(textViolations('docs/catalog.md', `${allowed} ${author} asked.`)).toHaveLength(1);
  });

  it('keeps publishable files free of conversation artifacts', () => {
    // Untracked local scratch output in .delegate/ is never published; tracked files there are still checked.
    const untracked = gitFiles(['--others', '--exclude-standard']).filter(file => !file.startsWith('.delegate/'));
    const files = [...new Set([...gitFiles([]), ...untracked])].filter(publishable).sort();
    const violations: string[] = [];
    for (const file of files) {
      const text = sourceText(file);
      if (text === null) continue;
      violations.push(...textViolations(file, text));
      if (codeFile.test(file)) violations.push(...commentLines(file, text).map(line => `${file}:${line}: Cyrillic comment`));
    }
    if (violations.length) throw new Error(`Repository hygiene violations:\n${violations.join('\n')}`);
  });
});
