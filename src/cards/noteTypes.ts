import type { NoteFields, NoteType } from '../db/types';

const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

/** Cloze numbers used in a text, sorted, 1-based. */
export function clozeNumbers(text: string): number[] {
  const set = new Set<number>();
  for (const m of text.matchAll(CLOZE_RE)) set.add(Number(m[1]));
  return [...set].filter((n) => n > 0).sort((a, b) => a - b);
}

export interface OcclusionMask {
  /** Position and size as fractions (0..1) of the image. */
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

export function parseMasks(json: string | undefined): OcclusionMask[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr)
      ? arr.filter((m) => [m?.x, m?.y, m?.w, m?.h].every((v) => typeof v === 'number'))
      : [];
  } catch {
    return [];
  }
}

/** Which card ordinals a note produces. */
export function cardOrds(type: NoteType, fields: NoteFields): number[] {
  switch (type) {
    case 'basic':
    case 'typein':
      return [0];
    case 'reverse':
      return [0, 1];
    case 'optionalReverse':
      return isTruthy(fields.addReverse) && (fields.back ?? '').trim() ? [0, 1] : [0];
    case 'cloze': {
      const nums = clozeNumbers(fields.text ?? '');
      return nums.map((n) => n - 1);
    }
    case 'imageOcclusion':
      return parseMasks(fields.masks).map((_, i) => i);
  }
}

function isTruthy(v: string | undefined): boolean {
  return !!v && /^(y|yes|true|1|on)$/i.test(v.trim());
}

/** The field that identifies a note for duplicate detection. */
export function primaryField(type: NoteType, fields: NoteFields): string {
  if (type === 'cloze') return fields.text ?? '';
  if (type === 'imageOcclusion') return `${fields.image ?? ''}|${fields.masks ?? ''}`;
  return fields.front ?? '';
}

/** Normalise text so "  Revenue " and "**revenue**" count as duplicates. */
export function normalizeForChecksum(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_`~#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function noteChecksum(type: NoteType, fields: NoteFields): string {
  return normalizeForChecksum(primaryField(type, fields));
}

/** Field names that the editor shows for each note type. */
export function fieldNames(type: NoteType): string[] {
  switch (type) {
    case 'basic':
    case 'reverse':
    case 'typein':
      return ['front', 'back', 'note'];
    case 'optionalReverse':
      return ['front', 'back', 'note', 'addReverse'];
    case 'cloze':
      return ['text', 'extra'];
    case 'imageOcclusion':
      return ['image', 'header', 'extra', 'masks'];
  }
}

export { CLOZE_RE };
