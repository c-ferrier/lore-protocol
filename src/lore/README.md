# Lore CLI (Engine 0.6.0+)

This version of the Lore CLI is powered by the decoupled Decision Atom Engine. It maintains 100% UI compatibility with Lore 0.5.0 while providing several advanced enhancements.

## 0.5.0 Compatibility
The core command set (`commit`, `log`, `search`, `validate`, etc.) remains identical in behavior and interface to the 0.5.0 release. Existing scripts and workflows will continue to function without modification.

---

## Enhanced Features (Additive)

The following features are available in this build but are hidden from the primary help text to maintain strict 0.5.0 parity.

### 1. Advanced Git Filtering
You can now use these flags on almost any query command (`log`, `search`, `context`, `why`, etc.):
*   `--follow`: Transitively follow Related/Supersedes/Depends-on links across the decision graph to see the full context of a decision.
*   `--author <email>`: Filter atoms created by a specific author.
*   `--until <ref>`: Set an upper bound (date or revision) for the commit scan.
*   `--no-cache`: Bypass the local atom cache to force a fresh scan of git history.

### 2. Machine-Readable Output
*   `--json`: Every command now supports a standardized JSON output format for automation and tooling integration.
*   `--format <type>`: Explicitly choose between `text` (default) and `json`.

### 3. Engine Management Commands
These commands are available for power users but hidden from the standard list:
*   `lore cache --clean`: Force-clear the local atom and query caches.
*   `lore config`: Inspect the merged engine configuration and all active protocol definitions (including third-party protocols).

### 4. Dynamic Custom Trailers
The `commit` command now supports ad-hoc trailers:
*   `--trailer <key=value>`: Add any trailer to the commit without defining it in a protocol file.

---

## Technical Architecture
This CLI is a "Branding Wrapper" around the **Agnostic Decision Engine**. The engine is protocol-independent and can support multiple decision protocols simultaneously within the same repository.
