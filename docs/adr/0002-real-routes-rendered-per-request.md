# Real routes, server-rendered per request

The reader moves from one client component at `/` (with state in `?entry=`/`?passage=`/`?document=` and in history state) to real routes: `/sessions`, `/sessions/[id]` with `#pN` passage anchors, `/search?…`, `/research/[doc]`, and `/about`. We render these per request from the private archive blob instead of prerendering them, so archive text still never lands in build output, public assets, or source maps. This gives every page a stable, citable, shareable URL and a real title. Legacy query-string links stay supported permanently through redirects, because family members already have them.

## Considered options

- Keep the single-page app and only move search state into the URL: lower effort, but titles, citations, and back-button behaviour stay muddy.
- Static prerendering: faster, but it breaks the rule that no archive text is ever in build output.
