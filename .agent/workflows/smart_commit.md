---
description: Enhanced commit workflow that automatically runs Prettier on staged files before committing.
---

When committing changes, **always** follow this workflow to ensure code formatting consistency without modifying unrelated files.

# 1. Identify Staged Files

# 1. Identify Staged Files

List the files that are about to be committed. To strictly follow the rule "Format Added Files Only", use:

```bash
git diff --name-status --cached | grep "^A"
```

# 2. Format Staged Files

Run Prettier **only** on the staged files (excluding deleted files):

```bash
## Example command (adjust file list based on step 1 output)
# To get only NEWLY added files:
# git diff --name-status --cached | grep "^A" | cut -f2 | xargs npx prettier --write
```

_Note: Do not run `prettier .` or formatting on the entire repo._

# 3. Check for Changes

Verify if Prettier modified any files. If so, stage them again:

```bash
git add path/to/file1.js path/to/file2.jsx
```

# 4. Commit using Conventional Commits

Commit the changes using a descriptive conventional commit message:

```bash
git commit -m "type(scope): description"
```

- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`
- **Scope:** optional, e.g., `(rig-control)`, `(ui)`, `(deps)`

# 5. Push (Optional)

If requested, push the changes to the remote branch:

```bash
git push origin <branch-name>
```
