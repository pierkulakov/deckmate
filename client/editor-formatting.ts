import { defineText, textNow } from './i18n.ts';

const text = defineText({ linkLabel: 'text' }, { linkLabel: 'текст' });

interface EditorSelection { start: number; end: number }
export interface EditorReplacement extends EditorSelection { value: string }
export type EditorFormat = 'bold' | 'italic' | 'strike' | 'code' | 'link';

export function formatEditorSelection(value: string, selection: EditorSelection, format: EditorFormat): EditorReplacement {
  const { start, end } = selection;
  const selected = value.slice(start, end);
  const replace = (from: number, to: number, text: string, nextStart: number, nextEnd: number) => ({
    value: value.slice(0, from) + text + value.slice(to), start: nextStart, end: nextEnd,
  });
  if (format === 'link') {
    const existing = /^\[([^\n]*)\]\([^\n]*\)$/u.exec(selected);
    if (existing) return replace(start, end, existing[1], start, start + existing[1].length);
    const label = selected || textNow(text).linkLabel;
    const escaped = label.replace(/([\\\[\]])/gu, '\\$1');
    return replace(start, end, `[${escaped}](https://)`, start + escaped.length + 3, start + escaped.length + 11);
  }
  const markers = { bold: ['**', '__'], italic: ['_', '*'], strike: ['~~'], code: ['`'] };
  for (const marker of markers[format]) {
    const outsideRun = marker.length === 1 && (value[start - 2] === marker || value[end + 1] === marker);
    const insideRun = marker.length === 1 && (selected.startsWith(marker + marker) || selected.endsWith(marker + marker));
    if (!outsideRun && value.slice(start - marker.length, start) === marker && value.slice(end, end + marker.length) === marker) {
      return replace(start - marker.length, end + marker.length, selected, start - marker.length, end - marker.length);
    }
    if (!insideRun && selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
      const text = selected.slice(marker.length, -marker.length);
      return replace(start, end, text, start, start + text.length);
    }
  }
  const marker = markers[format][0];
  return replace(start, end, marker + selected + marker, start + marker.length, end + marker.length);
}

export function moveEditorLines(value: string, selection: EditorSelection, direction: -1 | 1): EditorReplacement {
  const lineStart = selection.start === 0 ? 0 : value.lastIndexOf('\n', selection.start - 1) + 1;
  const lastSelected = selection.end > selection.start && value[selection.end - 1] === '\n' ? selection.end - 1 : selection.end;
  const newline = value.indexOf('\n', lastSelected);
  const lineEnd = newline < 0 ? value.length : newline;
  const block = value.slice(lineStart, lineEnd).replace(/\r$/u, '');
  const separator = value.includes('\r\n') ? '\r\n' : '\n';
  if (direction < 0 && lineStart > 0) {
    const previousStart = lineStart <= 1 ? 0 : value.lastIndexOf('\n', lineStart - 2) + 1;
    const previous = value.slice(previousStart, lineStart).replace(/\r?\n$/u, '');
    const shift = lineStart - previousStart;
    return { value: value.slice(0, previousStart) + block + separator + previous + value.slice(lineEnd - (value[lineEnd - 1] === '\r' ? 1 : 0)),
      start: selection.start - shift, end: selection.end - shift };
  }
  if (direction > 0 && newline >= 0) {
    const nextEnd = value.indexOf('\n', newline + 1);
    const nextLimit = nextEnd < 0 ? value.length : nextEnd;
    const next = value.slice(newline + 1, nextLimit).replace(/\r$/u, '');
    const shift = next.length + separator.length;
    return { value: value.slice(0, lineStart) + next + separator + block + value.slice(nextLimit - (value[nextLimit - 1] === '\r' ? 1 : 0)),
      start: selection.start + shift, end: Math.min(value.length, selection.end + shift) };
  }
  return { value, ...selection };
}
