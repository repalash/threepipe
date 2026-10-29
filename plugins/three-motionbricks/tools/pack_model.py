"""Pack a MotionBricks ONNX model for the web.

Large float initializers move to external data and ship as int8 values with one
fp16 scale per block of 64 consecutive values. The browser dequantizes them back to fp32 and
hands them to ONNX Runtime as external data. The pack is split into shards that
fit common static-hosting file limits.

    python pack_model.py mmm_v6_g1_fp32.onnx out_dir [--shard-mb 14]
"""
import argparse, json, os
import numpy as np, onnx
from onnx import numpy_helper

BLOCK = 64
MIN_ELEMENTS = 4096
WEIGHTS_NAME = 'weights.f32'


def quantize(w):
    """Quantize the flattened tensor in blocks of BLOCK values, with the last block zero padded."""
    flat = w.reshape(-1).astype(np.float32)
    nblocks = -(-flat.size // BLOCK)
    x = np.zeros(nblocks * BLOCK, np.float32); x[:flat.size] = flat
    x = x.reshape(nblocks, BLOCK)
    scale = (np.abs(x).max(-1) / 127).astype(np.float16)
    s = scale.astype(np.float32); s[s == 0] = 1
    q = np.clip(np.round(x / s[:, None]), -127, 127).astype(np.int8)
    return q.reshape(-1), scale, flat.size, nblocks


def fold_double_constants(graph):
    """Store DOUBLE constants that are only cast to FLOAT as FLOAT, since the WebGPU build of
    ONNX Runtime Web has no CPU Cast kernel for DOUBLE."""
    consumers = {}
    for n in graph.node:
        for i in n.input: consumers.setdefault(i, []).append(n)
    folded = 0
    for n in graph.node:
        if n.op_type != 'Constant' or n.attribute[0].name != 'value' or n.attribute[0].t.data_type != onnx.TensorProto.DOUBLE:
            continue
        users = consumers.get(n.output[0], [])
        if users and all(u.op_type == 'Cast' and u.attribute[0].i == onnx.TensorProto.FLOAT for u in users):
            t = n.attribute[0].t
            n.attribute[0].t.CopyFrom(numpy_helper.from_array(numpy_helper.to_array(t).astype(np.float32), t.name))
            folded += 1
    return folded


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('model'); ap.add_argument('out'); ap.add_argument('--shard-mb', type=float, default=14)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    m = onnx.load(a.model)
    print('folded double constants:', fold_double_constants(m.graph))
    tensors, chunks, q_off, f_off = [], [], 0, 0
    for init in m.graph.initializer:
        if init.data_type != onnx.TensorProto.FLOAT or len(init.dims) < 2 or np.prod(init.dims) < MIN_ELEMENTS:
            continue
        w = numpy_helper.to_array(init)
        q, scale, n, nblocks = quantize(w)
        qb, sb = q.tobytes(), scale.tobytes()
        pad = (-(len(qb) + len(sb))) % 16
        chunks += [qb, sb, b'\0' * pad]
        tensors.append(dict(name=init.name, n=n, blocks=nblocks, q=q_off, s=q_off + len(qb), f=f_off))
        q_off += len(qb) + len(sb) + pad
        init.ClearField('raw_data'); init.ClearField('float_data')
        init.data_location = onnx.TensorProto.EXTERNAL
        del init.external_data[:]
        for k, v in (('location', WEIGHTS_NAME), ('offset', str(f_off * 4)), ('length', str(n * 4))):
            e = init.external_data.add(); e.key, e.value = k, v
        f_off += n + (-n) % 16
    graph = m.SerializeToString()
    open(os.path.join(a.out, 'graph.onnx'), 'wb').write(graph)
    blob = b''.join(chunks)
    size = int(a.shard_mb * 1024 * 1024)
    shards = []
    for i in range(0, len(blob), size):
        name = f'weights.q8.{len(shards):03d}'
        open(os.path.join(a.out, name), 'wb').write(blob[i:i + size]); shards.append(name)
    manifest = dict(format='motionbricks-q8', block=BLOCK, weights=WEIGHTS_NAME, f32Length=f_off,
                    q8Length=len(blob), shardBytes=size, shards=shards, tensors=tensors)
    json.dump(manifest, open(os.path.join(a.out, 'pack.json'), 'w'))
    print(f'graph {len(graph)/1e6:.1f} MB, q8 {len(blob)/1e6:.1f} MB in {len(shards)} shards, '
          f'{len(tensors)} tensors, f32 {f_off*4/1e6:.1f} MB')


if __name__ == '__main__':
    main()
