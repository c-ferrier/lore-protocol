#!/usr/bin/env node

/**
 * TEST PARITY GUARD
 * 
 * Usage: node scripts/audit-tests.js <target_ref> <file_or_dir>
 * Example: node scripts/audit-tests.js HEAD tests/engine
 * 
 * Extracts 'describe' and 'it' blocks from the baseline (git) and the 
 * current workspace, then diffs them to identify lost test coverage.
 */

import { execSync } from 'child_process';
import { readFileSync, lstatSync, readdirSync } from 'fs';
import { join, relative } from 'path';

const [,, baseline, inputPath] = process.argv;

if (!baseline || !inputPath) {
  console.error('Usage: node audit-tests.js <baseline_ref> <file_or_dir>');
  process.exit(1);
}

function getFiles(dir) {
  const stats = lstatSync(dir);
  if (stats.isFile()) return [dir];
  
  const files = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getFiles(fullPath));
    } else if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractTestMap(content) {
  const lines = content.split('\n');
  const map = [];
  let indent = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Track indentation to preserve hierarchy in output
    const match = line.match(/^(\s*)/);
    const currentIndent = match ? match[1].length : 0;

    if (trimmed.startsWith('describe(') || trimmed.startsWith('it(')) {
      // Clean up the string to just the description
      const labelMatch = trimmed.match(/^(?:describe|it)\(['"](.+?)['"]/);
      if (labelMatch) {
        const type = trimmed.startsWith('describe') ? 'DESC' : 'TEST';
        map.push(`${'  '.repeat(currentIndent / 2)}${type}: ${labelMatch[1]}`);
      }
    }
  }
  return map;
}

function getBaselineContent(ref, path) {
  try {
    return execSync(`git show ${ref}:${path}`, { stdio: 'pipe', encoding: 'utf-8' });
  } catch {
    return null; // File might not have existed in baseline
  }
}

const files = getFiles(inputPath);
let hasGaps = false;

console.log(`\n🔍 AUDIT: Comparing [${inputPath}] against baseline [${baseline}]\n`);

for (const file of files) {
  const relPath = relative(process.cwd(), file);
  const currentContent = readFileSync(file, 'utf-8');
  const baselineContent = getBaselineContent(baseline, relPath);

  if (baselineContent === null) {
    console.log(`🆕 NEW FILE: ${relPath}`);
    continue;
  }

  const currentMap = extractTestMap(currentContent);
  const baselineMap = extractTestMap(baselineContent);

  const lost = baselineMap.filter(item => !currentMap.includes(item));
  const added = currentMap.filter(item => !baselineMap.includes(item));

  if (lost.length > 0 || added.length > 0) {
    console.log(`📄 FILE: ${relPath}`);
    
    if (lost.length > 0) {
      hasGaps = true;
      console.log('  ❌ LOST TESTS:');
      lost.forEach(l => console.log(`     - ${l.trim()}`));
    }
    
    if (added.length > 0) {
      console.log('  ✅ ADDED TESTS:');
      added.forEach(a => console.log(`     + ${a.trim()}`));
    }
    console.log('');
  }
}

if (!hasGaps) {
  console.log('✅ PASS: No existing test scenarios were removed.');
} else {
  console.log('⚠️  WARN: Potential coverage gaps detected.');
  process.exit(1);
}
