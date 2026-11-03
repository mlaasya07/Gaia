import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SKIP_DIRS = new Set([
  "node_modules",
  ".output",
  ".tanstack",
  "dist",
  ".git",
  "outputs",
  "__pycache__",
]);
const TEXT = /\.(ts|tsx|js|json|md|py|css|toml|txt|html)$/;

// Built from pieces so this file does not match its own scan.
const BANNED = [new RegExp("lov" + "able", "i"), new RegExp("\\b" + "A" + "I\\b")];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (TEXT.test(name) && name !== "bun.lock" && name !== "hygiene.test.ts") out.push(full);
  }
  return out;
}

describe("repository hygiene", () => {
  const files = walk(ROOT);

  it("scans a meaningful set of files", () => {
    expect(files.length).toBeGreaterThan(80);
  });

  it("contains none of the removed tooling or banned wording", () => {
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const re of BANNED)
        if (re.test(text)) hits.push(`${path.relative(ROOT, file)} matches ${re}`);
    }
    expect(hits).toEqual([]);
  });

  it("has no leftover editor metadata folder or agent-rules file", () => {
    const names = readdirSync(ROOT);
    expect(names).not.toContain(".lov" + "able");
    expect(names).not.toContain("AGENTS.md");
  });
});
