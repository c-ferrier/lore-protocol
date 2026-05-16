import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerSearchCommand } from '../../../src/commands/search.js';
import type { AtomRepository } from '../../../src/services/atom-repository.js';
import type { SupersessionResolver } from '../../../src/services/supersession-resolver.js';
import type { SearchFilter } from '../../../src/services/search-filter.js';
import type { IOutputFormatter } from '../../../src/interfaces/output-formatter.js';
import { LoreError } from '../../../src/util/errors.js';
import type { LoreConfig } from '../../../src/types/config.js';

describe('Search Command Validation (Perfect Mirror)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockDeps = (customWhitelist: string[]) => {
    const atomRepository = {
      findAll: vi.fn().mockResolvedValue([]),
    } as unknown as AtomRepository;

    const supersessionResolver = {
      resolve: vi.fn().mockReturnValue(new Map()),
      filterActive: vi.fn().mockReturnValue([]),
    } as unknown as SupersessionResolver;

    const searchFilter = {
      applyFilters: vi.fn().mockReturnValue([]),
    } as unknown as SearchFilter;

    const formatter = {
      formatQueryResult: vi.fn().mockReturnValue(''),
    } as unknown as IOutputFormatter;

    const config = {
      trailers: {
        custom: customWhitelist,
      },
    } as unknown as LoreConfig;

    return {
      atomRepository,
      supersessionResolver,
      searchFilter,
      getFormatter: () => formatter,
      config,
    };
  };

  it('should allow searching for any trailer when custom list is empty (Greedy Mode)', async () => {
    const deps = mockDeps([]);
    const program = new Command();
    program.exitOverride();
    registerSearchCommand(program, deps);

    // Should NOT throw
    await program.parseAsync(['node', 'lore', 'search', '--has', 'Random-Trailer']);
    expect(deps.atomRepository.findAll).toHaveBeenCalled();
  });

  it('should allow searching for whitelisted custom trailers in Strict Mode', async () => {
    const deps = mockDeps(['Ticket']);
    const program = new Command();
    program.exitOverride();
    registerSearchCommand(program, deps);

    // Should NOT throw for whitelisted trailer
    await program.parseAsync(['node', 'lore', 'search', '--has', 'Ticket']);
    expect(deps.atomRepository.findAll).toHaveBeenCalled();
  });

  it('should allow searching for standard trailers even in Strict Mode', async () => {
    const deps = mockDeps(['Ticket']);
    const program = new Command();
    program.exitOverride();
    registerSearchCommand(program, deps);

    // Should NOT throw for standard trailer
    await program.parseAsync(['node', 'lore', 'search', '--has', 'Constraint']);
    expect(deps.atomRepository.findAll).toHaveBeenCalled();
  });

  it('should throw LoreError when searching for unregistered trailer in Strict Mode', async () => {
    const deps = mockDeps(['Ticket']);
    const program = new Command();
    program.exitOverride();
    registerSearchCommand(program, deps);

    // Should throw LoreError for unregistered trailer
    try {
      await program.parseAsync(['node', 'lore', 'search', '--has', 'Assisted-by']);
      expect.fail('Should have thrown LoreError');
    } catch (error) {
      expect(error).toBeInstanceOf(LoreError);
      expect((error as LoreError).message).toContain('is not recognized');
      expect((error as LoreError).message).toContain('Ticket');
    }
  });
});
