CREATE TABLE games (
	id uuid PRIMARY KEY,
	name varchar(60) NOT NULL,
	join_code varchar(6) NOT NULL CONSTRAINT games_join_code_key UNIQUE,
	host_token_hash char(64) NOT NULL,
	status text NOT NULL DEFAULT 'LOBBY' CHECK (status IN ('LOBBY', 'WAITING', 'COMPLETE')),
	round_interval_seconds integer NOT NULL CHECK (round_interval_seconds IN (300, 600, 900)),
	question_window_seconds integer NOT NULL DEFAULT 60,
	started_at timestamptz,
	next_round_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now()
);
