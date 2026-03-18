export interface StreamParserCallbacks {
  onStatus?: (status: string) => void;
  onContent?: (text: string) => void;
  onJsonStart?: () => void;
}

type ParserState = 'pre_json' | 'in_json';

export class StreamParser {
  private state: ParserState = 'pre_json';
  private preJsonBuffer = '';
  private jsonContent = '';
  private sentStatuses = 0;
  private stopReason: string | null = null;
  private pendingSurrogate = '';
  private jsonStartFired = false;

  constructor(private callbacks: StreamParserCallbacks) {}

  feed(chunk: string): void {
    if (!chunk) return;

    const safeChunk = this.handleSurrogatePairs(chunk);
    if (!safeChunk) return;

    if (this.state === 'pre_json') {
      this.preJsonBuffer += safeChunk;
      this.processPreJsonBuffer();
    } else {
      this.jsonContent += safeChunk;
    }
  }

  setStopReason(reason: string): void {
    this.stopReason = reason;
  }

  getResult(): {
    setup: Record<string, unknown> | null;
    explanation?: string;
    raw: string;
    stopReason?: string;
  } {
    let jsonToParse = (this.jsonContent || this.preJsonBuffer)
      .replace(/```\s*$/g, '')
      .trim();

    if (!this.jsonContent && this.preJsonBuffer) {
      const fallbackMatch = this.preJsonBuffer.match(
        /(?:^|\n)\s*(?:```json\s*\n\s*)?\{(?=\s*")/
      );
      if (fallbackMatch) {
        const matchIndex = this.preJsonBuffer.indexOf('{', fallbackMatch.index!);
        jsonToParse = this.preJsonBuffer.slice(matchIndex).replace(/```\s*$/g, '').trim();
      }
    }

    let setup: Record<string, unknown> | null = null;
    try {
      setup = JSON.parse(jsonToParse);
    } catch {}

    let explanation: string | undefined;
    const explainMatch = this.preJsonBuffer.match(
      /EXPLAIN:\s*\n([\s\S]*?)(?=\n\s*(`{3}|\{))/
    );
    if (explainMatch) {
      explanation = explainMatch[1].trim();
    }

    return {
      setup,
      explanation,
      raw: this.preJsonBuffer + this.jsonContent,
      stopReason: this.stopReason ?? undefined,
    };
  }

  private handleSurrogatePairs(chunk: string): string {
    if (this.pendingSurrogate) {
      chunk = this.pendingSurrogate + chunk;
      this.pendingSurrogate = '';
    }

    if (chunk.length === 0) return chunk;

    const lastChar = chunk.charCodeAt(chunk.length - 1);
    if (lastChar >= 0xd800 && lastChar <= 0xdbff) {
      this.pendingSurrogate = chunk.slice(-1);
      return chunk.slice(0, -1);
    }

    return chunk;
  }

  private processPreJsonBuffer(): void {
    const lines = this.preJsonBuffer.split('\n');
    const completedLines = lines.slice(0, -1);

    for (let i = this.sentStatuses; i < completedLines.length; i++) {
      const trimmed = completedLines[i].trim();
      if (trimmed.startsWith('STATUS:')) {
        const status = trimmed.slice(7).trim();
        if (status) this.callbacks.onStatus?.(status);
      } else if (trimmed) {
        this.callbacks.onContent?.(trimmed);
      }
    }
    this.sentStatuses = completedLines.length;

    const jsonStartMatch = this.preJsonBuffer.match(
      /(?:^|\n)\s*(?:```json\s*\n\s*)?\{(?=\s*")/
    );
    if (jsonStartMatch) {
      const matchIndex = this.preJsonBuffer.indexOf('{', jsonStartMatch.index!);
      this.state = 'in_json';
      this.jsonContent = this.preJsonBuffer.slice(matchIndex);
      if (!this.jsonStartFired) {
        this.jsonStartFired = true;
        this.callbacks.onJsonStart?.();
      }
    }
  }
}
