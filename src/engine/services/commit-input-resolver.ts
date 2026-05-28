import type { IPrompt } from '../interfaces/prompt.js';
import type { ICommitInputReader } from '../interfaces/commit-input-reader.js';
import type { CommitInput } from '../types/commit.js';
import { readFile } from 'node:fs/promises';

import { InteractiveInputReader } from './readers/interactive-input-reader.js';
import { JsonInputReader } from './readers/json-input-reader.js';
import { FlagsInputReader } from './readers/flags-input-reader.js';
import { TrailerCollectorRegistry } from './readers/collectors/trailer-collector-registry.js';
import type { ProtocolRegistry } from './protocol-registry.js';

/**
 * The modes of commit input resolution, ordered by priority.
 * interactive > file > flags > stdin
 */
export enum InputMode {
  Interactive = 'interactive',
  File = 'file',
  Flags = 'flags',
  Stdin = 'stdin',
}

/**
 * CLI options passed to the commit command.
 * 
 * SOLID: SRP -- pure DTO for CLI option parsing.
 * Supports dynamic core flags via index signature.
 */
export interface CommitCommandOptions {
  readonly amend?: boolean;
  readonly edit?: boolean;
  readonly file?: string;
  readonly interactive?: boolean;
  readonly subject?: string;
  readonly body?: string;
  readonly trailer?: string[];
  /** Dynamic flags from definitions (e.g. confidence, scope-risk) */
  readonly [key: string]: unknown;
}

/**
 * Resolves commit input from the appropriate source based on CLI options.
 */
export class CommitInputResolver {
  constructor(
    private readonly prompt: IPrompt,
    private readonly protocolRegistry: ProtocolRegistry,
  ) {}

  /**
   * Resolve commit input from the appropriate source based on CLI options.
   */
  async resolve(options: CommitCommandOptions): Promise<CommitInput> {
    const mode = this.resolveMode(options);
    const reader = await this.createReader(mode, options);
    return reader.read();
  }

  /**
   * Determine the input mode based on option priority.
   */
  private resolveMode(options: CommitCommandOptions): InputMode {
    if (options.interactive) {
      return InputMode.Interactive;
    }
    if (options.file) {
      return InputMode.File;
    }
    
    // Check if the subject line or any trailer flag was provided
    const baseFlags = ['amend', 'edit', 'subject', 'body', 'file', 'trailer', 'interactive', 'json', 'format', 'color', 'context', 'cache'];
    const extraKeys = Object.keys(options).filter(k => !baseFlags.includes(k) && options[k] !== undefined);
    const hasFlags = !!options.subject || (options.trailer && options.trailer.length > 0) || extraKeys.length > 0;

    if (hasFlags) {
      return InputMode.Flags;
    }
    if (process.stdin.isTTY) {
      return InputMode.Interactive;
    }
    return InputMode.Stdin;
  }

  /**
   * Construct the appropriate ICommitInputReader for the resolved mode.
   */
  private async createReader(
    mode: InputMode,
    options: CommitCommandOptions,
  ): Promise<ICommitInputReader> {
    switch (mode) {
      case InputMode.Interactive: {
        const collectors = this.protocolRegistry.getAll().flatMap(p => {
            const registry = new TrailerCollectorRegistry(p);
            return registry.getCollectors();
        });
        return new InteractiveInputReader(
          this.prompt,
          collectors,
        );
      }
      case InputMode.File:
        return new JsonInputReader(await readFile(options.file!, 'utf-8'));
      case InputMode.Flags:
        return new FlagsInputReader(options, this.protocolRegistry.getAll());
      case InputMode.Stdin: {
        const content = await this.readStdinContent();
        return new JsonInputReader(content);
      }
    }
  }

  /**
   * Read raw content from stdin.
   * For piped data (non-TTY), use robust synchronous reading to avoid event loop timing issues.
   */
  private async readStdinContent(): Promise<string> {
    if (process.stdin.isTTY) {
        // TTY mode: we shouldn't really be here as mode should be Interactive,
        // but if we are, we wait for input.
        process.stdin.resume();
    } else {
        // Piped/Heredoc mode: use synchronous slurp for maximum reliability
        try {
            const { readFileSync } = await import('node:fs');
            return readFileSync(0, 'utf-8');
        } catch {
            // Fallback to async if sync fails
        }
    }

    const chunks: Buffer[] = [];
    return new Promise<string>((resolve, reject) => {
      process.stdin.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      process.stdin.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      });

      process.stdin.on('error', (err) => {
        reject(err);
      });
    });
  }
}
