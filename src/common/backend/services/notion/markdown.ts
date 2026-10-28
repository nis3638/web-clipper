import { generateUuid } from '@web-clipper/shared/lib/uuid';
import { NotionOperation } from './types';
/**
 * Markdown → Notion block conversion.
 *
 * Notion retired the `importFile`/`ReplaceBlock` enqueueTask flow, so imported
 * content is now written the same way the Notion client does: markdown is
 * parsed into blocks locally and committed directly via saveTransactionsFanout.
 */

export type NotionRichText = Array<[string, string[][]?]>;

export interface NotionBlockNode {
  type: string;
  properties?: Record<string, NotionRichText>;
  format?: Record<string, unknown>;
  children?: NotionBlockNode[];
}

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)\d+[.)]\s+(.*)$/;
const TODO = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const DIVIDER = /^(\*{3,}|-{3,}|_{3,})$/;
const IMAGE_ONLY = /^!\[[^\]]*\]\([^)]+\)\s*$/;
const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)\s*$/;

const CODE_LANGUAGES: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  json: 'JSON',
  py: 'Python',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  yaml: 'YAML',
  yml: 'YAML',
  md: 'Markdown',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  c: 'C',
  cpp: 'C++',
  cs: 'C#',
  rb: 'Ruby',
  php: 'PHP',
  swift: 'Swift',
};

function headingType(level: number): string {
  if (level <= 1) return 'header';
  if (level === 2) return 'sub_header';
  return 'sub_sub_header';
}

/**
 * Convert one line's inline markdown (bold, italic, code, strike, links) into
 * Notion rich text segments: `[text, decorations?]` pairs.
 */
export function parseInline(text: string): NotionRichText {
  const segments: NotionRichText = [];
  let plain = '';
  const flush = () => {
    if (plain) {
      segments.push([plain]);
      plain = '';
    }
  };
  const pattern =
    /(\*\*|__)(.+?)\1|(\*|_)([^*_]+?)\3|`([^`]+)`|(~~)(.+?)\6|\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
  let match: RegExpExecArray | null;
  let cursor = 0;
  // eslint-disable-next-line no-cond-assign
  while ((match = pattern.exec(text))) {
    plain += text.slice(cursor, match.index);
    cursor = pattern.lastIndex;
    if (match[2] !== undefined) {
      flush();
      const inner = parseInline(match[2]).map(([t, decs]) => [t, [...(decs || []), ['b']]] as [string, string[][]]);
      segments.push(...inner);
    } else if (match[4] !== undefined) {
      flush();
      const inner = parseInline(match[4]).map(([t, decs]) => [t, [...(decs || []), ['i']]] as [string, string[][]]);
      segments.push(...inner);
    } else if (match[5] !== undefined) {
      flush();
      segments.push([match[5], [['c']]]);
    } else if (match[7] !== undefined) {
      flush();
      segments.push([match[7], [['s']]]);
    } else if (match[9] !== undefined) {
      flush();
      const label = match[8] || match[9];
      segments.push([label, [['a', match[9]]]]);
    }
  }
  plain += text.slice(cursor);
  flush();
  if (segments.length === 0) {
    return [['']];
  }
  return segments;
}

interface ParsedLine {
  indent: number;
  block: NotionBlockNode;
}

function parseListItem(match: RegExpMatchArray, text: string): ParsedLine {
  const indent = Math.floor(match[1].replace(/\t/g, '  ').length / 2);
  return { indent, block: { type: 'bulleted_list', properties: { title: parseInline(text) } } };
}

function toBlock(line: string): ParsedLine | undefined {
  const raw = line.replace(/\s+$/, '');
  if (!raw.trim()) return undefined;

  let match: RegExpMatchArray | null;
  if (DIVIDER.test(raw.trim())) {
    return { indent: 0, block: { type: 'divider' } };
  }
  if ((match = raw.match(TODO))) {
    const indent = Math.floor(match[1].replace(/\t/g, '  ').length / 2);
    const properties: Record<string, NotionRichText> = { title: parseInline(match[3]) };
    if (match[2].toLowerCase() === 'x') {
      properties.checked = [['Yes']];
    }
    return { indent, block: { type: 'to_do', properties } };
  }
  if ((match = raw.match(BULLET))) {
    return parseListItem(match, match[2]);
  }
  if ((match = raw.match(NUMBERED))) {
    const indent = Math.floor(match[1].replace(/\t/g, '  ').length / 2);
    return { indent, block: { type: 'numbered_list', properties: { title: parseInline(match[2]) } } };
  }
  if ((match = raw.match(HEADING))) {
    const indent = 0;
    return { indent, block: { type: headingType(match[1].length), properties: { title: parseInline(match[2]) } } };
  }
  if ((match = raw.match(QUOTE))) {
    return { indent: 0, block: { type: 'quote', properties: { title: parseInline(match[1]) } } };
  }
  if (IMAGE_ONLY.test(raw.trim())) {
    match = raw.trim().match(IMAGE);
    if (match) {
      const properties: Record<string, NotionRichText> = { source: [[match[2]]] };
      if (match[1]) {
        properties.caption = [[match[1]]];
      }
      return { indent: 0, block: { type: 'image', properties } };
    }
  }
  return { indent: 0, block: { type: 'text', properties: { title: parseInline(raw) } } };
}

function nestBlocks(flat: ParsedLine[]): NotionBlockNode[] {
  const root: NotionBlockNode[] = [];
  const stack: { indent: number; block: NotionBlockNode }[] = [];
  for (const { indent, block } of flat) {
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    if (stack.length === 0) {
      root.push(block);
    } else {
      const parent = stack[stack.length - 1].block;
      parent.children = parent.children || [];
      parent.children.push(block);
    }
    stack.push({ indent, block });
  }
  return root;
}export function markdownToNotionBlocks(markdown: string): NotionBlockNode[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const flat: ParsedLine[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = line.match(FENCE);
    if (fence) {
      const info = fence[3];
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].match(FENCE)) {
        codeLines.push(lines[i]);
        i += 1;
      }
      const language = CODE_LANGUAGES[info.toLowerCase()];
      flat.push({
        indent: 0,
        block: {
          type: 'code',
          properties: {
            title: [[codeLines.join('\n')]],
            ...(language ? { language: [[language]] } : {}),
          },
          format: { code_wrap: true },
        },
      });
      continue;
    }
    const parsed = toBlock(line);
    if (parsed) {
      flat.push(parsed);
    }
  }
  return nestBlocks(flat);
}

/**
 * Drop a leading heading that only repeats the clip title, mirroring what the
 * retired file import produced (the page title carries the name).
 */
export function stripLeadingTitleHeading(blocks: NotionBlockNode[], title: string): NotionBlockNode[] {
  const first = blocks[0];
  if (!first || first.type !== 'header' || !first.properties) {
    return blocks;
  }
  const headingText = first.properties.title.map(([text]) => text).join('').trim();
  if (headingText === title.trim()) {
    return blocks.slice(1);
  }
  return blocks;
}

/** Build the `set` + `listAfter` operations for a block tree. */
export function blocksToOperations(
  blocks: NotionBlockNode[],
  parentId: string,
  spaceId: string
): NotionOperation[] {
  const operations: NotionOperation[] = [];
  const walk = (nodes: NotionBlockNode[], parent: string) => {
    for (const node of nodes) {
      const id = generateUuid();
      const now = Date.now();
      const properties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node.properties || {})) {
        properties[key] = value;
      }
      operations.push({
        id,
        table: 'block',
        path: [],
        command: 'set',
        args: {
          id,
          version: 1,
          type: node.type,
          properties,
          ...(node.format ? { format: node.format } : {}),
          parent_id: parent,
          parent_table: 'block',
          alive: true,
          space_id: spaceId,
          created_time: now,
          last_edited_time: now,
        },
      });
      operations.push({
        id: parent,
        table: 'block',
        path: ['content'],
        command: 'listAfter',
        args: { id, space_id: spaceId },
      });
      if (node.children && node.children.length > 0) {
        walk(node.children, id);
      }
    }
  };
  walk(blocks, parentId);
  return operations;
}
