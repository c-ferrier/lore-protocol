import { resolve, relative, isAbsolute } from 'node:path';
import { ProtocolError } from '../../util/errors.js';

/**
 * Normalizes a path relative to the protocolRoot.
 * REJECTS: Paths outside the protocol root (security/logical boundary).
 */
export function normalizePathToRoot(path: string, cwd: string, protocolRoot: string): string {
    // 1. Make absolute based on CWD
    const absolute = isAbsolute(path) ? path : resolve(cwd, path);
    
    // 2. Compute relative path from protocolRoot
    let rel = relative(protocolRoot, absolute);
    
    // 3. Boundary Check: Ensure path is within the protocol root
    if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new ProtocolError(`Path "${path}" is outside the protocol root "${protocolRoot}"`, 1);
    }

    // 4. POSIX Normalization
    rel = rel.replace(/\\/g, '/');

    // 5. Preserve trailing slash if present in raw input
    if (path.endsWith('/') && !rel.endsWith('/')) {
        rel += '/';
    }

    // 6. Handle empty/root case
    if (rel === '') rel = '.';
    
    return rel;
}
