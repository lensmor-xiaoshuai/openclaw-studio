# Contributing

Thanks for helping improve OpenClaw Studio.

- For external bugs and feature requests: please use GitHub Issues.
- For repo work tracked by our on-host agent squad: we use **repo-scoped Beads** (`br`) (details below).

## Before you start
- Install OpenClaw and confirm the gateway runs locally.
- This repo is UI-only and reads config from `~/.openclaw` with legacy fallback to `~/.moltbot` or `~/.clawdbot`.
- It does not run or build the gateway from source.

## Local setup
```bash
git clone https://github.com/grp06/openclaw-studio.git
cd openclaw-studio
npm install
cp .env.example .env
npm run dev
```

## Testing
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run e2e` (requires `npx playwright install`)

## Task tracking (Beads)

We track implementation work in this repo using **Beads** (`br`). The backlog lives *with the artifact being changed*:

- Beads live under this repo’s `.beads/` folder (repo-scoped backlog).
- The SQLite DB is local-only; the portable/committed artifact is `.beads/issues.jsonl`.

Common commands (run from the repo root):

```bash
br init                      # one-time, if .beads/ doesn't exist yet
br create "Title" --type task --priority 1
br list --status open
br show <id>
br sync --flush-only         # export .beads/issues.jsonl before committing
```

## Pull requests
- Keep PRs focused and small.
- Prefer **one Bead → one PR**.
- Include the tests you ran.
- Link to the relevant issue/Bead.
- Before committing, run: `br sync --flush-only`.
- If you changed gateway behavior, call it out explicitly.

## Reporting issues
When filing an issue, please include:
- Reproduction steps
- OS and Node version
- Any relevant logs or screenshots

## Minimal PR template
```md
## Summary
- 

## Testing
- [ ] Not run (explain why)
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run e2e`

## AI-assisted
- [ ] AI-assisted (briefly describe what and include prompts/logs if helpful)
```

## Minimal issue template
```md
## Summary

## Steps to reproduce
1.

## Expected

## Actual

## Environment
- OS:
- Node:
- UI version/commit:
- Gateway running? (yes/no)

## Logs/screenshots
```
