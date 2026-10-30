"""Pack the MotionBricks G1 model for phones: its weights stay 8-bit in memory, not only in the file.

The pack from pack_model.py is expanded back to fp32 before the session is created, which peaks near 1.5 GB in a
browser. This one keeps the matrix weights as MatMulNBits (8-bit, blocks of 64, fp32 activations) and the
convolution weights as int8 behind DequantizeLinear, with every weight in ONNX external data. In onnxruntime-web
the session settles near 0.5 GB, and the motion matches pack_model.py's (about 2 degrees from fp32 on average).
Generation is slower on one thread (about 0.8 s against 0.5 s), so use it where memory is short.

  pip install onnx onnxruntime numpy
  python pack_lite.py mmm_v6_g1_fp32.onnx lite/

Writes lite/graph.onnx, lite/weights.NNN (parts of at most --shard-mb), and lite/pack.json for
MotionBricksG1.LoadPacked.
"""
import argparse, collections, json, os, sys, tempfile
import numpy as np
import onnx
from onnx import numpy_helper, helper, TensorProto

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pack_model import fold_double_constants


def fold_weight_transposes(m):
    """Transpose(weight) becomes a transposed weight, so the quantizer sees MatMul(x, constant)."""
    inits = {t.name: t for t in m.graph.initializer}
    uses = collections.Counter(i for n in m.graph.node for i in n.input)
    keep, folded = [], 0
    for n in m.graph.node:
        if n.op_type == 'Transpose' and n.input[0] in inits and uses[n.input[0]] == 1:
            w = numpy_helper.to_array(inits[n.input[0]])
            perm = next((list(a.ints) for a in n.attribute if a.name == 'perm'), list(range(w.ndim))[::-1])
            m.graph.initializer.remove(inits[n.input[0]])
            m.graph.initializer.append(numpy_helper.from_array(np.ascontiguousarray(w.transpose(perm)), n.output[0]))
            folded += 1
        else:
            keep.append(n)
    del m.graph.node[:]
    m.graph.node.extend(keep)
    return folded


def gemm_to_matmul(m):
    """Gemm(A, B, C) with a constant B becomes MatMul + Add, which the weight-only quantizer handles."""
    inits = {t.name: t for t in m.graph.initializer}
    uses = collections.Counter(i for n in m.graph.node for i in n.input)
    keep, count = [], 0
    for n in m.graph.node:
        a = {x.name: helper.get_attribute_value(x) for x in n.attribute}
        if n.op_type != 'Gemm' or n.input[1] not in inits or a.get('transA', 0) or a.get('alpha', 1.0) != 1.0 or a.get('beta', 1.0) != 1.0:
            keep.append(n)
            continue
        b = numpy_helper.to_array(inits[n.input[1]])
        if a.get('transB', 0):
            b = np.ascontiguousarray(b.T)
        name = n.input[1] + '_mm'
        m.graph.initializer.append(numpy_helper.from_array(b, name))
        if uses[n.input[1]] == 1:
            m.graph.initializer.remove(inits[n.input[1]])
        if len(n.input) > 2 and n.input[2]:
            mid = n.output[0] + '_mm'
            keep.append(helper.make_node('MatMul', [n.input[0], name], [mid], name=n.name + '_mm'))
            keep.append(helper.make_node('Add', [mid, n.input[2]], [n.output[0]], name=n.name + '_add'))
        else:
            keep.append(helper.make_node('MatMul', [n.input[0], name], [n.output[0]], name=n.name + '_mm'))
        count += 1
    del m.graph.node[:]
    m.graph.node.extend(keep)
    return count


def quantize_conv_weights(m):
    """Conv weights become int8 with a scale per output channel, behind DequantizeLinear."""
    inits = {t.name: t for t in m.graph.initializer}
    uses = collections.Counter(i for n in m.graph.node for i in n.input)
    nodes, count = [], 0
    for n in m.graph.node:
        w_name = n.input[1] if n.op_type == 'Conv' and len(n.input) > 1 else None
        if w_name in inits and uses[w_name] == 1 and inits[w_name].data_type == TensorProto.FLOAT:
            w = numpy_helper.to_array(inits[w_name])
            scale = np.abs(w.reshape(w.shape[0], -1)).max(axis=1) / 127
            scale[scale == 0] = 1
            q = np.clip(np.round(w / scale.reshape(-1, *([1] * (w.ndim - 1)))), -127, 127).astype(np.int8)
            m.graph.initializer.remove(inits[w_name])
            m.graph.initializer.extend([
                numpy_helper.from_array(q, w_name + '_q'),
                numpy_helper.from_array(scale.astype(np.float32), w_name + '_scale'),
                numpy_helper.from_array(np.zeros(w.shape[0], np.int8), w_name + '_zero'),
            ])
            nodes.append(helper.make_node('DequantizeLinear', [w_name + '_q', w_name + '_scale', w_name + '_zero'], [w_name], axis=0, name=w_name + '_dq'))
            count += 1
        nodes.append(n)
    del m.graph.node[:]
    m.graph.node.extend(nodes)
    return count


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--shard-mb', type=float, default=14)
    ap.add_argument('--block', type=int, default=64)
    args = ap.parse_args()
    from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer, DefaultWeightOnlyQuantConfig

    m = onnx.load(args.src)
    print('double constants folded:', fold_double_constants(m.graph))
    print('weight transposes folded:', fold_weight_transposes(m))
    print('Gemm to MatMul:', gemm_to_matmul(m))
    cfg = DefaultWeightOnlyQuantConfig(block_size=args.block, is_symmetric=True, bits=8, accuracy_level=0)
    q = MatMulNBitsQuantizer(m, bits=8, block_size=args.block, is_symmetric=True, algo_config=cfg)
    q.process()
    m = q.model.model
    print('MatMulNBits:', sum(1 for n in m.graph.node if n.op_type == 'MatMulNBits'))
    print('Conv weights to int8:', quantize_conv_weights(m))

    os.makedirs(args.out, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        onnx.save(m, os.path.join(tmp, 'graph.onnx'), save_as_external_data=True, all_tensors_to_one_file=True, location='weights.data', size_threshold=1024)
        graph = open(os.path.join(tmp, 'graph.onnx'), 'rb').read()
        data = open(os.path.join(tmp, 'weights.data'), 'rb').read()
    open(os.path.join(args.out, 'graph.onnx'), 'wb').write(graph)
    shard = int(args.shard_mb * 1024 * 1024)
    shards = []
    for i in range(0, len(data), shard):
        name = f'weights.{len(shards):03d}'
        open(os.path.join(args.out, name), 'wb').write(data[i:i + shard])
        shards.append(name)
    manifest = {'format': 'motionbricks-external', 'graph': 'graph.onnx', 'weights': 'weights.data', 'bytes': len(data), 'shardBytes': shard, 'shards': shards}
    json.dump(manifest, open(os.path.join(args.out, 'pack.json'), 'w'), indent=1)
    print(f'{args.out}: graph {len(graph) / 1e6:.1f} MB, weights {len(data) / 1e6:.1f} MB in {len(shards)} parts')


if __name__ == '__main__':
    main()
