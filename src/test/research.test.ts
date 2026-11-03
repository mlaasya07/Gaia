import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  LEARNED,
  attentionDeviation,
  bestPolicy,
  deriveFindings,
  loadResearch,
  type ResearchData,
  type Variant,
} from "@/lib/research";

const data = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../public/data/research.json"), "utf8"),
) as ResearchData;
const real = data.variants["real_data"]!;
const ids = (v: Variant) => deriveFindings(v).map((f) => f.id);

describe("exported research data", () => {
  it("has the structure the page relies on", () => {
    expect(Object.keys(data.variants)).toEqual(["factorysim", "real_data"]);
    expect(data.meta.agents).toHaveLength(4);
    expect(data.meta.evaluation_seeds).toHaveLength(30);
    expect(real.attention!.mean).toHaveLength(4);
    expect(real.attention!.per_head).toHaveLength(4);
    expect(real.paired_vs_baselines.length).toBe(3 * data.meta.metrics.length);
    expect(data.evidence.rows.length).toBeGreaterThan(0);
  });

  it("rows of the attention matrix are distributions", () => {
    for (const row of real.attention!.mean)
      expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
  });

  it("reproduces the saved evaluation exactly", () => {
    expect(data.meta.reproduction_check["real_data"]!.max_abs_diff_vs_saved_csv["reward"]).toBe(0);
  });

  it("marks the old checkpoint as not re-runnable instead of inventing attention", () => {
    const old = data.variants["factorysim"]!;
    expect(old.rerun_available).toBe(false);
    expect(old.attention).toBeNull();
    expect(old.behaviour).toBeNull();
  });
});

describe("derived findings", () => {
  it("flags the real policy's problems", () => {
    const f = ids(real);
    expect(f).toContain("reward-behind");
    expect(f).toContain("near-constant-policy");
    expect(f).toContain("uniform-attention");
    expect(f).toContain("consistent-losses");
  });

  it("does not claim wins the data does not support", () => {
    const f = ids(real);
    expect(f).not.toContain("reward-ahead");
    expect(f).not.toContain("selective-attention");
  });

  it("only calls out near-constant behaviour when the rates say so", () => {
    const varied = structuredClone(real);
    varied.behaviour = {
      ...varied.behaviour!,
      maintenance_rate: 0.5,
      cloud_rate: 0.4,
      shift_rate: 0.6,
    };
    expect(ids(varied)).not.toContain("near-constant-policy");
  });

  it("reports selective attention when the weights are not uniform", () => {
    const peaked = structuredClone(real);
    peaked.attention!.mean = [
      [0.7, 0.1, 0.1, 0.1],
      [0.1, 0.7, 0.1, 0.1],
      [0.1, 0.1, 0.7, 0.1],
      [0.1, 0.1, 0.1, 0.7],
    ];
    expect(ids(peaked)).toContain("selective-attention");
    expect(ids(peaked)).not.toContain("uniform-attention");
  });

  it("reports a reward win when the learned policy leads", () => {
    const winning = structuredClone(real);
    for (const r of winning.paired_vs_baselines)
      if (r.baseline === "B1_centralized" && r.metric === "reward") r.learned_better_in = r.n;
    expect(ids(winning)).toContain("reward-ahead");
    expect(ids(winning)).not.toContain("reward-behind");
  });

  it("explains missing attention for a checkpoint that cannot be re-run", () => {
    expect(ids(data.variants["factorysim"]!)).toContain("no-rerun");
  });

  it("measures attention deviation from uniform", () => {
    expect(
      attentionDeviation([
        [0.5, 0.5],
        [0.5, 0.5],
      ]).max,
    ).toBeCloseTo(0, 6);
    expect(
      attentionDeviation([
        [1, 0],
        [0, 1],
      ]).max,
    ).toBeCloseTo(0.5, 6);
  });

  it("picks the best policy per metric using the metric's direction", () => {
    expect(bestPolicy(real.policies, "reward", true)).toBe("B1_centralized");
    expect(bestPolicy(real.policies, "health_risk_proxy", false)).toBe(LEARNED);
  });
});

describe("loadResearch", () => {
  it("returns the parsed file", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => data });
    await expect(loadResearch(fetchMock as unknown as typeof fetch)).resolves.toBe(data);
    expect(fetchMock).toHaveBeenCalledWith("/data/research.json");
  });

  it("rejects with the HTTP status when the file is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(loadResearch(fetchMock as unknown as typeof fetch)).rejects.toThrow("HTTP 404");
  });
});
