# AGENTS.md

Instructions for any AI coding agent working in this repository. Read this before making changes.

## Commit & push policy — always use `super-commit`

**Never** run `git commit` or `git push` directly. Always use the `super-commit` CLI
(installed as both `super-commit` and the shorthand `sc`). It creates standardized
conventional commits.

### Only commit and push what you changed

**Only stage, commit, and push the specific files you actually modified in this
session.** Never use `--all` / `-a` — it would sweep up unrelated pre-existing
changes in the working tree. Always pass the exact files with `--files`.

### Commit changes

Non-interactive (preferred for agents):

```bash
sc commit --files "<path1>,<path2>" --yes --type <type> --subject "<subject>"
```

- `--files` / `-f` — comma-separated file paths (or numbers) to stage. List only
  the files you know you changed.
- `--yes` / `-y` skips the confirmation prompt (required for non-interactive runs)
- `--type` / `-t` is the conventional type: `feat`, `fix`, `docs`, `style`,
  `refactor`, `perf`, `test`, `chore`, `ci`, `revert`
- `--subject` / `-m` is the commit subject line
- Optional: `--scope`/`-s`, `--body`, `--footer`, `--breaking`

### Commit and push in one step

```bash
sc commit --files "<path1>,<path2>" --yes --type <type> --subject "<subject>" --push
```

`--push` pushes after committing. Since only your staged files are committed, only
your changes get pushed.

### Push only (no commit)

```bash
sc push --yes
```

### Useful flags

- `--dry-run` / `-n` — show what would happen without committing/pushing
- `--create-pr` — open a GitHub PR after pushing (requires `GITHUB_TOKEN`)

Run `sc commit --help` or `sc push --help` for the full option list.
