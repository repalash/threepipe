"""
export_ground_truth.py — Evaluate geometry node modifiers and export the resulting
mesh data as JSON for comparison with the threepipe generator.

Usage:
  blender --background myfile.blend --python export_ground_truth.py -- \
    --output ./tests/ground_truth/ \
    --configs ./tests/test_configs.json

The test_configs.json should look like:
{
  "configs": [
    {
      "name": "default",
      "object": "Building",
      "modifier": "GeometryNodes",
      "inputs": {}
    },
    {
      "name": "tall_narrow",
      "object": "Building",
      "modifier": "GeometryNodes",
      "inputs": { "Input_2": 20, "Input_3": 5.0 }
    }
  ]
}

If no configs file is provided, exports the current state as "default".
"""

import bpy
import bmesh
import json
import sys
import os
import math
from mathutils import Vector, Matrix


def get_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []

    output_dir = "./tests/ground_truth"
    configs_path = None

    for i, arg in enumerate(argv):
        if arg == "--output" and i + 1 < len(argv):
            output_dir = argv[i + 1]
        elif arg == "--configs" and i + 1 < len(argv):
            configs_path = argv[i + 1]

    return output_dir, configs_path


def serialize_matrix(matrix):
    """Flatten a 4x4 matrix to a list of 16 floats (column-major for three.js compat)."""
    cols = []
    for col in range(4):
        for row in range(4):
            cols.append(matrix[row][col])
    return cols


def extract_mesh_data(obj, depsgraph):
    """Extract comprehensive mesh data from an evaluated object."""
    eval_obj = obj.evaluated_get(depsgraph)

    data = {
        "name": obj.name,
        "world_matrix": serialize_matrix(eval_obj.matrix_world),
        "location": list(eval_obj.location),
        "rotation_euler": list(eval_obj.rotation_euler),
        "scale": list(eval_obj.scale),
    }

    # Try to get mesh data
    try:
        mesh = eval_obj.to_mesh()
    except RuntimeError:
        data["error"] = "Could not convert to mesh"
        return data

    if mesh is None:
        data["error"] = "Mesh is None"
        return data

    # Basic stats
    data["vertex_count"] = len(mesh.vertices)
    data["face_count"] = len(mesh.polygons)
    data["edge_count"] = len(mesh.edges)

    # Bounding box
    if mesh.vertices:
        positions = [list(v.co) for v in mesh.vertices]
        xs = [p[0] for p in positions]
        ys = [p[1] for p in positions]
        zs = [p[2] for p in positions]
        data["bounding_box"] = {
            "min": [min(xs), min(ys), min(zs)],
            "max": [max(xs), max(ys), max(zs)],
        }
        data["center"] = [
            (min(xs) + max(xs)) / 2,
            (min(ys) + max(ys)) / 2,
            (min(zs) + max(zs)) / 2,
        ]
    else:
        data["bounding_box"] = {"min": [0, 0, 0], "max": [0, 0, 0]}
        data["center"] = [0, 0, 0]

    # Sample vertex positions (first 100, last 100, and evenly spaced 100)
    all_positions = [list(v.co) for v in mesh.vertices]
    sample_count = min(100, len(all_positions))
    if len(all_positions) <= 300:
        data["vertex_positions_sample"] = all_positions
    else:
        step = max(1, len(all_positions) // sample_count)
        sampled = all_positions[:100]
        sampled += all_positions[-100:]
        sampled += all_positions[::step][:100]
        data["vertex_positions_sample"] = sampled

    # Face data summary (face sizes, not all vertices)
    face_sizes = {}
    for poly in mesh.polygons:
        size = len(poly.vertices)
        face_sizes[size] = face_sizes.get(size, 0) + 1
    data["face_size_distribution"] = face_sizes

    # Named attributes (custom attributes on the mesh)
    data["attributes"] = {}
    if hasattr(mesh, 'attributes'):
        for attr in mesh.attributes:
            attr_info = {
                "name": attr.name,
                "data_type": attr.data_type,
                "domain": attr.domain,
                "length": len(attr.data),
            }
            # Sample a few values
            sample_vals = []
            sample_n = min(20, len(attr.data))
            if sample_n == 0:
                attr_info["sample_values"] = []
                data["attributes"][attr.name] = attr_info
                continue
            step = max(1, len(attr.data) // sample_n)
            for i in range(0, len(attr.data), step):
                if i >= len(attr.data):
                    break
                item = attr.data[i]
                if hasattr(item, 'value'):
                    val = item.value
                    if hasattr(val, '__iter__'):
                        sample_vals.append(list(val))
                    else:
                        sample_vals.append(val)
                elif hasattr(item, 'vector'):
                    sample_vals.append(list(item.vector))
                elif hasattr(item, 'color'):
                    sample_vals.append(list(item.color))
                if len(sample_vals) >= sample_n:
                    break
            attr_info["sample_values"] = sample_vals
            data["attributes"][attr.name] = attr_info

    # Material slots
    data["materials"] = []
    for slot in eval_obj.material_slots:
        if slot.material:
            data["materials"].append(slot.material.name)

    eval_obj.to_mesh_clear()
    return data


def extract_instances(obj, depsgraph):
    """Extract instance data from an object with geometry nodes.

    NOTE: For nested geometry node instances (ObjectInfo → Instance on Points → Join),
    Blender's depsgraph reports the parent object name instead of the individual module
    name. This is a known Python API limitation — instance domain attributes are not
    accessible via Python. The object_name field may show the parent (e.g. "Building 1")
    for these instances. Positions, rotations, and scales are always correct.
    Collection-instanced objects (extras, props) retain their correct source names.
    See: https://devtalk.blender.org/t/29143
    """
    instances = []

    for inst in depsgraph.object_instances:
        if inst.parent and inst.parent.original == obj and inst.is_instance:
            obj_name = inst.object.original.name if inst.object else None
            instance_data = {
                "world_matrix": serialize_matrix(inst.matrix_world),
                "object_name": obj_name,
                # Flag whether this is a resolved source name or the parent object
                "source_resolved": obj_name != obj.name if obj_name else False,
                "is_instance": True,
            }
            instances.append(instance_data)

    return instances


def apply_config(obj, modifier_name, inputs):
    """Apply parameter overrides to a geometry nodes modifier."""
    mod = obj.modifiers.get(modifier_name)
    if not mod:
        print(f"  [WARN] Modifier '{modifier_name}' not found on '{obj.name}'")
        return False

    for key, value in inputs.items():
        try:
            # IMPORTANT: Blender modifier ID properties don't handle Python bool
            # correctly in some versions. Setting mod[key] = False can silently
            # corrupt the evaluation. Convert bools to int (0/1) before assigning.
            if isinstance(value, bool):
                value = int(value)
            mod[key] = value
            print(f"    Set {key} = {value}")
        except Exception as e:
            print(f"    [WARN] Could not set {key} = {value}: {e}")

    return True


def main():
    output_dir, configs_path = get_args()
    os.makedirs(output_dir, exist_ok=True)

    # Load test configurations
    if configs_path and os.path.exists(configs_path):
        with open(configs_path, 'r') as f:
            configs = json.load(f).get("configs", [])
    else:
        # Auto-generate a default config for each object with geo nodes
        configs = []
        for obj in bpy.data.objects:
            for mod in obj.modifiers:
                if mod.type == 'NODES' and mod.node_group:
                    configs.append({
                        "name": "default",
                        "object": obj.name,
                        "modifier": mod.name,
                        "inputs": {},
                    })

    if not configs:
        print("[export_ground_truth] No geometry node modifiers found.")
        return

    all_results = []

    for config in configs:
        config_name = config.get("name", "unnamed")
        obj_name = config.get("object")
        mod_name = config.get("modifier")
        inputs = config.get("inputs", {})

        print(f"\n=== Config: {config_name} ===")
        print(f"  Object: {obj_name}, Modifier: {mod_name}")

        obj = bpy.data.objects.get(obj_name)
        if not obj:
            print(f"  [ERROR] Object '{obj_name}' not found, skipping.")
            continue

        # Apply parameter overrides
        if inputs:
            apply_config(obj, mod_name, inputs)

        # Force depsgraph re-evaluation after parameter changes
        # Just calling evaluated_depsgraph_get() returns the cached version.
        # We need to tag the object for update and refresh the depsgraph.
        obj.update_tag()
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()

        # Extract mesh data
        mesh_data = extract_mesh_data(obj, depsgraph)
        mesh_data["config_name"] = config_name
        mesh_data["config_inputs"] = inputs

        # Extract instances
        instances = extract_instances(obj, depsgraph)
        mesh_data["instance_count"] = len(instances)
        # Only include first 500 instances to keep file size reasonable
        mesh_data["instances"] = instances[:500]
        if len(instances) > 500:
            mesh_data["instances_truncated"] = True
            mesh_data["total_instances"] = len(instances)

        all_results.append(mesh_data)

        # Also export as glb for visual comparison
        glb_path = os.path.join(output_dir, f"ground_truth_{config_name}.glb")
        for o in bpy.context.view_layer.objects:
            try: o.select_set(False)
            except: pass
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        try:
            bpy.ops.export_scene.gltf(
                filepath=glb_path,
                use_selection=True,
                export_format='GLB',
                export_apply=True,
            )
            print(f"  Exported GLB: {glb_path}")
        except Exception as e:
            print(f"  [WARN] GLB export failed: {e}")
        obj.select_set(False)

        # Write individual config result
        config_json_path = os.path.join(output_dir, f"ground_truth_{config_name}.json")
        with open(config_json_path, 'w') as f:
            json.dump(mesh_data, f, indent=2, default=str)

    # Write combined results
    combined_path = os.path.join(output_dir, "all_ground_truth.json")
    with open(combined_path, 'w') as f:
        json.dump({"configs": all_results}, f, indent=2, default=str)

    print(f"\n[export_ground_truth] Wrote {len(all_results)} configs to {output_dir}")


if __name__ == "__main__":
    main()
