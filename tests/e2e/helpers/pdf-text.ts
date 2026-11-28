import { inflateRawSync, inflateSync } from 'node:zlib';

interface PdfObject {
  id: number;
  body: string;
  stream?: Buffer;
}

interface ToUnicodeMap {
  entries: Map<string, string>;
  codeByteLengths: number[];
}

export interface ExtractedPdf {
  pageCount: number;
  pages: string[];
  text: string;
}

function inflatePdfStream(raw: Buffer, dict: string): Buffer {
  if (!/\/Filter\b/.test(dict) || !/\/FlateDecode\b/.test(dict)) {
    return raw;
  }
  try {
    return inflateSync(raw);
  } catch {
    return inflateRawSync(raw);
  }
}

/**
 * Parse indirect PDF objects (`<id> <gen> obj ... endobj`), accurately slicing
 * binary `stream ... endstream` payloads using direct or indirect `/Length`.
 */
function parsePdfObjects(pdf: Buffer): Map<number, PdfObject> {
  const header = pdf.subarray(0, 8).toString('latin1');
  if (!header.startsWith('%PDF-')) {
    throw new Error('Invalid PDF buffer: missing %PDF- header.');
  }

  const objects = new Map<number, PdfObject>();
  const latin1 = pdf.toString('latin1');

  // Pre-collect standalone integer objects so indirect `/Length N 0 R` values
  // can be resolved even when object N appears after its stream.
  const integerObjects = new Map<number, number>();
  for (const intMatch of latin1.matchAll(/(?:^|[\r\n\s])(\d+)\s+\d+\s+obj\s+(\d+)\s+endobj\b/g)) {
    integerObjects.set(Number(intMatch[1]), Number(intMatch[2]));
  }

  const objStartRe = /(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj(?:\s|<<|\[|\(|\/)/g;

  let match: RegExpExecArray | null;
  while ((match = objStartRe.exec(latin1)) !== null) {
    const id = Number(match[1]);
    const matchText = match[0];
    const objKeywordOffset = matchText.indexOf('obj');
    const bodyStart = match.index + objKeywordOffset + 3;

    // Look for either `stream` or `endobj` from bodyStart.
    const nextEndObj = latin1.indexOf('endobj', bodyStart);
    if (nextEndObj === -1) break;

    const candidateHeader = latin1.slice(bodyStart, nextEndObj);
    const streamMatch = /\bstream(?:\r\n|\n|\r)/.exec(candidateHeader);

    if (!streamMatch) {
      objects.set(id, { id, body: candidateHeader.trim() });
      objStartRe.lastIndex = nextEndObj + 6;
      continue;
    }

    const dictPart = candidateHeader.slice(0, streamMatch.index).trim();
    const streamDataStart = bodyStart + streamMatch.index + streamMatch[0].length;

    let streamDataEnd = -1;
    let declaredLength: number | null = null;
    const lengthVal = getDictValue(dictPart, 'Length');
    if (lengthVal) {
      const indirectLenId = parseIndirectRef(lengthVal);
      if (indirectLenId !== null) {
        declaredLength = integerObjects.get(indirectLenId) ?? null;
      } else if (/^\d+$/.test(lengthVal)) {
        declaredLength = Number(lengthVal);
      }
    }

    if (declaredLength !== null) {
      const expectedEnd = streamDataStart + declaredLength;
      if (expectedEnd <= pdf.length) {
        const trailing = latin1.slice(expectedEnd, expectedEnd + 32);
        if (/^[\r\n\s]*endstream\b/.test(trailing)) {
          streamDataEnd = expectedEnd;
        }
      }
    }

    if (streamDataEnd === -1) {
      const endStreamIdx = latin1.indexOf('endstream', streamDataStart);
      if (endStreamIdx === -1) break;
      streamDataEnd = endStreamIdx;
      while (
        streamDataEnd > streamDataStart
        && (pdf[streamDataEnd - 1] === 0x0a || pdf[streamDataEnd - 1] === 0x0d)
      ) {
        streamDataEnd -= 1;
      }
    }

    const rawStream = pdf.subarray(streamDataStart, streamDataEnd);
    const decodedStream = inflatePdfStream(rawStream, dictPart);
    objects.set(id, { id, body: dictPart, stream: decodedStream });

    const afterEndStream = latin1.indexOf('endstream', streamDataEnd);
    const actualEndObj = afterEndStream === -1 ? -1 : latin1.indexOf('endobj', afterEndStream + 9);
    if (actualEndObj === -1) break;
    objStartRe.lastIndex = actualEndObj + 6;
  }

  return objects;
}

/** Extract the balanced `<< ... >>` or `[ ... ]` block starting at `startIndex`. */
function readBalanced(text: string, startIndex: number, open: string, close: string): string | null {
  if (!text.startsWith(open, startIndex)) return null;
  let depth = 0;
  let i = startIndex;
  while (i < text.length) {
    if (text[i] === '(') {
      // Skip PDF literal string so parentheses/brackets inside strings do not confuse depth.
      i += 1;
      let parenDepth = 1;
      while (i < text.length && parenDepth > 0) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === '(') parenDepth += 1;
        else if (text[i] === ')') parenDepth -= 1;
        i += 1;
      }
      continue;
    }
    if (text.startsWith(open, i)) {
      depth += 1;
      i += open.length;
      continue;
    }
    if (text.startsWith(close, i)) {
      depth -= 1;
      i += close.length;
      if (depth === 0) {
        return text.slice(startIndex, i);
      }
      continue;
    }
    i += 1;
  }
  return null;
}

function getDictValue(dict: string, key: string): string | null {
  const re = new RegExp(`/${key}(?![A-Za-z0-9_])\\s*`);
  const match = re.exec(dict);
  if (!match) return null;
  const pos = match.index + match[0].length;
  if (dict.startsWith('<<', pos)) {
    return readBalanced(dict, pos, '<<', '>>');
  }
  if (dict[pos] === '[') {
    return readBalanced(dict, pos, '[', ']');
  }
  const refMatch = /^(\d+)\s+\d+\s+R\b/.exec(dict.slice(pos));
  if (refMatch) return refMatch[0];
  const tokenMatch = /^[^\s/\]>]+/.exec(dict.slice(pos));
  return tokenMatch ? tokenMatch[0] : null;
}

function parseIndirectRef(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d+)\s+\d+\s+R$/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

function resolveDictBlock(value: string | null, objects: Map<number, PdfObject>): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('<<')) return trimmed;
  const refId = parseIndirectRef(trimmed);
  if (refId === null) return null;
  return objects.get(refId)?.body ?? null;
}

function decodeUtf16BeHex(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length === 0) return '';
  if (clean.length === 2) {
    return String.fromCharCode(parseInt(clean, 16));
  }
  const padded = clean.length % 2 === 1 ? `0${clean}` : clean;
  const buf = Buffer.from(padded, 'hex');
  if (buf.length % 2 === 1) {
    return buf.toString('latin1');
  }
  const swapped = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i += 2) {
    swapped[i] = buf[i + 1];
    swapped[i + 1] = buf[i];
  }
  return swapped.toString('utf16le');
}

function incrementHexCode(hex: string, delta: number): string {
  const clean = hex.replace(/\s+/g, '');
  const value = BigInt(`0x${clean}`) + BigInt(delta);
  return value.toString(16).toUpperCase().padStart(clean.length, '0');
}

/** Parse a PDF `/ToUnicode` CMap stream (`beginbfchar` / `beginbfrange`). */
export function parseToUnicodeCMap(cmapText: string): ToUnicodeMap {
  const entries = new Map<string, string>();
  const lengths = new Set<number>();

  for (const section of cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const body = section[1];
    for (const pair of body.matchAll(/<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>/g)) {
      const src = pair[1].replace(/\s+/g, '').toUpperCase();
      const dst = pair[2].replace(/\s+/g, '');
      if (src.length % 2 === 0 && src.length > 0) {
        entries.set(src, decodeUtf16BeHex(dst));
        lengths.add(src.length / 2);
      }
    }
  }

  for (const section of cmapText.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = section[1];
    // Handle both `<start> <end> <dstStart>` and `<start> <end> [<dst1> <dst2> ...]`
    const rangeRe = /<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>\s*(?:<([0-9A-Fa-f\s]+)>|\[([\s\S]*?)\])/g;
    for (const match of body.matchAll(rangeRe)) {
      const startHex = match[1].replace(/\s+/g, '').toUpperCase();
      const endHex = match[2].replace(/\s+/g, '').toUpperCase();
      if (startHex.length === 0 || startHex.length !== endHex.length || startHex.length % 2 !== 0) {
        continue;
      }
      const start = parseInt(startHex, 16);
      const end = parseInt(endHex, 16);
      const byteLen = startHex.length / 2;
      if (Number.isNaN(start) || Number.isNaN(end) || end < start || end - start > 65535) {
        continue;
      }
      lengths.add(byteLen);

      if (match[3] !== undefined) {
        const dstStartHex = match[3].replace(/\s+/g, '');
        for (let code = start; code <= end; code += 1) {
          const srcKey = code.toString(16).toUpperCase().padStart(startHex.length, '0');
          const dstHex = incrementHexCode(dstStartHex, code - start);
          entries.set(srcKey, decodeUtf16BeHex(dstHex));
        }
      } else if (match[4] !== undefined) {
        const dstList = [...match[4].matchAll(/<([0-9A-Fa-f\s]+)>/g)].map(m => m[1].replace(/\s+/g, ''));
        for (let i = 0; i < dstList.length && start + i <= end; i += 1) {
          const srcKey = (start + i).toString(16).toUpperCase().padStart(startHex.length, '0');
          entries.set(srcKey, decodeUtf16BeHex(dstList[i]));
        }
      }
    }
  }

  const codeByteLengths = [...lengths].sort((a, b) => b - a);
  return { entries, codeByteLengths };
}

function decodeBytesWithCMap(bytes: Buffer, cmap?: ToUnicodeMap): string {
  if (!cmap || cmap.entries.size === 0 || cmap.codeByteLengths.length === 0) {
    return bytes.toString('latin1');
  }
  const hex = bytes.toString('hex').toUpperCase();
  let out = '';
  let offset = 0;
  while (offset < hex.length) {
    let matched = false;
    for (const byteLen of cmap.codeByteLengths) {
      const charLen = byteLen * 2;
      if (offset + charLen <= hex.length) {
        const slice = hex.slice(offset, offset + charLen);
        const mapped = cmap.entries.get(slice);
        if (mapped !== undefined) {
          out += mapped;
          offset += charLen;
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      // Fallback: consume smallest known code unit (or 1 byte) as Latin-1 if printable.
      const stepBytes = cmap.codeByteLengths[cmap.codeByteLengths.length - 1] ?? 1;
      const stepChars = Math.min(stepBytes * 2, hex.length - offset);
      const codePoint = parseInt(hex.slice(offset, offset + stepChars), 16);
      if (codePoint >= 0x20 && codePoint <= 0x7e) {
        out += String.fromCharCode(codePoint);
      }
      offset += stepChars;
    }
  }
  return out;
}

type ContentToken =
  | { kind: 'string'; bytes: Buffer }
  | { kind: 'array'; items: ContentToken[] }
  | { kind: 'name'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'op'; value: string };

function decodePdfLiteralString(stream: string, start: number): { bytes: Buffer; nextIndex: number } {
  const out: number[] = [];
  let depth = 1;
  let i = start + 1;
  while (i < stream.length && depth > 0) {
    const ch = stream[i];
    if (ch === '\\') {
      i += 1;
      if (i >= stream.length) break;
      const esc = stream[i];
      if (esc === '\r') {
        if (stream[i + 1] === '\n') i += 2;
        else i += 1;
        continue;
      }
      if (esc === '\n') {
        i += 1;
        continue;
      }
      if (esc === 'n') { out.push(0x0a); i += 1; continue; }
      if (esc === 'r') { out.push(0x0d); i += 1; continue; }
      if (esc === 't') { out.push(0x09); i += 1; continue; }
      if (esc === 'b') { out.push(0x08); i += 1; continue; }
      if (esc === 'f') { out.push(0x0c); i += 1; continue; }
      if (esc >= '0' && esc <= '7') {
        let octal = esc;
        i += 1;
        for (let k = 0; k < 2 && i < stream.length && stream[i] >= '0' && stream[i] <= '7'; k += 1) {
          octal += stream[i];
          i += 1;
        }
        out.push(parseInt(octal, 8) & 0xff);
        continue;
      }
      out.push(esc.charCodeAt(0) & 0xff);
      i += 1;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      out.push(0x28);
      i += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth > 0) out.push(0x29);
      i += 1;
      continue;
    }
    out.push(ch.charCodeAt(0) & 0xff);
    i += 1;
  }
  return { bytes: Buffer.from(out), nextIndex: i };
}

function decodePdfHexString(stream: string, start: number): { bytes: Buffer; nextIndex: number } {
  const end = stream.indexOf('>', start + 1);
  const rawHex = (end === -1 ? stream.slice(start + 1) : stream.slice(start + 1, end)).replace(/\s+/g, '');
  const padded = rawHex.length % 2 === 1 ? `${rawHex}0` : rawHex;
  return {
    bytes: Buffer.from(padded, 'hex'),
    nextIndex: end === -1 ? stream.length : end + 1,
  };
}

function tokenizeContentStream(stream: string): ContentToken[] {
  const tokens: ContentToken[] = [];
  let i = 0;

  const isDelimiter = (ch: string) => /\s|[()<>[\]{}/%]/.test(ch);

  const skipWhitespaceAndComments = () => {
    while (i < stream.length) {
      const ch = stream[i];
      if (/\s/.test(ch)) {
        i += 1;
        continue;
      }
      if (ch === '%') {
        while (i < stream.length && stream[i] !== '\n' && stream[i] !== '\r') i += 1;
        continue;
      }
      break;
    }
  };

  const readToken = (): ContentToken | null => {
    skipWhitespaceAndComments();
    if (i >= stream.length) return null;

    const ch = stream[i];
    if (ch === '(') {
      const { bytes, nextIndex } = decodePdfLiteralString(stream, i);
      i = nextIndex;
      return { kind: 'string', bytes };
    }
    if (ch === '<') {
      if (stream[i + 1] === '<') {
        // Inline dictionary (e.g., marked content properties): skip balanced `<< ... >>`.
        const block = readBalanced(stream, i, '<<', '>>');
        i += block ? block.length : 2;
        return readToken();
      }
      const { bytes, nextIndex } = decodePdfHexString(stream, i);
      i = nextIndex;
      return { kind: 'string', bytes };
    }
    if (ch === '[') {
      i += 1;
      const items: ContentToken[] = [];
      while (i < stream.length) {
        skipWhitespaceAndComments();
        if (i >= stream.length) break;
        if (stream[i] === ']') {
          i += 1;
          break;
        }
        const item = readToken();
        if (item) items.push(item);
      }
      return { kind: 'array', items };
    }
    if (ch === ']') {
      i += 1;
      return readToken();
    }
    if (ch === '/') {
      i += 1;
      const start = i;
      while (i < stream.length && !isDelimiter(stream[i])) i += 1;
      return { kind: 'name', value: stream.slice(start, i) };
    }

    const start = i;
    while (i < stream.length && !isDelimiter(stream[i])) i += 1;
    const raw = stream.slice(start, i);
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) {
      return { kind: 'number', value: Number(raw) };
    }
    return { kind: 'op', value: raw };
  };

  while (i < stream.length) {
    const token = readToken();
    if (!token) break;
    tokens.push(token);
  }
  return tokens;
}

function buildResourceMaps(
  resourcesDict: string | null,
  objects: Map<number, PdfObject>,
  cmapCache: Map<number, ToUnicodeMap>,
): { fonts: Map<string, ToUnicodeMap | undefined>; xObjects: Map<string, number> } {
  const fonts = new Map<string, ToUnicodeMap | undefined>();
  const xObjects = new Map<string, number>();
  if (!resourcesDict) return { fonts, xObjects };

  const fontDict = resolveDictBlock(getDictValue(resourcesDict, 'Font'), objects);
  if (fontDict) {
    for (const match of fontDict.matchAll(/\/([A-Za-z0-9_.-]+)\s+(\d+)\s+\d+\s+R\b/g)) {
      const fontName = match[1];
      const fontObjId = Number(match[2]);
      if (cmapCache.has(fontObjId)) {
        fonts.set(fontName, cmapCache.get(fontObjId));
        continue;
      }
      const fontObj = objects.get(fontObjId);
      let cmap: ToUnicodeMap | undefined;
      if (fontObj) {
        const toUnicodeId = parseIndirectRef(getDictValue(fontObj.body, 'ToUnicode'));
        const toUnicodeObj = toUnicodeId !== null ? objects.get(toUnicodeId) : undefined;
        if (toUnicodeObj?.stream) {
          cmap = parseToUnicodeCMap(toUnicodeObj.stream.toString('latin1'));
        }
      }
      if (cmap) cmapCache.set(fontObjId, cmap);
      fonts.set(fontName, cmap);
    }
  }

  const xObjDict = resolveDictBlock(getDictValue(resourcesDict, 'XObject'), objects);
  if (xObjDict) {
    for (const match of xObjDict.matchAll(/\/([A-Za-z0-9_.-]+)\s+(\d+)\s+\d+\s+R\b/g)) {
      xObjects.set(match[1], Number(match[2]));
    }
  }

  return { fonts, xObjects };
}

function extractStreamText(
  streamText: string,
  resourcesDict: string | null,
  objects: Map<number, PdfObject>,
  cmapCache: Map<number, ToUnicodeMap>,
  visitedXObjects: Set<number>,
): string {
  const { fonts, xObjects } = buildResourceMaps(resourcesDict, objects, cmapCache);
  const tokens = tokenizeContentStream(streamText);
  const operands: ContentToken[] = [];
  let currentFont: string | null = null;
  let currentFontSize = 12;
  let tmScale = 1;
  let lastTmY: number | null = null;
  const pieces: string[] = [];

  const appendBreak = (ch: '\n' | ' ') => {
    const last = pieces[pieces.length - 1];
    if (!last || last.endsWith('\n') || (ch === ' ' && last.endsWith(' '))) return;
    pieces.push(ch);
  };

  for (const token of tokens) {
    if (token.kind !== 'op') {
      operands.push(token);
      continue;
    }

    const op = token.value;
    if (op === 'Tf') {
      const nameTok = operands[operands.length - 2];
      const sizeTok = operands[operands.length - 1];
      if (nameTok?.kind === 'name') {
        currentFont = nameTok.value;
      }
      if (sizeTok?.kind === 'number' && sizeTok.value > 0) {
        currentFontSize = sizeTok.value;
      }
    } else if (op === 'BT') {
      tmScale = 1;
      lastTmY = null;
    } else if (op === 'ET') {
      appendBreak('\n');
    } else if (op === 'T*') {
      appendBreak('\n');
    } else if (op === 'Td' || op === 'TD') {
      const ty = operands[operands.length - 1];
      const effectiveSize = currentFontSize * tmScale;
      if (ty?.kind === 'number' && Math.abs(ty.value) > effectiveSize * 0.45) {
        appendBreak('\n');
      }
    } else if (op === 'Tm') {
      const a = operands[operands.length - 6];
      const b = operands[operands.length - 5];
      const f = operands[operands.length - 1];
      if (a?.kind === 'number' && b?.kind === 'number') {
        const scale = Math.hypot(a.value, b.value);
        if (scale > 0) tmScale = scale;
      }
      if (f?.kind === 'number') {
        const effectiveSize = currentFontSize * tmScale;
        if (lastTmY !== null && Math.abs(f.value - lastTmY) > effectiveSize * 0.45) {
          appendBreak('\n');
        }
        lastTmY = f.value;
      }
    } else if (op === 'Tj' || op === '\'' || op === '"') {
      if (op === '\'' || op === '"') appendBreak('\n');
      const strTok = operands[operands.length - 1];
      if (strTok?.kind === 'string') {
        const cmap = currentFont ? fonts.get(currentFont) : undefined;
        pieces.push(decodeBytesWithCMap(strTok.bytes, cmap));
      }
    } else if (op === 'TJ') {
      const arrTok = operands[operands.length - 1];
      if (arrTok?.kind === 'array') {
        const cmap = currentFont ? fonts.get(currentFont) : undefined;
        for (const item of arrTok.items) {
          if (item.kind === 'string') {
            pieces.push(decodeBytesWithCMap(item.bytes, cmap));
          } else if (item.kind === 'number' && item.value <= -200) {
            appendBreak(' ');
          }
        }
      }
    } else if (op === 'Do') {
      const nameTok = operands[operands.length - 1];
      if (nameTok?.kind === 'name') {
        const xObjId = xObjects.get(nameTok.value);
        if (xObjId !== undefined && !visitedXObjects.has(xObjId)) {
          const xObj = objects.get(xObjId);
          if (xObj?.stream && /\/Subtype\s*\/Form\b/.test(xObj.body)) {
            visitedXObjects.add(xObjId);
            try {
              const nestedResources = resolveDictBlock(getDictValue(xObj.body, 'Resources'), objects) ?? resourcesDict;
              const nested = extractStreamText(
                xObj.stream.toString('latin1'),
                nestedResources,
                objects,
                cmapCache,
                visitedXObjects,
              );
              if (nested) pieces.push(nested);
            } finally {
              visitedXObjects.delete(xObjId);
            }
          }
        }
      }
    }

    operands.length = 0;
  }

  return pieces.join('');
}

function collectPagesInOrder(
  nodeId: number,
  inheritedResources: string | null,
  objects: Map<number, PdfObject>,
  visited: Set<number>,
): Array<{ obj: PdfObject; resources: string | null }> {
  if (visited.has(nodeId)) return [];
  visited.add(nodeId);
  const node = objects.get(nodeId);
  if (!node) return [];

  const ownResources = resolveDictBlock(getDictValue(node.body, 'Resources'), objects) ?? inheritedResources;
  if (/\/Type\s*\/Page\b(?!s)/.test(node.body)) {
    return [{ obj: node, resources: ownResources }];
  }

  const kidsRaw = getDictValue(node.body, 'Kids');
  if (!kidsRaw) return [];
  const results: Array<{ obj: PdfObject; resources: string | null }> = [];
  for (const match of kidsRaw.matchAll(/(\d+)\s+\d+\s+R\b/g)) {
    results.push(...collectPagesInOrder(Number(match[1]), ownResources, objects, visited));
  }
  return results;
}

/**
 * Extract ordered plain text from a Chromium/Skia (or standard FlateDecode +
 * ToUnicode CMap) PDF buffer in memory, without external binaries or packages.
 */
export function extractPdfText(pdfBuffer: Buffer): ExtractedPdf {
  const objects = parsePdfObjects(pdfBuffer);
  const cmapCache = new Map<number, ToUnicodeMap>();

  // Locate /Catalog -> /Pages for canonical page order; fall back to numeric order if absent.
  let orderedPages: Array<{ obj: PdfObject; resources: string | null }> = [];
  for (const obj of objects.values()) {
    if (/\/Type\s*\/Catalog\b/.test(obj.body)) {
      const pagesRootId = parseIndirectRef(getDictValue(obj.body, 'Pages'));
      if (pagesRootId !== null) {
        orderedPages = collectPagesInOrder(pagesRootId, null, objects, new Set());
      }
      break;
    }
  }

  if (orderedPages.length === 0) {
    for (const obj of [...objects.values()].sort((a, b) => a.id - b.id)) {
      if (/\/Type\s*\/Page\b(?!s)/.test(obj.body)) {
        const res = resolveDictBlock(getDictValue(obj.body, 'Resources'), objects);
        orderedPages.push({ obj, resources: res });
      }
    }
  }

  const pages: string[] = [];
  for (const { obj, resources } of orderedPages) {
    const contentsVal = getDictValue(obj.body, 'Contents');
    const contentIds: number[] = [];
    if (contentsVal) {
      const singleId = parseIndirectRef(contentsVal);
      if (singleId !== null) {
        const target = objects.get(singleId);
        if (target && !target.stream && target.body.startsWith('[')) {
          for (const m of target.body.matchAll(/(\d+)\s+\d+\s+R\b/g)) {
            contentIds.push(Number(m[1]));
          }
        } else {
          contentIds.push(singleId);
        }
      } else {
        for (const m of contentsVal.matchAll(/(\d+)\s+\d+\s+R\b/g)) {
          contentIds.push(Number(m[1]));
        }
      }
    }

    const streamParts: string[] = [];
    for (const contentId of contentIds) {
      const contentObj = objects.get(contentId);
      if (!contentObj?.stream) continue;
      streamParts.push(contentObj.stream.toString('latin1'));
    }
    const pageText = streamParts.length > 0
      ? extractStreamText(
        streamParts.join('\n'),
        resources,
        objects,
        cmapCache,
        new Set<number>(),
      )
      : '';
    pages.push(pageText);
  }

  return {
    pageCount: pages.length,
    pages,
    text: pages.join('\n'),
  };
}

/** Collapse PDF line-wrap whitespace and expand compatibility ligatures (e.g. fi/fl) for ordered-substring checks. */
export function normalizePdfText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
}
