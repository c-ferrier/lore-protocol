import { isAbsolute,relative, resolve } from 'node:path';

import { ProtocolError } from '../../util/errors.js';

/**
 * Normalizes a path relative to the protocolRoot.
 * REJECTS: Paths outside the protocol root (security/logical boundary).
 */
export function normalizePathToRoot(path: string, cwd: string, protocolRoot: string): string {
    // 1. Make absolute and handle Windows Drive Letter casing (e.g. C: vs c:)
    const absolute = (isAbsolute(path) ? path : resolve(cwd, path)).replace(/^[a-zA-Z]:/, (m) => m.toLowerCase());
    const normalizedRoot = protocolRoot.replace(/^[a-zA-Z]:/, (m) => m.toLowerCase());
    
    // 2. Compute relative path
    let rel = relative(normalizedRoot, absolute);
    
    // 3. POSIX Normalization (Must happen before boundary check for Windows safety)
    rel = rel.replace(/\\/g, '/');

    // 4. Boundary Check: Ensure path is within the protocol root
    if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new ProtocolError(`Path "${path}" is outside the protocol root "${protocolRoot}"`, 1);
    }

    // 5. Preserve trailing slash if present in raw input
    // (Check both posix and windows slashes on the input)
    if ((path.endsWith('/') || path.endsWith('\\')) && !rel.endsWith('/')) {
        rel += '/';
    }

    // 6. Handle empty/root case
    if (rel === '' || rel === '/') rel = '.';
    
    return rel;
}
