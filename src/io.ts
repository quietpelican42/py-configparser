/**
 * Decoding and line splitting that match what Python's `open()` and
 * `io.StringIO` hand to `configparser`.
 */
import { readFileSync } from 'node:fs';

/** Splits on `\n` only, keeping each terminator: the lines `io.StringIO` iterates. */
export function* splitLines(text: string): Generator<string> {
  let i = 0;
  while (i < text.length) {
    const j = text.indexOf('\n', i);
    if (j < 0) {
      yield text.slice(i);
      return;
    }
    yield text.slice(i, j + 1);
    i = j + 1;
  }
}

/** Universal-newline translation: `\r\n` and lone `\r` become `\n`. */
export function universalNewlines(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

const ALIASES: Record<string, string> = {
  'utf-8': 'utf-8',
  utf8: 'utf-8',
  'utf-8-sig': 'utf-8-sig',
  utf8sig: 'utf-8-sig',
  'latin-1': 'latin-1',
  latin1: 'latin-1',
  'iso-8859-1': 'latin-1',
  ascii: 'ascii',
  'us-ascii': 'ascii',
  'utf-16le': 'utf-16le',
  'utf-16-le': 'utf-16le',
  'utf-16be': 'utf-16be',
  'utf-16-be': 'utf-16be',
};

/**
 * Decodes bytes like Python's codecs. Invalid input throws (Python raises
 * `UnicodeDecodeError`). `utf-8` keeps a BOM as U+FEFF; `utf-8-sig` drops it.
 */
export function decodeBytes(bytes: Uint8Array, encoding = 'utf-8'): string {
  const enc = ALIASES[encoding.toLowerCase()];
  if (enc === undefined) {
    throw new RangeError(`unsupported encoding ${JSON.stringify(encoding)}; supported: utf-8, utf-8-sig, latin-1, ascii, utf-16le, utf-16be`);
  }
  try {
    switch (enc) {
      case 'utf-8':
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      case 'utf-8-sig':
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
      case 'utf-16le':
      case 'utf-16be':
        return new TextDecoder(enc, { fatal: true, ignoreBOM: true }).decode(bytes);
      case 'ascii':
        for (const b of bytes) {
          if (b > 0x7f) throw new Error(`'ascii' codec can't decode byte 0x${b.toString(16).padStart(2, '0')}: ordinal not in range(128)`);
        }
        return Buffer.from(bytes).toString('latin1');
      default:
        return Buffer.from(bytes).toString('latin1');
    }
  } catch (e) {
    const err = new Error(`${encoding} decode failed: ${(e as Error).message}`);
    err.name = 'UnicodeDecodeError';
    throw err;
  }
}

/** File contents, or `null` if the file cannot be opened or read (Python skips on `OSError`). */
export function readFileBytes(path: string | URL): Uint8Array | null {
  try {
    return readFileSync(path);
  } catch (e) {
    if (e !== null && typeof e === 'object' && 'code' in e) return null;
    throw e;
  }
}
