"""Transparent synthetic factory digital twin used only for policy comparisons."""
from dataclasses import dataclass
import numpy as np

@dataclass
class FactoryState:
    health: float
    backlog: float
    energy_price: float
    carbon_intensity: float
    workload: float
    edge_load: float
    time_step: int

class FactorySim:
    def __init__(self, seed=42, horizon=96):
        self.rng=np.random.default_rng(seed); self.horizon=horizon; self.t=0
        self.state=None; self.total={}
    def reset(self, initial_health=None):
        """Reset the episode. `initial_health` optionally overrides the sampled start health.

        The default draw is still consumed so the random stream (and therefore every later
        price/carbon/workload value) is identical with and without an override.
        """
        self.t=0
        _default_health=float(self.rng.uniform(.72,1.0))
        self.state=FactoryState(
            health=_default_health if initial_health is None else float(np.clip(initial_health,.05,1.)), backlog=float(self.rng.uniform(.15,.65)),
            energy_price=float(self.rng.uniform(.6,1.4)), carbon_intensity=float(self.rng.uniform(.35,.9)),
            workload=float(self.rng.uniform(.35,.8)), edge_load=float(self.rng.uniform(.1,.5)), time_step=0)
        self.total={"energy":0.,"energy_cost":0.,"carbon":0.,"throughput":0.,"downtime":0.,"latency":0.,"maintenance":0.,"reward":0.}
        return self.observe()
    def observe(self):
        s=self.state
        return np.array([s.health,s.backlog,s.energy_price,s.carbon_intensity,s.workload,s.edge_load,s.time_step/self.horizon],dtype=float)
    def step(self, action):
        # action: production in [0,1], maintenance {0,1}, compute location {edge=0, cloud=1}, shift {0,1}
        s=self.state
        production=float(np.clip(action.get("production",.6),0,1))
        maintenance=int(bool(action.get("maintenance",0)))
        cloud=int(bool(action.get("cloud",0)))
        shift=int(bool(action.get("shift",0)))
        maint_cost=.10 if maintenance else 0.
        effective_health=min(1.,s.health + (.18 if maintenance else 0.) - .006*production)
        downtime=(.16 if s.health<.35 and not maintenance else 0.)
        throughput=max(0.,production*(.55+.45*effective_health)-downtime)
        energy=0.35+0.8*production**2+(0.10 if cloud else 0.0)
        energy_cost=energy*s.energy_price
        # Shift means defer a flexible workload to a lower-carbon/price simulated period.
        effective_carbon=max(.1,s.carbon_intensity-(.15 if shift else 0.))
        carbon=energy*effective_carbon
        latency=(.06+.25*s.edge_load**2) if not cloud else (.11+.07*s.edge_load)
        latency += .05 if shift else 0.
        backlog=max(0.,s.backlog+s.workload-throughput)
        reward=1.4*throughput-.45*energy_cost-.50*carbon-.45*latency-.7*downtime-1.2*maint_cost
        self.total["energy"]+=energy; self.total["energy_cost"]+=energy_cost
        self.total["carbon"]+=carbon; self.total["throughput"]+=throughput
        self.total["downtime"]+=downtime; self.total["latency"]+=latency; self.total["maintenance"]+=maintenance
        self.total["reward"]+=reward
        self.t+=1
        self.state=FactoryState(
            health=float(np.clip(effective_health+self.rng.normal(0,.012),.05,1)),
            backlog=float(np.clip(backlog,0,2)),
            energy_price=float(np.clip(.9+.25*np.sin(self.t/12)+self.rng.normal(0,.08),.4,1.5)),
            carbon_intensity=float(np.clip(.62+.22*np.sin(self.t/17+1)+self.rng.normal(0,.06),.15,1)),
            workload=float(np.clip(.55+.18*np.sin(self.t/8)+self.rng.normal(0,.08),.1,1)),
            edge_load=float(np.clip(.3+.25*production+self.rng.normal(0,.05),0,1)), time_step=self.t)
        done=self.t>=self.horizon
        return self.observe(),reward,done,dict(self.total)
