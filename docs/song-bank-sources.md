# International song-bank sources

The decade banks retain their original 80 entries, order and track IDs. New entries are appended because array positions form persistent puzzle answer IDs.

## Metadata sources

- [MarionBml/deezer-dataset](https://github.com/MarionBml/deezer-dataset), `data/deezer-data_20250930.xlsx`: the saved-song and playlist sheets provide actual Deezer track links, titles, artists, albums and ISRCs. Only music catalog fields were used; account and listening-history fields were excluded. The repository declares Apache-2.0 licensing. This source supplies the additional 2010s and 2020s recordings and part of the 2000s bank.
- Existing artist banks supply original recordings from Taylor Swift's debut and *Fearless*, Adele's *19*, Imagine Dragons' 2009 debut EP, and 2007–2009 releases by SHINee, Girls' Generation and 2NE1.
- Deezer album pages and their individual track links supply additional 2000s recordings from [Hybrid Theory](https://www.deezer.com/en/album/81763), [Meteora](https://www.deezer.com/en/album/1346746), [The Eminem Show](https://www.deezer.com/en/album/103248), [Discovery](https://www.deezer.com/en/album/302127) and [Parachutes](https://www.deezer.com/en/album/301663). IDs were read from actual track links, never calculated from neighboring IDs.

## 1990s album sources

Catalog remaster editions below use the original recording release years shown in parentheses. Original album tracks were selected; live performances and later bonus recordings were excluded.

- [Nirvana — In Utero (1993)](https://www.deezer.com/us/album/6916355)
- [Red Hot Chili Peppers — Blood Sugar Sex Magik (1991)](https://www.deezer.com/us/album/86548)
- [Red Hot Chili Peppers — Californication (1999)](https://www.deezer.com/us/album/86511)
- [Red Hot Chili Peppers — One Hot Minute (1995)](https://www.deezer.com/us/album/86523)
- [Metallica — Metallica (1991)](https://www.deezer.com/us/album/256250622)
- [Metallica — Reload (1997)](https://www.deezer.com/us/album/212388)
- [Oasis — (What's the Story) Morning Glory? (1995)](https://www.deezer.com/us/album/153406392)
- [Oasis — Be Here Now (1997)](https://www.deezer.com/us/album/153399282)
- [Oasis — Definitely Maybe (1994)](https://www.deezer.com/us/album/153710432)
- [Pearl Jam — Ten (1991)](https://www.deezer.com/us/album/708674)
- [Pearl Jam — Vs. (1993)](https://www.deezer.com/us/album/939399)
- [Pearl Jam — Vitalogy (1994)](https://www.deezer.com/us/album/936834)
- [Pearl Jam — Yield (1998)](https://www.deezer.com/us/album/704077)
- [Nirvana — Nevermind (1991)](https://www.deezer.com/us/album/1252978)
- [Metallica — Load (1996)](https://www.deezer.com/us/album/770317201)
- [Alanis Morissette — Jagged Little Pill (1995)](https://www.deezer.com/en/album/11443410)
- [Alanis Morissette — Supposed Former Infatuation Junkie (1998)](https://www.deezer.com/en/album/91332)

## Decade selection

ISRC year fields were used to find candidate recordings and then reviewed against original album or single releases. ISRC allocation years and catalog reissue dates are not reliable release dates on their own. For example, *Gasolina*, *American Boy*, *Stupid Love*, *Boys Will Be Boys* and *All Night* were excluded from incorrectly suggested decades. Later catalog editions of original recordings remain in their original decade. Remixes, live versions, sped-up edits, tribute performers and duplicate title/artist combinations were excluded from new entries.

## Preview availability

The new IDs are sourced catalog identifiers. Current preview audio availability was not independently verified: this environment's HTTP proxy returned a destination denial for the Deezer API. The existing runtime preview lookup and availability checks continue to apply. Catalog rights and preview availability can change by territory and over time.
