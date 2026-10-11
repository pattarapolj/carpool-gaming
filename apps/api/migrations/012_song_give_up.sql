-- Keep reveal decisions private to each car and separate from solved/skipped songs.
ALTER TABLE puzzle_progress
 ADD COLUMN given_up text[] NOT NULL DEFAULT '{}';
