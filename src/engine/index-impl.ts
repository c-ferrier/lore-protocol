import { EngineBootstrapper, type EngineOptions } from './services/engine-bootstrapper.js';

/**
 * Generic bootstrap for the Decision Engine CLI.
 */
export async function runCli(options: EngineOptions) {
  const bootstrapper = new EngineBootstrapper(options);
  return bootstrapper.bootstrap();
}

/**
 * Executes the configured commander program.
 */
export async function execute(program: any, getFormatter: () => any, config: any) {
  try {
    await program.parseAsync(process.argv);
  } catch (error: unknown) {
    const formatter = getFormatter();
    if (error instanceof Error) {
      console.error(formatter.formatError(1, [{ severity: 'error', message: error.message }]));
    } else {
      console.error(formatter.formatError(1, [{ severity: 'error', message: String(error) }]));
    }
    process.exit(1);
  }
}
