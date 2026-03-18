import chalk from 'chalk';
import { WAITING_CARDS, renderCard, type WaitingCard } from './waiting-content.js';

type TaskStatus = 'pending' | 'running' | 'done' | 'failed';

interface TaskState {
  name: string;
  status: TaskStatus;
  message: string;
  depth: number;
  pipelineLabel?: string;
  pipelineRow: 0 | 1;
  startTime?: number;
  endTime?: number;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;
const CARD_ADVANCE_MS = 15_000;
const NAME_COL_WIDTH = 30;
const PREFIX = '    ';

export class ParallelTaskDisplay {
  private tasks: TaskState[] = [];
  private lineCount = 0;
  private spinnerFrame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
  private rendered = false;

  private waitingEnabled = false;
  private waitingCards: WaitingCard[] = [];
  private currentCard = 0;
  private cardTimer: ReturnType<typeof setInterval> | null = null;
  private keypressHandler: ((key: Buffer) => void) | null = null;
  private cachedCardLines: string[] | null = null;
  private cachedCardIndex = -1;
  private cachedCardCols = -1;
  private cachedConnectors: string[] | null = null;

  private previewLines: string[] = [];

  add(name: string, options?: { depth?: number; pipelineLabel?: string; pipelineRow?: 0 | 1 }): number {
    const index = this.tasks.length;
    this.tasks.push({
      name,
      status: 'pending',
      message: '',
      depth: options?.depth ?? 0,
      pipelineLabel: options?.pipelineLabel,
      pipelineRow: options?.pipelineRow ?? 0,
    });
    return index;
  }

  start(): void {
    this.startTime = Date.now();
    this.draw(true);
    this.timer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.draw(false);
    }, SPINNER_INTERVAL_MS);
  }

  update(index: number, status: TaskStatus, message?: string): void {
    const task = this.tasks[index];
    if (!task) return;
    if (status === 'running' && task.status === 'pending') {
      task.startTime = Date.now();
    }
    if ((status === 'done' || status === 'failed') && !task.endTime) {
      task.endTime = Date.now();
    }
    task.status = status;
    if (message !== undefined) task.message = message;
  }

  enableWaitingContent(): void {
    if (!process.stdin.isTTY) return;

    this.waitingCards = WAITING_CARDS;
    if (this.waitingCards.length === 0) return;

    this.waitingEnabled = true;
    this.currentCard = 0;

    this.cardTimer = setInterval(() => {
      this.advanceCard(1);
    }, CARD_ADVANCE_MS);

    const { stdin } = process;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    this.keypressHandler = (key: Buffer) => {
      const str = String(key);
      switch (str) {
        case '\x1b[C':
        case 'n':
          this.advanceCard(1);
          this.resetCardTimer();
          break;
        case '\x1b[D':
        case 'p':
          this.advanceCard(-1);
          this.resetCardTimer();
          break;
        case '\x03':
          this.disableWaitingContent();
          process.kill(process.pid, 'SIGINT');
          break;
      }
    };

    stdin.on('data', this.keypressHandler);
  }

  setPreviewContent(lines: string[]): void {
    this.previewLines = lines;
  }

  stop(): void {
    this.disableWaitingContent();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.draw(false);
  }

  private advanceCard(offset: number): void {
    this.currentCard = (this.currentCard + offset + this.waitingCards.length) % this.waitingCards.length;
    this.cachedCardLines = null;
  }

  private disableWaitingContent(): void {
    if (!this.waitingEnabled) return;

    if (this.cardTimer) {
      clearInterval(this.cardTimer);
      this.cardTimer = null;
    }

    if (this.keypressHandler) {
      const { stdin } = process;
      stdin.removeListener('data', this.keypressHandler);
      if (stdin.isTTY) {
        stdin.setRawMode(false);
        stdin.pause();
      }
      this.keypressHandler = null;
    }

    this.waitingEnabled = false;
    this.cachedCardLines = null;
  }

  private resetCardTimer(): void {
    if (this.cardTimer) {
      clearInterval(this.cardTimer);
      this.cardTimer = setInterval(() => {
        this.advanceCard(1);
      }, CARD_ADVANCE_MS);
    }
  }

  private formatTime(ms: number): string {
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }

  private smartTruncate(text: string, max: number): string {
    if (text.length <= max) return text;
    const cut = text.slice(0, max - 1);
    const lastSpace = cut.lastIndexOf(' ');
    const boundary = lastSpace > max * 0.5 ? lastSpace : max - 1;
    return text.slice(0, boundary) + '…';
  }

  private statusIcon(task: TaskState): { char: string; styled: string } {
    switch (task.status) {
      case 'pending': return { char: '○', styled: chalk.dim('○') };
      case 'running': {
        const frame = SPINNER_FRAMES[this.spinnerFrame];
        return { char: frame, styled: chalk.cyan(frame) };
      }
      case 'done': return { char: '✓', styled: chalk.green('✓') };
      case 'failed': return { char: '✗', styled: chalk.red('✗') };
    }
  }

  private renderPipelineHeader(): string[] {
    const mainTasks = this.tasks.filter(t => t.pipelineLabel && t.pipelineRow === 0);
    const branchTasks = this.tasks.filter(t => t.pipelineLabel && t.pipelineRow === 1);
    if (mainTasks.length === 0) return [];

    const arrow = ' → ';
    const styledArrow = chalk.dim(arrow);

    const renderNode = (t: TaskState): { plain: string; styled: string } => {
      const { char, styled: icon } = this.statusIcon(t);
      const label = t.pipelineLabel!;
      const styledLabel = t.status === 'pending' ? chalk.dim(label) : label;
      return {
        plain: `[${char} ${label}]`,
        styled: chalk.dim('[') + icon + ' ' + styledLabel + chalk.dim(']'),
      };
    };

    const mainNodes = mainTasks.map(renderNode);
    const mainLine = PREFIX + mainNodes.map(n => n.styled).join(styledArrow);
    const lines = [mainLine];

    if (branchTasks.length > 0) {
      const firstNodePlainWidth = mainNodes[0].plain.length;
      const indent = ' '.repeat(PREFIX.length + firstNodePlainWidth + arrow.length);
      const branchNodes = branchTasks.map(renderNode);
      const branchLine = indent + chalk.dim('↘ ') + branchNodes.map(n => n.styled).join(styledArrow) + chalk.dim(' ↗');
      lines.push(branchLine);
    }

    return lines;
  }

  private hasSiblingAfter(startIdx: number, depth: number): boolean {
    for (let i = startIdx; i < this.tasks.length; i++) {
      if (this.tasks[i].depth < depth) return false;
      if (this.tasks[i].depth === depth) return true;
    }
    return false;
  }

  private getTreeConnector(index: number): string {
    const task = this.tasks[index];
    if (task.depth === 0) return '';

    if (task.depth === 1) {
      return this.hasSiblingAfter(index + 1, 1) ? '├─ ' : '└─ ';
    }

    if (task.depth === 2) {
      const pipe = this.hasSiblingAfter(index + 1, 1) ? '│' : ' ';
      return `${pipe}  └─ `;
    }

    return '  '.repeat(task.depth);
  }

  private renderLine(task: TaskState, index: number): string {
    const cols = process.stdout.columns || 80;
    const elapsed = task.startTime
      ? this.formatTime((task.endTime ?? Date.now()) - task.startTime)
      : '';
    const timeStr = elapsed ? ` ${chalk.dim(elapsed)}` : '';
    const timePlain = elapsed ? ` ${elapsed}` : '';

    const { styled: icon } = this.statusIcon(task);
    const nameStyle = task.status === 'pending' ? chalk.dim : chalk.white;
    const msgStyle = task.status === 'failed' ? chalk.red : chalk.dim;

    if (!this.cachedConnectors) {
      this.cachedConnectors = this.tasks.map((_, i) => this.getTreeConnector(i));
    }
    const connector = this.cachedConnectors[index];
    const connectorStyled = connector ? chalk.dim(connector) : '';
    const paddedName = task.name.padEnd(Math.max(0, NAME_COL_WIDTH - connector.length));
    const usedByFixed = PREFIX.length + connector.length + 2 + NAME_COL_WIDTH + timePlain.length;
    const msgMax = Math.max(cols - usedByFixed - 2, 10);
    const msg = task.message ? this.smartTruncate(task.message, msgMax) : '';

    return `${PREFIX}${connectorStyled}${icon} ${nameStyle(paddedName)}${msg ? msgStyle(msg) : ''}${timeStr}`;
  }

  private draw(initial: boolean): void {
    const { stdout } = process;
    if (!initial && this.rendered && this.lineCount > 0) {
      stdout.write(`\x1b[${this.lineCount}A`);
    }
    stdout.write('\x1b[0J');

    const pipelineHeader = this.renderPipelineHeader();
    const taskLines = this.tasks.map((t, i) => this.renderLine(t, i));

    const lines: string[] = [];
    if (pipelineHeader.length > 0) {
      lines.push(...pipelineHeader);
      const cols = stdout.columns || 80;
      lines.push(PREFIX + chalk.dim('─'.repeat(Math.min(cols - PREFIX.length * 2, 55))));
    }
    lines.push(...taskLines);

    if (this.previewLines.length > 0 && stdout.isTTY) {
      const cols = stdout.columns || 80;
      const maxHeight = Math.min(Math.floor((stdout.rows || 24) / 3), 10);
      const visibleLines = this.previewLines.slice(-maxHeight);
      lines.push(PREFIX + chalk.dim('─'.repeat(Math.min(cols - PREFIX.length * 2, 55))));
      for (const line of visibleLines) {
        lines.push(PREFIX + line.slice(0, cols - PREFIX.length));
      }
    } else if (this.waitingEnabled && this.waitingCards.length > 0 && stdout.isTTY) {
      const cols = stdout.columns || 80;
      if (this.currentCard !== this.cachedCardIndex || cols !== this.cachedCardCols || !this.cachedCardLines) {
        const card = this.waitingCards[this.currentCard];
        this.cachedCardLines = renderCard(card, this.currentCard, this.waitingCards.length, cols);
        this.cachedCardIndex = this.currentCard;
        this.cachedCardCols = cols;
      }
      lines.push(...this.cachedCardLines);
    }

    const output = lines.join('\n');
    stdout.write(output + '\n');
    this.lineCount = output.split('\n').length;
    this.rendered = true;
  }
}
