ALTER TABLE puzzle_rounds DROP CONSTRAINT puzzle_rounds_theme_check;
ALTER TABLE puzzle_rounds ADD CONSTRAINT puzzle_rounds_theme_check
 CHECK (theme IN ('naruto', 'animals', 'melodies', 'taylor-swift', 'ed-sheeran', 'adele', 'imagine-dragons', 'kpop', 'songs-2000s', 'songs-2010s', 'songs-2020s', 'hit-songs', 'pop-hits', 'rock-hits', 'dance-edm'));

ALTER TABLE puzzle_rounds DROP CONSTRAINT puzzle_rounds_next_theme_check;
ALTER TABLE puzzle_rounds ADD CONSTRAINT puzzle_rounds_next_theme_check
 CHECK (next_theme IN ('naruto', 'animals', 'melodies', 'taylor-swift', 'ed-sheeran', 'adele', 'imagine-dragons', 'kpop', 'songs-2000s', 'songs-2010s', 'songs-2020s', 'hit-songs', 'pop-hits', 'rock-hits', 'dance-edm'));
