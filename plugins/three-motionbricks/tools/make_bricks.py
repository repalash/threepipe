"""Bake the G1Controller target poses with the MotionBricks G1 model.

Each gait is seeded with four frames of one of NVIDIA's sample clips, then the model walks or runs
toward that seed for several chained generations. The shipped poses are four frames of the model's
own steady-state output, so no clip frames ship with the example. The rest pose is the model's final
frame when it settles from the idle clip without endpoint correction.

    python make_bricks.py mmm_v6_g1_fp32.onnx clips_dir bricks.json
"""
import json, sys
import numpy as np
from motionbricks_ref import Engine, load_csv, norm, qmul, qrot, qz

LEAD = 1.0  # seconds of travel between the robot and its target, as in G1Controller
EARLY = 10  # frames before the end where the next generation takes over


def speed(frames):
    return np.linalg.norm(frames[-1, :2] - frames[0, :2]) * 30 / (len(frames) - 1)


def normalize(frames):
    """Move frames so the first sits at the ground origin and the travel (or facing) is +X."""
    d = frames[-1, :2] - frames[0, :2]
    h = np.arctan2(d[1], d[0]) if np.linalg.norm(d) > 0.02 else np.arctan2(*qrot(norm(frames[0, 3:7]), [1, 0, 0])[1::-1])
    q = qz(-h); out = frames.copy()
    for i in range(len(frames)):
        p = qrot(q, [frames[i, 0] - frames[0, 0], frames[i, 1] - frames[0, 1], 0])
        out[i, :2] = p[:2]; out[i, 3:7] = norm(qmul(q, frames[i, 3:7]))
    return out


def place(brick, x, y, h, v=None):
    b = brick.copy()
    if v is not None and speed(b) > 1e-3:
        b[:, :2] = (b[:, :2] - b[0, :2]) * v / speed(b) + b[0, :2]
    q = qz(h); out = b.copy()
    for i in range(len(b)):
        p = qrot(q, [b[i, 0], b[i, 1], 0]); out[i, 0] = p[0] + x; out[i, 1] = p[1] + y
        out[i, 3:7] = norm(qmul(q, b[i, 3:7]))
    return out


def chain(engine, start, brick, v, steps, turn=0.0):
    """Play `steps` chained generations toward the brick and return every played frame."""
    hist = list(start); played = []; h = 0.0
    for k in range(steps):
        c = np.array(hist[-4:])
        if k == steps // 2: h += turn
        o = engine.generate(c, place(brick, c[-1, 0] + np.cos(h) * v * LEAD, c[-1, 1] + np.sin(h) * v * LEAD, h, v))[0]
        for f in o[1:max(2, len(o) - EARLY)]: hist.append(f); played.append(f)
    return np.array(played)


def report(name, frames):
    sp = np.array([speed(frames[i:i + 4]) for i in range(len(frames) - 3)])
    print(f'{name}: {len(frames)} frames, root z mean {frames[:, 2].mean():.3f} min {frames[:, 2].min():.3f}, '
          f'speed mean {sp[len(sp) // 3:].mean():.2f} min {sp[len(sp) // 3:].min():.2f}')


def main():
    model, clips, out = sys.argv[1:4]
    engine = Engine(model)
    idle = load_csv(f'{clips}/idle_loop_001__A268.csv')
    start = idle[:4]
    bricks = {}
    rest = engine.generate(start, idle[:1], correct=False)[0]
    bricks['rest'] = normalize(rest[-1:])
    for gait, clip, k in (('walk', 'Neutral_walk_forward_002__A057.csv', 80), ('run', 'run_loop_180_R_003__A326.csv', 30)):
        frames = load_csv(f'{clips}/{clip}')
        seed = normalize(frames[k:k + 4]); v = speed(frames[k - 8:k + 12])
        played = chain(engine, start, seed, v, 8)
        report(f'{gait} seeded from clip at {v:.2f} m/s', played)
        brick = normalize(played[-24:-20])
        bricks[gait] = brick
        report(f'{gait} chained on its own output', chain(engine, start, brick, v, 12))
        report(f'{gait} with a 90 degree turn', chain(engine, start, brick, v, 10, np.pi / 2))
    json.dump({k: np.round(v, 5).tolist() for k, v in bricks.items()}, open(out, 'w'))


if __name__ == '__main__':
    main()
