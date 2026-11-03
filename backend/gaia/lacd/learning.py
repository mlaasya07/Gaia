"""Online learning: bandit-style updates of agent weights and trust from realized vs predicted outcomes."""
from __future__ import annotations
from .agents import AGENT_IDS, METRICS, Agent, deltas, utility
from .twin_model import Summary

LR = .04


def learn_from_outcome(agents: list[Agent], adopted_agent_ids: set, predicted: Summary, base: Summary,
                       realized: Summary) -> dict:
    d_pred, d_real = deltas(predicted, base), deltas(realized, base)
    per_agent = {}
    for a in agents:
        pred, real = utility(a, d_pred), utility(a, d_real)
        acc = 1 - min(1., abs(pred - real) / (abs(pred) + abs(real) + .25))
        per_agent[a.id] = {"pred": pred, "real": real, "acc": acc}
        a.reward_history.append(real); a.accuracy_history.append(acc)
        del a.reward_history[:-120]; del a.accuracy_history[:-120]
        for k in METRICS:
            surprise = max(-2., min(2., d_pred[k] - d_real[k]))
            primary = k in a.primary
            nxt = a.weights[k] + LR * surprise * (.5 if primary else .15)
            if primary and real > 0:
                nxt += LR * .2
            a.weights[k] = max(.4 if primary else .02, min(2., nxt))
    for a in agents:
        for b in AGENT_IDS:
            if b == a.id:
                continue
            if b in adopted_agent_ids:
                a.trust[b] += .2 * (per_agent[b]["acc"] - a.trust[b])
            else:
                a.trust[b] += .02 * (.6 - a.trust[b])
            a.trust[b] = max(.05, min(1., a.trust[b]))
    for a in agents:
        others = [x for x in agents if x.id != a.id]
        a.influence = sum(x.trust[a.id] for x in others) / len(others)
    return per_agent
