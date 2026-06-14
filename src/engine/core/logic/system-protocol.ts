import { SYSTEM_PROTOCOL } from '../../util/constants.js';
import type { ProtocolDefinition } from '../types/protocol-definition.js';

/**
 * The reserved System Protocol definition.
 * Handles standard Git trailers and acts as the catch-all Anchor.
 */
export const SystemProtocolDefinition: ProtocolDefinition = {
  name: SYSTEM_PROTOCOL,
  version: '1.0',
  strict: false,
  permissive: true,
  namespace: '', // Root namespace
  identityKey: 'git-hash', // Logical name for the physical ID
  trailers: {
    'git-hash': {
      description: 'Physical Git commit hash',
      multivalue: false,
      validation: 'pattern',
      pattern: '^[0-9a-f]{7,40}$',
      isCore: true
    }
  }
};
