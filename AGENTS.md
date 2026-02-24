# AGENTS.md

## Commit Message Format

Use the following commit format:

`<type>(<scope>): <subject>`

### Rules

- Write commit titles in English with concise imperative wording.
- Keep subject specific to the dominant change and avoid vague phrasing.
- Add 2-3 short body paragraphs that describe what changed and why.
- Prefer plain paragraphs in commit bodies instead of bullet lists.
- Common types: `feat`, `fix`, `refactor`, `chore`, `test`, `docs`.

### Example

`feat(cli): add reasoning-aware progress spinner and API flags`

Add `--show-reasoning` and `--base-url` CLI options and wire them through command execution.

Introduce a custom animated status spinner with ASCII frame animation and consistent status rendering.

Update commit and hook flows to react to streamed reasoning phases while preserving commit selection UX.

## Release Flow

When `package.json` version is updated and the change is pushed to remote, CI will automatically create the corresponding Git tag.

The npm publish pipeline is triggered by that Git tag, so version bumps in `package.json` are the source of truth for releases.
