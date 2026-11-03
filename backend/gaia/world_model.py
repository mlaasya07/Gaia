"""Compact shared-latent recurrent model for simulator next-state prediction."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch import nn


STATE_COLUMNS = [f"s{i}" for i in range(7)]
ACTION_COLUMNS = ["a_production", "a_maintenance", "a_cloud", "a_shift"]
TARGET_COLUMNS = [f"next_s{i}" for i in range(7)]
STATE_NAMES = ["health", "backlog", "energy_price", "carbon_intensity", "workload", "edge_load", "time_fraction"]


class SharedWorldModel(nn.Module):
    """Encode each shared factory state, then predict transitions with a GRU."""

    def __init__(self, state_size: int = 7, action_size: int = 4, latent_size: int = 24):
        super().__init__()
        self.encoder = nn.Sequential(nn.Linear(state_size, latent_size), nn.Tanh())
        self.dynamics = nn.GRU(latent_size + action_size, latent_size, batch_first=True)
        self.decoder = nn.Linear(latent_size, state_size)

    def forward(self, states: torch.Tensor, actions: torch.Tensor) -> torch.Tensor:
        latent = self.encoder(states)
        recurrent_input = torch.cat((latent, actions), dim=-1)
        hidden, _ = self.dynamics(recurrent_input)
        return self.decoder(hidden)


def _sequence_data(transitions: pd.DataFrame):
    sequences = {}
    for (episode, policy), rows in transitions.groupby(["episode", "policy"], sort=True):
        rows = rows.sort_values("s6")
        sequences[(int(episode), str(policy))] = (
            rows[STATE_COLUMNS].to_numpy(dtype=np.float32),
            rows[ACTION_COLUMNS].to_numpy(dtype=np.float32),
            rows[TARGET_COLUMNS].to_numpy(dtype=np.float32),
        )
    return sequences


def train_shared_world_model(
    transitions: pd.DataFrame,
    output_dir: str | Path,
    seed: int = 42,
    epochs: int = 80,
    patience: int = 10,
    latent_size: int = 24,
) -> dict:
    """Train and evaluate on separate whole episodes; never split transitions randomly."""
    if epochs < 1 or patience < 1:
        raise ValueError("epochs and patience must be positive.")
    sequences = _sequence_data(transitions)
    episodes = np.array(sorted(transitions["episode"].unique()), dtype=int)
    if len(episodes) < 10:
        raise ValueError("At least 10 episodes are required for held-out train/validation/test evaluation.")
    rng = np.random.default_rng(seed)
    shuffled = rng.permutation(episodes)
    test_count = max(1, int(round(len(episodes) * 0.15)))
    validation_count = max(1, int(round(len(episodes) * 0.15)))
    test_episodes = set(shuffled[:test_count].tolist())
    validation_episodes = set(shuffled[test_count:test_count + validation_count].tolist())
    train_episodes = set(shuffled[test_count + validation_count:].tolist())
    if not train_episodes:
        raise ValueError("Not enough episodes remain for training after held-out splits.")

    train_sequences = [value for (episode, _), value in sequences.items() if episode in train_episodes]
    validation_sequences = [value for (episode, _), value in sequences.items() if episode in validation_episodes]
    test_sequences = [value for (episode, _), value in sequences.items() if episode in test_episodes]
    state_mean = np.concatenate([sequence[0] for sequence in train_sequences], axis=0).mean(axis=0)
    state_scale = np.concatenate([sequence[0] for sequence in train_sequences], axis=0).std(axis=0)
    action_mean = np.concatenate([sequence[1] for sequence in train_sequences], axis=0).mean(axis=0)
    action_scale = np.concatenate([sequence[1] for sequence in train_sequences], axis=0).std(axis=0)
    state_scale = np.where(state_scale < 1e-6, 1.0, state_scale)
    action_scale = np.where(action_scale < 1e-6, 1.0, action_scale)

    def tensors(collection):
        states, actions, targets = zip(*collection)
        return (
            torch.tensor(np.stack([(x - state_mean) / state_scale for x in states]), dtype=torch.float32),
            torch.tensor(np.stack([(x - action_mean) / action_scale for x in actions]), dtype=torch.float32),
            torch.tensor(np.stack([(x - state_mean) / state_scale for x in targets]), dtype=torch.float32),
        )

    train_tensors = tensors(train_sequences)
    validation_tensors = tensors(validation_sequences)
    test_tensors = tensors(test_sequences)
    torch.manual_seed(seed)
    model = SharedWorldModel(latent_size=latent_size)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    loss_function = nn.MSELoss()
    best_state = None
    best_validation_loss = float("inf")
    stale_epochs = 0
    batch_size = min(12, len(train_sequences))

    for _ in range(epochs):
        model.train()
        order = torch.randperm(len(train_sequences))
        for start in range(0, len(order), batch_size):
            indexes = order[start:start + batch_size]
            prediction = model(train_tensors[0][indexes], train_tensors[1][indexes])
            loss = loss_function(prediction, train_tensors[2][indexes])
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
        model.eval()
        with torch.no_grad():
            validation_prediction = model(validation_tensors[0], validation_tensors[1])
            validation_loss = float(loss_function(validation_prediction, validation_tensors[2]))
        if validation_loss < best_validation_loss:
            best_validation_loss = validation_loss
            best_state = {key: value.detach().clone() for key, value in model.state_dict().items()}
            stale_epochs = 0
        else:
            stale_epochs += 1
            if stale_epochs >= patience:
                break

    if best_state is None:
        raise RuntimeError("World-model training did not produce a validation checkpoint.")
    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        test_prediction = model(test_tensors[0], test_tensors[1]).numpy()
    predicted = test_prediction * state_scale + state_mean
    actual = test_tensors[2].numpy() * state_scale + state_mean
    per_state_mae = np.abs(predicted - actual).mean(axis=(0, 1))
    result = {
        "architecture": "shared MLP state encoder + GRU recurrent dynamics + state decoder",
        "latent_size": latent_size,
        "training_source": "Gaia simulator rollouts only; not real factory observations",
        "sequence_count": {"train": len(train_sequences), "validation": len(validation_sequences), "test": len(test_sequences)},
        "episodes": {
            "train": sorted(int(value) for value in train_episodes),
            "validation": sorted(int(value) for value in validation_episodes),
            "test": sorted(int(value) for value in test_episodes),
        },
        "validation_normalized_mse": best_validation_loss,
        "held_out_episode_mae": float(np.abs(predicted - actual).mean()),
        "held_out_mae_by_state": {name: float(value) for name, value in zip(STATE_NAMES, per_state_mae)},
        "training_epochs": _ + 1,
        "warning": "This is a simulator-only world-model prototype; policies do not yet act on its predictions.",
    }
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    torch.save({
        "model_state_dict": model.state_dict(),
        "state_mean": torch.from_numpy(state_mean),
        "state_scale": torch.from_numpy(state_scale),
        "action_mean": torch.from_numpy(action_mean),
        "action_scale": torch.from_numpy(action_scale),
        "state_columns": STATE_COLUMNS,
        "action_columns": ACTION_COLUMNS,
        "target_columns": TARGET_COLUMNS,
        "latent_size": latent_size,
    }, output / "shared_world_model.pt")
    (output / "world_model_metadata.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def load_shared_world_model(checkpoint_path: str | Path):
    """Load a saved simulator predictor and the normalization fitted on its train split."""
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    model = SharedWorldModel(latent_size=int(checkpoint["latent_size"]))
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()
    normalization = {
        key: checkpoint[key].cpu().numpy().astype(np.float32)
        for key in ("state_mean", "state_scale", "action_mean", "action_scale")
    }
    return model, normalization


def predict_next_state(model: SharedWorldModel, normalization: dict, state, action) -> np.ndarray:
    """Predict one next state for candidate-action scoring in the simulator."""
    state = np.asarray(state, dtype=np.float32).reshape(1, 1, -1)
    action = np.asarray(action, dtype=np.float32).reshape(1, 1, -1)
    scaled_state = (state - normalization["state_mean"]) / normalization["state_scale"]
    scaled_action = (action - normalization["action_mean"]) / normalization["action_scale"]
    with torch.no_grad():
        prediction = model(torch.from_numpy(scaled_state), torch.from_numpy(scaled_action)).numpy()
    return prediction[0, 0] * normalization["state_scale"] + normalization["state_mean"]
