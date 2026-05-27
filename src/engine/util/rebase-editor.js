#!/usr/bin/env node

/**
 * Programmatic Git Rebase Sequence Editor.
 * 
 * This script is intended to be used as the GIT_SEQUENCE_EDITOR during an interactive rebase.
 * It reads the rebase plan (TODO list) provided by Git, modifies the actions (e.g., changing 'pick' to 'edit')
 * for specific commits based on environment variables, and writes the plan back.
 * 
 * Future Atom Feature: This could be integrated into a `lore rewrite` or `lore doctor --fix` command 
 * to autonomously repair broken history.
 * 
 * Usage:
 * TARGET_COMMITS="hash1,hash2" GIT_SEQUENCE_EDITOR="node ./src/engine/util/rebase-editor.js" git rebase -i <base_commit>
 */

import { readFileSync, writeFileSync } from 'node:fs';

// 1. Get the path to the rebase-todo file (passed by Git)
const todoFilePath = process.argv[2];
if (!todoFilePath) {
    console.error('Error: No rebase-todo file path provided by Git.');
    process.exit(1);
}

// 2. Get the target commits to edit from the environment
const targetCommitsEnv = process.env.TARGET_COMMITS;
if (!targetCommitsEnv) {
    console.log('No TARGET_COMMITS provided. Proceeding with default rebase plan.');
    process.exit(0);
}

const targetCommits = targetCommitsEnv.split(',').map(hash => hash.trim().toLowerCase());

try {
    // 3. Read the current rebase plan
    const plan = readFileSync(todoFilePath, 'utf-8');
    const lines = plan.split('\n');
    let modified = false;

    // 4. Modify the plan
    const newLines = lines.map(line => {
        // Ignore comments and empty lines
        if (line.startsWith('#') || line.trim() === '') {
            return line;
        }

        // Expected format: "pick <hash> <subject>"
        const parts = line.split(' ');
        if (parts.length >= 2) {
            const action = parts[0];
            const hash = parts[1].toLowerCase();

            // Check if this commit hash starts with any of our target hashes
            const isTarget = targetCommits.some(target => hash.startsWith(target));

            if (isTarget && action === 'pick') {
                modified = true;
                // Change the action to 'edit' (or 'e')
                return `edit ${parts.slice(1).join(' ')}`;
            }
        }
        return line;
    });

    // 5. Write the plan back
    if (modified) {
        writeFileSync(todoFilePath, newLines.join('\n'), 'utf-8');
        console.log(`Successfully marked ${targetCommits.length} commit(s) for editing.`);
    } else {
        console.log('Target commits not found in the rebase plan. No changes made.');
    }

    process.exit(0);
} catch (error) {
    console.error('Error modifying rebase plan:', error);
    process.exit(1);
}
