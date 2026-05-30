# Test Architecture Mandates for Gemini CLI

Decision tracking and testing consistency are managed by the Lore Protocol. When modifying or adding tests in this repository, you MUST adhere to the following 4-Level hierarchy.

## Hierarchy & Placement
1. **Level 1: Logic (`tests/[package]/logic/`)**
   - Pure unit tests. No `IGitClient` mocks. No disk access.
2. **Level 2: Contract (`tests/[package]/contract/`)**
   - Service integration. Use `makeMock*` factories from `tests/engine/engine-test-utils.ts`.
3. **Level 3: System (`tests/[package]/system/`)**
   - Infrastructure integration. Use `tests/engine/system/` for real Git interaction.
4. **Level 4: Architecture (`tests/[package]/architecture/`)**
   - Integrity tests (e.g., `protocol-integrity.test.ts`).

## Mocking Mandates
- **NEVER** use manual object literals with `vi.fn()` for core services (Git, Repository, Resolver).
- **ALWAYS** use the high-fidelity factories:
    - `makeMockGitClient()`
    - `makeMockAtomRepository()`
    - `makeMockSupersessionResolver()`
- **REAL INSTANCES**: Use `makeAtomRepository()` (no `Mock`) only when testing component-level interactions that require real service logic but mocked infrastructure.

## Test Maintenance
- **REFACTORING**: If you refactor a service, prioritize updating the corresponding Level 2 Contract tests first.
- **NEW FEATURES**: Every new engine utility MUST have a Level 1 Logic test.
- **BUG FIXES**: Every bug fix MUST have an empirical reproduction test in either Level 1 or Level 2 before the fix is applied.
