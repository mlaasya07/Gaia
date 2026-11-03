"""Gaia LACD: four-agent cooperative learning with real-dataset context.

Four decentralized actors:
1. Scheduling
2. Maintenance
3. Energy
4. Monitoring / edge-cloud

Agents exchange learned attention messages.
A shared critic evaluates the team.
The existing GRU World Model provides temporal predictions.

Important:
The real datasets condition the agent observations.
The policy is trained using FactorySim rewards, not real factory
action-reward trajectories. This is a research prototype, not MAPPO.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch import nn
from torch.distributions import Bernoulli, Beta
import torch.nn.functional as F

from .simulator import FactorySim
from .world_model import load_shared_world_model
from .agents import (
    act_centralized,
    act_independent,
    act_lacd_prototype,
)


AGENTS = (
    "scheduling",
    "maintenance",
    "energy",
    "monitoring_edge_cloud",
)

STATE_DIM = 7
EVIDENCE_DIM = 4
LOCAL_DIM = 8 + EVIDENCE_DIM
CRITIC_DIM = STATE_DIM + 5 + len(AGENTS) * EVIDENCE_DIM


# ---------------------------------------------------------
# Shared LACD policy
# ---------------------------------------------------------

class LACDPolicy(nn.Module):

    def __init__(self, hidden=64, heads=4):
        super().__init__()

        self.encoders = nn.ModuleList([
            nn.Sequential(
                nn.Linear(LOCAL_DIM, hidden),
                nn.Tanh(),
                nn.Linear(hidden, hidden),
                nn.Tanh(),
            )
            for _ in AGENTS
        ])

        self.communication = nn.MultiheadAttention(
            hidden,
            heads,
            batch_first=True,
        )

        self.message_gate = nn.Sequential(
            nn.Linear(hidden * 2, hidden),
            nn.Sigmoid(),
        )

        self.actors = nn.ModuleList([
            nn.Sequential(
                nn.Linear(hidden, hidden),
                nn.Tanh(),
                nn.Linear(hidden, 2),
            )
            for _ in AGENTS
        ])

        self.critic = nn.Sequential(
            nn.Linear(CRITIC_DIM, hidden),
            nn.Tanh(),
            nn.Linear(hidden, hidden),
            nn.Tanh(),
            nn.Linear(hidden, 1),
        )

    def forward(self, local_obs, critic_obs):

        tokens = torch.stack(
            [
                self.encoders[i](local_obs[:, i])
                for i in range(len(AGENTS))
            ],
            dim=1,
        )

        messages, weights = self.communication(
            tokens,
            tokens,
            tokens,
            need_weights=True,
            average_attn_weights=False,
        )

        gate = self.message_gate(
            torch.cat([tokens, messages], dim=-1)
        )

        collaborated = tokens + gate * messages

        params = [
            self.actors[i](collaborated[:, i])
            for i in range(len(AGENTS))
        ]

        value = self.critic(critic_obs).squeeze(-1)

        return params, value, weights

    def sample(self, local_obs, critic_obs, deterministic=False):

        params, value, weights = self.forward(
            local_obs,
            critic_obs,
        )

        dists = [
            Beta(
                F.softplus(params[0][:, 0]) + 1.1,
                F.softplus(params[0][:, 1]) + 1.1,
            ),
            Bernoulli(logits=params[1][:, 0]),
            Bernoulli(logits=params[2][:, 0]),
            Bernoulli(logits=params[3][:, 0]),
        ]

        actions = []
        logps = []
        entropies = []

        for i, dist in enumerate(dists):

            if deterministic:
                action = (
                    (dist.mean >= 0.5).float()
                    if i > 0
                    else dist.mean
                )
            else:
                action = dist.sample()

            actions.append(action)
            logps.append(dist.log_prob(action))
            entropies.append(dist.entropy())

        action = torch.stack(actions, dim=-1)
        logp = torch.stack(logps, dim=-1).sum(-1)
        entropy = torch.stack(entropies, dim=-1).sum(-1)

        return action, logp, entropy, value, weights


# ---------------------------------------------------------
# Load the five-dataset evidence
# ---------------------------------------------------------

def load_dataset_evidence(path):

    df = pd.read_csv(path)

    required = {"dataset", "signal", "value"}

    if not required.issubset(df.columns):
        raise ValueError(
            f"Evidence CSV must contain {sorted(required)}"
        )

    def get_value(dataset, signal, default=0.0):

        rows = df[
            (df["dataset"] == dataset)
            & (df["signal"] == signal)
        ]

        if rows.empty:
            return float(default)

        try:
            return float(rows.iloc[0]["value"])
        except (ValueError, TypeError):
            return float(default)

    def bounded_count(value):

        return float(
            np.clip(
                np.log1p(max(0.0, value)) / 10.0,
                0.0,
                1.0,
            )
        )

    # Scheduling: Future Factories + semiconductor metadata

    assembly_rows = df[
        (df["dataset"] == "Future Factories")
        & (
            df["signal"]
            == "predicted_assembly_description_counts"
        )
    ]

    assembly_class_count = 0

    if not assembly_rows.empty:
        try:
            assembly_class_count = len(
                json.loads(str(assembly_rows.iloc[0]["value"]))
            )
        except (ValueError, TypeError):
            assembly_class_count = 0

    scheduling = [
        np.clip(
            get_value(
                "Future Factories",
                "mean_prediction_confidence",
            ),
            0,
            1,
        ),
        bounded_count(assembly_class_count),
        bounded_count(
            get_value(
                "Semiconductor metadata",
                "machine_metadata_records",
            )
        ),
        bounded_count(
            get_value(
                "Semiconductor metadata",
                "process_step_metadata_records",
            )
        ),
    ]

    # Maintenance: ZeMA prediction confidence.
    # These are confidence values, NOT failure probabilities.

    maintenance = [
        np.clip(
            get_value(
                "ZeMA",
                f"{name}_mean_prediction_confidence",
            ),
            0,
            1,
        )
        for name in (
            "cooler_condition",
            "valve_condition",
            "pump_leakage",
            "accumulator_pressure",
        )
    ]

    # Energy: HIPE power forecast evidence.

    mean_kw = max(
        0.0,
        get_value("HIPE", "mean_predicted_next_minute_power"),
    )

    p95_kw = max(
        0.0,
        get_value("HIPE", "p95_predicted_next_minute_power"),
    )

    energy = [
        bounded_count(mean_kw),
        bounded_count(p95_kw),
        float(
            np.clip(
                p95_kw / max(mean_kw, 1e-6),
                0,
                10,
            ) / 10.0
        ),
        0.0,
    ]

    # Monitoring: Smart Manufacturing anomaly screening.

    monitoring = [
        np.clip(
            get_value(
                "Smart Manufacturing",
                "screened_minute_fraction",
            ),
            0,
            1,
        ),
        bounded_count(
            get_value(
                "Smart Manufacturing",
                "screened_minute_count",
            )
        ),
        0.0,
        0.0,
    ]

    evidence = np.asarray(
        [
            scheduling,
            maintenance,
            energy,
            monitoring,
        ],
        dtype=np.float32,
    )

    if evidence.shape != (4, 4):
        raise ValueError("Expected four agents and four evidence features")

    if not np.isfinite(evidence).all():
        raise ValueError("Non-finite dataset evidence detected")

    return evidence


# ---------------------------------------------------------
# Build decentralized observations and shared critic input
# ---------------------------------------------------------

def make_features(state, forecast, evidence):

    s = np.asarray(state, dtype=np.float32)
    f = np.asarray(forecast, dtype=np.float32)

    shared = np.array(
        [
            f[0],
            f[1],
            f[2],
            f[3],
            f[5],
        ],
        dtype=np.float32,
    )

    views = [
        np.array(
            [s[1], s[4], s[0], *shared, *evidence[0]],
            dtype=np.float32,
        ),

        np.array(
            [s[0], s[1], s[4], *shared, *evidence[1]],
            dtype=np.float32,
        ),

        np.array(
            [s[2], s[3], s[1], *shared, *evidence[2]],
            dtype=np.float32,
        ),

        np.array(
            [s[5], s[0], s[3], *shared, *evidence[3]],
            dtype=np.float32,
        ),
    ]

    return np.stack(views)


def critic_features(state, forecast, evidence):

    return np.concatenate(
        [
            np.asarray(state, dtype=np.float32),
            np.asarray(forecast, dtype=np.float32)[:5],
            np.asarray(evidence, dtype=np.float32).reshape(-1),
        ]
    )


# ---------------------------------------------------------
# Shared GRU World Model prediction
# ---------------------------------------------------------

def predict_history(model, norm, states, actions):

    if not states:
        return np.zeros(7, dtype=np.float32)

    states_array = np.asarray(
        states[-32:],
        dtype=np.float32,
    )

    actions_array = np.asarray(
        actions[-32:],
        dtype=np.float32,
    )

    sx = (
        states_array - norm["state_mean"]
    ) / norm["state_scale"]

    ax = (
        actions_array - norm["action_mean"]
    ) / norm["action_scale"]

    with torch.no_grad():

        prediction = model(
            torch.tensor(sx[None]),
            torch.tensor(ax[None]),
        ).numpy()[0, -1]

    return (
        prediction * norm["state_scale"]
        + norm["state_mean"]
    )


# ---------------------------------------------------------
# Safety layer
# ---------------------------------------------------------

def safe_project(action, state):

    production = float(np.clip(action[0], 0.0, 1.0))
    maintenance = int(action[1] >= 0.5)
    shift = int(action[2] >= 0.5)
    cloud = int(action[3] >= 0.5)

    if float(state[0]) < 0.25:
        production = min(production, 0.25)
        maintenance = 1

    return {
        "production": production,
        "maintenance": maintenance,
        "shift": shift,
        "cloud": cloud,
    }


# ---------------------------------------------------------
# Training
# ---------------------------------------------------------

def train(args):

    device = torch.device(
        "cuda"
        if args.device == "auto" and torch.cuda.is_available()
        else (
            "cpu" if args.device == "auto" else args.device
        )
    )

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    wm, norm = load_shared_world_model(args.world_model)
    wm.eval()

    evidence = load_dataset_evidence(args.dataset_evidence)

    print("\nDataset evidence loaded:")

    for i, agent in enumerate(AGENTS):
        print(agent, evidence[i].tolist())

    policy = LACDPolicy().to(device)

    optimizer = torch.optim.Adam(
        policy.parameters(),
        lr=args.lr,
    )

    output_dir = Path(args.out_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    training_log = []

    for episode in range(1, args.episodes + 1):

        env = FactorySim(
            seed=args.seed + episode,
            horizon=args.horizon,
        )

        state = env.reset().astype(np.float32)
        forecast = state.copy()

        states = []
        actions = []
        trajectory = []

        done = False

        while not done:

            local = torch.tensor(
                make_features(
                    state,
                    forecast,
                    evidence,
                )[None],
                dtype=torch.float32,
                device=device,
            )

            global_obs = torch.tensor(
                critic_features(
                    state,
                    forecast,
                    evidence,
                )[None],
                dtype=torch.float32,
                device=device,
            )

            action, logp, entropy, value, attention = policy.sample(
                local,
                global_obs,
            )

            action_np = action[0].detach().cpu().numpy()

            env_action = safe_project(action_np, state)

            next_state, reward, done, totals = env.step(
                env_action
            )

            trajectory.append(
                (
                    logp.squeeze(0),
                    entropy.squeeze(0),
                    value.squeeze(0),
                    float(reward),
                )
            )

            states.append(state.copy())

            actions.append(
                np.array(
                    [
                        env_action["production"],
                        env_action["maintenance"],
                        env_action["cloud"],
                        env_action["shift"],
                    ],
                    dtype=np.float32,
                )
            )

            forecast = predict_history(
                wm,
                norm,
                states,
                actions,
            )

            state = next_state.astype(np.float32)

        # Cooperative discounted team return.

        returns = []
        discounted_return = 0.0

        for _, _, _, reward in reversed(trajectory):

            discounted_return = (
                reward + args.gamma * discounted_return
            )

            returns.append(discounted_return)

        returns.reverse()

        returns_tensor = torch.tensor(
            returns,
            dtype=torch.float32,
            device=device,
        )

        values = torch.stack(
            [item[2] for item in trajectory]
        )

        logps = torch.stack(
            [item[0] for item in trajectory]
        )

        entropies = torch.stack(
            [item[1] for item in trajectory]
        )

        advantages = returns_tensor - values.detach()

        actor_loss = (
            -(logps * advantages).mean()
            - args.entropy * entropies.mean()
        )

        critic_loss = F.mse_loss(
            values,
            returns_tensor,
        )

        loss = (
            actor_loss
            + args.value_coef * critic_loss
        )

        optimizer.zero_grad()
        loss.backward()

        nn.utils.clip_grad_norm_(
            policy.parameters(),
            1.0,
        )

        optimizer.step()

        row = {
            "episode": episode,
            "mean_reward": float(
                env.total["reward"] / args.horizon
            ),
            "energy": float(
                env.total["energy"] / args.horizon
            ),
            "energy_cost": float(
                env.total["energy_cost"] / args.horizon
            ),
            "carbon": float(
                env.total["carbon"] / args.horizon
            ),
            "throughput": float(
                env.total["throughput"] / args.horizon
            ),
            "latency": float(
                env.total["latency"] / args.horizon
            ),
            "health_risk_proxy": float(
                1 - env.state.health
            ),
            "actor_loss": float(actor_loss.detach()),
            "critic_loss": float(critic_loss.detach()),
        }

        training_log.append(row)

        if (
            episode == 1
            or episode % 10 == 0
            or episode == args.episodes
        ):
            print(
                f"Episode {episode:04d}/{args.episodes} "
                f"reward={row['mean_reward']:.4f} "
                f"actor={row['actor_loss']:.4f} "
                f"critic={row['critic_loss']:.4f}"
            )

    pd.DataFrame(training_log).to_csv(
        output_dir / "lacd_training_log.csv",
        index=False,
    )

    torch.save(
        {
            "model_state_dict": policy.state_dict(),
            "algorithm": "LACD cooperative policy-gradient prototype",
            "agents": list(AGENTS),
            "world_model": str(args.world_model),
            "seed": args.seed,
            "episodes": args.episodes,
            "horizon": args.horizon,
            "dataset_evidence": str(args.dataset_evidence),
            "input_design": (
                "Four role-specific real-dataset evidence vectors "
                "appended to decentralized actor observations "
                "and shared critic context."
            ),
            "note": (
                "Dataset-conditioned LACD trained on FactorySim "
                "rewards. Real datasets condition agent observations; "
                "they do not provide paired factory actions/rewards "
                "and do not train the GRU dynamics model."
            ),
        },
        output_dir / "lacd_policy.pt",
    )

    print("\nSaved:", output_dir / "lacd_policy.pt")
    print("Training log:", output_dir / "lacd_training_log.csv")


# ---------------------------------------------------------
# Evaluation
# ---------------------------------------------------------

def evaluate(args):

    device = torch.device(
        "cuda"
        if args.device == "auto" and torch.cuda.is_available()
        else (
            "cpu" if args.device == "auto" else args.device
        )
    )

    checkpoint = torch.load(
        args.policy,
        map_location=device,
        weights_only=False,
    )

    policy = LACDPolicy().to(device)

    policy.load_state_dict(
        checkpoint["model_state_dict"]
    )

    policy.eval()

    wm, norm = load_shared_world_model(args.world_model)
    wm.eval()

    evidence = load_dataset_evidence(args.dataset_evidence)

    rows = []

    baselines = {
        "B1_centralized": act_centralized,
        "B2_independent": act_independent,
        "B3_rule_based_coordination": act_lacd_prototype,
    }

    for episode in range(args.episodes):

        seed = args.seed + episode

        # Evaluate baselines with paired seeds.

        for name, baseline in baselines.items():

            env = FactorySim(
                seed=seed,
                horizon=args.horizon,
            )

            state = env.reset().astype(np.float32)
            done = False

            while not done:

                action = baseline(state)

                next_state, _, done, _ = env.step(action)

                state = next_state.astype(np.float32)

            rows.append(
                {
                    "seed": seed,
                    "policy": name,
                    "reward": env.total["reward"] / args.horizon,
                    "energy": env.total["energy"] / args.horizon,
                    "energy_cost": env.total["energy_cost"] / args.horizon,
                    "carbon": env.total["carbon"] / args.horizon,
                    "throughput": env.total["throughput"] / args.horizon,
                    "latency": env.total["latency"] / args.horizon,
                    "health_risk_proxy": 1 - env.state.health,
                }
            )

        # Evaluate learned LACD.

        env = FactorySim(
            seed=seed,
            horizon=args.horizon,
        )

        state = env.reset().astype(np.float32)
        forecast = state.copy()

        states = []
        actions = []

        done = False

        while not done:

            with torch.no_grad():

                local = torch.tensor(
                    make_features(
                        state,
                        forecast,
                        evidence,
                    )[None],
                    dtype=torch.float32,
                    device=device,
                )

                global_obs = torch.tensor(
                    critic_features(
                        state,
                        forecast,
                        evidence,
                    )[None],
                    dtype=torch.float32,
                    device=device,
                )

                action, _, _, _, _ = policy.sample(
                    local,
                    global_obs,
                    deterministic=True,
                )

            env_action = safe_project(
                action[0].cpu().numpy(),
                state,
            )

            next_state, _, done, _ = env.step(env_action)

            states.append(state.copy())

            actions.append(
                np.array(
                    [
                        env_action["production"],
                        env_action["maintenance"],
                        env_action["cloud"],
                        env_action["shift"],
                    ],
                    dtype=np.float32,
                )
            )

            forecast = predict_history(
                wm,
                norm,
                states,
                actions,
            )

            state = next_state.astype(np.float32)

        rows.append(
            {
                "seed": seed,
                "policy": "LACD_learned",
                "reward": env.total["reward"] / args.horizon,
                "energy": env.total["energy"] / args.horizon,
                "energy_cost": env.total["energy_cost"] / args.horizon,
                "carbon": env.total["carbon"] / args.horizon,
                "throughput": env.total["throughput"] / args.horizon,
                "latency": env.total["latency"] / args.horizon,
                "health_risk_proxy": 1 - env.state.health,
            }
        )

    df = pd.DataFrame(rows)

    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)

    df.to_csv(output, index=False)

    summary = df.groupby("policy").agg(["mean", "std"])

    summary.to_csv(
        output.with_name(output.stem + "_summary.csv")
    )

    print(summary.to_string())

    print("\nSaved paired episode metrics:", output)

    print(
        "Saved policy summary:",
        output.with_name(output.stem + "_summary.csv"),
    )


# ---------------------------------------------------------
# Command-line interface
# ---------------------------------------------------------

def main():

    parser = argparse.ArgumentParser(
        description="Gaia LACD real-dataset-conditioned learning"
    )

    sub = parser.add_subparsers(
        dest="cmd",
        required=True,
    )

    train_parser = sub.add_parser("train")

    train_parser.add_argument(
        "--world-model",
        default="outputs/simulation/shared_world_model.pt",
    )

    train_parser.add_argument(
        "--dataset-evidence",
        default="outputs/dataset_integration/agent_evidence.csv",
    )

    train_parser.add_argument(
        "--out-dir",
        default="outputs/lacd_learning_realdata",
    )

    train_parser.add_argument(
        "--episodes",
        type=int,
        default=500,
    )

    train_parser.add_argument(
        "--horizon",
        type=int,
        default=96,
    )

    train_parser.add_argument(
        "--seed",
        type=int,
        default=123,
    )

    train_parser.add_argument(
        "--lr",
        type=float,
        default=2e-4,
    )

    train_parser.add_argument(
        "--gamma",
        type=float,
        default=0.97,
    )

    train_parser.add_argument(
        "--entropy",
        type=float,
        default=0.01,
    )

    train_parser.add_argument(
        "--value-coef",
        type=float,
        default=0.5,
    )

    train_parser.add_argument(
        "--device",
        choices=["auto", "cpu", "cuda"],
        default="auto",
    )

    train_parser.set_defaults(func=train)

    eval_parser = sub.add_parser("evaluate")

    eval_parser.add_argument(
        "--policy",
        default="outputs/lacd_learning_realdata/lacd_policy.pt",
    )

    eval_parser.add_argument(
        "--world-model",
        default="outputs/simulation/shared_world_model.pt",
    )

    eval_parser.add_argument(
        "--dataset-evidence",
        default="outputs/dataset_integration/agent_evidence.csv",
    )

    eval_parser.add_argument(
        "--episodes",
        type=int,
        default=30,
    )

    eval_parser.add_argument(
        "--horizon",
        type=int,
        default=96,
    )

    eval_parser.add_argument(
        "--seed",
        type=int,
        default=9000,
    )

    eval_parser.add_argument(
        "--out",
        default="outputs/lacd_learning_realdata/evaluation.csv",
    )

    eval_parser.add_argument(
        "--device",
        choices=["auto", "cpu", "cuda"],
        default="auto",
    )

    eval_parser.set_defaults(func=evaluate)

    args = parser.parse_args()

    args.func(args)


if __name__ == "__main__":
    main()