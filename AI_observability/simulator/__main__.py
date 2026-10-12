from __future__ import annotations

import argparse
import json
import threading
import time

from dotenv import load_dotenv

from backend.app.config import Settings, load_settings
from backend.app.providers.data_platform import LocalDataPlatformProvider
from simulator.synthetic_live import (
    FailureScenario,
    SimulationOrchestrator,
)


def parse_args(settings: Settings) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run synthetic motor-insurance data pipelines.")
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument("--batch-size", type=int, default=settings.simulator_batch_size)
    parser.add_argument("--interval-seconds", type=float, default=settings.simulator_interval_seconds)
    parser.add_argument("--cycles", type=int, default=0, help="0 runs until interrupted.")
    parser.add_argument(
        "--failure",
        action="append",
        choices=[scenario.value for scenario in FailureScenario],
        default=[],
        help="Enable a deterministic failure scenario; repeat to enable multiple.",
    )
    return parser.parse_args()


def main() -> None:
    load_dotenv()
    settings = load_settings()
    args = parse_args(settings)
    if args.cycles < 0:
        raise ValueError("--cycles must be zero or a positive integer.")
    provider = LocalDataPlatformProvider(settings.local_data_path)
    simulator = SimulationOrchestrator(
        seed=args.seed,
        batch_size=args.batch_size,
        interval_seconds=args.interval_seconds,
        provider=provider,
    )
    for failure in args.failure:
        simulator.inject_failure(failure)

    stop_event = threading.Event()
    completed = 0
    next_cycle_at = time.monotonic()
    try:
        while not stop_event.is_set() and (args.cycles == 0 or completed < args.cycles):
            result = simulator.run_cycle()
            print(json.dumps(result.summary(), sort_keys=True), flush=True)
            completed += 1
            if args.cycles == 0 or completed < args.cycles:
                next_cycle_at += args.interval_seconds
                stop_event.wait(max(0.0, next_cycle_at - time.monotonic()))
    except KeyboardInterrupt:
        stop_event.set()
    finally:
        provider.close()


if __name__ == "__main__":
    main()
