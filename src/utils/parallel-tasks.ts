import chalk from 'chalk';
import { WAITING_CARDS, renderCard, type WaitingCard } from './waiting-content.js';

type TaskStatus = 'pending' | 'running' | 'done' | 'failed';

interface TaskState {
  name: string;
  status: TaskStatus;
  message: string;
  depth: number;
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

  add(name: string, options?: { depth?: number }): number {
    const index = this.tasks.length;
    this.tasks.push({ name, status: 'pending', message: '', depth: options?.depth ?? 0 });
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

  private renderLine(task: TaskState): string {
    const cols = process.stdout.columns || 80;
    const elapsed = task.startTime
      ? this.formatTime((task.endTime ?? Date.now()) - task.startTime)
      : '';
    const timeStr = elapsed ? ` ${chalk.dim(elapsed)}` : '';
    const timePlain = elapsed ? ` ${elapsed}` : '';

    let icon: string;
    let nameStyle: (s: string) => string;
    let msgStyle: (s: string) => string;

    switch (task.status) {
      case 'pending':
        icon = chalk.dim('○');
        nameStyle = chalk.dim;
        msgStyle = chalk.dim;
        break;
      case 'running':
        icon = chalk.cyan(SPINNER_FRAMES[this.spinnerFrame]);
        nameStyle = chalk.white;
        msgStyle = chalk.dim;
        break;
      case 'done':
        icon = chalk.green('✓');
        nameStyle = chalk.white;
        msgStyle = chalk.dim;
        break;
      case 'failed':
        icon = chalk.red('✗');
        nameStyle = chalk.white;
        msgStyle = chalk.red;
        break;
    }

    const indent = '  '.repeat(task.depth);
    const paddedName = task.name.padEnd(Math.max(0, NAME_COL_WIDTH - indent.length));
    // icon(1) + space(1) + indent + name(padded) + time
    const usedByFixed = PREFIX.length + indent.length + 2 + NAME_COL_WIDTH + timePlain.length;
    const msgMax = Math.max(cols - usedByFixed - 2, 10);
    const msg = task.message ? this.smartTruncate(task.message, msgMax) : '';

    return `${PREFIX}${indent}${icon} ${nameStyle(paddedName)}${msg ? msgStyle(msg) : ''}${timeStr}`;
  }

  private draw(initial: boolean): void {
    const { stdout } = process;
    if (!initial && this.rendered && this.lineCount > 0) {
      stdout.write(`\x1b[${this.lineCount}A`);
    }
    stdout.write('\x1b[0J');

    const lines = this.tasks.map(t => this.renderLine(t));

    if (this.waitingEnabled && this.waitingCards.length > 0 && stdout.isTTY) {
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
