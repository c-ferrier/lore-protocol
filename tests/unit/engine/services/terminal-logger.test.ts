import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerminalLogger } from '../../../../src/engine/services/terminal-logger.js';
import { LogLevel } from '../../../../src/engine/interfaces/logger.js';

describe('TerminalLogger', () => {
  let stdoutSpy: any;
  let stderrSpy: any;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes result() to stdout', () => {
    const logger = new TerminalLogger(LogLevel.INFO, false);
    logger.result('pure data');
    expect(stdoutSpy).toHaveBeenCalledWith('pure data\n');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('routes info() to stderr', () => {
    const logger = new TerminalLogger(LogLevel.INFO, false);
    logger.info('user message');
    expect(stderrSpy).toHaveBeenCalledWith('user message\n');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('routes warn() and error() to stderr', () => {
    const logger = new TerminalLogger(LogLevel.INFO, false);
    logger.warn('be careful');
    logger.error('it broke');
    expect(stderrSpy).toHaveBeenCalledWith('be careful\n');
    expect(stderrSpy).toHaveBeenCalledWith('it broke\n');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('filters by log level', () => {
    const logger = new TerminalLogger(LogLevel.WARN, false);
    logger.debug('should be hidden');
    logger.info('should be hidden');
    logger.warn('visible');
    
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledWith('visible\n');
  });

  it('supports trace and debug prefixes', () => {
    const logger = new TerminalLogger(LogLevel.TRACE, false);
    logger.debug('debugging');
    logger.trace('tracing');
    
    expect(stderrSpy).toHaveBeenCalledWith('[DEBUG] debugging\n');
    expect(stderrSpy).toHaveBeenCalledWith('[TRACE] tracing\n');
  });

  it('supports child loggers with joined names', () => {
    const root = new TerminalLogger(LogLevel.DEBUG, false, 'Root');
    const child = root.child('Child');
    const grandchild = child.child('Grandchild');

    child.debug('hello');
    grandchild.debug('world');

    expect(stderrSpy).toHaveBeenCalledWith('[DEBUG][Root:Child] hello\n');
    expect(stderrSpy).toHaveBeenCalledWith('[DEBUG][Root:Child:Grandchild] world\n');
  });

  it('respects color off override', () => {
    const logger = new TerminalLogger(LogLevel.DEBUG, false, 'Name');
    logger.debug('test');
    // Verify no ANSI escape codes (simple check)
    const call = stderrSpy.mock.calls[0][0];
    expect(call).not.toContain('\x1b[');
    expect(call).toBe('[DEBUG][Name] test\n');
  });
});
