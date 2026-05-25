#!/usr/bin/env node
import { runLore } from '../dist/lore/cli-wrapper.js';
runLore().catch(err => {
  console.error(err);
  process.exit(1);
});
