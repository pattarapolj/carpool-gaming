ALTER TABLE games ADD COLUMN puzzle_setup jsonb;

CREATE TABLE puzzle_rounds (
 id uuid PRIMARY KEY,
 game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
 sequence integer NOT NULL CHECK (sequence > 0),
 theme text NOT NULL CHECK (theme IN ('naruto', 'animals', 'melodies')),
 format text NOT NULL CHECK (format IN ('CHARACTER', 'PICTURE', 'MUSIC', 'TRIVIA')),
 status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESULTS')),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
 puzzle_ids text[] NOT NULL,
 theme_team_id uuid REFERENCES car_teams(id),
 format_team_id uuid REFERENCES car_teams(id),
 next_theme text CHECK (next_theme IN ('naruto', 'animals', 'melodies')),
 UNIQUE (game_id, sequence)
);
CREATE UNIQUE INDEX puzzle_rounds_one_open ON puzzle_rounds(game_id) WHERE status='OPEN';
CREATE TABLE puzzle_progress (
 round_id uuid NOT NULL REFERENCES puzzle_rounds(id) ON DELETE CASCADE,
 team_id uuid NOT NULL REFERENCES car_teams(id) ON DELETE CASCADE,
 current_index integer NOT NULL DEFAULT 0 CHECK (current_index >= 0),
 guesses jsonb NOT NULL DEFAULT '{}',
 solved text[] NOT NULL DEFAULT '{}',
 skipped text[] NOT NULL DEFAULT '{}',
 tie_order integer NOT NULL,
 PRIMARY KEY(round_id, team_id)
);
