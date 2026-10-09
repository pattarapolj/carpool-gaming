import assert from "node:assert/strict";

export function testDatabaseUrl(value: string | undefined) {
	const message =
		"TEST_DATABASE_URL must explicitly name carpool_test using postgres:// or postgresql:// without query parameters or fragments";
	assert(value, message);
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(message);
	}
	assert(
		["postgres:", "postgresql:"].includes(url.protocol) &&
			url.pathname === "/carpool_test" &&
			url.hostname &&
			!url.search &&
			!url.hash,
		message,
	);
	return value;
}
