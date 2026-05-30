import type { ICommitInputReader } from '../../interfaces/commit-input-reader.js';
import type { CommitInput } from '../../types/commit.js';
import { ProtocolError } from '../../util/errors.js';

/**
 * Reads commit input by parsing a JSON string.
 *
 * Used for both file-based and stdin-based input -- the caller is responsible
 * for fetching the raw content; this class only handles parsing.
 *
 * GRASP: Information Expert -- owns all knowledge of JSON-to-CommitInput mapping.
 * SOLID: SRP -- single responsibility of parsing JSON into CommitInput.
 */
export class JsonInputReader implements ICommitInputReader {
  constructor(private readonly json: string) {}

  async read(): Promise<CommitInput> {
    if (!this.json || !this.json.trim()) {
      throw new ProtocolError('Empty JSON input', 1);
    }

    try {
      const data = JSON.parse(this.json);
      const trailers: Record<string, Record<string, string[]>> = { '': {} };
      const input: CommitInput = {
        subject: typeof data.intent === 'string' ? data.intent : (typeof data.subject === 'string' ? data.subject : ''),
        body: typeof data.body === 'string' ? data.body : undefined,
        trailers,
      };

      if (data.trailers && typeof data.trailers === 'object' && !Array.isArray(data.trailers)) {
        const rawTrailers = data.trailers as Record<string, unknown>;

        for (const [key, val] of Object.entries(rawTrailers)) {
          // Detect hierarchical JSON: { "Project": { "Team": "..." } }
          if (val && typeof val === 'object' && !Array.isArray(val)) {
              const nsMap: Record<string, string[]> = {};
              for (const [innerKey, innerVal] of Object.entries(val)) {
                  if (Array.isArray(innerVal)) {
                      nsMap[innerKey] = innerVal.filter(v => typeof v === 'string') as string[];
                  } else if (typeof innerVal === 'string') {
                      nsMap[innerKey] = [innerVal];
                  }
              }
              if (Object.keys(nsMap).length > 0) {
                  trailers[key] = nsMap;
              }
          } else {
              // Legacy flat JSON: { "Constraint": "..." } -> route to root namespace
              if (Array.isArray(val)) {
                const stringValues = val.filter((v) => typeof v === 'string') as string[];
                if (stringValues.length > 0) {
                  trailers[''][key] = stringValues;
                }
              } else if (typeof val === 'string') {
                const trimmed = val.trim();
                if (trimmed) {
                  trailers[''][key] = [trimmed];
                }
              }
          }
        }
      }

      return input;
    } catch (err) {
      if (err instanceof ProtocolError) throw err;
      if (err instanceof Error) {
        throw new ProtocolError(`Failed to parse JSON input: ${err.message}`, 1);
      }
      throw err;
    }
  }
}
