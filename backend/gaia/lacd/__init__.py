"""LACD: Learning Agents for Collaborative Decisions.

Agents hold learnable utility weights and inter-agent trust, propose actions, evaluate each
other's proposals through a world-model lookahead, negotiate, and a resolver picks a Pareto
consensus plan under hard safety limits. Realized outcomes update weights and trust online.
Agents can be pretrained offline and saved/loaded as JSON.

Ported from the TypeScript engine in src/engine (agents, negotiation, consensus,
learning) onto the Gaia factory simulator.
"""
from .agents import Agent, AGENT_IDS, METRICS, create_agents
from .policy import LACDPolicy

__all__ = ["Agent", "AGENT_IDS", "METRICS", "create_agents", "LACDPolicy"]
