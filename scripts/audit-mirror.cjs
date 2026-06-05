#!/usr/bin/env node

/**
 * MIRROR PARITY GUARD
 * 
 * Usage: node scripts/audit-mirror.js
 * 
 * Recursively compares src/engine and tests/engine to ensure 
 * 1:1 file mapping.
 */

const fs = require('node:fs');
const path = require('node:path');

const SRC_ROOT = path.resolve('src/engine');
const TEST_ROOT = path.resolve('tests/engine');

function getFiles(dir, extension = '.ts') {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getFiles(filePath, extension));
        } else {
            if (file.endsWith(extension) && !file.endsWith('.d.ts')) {
                results.push(filePath);
            }
        }
    }
    return results;
}

const srcFiles = getFiles(SRC_ROOT, '.ts').map(f => path.relative(SRC_ROOT, f));
const testFiles = getFiles(TEST_ROOT, '.test.ts').map(f => path.relative(TEST_ROOT, f).replace('.test.ts', '.ts'));

const srcSet = new Set(srcFiles);
const testSet = new Set(testFiles);

let hasGaps = false;

console.log('🔍 MIRROR AUDIT: Checking 1:1 mapping between [src/engine] and [tests/engine]\n');

// 1. Check for Missing Tests
console.log('--- MISSING TESTS (Src exists, Test missing) ---');
const missing = srcFiles.filter(f => !testSet.has(f)).sort();
if (missing.length === 0) {
    console.log('  ✅ None found.');
} else {
    hasGaps = true;
    missing.forEach(f => console.log(`  ❌ ${f} -> (missing tests/engine/${f.replace('.ts', '.test.ts')})`));
}

// 2. Check for Orphaned Tests
console.log('\n--- ORPHANED TESTS (Test exists, Src missing) ---');
const orphaned = Array.from(testSet).filter(f => !srcSet.has(f)).sort();
if (orphaned.length === 0) {
    console.log('  ✅ None found.');
} else {
    hasGaps = true;
    orphaned.forEach(f => console.log(`  ❌ tests/engine/${f.replace('.ts', '.test.ts')} -> (No matching src/engine/${f})`));
}

console.log('\n----------------------------------------');
if (!hasGaps) {
    console.log('✅ PASS: Perfect 1:1 structural mirror achieved.');
} else {
    console.log('⚠️  FAIL: Structural deviations detected.');
    process.exit(1);
}
