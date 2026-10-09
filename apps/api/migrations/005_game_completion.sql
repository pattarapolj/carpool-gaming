ALTER TABLE games
 ADD COLUMN completed_at timestamptz,
 ADD COLUMN completion_reason text CHECK (completion_reason IN ('HOST_ENDED','TIME_LIMIT','QUESTION_BANK_EXHAUSTED','NO_ACTIVE_TEAMS')),
 ADD CONSTRAINT games_completion_metadata_check CHECK (
  (completed_at IS NULL AND completion_reason IS NULL)
  OR (status='COMPLETE' AND completed_at IS NOT NULL AND completion_reason IS NOT NULL)
 );
