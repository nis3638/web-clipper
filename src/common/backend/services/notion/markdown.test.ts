import {
  blocksToOperations,
  markdownToNotionBlocks,
  parseInline,
  stripLeadingTitleHeading,
} from './markdown';

describe('parseInline', () => {
  it('keeps plain text as a single segment', () => {
    expect(parseInline('hello')).toEqual([['hello']]);
  });

  it('maps bold, italic, code, strike and links to Notion decorations', () => {
    expect(parseInline('**bold**')).toEqual([['bold', [['b']]]]);
    expect(parseInline('*italic*')).toEqual([['italic', [['i']]]]);
    expect(parseInline('`code`')).toEqual([['code', [['c']]]]);
    expect(parseInline('~~gone~~')).toEqual([['gone', [['s']]]]);
    expect(parseInline('[site](https://example.com)')).toEqual([
      ['site', [['a', 'https://example.com']]],
    ]);
  });

  it('mixes plain text with inline styles', () => {
    expect(parseInline('a **b** c')).toEqual([['a '], ['b', [['b']]], [' c']]);
  });

  it('returns an empty segment for empty input', () => {
    expect(parseInline('')).toEqual([['']]);
  });
});

describe('markdownToNotionBlocks', () => {
  it('maps headings to Notion header blocks', () => {
    const blocks = markdownToNotionBlocks('# One\n\n## Two\n\n### Three\n\n#### Four');
    expect(blocks.map((b) => b.type)).toEqual(['header', 'sub_header', 'sub_sub_header', 'sub_sub_header']);
  });

  it('converts lists, todos, quotes and dividers', () => {
    const blocks = markdownToNotionBlocks(
      '- a\n- b\n\n1. one\n\n- [ ] open\n- [x] done\n\n> quoted\n\n---'
    );
    expect(blocks.map((b) => b.type)).toEqual([
      'bulleted_list',
      'bulleted_list',
      'numbered_list',
      'to_do',
      'to_do',
      'quote',
      'divider',
    ]);
    const done = blocks.find((b) => b.type === 'to_do' && b.properties!.checked);
    expect(done!.properties!.title).toEqual([['done']]);
    const open = blocks.find((b) => b.type === 'to_do' && !b.properties!.checked);
    expect(open).toBeDefined();
  });

  it('nests list items by indentation', () => {
    const blocks = markdownToNotionBlocks('- parent\n  - child\n    - grandchild');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].children).toHaveLength(1);
    expect(blocks[0].children![0].children![0].properties!.title).toEqual([['grandchild']]);
  });

  it('converts fenced code blocks with language and wrap format', () => {
    const blocks = markdownToNotionBlocks('```ts\nconst a = 1;\nconst b = 2;\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('code');
    expect(blocks[0].properties!.title).toEqual([['const a = 1;\nconst b = 2;']]);
    expect(blocks[0].properties!.language).toEqual([['TypeScript']]);
    expect(blocks[0].format).toEqual({ code_wrap: true });
  });

  it('converts standalone images with caption', () => {
    const blocks = markdownToNotionBlocks('![alt text](https://example.com/a.png)');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('image');
    expect(blocks[0].properties!.source).toEqual([['https://example.com/a.png']]);
    expect(blocks[0].properties!.caption).toEqual([['alt text']]);
  });

  it('keeps inline markdown inside paragraphs as rich text', () => {
    const blocks = markdownToNotionBlocks('see [docs](https://example.com) now');
    expect(blocks[0].type).toBe('text');
    expect(blocks[0].properties!.title).toEqual([
      ['see '],
      ['docs', [['a', 'https://example.com']]],
      [' now'],
    ]);
  });
});

describe('stripLeadingTitleHeading', () => {
  it('drops a leading heading that matches the title', () => {
    const blocks = markdownToNotionBlocks('# Article\n\nbody');
    expect(stripLeadingTitleHeading(blocks, 'Article').map((b) => b.type)).toEqual(['text']);
  });

  it('keeps headings that differ from the title', () => {
    const blocks = markdownToNotionBlocks('# Other\n\nbody');
    expect(stripLeadingTitleHeading(blocks, 'Article')).toHaveLength(2);
  });
});

describe('blocksToOperations', () => {
  it('emits set + listAfter operations parented to the given page', () => {
    const blocks = markdownToNotionBlocks('hello\n\n- item');
    const operations = blocksToOperations(blocks, 'page-1', 'space-1');
    expect(operations).toHaveLength(4);
    const [setText, listText, setItem, listItem] = operations;
    expect(setText.command).toBe('set');
    expect((setText.args as any).parent_id).toBe('page-1');
    expect(listText.command).toBe('listAfter');
    expect(listText.id).toBe('page-1');
    expect((listText.args as any).id).toBe(setText.id);
    // top-level list item is parented to the page as well
    expect((setItem.args as any).parent_id).toBe('page-1');
    expect((listItem.args as any).id).toBe(setItem.id);
    expect(listItem.id).toBe('page-1');
  });

  it('nests children under their parent block id', () => {
    const blocks = markdownToNotionBlocks('- parent\n  - child');
    const operations = blocksToOperations(blocks, 'page-1', 'space-1');
    const setParent = operations.find((op) => op.command === 'set' && (op.args as any).type === 'bulleted_list' && (op.args as any).parent_id === 'page-1')!;
    const setChild = operations.find((op) => op.command === 'set' && (op.args as any).parent_id === setParent.id)!;
    expect(setChild).toBeDefined();
  });
});
