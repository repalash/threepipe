"""
create_test_blend.py — Create a simple .blend file with geometry nodes for testing.
Creates a procedural grid-of-cubes setup (like a simple building block generator).
"""
import bpy
import os

# Clear default scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# Create a simple cube collection for instancing
cube_collection = bpy.data.collections.new("ModuleCubes")
bpy.context.scene.collection.children.link(cube_collection)

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
cube = bpy.context.active_object
cube.name = "UnitCube"
# Move to our collection — unlink from whatever collection it's currently in
for coll in cube.users_collection:
    coll.objects.unlink(cube)
cube_collection.objects.link(cube)

# Create main object
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
main_obj = bpy.context.active_object
main_obj.name = "Building"

# Create geometry node tree
tree = bpy.data.node_groups.new("BuildingGenerator", 'GeometryNodeTree')

# Blender 4.0 interface API
tree.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
tree.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
width_socket = tree.interface.new_socket('Width', in_out='INPUT', socket_type='NodeSocketInt')
width_socket.default_value = 3
width_socket.min_value = 1
width_socket.max_value = 20
height_socket = tree.interface.new_socket('Height', in_out='INPUT', socket_type='NodeSocketInt')
height_socket.default_value = 5
height_socket.min_value = 1
height_socket.max_value = 30
scale_socket = tree.interface.new_socket('Module Scale', in_out='INPUT', socket_type='NodeSocketFloat')
scale_socket.default_value = 1.0
scale_socket.min_value = 0.1
scale_socket.max_value = 5.0

# Add nodes
group_in = tree.nodes.new('NodeGroupInput')
group_in.location = (-600, 0)

group_out = tree.nodes.new('NodeGroupOutput')
group_out.location = (600, 0)

# Mesh Grid node
grid = tree.nodes.new('GeometryNodeMeshGrid')
grid.location = (-200, 200)
# Width input -> Size X
# Height input -> Size Y

# Math node: multiply for spacing
math_mul = tree.nodes.new('ShaderNodeMath')
math_mul.operation = 'MULTIPLY'
math_mul.location = (-400, 100)

# Instance on Points
instance_on_pts = tree.nodes.new('GeometryNodeInstanceOnPoints')
instance_on_pts.location = (200, 0)

# Collection Info
coll_info = tree.nodes.new('GeometryNodeCollectionInfo')
coll_info.location = (0, -200)
# Set the collection
coll_info.inputs['Collection'].default_value = cube_collection

# Links
# Group Input Width -> Grid Vertices X
tree.links.new(group_in.outputs['Width'], grid.inputs['Vertices X'])
# Group Input Height -> Grid Vertices Y
tree.links.new(group_in.outputs['Height'], grid.inputs['Vertices Y'])
# Group Input Module Scale -> Math Multiply (Value 0)
tree.links.new(group_in.outputs['Module Scale'], math_mul.inputs[0])
# Set second math input to constant
math_mul.inputs[1].default_value = 1.5

# Math output -> Grid Size X and Size Y
tree.links.new(math_mul.outputs['Value'], grid.inputs['Size X'])
tree.links.new(math_mul.outputs['Value'], grid.inputs['Size Y'])

# Grid Mesh -> Instance on Points (Points)
tree.links.new(grid.outputs['Mesh'], instance_on_pts.inputs['Points'])
# Collection Info -> Instance on Points (Instance)
tree.links.new(coll_info.outputs['Instances'], instance_on_pts.inputs['Instance'])

# Instance on Points -> Group Output
tree.links.new(instance_on_pts.outputs['Instances'], group_out.inputs['Geometry'])

# Add modifier to main object
mod = main_obj.modifiers.new("GeometryNodes", 'NODES')
mod.node_group = tree

# Save file
output_path = os.path.join(os.getcwd(), "test_building.blend")
bpy.ops.wm.save_as_mainfile(filepath=output_path)
print(f"Saved test file to: {output_path}")
