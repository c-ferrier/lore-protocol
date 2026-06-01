## Senior Grade Refactoring Mandates

### 1. Surgical Editing Rule
 - **Mandate:** You MUST use the `replace` tool for all modifications to existing files.
 - **Exception:** `write_file` is strictly reserved for creating new files or tiny (<50 lines) utilities.
 - **Intent:** Forces the agent to be specific and prevents accidental clobbering of unrelated logic.

 ### 2. Baseline Parity Rule
 - **Mandate:** Before starting any refactoring, you MUST run `git show HEAD:path/to/file` to establish a mental baseline.
 - **Mandate:** After modifying any test file, you MUST run `node scripts/audit-tests.js HEAD <test_path>` and report any "LOST TESTS" to the user.
 - **Logic Sign-off:** You MUST provide a "Logic Parity Report" in your final turn, explicitly listing any behavioral assertions that were evolved, added, or intentionally removed.

### 3. Sub-Agent Audit
 - **Mandate**: For large changes (>3 files), you MUST invoke the `codebase_investigator` sub-agent to perform an independent audit of the diffs against these mandates before claiming completion.

### 4. Diagnostic Trace Mandate
 - **Mandate**: If a test regression persists after **3 attempts** at speculative patching, you MUST transition to **Diagnostic Mode**.
 - **Action**: Inject `console.log` diagnostic traces into the production logic to trace state flow.
 - **Requirement**: Use the empiric trace results to apply a targeted, high-fidelity fix rather than guessing.

