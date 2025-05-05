import {
    AnyOptions,
    BaseImporterPlugin,
    BoxGeometry,
    BufferGeometry,
    Color,
    Group,
    ILoader,
    ImportAddOptions,
    Importer,
    Mesh,
    Object3D,
    PhysicalMaterial,
    Points,
    PointsMaterial,
    Scene,
    SkeletonHelper,
} from 'threepipe'
import {TDSLoader} from 'three/examples/jsm/loaders/TDSLoader.js'
import {ThreeMFLoader} from 'three/examples/jsm/loaders/3MFLoader.js'
import {Collada, ColladaLoader} from 'three/examples/jsm/loaders/ColladaLoader.js'
import {AMFLoader} from 'three/examples/jsm/loaders/AMFLoader.js'
import {GCodeLoader} from 'three/examples/jsm/loaders/GCodeLoader.js'
import {BVH, BVHLoader} from 'three/examples/jsm/loaders/BVHLoader.js'
import {Chunk, VOXLoader, VOXMesh} from 'three/examples/jsm/loaders/VOXLoader.js'
import {MDD, MDDLoader} from 'three/examples/jsm/loaders/MDDLoader.js'
import {PCDLoader} from 'three/examples/jsm/loaders/PCDLoader.js'
import {TiltLoader} from 'three/examples/jsm/loaders/TiltLoader.js'
import {VRMLLoader} from 'three/examples/jsm/loaders/VRMLLoader.js'
import {LDrawLoader} from 'three/examples/jsm/loaders/LDrawLoader.js'
import {VTKLoader} from 'three/examples/jsm/loaders/VTKLoader.js'
import {XYZLoader} from 'three/examples/jsm/loaders/XYZLoader.js'

// 3ds
/**
 * Adds support for loading Autodesk 3ds `.3ds`, `application/x-3ds` files and data uris
 */
export class TDSLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'TDSLoadPlugin'
    protected _importer = new Importer(TDSLoader, ['3ds'], ['image/x-3ds', 'application/x-3ds'], false)
}

// 3mf
/**
 * Adds support for loading `.3mf`, `model/3mf` files and data uris
 */
export class ThreeMFLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'ThreeMFLoadPlugin'
    protected _importer = new Importer(ThreeMFLoader, ['3mf'], ['model/3mf'], false)
}

// collada
/**
 * Adds support for loading Collada `.dae`, `model/vnd.collada+xml` files and data uris
 */
export class ColladaLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'ColladaLoadPlugin'
    protected _importer = new Importer(class extends ColladaLoader implements ILoader {
        transform(res: Collada, _: AnyOptions): Scene {
            res.scene.userData.kinematics = res.kinematics
            res.scene.userData.library = res.library
            return res.scene
        }
    }, ['dae'], ['model/vnd.collada+xml'], false)
}

// amf
/**
 * Adds support for loading Additive Manufacturing files `.amf`, `application/amf` files and data uris
 */
export class AMFLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'AMFLoadPlugin'
    protected _importer = new Importer(AMFLoader, ['amf'], ['application/amf'], false)
}

// gcode
/**
 * Adds support for loading `.gcode`, `application/gcode` files and data uris
 */
export class GCodeLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'GCodeLoadPlugin'
    protected _importer = new Importer(GCodeLoader, ['gcode'], ['application/gcode'], false)
}

// bvh
/**
 * Adds support for loading `.bvh`, `application/bvh` files and data uris
 */
export class BVHLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'BVHLoadPlugin'
    protected _importer = new Importer(class extends BVHLoader implements ILoader {
        transform(res: BVH, _: AnyOptions): Object3D {
            const obj = new Object3D()
            const helper = new SkeletonHelper(res.skeleton.bones[0])
            obj.add(res.skeleton.bones[0])
            obj.add(helper)
            obj.animations = [res.clip]
            obj.scale.set(0.1, 0.1, 0.1) // todo: autoScale and autoCenter not working
            return obj
        }
    }, ['bvh'], ['application/bvh'], false)
}

// vox
/**
 * Adds support for loading Magica Voxel `.vox` files and data uris
 */
export class VOXLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'VOXLoadPlugin'
    protected _importer = new Importer(class extends VOXLoader implements ILoader {
        transform(chunks: Chunk[], _: AnyOptions): Object3D {
            const obj = new Object3D()
            for (const chunk of chunks) {
                // displayPalette( chunk.palette );
                const mesh = new VOXMesh(chunk)
                mesh.scale.setScalar(0.0015)
                obj.add(mesh)
            }
            return obj
        }
    }, ['vox'], [''], false)
}


// mdd
/**
 * Adds support for loading animation `.mdd`, `application/mdd` files and data uris
 */
export class MDDLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'MDDLoadPlugin'
    protected _importer = new Importer(class extends MDDLoader implements ILoader {
        transform(res: MDD, _: AnyOptions): Object3D {
            const morphTargets = res.morphTargets
            const geometry = new BoxGeometry()
            geometry.morphAttributes.position = morphTargets // apply morph targets
            const mesh = new Mesh(geometry, new PhysicalMaterial())
            const obj = new Object3D()
            obj.add(mesh)
            res.clip.tracks.forEach(track=> track.name = mesh.uuid + track.name)
            obj.animations = [res.clip]
            return obj
        }
    }, ['mdd'], ['application/mdd'], false)
}

// pcd
/**
 * Adds support for loading Point cloud data `.pcd`, `application/pcd` files and data uris
 */
export class PCDLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'PCDLoadPlugin'
    protected _importer = new Importer(class extends PCDLoader implements ILoader {
        transform(points: Points, options: ImportAddOptions): any {
            if (options.autoCenter) points.geometry.center()
            points.geometry.rotateX(Math.PI)
            return points
        }
    }, ['pcd'], ['application/pcd'], false)
}

// tilt
/**
 * Adds support for loading Tilt brush `.tilt`, `application/tilt` files and data uris
 */
export class TiltLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'TiltLoadPlugin'
    protected _importer = new Importer(TiltLoader, ['tilt'], ['application/tilt'], false)
}

// vrml
/**
 * Adds support for loading VRML `.wrl`, `model/vrml` files and data uris
 */
export class VRMLLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'VRMLLoadPlugin'
    protected _importer = new Importer(VRMLLoader, ['wrl'], ['model/vrml'], false)
}

// ldraw
/**
 * Adds support for loading LDraw `.mpd`, `application/mpd` files and data uris. see https://ldraw.org
 */
export class LDrawLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'LDrawLoadPlugin'
    protected _importer = new Importer(class extends LDrawLoader implements ILoader {
        transform(res: Group, _: AnyOptions): any {
            // Convert from LDraw coordinates: rotate 180 degrees around OX
            res.rotation.x = Math.PI
            return res
        }
    }, ['mpd'], ['application/ldraw'], false)
}

// vtk
/**
 * Adds support for loading VTK `.vtk`, '.vtp', `application/vtk` files and data uris
**/
export class VTKLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'VTKLoadPlugin'
    protected _importer = new Importer(class extends VTKLoader implements ILoader {
        transform(res: BufferGeometry, _: AnyOptions): Mesh|undefined {
            if (!res.attributes?.normal) res.computeVertexNormals()
            // todo set mesh name from options/path
            return res ? new Mesh(res, new PhysicalMaterial({
                color: new Color(1, 1, 1),
                vertexColors: res.hasAttribute('color'),
            })) : undefined
        }
    }, ['vtk', 'vtp'], ['application/vtk'], false)
}

// xyz
/**
 * Adds support for loading XYZ `.xyz`, `text/plain+xyz` files and data uris
 */
export class XYZLoadPlugin extends BaseImporterPlugin {
    public static readonly PluginType = 'XYZLoadPlugin'
    protected _importer = new Importer(class extends XYZLoader implements ILoader {
        transform(res: BufferGeometry, options: ImportAddOptions): Points|undefined {
            if (!res.attributes?.normal) res.computeVertexNormals()
            if (options.autoCenter) res.center()
            return res ? new Points(res, new PointsMaterial({
                size: 0.1,
                vertexColors: res.hasAttribute('color'),
            })) : undefined
        }
    }, ['xyz'], ['text/plain+xyz'], false)
}

export const extraImportPlugins = [
    TDSLoadPlugin,
    ThreeMFLoadPlugin,
    ColladaLoadPlugin,
    AMFLoadPlugin,
    GCodeLoadPlugin,
    BVHLoadPlugin,
    VOXLoadPlugin,
    MDDLoadPlugin,
    PCDLoadPlugin,
    TiltLoadPlugin,
    VRMLLoadPlugin,
    LDrawLoadPlugin,
    VTKLoadPlugin,
    XYZLoadPlugin,
] as const
