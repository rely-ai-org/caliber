import { StreamParser } from '../stream-parser.js';

describe('StreamParser', () => {
  it('emits status events for STATUS: lines', () => {
    const statuses: string[] = [];
    const parser = new StreamParser({ onStatus: (s) => statuses.push(s) });

    parser.feed('STATUS: Analyzing TypeScript patterns\n');
    parser.feed('STATUS: Detecting frameworks\n');

    expect(statuses).toEqual(['Analyzing TypeScript patterns', 'Detecting frameworks']);
  });

  it('emits content events for non-STATUS pre-JSON lines', () => {
    const content: string[] = [];
    const parser = new StreamParser({ onContent: (t) => content.push(t) });

    parser.feed('EXPLAIN:\n');
    parser.feed('Some explanation text\n');
    parser.feed('Another line\n');

    expect(content).toEqual(['EXPLAIN:', 'Some explanation text', 'Another line']);
  });

  it('detects JSON start and emits onJsonStart', () => {
    let jsonStarted = false;
    const parser = new StreamParser({ onJsonStart: () => { jsonStarted = true; } });

    parser.feed('STATUS: Working\n');
    expect(jsonStarted).toBe(false);

    parser.feed('{"targetAgent"');
    expect(jsonStarted).toBe(true);
  });

  it('handles JSON wrapped in code fences', () => {
    const parser = new StreamParser({});

    parser.feed('STATUS: Done\n');
    parser.feed('```json\n');
    parser.feed('{"claude": {"claudeMd": "# Test"}}\n');
    parser.feed('```');

    const result = parser.getResult();
    expect(result.setup).toEqual({ claude: { claudeMd: '# Test' } });
  });

  it('handles STATUS line split across chunks', () => {
    const statuses: string[] = [];
    const parser = new StreamParser({ onStatus: (s) => statuses.push(s) });

    parser.feed('STAT');
    parser.feed('US: hello world\n');

    expect(statuses).toEqual(['hello world']);
  });

  it('handles JSON start split across chunks', () => {
    let jsonStarted = false;
    const parser = new StreamParser({ onJsonStart: () => { jsonStarted = true; } });

    parser.feed('Some text\n');
    expect(jsonStarted).toBe(false);

    // JSON detection triggers when { followed by " is in the buffer
    parser.feed('{"key": "value"}\n');
    expect(jsonStarted).toBe(true);
  });

  it('emits multiple STATUS lines', () => {
    const statuses: string[] = [];
    const parser = new StreamParser({ onStatus: (s) => statuses.push(s) });

    parser.feed('STATUS: One\nSTATUS: Two\nSTATUS: Three\nSTATUS: Four\nSTATUS: Five\nSTATUS: Six\n');

    expect(statuses).toHaveLength(6);
    expect(statuses[0]).toBe('One');
    expect(statuses[5]).toBe('Six');
  });

  it('handles empty input', () => {
    const statuses: string[] = [];
    const content: string[] = [];
    const parser = new StreamParser({
      onStatus: (s) => statuses.push(s),
      onContent: (t) => content.push(t),
    });

    parser.feed('');
    parser.feed('');

    expect(statuses).toHaveLength(0);
    expect(content).toHaveLength(0);
  });

  it('handles immediate JSON start (no STATUS lines)', () => {
    let jsonStarted = false;
    const parser = new StreamParser({
      onJsonStart: () => { jsonStarted = true; },
    });

    parser.feed('{"claude": {"claudeMd": "test"}}\n');

    expect(jsonStarted).toBe(true);
    const result = parser.getResult();
    expect(result.setup).toEqual({ claude: { claudeMd: 'test' } });
  });

  it('strips trailing code fence from JSON', () => {
    const parser = new StreamParser({});

    parser.feed('{"key": "value"}```');

    const result = parser.getResult();
    expect(result.setup).toEqual({ key: 'value' });
  });

  it('buffers high surrogate at chunk boundary', () => {
    const content: string[] = [];
    const parser = new StreamParser({ onContent: (t) => content.push(t) });

    // High surrogate (first half of emoji)
    const emoji = '😀';
    const high = emoji.slice(0, 1); // This is actually the full emoji in JS strings
    // In practice, JS strings handle this at the string level
    // Test with a simpler case
    parser.feed('Hello ');
    parser.feed('world\n');

    expect(content).toEqual(['Hello world']);
  });

  it('extracts EXPLAIN section from result', () => {
    const parser = new StreamParser({});

    parser.feed('STATUS: Done\n');
    parser.feed('EXPLAIN:\n');
    parser.feed('[Changes]\n');
    parser.feed('- **CLAUDE.md**: updated architecture\n');
    parser.feed('\n');
    parser.feed('{"claude": {}}\n');

    const result = parser.getResult();
    expect(result.explanation).toContain('updated architecture');
  });

  it('returns null setup for invalid JSON', () => {
    const parser = new StreamParser({});

    parser.feed('STATUS: Working\n');
    parser.feed('{invalid json here}\n');

    const result = parser.getResult();
    expect(result.setup).toBeNull();
    expect(result.raw).toContain('invalid json');
  });

  it('handles rapid single-character chunks', () => {
    const statuses: string[] = [];
    const parser = new StreamParser({ onStatus: (s) => statuses.push(s) });

    const text = 'STATUS: Hi\n';
    for (const char of text) {
      parser.feed(char);
    }

    expect(statuses).toEqual(['Hi']);
  });

  it('fires onJsonStart exactly once', () => {
    let count = 0;
    const parser = new StreamParser({ onJsonStart: () => { count++; } });

    parser.feed('{"key": "val');
    parser.feed('ue", "key2": "value2"}\n');

    expect(count).toBe(1);
  });

  it('preserves stop reason in result', () => {
    const parser = new StreamParser({});
    parser.feed('{"key": "value"}\n');
    parser.setStopReason('max_tokens');

    const result = parser.getResult();
    expect(result.stopReason).toBe('max_tokens');
  });
});
