# The Seth Tapes

An unlisted reader for the Peters/Wilson childhood-language archive (Seth's recordings, preserved from CHILDES/TalkBank). It serves family and researchers alike: scholarly in structure, warm in tone.

## Readers

**Serious reader**:
The design target: anyone (family member or researcher) who wants to understand, cite, or revisit specific moments in the archive with confidence about where each word came from.
_Avoid_: User, visitor, end user

## Archive content

**Transcript origin**:
Who produced a transcript's speech text: *archived research* (the original study transcripts), *TalkBank AI draft* (machine drafts supplied by TalkBank), or *local AI draft* (machine drafts generated for this collection).
_Avoid_: Source type, transcript kind

**Session**:
The citable unit of the collection: one transcript source together with its guide and all associated recordings. Uniqueness as a real-world recording event is not verified.
_Avoid_: Entry, recording (for the bundle), episode

**Recording**:
A single audio file belonging to a session; a session may have several (e.g., an archive MP3 and a WAV, or a listening copy).
_Avoid_: Track, file (in UI copy)

**Guide**:
The AI-written, transcript-based companion to one session: overview, topics, and moments. Never evidence of what was said.
_Avoid_: Summary page, AI summary (in UI copy)

**Moment**:
A guide's curated, interpretive highlight within a session, with a title, description, and approximate time span.
_Avoid_: Passage, landmark, "passages to revisit"

**Passage**:
One numbered unit of a transcript (typically an utterance); the citable atom, referred to as "session, passage N".
_Avoid_: Segment, line, moment

## Age

**Source age**:
The child's age as recorded in a transcript's own CHAT metadata (years;months.days).
_Avoid_: Real age, verified age

**Inferred age**:
An age read from a session's filename (which follows the same years-months-days pattern), always shown as inferred and never as a source age.
_Avoid_: Estimated age, approximate age

**Age band**:
A fixed six-month span of the child's age (e.g., 2;0–2;5) used to browse the collection longitudinally.
_Avoid_: Period, era, stage

## Search

**Exact search**:
Retrieval by the words, spellings, and notation actually present in guides and transcripts; the mode linguists rely on.
_Avoid_: Keyword search, full-text search

**Semantic search**:
Retrieval by meaning, so a conceptual query can find guide prose and passages that use different words.
_Avoid_: AI search, vector search (in UI copy)

**Hybrid search**:
The default search experience: exact and semantic results merged into one ranked list, with each result showing why it matched.
_Avoid_: Smart search

**Match label**:
The stated reason a search hit appears: *Exact match* (the words occur) or *Related in meaning* (semantic only). A related-in-meaning hit is never evidence that words were said.
_Avoid_: Score, relevance badge

**Concordance**:
An evidence view listing every passage that exactly matches a query, one keyword-in-context line per passage, ordered by age. Contains exact matches only.
_Avoid_: KWIC (in UI copy), passage list
