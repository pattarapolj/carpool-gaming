# NBA question-bank sources

The 225 questions in the `48000000` ID series were written in original wording for this app. Historic results are restricted to completed seasons through 2023-24. Rules questions use the official NBA rulebook and concern stable NBA-specific court, timing, scoring, substitution, violation, and foul provisions.

All 69 cited URLs were retrieved successfully (HTTP 200) on 2026-10-12. Retrieval confirms that the references exist; it is not a claim that every individual sentence was independently researched. Champions, regular-season MVPs, Finals MVPs, and first-overall draft picks were checked against the official NBA history tables. Representative rule edge cases and historical performance details were checked in the retrieved rule text and linked NBA moment articles. An independent content review corrected era-inappropriate distractors and a defensive-three-seconds rule citation.

The five non-first-overall draft questions link directly to the relevant official NBA Stats draft-year pages. Those pages load their draft tables dynamically; their static HTML does not expose all players/pick positions. Their familiar historical draft facts were checked during content review, but the dynamic table data was not independently fetched in this authoring pass.

The original initial fetches included several guessed NBA article routes that returned 404. None of those failed routes is cited in the delivered questions; final references came from the retrieved NBA history navigation and article links.

Correct answer positions rotate evenly across the four choices (57/56/56/56). Each row has four distinct alternatives, an explanation, and a 60-second answer window. SQL and JSON agree on all 225 rows, with no literal prompt duplicates against the preexisting seed bank.

| Cited reference | Questions | Retrieval |
| --- | ---: | --- |
| [Official NBA Rulebook: Rule 1](https://official.nba.com/rule-no-1-court-dimensions-equipment/) | 7 | HTTP 200 |
| [Official NBA Rulebook: Rule 10](https://official.nba.com/rule-no-10-violations-and-penalties/) | 7 | HTTP 200 |
| [Official NBA Rulebook: Rule 11](https://official.nba.com/rule-no-11-basket-interference-goaltending/) | 3 | HTTP 200 |
| [Official NBA Rulebook: Rule 12](https://official.nba.com/rule-no-12-fouls-and-penalties/) | 5 | HTTP 200 |
| [Official NBA Rulebook: Rule 3](https://official.nba.com/rule-no-3-players-substitutes-and-coaches/) | 2 | HTTP 200 |
| [Official NBA Rulebook: Rule 5](https://official.nba.com/rule-no-5-scoring-and-timing/) | 7 | HTTP 200 |
| [Official NBA Rulebook: Rule 7](https://official.nba.com/rule-no-7-24-second-clock/) | 4 | HTTP 200 |
| [Official NBA Rulebook: Rule 8](https://official.nba.com/rule-no-8-out-of-bounds-and-throw-in/) | 3 | HTTP 200 |
| [Official NBA Rulebook: Rule 9](https://official.nba.com/rule-no-9-free-throws-and-penalties/) | 2 | HTTP 200 |
| [NBA: NBA Draft history](https://www.nba.com/news/history-draft) | 25 | HTTP 200 |
| [NBA: Finals MVP award winners](https://www.nba.com/news/history-finals-mvp-winners) | 25 | HTTP 200 |
| [NBA: Most Valuable Player award winners](https://www.nba.com/news/history-mvp-award-winners) | 25 | HTTP 200 |
| [NBA: NBA champions by year](https://www.nba.com/news/history-nba-champions) | 30 | HTTP 200 |
| [NBA: 2019-20 season review](https://www.nba.com/news/history-season-review-2019-20) | 1 | HTTP 200 |
| [NBA: 2021-22 season review](https://www.nba.com/news/history-season-review-2021-22) | 1 | HTTP 200 |
| [NBA: 2022-23 season review](https://www.nba.com/news/history-season-review-2022-23) | 1 | HTTP 200 |
| [NBA: 2023-24 season review](https://www.nba.com/news/history-season-review-2023-24) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-1978-scoring-title-race) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-1992-all-star-game-magic-johnson) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-bird-instincts) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-bird-wilkins-shootout) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-bulls-win-72-games) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-cavaliers-erase-3-1-deficit-2016-finals) | 3 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-celtics-oulast-suns-in-3ot-finals-thriller) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-celtics-win-championship-2008) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-dwyane-wade-heat-title-2006) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-havlicek-steals-the-ball) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-heat-repeat-as-champs) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-heat-super-team-2010) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-henderson-steal-1984) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-isiah-thomas-25-points) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-jerry-west-60-footer) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-john-paxson-clutch-1993-finals) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-jordan-63-playoffs) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-jordan-shot-cavaliers-1989) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-kareem-1985) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-kareem-record) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-kevin-durant-joins-warriors) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-kobe-shaq-alley-oop-lakers-comeback) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-lakers-complete-5th-three-peat-in-nba-history) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-lakers-repeat-1988) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-lakers-streak) | 3 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-lebron-james-first-championship-2012) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-lebron-james-pistons-2007) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-magic-center) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-magics-sky-hook-lifts-lakers) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-michael-jordan-55-at-msg) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-michael-jordan-final-shot-1998) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-michael-jordan-returns-to-nba-at-38) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-michael-jordan-shrug-1992) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-nuggets-stun-sonics-1994) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-phil-jackson-10th-championship) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-ray-allen-3-pointer-2013-finals) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-robinson-duncan-title-2003) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-rockets-22-game-win-streak-2008) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-rose-youngest-mvp-2011) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-russell-leads-celtics-to-11th-title-in-13-seasons) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-sampson-lakers) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-spurs-defeat-heat-2014-finals) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-warriors-cavaliers-four-straight-finals) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-warriors-win-record-73-games) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-westbrook-averages-triple-double-back-to-back) | 1 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-willis-reed-inspires-knicks) | 2 | HTTP 200 |
| [NBA: Historic NBA moment](https://www.nba.com/news/history-top-moments-wilt-chamberlain-scores-100) | 3 | HTTP 200 |
| [NBA: 1984 Draft history](https://www.nba.com/stats/draft/history?Season=1984) | 1 | HTTP 200 |
| [NBA: 1996 Draft history](https://www.nba.com/stats/draft/history?Season=1996) | 1 | HTTP 200 |
| [NBA: 2003 Draft history](https://www.nba.com/stats/draft/history?Season=2003) | 1 | HTTP 200 |
| [NBA: 2009 Draft history](https://www.nba.com/stats/draft/history?Season=2009) | 1 | HTTP 200 |
| [NBA: 2014 Draft history](https://www.nba.com/stats/draft/history?Season=2014) | 1 | HTTP 200 |

## Retired-player profile supplement

The 75 questions in the `48100000` series cover retired players, nicknames, colleges, signature techniques, and dated career achievements. Each question cites its relevant NBA profile or Hall of Fame article. An independent review checked these facts and overlap against the primary 225 questions, including representative fetched canonical NBA articles for Alex English, Reggie Miller, Allen Iverson and Jason Kidd. Individual supplementary references were not all fetched independently.

The combined bank has 300 unique questions with four distinct choices and exactly 75 correct answers in each option position. All rows use schema-relative `questions` inserts, JSON-encoded choices and answer keys, and idempotent `ON CONFLICT (id) DO NOTHING`.
