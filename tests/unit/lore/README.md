# Lore CLI Contract Maintenance

This directory contains the **Exhaustive Compatibility Contract** for the Lore CLI. The goal of this test is to ensure the decoupled engine architecture maintains 100% UI parity with any targeted Lore version (default: 0.5.0).

## Workflow: Updating the Contract

If you want to update the compatibility baseline (e.g., when Lore 0.6.0 is released), follow these steps:

### 1. Extract the Source of Truth
Run the state extractor against the desired version.

```bash
# Extract from a specific npm version
LORE_BIN="npx --yes lore@0.5.0" node scripts/extract-lore-state.cjs > NEW_STATE.json
```

### 2. Update the Contract Baseline
Open `tests/unit/lore/contract.test.ts` and replace the `LORE_050_STATE` constant with the contents of your `NEW_STATE.json`.

### 3. Identify Deviations
Run the test suite. It will likely fail with several "Description mismatch" or "Option missing" errors.

```bash
npm test tests/unit/lore/contract.test.ts
```

### 4. Apply Shims
Open `src/lore/cli-wrapper.ts`. Use the "REBRANDING WRAPPER" section to:
*   Override command descriptions using `cmd.description()`.
*   Override option descriptions by finding the option in `cmd.options` and mutating its `.description` property.
*   Hide additive features from the engine that aren't part of the Lore spec using `(opt as any).hidden = true`.

### 5. Verify
Repeat step 3 until the contract test passes. Your build is now "Bug-for-Bug" compatible with the new baseline.

---

## Why is this necessary?
The core `Decision Engine` is generic and agnostic. The `Lore CLI` is just a branding wrapper. This contract prevents engine-level improvements (like better phrasing or new flags) from accidentally changing the established Lore CLI user interface, which might break downstream scripts or documentation.
