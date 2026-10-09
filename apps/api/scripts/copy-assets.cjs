const { cpSync } = require("node:fs");
for (const name of ["migrations", "seeds"]) {
	cpSync(name, `dist/apps/api/${name}`, { recursive: true });
}
