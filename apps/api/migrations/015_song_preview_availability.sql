-- A provider outage must not turn an unknown recording into a missing one.
-- Only confirmed missing recordings receive available = false.
CREATE TABLE song_preview_availability (
	track_id bigint PRIMARY KEY CONSTRAINT song_preview_track_id_valid CHECK (track_id > 0 AND track_id <= 9007199254740991),
	available boolean,
	checked_at timestamptz NOT NULL DEFAULT now(),
	last_error_code text,
	last_error_stage text,
	CONSTRAINT song_preview_error_pair_valid CHECK ((last_error_code IS NULL) = (last_error_stage IS NULL)),
	CONSTRAINT song_preview_error_code_valid CHECK (last_error_code IS NULL OR last_error_code IN (
		'TRACK_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'PROVIDER_ERROR',
		'INVALID_PREVIEW', 'DECODE_FAILED', 'DECODE_TIMEOUT', 'PREVIEW_CHECK_FAILED'
	)),
	CONSTRAINT song_preview_error_stage_valid CHECK (last_error_stage IS NULL OR last_error_stage IN (
		'metadata', 'download', 'decode', 'validation'
	))
);
