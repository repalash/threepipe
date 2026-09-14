"""
export_intermediate.py — Export intermediate point clouds from geometry node sub-groups.

Temporarily rewires the node tree output to expose an intermediate geometry,
evaluates the depsgraph, and dumps vertex positions in Blender's internal order.
This is essential for debugging point ordering issues (e.g. randomBool indices).

Usage:
  blender --background file.blend --python export_intermediate.py -- \
    --object "Building 1" --node "Group.009" --socket "Input_1"

Arguments:
  --object   Name of the object with the geometry nodes modifier
  --node     Name of the node whose input you want to inspect
  --socket   Socket identifier on that node (e.g. "Input_1")

Output: prints vertex positions in Blender's evaluated order (index, x, y, z).
These indices are what randomBool/randomInt use as point IDs.
"""

import bpy
import sys
import json

def get_args():
    argv = sys.argv
    if "--" in argv:
        return argv[argv.index("--") + 1:]
    return []

args = get_args()
obj_name = "Building 1"
node_name = "Group.009"
socket_id = "Input_1"

i = 0
while i < len(args):
    if args[i] == "--object" and i + 1 < len(args):
        obj_name = args[i + 1]; i += 2
    elif args[i] == "--node" and i + 1 < len(args):
        node_name = args[i + 1]; i += 2
    elif args[i] == "--socket" and i + 1 < len(args):
        socket_id = args[i + 1]; i += 2
    else:
        i += 1

obj = bpy.data.objects.get(obj_name)
if not obj:
    print(f"ERROR: Object '{obj_name}' not found")
    sys.exit(1)

mod = None
for m in obj.modifiers:
    if m.type == 'NODES' and m.node_group:
        mod = m
        break

if not mod:
    print(f"ERROR: No geometry nodes modifier on '{obj_name}'")
    sys.exit(1)

tree = mod.node_group

# Find target node
target = None
for node in tree.nodes:
    if node.name == node_name:
        target = node
        break

if not target:
    print(f"ERROR: Node '{node_name}' not found in '{tree.name}'")
    print(f"Available nodes: {[n.name for n in tree.nodes if n.bl_idname != 'NodeReroute']}")
    sys.exit(1)

# Find the link to the target socket
source_link = None
for link in tree.links:
    if link.to_node == target and link.to_socket.identifier == socket_id:
        source_link = link
        break

if not source_link:
    print(f"ERROR: No link to {node_name}.{socket_id}")
    print(f"Available inputs: {[(s.identifier, s.name) for s in target.inputs]}")
    sys.exit(1)

# Trace through reroute nodes
from_socket = source_link.from_socket
node = source_link.from_node
while node.bl_idname == 'NodeReroute':
    for l in tree.links:
        if l.to_node == node:
            from_socket = l.from_socket
            node = l.from_node
            break
    else:
        break

print(f"Source: {node.name}.{from_socket.identifier}")

# Find Group Output
group_output = None
for n in tree.nodes:
    if n.bl_idname == 'NodeGroupOutput':
        group_output = n
        break

# Save and clear output links
original_links = []
for link in tree.links:
    if link.to_node == group_output:
        original_links.append((link.from_socket, link.to_socket))

for fs, ts in original_links:
    for link in tree.links:
        if link.from_socket == fs and link.to_socket == ts:
            tree.links.remove(link)
            break

# Connect intermediate geometry to output
tree.links.new(source_link.from_socket, group_output.inputs[0])

# Evaluate
depsgraph = bpy.context.evaluated_depsgraph_get()
eval_obj = obj.evaluated_get(depsgraph)

if eval_obj.type == 'MESH':
    mesh = eval_obj.to_mesh()
    loc = obj.location
    print(f"\nVertices: {len(mesh.vertices)}")
    print(f"Object origin: ({loc.x:.6f}, {loc.y:.6f}, {loc.z:.6f})")
    print(f"\n{'idx':>4}  {'x':>10}  {'y':>10}  {'z':>10}  {'x_local':>10}  {'y_local':>10}  {'z_local':>10}")
    for i, v in enumerate(mesh.vertices):
        lx = v.co.x - loc.x
        ly = v.co.y - loc.y
        lz = v.co.z - loc.z
        print(f"{i:4d}  {v.co.x:10.4f}  {v.co.y:10.4f}  {v.co.z:10.4f}  {lx:10.4f}  {ly:10.4f}  {lz:10.4f}")
    eval_obj.to_mesh_clear()
else:
    print(f"Evaluated type: {eval_obj.type} (expected MESH)")

# Restore original links
for link in list(tree.links):
    if link.to_node == group_output:
        tree.links.remove(link)
for fs, ts in original_links:
    tree.links.new(fs, ts)

print("\nRestored original output links.")
