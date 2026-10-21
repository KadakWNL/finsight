# Repository instructions

- Make changes on a feature branch and open a pull request for review. Never push directly to `main` or another protected branch; do not merge without explicit user authorization.
- Respect issue dependencies and review gates. Proposed contracts remain unapproved until the required teammates explicitly approve them.
- Use the technical-writing skill for repository technical documents when available.
- Do not commit the local course requirements PDF without redistribution approval.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
