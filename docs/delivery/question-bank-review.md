# Question bank review

## Scope and audit

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

Original logic, lateral-thinking and probability puzzles cite this review document as their source and carry the complete proof in the question’s reveal explanation. The document URL becomes public when the change is merged.

## Known limits

The bank is manually authored and reviewed; it does not use live APIs. A few broad food-history facts cite established reference works where there is no single official agency source. Future content additions should use new IDs when changing released questions, keep numeric answers aligned with the stated rounding, and rerun the topic-count audit.
