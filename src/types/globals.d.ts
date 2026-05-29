/**
 * Build-time injected version constants from tsup.config.ts
 */
declare global {
  const __ATOM_VERSION__: string;
  const __LORE_VERSION__: string;
  const __ATOM_PURE_VERSION__: string;
  const __LORE_PURE_VERSION__: string;
  const __ATOM_PACKAGE_NAME__: string;
  const __LORE_PACKAGE_NAME__: string;
}

export {};
