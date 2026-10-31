"""A SOMA stride cycle for src/SOMABricks.ts from a recording of the controller (JSON {rec: [...]} of SOMA poses at
60 Hz): the steady stride whose end joins its start best, warped so the other foot passes at half the stride. The
shipped strides took two rounds: a recording without cycles, then one with the first round's cycles.

Averaging a stride with its mirror image (MIRROR=1) makes it exactly symmetric, but blending SOMA's joint rotations
lifts or sinks the feet by centimetres, which the model then follows; the warped stride alone is used.

    python make_soma_cycles.py soma_skeleton.json recording.json frames out.json   (frames: 28 walk, 20 run)"""
import json, sys, numpy as np
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from motionbricks_soma_ref import Skeleton, qmul, qinv, qnorm, qrot, tmul, tinv, R
k = Skeleton(sys.argv[1])
feet = [(k.names.index('LeftFoot'), k.names.index('LeftToeBase')), (k.names.index('RightFoot'), k.names.index('RightToeBase'))]
def footfalls(q, skip):
    W = k.world(q)
    ev = []
    for side, (a, b) in enumerate(feet):
        low = np.minimum(W[:, a, 1], W[:, b, 1])
        pos = (W[:, a, :3] + W[:, b, :3]) / 2
        speed = np.r_[0, np.linalg.norm(np.diff(pos[:, [0, 2]], axis=0), axis=1) * 30]
        # Down: low and nearly still; a foot lands again only after a quarter second off the ground.
        down = (low < np.percentile(low, 10) + 0.04) & (speed < 0.8)
        last = -99
        for i in range(1, len(q)):
            if down[i] and not down[i - 1] and i > skip and i - last > 7:
                ev.append((i, side, pos[i, [0, 2]])); last = i
            if down[i]: last = max(last, i - 0)  # stays down: no new event until it lifts for a while
    ev.sort(key=lambda e: e[0])
    # Keep alternating feet only: of two landings of the same foot in a row, the first.
    alt = []
    for e in ev:
        if not alt or alt[-1][1] != e[1]: alt.append(e)
    return alt

SWAP = [k.names.index(n.replace('Left', 'Right')) if n.startswith('Left') else k.names.index(n.replace('Right', 'Left')) if n.startswith('Right') else i for i, n in enumerate(k.names)]
mq = lambda q: q * np.array([-1, -1, 1, 1.0])  # rotation reflected through the plane z = 0
REFW = k.world(k.ref[None])[0]
# F_j: the turn that maps the reflected rotation of j's counterpart onto j's own axes, from the reference pose.
FIX = np.array([qnorm(qmul(qinv(mq(REFW[SWAP[j], 3:])), REFW[j, 3:])) for j in range(k.J)])

def mirror(pose):
    W = k.world(pose)
    MW = np.empty_like(W)
    for j in range(k.J):
        s = W[SWAP[j]]
        MW[j, :3] = s[:3] * [1, 1, -1]
        MW[j, 3:] = qnorm(qmul(mq(s[3:]), FIX[j]))
    out = np.empty_like(pose)
    for j in range(k.J):
        p = k.parents[j]
        if p < 0: out[j] = MW[j]
        else: out[j] = [*pose[j, :3], *qnorm(qmul(qinv(MW[p, 3:]), MW[j, 3:]))]
    return out

def blend(a, b, t):
    out = a.copy()
    out[:, :3] = a[:, :3] * (1 - t) + b[:, :3] * t
    bq = np.where((a[:, 3:] * b[:, 3:]).sum(1, keepdims=True) < 0, -b[:, 3:], b[:, 3:])
    out[:, 3:] = qnorm(a[:, 3:] * (1 - t) + bq * t)
    return out

def heading_of(p):
    w = k.world(p); r, l = w[k.right_leg, :3], w[k.left_leg, :3]
    across = np.array([r[0] - l[0], 0, r[2] - l[2]]); across /= np.linalg.norm(across)
    f = np.cross([0, 1, 0], across); return np.arctan2(f[0], f[2])

if __name__ == '__main__':
    src, n, out = sys.argv[2], int(sys.argv[3]), sys.argv[4]
    q = np.array(json.load(open(src))['rec']).reshape(-1, k.J, 7)[::2]
    # Mirror check: the reference pose mirrors onto itself.
    print('mirror check on the reference pose: %.2e' % np.abs(k.world(mirror(k.ref))[:, :3] - REFW[:, :3]).max())
    ev = footfalls(q, 45)
    def gap(a, b): return sum(1 - (q[a, j, 3:] @ q[b, j, 3:]) ** 2 for j in k.model_to_pose[1:])
    cands = []
    for i, (a, side, _) in enumerate(ev):
        later = [e for e in ev[i + 1:] if e[1] == side]
        mids = [e for e in ev[i + 1:] if e[1] != side and (not later or e[0] < later[0][0])]
        if not later or len(mids) != 1 or later[0][0] > len(q) - 5: continue
        b, m = later[0][0], mids[0][0]
        cands.append((gap(a, b) + abs((m - a) / (b - a) - 0.5), a, m, b))
    _, a, m, b = min(cands)
    print(f'stride {a}..{b} ({b - a} frames), other foot at {m} (split {(m - a) / (b - a):.2f})')
    # Move the stride to the origin with its travel along +X.
    S = q[a:b + 1].copy()
    d = S[-1, 0, [0, 2]] - S[0, 0, [0, 2]]
    turn = R.from_rotvec([0, np.arctan2(d[1], d[0]), 0]).as_quat()  # +Y turn that brings (dx, dz) onto +X
    o = S[0, 0, :3].copy(); o[1] = 0
    for f in S:
        f[0, :3] = qrot(turn, f[0, :3] - o); f[0, 3:] = qnorm(qmul(turn, f[0, 3:]))
    travel = S[-1, 0, :3] - S[0, 0, :3]
    print('travel after turning', np.round(travel, 3))
    m0 = len(S) - 1
    def sample(t):  # fractional frame of the stride, continuing into the next ones
        kk, r = divmod(t, m0); i = int(r); f = r - i
        p = blend(S[i], S[min(i + 1, m0)], f); p[0, :3] += kk * travel * [1, 0, 1]
        return p
    h = n // 2; split = (m - a) / m0
    Wp = [sample((split * t / h if t < h else split + (1 - split) * (t - h) / h) * m0) for t in range(n + 1)]
    step = Wp[n][0, :3] - Wp[0][0, :3]
    def at(t):
        kk, r = divmod(t, n); p = Wp[r].copy(); p[0, :3] += kk * step * [1, 0, 1]; return p
    C = []
    for t in range(n):
        A = at(t); B = mirror(at(t + h)); B[0, :3] -= mirror(at(h))[0, :3] * [1, 0, 1]
        C.append(blend(A, B, 0.5))
    C = np.array(C); C[:, 0, 2] -= C[:, 0, 2].mean()
    if not os.environ.get('MIRROR'): C = np.array(Wp[:n])
    err = np.abs(k.world(mirror(C[h]))[:, :3] - k.world(C[0])[:, :3])
    err[:, 0] = 0  # travel along x differs by half a stride
    mirrored = f'; mirror error of half a stride {np.abs(err[:, 1:]).max() * 1000:.1f} mm' if os.environ.get('MIRROR') else ''
    print(f'cycle {n} frames ({n / 30:.2f} s), {step[0] / n * 30:.2f} m/s{mirrored}')
    json.dump({'travel': [round(float(step[0]), 5), 0.0], 'frames': C.reshape(n, -1).round(5).tolist()}, open(out, 'w'))
