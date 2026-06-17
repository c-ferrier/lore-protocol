/**
 * Declarative mapping rule for a single configuration key.
 */
export interface MappingRule {
    /** The source path in the legacy object (e.g. 'validation.intent_max_length') */
    from: string;
    /** The target path in the modern object (e.g. 'validation.subjectMaxLength') */
    to: string;
}

/**
 * Translates values from a source object to a target object based on a schema.
 * 
 * SOLID: SRP -- only responsible for translating data between disparate 
 * configuration schemas.
 * 
 * @param source The source configuration object (e.g. legacy Lore config).
 * @param target The target configuration object to be patched (e.g. modern Engine config).
 * @param rules An array of mapping rules.
 * @returns A patched version of the target object.
 */
export function mapConfig(
    source: Record<string, unknown> | null | undefined,
    target: Record<string, unknown>,
    rules: MappingRule[]
): Record<string, unknown> {
    if (!source) return target;

    // Deep clone target to avoid side effects on readonly properties
    const result = JSON.parse(JSON.stringify(target)) as Record<string, unknown>;

    for (const rule of rules) {
        const value = getValue(source, rule.from);
        if (value !== undefined) {
            setValue(result, rule.to, value);
        }
    }

    return result;
}

/**
 * Internal helper to resolve a dot-notated path in an object.
 */
function getValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
        if (current === null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

/**
 * Internal helper to set a dot-notated path in an object.
 */
function setValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current[part] || typeof current[part] !== 'object') {
            current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;
}

/**
 * Canonical mapping rules for Lore 0.5.0 to Atom Engine 1.0.
 */
export const LORE_TO_ENGINE_RULES: MappingRule[] = [
    { from: 'validation.max_message_lines', to: 'validation.maxMessageLines' },
    { from: 'validation.intent_max_length', to: 'validation.subjectMaxLength' },
    { from: 'stale.older_than', to: 'stale.olderThan' },
    { from: 'stale.drift_threshold', to: 'stale.driftThreshold' },
    { from: 'output.default_format', to: 'output.defaultFormat' },
    { from: 'follow.max_depth', to: 'follow.maxDepth' },
    { from: 'cli.update_check', to: 'cli.updateCheck' },
];
