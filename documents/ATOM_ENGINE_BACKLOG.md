# ATOM ENGINE BACKLOG: Roadmap & Milestones

**System Definition:** The `atom` engine is a **Directed Acyclic Heterogeneous Graph Database** utilizing Git commit trailers as temporal storage. Branded wrappers (like `lore`) provide opinionated UIs over this agnostic core.

## 1. CORE ARCHITECTURAL POSTULATES

*   **Immutable Identity:** Strictly requires explicit identity trailers (e.g., `Lore-id`) for stable cross-rebase graph edges.
*   **The Commit is the Envelope:** Graph relationships and validity (staleness) operate at the commit level, not the trailer level.
*   **Implicit Sovereignty:** Unprefixed values (`a1b2c3d4`) resolve to the protocol that owns the key; prefixed values (`lore/a1b2`) are Absolute URIs.
*   **Namespace Rental Agreement:** Exactly one protocol per namespace (e.g., root "") can be `permissive: true` (the anchor).

---

## 2. COMPLETED MILESTONES

*   **Phase 1 (Expertise Delegation)**: Transitioned schema validation and normalization into autonomous capability modules.
*   **Phase 1.5 (Injection)**: Implemented build-time version constants to eliminate runtime filesystem overhead.
*   **Phase 1.6 (Unification)**: Flattened configuration and definition into a unified schema with mandatory policy flags.
*   **Phase 10 (Rules Engine)**: Replaced hardcoded staleness hooks with a structured, declarative DSL in the protocol schema.
*   **Phase 8 (Framework)**: Refactored CLI entry into `EngineBootstrapper` to enable Atom-as-a-Library integration.
*   **Phase 9 (Lazy UX)**: Implemented greedy interactive resolution for missing required trailers in TTY environments.
*   **Phase 3.7 - 3.9 (Batching)**: Promoted logical identities to handles and implemented batch hydration to neutralize N+1 Git bottlenecks.
*   **Phase 4.1 (Index)**: Implemented a persistent Identity Index for near-zero latency discovery across branch switches.
*   **Phase 4.2 (Strict Core)**: Enforced mandatory `protocol/id` addressing and implemented the 'Namespace Rental Agreement' with a System anchor.
*   **Phase 2 (Drift & Semaphore)**: Optimized discovery via Bounded Time Window Streams and enforced subprocess concurrency guards.
*   **Phase 0.0.0 (Cache GC)**: Replaced legacy LRU pruning with a HEAD-relative purging strategy to ensure data relevance.
*   **Test Infra (Zero-Cast)**: Refactored `MockedEngineInfra` and factories to return first-class mock handles, eliminating `vi.mocked()` boilerplate.

---

## 3. OPEN ROADMAP: Release Targets

### MILESTONE 0.0.1: Alpha Readiness (Operational Stability)
**Action**: Implement the final stability pillars for the initial internal alpha.
*   **Lore-JSON Scaling (Memory Safety)**: Refactor the `LoreJsonFormatter` compatibility shim to use a streaming model to prevent memory exhaustion on enterprise repos.
*   **Cross-Platform Physical Audit**: Audit path normalization and Git CLI builders for Windows backslash and shell compatibility.

### MILESTONE 0.0.X: Stability & Refinement (The "Professional" Utility)
**Action**: Polish the operational experience and add core UX features.
*   **Decomposed Formatter Types**: Replace the monolithic `FormattableQueryResult` with discrete `FormattableQueryHeader`, `FormattableQueryAtom`, and `FormattableQueryFooter` types. This aligns the data structures with the atomic streaming hooks and eliminates unnecessary data passing.
*   **Identity Auto-Detection**: Implement a fallback mechanism to pull `user.name` and `user.email` from the local `.gitconfig` when creating atoms.
*   **Surveyor Health Indicators**: Update CLI formatters to display a `⚠` warning next to trailers that have `invalidReferences` (malformed or unregistered IDs).
*   **High-Fidelity Narrative Squashing**: Implement a `--full` flag for `squash` to concatenate full atom bodies into a rich "evidence payload" for AI PR descriptions.
*   **Strict CLI Guardrails**: Prevent metadata loss by validating CLI flags against registered protocol schemas (typo prevention).

### MILESTONE 0.1.0: Public Beta (Scale & Ecosystem)
**Action**: Prepare the engine for high-performance usage and third-party protocol development.
*   **Layered Hydration (Performance recovery)**: Implement Light vs. Deep hydration to eliminate the O(N) CPU tax on global surveys of massive repositories.
*   **Hosted Protocol Registry**: Implement "Pure Schema + Local Override" model to allow users to download and configure standardized workflows (e.g., `@standard/security`).
*   **Dynamic Context Pivoting**: Allow the CLI to be invoked from outside a project by "teleporting" into context based on positional arguments (e.g. `lore log path/to/other-project`).
*   **Dependency-Injected Protocol Hooks**: Provide protocols with runtime access to engine services like the `ProtocolRegistry` for smarter declarative logic.

---

## 4. FUTURE ENHANCEMENTS: Paradigm Shifts

### Federated Graph & Performance
*   **Remote Edge Resolution**: Expand URI syntax (`lore@backend-api:a1b2`) to support cross-repository dependency tracing.
*   **Predictive Blast Radius**: Use forward propagation to calculate the risk of deprecating a requirement before the change is made.
*   **Interface Segregation (ISP) Refinement**: De-fatten the `IProtocol` facade and modularize engine services into restrictive capability interfaces.

### Narrative & AI Integration
*   **AI Context Engine (Graph-RAG)**: Provide LLMs with "flattened" semantic narratives by stripping database noise and filtering superseded nodes.
*   **The Time-Travel Diff**: Elevate `git diff` from syntax to architecture, showing which business requirements or constraints changed between branches.

### Advanced Operations
*   **Atom Query Language (AQL)**: Move away from CLI flags to a Cypher/SQL-like language for terminal and CI/CD operations (e.g., `MATCH (Lore) WHERE files_touched('src/api')`).
*   **Auto-Healing Constraints**: Allow protocols to define executable validation scripts (e.g. `./perf-test.sh`) that automatically flag atoms as stale upon failure.
*   **The "Ghost Protocol" (Invisible Machine Telemetry)**: Utilize Git Notes or Parallel Refs (e.g., `refs/telemetry/main`) to silently inject bot telemetry without polluting the human `git log`.
