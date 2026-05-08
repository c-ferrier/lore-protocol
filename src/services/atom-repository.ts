import type { IGitClient, RawCommit } from '../interfaces/git-client.js';
import type { QueryOptions, AtomsResult } from '../types/query.js';
import type { LoreAtom, LoreId, LoreTrailers, TrailerKey } from '../types/domain.js';
import type { TrailerParser } from '../services/trailer-parser.js';
import type { IAtomCache } from '../interfaces/atom-cache.js';
import type { IQueryCache } from '../interfaces/query-cache.js';
import type { SupersessionResolver } from '../services/supersession-resolver.js';
import { LORE_ID_PATTERN, REFERENCE_TRAILER_KEYS, GIT_FILES_CHANGED_BATCH_SIZE, ARRAY_TRAILER_KEYS, ENUM_TRAILER_KEYS } from '../util/constants.js';
import { NullAtomCache } from './atom-cache.js';
import { NullQueryCache } from './query-cache.js';

/**
 * Retrieves LoreAtoms from git history.
 * The central query engine for all Lore-related git log queries.
 *
 * GRASP: Pure Fabrication -- persistence access abstracted from domain.
 * SOLID: DIP -- depends on IGitClient interface, not child_process
 */
export class AtomRepository {
  constructor(
    private readonly gitClient: IGitClient,
    private readonly trailerParser: TrailerParser,
    private readonly supersessionResolver: SupersessionResolver,
    private readonly atomCache: IAtomCache = new NullAtomCache(),
    private readonly queryCache: IQueryCache = new NullQueryCache(),
    private readonly customTrailerKeys: readonly string[] = [],
  ) {}


  /**
   * Find atoms that touched the given target path/file/directory.
   * Accepts pre-resolved git log args (from PathResolver) so that
   * path resolution is the caller's responsibility (DIP).
   */
  async findByTarget(gitLogArgs: readonly string[], options: Partial<QueryOptions>): Promise<AtomsResult> {
    return this.findAtoms(gitLogArgs, this.makeDefaultOptions(options));
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

    const logArgs = ['--all', `--grep=Lore-id: ${loreId}`];
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
    const rawCommits = await this.gitClient.log(['-1', hash]);
    const atoms = await this.parseRawCommits(rawCommits);
    return atoms.length > 0 ? atoms[0] : null;
  }

  /**
   * Find atoms within a git revision range (e.g., "main..HEAD").
   * Passes the range directly to git log.
   */
  async findByRange(range: string): Promise<AtomsResult> {
    return this.findAtoms([range], this.makeDefaultOptions());
  }

  /**
   * Find all Lore atoms, optionally filtered by date range and limit.
   */
  async findAll(options: Partial<QueryOptions> = {}): Promise<AtomsResult> {
    return this.findAtoms([], this.makeDefaultOptions(options));
  }

  /**
   * Find atoms matching a conventional commit scope.
   * Parses the subject line to extract scope from `type(scope): description`.
   */
  async findByScope(scope: string, options: Partial<QueryOptions>): Promise<AtomsResult> {
    return this.findAtoms([], this.makeDefaultOptions({ ...options, scope }));
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
   * Build git log arguments based on query options.
   * Uses optimized coarse discovery by pushing filters to the Git layer.
   */
  private buildLogArgs(options: QueryOptions): string[] {
    const args: string[] = [];
    if (options.since) {
      args.push(`--since=${options.since}`);
    }
    if (options.until) {
      args.push(`--until=${options.until}`);
    }
    if (options.maxCommits && options.maxCommits > 0) {
      args.push(`--max-count=${options.maxCommits}`);
    }
    
    // Atom Discovery Mode:
    // We always include a check for a valid Lore-id so Git only returns valid atoms.
    // This allows us to skip non-Lore commits (merges, chores, etc.) at the Git layer.
    args.push('--grep=Lore-id: [0-9a-f]{8}');
    args.push('--extended-regexp');
    
    // Use --all-match to ensure the Lore-id AND any other filters match (Lore semantics)
    args.push('--all-match');

    // Coarse Filtering (Discovery Phase):
    // We push as many filters as possible to the Git layer for performance.
    // Git's --grep searches the entire message (subject + body), which may produce
    // false positives. We handle these in applyFilters() via Fine Filtering.
    const filters = [
      options.author ? { type: 'author', val: options.author } : null,
      options.text ? { type: 'grep', val: options.text } : null,
      options.scope ? { type: 'grep', val: `\\(${options.scope}\\):`, regex: true } : null,
    ].filter((f): f is NonNullable<typeof f> => f !== null);

    if (filters.length > 0) {
      args.push('--regexp-ignore-case');

      for (const filter of filters) {
        if (filter.type === 'author') {
          args.push(`--author=${filter.val}`);
        } else {
          args.push(`--grep=${filter.val}`);
        }
      }
    }

    return args;
  }

  /**
   * Filter and parse raw Git commits into LoreAtoms.
   * Uses AtomCache for file lists to optimize performance.
   */
  private async parseRawCommits(rawCommits: readonly RawCommit[]): Promise<LoreAtom[]> {
    // First pass: filter to Lore commits and parse trailers (synchronous work)
    const loreCommits: Array<{ raw: RawCommit; trailers: LoreTrailers }> = [];

    for (const raw of rawCommits) {
      if (!this.trailerParser.containsLoreTrailers(raw.trailers)) {
        console.log(`Commit ${raw.hash} skipped: No Lore trailers found in [${raw.trailers}]`);
        continue;
      }

      const trailers = this.trailerParser.parse(raw.trailers, this.customTrailerKeys);
      if (!LORE_ID_PATTERN.test(trailers['Lore-id'])) {
        console.log(`Commit ${raw.hash} skipped: Invalid Lore-id [${trailers['Lore-id']}]`);
        continue;
      }

      loreCommits.push({ raw, trailers });
    }

    // Second pass: get files changed using a 2-stage strategy.
    // Stage 1: Fast concurrent cache check for all identified Lore commits.
    const filesPerCommit: (readonly string[] | null)[] = await Promise.all(
      loreCommits.map(({ raw }) => this.atomCache.getFiles(raw.hash)),
    );

    const misses: Array<{ index: number; hash: string }> = [];
    for (let i = 0; i < filesPerCommit.length; i++) {
      if (filesPerCommit[i] === null) {
        misses.push({ index: i, hash: loreCommits[i].raw.hash });
      }
    }

    // Stage 2: Batched Git fetch for cache misses only (respecting concurrency limit).
    for (let i = 0; i < misses.length; i += GIT_FILES_CHANGED_BATCH_SIZE) {
      const batch = misses.slice(i, i + GIT_FILES_CHANGED_BATCH_SIZE);
      await Promise.all(
        batch.map(async ({ index, hash }) => {
          const files = await this.gitClient.getFilesChanged(hash);
          await this.atomCache.setFiles(hash, files);
          filesPerCommit[index] = files;
        }),
      );
    }


    // Build atoms by pairing parsed trailers with their file lists
    return loreCommits.map(({ raw, trailers }, index) =>
      this.buildAtom(raw, trailers, filesPerCommit[index] as readonly string[]),
    );
  }

  /**
   * Construct a LoreAtom from Git data and parsed trailers.
   * Single source of truth for RawCommit -> LoreAtom mapping.
   * GRASP: Creator -- AtomRepository owns the data needed to create atoms.
   */
  private buildAtom(raw: RawCommit, trailers: LoreTrailers, filesChanged: readonly string[]): LoreAtom {
    return {
      loreId: trailers['Lore-id'],
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
   * Apply application-level filters to a set of atoms.
   * Note: author and since are also passed to git log, but this provides a second
   * layer of filtering for edge cases and absolute precision.
   */
  private applyFilters(atoms: LoreAtom[], options: QueryOptions): LoreAtom[] {
    let result = atoms;

    if (options.scope) {
      const scopeLower = options.scope.toLowerCase();
      result = result.filter((a) => {
        const extracted = this.extractScope(a.intent);
        return extracted !== null && extracted.toLowerCase() === scopeLower;
      });
    }

    if (options.confidence) {
      result = result.filter((a) => a.trailers.Confidence === options.confidence);
    }

    if (options.scopeRisk) {
      result = result.filter((a) => a.trailers['Scope-risk'] === options.scopeRisk);
    }

    if (options.reversibility) {
      result = result.filter((a) => a.trailers.Reversibility === options.reversibility);
    }

    if (options.has) {
      result = result.filter((a) => this.atomHasTrailer(a, options.has!));
    }

    if (options.text) {
      const textLower = options.text.toLowerCase();
      result = result.filter((a) => this.atomMatchesText(a, textLower));
    }

    return result;
  }

  /**
   * Extract the conventional commit scope from a subject line.
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

    for (const key of REFERENCE_TRAILER_KEYS) {
      const values = trailers[key] as readonly LoreId[];
      for (const id of values) {
        if (LORE_ID_PATTERN.test(id)) {
          ids.push(id);
        }
      }
    }

    return ids;
  }

 /**
   * Check if an atom contains a specific trailer key with at least one value.
   */
  private atomHasTrailer(atom: LoreAtom, trailerKey: TrailerKey): boolean {
    if (trailerKey === 'Lore-id') {
      return !!atom.trailers['Lore-id'];
    }
    if ((ARRAY_TRAILER_KEYS as readonly string[]).includes(trailerKey)) {
      const val = atom.trailers[trailerKey as keyof typeof atom.trailers];
      return Array.isArray(val) && val.length > 0;
    }
    if ((ENUM_TRAILER_KEYS as readonly string[]).includes(trailerKey)) {
      return atom.trailers[trailerKey as keyof typeof atom.trailers] !== null;
    }
    return false;
  }

  /**
   * Perform thorough text search across an atom's intent, body, and trailers.
   */
  private atomMatchesText(atom: LoreAtom, textLower: string): boolean {
    if (atom.intent.toLowerCase().includes(textLower)) {
      return true;
    }
    if (atom.body.toLowerCase().includes(textLower)) {
      return true;
    }
    for (const key of ARRAY_TRAILER_KEYS) {
      if (atom.trailers[key].some(v => v.toLowerCase().includes(textLower))) {
        return true;
      }
    }
    for (const key of ENUM_TRAILER_KEYS) {
      if (atom.trailers[key]?.toLowerCase().includes(textLower)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Internal centralized discovery engine with result-level caching.
   */
  private async findAtoms(gitLogArgs: readonly string[], options: QueryOptions): Promise<AtomsResult> {
    const headHash = await this.gitClient.resolveRef('HEAD');

    // 1. Check Query Cache (Result-level)
    const cachedHashes = await this.queryCache.get(headHash, gitLogArgs, options);
    if (cachedHashes) {
      const totalCount = cachedHashes.length;
      if (totalCount === 0) {
        return { atoms: [], totalCount: 0, oldest: null, newest: null };
      }

      // Efficient Bound Hydration: hydrate first and last for date range.
      // Since the cache is sorted by date descending, index 0 is newest, last is oldest.
      const boundHashes = [cachedHashes[0], cachedHashes[totalCount - 1]];
      const boundCommits = await this.gitClient.getCommitsByHashes(boundHashes);
      const boundAtoms = await this.parseRawCommits(boundCommits);
      const newest = boundAtoms.length > 0 ? boundAtoms[0].date : null;
      const oldest = boundAtoms.length > 1 ? boundAtoms[1].date : newest;

      // Efficient Hydration: only hydrate the required slice
      const start = options.page && options.limit ? (options.page - 1) * options.limit : 0;
      const end = options.limit ? start + options.limit : totalCount;
      const slice = cachedHashes.slice(start, end);

      // Batch hydration to avoid command-line length limits on large result sets
      const rawCommits: RawCommit[] = [];
      for (let i = 0; i < slice.length; i += GIT_FILES_CHANGED_BATCH_SIZE) {
        const batch = slice.slice(i, i + GIT_FILES_CHANGED_BATCH_SIZE);
        const batchCommits = await this.gitClient.getCommitsByHashes(batch);
        rawCommits.push(...batchCommits);
      }
      
      const atoms = await this.parseRawCommits(rawCommits);
      // Ensure we trigger a prune on hit to manage cache size
      void this.queryCache.prune();
      return { atoms, totalCount, oldest, newest };
    }

    // 2. Cache Miss: Perform discovery + filtering
    const logArgs = this.buildLogArgs(options);
    const allArgs = [...logArgs, ...gitLogArgs];
    const rawCommits = await this.gitClient.log(allArgs);
    const allAtoms = await this.parseRawCommits(rawCommits);
    let filteredAtoms = this.applyFilters(allAtoms, options);

    // 2.5 Transitively resolve follow links if requested (Internalized Follow)
    // Moving this inside the repository ensures follow links are included in the query cache.
    if (options.follow) {
      filteredAtoms = await this.resolveFollowLinks(filteredAtoms, options.followDepth ?? 1);
    }

    // 2.6 Apply supersession filtering on the FINAL complete set (Targets + Follow Links)
    // This must happen after follow links are resolved to ensure pulled-in links aren't superseded.
    if (!options.all) {
      const supersessionMap = this.supersessionResolver.resolve(filteredAtoms);
      filteredAtoms = this.supersessionResolver.filterActive(filteredAtoms, supersessionMap);
    }

    // Sort by date descending (newest first) to ensure bounds are at index 0 and length-1.
    // This also ensures stable ordering when links are appended via follow logic.
    filteredAtoms.sort((a, b) => b.date.getTime() - a.date.getTime());

    const totalCount = filteredAtoms.length;
    const newest = totalCount > 0 ? filteredAtoms[0].date : null;
    const oldest = totalCount > 0 ? filteredAtoms[totalCount - 1].date : null;

    // 3. Persist the FULL final narrowed result set
    const finalHashes = filteredAtoms.map((atom) => atom.commitHash);
    await this.queryCache.set(headHash, gitLogArgs, options, finalHashes);
    // Ensure we trigger a prune on miss too
    void this.queryCache.prune();

    // Apply paging to the in-memory results
    const start = options.page && options.limit ? (options.page - 1) * options.limit : 0;
    const end = options.limit ? start + options.limit : totalCount;
    const atoms = filteredAtoms.slice(start, end);

    return { atoms, totalCount, oldest, newest };
  }

  /**
   * Create a complete QueryOptions object from partial overrides.
   */
  private makeDefaultOptions(overrides: Partial<QueryOptions> = {}): QueryOptions {
    return {
      scope: null,
      text: null,
      confidence: null,
      scopeRisk: null,
      reversibility: null,
      has: null,
      follow: false,
      followDepth: null,
      all: false,
      author: null,
      limit: null,
      page: null,
      maxCommits: null,
      since: null,
      until: null,
      ...overrides,
    };
  }
}
