-- Local/test samples only: original wording grounded in the attributed NASA pages.
INSERT INTO questions (id, type, prompt, choices, correct_answer, explanation, source_title, source_url)
VALUES
	('10000000-0000-4000-8000-000000000001', 'MULTIPLE_CHOICE',
	 'Which planet is the largest in our solar system?',
	 '["Earth", "Jupiter", "Neptune", "Saturn"]', '"Jupiter"',
	 'Jupiter is the largest planet in our solar system.',
	 'NASA: Jupiter Facts', 'https://science.nasa.gov/jupiter/jupiter-facts/'),
	('10000000-0000-4000-8000-000000000002', 'TRUE_FALSE',
	 'True or false: the Sun is a star.', NULL, 'true',
	 'The Sun is the star at the center of our solar system.',
	 'NASA: Sun Facts', 'https://science.nasa.gov/sun/facts/'),
	('10000000-0000-4000-8000-000000000003', 'ESTIMATE',
	 'About how many Earth years does Neptune take to complete one orbit of the Sun? Give a whole number.',
	 NULL, '165', 'Neptune completes one orbit in approximately 165 Earth years.',
	 'NASA: Neptune Facts', 'https://science.nasa.gov/neptune/neptune-facts/');
