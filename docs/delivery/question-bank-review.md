# Question bank review

## Expanded bank (2026-10-12)

The current scheduled bank has 5,400 playable questions: 300 in each of 18 topics. Archived versions remain in the database for stored rounds. Harry Potter covers the seven original books and includes spoilers; History, Sports and Video Games are also newly selectable. The original question content and IDs remain stored; selected superseded rows are now inactive. Each supplement uses new deterministic UUIDs and `ON CONFLICT (id) DO NOTHING`. NBA adds 300 questions about players, teams, history, awards and rules, with specific seasons named for dated achievements. Its sources and verification limits are recorded in [the NBA source audit](../nba-bank-sources.md). Migration 014 adds NBA while preserving saved selections. Migration 013 accepts the earlier new topics and updates new-game defaults without changing existing saved selections.

The database test validates counts per topic, unique prompts and IDs, answer types, distinct choices, keyed answers, nonempty explanations and attribution, 60/180-second windows, and idempotent reseeding. These structural checks do not establish that every factual answer or reference URL has been independently verified.

Geography draws on country capital/continent datasets and Thai province/district data; science combines periodic-table data with broader scientific concepts. Food covers culinary traditions and preparation; nature and weird topics cover animal, botanical and scientific facts. History, sports and games cover named events, competitors and titles. Mathematical questions include worked solutions; an independent review recomputed all 275 new probability answers and 275 estimate answers. Related mathematical families use varied constraints and parameters.

The story-trivia refresh supersedes 418 questions: 229 Breaking Bad, 114 Marvel and 75 Harry Potter. Director, writer, cast, release-year and episode-placement questions are retired in favor of character decisions, relationships, plot events, powers, objects and memorable scenes. Harry Potter also corrects book/film confusion, faulty wording, repeated facts and obscure lookup clusters. It retains the seven-book scope and explicitly labels replacement questions where film events differ. Marvel follows MCU film continuity.

The original wording, choices, answer keys, explanations and IDs are preserved; retirement changes only `is_active`. Replacements use new deterministic IDs beginning `52000000-`. The production seed transaction retires old questions and inserts replacements together. Existing rounds can still show and grade historical questions; future rounds choose active questions. There are 5,818 stored rows, of which 5,400 are playable. Reseeding preserves both versions and stored edits.

Content review covered all intended questions in these three categories, including semantic overlap, plausible choices and scope. Sources identify specific Breaking Bad episode plots, MCU film plots and original Harry Potter books/chapters. Uncertain scenes and canon distinctions were checked with targeted reference searches; not every answer or source URL was independently verified. Structural tests verify active topic counts, valid keys and idempotence. A refresh regression test also verifies unchanged historical content, unaffected topics, no production-trivia prompts, and grading an already-open retired question before starting an active story question.

The earlier Breaking Bad supplement used season, director and writing-credit data from TVmaze and Wikipedia. Those production questions remain stored as inactive historical records. Use the [story trivia guidelines](../story-trivia-guidelines.md) for future additions.

Sources identify the relevant reference subject or original work. Individual Wikipedia, Britannica and other reference pages were not all fetched or independently audited during this expansion. The historical source-review claims below apply to the original release only. Song metadata provenance and preview-access limits are recorded in [song-bank-sources.md](../song-bank-sources.md).

## Original 325-question release audit

This first selectable release contains 325 questions: the 24 previously released astronomy questions, one additional Science & Space question, and 25 questions in each of the other 12 topics. The released 24 rows remain unchanged in `apps/api/seeds/questions.sql`; the new insert follows them and uses new UUIDs. Both inserts use `ON CONFLICT (id) DO NOTHING`, so reseeding does not replace a played or edited row.

The PGlite audit in `apps/api/test/database/round-storage.test.ts` loads all ordered migrations and runs the seed twice. It checks the exact total, 25 rows per topic, 60-second ordinary / 180-second puzzle windows, answer type and choice shape, nonempty attribution, unique prompts, and preservation of existing rows during reload. The focused suite passed 7 tests.

## Topic batches

| Topic | Count | Review basis and sources |
|---|---:|---|
| Around the World | 25 | Geographic locations and landmarks checked against UNESCO World Heritage pages, official country sources, NOAA, NPS and other cited references. Each question stores its own title and URL. |
| Thailand | 25 | TAT destination pages and UNESCO entries cover cities, landscapes and heritage sites; festival questions use TAT / UNESCO references. The TAT links for Krabi and Bueng Kan were checked after correcting their localized paths. |
| Food & Drinks | 25 | Ingredient and production facts checked against Kew, FAO, USDA, JETRO, EU GI records and the cited culinary references. Prompts ask about ingredients or established food traditions rather than contested claims of a single origin. |
| Weird but True | 25 | Stable biology and astronomy facts checked against NASA, Smithsonian, NOAA, Australian Museum, peer-reviewed research and the other cited references. The wombat item is limited to the museum-supported cube-shaped droppings fact. |
| Animals & Nature | 25 | Species, habitats and basic ecology checked against NOAA, Smithsonian, USDA Forest Service, USGS, NPS, Audubon and the other cited references. |
| Science & Space | 25 | The 24 released NASA astronomy rows are unchanged; the new Earth-life question is sourced to NASA Earth facts. |
| Taylor Swift | 25 | Album, song-to-album and career facts checked against Taylor Swift’s official archive/store and the Recording Academy’s artist and award pages. Prompts use titles only and include no lyric excerpts. |
| Breaking Bad | 25 | Full-series facts and spoilers checked against AMC series summaries, cast interviews and AMC episode/character recaps. Prompts are newly written and do not quote dialogue. |
| Marvel | 25 | MCU film and character facts checked against Marvel Studios film pages and Marvel’s official character/movie material. The scope is the MCU films, not general comic continuity. |
| Logic & Clever Strategies | 25 | Original binary/bottle, hats/parity, deduction, weighing and coordination problems. Every prompt gives the needed rules; each explanation includes the inference, strategy or calculation used to establish the answer. |
| Lateral Thinking | 25 | Original, self-contained scenarios with answerable choices. Assumptions are in the prompt; explanations state why the selected result follows. |
| Probability Puzzles | 25 | Original questions specify fair outcomes, replacement rules, sample spaces or tournament assumptions. Explanations show the count, product, complement or conditional calculation. |
| Closest Estimate | 25 | Stable physical quantities and conventional rounded reference values from NASA, NIST, USGS, NPS, the Eiffel Tower’s official site, FIDE and the UN. Units and rounding precision are stated in every prompt. |

The factual rows retain a specific source title and URL in the seed. Source URLs are reused when several questions rely on the same official topic page. I spot-checked representative links with the browser research tool, including NASA, TAT, UNESCO, Marvel, AMC, Grammy, Australian Museum, NOAA and the Eiffel Tower. Tool errors are not treated as proof that an external site is down; a few sources block automated opening. The updated application test checks URL syntax and source presence but does not perform network requests during CI.

## Corrective content audit

A post-review audit corrected the following individual items while retaining their IDs and topic counts:

| IDs | Correction |
|---|---|
| New multiple-choice bank | Rotated stored option order so the keyed answer is evenly distributed among the four positions; the PGlite bank test now asserts the position counts differ by at most one. The original 24 released rows were left unchanged. |
| 303 | Prompt now requests degrees Celsius (not thousands of degrees); the 5,500°C value rounds to the stored 6,000°C key. |
| 198, 201 | Corrected the Peter Quill parentage question and cited Marvel’s Ego profile; rewrote the Endgame prompt to ask who inspired the time-travel plan, matching Scott Lang and Marvel’s official recap. |
| 244, 250, 258 | Specified the frozen-surface constraint; made the postage-stamp prompt describe a letter and envelope; changed the age puzzle to “the day before yesterday” and worked through the dates explicitly. |
| 221, 232 | Specified infinite repeated visits, recognition, and one-time off-to-on signalling in the switch puzzle. Replaced the repeated wolf/goat/cabbage variant with a distinct eight-ball, two-weighing puzzle and proof. |
| 90 | Replaced the broad animal distractor question with one asking for the shark eye membrane by name, avoiding frog and crocodilian ambiguity; the cited Smithsonian page describes the membrane in some shark species. |
| 3, 25 | Kept released question 3 unchanged and replaced the duplicate Petra question 25 with Persepolis in Iran, verified on UNESCO’s site page. |
| 174, 178 | Replaced question 174’s repeated Hank family relationship with an actor-identification question; question 178 remains the brother-in-law fact. |
| 18, 175 | Replaced the generic Environment Agency homepage with Visit London’s Thames-through-central-London page. Rewrote 175 to ask for the episode title in the Gus/Victor event described by AMC, rather than the unrelated Jesse/El Camino recap or the duplicate Heisenberg alias question. |

Exact duplicate prompts are covered by the automated audit. Broader concept similarity is reviewed manually because automated semantic-duplicate checks would be brittle; the listed duplicate pairs were checked and resolved as above.

Original logic, lateral-thinking and probability puzzles cite this review document as their source and carry the complete proof in the question’s reveal explanation. The document URL becomes public when the change is merged.

## Known limits

The bank is manually authored and reviewed; it does not use live APIs. A few broad food-history facts cite established reference works where there is no single official agency source. Future content additions should use new IDs when changing released questions, keep numeric answers aligned with the stated rounding, and rerun the topic-count audit.
