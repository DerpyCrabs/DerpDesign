import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

// Git defines relevant source, including untracked files and excluding ignored builds.
// Refuse non-repositories rather than silently scanning arbitrary build trees.
export async function fingerprint(root: string) {
  const child = Bun.spawn(
    [
      "git",
      "-C",
      root,
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ".",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const output = await new Response(child.stdout).text();
  if ((await child.exited) !== 0)
    throw Error("Capture roots must be Git working directories");
  const hash = createHash("sha256");
  for (const name of [...new Set(output.split("\0").filter(Boolean))].sort()) {
    hash.update(name + "\0");
    try {
      const path = join(root, name);
      if ((await lstat(path)).isFile()) hash.update(await readFile(path));
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
      hash.update("deleted");
    }
  }
  return hash.digest("hex");
}
