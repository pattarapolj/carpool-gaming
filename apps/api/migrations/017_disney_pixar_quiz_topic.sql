-- Disney & Pixar is selectable for new games; existing game selections remain unchanged.
ALTER TABLE questions DROP CONSTRAINT questions_topic_id_check;
ALTER TABLE questions ADD CONSTRAINT questions_topic_id_check
 CHECK (topic_id IN ('world', 'thailand', 'food', 'weird', 'nature', 'science', 'taylor-swift', 'breaking-bad', 'marvel', 'logic', 'lateral', 'probability', 'estimate', 'harry-potter', 'history', 'sports', 'video-games', 'nba', 'disney-pixar'));

ALTER TABLE games DROP CONSTRAINT games_selected_topics_check;
ALTER TABLE games ADD CONSTRAINT games_selected_topics_check
 CHECK (cardinality(selected_topics) > 0
  AND array_position(selected_topics, NULL) IS NULL
  AND selected_topics <@ ARRAY['world', 'thailand', 'food', 'weird', 'nature', 'science', 'taylor-swift', 'breaking-bad', 'marvel', 'logic', 'lateral', 'probability', 'estimate', 'harry-potter', 'history', 'sports', 'video-games', 'nba', 'disney-pixar']);
ALTER TABLE games ALTER COLUMN selected_topics SET DEFAULT ARRAY['world', 'thailand', 'food', 'weird', 'nature', 'science', 'taylor-swift', 'breaking-bad', 'marvel', 'logic', 'lateral', 'probability', 'estimate', 'harry-potter', 'history', 'sports', 'video-games', 'nba', 'disney-pixar'];
