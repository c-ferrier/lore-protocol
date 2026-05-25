import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shouldCheckForUpdate } from '../../../../src/util/update-check.js';

describe('shouldCheckForUpdate', () => {
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];
  const originalIsTTY = process.stderr.isTTY;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.argv = ['node', 'lore', 'log'];
    Object.defineProperty(process.stderr, 'isTTY', { value: true, writable: true });
    delete process.env['CI'];
    delete process.env['NO_UPDATE_NOTIFIER'];
    delete process.env['PROTOCOL_NO_UPDATE_CHECK'];
  });

  afterEach(() => {
    process.env = originalEnv;
    process.argv = originalArgv;
    Object.defineProperty(process.stderr, 'isTTY', { value: originalIsTTY, writable: true });
  });

  it('returns true when all conditions are met', () => {
    expect(shouldCheckForUpdate(true)).toBe(true);
  });

  it('returns false when stderr is not a TTY', () => {
    Object.defineProperty(process.stderr, 'isTTY', { value: false, writable: true });
    expect(shouldCheckForUpdate(true)).toBe(false);
  });

  it('returns false when CI env var is set', () => {
    process.env['CI'] = 'true';
    expect(shouldCheckForUpdate(true)).toBe(false);
  });

  it('returns false when NO_UPDATE_NOTIFIER env var is set', () => {
    process.env['NO_UPDATE_NOTIFIER'] = '1';
    expect(shouldCheckForUpdate(true)).toBe(false);
  });

  it('returns false when PROTOCOL_NO_UPDATE_CHECK env var is set', () => {
    process.env['PROTOCOL_NO_UPDATE_CHECK'] = '1';
    expect(shouldCheckForUpdate(true)).toBe(false);
  });

  it('returns false when --json is in argv', () => {
    process.argv = ['node', 'lore', 'log', '--json'];
    expect(shouldCheckForUpdate(true)).toBe(false);
  });

  it('returns false when --format=json is in argv', () => {
    process.argv = ['node', 'lore', 'log', '--format=json'];
    expect(shouldCheckForUpdate(true)).toBe(false);
  });

  it('returns false when --format json (space-separated) is in argv', () => {
    process.argv = ['node', 'lore', 'log', '--format', 'json'];
    expect(shouldCheckForUpdate(true)).toBe(false);
  });

  it('returns false when --no-update-notifier is in argv', () => {
    process.argv = ['node', 'lore', 'log', '--no-update-notifier'];
    expect(shouldCheckForUpdate(true)).toBe(false);
  });

  it('returns false when config updateCheck is false', () => {
    expect(shouldCheckForUpdate(false)).toBe(false);
  });
});
