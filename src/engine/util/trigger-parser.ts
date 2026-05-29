export interface Trigger {
  readonly key: string;
  readonly value: string;
}

export interface ParsedTriggerBlock {
  readonly raw: string;
  readonly triggers: readonly Trigger[];
  readonly instruction: string;
}

/**
 * Metadata derived from [until:...] and other hints in a trailer string.
 */
export interface TriggerHints {
  readonly until?: Date;
}

/**
 * Parses semantic triggers using the [trigger:parameter] grammar.
 * Example: "[on:squash][step:1] Do something"
 * Results in:
 *   triggers: [{ key: 'on', value: 'squash' }, { key: 'step', value: '1' }]
 *   instruction: "Do something"
 * 
 * SOLID: SRP -- only responsible for trigger syntax parsing.
 */
export class TriggerParser {
  private static readonly TRIGGER_PATTERN = /\[([^:\]]+):([^\]]+)\]/g;

  /**
   * Parse a raw string into structured triggers and instruction.
   */
  static parse(text: string): ParsedTriggerBlock {
    const triggers: Trigger[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // Reset regex for each call
    this.TRIGGER_PATTERN.lastIndex = 0;

    while ((match = this.TRIGGER_PATTERN.exec(text)) !== null) {
      triggers.push({
        key: match[1],
        value: match[2],
      });
      lastIndex = this.TRIGGER_PATTERN.lastIndex;
    }

    const instruction = text.slice(lastIndex).trim();

    return {
      raw: text,
      triggers,
      instruction,
    };
  }

  /**
   * Helper to check if a block matches a specific trigger key/value.
   */
  static matches(parsed: ParsedTriggerBlock, key: string, value?: string): boolean {
    return parsed.triggers.some(
      (t) => t.key === key && (value === undefined || t.value === value),
    );
  }

  /**
   * Returns the text with all trigger blocks removed.
   */
  static strip(text: string): string {
    return text.replace(this.TRIGGER_PATTERN, '').trim();
  }
}

/**
 * Extract time-based and behavioral hints from a trigger string.
 *
 * Implements precise date resolution for [until:...] triggers.
 */
export function parseTriggerHints(text: string): TriggerHints {
  const parsed = TriggerParser.parse(text);
  const untilTrigger = parsed.triggers.find((t) => t.key === 'until');

  if (!untilTrigger) {
    return {};
  }

  const dateStr = untilTrigger.value;
  
  // 1. YYYY-MM format: treat as end of that month (start of next)
  const monthMatch = dateStr.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const year = parseInt(monthMatch[1], 10);
    const month = parseInt(monthMatch[2], 10);
    const d = new Date(year, month, 1);
    if (!isNaN(d.getTime())) {
      return { until: d };
    }
  }

  // 2. YYYY-MM-DD format: treat as end of that day
  const dayMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dayMatch) {
    const year = parseInt(dayMatch[1], 10);
    const month = parseInt(dayMatch[2], 10) - 1;
    const day = parseInt(dayMatch[3], 10);
    const d = new Date(year, month, day, 23, 59, 59, 999);
    if (!isNaN(d.getTime())) {
      return { until: d };
    }
  }

  return {};
}
