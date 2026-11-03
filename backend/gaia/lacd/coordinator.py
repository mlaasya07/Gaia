"""Negotiation (up to 3 rounds) and consensus resolution under hard safety limits."""
from __future__ import annotations
from dataclasses import dataclass
from .agents import (AGENT_IDS, METRICS, ACTION_TARGETS, Agent, PlanContext, Proposal, deltas, utility,
                     propose, evaluate_proposal, describe, target_of)
from .twin_model import BASE_ACTION, Summary

SAFETY_FLOOR = -.6  # no agent may be pushed below this normalized utility (chosen on exploration seeds)


@dataclass(frozen=True)
class SafetyLimits:
    """Hard limits on a plan. They apply to LACD plans only; baselines are unconstrained."""
    peak_energy: float = 1.0        # per-step energy cap (over-usage guard)
    peak_carbon: float = .75        # per-step emission cap (extreme-emission guard)
    backlog_slack: float = .05      # plan may not grow the backlog beyond base + slack
    min_health: float = .20         # health floor


def hard_veto(plan: Summary, base: Summary, lim: SafetyLimits) -> str | None:
    if plan.peakEnergy > lim.peak_energy and plan.peakEnergy > base.peakEnergy:
        return f"energy cap: {plan.peakEnergy:.2f} per step"
    if plan.peakCarbon > lim.peak_carbon and plan.peakCarbon > base.peakCarbon:
        return f"emission cap: {plan.peakCarbon:.2f} per step"
    if plan.missed > base.missed + lim.backlog_slack:
        return f"deadline floor: backlog +{plan.missed - base.missed:.2f}"
    if plan.minHealth < lim.min_health and plan.minHealth < base.minHealth - .005:
        return f"health floor: {plan.minHealth:.2f}"
    return None


def _soften(patch: dict) -> dict | None:
    """Move a proposal halfway back toward the base course; None means it cannot be softened."""
    k, v = next(iter(patch.items()))
    if k != "production":
        return None
    nv = round(v + (BASE_ACTION["production"] - v) / 2, 2)
    return None if abs(nv - BASE_ACTION["production"]) < .06 else {"production": nv}


def negotiate(agents: list[Agent], ctx: PlanContext):
    by_id = {a.id: a for a in agents}
    proposals = [p for p in (propose(a, ctx) for a in agents) if p]
    rounds = 0
    for rnd in range(1, 4):
        rounds = rnd
        any_obj = False
        for p in proposals:
            if p.withdrawn:
                continue
            p.objections = []
            for b in agents:
                if b.id == p.agent_id:
                    continue
                s = utility(b, deltas(p.summary, ctx.base))
                p.scores[b.id] = s
                if s < -.08:
                    p.objections.append((b.id, s))
                    any_obj = True
        if not any_obj or rnd == 3:
            break
        for p in proposals:
            if p.withdrawn or not p.objections:
                continue
            owner = by_id[p.agent_id]
            pressure = sum(owner.trust[o] * abs(s) for o, s in p.objections)
            if pressure < p.own_gain * .6:
                continue
            nxt = _soften(p.patch)
            if nxt is None:
                p.withdrawn = True
                continue
            p.summary, p.own_gain = evaluate_proposal(owner, ctx, nxt)
            p.patch, p.text = nxt, describe(nxt)
    return proposals, rounds


def _merge(patches: list[dict]) -> dict:
    out: dict = {}
    for p in patches:
        out.update(p)
    return out


def resolve(agents: list[Agent], ctx: PlanContext, proposals: list[Proposal], lim: SafetyLimits):
    live = [p for p in proposals if not p.withdrawn][:5]
    vetoes, cands = [], []
    for mask in range(1 << len(live)):
        chosen = [p for i, p in enumerate(live) if mask >> i & 1]
        if len({target_of(p.patch) for p in chosen}) != len(chosen):
            continue  # two proposals fight over the same control
        merged = _merge([p.patch for p in chosen])
        summary = ctx.base if not chosen else ctx.eval_plan(merged)
        if chosen:
            veto = hard_veto(summary, ctx.base, lim)
            if veto:
                if len(chosen) == 1:
                    vetoes.append(f"{chosen[0].text}: {veto}")
                continue
        d = deltas(summary, ctx.base)
        u = {a.id: utility(a, d) for a in agents}
        if any(v < SAFETY_FLOOR for v in u.values()):
            continue
        cands.append((chosen, merged, summary, u, sum(a.influence * u[a.id] for a in agents)))
    pareto = [c for c in cands
              if not any(o is not c and all(o[3][i] >= c[3][i] for i in AGENT_IDS)
                         and any(o[3][i] > c[3][i] + 1e-9 for i in AGENT_IDS) for o in cands)]
    pareto.sort(key=lambda c: (-c[4], len(c[0])))
    best = pareto[0] if pareto else next(c for c in cands if not c[0])
    return {"adopted": best[0], "patch": best[1], "summary": best[2], "utilities": best[3],
            "global": best[4], "vetoes": vetoes, "considered": len(cands), "pareto": len(pareto)}


def decide_collaborative(agents, ctx, lim: SafetyLimits):
    proposals, rounds = negotiate(agents, ctx)
    res = resolve(agents, ctx, proposals, lim)
    res.update(proposals=proposals, rounds=rounds)
    return res


def decide_siloed(agents, ctx):
    """Baseline: every agent applies its own best proposal; later agents overwrite earlier ones."""
    patch: dict = {}
    for a in agents:
        p = propose(a, ctx)
        if p:
            patch.update(p.patch)
    return patch
