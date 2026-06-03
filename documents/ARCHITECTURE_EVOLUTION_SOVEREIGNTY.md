# Architectural Specification: Discovery Sovereignty & Atomic Agnosticism
**Phase 4: The Universal Metadata Platform**

## 1. Vision & Rationale
The Atom Engine is evolving from a **Git-specific utility** into a **Universal Metadata Container**. To achieve this, we must remove all physical "Git-isms" from the core domain model and re-model them as first-class Protocols.

### Objectives
*   **Total Agnosticism**: The `Atom` object must become a "Black Box" container that knows nothing about the underlying storage system.
*   **Symmetric Querying**: Search, filtering, and formatting must treat system metadata (Author, Date) and domain metadata (Lore-id) with identical logical "Dignity."
*   **Discovery Sovereignty**: Enable the engine to discover and intermix "Non-Atoms" (standard commits) by treating the storage layer as an "Origin Protocol."

---

## 2. The Atomic Container (Physical Layer)
The `Atom` object is stripped of all hard-coded fields. It serves solely as a **Logical Join Point** for one or more protocols.

```typescript
/**
 * The Universal Container.
 * 100% blind to storage implementation and domain logic.
 */
interface Atom {
  /** 
   * The protocols associated with this record.
   * Key Format: "[namespace]:[name]" (e.g., "system:git", "lore:core")
   */
  readonly protocols: ProtocolMap<ProtocolState>;
}
```

---

## 3. The Origin Protocol (Semantic Layer)
We introduce a specialized contract for protocols that represent the "Physical Record" itself.

### The `IOriginProtocol` Interface
Origin protocols (like `git`) must implement this contract to provide the "Headers" required by the UI and the Registry.

```typescript
interface IOriginProtocol extends IProtocol {
  /** Returns the physical address (e.g. Git Hash, SQL UUID) */
  getPhysicalAddress(state: ProtocolState): string;

  /** Returns the authoritative timestamp of the event */
  getOriginDate(state: ProtocolState): Date;

  /** Returns the identifier of the actor (Author/System) */
  getOriginAuthor(state: ProtocolState): string;
}
```

---

## 4. The System Namespace (`system:git`)
The storage layer is formalized as a **Virtual Protocol** in the reserved `system` namespace.

*   **Namespace**: `system`
*   **Identity**: `git`
*   **Permissive**: `true` (Captures "orphan" trailers as physical metadata)
*   **Discovery Rule**: **Always Claim**. The `system:git` protocol claims 100% of records passed to it.

### Data Mapping (Virtual Projection)
During hydration (via the `hydration.ts` logic module), the raw Git metadata is projected into the `system:git` trailers:
*   `system:Author` <- `raw.author`
*   `system:Date` <- `raw.date`
*   `system:Subject` <- `raw.subject`
*   `system:Body` <- `raw.body`
*   `system:Radius` <- `raw.filesChanged`

---

## 5. Implementation Pattern: Smart Views
To prevent "Attic Crawling" (e.g. `atom.protocols.get('system:git').trailers.Author[0]`), we use **Protocol Views**. This provides typed ergonomics without polluting the `Atom` container.

```typescript
class GitView {
  constructor(private readonly state: ProtocolState) {}

  get author(): string { return this.state.trailers.Author[0]; }
  get date(): Date { return new Date(this.state.trailers.Date[0]); }
  
  static from(atom: Atom): GitView {
    return new GitView(atom.protocols.get('system:git')!);
  }
}

// Usage:
const author = GitView.from(atom).author;
```

---

## 6. Universal Query Language (UQL)
By treating Git metadata as trailers, our Phase 4 Search Engine becomes a **Uniform Logic Processor**.

### The Query AST
The AST no longer needs to branch between "Fields" and "Trailers." Every query targets a `key`.

| Query String | Target Layer | Logic |
| :--- | :--- | :--- |
| `author=~cole` | `system:git` | Search the `Author` trailer in the system protocol. |
| `lore:id=abc*` | `lore:core` | Search the `Lore-id` trailer in the lore protocol. |
| `Radius=~main.ts` | `system:git` | Search the `Radius` (files changed) trailer. |

### The "Discovery Valve"
*   **Default Mode**: Engine only returns atoms with **>= 1 User Protocol** (e.g. Lore). This maintains the existing "Signal-only" behavior.
*   **Permissive Mode (`--all`)**: Engine returns atoms with **>= 1 System Protocol**. Since every commit has a `system:git` protocol, this returns the entire history.

---

## 7. Strategic Impact
1.  **Enterprise Readiness**: The engine can now intermix atoms and non-atoms, providing a "Seamless Overlay" for existing large-scale repositories (like the Linux Kernel).
2.  **Logical Integrity**: The "Commit Hash" is no longer special magic; it is just the `Identity` of the `system:git` protocol.
3.  **Refactoring Freedom**: We can swap Git for any other storage system by simply swapping the `IOriginProtocol` implementation. The container, search, and UI remain unchanged.

---

## 8. Physical Optimization (Storage Mappings)
To maintain native performance for core Git fields (Author, Date), every protocol has the authority to define storage-level mappings.

*   **Logic**: The engine converts logical query keys back into physical storage flags.
*   **Mapping Example**: `author` -> `--author`, `since` -> `--since`.
*   **Result**: 100% native C-level performance with 100% generic query syntax.

## 9. The Recursive Pipe Planner (Boolean Sovereignty)
To handle complex boolean logic (e.g. `(A OR B) AND (C OR D) AND NOT E`), the engine uses a **Recursive Stream Pipeline**.

### The Execution Model
The planner converts the query AST into a chain of piped Git processes using Node.js `spawn` and `stdout.pipe(stdin)`.

1.  **Stage 1 (Discovery)**: Uses standard `git log` to find the initial candidate set (the first "Positive" group).
2.  **Stage 2..N (Refinement)**: Uses `git log --stdin --no-walk` to apply subsequent `AND` and `NOT` intersections.
3.  **Final Stage (Hydration)**: Uses `git show --stdin` with the combined metadata/impact-radius format to retrieve the final records.

### Technical Constraints
*   **Memory Safety**: O(1) memory complexity. Data flows through kernel pipes; Node.js never buffers the list of hashes.
*   **Portability**: Relies solely on Git's internal flags (`--stdin`, `--no-walk`), ensuring compatibility across Windows, macOS, and Linux.
*   **Limits**: The user's `--limit` flag is applied only to the **final stage** of the pipe to ensure deterministic results and stop the scan as early as possible.

## 10. Global Aliases (Ergonomics)
To maintain search ergonomics while using namespaces, the `ProtocolRegistry` supports a **Global Alias Map**.

*   **Mechanism**: Protocols can nominate specific keys for the global namespace during registration.
*   **System Aliases**: The `system:git` protocol automatically registers `author`, `date`, `subject`, and `body`.
*   **Resolution**: `atom search "author=~cole"` is automatically expanded to `atom search "system:git/Author=~cole"`.

## 11. Semantic Ranking (Advanced Operators)
Advanced comparison operators (`gt`, `lt`, `ge`, `le`) utilize **Protocol-Defined Ranking** to compare non-numeric values.

*   **Schema Enhancement**: `TrailerDefinition` includes an optional `rank: number` for enum values.
*   **Example**: `Confidence: { low: { rank: 1 }, high: { rank: 3 } }`.
*   **Logic**: `confidence > low` is resolved by comparing the ranks of the stored value and the query value.

## 12. Storage-Protocol Injection
To achieve total wiring agnosticism, the `OriginProtocol` is injected by the storage layer during bootstrap.

*   **Contract**: The `IGitClient` (and future storage clients) implements `getOriginProtocol(): IOriginProtocol`.
*   **Bootstrap Path**: `Bootstrapper` -> `GitClient.getOriginProtocol()` -> `Registry.register()`.
*   **Result**: The core engine remains 100% unaware of Git; it simply consumes the protocol provided by the physical driver.

## 13. Ownership Priority
The `system` namespace is the **Lowest Priority** during hydration.

*   **Rule**: Semantic protocols (e.g. Lore) have first pick of commit trailers.
*   **Catch-All**: The `system:git` protocol is `permissive = true` and captures any remaining "orphan" trailers as physical metadata.

---
**Status**: Ready for Implementation (Phase 4).
**Signed-off-by**: Gemini:CLI
