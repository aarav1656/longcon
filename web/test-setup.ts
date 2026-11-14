import { existsSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dir;
const required = ["near-api-js"];

if (required.some((name) => !existsSync(join(root, "node_modules", name, "package.json")))) {
  const run = Bun.spawnSync(["bun", "install", "--frozen-lockfile"], { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (run.exitCode !== 0) throw new Error("bun install --frozen-lockfile failed in " + root);
}
