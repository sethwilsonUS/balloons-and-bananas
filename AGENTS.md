<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project Engineering Guardrails

- **Glossary & invariants:** Read `CONTEXT.md` (canonical domain terms: *Session*, *Recording*, *Guide*, *Moment*, *Passage*, *Source age*, *Inferred age*, *Age band*, *Exact/Semantic/Hybrid search*, *Match label*, *Concordance*) and `README.md` (privacy headers, private Blob storage, analytics allowlist, BotID fail-open) before editing. Never commit archive text, secrets, or local privacy config files.
- **State machines, refs, and async callbacks:** Keep one source of truth between loaded runtime state and static metadata; scope cached runtime state by entity ID; unify initial prop/URL targets with user selections instead of `initialProp ?? localState`; never overload a default fallback value as an "unset" sentinel; cancel queued `requestAnimationFrame`/timers/fetches on superseding input and unmount; guard timer/event callbacks with synchronous DOM/ref state and ignore stale completions.
- **URLs and redirects:** Preserve validated query parameters and fragments across canonical and legacy redirects; validate target paths before redirecting and verify explicit-param > referrer > default precedence.
- **Boundary validation and I/O:** Validate every required field and shape at runtime before narrowing parsed JSON, storage payloads, or API responses (no naked `as T` casts). Loop low-level `FileHandle.read()` calls until all requested bytes or EOF.
- **Markdown and CSS:** Transform Markdown on the parsed AST (never line regexes), normalize heading outline gaps including downstream generated headings (e.g. GFM footnotes), and preserve semantic child nodes (`footnoteReference`) when deduplicating titles. Never comma-group browser vendor pseudo-elements (`::-webkit-*`, `::-moz-*`) in one CSS rule.
- **Guard scripts and tests:** Scan `.next/server/app/<route>/` subtrees recursively in `scripts/check-build-output.mjs` and derive reported booleans from actual scan results. Playwright tests must assert the observable outcome claimed in the test title and `expect.poll` for route-handler receipt before cancelling intercepted requests.
