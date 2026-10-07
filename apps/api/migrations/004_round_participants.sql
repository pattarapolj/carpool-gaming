-- NULL preserves the unknown historical roster of storage-only legacy rounds.
ALTER TABLE rounds ADD COLUMN expected_team_ids uuid[];
ALTER TABLE rounds ADD CONSTRAINT rounds_participant_count_check
	CHECK (expected_team_ids IS NULL OR cardinality(expected_team_ids) = expected_team_count);
