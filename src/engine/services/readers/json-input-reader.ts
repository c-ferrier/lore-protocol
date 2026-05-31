import type { ICommitInputReader } from '../../interfaces/commit-input-reader.js';
import type { CommitInput } from '../../types/commit.js';
import { ProtocolError } from '../../util/errors.js';
import type { ProtocolRegistry } from '../protocol-registry.js';

/**
 * Reads commit input by parsing a JSON string.
 */
export class JsonInputReader implements ICommitInputReader {
  constructor(
    private readonly json: string,
    private readonly registry: ProtocolRegistry
  ) {}

  async read(): Promise<CommitInput> {
    if (!this.json || !this.json.trim()) {
      throw new ProtocolError('Empty JSON input', 1);
    }

    try {
      const data = JSON.parse(this.json);
      const trailersMap = new Map<string, Record<string, string[]>>();
      const input: CommitInput = {
        subject: typeof data.intent === 'string' ? data.intent : (typeof data.subject === 'string' ? data.subject : ''),
        body: typeof data.body === 'string' ? data.body : undefined,
        trailers: trailersMap as CommitInput['trailers'],
      };

      if (data.trailers && typeof data.trailers === 'object' && !Array.isArray(data.trailers)) {
        const rawTrailers = data.trailers as Record<string, unknown>;

        for (const [key, val] of Object.entries(rawTrailers)) {
          // 1. Detect hierarchical JSON: { "project": { "Status": "active" } }
          // The top-level key is treated as the Protocol Name.
          if (val && typeof val === 'object' && !Array.isArray(val)) {
              const protocol = this.registry.get(key);
              if (!protocol) {
                  throw new ProtocolError(`Unknown protocol "${key}" in hierarchical JSON input`, 1);
              }
              
              const pName = protocol.name.toLowerCase();
              const pMap: Record<string, string[]> = trailersMap.get(pName) ?? {};
              
              for (const [innerKey, innerVal] of Object.entries(val)) {
                  const authorizedKey = protocol.authorize(innerKey);
                  if (!authorizedKey) continue;

                  const values = Array.isArray(innerVal) 
                    ? innerVal.filter(v => typeof v === 'string') as string[]
                    : (typeof innerVal === 'string' ? [innerVal] : []);
                  
                  if (values.length > 0) {
                      pMap[authorizedKey] = [...(pMap[authorizedKey] || []), ...values];
                  }
              }
              if (Object.keys(pMap).length > 0) {
                  trailersMap.set(pName, pMap);
              }
          } 
          // 2. Flat JSON: { "Status": "..." } -> route via registry.resolveKey
          else {
              const values = Array.isArray(val) 
                ? val.filter((v) => typeof v === 'string') as string[]
                : (typeof val === 'string' ? [val.trim()] : []);
              
              if (values.length > 0) {
                  const protocol = this.registry.resolveKey(key);
                  const pName = protocol ? protocol.name.toLowerCase() : ''; // '' for unknown/root orphans
                  
                  const pMap = trailersMap.get(pName) ?? {};
                  const existing = pMap[key] || [];
                  pMap[key] = [...existing, ...values];
                  trailersMap.set(pName, pMap);
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
