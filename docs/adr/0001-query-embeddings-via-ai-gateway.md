# Query embeddings via Vercel AI Gateway

Semantic search needs each query embedded at request time; corpus vectors are precomputed offline when the archive is uploaded. We chose Vercel AI Gateway (authenticated by the deployment's OIDC token, so no API key to manage) over a local model inside the Vercel function, because it keeps cold starts and bundle size small and costs fractions of a cent. The trade-off is that text leaves Vercel in two places. At upload time, the chunked guide and transcript text is sent once to build the corpus vectors. At request time, each semantic query's text is sent. The README's "no external search service" promise is reworded to say both things plainly, a short note sits near the search box, and exact search remains entirely within Vercel.

## Consequences

- If the gateway is unavailable, search degrades to exact-only with a visible notice rather than failing.
- Analytics still never record query text; the gateway call is not an analytics channel.
- Changing the embedding model requires re-embedding the corpus; the model ID and dimensions are recorded alongside the vectors, and query embeddings must use the same model and dimensions.
