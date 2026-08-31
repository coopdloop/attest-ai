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

## Versioning — commit messages drive automated releases

This repo uses **release-please** for a single, app-wide version (config in
`release-please-config.json`, current version in `version.txt` and
`.release-please-manifest.json`). Do **not** hand-edit the version, tag, or
`CHANGELOG.md` — release-please owns all three. On every push to `main` it opens
or updates a single **"chore(main): release x.y.z"** pull request that
accumulates pending changes; a human merges that PR to cut the release (tag +
GitHub Release + changelog). Releasing is gated on that merge, so nothing is
published automatically.

Because the next version is computed from commit **types**, the `--type` you pass
to `super-commit` directly determines the bump. The project is pre-1.0 (`0.x`),
so:

| Commit type | Example | Version effect (0.x) | Changelog |
| --- | --- | --- | --- |
| `fix` | `sc commit -t fix -m "..."` | patch (`0.1.0` → `0.1.1`) | Bug Fixes |
| `feat` | `sc commit -t feat -m "..."` | minor (`0.1.0` → `0.2.0`) | Features |
| breaking | add `--breaking` (or `!` / `BREAKING CHANGE:`) | minor while `0.x` (never jumps to `1.0`) | highlighted |
| `perf` / `refactor` / `revert` | — | patch | shown |
| `docs` / `test` / `build` | — | no release on its own | hidden |
| `ci` / `chore` / `style` | — | no release on its own | hidden |

Guidance for agents:

- Pick the `--type` that reflects **user-visible impact**, not just the kind of
  file touched. New capability → `feat`; behavior/bug correction → `fix`;
  internal-only tidy with no functional change → `chore`/`refactor`.
- Use `--breaking` (or a `BREAKING CHANGE:` footer via `--footer`) whenever a
  change alters an API contract, request/response shape, DB schema in a
  non-additive way, env vars, or deploy topology — even pre-1.0, so it is flagged
  in the release notes.
- Keep subjects imperative and specific; they become changelog lines verbatim.
- A pure `docs`/`chore`/`ci` push will **not** create or advance a release PR;
  that is expected, not a failure.
- Never merge the release PR as part of routine work — leave that human-gated
  unless explicitly asked to cut a release.
