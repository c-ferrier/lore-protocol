#!/usr/bin/env node

/**
 * Programmatic Git Rebase & Message Rewrite Utility
 * 
 * Automates the process of finding and replacing text (like broken Lore trailers)
 * across a range of Git commits using an automated interactive rebase.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mode = process.env.REWRITE_MODE;

if (mode === 'sequence') {
    // ---------------------------------------------------------
    // Phase 2: Act as GIT_SEQUENCE_EDITOR
    // ---------------------------------------------------------
    const todoFilePath = process.argv[2];
    const content = readFileSync(todoFilePath, 'utf8');
    const lines = content.split('\n');
    
    const newLines = [];
    const scriptPath = fileURLToPath(import.meta.url);

    for (const line of lines) {
        newLines.push(line);
        // After every standard commit action, inject an 'exec' command to rewrite the message
        if (/^(pick|p|edit|e|reword|r)\s/.test(line)) {
            newLines.push(`exec REWRITE_MODE=exec node ${scriptPath}`);
        }
    }
    
    writeFileSync(todoFilePath, newLines.join('\n'));
    process.exit(0);

} else if (mode === 'exec') {
    // ---------------------------------------------------------
    // Phase 3: Act as the 'exec' command during the rebase
    // ---------------------------------------------------------
    const searchRegex = process.env.REWRITE_SEARCH;
    const replaceStr = process.env.REWRITE_REPLACE;
    
    if (!searchRegex || replaceStr === undefined) {
        console.error('Error: Missing REWRITE_SEARCH or REWRITE_REPLACE environment variables.');
        process.exit(1);
    }

    try {
        const msg = execSync('git log -1 --format=%B').toString();
        const newMsg = msg.replace(new RegExp(searchRegex, 'g'), replaceStr);

        if (newMsg !== msg) {
            writeFileSync('.git/COMMIT_EDITMSG', newMsg);
            execSync('git commit --amend -F .git/COMMIT_EDITMSG');
            const hash = execSync('git rev-parse --short HEAD').toString().trim();
            console.log(`\n[rewrite-trailers] \x1b[32mSuccessfully updated message for commit ${hash}\x1b[0m\n`);
        }
    } catch (err) {
        console.error('Failed to amend commit:', err.message);
        process.exit(1);
    }
    process.exit(0);

} else {
    // ---------------------------------------------------------
    // Phase 1: CLI Entry Point (Setup and Spawn Rebase)
    // ---------------------------------------------------------
    const baseCommit = process.argv[2];
    const searchRegex = process.argv[3];
    const replaceStr = process.argv[4];

    if (!baseCommit || !searchRegex || replaceStr === undefined) {
        console.error('\x1b[31mError: Missing required arguments.\x1b[0m\n');
        console.error('Usage:   node rewrite-trailers.js <base_commit> <search_regex> <replace_string>');
        console.error('Example: node rewrite-trailers.js HEAD~5 "Related:\\s*badhash.*" "Related: goodhash"');
        process.exit(1);
    }

    const scriptPath = fileURLToPath(import.meta.url);

    console.log(`\nStarting automated rebase from \x1b[36m${baseCommit}\x1b[0m...`);
    console.log(`Search:  \x1b[33m/${searchRegex}/g\x1b[0m`);
    console.log(`Replace: \x1b[32m'${replaceStr}'\x1b[0m\n`);
    
    const env = {
        ...process.env,
        GIT_SEQUENCE_EDITOR: `node ${scriptPath}`,
        REWRITE_MODE: 'sequence',
        REWRITE_SEARCH: searchRegex,
        REWRITE_REPLACE: replaceStr
    };

    const result = spawnSync('git', ['rebase', '-i', baseCommit], { stdio: 'inherit', env });
    
    if (result.status === 0) {
        console.log('\n\x1b[32mRebase completed successfully.\x1b[0m\n');
    } else {
        console.error('\n\x1b[31mRebase failed or was aborted.\x1b[0m\n');
    }
}
