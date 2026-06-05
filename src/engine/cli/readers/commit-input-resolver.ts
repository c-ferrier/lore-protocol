import { readFile, readFileSync } from 'node:fs';
import { promisify } from 'node:util';

// Pure Logic Modules
import { 
    type CommitCommandOptions, 
    finalizeCommitInput, 
    InputMode, 
    parseFlagsToInput, 
    selectInputMode} from '../../core/logic/input-interpretation.js';
import type { CommitInput } from '../../core/types/commit.js';
import type { EngineConfig } from '../../core/types/config.js';
import type { ICommitInputReader } from '../../interfaces/commit-input-reader.js';
import type { IPrompt } from '../../interfaces/prompt.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';
import { TrailerCollectorRegistry } from './collectors/trailer-collector-registry.js';
import { InteractiveInputReader } from './interactive-input-reader.js';
import { JsonInputReader } from './json-input-reader.js';

export { type CommitCommandOptions,InputMode };

/**
 * Resolves commit input from the appropriate source based on CLI options.
 * This service acts as the CLI Adapter, coordinating I/O and pure logic.
 */
export class CommitInputResolver implements ICommitInputReader {
  constructor(
    private readonly prompt: IPrompt,
    private readonly protocolRegistry: ProtocolRegistry,
    private readonly config: EngineConfig,
  ) {}

  /**
   * Resolve commit input from the appropriate source based on CLI options.
   */
  async read(options: CommitCommandOptions): Promise<CommitInput> {
    const mode = this.getActualMode(options);
    const intent = await this.readIntent(mode, options);
    return finalizeCommitInput(intent);
  }

  /**
   * Executes the I/O portion of input resolution.
   */
  private async readIntent(mode: InputMode, options: CommitCommandOptions): Promise<Partial<CommitInput>> {
    switch (mode) {
      case InputMode.Interactive: {
        const collectors = this.protocolRegistry.getAll().flatMap(p => {
            const registry = new TrailerCollectorRegistry(p);
            return registry.getCollectors();
        });
        const reader = new InteractiveInputReader(this.prompt, collectors);
        return reader.read(options);
      }
      case InputMode.File: {
        const content = await promisify(readFile)(options.file!, 'utf-8');
        const reader = new JsonInputReader(content, this.protocolRegistry);
        return reader.read(options);
      }
      case InputMode.Flags: {
        return parseFlagsToInput(options, this.protocolRegistry);
      }
      case InputMode.Stdin: {
        const content = await this.readStdinContent();
        const reader = new JsonInputReader(content, this.protocolRegistry);
        return reader.read(options);
      }
    }
  }

  /**
   * Adjusts the mode based on environment-specific factors like TTY.
   */
  private getActualMode(options: CommitCommandOptions): InputMode {
      const logicalMode = selectInputMode(options);
      if (logicalMode === InputMode.Stdin && process.stdin.isTTY) {
          return InputMode.Interactive;
      }
      return logicalMode;
  }

  /**
   * Read raw content from stdin.
   * For piped data (non-TTY), use robust synchronous reading to avoid event loop timing issues.
   */
  private async readStdinContent(): Promise<string> {
    if (!process.stdin.isTTY) {
        // Piped/Heredoc mode: use synchronous slurp for maximum reliability
        try {
            return readFileSync(0, 'utf-8');
        } catch {
            // Fallback to async if sync fails
        }
    } else {
        // TTY mode: resume so we can read if someone pipes anyway
        process.stdin.resume();
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
