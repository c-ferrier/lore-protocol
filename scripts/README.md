# Utility Scripts

This directory contains generic tools and scripts for managing the Lore repository and its history.

## `rewrite-trailers.js`

A programmatic Git Rebase and Message Rewrite utility. It safely automates the process of finding and replacing text (like broken Lore trailers) across a range of Git commits using an automated interactive rebase.

### Why does this exist?
If a bad Lore-id or malformed trailer makes it into your local history, fixing it manually via `git rebase -i` and manually editing every single commit message in `vim` is tedious and error-prone. This script acts as your `GIT_SEQUENCE_EDITOR` and automates the entire process.

### How it works:
1. It starts an interactive rebase (`git rebase -i`) from the commit you specify.
2. It overrides the default Git editor with itself.
3. For every `pick` command in the rebase plan, it injects an `exec` step.
4. During the `exec` step, it checks the commit message for the specified Regex.
5. If a match is found, it replaces the string and automatically runs `git commit --amend`.

### Usage

```bash
node scripts/rewrite-trailers.js <base_commit> <search_regex> <replace_string>
```

**Example: Fixing a bad `Related` trailer**
If you accidentally linked to a Git hash (`94f1f80`) instead of the true Lore-id (`4523a87e`), you can fix it across the last 10 commits like this:

```bash
node scripts/rewrite-trailers.js HEAD~10 "Related:\\s*94f1f80.*" "Related: 4523a87e"
```

**Note:** Since this rewrites Git history, it is completely safe for local/unpublished branches, but should be used with extreme caution on branches that have already been pushed and shared with others.
