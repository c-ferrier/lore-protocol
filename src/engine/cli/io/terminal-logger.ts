import chalk, { Chalk, type ChalkInstance } from 'chalk';
import { type ILogger, LogLevel } from '../interfaces/logger.js';

/**
 * Default logger for terminal environments.
 * Routes diagnostics to stderr and results to stdout.
 * 
 * DESIGN PRINCIPLE:
 * - Human labels (error:, warning:) are OWNED by the Formatter.
 * - Developer metadata ([DEBUG], [TRACE]) is OWNED by the Logger.
 */
export class TerminalLogger implements ILogger {
  private readonly c: ChalkInstance;

  constructor(
    public readonly level: LogLevel = LogLevel.INFO,
    color?: boolean,
    private readonly name?: string
  ) {
    // If color is explicitly disabled, level 0 prevents any ANSI codes.
    // Otherwise, rely on Chalk's automatic detection (NO_COLOR, FORCE_COLOR, etc.)
    this.c = new Chalk({ level: color === false ? 0 : chalk.level });
  }

  trace(msg: string): void {
    if (this.level <= LogLevel.TRACE) {
      process.stderr.write(`${this.c.dim('[TRACE]')}${this.formatName()} ${msg}\n`);
    }
  }

  debug(msg: string): void {
    if (this.level <= LogLevel.DEBUG) {
      process.stderr.write(`${this.c.magenta('[DEBUG]')}${this.formatName('magenta')} ${msg}\n`);
    }
  }

  info(msg: string): void {
    if (this.level <= LogLevel.INFO) {
      process.stderr.write(`${msg}\n`);
    }
  }

  warn(msg: string): void {
    if (this.level <= LogLevel.WARN) {
      // NOTE: We don't add "warning:" here because the Formatter provides it.
      process.stderr.write(`${msg}\n`);
    }
  }

  error(msg: string): void {
    if (this.level <= LogLevel.ERROR) {
      // NOTE: We don't add "error:" here because the Formatter provides it.
      process.stderr.write(`${msg}\n`);
    }
  }

  result(msg: string): void {
    // Results always go to stdout, unformatted by the logger.
    process.stdout.write(`${msg}\n`);
  }

  private formatName(color: 'magenta' | 'dim' = 'dim'): string {
    if (!this.name) return '';
    return this.c[color](`[${this.name}]`);
  }

  child(name: string): ILogger {
    // Inheritance: Child gets same level and color setting, but joins names with colon.
    const newName = this.name ? `${this.name}:${name}` : name;
    return new TerminalLogger(this.level, this.c.level > 0, newName);
  }
}
