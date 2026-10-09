import { expect, it } from "vitest";
import { testDatabaseUrl } from "./postgres-url";

it("requires an explicit dedicated PostgreSQL test database before connecting", () => {
	for (const value of [
		undefined,
		"",
		"not a URL",
		"https://localhost/carpool_test",
		"postgres://localhost/carpool",
		"postgres://localhost/carpool_test/other",
		"postgres://localhost/carpool_test?options=-csearch_path=public",
		"postgres://localhost/carpool_test?dbname=production",
		"postgres://localhost/carpool_test#other",
	]) {
		expect(() => testDatabaseUrl(value)).toThrow(/TEST_DATABASE_URL/);
	}
	for (const value of [
		"postgres://carpool_test:synthetic@localhost:54329/carpool_test",
		"postgresql://carpool_test:synthetic@localhost:5432/carpool_test",
	]) {
		expect(testDatabaseUrl(value)).toBe(value);
	}
});
