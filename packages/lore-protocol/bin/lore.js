#!/usr/bin/env node
import { runLore } from '../dist/index.js';
runLore().catch(err => {
  console.error(err);
  process.exit(1);
});
