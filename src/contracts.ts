import type { Root } from 'mdast';
import type { CardState } from './format-vocabulary.ts';

export interface ByteRange {
  start: number;
  end: number;
}

export interface SliceRecord {
  ver: string;
  title: string;
  heading: string;
  state: CardState;
  who: string;
  date: string;
  iter: number;
  range: ByteRange;
}

export interface ParsedDocument {
  relativePath: string;
  bytes: Uint8Array;
  text: string;
  tree: Root;
  name: string;
  slices: SliceRecord[];
}
