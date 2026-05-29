# ARCHITECTURAL MANIFESTO: The Atom Engine

**System Definition:** The `atom` engine is a **Directed Acyclic Heterogeneous Graph Database** that utilizes Git commit trailers as its temporal storage layer. The `lore` CLI is simply an opinionated, branded wrapper that provides customized formatters and shortcut commands over this agnostic engine.

## 1. Core Architectural Postulates

*   **Immutable Identity:** We will **not** use Git commit hashes as node identifiers, as hashes mutate during `rebase` and `amend`, severing graph edges. The engine strictly requires explicit identity trailers (e.g., `Atom-Id`, `Lore-id`) coupled with `permissive: true` definitions for zero-configuration flexibility.
*   **The Commit is the Envelope:** Graph relationships and validity degradation (staleness) operate at the **Commit Level**, not the individual trailer level. If a single trailer (e.g., an expired directive) triggers a degradation signal, the *entire commit* is flagged. This is a deliberate UX constraint to enforce "Atomic Commits" and prevent impossibly complex human commit generation.
*   **Semantic Terminology:** The concept of "Staleness" is an opinionated human metaphor. From the engine's perspective, this is a **Validity Evaluator** assessing three vectors: Contextual Drift (file changes), Temporal Expiration (time limits), and Graph Integrity (orphaned dependency edges).

## 2. The Multi-Protocol Namespace Paradigm

To support a true heterogeneous graph (multiple protocols interacting in the same codebase) without data corruption, we utilize the **"Host Protocol" Pattern** combined with **URI-Style Edge Addressing**.

*   **The Host Protocol:** Exactly *one* primary protocol (e.g., Lore for engineering) is granted the root namespace. All other secondary protocols (e.g., Product, Security) are forced into strict key namespaces.
*   **Trailer Keys vs. Trailer Values:**
    *   *Keys dictate edge ownership (Parser):* `Prod/Depends-on:` means the Product protocol owns this relationship. The `/` ensures perfect hierarchical parsing.
    *   *Values dictate target nodes (Router):* `lore:a1b2c3d4` (Absolute URI) means the engine must query the Lore sub-graph. Unprefixed values (`p-999`) implicitly resolve to the protocol that owns the key. The `:` acts as the routing boundary.
*   **Example of a Perfect Cross-Domain Node:**
    ```text
    Lore-id: a1b2c3d4                 <-- Host protocol (Root)
    Constraint: Must use TLS v1.3     <-- Host protocol (Root)
    Prod/Id: p-1234                   <-- Secondary protocol (Namespaced)
    Prod/Depends-on: lore:a1b2c3d4    <-- Cross-domain edge
    Sec/Status: Pass                  <-- Secondary protocol (Namespaced)
    ```

---

## 3. COMPLETED MILESTONES

### Phase 1: Semantic Roles & Expertise Delegation
*   **Action**: Transitioned schema validation and value normalization into the `Protocol` class. Decomposed `Protocol` into specialized capability modules (`Schema`, `Interpreter`, `Validator`, `QueryAdapter`).
*   **Result**: The engine no longer hardcodes schema logic; it treats protocols as autonomous domain experts. Standardized the interpreted state as a pure data payload.

### Phase 1.5: Decoupled Versioning & Build-time Injection
*   **Action**: Implemented the "Rich UI vs. Pure NPM" versioning system. Injected build-time constants (`__ATOM_PURE_VERSION__`, etc.) to eliminate runtime filesystem overhead.
*   **Result**: Optimized update checks and provided transparent version reporting for branded wrappers.

### Phase 1.6: Schema Unification & Mandatory Policy
*   **Action**: Flattened `ProtocolConfig` and `ProtocolDefinition` into a unified schema. Made `strict/permissive` flags mandatory at the protocol level.
*   **Result**: Every protocol now explicitly owns its enforcement stance, and configuration merging is architecturally symmetrical.

### Phase 10: Declarative Rules Engine (stale_if)
*   **Action**: Replaced hardcoded TypeScript staleness hooks with a structured, declarative DSL in the protocol schema. 
*   **Result**: Protocols like Lore are now 100% declarative. The engine natively evaluates `value-equals`, `date-expired`, and `reference-superseded` triggers. This enables "Zero-Code Protocols."

---

## 4. STRATEGIC ROADMAP: Implementation Phases

### PHASE 2: Drift Bottleneck Optimization
**Urgency**: High | **Importance**: High | **Difficulty**: Medium
**Problem:** A global `lore stale` query runs `git rev-list --count` for every file in every active commit, resulting in catastrophic O(N*M) subprocess overhead on large repositories. There is no cache.
**Action:** Implement the "Bounded Time Window Stream".
*   Find the timestamp/hash of the oldest active node in the analysis batch.
*   Execute exactly *one* bounded subprocess: `git log --format=format:%H --name-only <oldestHash>..HEAD`.
*   Build a localized timeline in memory and calculate file drift counts synchronously, dropping subprocess overhead to O(1).

### PHASE 8: Framework Bootstrapper (Atom-as-a-Library)
**Urgency**: High | **Importance**: High | **Difficulty**: Medium
**Concept:** Refactor the monolithic `runCli` God-function into a modular `EngineBootstrapper` class.
**Action:** Allow external wrappers (like Lore) to instantiate the engine, register custom commands/formatters, and control the lifecycle programmatically.
**Value:** Enables developers to build their own branded "Industrial Strength" decision tools on top of Atom with minimal code.

### PHASE 9: "Lazy" (Auto-Interactive) Interaction Model
**Urgency**: High | **Importance**: Medium | **Difficulty**: Low
**Concept:** Move from "Binary Enforcement" to "Helpful Guidance" for human users.
**Action:** Implement a `greedy: true` mode in the `CommitInputResolver`. If a user misses a `required: true` trailer in a TTY environment, the engine automatically invokes the `TerminalPrompt` service instead of failing.
**Value:** Provides a professional, frictionless UX for humans while maintaining strict schema validity for machines and AI agents.

### PHASE 7.6: Universal TypeScript Conversion
**Urgency**: Medium | **Importance**: High | **Difficulty**: Low
**Concept:** Eliminate the last remaining `.js` orphans in the source tree to ensure total type safety and testability.
**Action:** Convert `rebase-editor.js`, `rewrite-trailers.js`, and `extract-lore-state.cjs` to `.ts`. Add isolated tests for programmatic rebase logic.

### PHASE 3: Hosted Protocol Registry
**Urgency**: Medium | **Importance**: High | **Difficulty**: Medium
**Vision:** Create an ecosystem where organizations can download standardized engineering, security, and product workflows just like npm packages (e.g., `@standard/security`).
**Action:** Implement the "Pure Schema + Local Override" config model.
*   Treat downloaded protocol schema files as **immutable, pure artifacts**.
*   Enhance `.atom/config.toml` to act as a **Local Override Layer**. This allows a repository to enable a downloaded protocol, assign it a strict namespace, change its terminal colors, or toggle fields to `required: true` without ever modifying the pure schema file.

### PHASE 7: Dependency-Injected Protocol Hooks
**Urgency**: Medium | **Importance**: Medium | **Difficulty**: Medium
**Concept:** Move away from static `ProtocolDefinition` hooks and provide protocols with runtime access to engine services like the `ProtocolRegistry`.
**Value:** Eliminates logic duplication. Protocols can use `protocolRegistry.resolveIdentity()` directly inside their hooks instead of manually parsing URI strings, ensuring perfect alignment with the engine's resolution rules.

### PHASE 7.5: Interface Segregation (ISP) Refinement
**Urgency**: Low | **Importance**: Medium | **Difficulty**: Medium
**Concept:** De-fatten the `IProtocol` facade and update engine services to depend on specific capability interfaces (`IProtocolValidator`, `IProtocolInterpreter`, etc.).
**Action**: Audit all engine constructors and signatures to use the most restrictive interface possible.
**Status**: INVESTIGATED (ISP Audit completed; implementation deferred to multi-repo split).

### PHASE 4: Federated Graph (Remote Edge Resolution)
**Urgency**: Low | **Importance**: High | **Difficulty**: High
**Vision:** Enable cross-repository dependency tracing to support enterprise microservice architectures. 
**Action:** 
*   Expand the URI value syntax to support remote targets using an `@` origin (e.g., `lore@backend-api:a1b2c3d4`).
*   Introduce a `[remotes]` configuration block in `.atom/config.toml` mapping remote names to Git URLs.
*   Build a local caching layer (`atom fetch`) that allows the `AtomRepository` to traverse edges across physical repository boundaries by querying cached headless git histories, creating a global enterprise graph.

---

## 5. BEYOND THE ENGINE: Future Exploitation & Killer Features

### 1. Predictive Blast Radius (Forward Propagation)
*   **Concept:** Instead of tracing backward (why does this exist?), the engine traces forward to calculate the impact of changing or deprecating a node.
*   **Mechanism:** Uses "lazy evaluation" and recursive `git log --grep=<target-id>` queries. It finds nodes that point to the target, then finds nodes that point to those nodes, radiating outward.
*   **Value:** Transforms Git into a Predictive Risk Engine. Running `atom impact p-500` will warn a PM exactly which Engineering APIs and Security validations will be orphaned if they deprecate a requirement.

### 2. The AI Context Engine (Graph-RAG)
*   **Concept:** Provide LLMs with the perfect semantic context payload, allowing them to understand the *intent* behind the codebase, not just the syntax.
*   **Mechanism:** An `atom export --llm` command. This is fundamentally different from `atom log --json`. 
    *   It strips operational database noise (hashes, timestamps, authors).
    *   It "flattens" the complex graph topology into linear semantic narratives.
    *   It strictly filters out superseded or inactive nodes to prevent AI hallucinations.
    *   It outputs token-efficient XML/Markdown instead of deeply nested JSON.
*   **Value:** Turns generic AI coding assistants into Senior Staff Engineers who understand cross-departmental business rules.

### 3. Atom Query Language (AQL)
*   **Concept:** Move away from hardcoded CLI flags (`--drift`, `--older-than`) and provide a Cypher/SQL-like language for terminal and CI/CD operations.
*   **Mechanism:** A dedicated query parser.
    *   `atom query "MATCH (Lore) WHERE files_touched('src/api') AND age > 1y"`
    *   `atom assert "NO Lore NODE MAY DEPEND_ON A REJECTED Prod NODE"`
*   **Value:** Allows DevSecOps teams to build infinitely customizable CI/CD pipeline gates based on the mathematical state of the knowledge graph.

---

## 6. PARADIGM-SHIFTING CONCEPTS: The Edge of the Graph

### 1. The Time-Travel Diff (`atom diff --semantic`)
*   **Concept:** Elevate `git diff` from syntax to architecture. Show what *business context* changed between two branches, not just what lines of code changed.
*   **Mechanism:** The engine computes the delta between the active graph state of `main` and the active graph state of `feature-branch`.
*   **Value:** Outputs summaries like: `➕ Added Requirement: p-888`, `➖ Deprecated Constraint: a1b2c3d4`, `⚠️ 2 Security rules orphaned`. It makes code reviews dramatically more intelligent.

### 2. Auto-Healing Constraints (Executable Edges)
*   **Concept:** Move from passive documentation to living, self-testing rules.
*   **Mechanism:** Protocols define executable trailers (e.g., `Validation-Script: ./perf-test.sh`). When `atom validate` runs, the engine executes the script attached to the node. If the script fails, the engine automatically flags the node as Stale/Invalid.
*   **Value:** The graph becomes a living test suite intrinsically tied to the architectural decisions that created the tests.

### 3. The "Ghost Protocol" (Invisible Machine Telemetry)
*   **Concept:** Allow bots and CI/CD pipelines to silently inject massive amounts of telemetry (security scans, test results, PM status updates) into the graph without causing merge conflicts or polluting the developer's `git log`.
*   **Mechanism 1: Git Notes (Mutable Append):** Utilize `git notes add/edit`. Git Notes act like sticky notes that attach to a commit without modifying its hash. This solves the "Immutability vs. Updatability" problem. A PM runs `atom update <id> --set Status=Deprecated`, the engine appends a note, and future parses merge the note with the original trailers on the fly.
*   **Mechanism 2: Parallel Refs (Immutable Telemetry Graph):** Instead of modifying existing commits, bots write empty commits packed with metadata to a completely hidden namespace (e.g., `refs/telemetry/main`, similar to how GitHub hides PRs in `refs/pull/`). These commits are immutable and tracked, but completely invisible to standard `git log` commands. The `atom` engine weaves them together by querying both namespaces simultaneously (`git log HEAD refs/telemetry/main`), seamlessly interleaving developer intent with automated telemetry.
*   **Value:** Transforms the repository into a unified ingestion point for both human decisions and high-frequency machine telemetry, all while keeping the working tree perfectly clean.

### 4. The Unified Resolution Graph (Telemetry + Human Intent)
*   **Concept:** Enable a bi-directional communication channel between automated bots (security, QA) and human developers, where automated issues are resolved via explicit URI links.
*   **Mechanism:** 
    *   **Ghost Nodes:** Telemetry nodes (e.g., `Sec/Id: g-555`) exist on a parallel `refs/telemetry/main` namespace.
    *   **Resolution Edges:** A human developer resolves an issue by creating a new `Lore` commit that uses the URI `Depends-on: sec:g-555`.
    *   **Derived State:** The engine treats "Resolved" as a derived state: if an active `Lore` commit depends on a `Ghost` node, that node is programmatically marked `Status: Resolved` in the graph view.
*   **Value:** Creates a persistent, auditable link between automated findings and human fixes without requiring developers to have write access to telemetry branches or requiring bot-human collaboration in the same commit history.

### 5. Discovery Mapping & Configuration Cascade
*   **Concept:** Decouple protocol *types* from their *physical location*. The `ProtocolRegistry` defines the schema, while the `config.toml` acts as the Discovery Layer.
*   **Discovery Mapping:** Every protocol is mapped to physical locations (Branches or Remotes). 
    *   *Host Protocol:* Defaults to `HEAD`.
    *   *Secondary Protocols:* Can be explicitly mapped to hidden namespaces (e.g., `refs/telemetry/main`) or external remote repositories.
*   **Configuration Cascade:** The engine uses a three-tier resolution order to determine behavior:
    1.  **System Defaults:** Hardcoded engine defaults.
    2.  **Protocol Definitions:** The "Pure Schema" providing base rules (e.g., Lore defaults to root namespace).
    3.  **Local Overrides:** Repository-specific `config.toml` that maps locations, toggles `required` fields, and enforces custom namespaces.
*   **Value:** Provides "Zero-Configuration" for simple projects while enabling "Progressive Configuration" for complex enterprise federated graphs.

### 6. Protocol-Accessible Domain Caching
*   **Concept**: Transition the `AtomCache` from a purely structural engine tool (drift detection) to a shared service for Protocol plugins.
*   **Value**: Allows custom protocols to cache computationally expensive signal data (e.g., results of external API calls or deep graph traversals) within the engine's sharded filesystem cache.
