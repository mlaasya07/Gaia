"""Run same-seed baselines, ablations, and a model-guided LACD prototype."""
import argparse
from pathlib import Path
import numpy as np
import pandas as pd
from .simulator import FactorySim
from .agents import act_centralized, act_independent, act_lacd_prototype
from .world_model import load_shared_world_model, predict_next_state, train_shared_world_model

def _model_guided_action(obs, proposal, model, normalization):
    production_options = sorted({
        float(np.clip(proposal["production"] - .12, .15, 1.)),
        float(np.clip(proposal["production"], .15, 1.)),
        float(np.clip(proposal["production"] + .12, .15, 1.)),
    })
    maintenance_options = sorted({int(proposal["maintenance"]), int(obs[0] < .32)})
    cloud_options = sorted({int(proposal["cloud"]), int(not proposal["cloud"])})
    shift_options = sorted({int(proposal["shift"]), int(obs[3] > .75 and obs[1] < .65)})
    best_action = proposal
    best_value = -float("inf")
    for production in production_options:
        for maintenance in maintenance_options:
            for cloud in cloud_options:
                for shift in shift_options:
                    candidate = {"production": production, "maintenance": maintenance,
                                 "cloud": cloud, "shift": shift}
                    predicted = predict_next_state(
                        model, normalization, obs,
                        [production, maintenance, cloud, shift],
                    )
                    effective_carbon = max(.1, obs[3] - (.15 if shift else 0.))
                    energy = .35 + .8 * production ** 2 + (.10 if cloud else 0.)
                    latency = (.06 + .25 * obs[5] ** 2) if not cloud else (.11 + .07 * obs[5])
                    latency += .05 if shift else 0.
                    downtime = .16 if obs[0] < .35 and not maintenance else 0.
                    throughput = max(0., production * (.55 + .45 * predicted[0]) - downtime)
                    value = (
                        1.4 * throughput - .45 * energy * obs[2]
                        - .50 * energy * effective_carbon - .45 * latency
                        - .7 * downtime - 1.2 * (.10 if maintenance else 0.)
                        - .18 * max(0., predicted[1] - .8)
                    )
                    if predicted[0] < .20 or predicted[1] > 1.8:
                        value -= 2.
                    if value > best_value:
                        best_value = value
                        best_action = candidate
    return best_action


def run_experiment(episodes=30, world_model_episodes=30, horizon=96, seed=42, out_dir="outputs/simulation"):
    if episodes < 5:
        raise ValueError("episodes must be at least 5 for separate world-model train/validation/test evaluation")
    if world_model_episodes < 10:
        raise ValueError("world_model_episodes must be at least 10 for episode-level train/validation/test splits")
    if horizon < 1:
        raise ValueError("horizon must be a positive integer")
    out=Path(out_dir); out.mkdir(parents=True,exist_ok=True)
    calibration_transitions=[]
    action_rng=np.random.default_rng(seed + 1_000_000)
    for ep in range(world_model_episodes):
        env=FactorySim(seed=seed + 1_000_000 + ep,horizon=horizon)
        obs=env.reset(); done=False
        while not done:
            action={"production":float(action_rng.uniform(.15,1.)),
                    "maintenance":int(action_rng.random()<.12),
                    "cloud":int(action_rng.random()<.35),
                    "shift":int(action_rng.random()<.35)}
            nxt,_,done,_=env.step(action)
            calibration_transitions.append({"episode":ep,"policy":"calibration",
                **{f"s{i}":v for i,v in enumerate(obs)},
                "a_production":action["production"],"a_maintenance":action["maintenance"],
                "a_cloud":action["cloud"],"a_shift":action["shift"],
                **{f"next_s{i}":v for i,v in enumerate(nxt)}})
            obs=nxt
    world_model_metrics=train_shared_world_model(
        pd.DataFrame(calibration_transitions),out,seed
    )
    pd.DataFrame(calibration_transitions).to_csv(out/"world_model_calibration_transitions.csv",index=False)
    world_model,normalization=load_shared_world_model(out/"shared_world_model.pt")
    policies={
        "B1_centralized_baseline":act_centralized,
        "B2_independent_agents":act_independent,
        "B3_without_world_model":act_lacd_prototype,
        "B4_without_LACD":lambda obs: _model_guided_action(obs,act_independent(obs),world_model,normalization),
        "full_Gaia_prototype":lambda obs: _model_guided_action(obs,act_lacd_prototype(obs),world_model,normalization),
    }
    rows=[]; transitions=[]
    for ep in range(episodes):
        # Every policy receives the same initial conditions and stochastic stream per episode.
        for name,policy in policies.items():
            env=FactorySim(seed=seed+ep,horizon=horizon)
            obs=env.reset(); done=False
            while not done:
                action=policy(obs); nxt,reward,done,totals=env.step(action)
                transitions.append({"episode":ep,"policy":name,**{f"s{i}":v for i,v in enumerate(obs)},
                                    "a_production":action["production"],"a_maintenance":action["maintenance"],
                                    "a_cloud":action["cloud"],"a_shift":action["shift"],
                                    **{f"next_s{i}":v for i,v in enumerate(nxt)},"reward":reward})
                obs=nxt
            rows.append({"episode":ep,"policy":name,**{k:v/horizon for k,v in totals.items()},
                         "seed":seed+ep})
    df=pd.DataFrame(rows); df.to_csv(out/"episode_metrics.csv",index=False)
    summary=df.groupby("policy").agg(["mean","std"])
    summary.to_csv(out/"policy_summary.csv")
    pd.DataFrame(transitions).to_csv(out/"evaluation_transitions.csv",index=False)
    return {"metrics":df,"summary":summary,"world_model":world_model_metrics,"output_dir":out.resolve()}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--episodes",type=int,default=30)
    parser.add_argument("--world-model-episodes",type=int,default=30)
    parser.add_argument("--horizon",type=int,default=96)
    parser.add_argument("--seed",type=int,default=42)
    parser.add_argument("--out-dir",default="outputs/simulation")
    args=parser.parse_args()
    try:
        result=run_experiment(args.episodes,args.world_model_episodes,args.horizon,args.seed,args.out_dir)
    except ValueError as error:
        parser.error(str(error))
    summary=result["summary"]
    print(f"Saved experiment outputs to {result['output_dir']}")
    print(summary.to_string())
    print(f"Calibration episodes: {args.world_model_episodes}; evaluation episodes: {args.episodes}")
    print(f"Shared recurrent world-model held-out MAE (simulated data): {result['world_model']['held_out_episode_mae']:.5f}")
    print("The full-Gaia policy is a model-guided rule-based prototype, not trained MAPPO/LACD.")
if __name__=="__main__": main()
