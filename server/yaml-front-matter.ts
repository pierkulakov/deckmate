import { isAlias, isMap, parseDocument, visit } from 'yaml';

type FrontMatterOptions = {
  headerError: string;
  yamlError: string;
} & ({ aliases: 'reject'; aliasError: string } | { aliases: 'preserve' });

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

export function parseYamlFrontMatter(bytes: Buffer, options: FrontMatterOptions) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const match = /^(?:\uFEFF)?---(\r?\n)([\s\S]*?)^---[ \t]*(?:\r?\n|$)/mu.exec(text);
  if (!match || match.index !== 0) throw new Error(options.headerError);
  const yaml = match[2];
  const document = parseDocument(yaml);
  if (document.errors.length || !isMap(document.contents)) throw new Error(options.yamlError);
  if (options.aliases === 'reject') {
    visit(document, (_key, node) => { if (isAlias(node)) throw new Error(options.aliasError); });
  }
  // 2026-11-10: writers slice the decoded source, so ranges stay in characters, not UTF-8 bytes.
  // Keep the document unconverted: callers own alias resolution and schema validation.
  const yamlStart = text.indexOf('\n') + 1;
  return { text, yaml, yamlStart, yamlEnd: yamlStart + yaml.length, newline: match[1], document };
}
