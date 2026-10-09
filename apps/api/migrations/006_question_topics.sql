ALTER TABLE questions
	ADD COLUMN topic_id text NOT NULL DEFAULT 'science'
		CHECK (topic_id IN ('world', 'thailand', 'food', 'weird', 'nature', 'science', 'taylor-swift', 'breaking-bad', 'marvel', 'logic', 'lateral', 'probability', 'estimate')),
	ADD COLUMN answer_window_seconds integer NOT NULL DEFAULT 60
		CHECK (answer_window_seconds > 0);

ALTER TABLE games
	ADD COLUMN selected_topics text[] NOT NULL DEFAULT ARRAY['world', 'thailand', 'food', 'weird', 'nature', 'science', 'taylor-swift', 'breaking-bad', 'marvel', 'logic', 'lateral', 'probability', 'estimate']
		CHECK (
			cardinality(selected_topics) > 0
			AND array_position(selected_topics, NULL) IS NULL
			AND selected_topics <@ ARRAY['world', 'thailand', 'food', 'weird', 'nature', 'science', 'taylor-swift', 'breaking-bad', 'marvel', 'logic', 'lateral', 'probability', 'estimate']
		);
