import type { ProtocolDefinition } from '../engine/interfaces/protocol-definition.js';
import type { TrailerUiKind, TrailerUiColor } from '../engine/types/config.js';
import type { Atom, StaleReason, SupersessionStatus } from '../engine/types/domain.js';
import { parseTriggerHints } from '../util/trigger-parser.js';
import { STALE_SIGNAL } from '../util/constants.js';
import { LORE_STALE_SIGNAL } from './constants.js';

/**
 * Enum values for Confidence, Scope-risk, and Reversibility.
 * These are used to drive ranking and validation.
 */
const CONFIDENCE_VALUES = {
  low: { description: 'Hypothesis/first attempt; no verification.' },
  medium: { description: 'Locally verified or based on docs.' },
  high: { description: 'Thoroughly tested (CI/staging) or extensive domain knowledge.' }
} as const;

const SCOPE_RISK_VALUES = {
  narrow: { description: 'Isolated to a single function/file; no external callers.' },
  moderate: { description: 'Affects a module; bounded/enumerable radius.' },
  wide: { description: 'Affects cross-cutting concerns, public APIs, or schemas.' }
} as const;

const REVERSIBILITY_VALUES = {
  clean: { description: 'Revertible via git revert with no side effects.' },
  'migration-needed': { description: 'Requires data migration or infra updates.' },
  irreversible: { description: 'Cannot be fully undone (e.g., data deletion).' }
} as const;

/**
 * The formal definition for the Core Lore Protocol.
 * 
 * SOLID: OCP -- the engine is closed to modification but open to extension 
 * via these pluggable definitions.
 */
export const LoreProtocolDefinition: ProtocolDefinition = {
  name: 'Lore',
  version: '1.0',
  namespace: '', // Lore is the root protocol
  identityKey: 'Lore-id',
  trailers: {
    'Lore-id': {
      description: 'Stable atom identity.',
      multivalue: false,
      validation: 'pattern',
      pattern: '^[0-9a-f]{8}$',
      generator: 'hex8',
      required: true,
      ui: { kind: 'identity' as TrailerUiKind, color: 'dim' as TrailerUiColor },
      prompt: { order: 0 },
      directives: [
        '[on:amend] Preserve the existing ID to maintain graph integrity',
        '[on:commit] Handled by Lore CLI; MUST NOT manually generate IDs or use git hashes',
        '[on:commit] The CLI automatically assigns a random 8-character hex string'
      ]
    },
    'Constraint': {
      description: 'Rules that shaped this decision and may still be active.',
      multivalue: true,
      validation: 'none',
      ui: { kind: 'decision' as TrailerUiKind, color: 'cyan' as TrailerUiColor },
      cli: { flag: 'constraint' },
      prompt: {
        confirm: 'Add a Constraint?',
        input: 'Constraint:',
        order: 100,
      },
      directives: [
        '[on:commit] Obey all active constraints. Violations are bugs unless explicitly superseded.',
        '[on:squash] Carry forward only those that apply to the final state'
      ]
    },
    'Rejected': {
      description: 'Alternatives evaluated and dismissed.',
      multivalue: true,
      validation: 'pattern',
      pattern: '^.+ \\| .+$',
      ui: { kind: 'decision' as TrailerUiKind, color: 'magenta' as TrailerUiColor },
      cli: { flag: 'rejected' },
      prompt: {
        confirm: 'Add a Rejected alternative?',
        input: 'Rejected (format: alternative | reason):',
        order: 110,
      },
      directives: [
        '[on:squash] Record all failed starts or intermediate pivots here'
      ]
    },
    'Confidence': {
      description: "Author’s assessment of the decision's correctness.",
      multivalue: false,
      validation: 'values',
      values: CONFIDENCE_VALUES,
      ui: { kind: 'risk' as TrailerUiKind, color: 'cyan' as TrailerUiColor },
      cli: { flag: 'confidence' },
      prompt: {
        confirm: 'Set Confidence?',
        choice: 'Confidence:',
        order: 120,
      },
      squash: 'rank-min',
      directives: [
        '[on:squash] Take the most conservative value (e.g., low + high = low)'
      ]
    },
    'Scope-risk': {
      description: 'The "blast radius" of the change.',
      multivalue: false,
      validation: 'values',
      values: SCOPE_RISK_VALUES,
      ui: { kind: 'risk' as TrailerUiKind, color: 'cyan' as TrailerUiColor },
      cli: { flag: 'scope-risk' },
      prompt: {
        confirm: 'Set Scope-risk?',
        choice: 'Scope-risk:',
        order: 130,
      },
      squash: 'rank-max',
      directives: [
        '[on:squash] Take the most conservative value (e.g., narrow + wide = wide)'
      ]
    },
    'Reversibility': {
      description: 'Ease of undoing the change.',
      multivalue: false,
      validation: 'values',
      values: REVERSIBILITY_VALUES,
      ui: { kind: 'risk' as TrailerUiKind, color: 'cyan' as TrailerUiColor },
      cli: { flag: 'reversibility' },
      prompt: {
        confirm: 'Set Reversibility?',
        choice: 'Reversibility:',
        order: 140,
      },
      squash: 'rank-max',
      directives: [
        '[on:modify] If "irreversible", seek explicit approval before proceeding',
        '[on:squash] Take the most conservative value (e.g., clean + irreversible = irreversible)'
      ]
    },
    'Directive': {
      description: 'Forward-looking instructions for future modifiers.',
      multivalue: true,
      validation: 'none',
      ui: { kind: 'decision' as TrailerUiKind, color: 'yellow' as TrailerUiColor },
      cli: { flag: 'directive' },
      prompt: {
        confirm: 'Add a Directive?',
        input: 'Directive:',
        order: 150,
      },
      directives: [
        '[on:commit] Use [until:...] prefix for temporary rules that expire',
        '[on:squash] Carry forward until fulfilled, rejected, or condition met',
        '[on:stale][until:YYYY-MM-DD] Flag as stale if hint is expired'
      ]
    },
    'Tested': {
      description: 'What was verified and how.',
      multivalue: true,
      validation: 'none',
      ui: { kind: 'evidence' as TrailerUiKind, color: 'green' as TrailerUiColor },
      cli: { flag: 'tested' },
      prompt: {
        confirm: 'Add a Tested entry?',
        input: 'Tested:',
        order: 160,
      },
      directives: [
        '[on:squash] Consolidate evidence into 3-4 high-signal summary statements'
      ]
    },
    'Not-tested': {
      description: 'What was not verified and why.',
      multivalue: true,
      validation: 'none',
      ui: { kind: 'evidence' as TrailerUiKind, color: 'red' as TrailerUiColor },
      cli: { flag: 'not-tested' },
      prompt: {
        confirm: 'Add a Not-tested entry?',
        input: 'Not-tested:',
        order: 170,
      },
    },
    'Supersedes': {
      description: 'Lore-id of the atom this decision replaces.',
      multivalue: true,
      validation: 'pattern',
      pattern: '^[0-9a-f]{8}$',
      ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
      cli: { flag: 'supersedes' },
      prompt: {
        confirm: 'Add a Supersedes reference?',
        input: 'Supersedes (8-char hex Lore-id):',
        order: 180,
      },
      directives: [
        '[on:commit] Only for replacements. Use "Related" or "Depends-on" for additive context.',
        '[on:squash] Remove IDs that only exist in local-only (squashed) commits'
      ]
    },
    'Depends-on': {
      description: 'Lore-id of the atom this decision requires.',
      multivalue: true,
      validation: 'pattern',
      pattern: '^[0-9a-f]{8}$',
      ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
      cli: { flag: 'depends-on' },
      prompt: {
        confirm: 'Add a Depends-on reference?',
        input: 'Depends-on (8-char hex Lore-id):',
        order: 190,
      },
      directives: [
        '[on:commit] Run "lore trace <id>" to verify the target exists and is relevant'
      ]
    },
    'Related': {
      description: 'Lore-id of an atom with a general relationship.',
      multivalue: true,
      validation: 'pattern',
      pattern: '^[0-9a-f]{8}$',
      ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
      cli: { flag: 'related' },
      prompt: {
        confirm: 'Add a Related reference?',
        input: 'Related (8-char hex Lore-id):',
        order: 200,
      },
    }
  },

  getStaleSignals(atom: Atom, now: Date, supersessionMap: Map<string, SupersessionStatus>): StaleReason[] {
    const reasons: StaleReason[] = [];
    const state = atom.protocols.get('lore');
    if (!state) return reasons;

    // 1. Low Confidence Signal
    const confidence = state.trailers.Confidence?.[0];
    if (confidence === 'low') {
      reasons.push({
        signal: LORE_STALE_SIGNAL.LOW_CONFIDENCE,
        description: '[Lore] Atom is marked as Confidence: low',
      });
    }

    // 2. Expired Hints Signal
    for (const directive of state.trailers.Directive || []) {
      const hints = parseTriggerHints(directive);
      if (hints.until && now > hints.until) {
        reasons.push({
          signal: LORE_STALE_SIGNAL.EXPIRED_HINT,
          description: `[Lore] Directive "${directive}" has expired`,
        });
      }
    }

    // 3. Orphaned Dependency Signal
    const refKeys = ['Supersedes', 'Depends-on', 'Related'];
    for (const key of refKeys) {
      const ids = state.trailers[key] || [];
      for (const id of ids) {
        const status = supersessionMap.get(id);
        if (status?.superseded) {
          reasons.push({
            signal: STALE_SIGNAL.ORPHANED_DEP,
            description: `[Lore] Dependency "${id}" (in ${key}) has been superseded by ${status.supersededBy}`,
          });
        }
      }
    }

    return reasons;
  },
};
