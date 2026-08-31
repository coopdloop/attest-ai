# AGENTS.md

Instructions for any AI coding agent working in this repository. Read this before making changes.

## Commit & push policy — always use `super-commit`

**Never** run `git commit` or `git push` directly. Always use the `super-commit` CLI
(installed as both `super-commit` and the shorthand `sc`). It creates standardized
conventional commits.

### Commit changes

Non-interactive (preferred for agents):

```bash
sc commit --all --yes --type <type> --subject "<subject>"
```

- `--all` / `-a` stages all changes without prompting
- `--yes` / `-y` skips the confirmation prompt (required for non-interactive runs)
- `--type` / `-t` is the conventional type: `feat`, `fix`, `docs`, `style`,
  `refactor`, `perf`, `test`, `chore`, `ci`, `revert`
- `--subject` / `-m` is the commit subject line
- Optional: `--scope`/`-s`, `--body`, `--footer`, `--breaking`, `--files`/`-f`

### Commit and push in one step

```bash
sc commit --all --yes --type <type> --subject "<subject>" --push
```

### Push only (no commit)

```bash
sc push --yes
```

### Useful flags

- `--dry-run` / `-n` — show what would happen without committing/pushing
- `--create-pr` — open a GitHub PR after pushing (requires `GITHUB_TOKEN`)

Run `sc commit --help` or `sc push --help` for the full option list.
