CREATE TABLE questions (
	id uuid PRIMARY KEY,
	type text NOT NULL CHECK (type IN ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'ESTIMATE')),
	prompt text NOT NULL CHECK (length(btrim(prompt)) > 0),
	choices jsonb,
	correct_answer jsonb NOT NULL,
	explanation text NOT NULL CHECK (length(btrim(explanation)) > 0),
	source_title text NOT NULL CHECK (length(btrim(source_title)) > 0),
	source_url text NOT NULL CHECK (length(btrim(source_url)) > 0),
	is_active boolean NOT NULL DEFAULT true,
	CONSTRAINT questions_answer_shape_check CHECK (
		CASE type
			WHEN 'MULTIPLE_CHOICE' THEN
				CASE WHEN jsonb_typeof(choices) = 'array' THEN
					jsonb_array_length(choices) >= 2
					AND jsonb_typeof(correct_answer) = 'string'
					AND choices @> jsonb_build_array(correct_answer)
				ELSE false END
			WHEN 'TRUE_FALSE' THEN choices IS NULL AND jsonb_typeof(correct_answer) = 'boolean'
			WHEN 'ESTIMATE' THEN choices IS NULL AND jsonb_typeof(correct_answer) = 'number'
			ELSE false
		END
	)
);

CREATE TABLE rounds (
	id uuid PRIMARY KEY,
	game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
	question_id uuid NOT NULL REFERENCES questions(id),
	sequence integer NOT NULL CHECK (sequence > 0),
	status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'REVEALED')),
	starts_at timestamptz NOT NULL,
	ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
	revealed_at timestamptz,
	expected_team_count integer NOT NULL CHECK (expected_team_count > 0),
	CONSTRAINT rounds_game_sequence_key UNIQUE (game_id, sequence),
	CONSTRAINT rounds_id_game_key UNIQUE (id, game_id),
	CONSTRAINT rounds_reveal_check CHECK (
		(status = 'OPEN' AND revealed_at IS NULL)
		OR (status = 'REVEALED' AND revealed_at IS NOT NULL AND revealed_at >= starts_at)
	)
);

ALTER TABLE car_teams ADD CONSTRAINT car_teams_id_game_key UNIQUE (id, game_id);

CREATE TABLE answers (
	id uuid PRIMARY KEY,
	game_id uuid NOT NULL,
	round_id uuid NOT NULL,
	car_team_id uuid NOT NULL,
	value jsonb NOT NULL CHECK (jsonb_typeof(value) IN ('string', 'boolean', 'number')),
	submitted_at timestamptz NOT NULL DEFAULT now(),
	is_correct boolean,
	points_awarded integer CHECK (points_awarded IN (0, 1)),
	CONSTRAINT answers_round_team_key UNIQUE (round_id, car_team_id),
	CONSTRAINT answers_round_game_fkey FOREIGN KEY (round_id, game_id)
		REFERENCES rounds(id, game_id) ON DELETE CASCADE,
	CONSTRAINT answers_team_game_fkey FOREIGN KEY (car_team_id, game_id)
		REFERENCES car_teams(id, game_id) ON DELETE CASCADE
);

CREATE FUNCTION prevent_answer_submission_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF ROW(NEW.id, NEW.game_id, NEW.round_id, NEW.car_team_id, NEW.value, NEW.submitted_at)
		IS DISTINCT FROM ROW(OLD.id, OLD.game_id, OLD.round_id, OLD.car_team_id, OLD.value, OLD.submitted_at) THEN
		RAISE EXCEPTION 'Answer submissions are immutable' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER answers_immutable_submission
	BEFORE UPDATE ON answers FOR EACH ROW
	EXECUTE FUNCTION prevent_answer_submission_update();
