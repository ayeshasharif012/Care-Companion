"""
Latency profiling helpers — p50 / p95 / p99 per pipeline stage.
"""
from __future__ import annotations

import json
import statistics
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional


def percentile(values: List[float], p: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    sorted_v = sorted(values)
    k = (len(sorted_v) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(sorted_v) - 1)
    if f == c:
        return sorted_v[f]
    return sorted_v[f] + (sorted_v[c] - sorted_v[f]) * (k - f)


@dataclass
class LatencyTracker:
    """Collect timings per stage across many turns."""

    stages: Dict[str, List[float]] = field(default_factory=dict)
    totals: List[float] = field(default_factory=list)
    _turn_start: Optional[float] = field(default=None, repr=False)
    _active: Dict[str, float] = field(default_factory=dict, repr=False)

    def start_turn(self):
        self._turn_start = time.perf_counter()

    def end_turn(self):
        if self._turn_start is not None:
            self.totals.append((time.perf_counter() - self._turn_start) * 1000)
            self._turn_start = None

    @contextmanager
    def stage(self, name: str):
        t0 = time.perf_counter()
        try:
            yield
        finally:
            ms = (time.perf_counter() - t0) * 1000
            self.stages.setdefault(name, []).append(ms)

    def record(self, name: str, ms: float):
        self.stages.setdefault(name, []).append(ms)

    def summary(self) -> dict:
        out = {"stages": {}, "total_ms": {}}
        for name, vals in self.stages.items():
            out["stages"][name] = {
                "count": len(vals),
                "min_ms": round(min(vals), 1),
                "p50_ms": round(percentile(vals, 50), 1),
                "p95_ms": round(percentile(vals, 95), 1),
                "p99_ms": round(percentile(vals, 99), 1),
                "max_ms": round(max(vals), 1),
                "mean_ms": round(statistics.mean(vals), 1),
            }
        if self.totals:
            out["total_ms"] = {
                "count": len(self.totals),
                "p50_ms": round(percentile(self.totals, 50), 1),
                "p95_ms": round(percentile(self.totals, 95), 1),
                "p99_ms": round(percentile(self.totals, 99), 1),
                "mean_ms": round(statistics.mean(self.totals), 1),
            }
        return out

    def print_report(self, title: str = "Latency Report"):
        s = self.summary()
        print("\n" + "=" * 62)
        print(f"  {title}")
        print("=" * 62)
        if s.get("total_ms"):
            t = s["total_ms"]
            print(
                f"  END-TO-END  p50={t['p50_ms']}ms  "
                f"p95={t['p95_ms']}ms  p99={t['p99_ms']}ms  mean={t['mean_ms']}ms"
            )
            print("-" * 62)
        rows = sorted(s.get("stages", {}).items(), key=lambda x: x[1]["p95_ms"], reverse=True)
        print(f"  {'STAGE':<22} {'p50':>8} {'p95':>8} {'p99':>8} {'mean':>8}")
        print("-" * 62)
        for name, stats in rows:
            print(
                f"  {name:<22} {stats['p50_ms']:>7.0f}ms "
                f"{stats['p95_ms']:>7.0f}ms {stats['p99_ms']:>7.0f}ms "
                f"{stats['mean_ms']:>7.0f}ms"
            )
        print("=" * 62 + "\n")

    def save_json(self, path: str | Path):
        Path(path).write_text(json.dumps(self.summary(), indent=2), encoding="utf-8")


# Global tracker for instrumented modules (set by profile script)
ACTIVE: Optional[LatencyTracker] = None


@contextmanager
def track(name: str):
    """No-op if no ACTIVE tracker."""
    if ACTIVE is None:
        yield
        return
    with ACTIVE.stage(name):
        yield
