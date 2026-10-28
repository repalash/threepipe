"""NumPy reference of the MotionBricks G1 engine encode/decode, used to validate the JS port."""
import numpy as np, onnxruntime as ort, time
from scipy.spatial.transform import Rotation as R

FILT = np.array([-0.0465, 0.0639, 0.2827, 0.3998, 0.2827, 0.0639, -0.0465], np.float32)

def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return np.array([aw*bx+ax*bw+ay*bz-az*by, aw*by-ax*bz+ay*bw+az*bx, aw*bz+ax*by-ay*bx+az*bw, aw*bw-ax*bx-ay*by-az*bz])
def qinv(q): return np.array([-q[0], -q[1], -q[2], q[3]])
def qrot(q, v): return R.from_quat(q).apply(v)
def qz(angle): return np.array([0, 0, np.sin(angle/2), np.cos(angle/2)])
def norm(q): return q/np.linalg.norm(q)

def load_csv(path):
    d = np.loadtxt(path, delimiter=',', skiprows=1, ndmin=2)
    q = np.empty((len(d), 36), np.float32)
    q[:, :3] = d[:, 1:4]*0.01
    q[:, 3:7] = R.from_euler('xyz', d[:, 4:7], degrees=True).as_quat()
    q[:, 7:] = np.deg2rad(d[:, 7:])
    return q[::4]  # 120 Hz -> 30 Hz

def slerp_id(q, t):
    if q[3] < 0: q = -q
    return R.from_rotvec(R.from_quat(q).as_rotvec()*t).as_quat()

def fade(v):
    t = np.clip(v, 0, 1); r = 1-t
    return np.where(t < .5, 1-2*t*t, 2*r*r)

class Engine:
    def __init__(self, path, providers=("CPUExecutionProvider",)):
        so = ort.SessionOptions(); so.intra_op_num_threads = 4
        self.s = ort.InferenceSession(path, so, providers=list(providers))
    def generate(self, context, target, tokens=range(8, 15), correct=True):
        context = np.asarray(context, np.float32); target = np.asarray(target, np.float32)
        nt = len(target); target = np.concatenate([target, np.repeat(target[-1:], 4-nt, 0)])
        last = context[3]; fwd = qrot(norm(last[3:7]), [1, 0, 0]); ang = np.arctan2(fwd[1], fwd[0])
        ap = np.array([last[0], last[1], 0.]); aq = qz(ang)
        def enc(tok):
            out = tok.copy()
            for i in range(4):
                p = qrot(qinv(aq), tok[i, :3]-ap); out[i, 0:2] = p[:2]
                out[i, 3:7] = norm(qmul(qinv(aq), norm(tok[i, 3:7])))
            return out
        has = np.array([[1 if i < 4+nt else 0 for i in range(8)]], np.int32)
        hlr = has.copy(); hlr[0, 3] = 0; hlr[0, 4+nt-1] = 0
        allowed = np.array([[1 if 6+i in tokens else 0 for i in range(11)]], np.int32)
        feeds = dict(context_qpos=enc(context)[None], target_qpos=enc(target)[None], has_global_root_values=has,
                     has_local_root_values=hlr, has_local_poses=has, allowed_pred_num_tokens=allowed)
        t0 = time.perf_counter(); pq, nt_, fc = self.s.run(["pred_qpos", "pred_num_tokens", "pred_foot_contacts"], feeds); dt = time.perf_counter()-t0
        pq = pq[0]; n = int(nt_[0]); raw = n*4; fcount = raw-6
        out = np.empty((fcount, 36), np.float32)
        for f in range(fcount):
            rf = f+3; pos = np.zeros(3)
            for t in range(7): pos += FILT[t]*pq[np.clip(rf+t-3, 0, raw-1), :3]
            wp_ = qrot(aq, pos)+ap; out[f, :3] = [wp_[0], wp_[1], pos[2]]
            out[f, 3:7] = norm(qmul(aq, norm(pq[rf, 3:7]))); out[f, 7:] = pq[rf, 7:]
        if not correct: return out, fc[0, 3:3+fcount], n, dt, pq[:raw]
        # endpoint correction
        d0p = context[3, :3]-out[0, :3]; d0q = norm(qmul(qinv(out[0, 3:7]), norm(context[3, 3:7])))
        d1p = target[0, :3]-out[-1, :3]; d1q = norm(qmul(qinv(out[-1, 3:7]), norm(target[0, 3:7])))
        a0 = context[3, 7:]-out[0, 7:]; a1 = target[0, 7:]-out[-1, 7:]
        ff = min(0.3*30, 0.5*(fcount-1))
        for f in range(fcount):
            w = f/(fcount-1); sw = 1-w
            out[f, 3:7] = norm(qmul(qmul(out[f, 3:7], slerp_id(d0q, sw)), slerp_id(d1q, w)))
            out[f, :3] = out[f, :3]+d0p*sw+d1p*w
            out[f, 7:] += a0*fade(f/ff)+a1*fade((fcount-1-f)/ff)
        return out, fc[0, 3:3+fcount], n, dt, pq[:raw]
