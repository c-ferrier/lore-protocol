# Lore Protocol Test Architecture

This repository follows a strict 4-level testing hierarchy to ensure stability, maintainability, and readiness for the upcoming package split between the Atom Engine and the Lore Protocol.

## The 4 Levels of Testing

### Level 1: Logic (Pure Unit)
- **Folder**: `tests/[package]/logic/`
- **Scope**: Pure functional logic, utility functions, and deterministic algorithms.
- **Constraints**: 
  - No disk I/O or network calls.
  - No dependency mocking (except for internal logic injection if necessary).
  - Must be extremely fast.

### Level 2: Contract (Component Integration)
- **Folder**: `tests/[package]/contract/`
- **Scope**: Interaction between services, command logic, and state machine transitions.
- **Constraints**: 
  - Uses high-fidelity pure mocks (`makeMock*`) for external infrastructure like Git.
  - Verifies that components fulfill their public contracts.

### Level 3: System (Infrastructure Integration)
- **Folder**: `tests/[package]/system/`
- **Scope**: Integration with external binaries (Git) and the file system.
- **Constraints**: 
  - Hits real disk and executes real Git commands.
  - Used to verify that our Git wrappers correctly handle real-world version differences.

### Level 4: Architecture & E2E
- **Folder**: `tests/[package]/architecture/` or `tests/[package]/e2e/`
- **Scope**: Cross-package boundary integrity and full black-box user workflows.
- **Constraints**: 
  - Verifies that rebranding flows and dependency rules are respected.
  - Parity tests against previous production versions.

## Mocking Conventions

To reduce boilerplate and prevent test brittleness, always use the central factories in `tests/engine/engine-test-utils.ts` and `tests/lore/lore-test-utils.ts`:

- **`TEST_*`**: Standard baseline data (configs, schema definitions).
- **`make*`**: Real service instances with mocked dependencies (for Level 2/3 tests).
- **`makeMock*`**: Pure spycable objects returning `vi.fn()` methods (for Level 2 unit isolation).

## Test Hygiene
- Use `beforeEach` to ensure every test starts with a clean registry and fresh mock instances.
- Describe blocks should be hierarchical: `Component > Method > Scenario`.
- It blocks should read like requirements: `it('should resolve transitive links', ...)`
