import {
    Extension,
    ExtensionProperty,
    IProperty,
    MathUtils,
    Nullable,
    PropertyType,
    ReaderContext,
    vec3,
    WriterContext,
} from '@gltf-transform/core'
import {GLTFLightsAmbientExtension, type GLTFLightsAmbientLightDef} from 'threepipe'

const NAME = GLTFLightsAmbientExtension.WebGiLightsAmbientExtension

interface IAmbientLightGP extends IProperty {
    type: GLTFLightsAmbientLightDef['type']
    color: vec3
    groundColor: vec3
    intensity: number
}

/**
 * An ambient or hemisphere light of `WEBGI_lights_ambient` on a {@link Node} in a gltf-transform document. See
 * {@link GLTFLightsAmbientExtensionGP}.
 */
export class AmbientLightGP extends ExtensionProperty<IAmbientLightGP> {
    public static EXTENSION_NAME = NAME
    declare public extensionName: typeof NAME
    declare public propertyType: 'AmbientLight'
    declare public parentTypes: [PropertyType.NODE]

    // eslint-disable-next-line @typescript-eslint/naming-convention -- gltf-transform's ExtensionProperty method
    protected init(): void {
        this.extensionName = NAME
        this.propertyType = 'AmbientLight'
        this.parentTypes = [PropertyType.NODE]
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention -- gltf-transform's ExtensionProperty method
    protected getDefaults(): Nullable<IAmbientLightGP> {
        return Object.assign(super.getDefaults() as IProperty, {
            type: 'ambient' as const,
            color: [1, 1, 1] as vec3,
            groundColor: [1, 1, 1] as vec3,
            intensity: 1,
        })
    }

    /** `ambient` or `hemisphere` */
    getType() {
        return this.get('type')
    }
    setType(type: GLTFLightsAmbientLightDef['type']): this {
        return this.set('type', type)
    }

    /** Linear sRGB. The sky colour of a hemisphere light. */
    getColor(): vec3 {
        return this.get('color')
    }
    setColor(color: vec3): this {
        return this.set('color', color)
    }

    /** Linear sRGB. Hemisphere lights only. */
    getGroundColor(): vec3 {
        return this.get('groundColor')
    }
    setGroundColor(color: vec3): this {
        return this.set('groundColor', color)
    }

    /** The `intensity` of three.js `AmbientLight` and `HemisphereLight`. */
    getIntensity(): number {
        return this.get('intensity')
    }
    setIntensity(intensity: number): this {
        return this.set('intensity', intensity)
    }
}

/**
 * `WEBGI_lights_ambient` (ambient and hemisphere lights, see {@link GLTFLightsAmbientExtension}) for gltf-transform. The
 * lights are in an array at the root of the file and nodes use them by index, as in `KHR_lights_punctual`, so the generic
 * extension class (made by `createGenericExtensionClass`, which keeps the data of materials, meshes, nodes and scenes)
 * cannot keep them. This class is modelled on `KHRLightsPunctual` of `@gltf-transform/extensions`.
 *
 * ```typescript
 * const io = new WebIO().registerExtensions([...ALL_EXTENSIONS, GLTFLightsAmbientExtensionGP])
 * ```
 * `GLTFDracoExportPlugin.gltfTransformExtensions` has it.
 */
export class GLTFLightsAmbientExtensionGP extends Extension {
    public readonly extensionName = NAME
    public static readonly EXTENSION_NAME = NAME

    /** A new light, to set on a {@link Node} with `node.setExtension(GLTFLightsAmbientExtensionGP.EXTENSION_NAME, light)` */
    createLight(name = ''): AmbientLightGP {
        return new AmbientLightGP(this.document.getGraph(), name)
    }

    read(context: ReaderContext): this {
        const jsonDoc = context.jsonDoc
        const rootDef = jsonDoc.json.extensions?.[NAME] as {lights?: GLTFLightsAmbientLightDef[]} | undefined
        if (!rootDef) return this
        const lights = (rootDef.lights || []).map((def) => {
            const light = this.createLight(def.name || '').setType(def.type)
            if (def.color !== undefined) light.setColor(def.color)
            if (def.groundColor !== undefined) light.setGroundColor(def.groundColor)
            if (def.intensity !== undefined) light.setIntensity(def.intensity)
            return light
        })
        jsonDoc.json.nodes?.forEach((nodeDef, nodeIndex) => {
            const index = (nodeDef.extensions?.[NAME] as {light?: number} | undefined)?.light
            if (index === undefined || !lights[index]) return
            context.nodes[nodeIndex].setExtension(NAME, lights[index])
        })
        return this
    }

    write(context: WriterContext): this {
        const jsonDoc = context.jsonDoc
        if (this.properties.size === 0) return this
        const lightDefs: GLTFLightsAmbientLightDef[] = []
        const indices = new Map<AmbientLightGP, number>()
        for (const property of this.properties) {
            const light = property as AmbientLightGP
            const def: GLTFLightsAmbientLightDef = {type: light.getType()}
            if (light.getName()) def.name = light.getName()
            if (!MathUtils.eq(light.getColor(), [1, 1, 1])) def.color = light.getColor()
            if (light.getType() === 'hemisphere' && !MathUtils.eq(light.getGroundColor(), [1, 1, 1])) def.groundColor = light.getGroundColor()
            if (light.getIntensity() !== 1) def.intensity = light.getIntensity()
            indices.set(light, lightDefs.push(def) - 1)
        }
        this.document.getRoot().listNodes().forEach((node) => {
            const light = node.getExtension<AmbientLightGP>(NAME)
            if (!light) return
            const nodeDef = jsonDoc.json.nodes![context.nodeIndexMap.get(node)!]
            nodeDef.extensions = nodeDef.extensions || {}
            nodeDef.extensions[NAME] = {light: indices.get(light)}
        })
        jsonDoc.json.extensions = jsonDoc.json.extensions || {}
        jsonDoc.json.extensions[NAME] = {lights: lightDefs}
        return this
    }
}
