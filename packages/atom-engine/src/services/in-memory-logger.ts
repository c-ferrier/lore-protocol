import { type ILogger, LogLevel } from '../interfaces/logger.js';

/**
 * An in-memory logger that captures all output.
 * Useful for tests or for wrappers that want to silence and inspect
 * the output of an underlying process (like Lore wrapping Atom Engine setup).
 */
export class InMemoryLogger implements ILogger {
  public readonly logs: Array<{ level: LogLevel | 'result'; message: string; scope?: string }> = [];

  constructor(
    public readonly level: LogLevel = LogLevel.INFO,
    private readonly scope?: string
  ) {}

  trace(message: string): void { this.push(LogLevel.TRACE, message); }
  debug(message: string): void { this.push(LogLevel.DEBUG, message); }
  info(message: string): void { this.push(LogLevel.INFO, message); }
  warn(message: string): void { this.push(LogLevel.WARN, message); }
  error(message: string): void { this.push(LogLevel.ERROR, message); }
  result(message: string): void { this.push('result', message); }

  private push(level: LogLevel | 'result', message: string): void {
    this.logs.push({ level, message, scope: this.scope });
  }

  child(name: string): ILogger {
    const newScope = this.scope ? `${this.scope}:${name}` : name;
    const child = new InMemoryLogger(this.level, newScope);
    
    // Redirect child's log array to the parent's log array
    Object.defineProperty(child, 'logs', { get: () => this.logs });
    
    return child;
  }

  // Convenience getters for filtered logs
  get infoLogs() { return this.logs.filter(l => l.level === LogLevel.INFO).map(l => l.message); }
  get errorLogs() { return this.logs.filter(l => l.level === LogLevel.ERROR).map(l => l.message); }
  get warnLogs() { return this.logs.filter(l => l.level === LogLevel.WARN).map(l => l.message); }
  get debugLogs() { return this.logs.filter(l => l.level === LogLevel.DEBUG).map(l => l.message); }
  get traceLogs() { return this.logs.filter(l => l.level === LogLevel.TRACE).map(l => l.message); }
  get resultLogs() { return this.logs.filter(l => l.level === 'result').map(l => l.message); }
}
