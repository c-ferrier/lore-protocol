import { authorizeKey } from '../../core/logic/ownership.js';
import { resolveProtocolKey } from '../../core/logic/protocols.js';
import type { CommitInput } from '../../core/types/commit.js';
import { ProtocolMap } from '../../core/types/domain.js';
import type { ProtocolContext } from '../../core/types/protocol-definition.js';
import type { ICommitInputReader } from '../../interfaces/commit-input-reader.js';
import { ProtocolError } from '../../util/errors.js';

/**
 * Reads commit input by parsing a JSON string.
 */
export class JsonInputReader implements ICommitInputReader {
  constructor(
    private readonly json: string,
    private readonly protocols: ProtocolMap<ProtocolContext>
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async read(_options?: Record<string, unknown>): Promise<CommitInput> {
    if (!this.json || !this.json.trim()) {
      throw new ProtocolError('Empty JSON input', 1);
    }

    try {
      const data = JSON.parse(this.json) as Record<string, unknown>;
      const trailersMap = new ProtocolMap<Record<string, string[]>>();
      
      const intent = typeof data.intent === 'string' ? data.intent : '';
      const subject = typeof data.subject === 'string' ? data.subject : '';
      
      const input: CommitInput = {
        subject: intent || subject,
        body: typeof data.body === 'string' ? data.body : undefined,
        trailers: trailersMap,
      };

      if (data.trailers && typeof data.trailers === 'object' && !Array.isArray(data.trailers)) {
        const rawTrailers = data.trailers as Record<string, unknown>;

        for (const [key, val] of Object.entries(rawTrailers)) {
          // 1. Detect hierarchical JSON: { "project": { "Status": "active" } }
          // The top-level key is treated as the Protocol Name.
          if (val && typeof val === 'object' && !Array.isArray(val)) {
              const ctx = this.protocols.get(key);
              if (!ctx) {
                  throw new ProtocolError(`Unknown protocol "${key}" in hierarchical JSON input`, 1);
              }
              
              const pName = ctx.def.name.toLowerCase();
              const pMap: Record<string, string[]> = trailersMap.get(pName) ?? {};
              
              for (const [innerKey, innerVal] of Object.entries(val)) {
                  const authorizedKey = authorizeKey(innerKey, ctx);
                  if (!authorizedKey) continue;

                  const values = Array.isArray(innerVal) 
                    ? innerVal.filter(v => typeof v === 'string')
                    : (typeof innerVal === 'string' ? [innerVal] : []);
                  
                  if (values.length > 0) {
                      pMap[authorizedKey] = [...(pMap[authorizedKey] || []), ...values];
                  }
              }
              if (Object.keys(pMap).length > 0) {
                  trailersMap.set(pName, pMap);
              }
          } 
          // 2. Flat JSON: { "Status": "..." } -> route via resolveProtocolKey
          else {
              const values = Array.isArray(val) 
                ? val.filter((v) => typeof v === 'string')
                : (typeof val === 'string' ? [val.trim()] : []);
              
              if (values.length > 0) {
                  const ctx = resolveProtocolKey(this.protocols, key);
                  const pName = ctx ? ctx.def.name.toLowerCase() : ''; // '' for unknown/root orphans
                  
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
