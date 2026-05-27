/**
 * Lore CLI State Extractor
 * 
 * This script executes a Lore binary (system or via npx) and generates a 
 * JSON representation of its entire CLI interface (commands, options, and descriptions).
 * 
 * Usage:
 *   node scripts/extract-lore-state.js                      # Uses system 'lore'
 *   LORE_BIN="npx --yes lore@0.5.0" node scripts/extract-lore-state.js  # Uses specific version
 */

const { execSync } = require('child_process');
const { mkdirSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const loreBin = process.env.LORE_BIN || 'lore';
const neutralDir = join(tmpdir(), 'lore-state-extract-' + Date.now());

function getHelp(cmd = '') {
  try {
    return execSync(`${loreBin} ${cmd} --help`, { 
        encoding: 'utf-8', 
        cwd: neutralDir,
        env: { ...process.env, NO_COLOR: '1' } 
    });
  } catch (e) {
    console.error(`Failed to get help for '${cmd}': ${e.message}`);
    return '';
  }
}

function parseHelp(text) {
  const lines = text.split('\n');
  const result = { description: '', options: [], commands: [] };
  let section = '';
  let currentItem = null;

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed || line.startsWith('Usage:')) continue;

    // Detect sections
    if (line.match(/^Options:$/)) { section = 'options'; currentItem = null; continue; }
    if (line.match(/^Commands:$/)) { section = 'commands'; currentItem = null; continue; }

    if (!section) {
      result.description += (result.description ? ' ' : '') + trimmed;
      continue;
    }

    // New item (Options start with -, Commands start with a word)
    const itemMatch = line.match(/^  (-[a-zA-Z], )?--[a-zA-Z0-9-]+|^  [a-z0-9-]+/);
    if (itemMatch) {
      const parts = line.trim().split(/\s{2,}/);
      const name = parts[0];
      const desc = parts.slice(1).join(' ');
      if (section === 'options') {
        currentItem = { flags: name, description: desc };
        result.options.push(currentItem);
      } else {
        currentItem = { name: name.split(' ')[0], description: desc };
        result.commands.push(currentItem);
      }
    } else if (currentItem && line.match(/^\s{5,}/)) {
      // Continued description on next line (Commander wrap)
      currentItem.description += (currentItem.description ? ' ' : '') + trimmed;
    }
  }
  return result;
}

// 1. Create a clean environment
mkdirSync(neutralDir, { recursive: true });

try {
    console.error(`Extracting state using: ${loreBin}`);
    
    const mainHelp = parseHelp(getHelp());
    const report = {};

    for (const cmd of mainHelp.commands) {
      console.error(`  -> Processing command: ${cmd.name}`);
      const cmdHelp = parseHelp(getHelp(cmd.name));
      report[cmd.name] = {
        description: cmd.description,
        options: cmdHelp.options
      };
    }

    // Special case for global help description
    report['help'] = {
      description: mainHelp.description,
      options: mainHelp.options
    };

    process.stdout.write(JSON.stringify(report, null, 2));
} finally {
    rmSync(neutralDir, { recursive: true, force: true });
}
