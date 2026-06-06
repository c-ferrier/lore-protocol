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
import type { IPrompt } from '../../interfaces/prompt.js';
import type { ProtocolRegistry } from '../../services/protocol-registry.js';
import { TrailerCollectorRegistry } from './collectors/trailer-collector-registry.js';
import { InteractiveInputReader } from './interactive-input-reader.js';
import { JsonInputReader } from './json-input-reader.js';

export { type CommitCommandOptions,InputMode };

/**
 * Resolves commit input from the appropriate source based on CLI options.
 * This acts as a functional CLI Orchestrator.
 * 
 * SOLID: SRP -- only responsible for coordinating input source resolution.
 */
export async function resolveCommitInput(
  options: CommitCommandOptions,
  deps: {
    prompt: IPrompt;
    protocolRegistry: ProtocolRegistry;
    config: EngineConfig;
  }
): Promise<CommitInput> {
  const mode = getActualMode(options);
  const intent = await readIntent(mode, options, deps);
  return finalizeCommitInput(intent);
}

/**
 * Executes the I/O portion of input resolution.
 */
async function readIntent(
  mode: InputMode, 
  options: CommitCommandOptions, 
  deps: { 
    prompt: IPrompt; 
    protocolRegistry: ProtocolRegistry; 
  }
): Promise<Partial<CommitInput>> {
  const { prompt, protocolRegistry } = deps;

  switch (mode) {
    case InputMode.Interactive: {
      const collectors = protocolRegistry.getAll().flatMap(p => {
          const registry = new TrailerCollectorRegistry(p);
          return registry.getCollectors();
      });
      const reader = new InteractiveInputReader(prompt, collectors);
      return reader.read(options);
    }
    case InputMode.File: {
      const content = await promisify(readFile)(options.file!, 'utf-8');
      const reader = new JsonInputReader(content, protocolRegistry);
      return reader.read(options);
    }
    case InputMode.Flags: {
      return parseFlagsToInput(options, protocolRegistry);
    }
    case InputMode.Stdin: {
      const content = await readStdinContent();
      const reader = new JsonInputReader(content, protocolRegistry);
      return reader.read(options);
    }
  }
}

/**
 * Adjusts the mode based on environment-specific factors like TTY.
 */
function getActualMode(options: CommitCommandOptions): InputMode {
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
async function readStdinContent(): Promise<string> {
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
