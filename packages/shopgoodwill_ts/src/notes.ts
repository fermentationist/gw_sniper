/**
 * Watchlist "note" field. The site allows ~500 chars of free text per
 * watchlist entry — automated tools stuff JSON in there since it's the only
 * writable per-item storage.
 */

export interface NoteCodec<T> {
  parse(raw: string): T | undefined;
  serialize(value: T): string;
}

export function jsonNoteCodec<T>(): NoteCodec<T> {
  return {
    parse(raw: string): T | undefined {
      const trimmed = raw.trim();
      if (!trimmed) return undefined;
      if (trimmed[0] !== "{" && trimmed[0] !== "[") return undefined;
      try {
        return JSON.parse(trimmed) as T;
      } catch {
        return undefined;
      }
    },
    serialize(value: T): string {
      return JSON.stringify(value);
    },
  };
}

export const stringNoteCodec: NoteCodec<string> = {
  parse: (raw) => raw,
  serialize: (value) => value,
};
