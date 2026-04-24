from __future__ import annotations

from api.auth.middleware import _RateLimiter


def test_rate_limiter_sweeps_expired_keys(monkeypatch) -> None:
    current_time = 1000.0
    limiter = _RateLimiter(max_requests=2, window_seconds=60)

    monkeypatch.setattr(
        "api.auth.middleware._time.monotonic",
        lambda: current_time,
    )
    for index in range(50):
        assert limiter.check(f"ip:{index}") is True
    assert limiter.key_count == 50

    current_time = 1061.0
    assert limiter.check("ip:new") is True

    assert limiter.key_count == 1
