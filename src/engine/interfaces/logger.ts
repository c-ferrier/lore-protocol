export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  SILENT = 5
}

/**
 * Standard logging interface for the Decision Atom Engine.
 * 
 * DESIGN PRINCIPLE: 
 * - Diagnostics (trace, debug, info, warn, error) go to stderr.
 * - Data Results (result) go to stdout.
 * This keeps stdout clean for pipes and redirects.
 */
export interface ILogger {
  readonly level: LogLevel;
  
  trace(msg: string): void;
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  
  /** Output the final data result of a command (stdout) */
  result(msg: string): void;

  /** Create a child logger with a name prefix for diagnostics */
  child(name: string): ILogger;
}
