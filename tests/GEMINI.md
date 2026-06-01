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
- **NEVER** use manual object literals with `vi.fn()` for core services in new tests.
- **ALWAYS** use the high-fidelity factories from the appropriate gateway:
    - **Logic Factories**: Use `src/engine/testing.ts` (e.g., `makeStubProtocol`, `makeCommitInput`). These are framework-agnostic and 100% interface-compliant.
    - **Vitest Bridge**: Use `tests/engine/engine-test-utils.ts` (e.g., `makeMockGitClient`, `makeMockProtocol`). These wrap the stubs in Vitest `vi.fn()` spies for full observability.
- **REAL INSTANCES**: Use `makeAtomRepository()` (no `Mock`) from the testing gateway when testing component-level interactions that require real service logic but mocked infrastructure.

## Diagnostic Protocol
- **MANDATE**: If a test regression persists after **3 attempts** at speculative patching, you MUST transition to **Diagnostic Mode**.
- **ACTION**: Inject `console.log` diagnostic traces into the relevant service logic to trace state flow.
- **RATIONALE**: Empiric evidence is superior to speculative patching in complex logical routing systems.

## Test Maintenance
- **REFACTORING**: If you refactor a service, prioritize updating the corresponding Level 2 Contract tests first.
- **NEW FEATURES**: Every new engine utility MUST have a Level 1 Logic test.
- **BUG FIXES**: Every bug fix MUST have an empirical reproduction test in either Level 1 or Level 2 before the fix is applied.
