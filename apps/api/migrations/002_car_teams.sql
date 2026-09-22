CREATE TABLE car_teams (
	id uuid PRIMARY KEY,
	game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
	name varchar(60) NOT NULL,
	captain_token_hash char(64) NOT NULL,
	status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LEFT')),
	score integer NOT NULL DEFAULT 0,
	joined_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX car_teams_game_name_key
	ON car_teams (game_id, lower(name));

CREATE INDEX car_teams_game_id_idx ON car_teams (game_id);
