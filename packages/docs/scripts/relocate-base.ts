// Astro 6 + @astrojs/cloudflare 13 emit prerendered HTML and `_astro/` to
// `dist/client/<file>`, but the worker manifest registers them at
// `<base>/<file>`. The CF assets binding then 404s every URL. Moving each
// entry under the base path realigns the file layout with the URLs the
// worker expects. Drop this once Astro/CF adapter handles `output: "server"`
// + `base` correctly.

import { mkdir, readdir, rename } from "node:fs/promises";
import { join } from "node:path";

const CLIENT_DIR = "dist/client";
const BASE_SEGMENTS = ["projects", "react-socket"];
const TARGET_DIR = join(CLIENT_DIR, ...BASE_SEGMENTS);
const FIRST_SEGMENT = BASE_SEGMENTS[0];

await mkdir(TARGET_DIR, { recursive: true });

const entries = await readdir(CLIENT_DIR, { withFileTypes: true });

for (const entry of entries) {
	if (entry.name === FIRST_SEGMENT) continue;
	await rename(join(CLIENT_DIR, entry.name), join(TARGET_DIR, entry.name));
}
