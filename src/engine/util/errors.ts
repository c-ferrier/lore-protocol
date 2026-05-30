import type { ValidationIssue } from '../types/output.js';

export class ProtocolError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

export class ValidationError extends ProtocolError {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(`Validation failed with ${issues.length} issue(s)`, 1);
    this.name = 'ValidationError';
  }
}

export class GitError extends ProtocolError {
  constructor(message: string) {
    super(message, 2);
    this.name = 'GitError';
  }
}

export class NoStagedChangesError extends ProtocolError {
  constructor() {
    super('No staged changes. Stage files with `git add` before running `lore commit`.', 3);
    this.name = 'NoStagedChangesError';
  }
}

export class ConfigurationError extends ProtocolError {
  constructor(message: string) {
    super(message, 1);
    this.name = 'ConfigurationError';
  }
}
