import type { IGitClient, RawCommit } from '../interfaces/git-client.js';
import type { PathQueryOptions } from '../types/query.js';
import type { LoreAtom, LoreId, LoreTrailers } from '../types/domain.js';
import type { TrailerParser } from '../services/trailer-parser.js';
import { LORE_ID_PATTERN, GIT_FILES_CHANGED_BATCH_SIZE, LORE_ID_KEY } from '../util/constants.js';
import type { Protocol } from './protocol.js';

/**
 * Retrieves LoreAtoms from git history.
 * The central query engine for all Lore-related git log queries.
 *
 * GRASP: Pure Fabrication -- persistence access abstracted from domain.
 * SOLID: DIP -- depends on IGitClient interface, not child_process.
 * GRASP: Information Expert -- knows how to map git commits to Lore domain models.
 */
export class AtomRepository {
  constructor(
    private readonly gitClient: IGitClient,
    private readonly trailerParser: TrailerParser,
    private readonly protocol: Protocol,
    private readonly isScoped: boolean = false,
  ) {}

  /**
   * Find atoms that touched the given target path/file/directory.
   * Accepts pre-resolved git log args (from PathResolver) so that
   * path resolution is the caller's responsibility (DIP).
   */
  async findByTarget(gitLogArgs: readonly string[], options: PathQueryOptions): Promise<LoreAtom[]> {
    const logArgs = this.buildLogArgs(options);
    const allArgs = [...logArgs, ...gitLogArgs];
    const rawCommits = await this.gitClient.log(allArgs);
    const atoms = await this.parseRawCommits(rawCommits);
    return this.applyFilters(atoms, options);
  }

  /**
   * Find an atom by its Lore-id.
   * Uses git log --grep to efficiently search for the specific trailer value
   * instead of fetching entire history.
   */
  async findByLoreId(loreId: LoreId): Promise<LoreAtom | null> {
    if (!LORE_ID_PATTERN.test(loreId)) {
      return null;
    }

    const logArgs = ['--all', '--extended-regexp', '--all-match', `--grep=^${LORE_ID_KEY}: ${loreId}`];
    if (this.isScoped) {
      logArgs.push('--', '.');
    }
    const rawCommits = await this.gitClient.log(logArgs);
    const atoms = await this.parseRawCommits(rawCommits);

    return atoms.find((atom) => atom.loreId === loreId) ?? null;
  }

  /**
   * Find a single atom by its git commit hash.
   * Fetches the commit via `git log -1 <hash>` and parses it.
   * Returns null if the commit has no valid Lore trailers.
   */
  async findByCommitHash(hash: string): Promise<LoreAtom | null> {
    const logArgs = ['-1', hash];
    if (this.isScoped) {
      logArgs.push('--', '.');
    }
    const rawCommits = await this.gitClient.log(logArgs);
    const atoms = await this.parseRawCommits(rawCommits);
    return atoms.length > 0 ? atoms[0] : null;
  }

  /**
   * Find atoms within a git revision range (e.g., "main..HEAD").
   * Passes the range directly to git log.
   */
  async findByRange(range: string): Promise<LoreAtom[]> {
    const logArgs = [range];
    if (this.isScoped) {
      logArgs.push('--', '.');
    }
    const rawCommits = await this.gitClient.log(logArgs);
    return this.parseRawCommits(rawCommits);
  }

  /**
   * Find Lore atoms across the entire repository.
   *
   * Uses "Atom Discovery Mode" to push filters (Lore-id, author, scope) down to
   * the Git layer for optimized performance on large repositories.
   */
  async findAll(options: Partial<PathQueryOptions> = {}): Promise<LoreAtom[]> {
    const queryOptions = this.makeDefaultOptions(options);
    const args = this.buildLogArgs(queryOptions);

    if (this.isScoped) {
      args.push('--', '.');
    }

    const rawCommits = await this.gitClient.log(args);
    const atoms = await this.parseRawCommits(rawCommits);
    return this.applyFilters(atoms, queryOptions);
  }

  /**
   * Find atoms matching a conventional commit scope.
   * Parses the subject line to extract scope from `type(scope): description`.
   */
  async findByScope(scope: string, options: PathQueryOptions): Promise<LoreAtom[]> {
    const queryOptions = { ...options, scope };
    const logArgs = this.buildLogArgs(queryOptions);
    
    if (this.isScoped) {
      logArgs.push('--', '.');
    }

    const rawCommits = await this.gitClient.log(logArgs);
    const atoms = await this.parseRawCommits(rawCommits);
    return this.applyFilters(atoms, queryOptions);
  }

  /**
   * Transitively resolve follow links (Related, Supersedes, Depends-on)
   * from the given atoms using BFS up to maxDepth.
   */
  async resolveFollowLinks(atoms: readonly LoreAtom[], maxDepth: number): Promise<LoreAtom[]> {
    if (maxDepth <= 0 || atoms.length === 0) {
      return [...atoms];
    }

    const collected = new Map<string, LoreAtom>();
    for (const atom of atoms) {
      collected.set(atom.loreId, atom);
    }

    const queue: Array<{ loreId: LoreId; depth: number }> = [];

    // Seed the BFS with all reference IDs from the initial atoms
    for (const atom of atoms) {
      const refIds = this.extractReferenceIds(atom.trailers);
      for (const refId of refIds) {
        if (!collected.has(refId)) {
          queue.push({ loreId: refId, depth: 1 });
        }
      }
    }

    while (queue.length > 0) {
      const entry = queue.shift()!;
      if (entry.depth > maxDepth) {
        continue;
      }
      if (collected.has(entry.loreId)) {
        continue;
      }

      const resolved = await this.findByLoreId(entry.loreId);
      if (resolved === null) {
        continue;
      }

      collected.set(resolved.loreId, resolved);

      if (entry.depth < maxDepth) {
        const nextRefIds = this.extractReferenceIds(resolved.trailers);
        for (const refId of nextRefIds) {
          if (!collected.has(refId)) {
            queue.push({ loreId: refId, depth: entry.depth + 1 });
          }
        }
      }
    }

    return Array.from(collected.values());
  }

  /**
   * Build the base git log format arguments.
   * Uses NUL-separated fields for reliable parsing.
   */
  private buildBaseLogArgs(): string[] {
    return [];
  }

  /**
   * Build git log arguments including optional filters from PathQueryOptions.
   * Uses optimized coarse discovery by pushing filters to the Git layer.
   */
  private buildLogArgs(options: PathQueryOptions): string[] {
    const args = this.buildBaseLogArgs();

    if (options.since) {
      args.push(`--since=${options.since}`);
    }
    if (options.until) {
      args.push(`--until=${options.until}`);
    }
    if (options.maxCommits !== null && options.maxCommits > 0) {
      args.push(`--max-count=${options.maxCommits}`);
    }

    // Atom Discovery Mode:
    // We always include a check for a valid Lore-id so Git only returns valid atoms.
    // This allows us to skip non-Lore commits (merges, chores, etc.) at the Git layer.
    args.push(`--grep=^${LORE_ID_KEY}: [0-9a-f]{8}`);
    args.push('--extended-regexp');
    args.push('--regexp-ignore-case');

    // Use --all-match to ensure the Lore-id AND any other filters match (Lore semantics)
    args.push('--all-match');

    if (options.author) {
      args.push(`--author=${options.author}`);
    }

    if (options.scope) {
      // Improved precision: Match conventional commit type prefix and start of line.
      args.push(`--grep=^[a-zA-Z]+\\(${options.scope}\\)`);
    }

    return args;
  }

  /**
   * Parse an array of RawCommit into LoreAtom[], filtering out non-Lore commits.
   */
  private async parseRawCommits(rawCommits: readonly RawCommit[]): Promise<LoreAtom[]> {
    // First pass: filter to Lore commits and parse trailers (synchronous work)
    const loreCommits: Array<{ raw: RawCommit; trailers: LoreTrailers }> = [];

    for (const raw of rawCommits) {
      if (!this.trailerParser.containsLoreTrailers(raw.trailers)) {
        continue;
      }

      const trailers = this.trailerParser.parse(raw.trailers);
      const loreId = trailers[LORE_ID_KEY]?.[0];
      if (!loreId || !LORE_ID_PATTERN.test(loreId)) {
        continue;
      }

      loreCommits.push({ raw, trailers });
    }

    // Second pass: bulk fetch file lists using high-performance batch mode.
    const hashes = loreCommits.map(c => c.raw.hash);
    const filesMap = await this.gitClient.getFilesChanged(hashes);

    // Build atoms by pairing parsed trailers with their file lists from the batch result
    const atoms: LoreAtom[] = loreCommits.map(({ raw, trailers }) =>
      this.buildAtom(raw, trailers, filesMap.get(raw.hash) ?? []),
    );

    return atoms;
  }

  /**
   * Construct a LoreAtom from its constituent parts.
   * Single source of truth for RawCommit -> LoreAtom mapping.
   * GRASP: Creator -- AtomRepository owns the data needed to create atoms.
   */
  private buildAtom(raw: RawCommit, trailers: LoreTrailers, filesChanged: readonly string[]): LoreAtom {
    const loreId = trailers[LORE_ID_KEY]?.[0];
    if (!loreId) throw new Error(`${LORE_ID_KEY} missing in trailers`);

    return {
      loreId,
      commitHash: raw.hash,
      date: new Date(raw.date),
      author: raw.author,
      intent: raw.subject,
      body: this.stripTrailersFromBody(raw.body, raw.trailers),
      trailers,
      filesChanged,
    };
  }

  /**
   * Strip the trailer block from the body text.
   * Git's %b includes trailers; %(trailers) gives them separately.
   * We remove the trailer text from the body to avoid duplication.
   */
  private stripTrailersFromBody(body: string, trailersRaw: string): string {
    if (!trailersRaw.trim()) return body;

    // The trailers appear as the last paragraph of the body.
    // Find and remove them by looking for the trailer lines at the end.
    const trailerLines = trailersRaw.trim().split('\n');
    if (trailerLines.length === 0) return body;

    // Try to find the first trailer line in the body and strip from there
    const firstTrailerLine = trailerLines[0].trim();
    const idx = body.lastIndexOf(firstTrailerLine);
    if (idx >= 0) {
      return body.slice(0, idx).trim();
    }

    return body;
  }

  /**
   * Apply post-query filters (author, since) that weren't handled at the git level.
   * Note: author and since are also passed to git log, but this provides a second
   * layer of filtering for edge cases and absolute precision.
   */
  private applyFilters(atoms: LoreAtom[], options: PathQueryOptions): LoreAtom[] {
    let result = atoms;

    if (options.scope) {
      const scopeLower = options.scope.toLowerCase();
      result = result.filter((a) => {
        const extracted = this.extractScope(a.intent);
        return extracted !== null && extracted.toLowerCase() === scopeLower;
      });
    }

    if (options.author) {
      const authorLower = options.author.toLowerCase();
      result = result.filter(
        (atom) => atom.author.toLowerCase().includes(authorLower),
      );
    }

    if (options.since) {
      const sinceDate = new Date(options.since);
      if (!isNaN(sinceDate.getTime())) {
        result = result.filter((atom) => atom.date >= sinceDate);
      }
    }

    if (options.until) {
      const untilDate = new Date(options.until);
      if (!isNaN(untilDate.getTime())) {
        result = result.filter((atom) => atom.date <= untilDate);
      }
    }

    return result;
  }

  /**
   * Create a complete PathQueryOptions object from partial overrides.
   */
  private makeDefaultOptions(overrides: Partial<PathQueryOptions> = {}): PathQueryOptions {
    return {
      scope: null,
      follow: false,
      all: false,
      author: null,
      limit: null,
      maxCommits: null,
      since: null,
      until: null,
      ...overrides,
    };
  }

  /**
   * Extract the scope from a conventional commit subject line.
   * Pattern: `type(scope): description`
   * Returns null if no scope is found.
   */
  private extractScope(subject: string): string | null {
    const match = subject.match(/^[a-zA-Z]+\(([^)]+)\)/);
    return match ? match[1] : null;
  }

  /**
   * Extract all referenced Lore-ids from the reference trailers
   * (Supersedes, Depends-on, Related).
   */
  private extractReferenceIds(trailers: LoreTrailers): LoreId[] {
    const ids: LoreId[] = [];
    const refKeys = this.protocol.getReferenceKeys();

    for (const key of refKeys) {
      const values = trailers[key] as readonly LoreId[];
      if (!values) continue;
      for (const id of values) {
        if (LORE_ID_PATTERN.test(id)) {
          ids.push(id);
        }
      }
    }

    return ids;
  }
}
