import {Camera, ILight, IObject3D, Matrix4, Object3D, Scene, Vector3} from 'threepipe'

/**
 * The light that shadows the volume and its index in the three.js light uniforms: three.js lists the visible lights
 * in scene order (WebGLRenderer.projectObject), puts the ones that cast shadows first (WebGLLights), then numbers
 * each type in that order.
 */
export function findShadowLight(scene: Scene, camera?: Camera): {light: ILight, type: number, index: number} | undefined {
    const lights: ILight[] = []
    const visit = (o: Object3D) => {
        if (!o.visible) return
        if ((o as any).isLight && (!camera || o.layers.test(camera.layers))) lights.push(o as unknown as ILight)
        for (const c of o.children) visit(c)
    }
    visit(scene)
    const weight = (l: any) => (l.castShadow ? 2 : 0) + (l.map ? 1 : 0)
    lights.sort((a, b) => weight(b) - weight(a))
    const typeOf = (l: any) => l.isDirectionalLight ? 1 : l.isPointLight ? 2 : l.isSpotLight ? 3 : 0
    const pick = lights.find(l => typeOf(l) && (l as any).castShadow) ?? lights.find(l => typeOf(l) === 1)
    if (!pick) return undefined
    const type = typeOf(pick)
    const index = lights.filter(l => typeOf(l) === type).indexOf(pick)
    return {light: pick, type, index}
}

const _m4 = new Matrix4()
const _v1 = new Vector3()
const _v2 = new Vector3()

/**
 * Direction toward a light in the texture coordinates of a volume object (not normalized).
 */
export function lightDirectionInTexture(light: ILight, object: IObject3D, boxSize: Vector3): Vector3 {
    const l = light as any
    light.updateWorldMatrix(true, false)
    object.updateWorldMatrix(true, false)
    _m4.copy(object.matrixWorld).invert()
    const lightPos = _v1.setFromMatrixPosition(light.matrixWorld).applyMatrix4(_m4)
    let dir: Vector3
    if (l.isDirectionalLight) {
        l.target?.updateWorldMatrix(true, false)
        const targetPos = _v2.setFromMatrixPosition(l.target?.matrixWorld ?? new Matrix4()).applyMatrix4(_m4)
        dir = lightPos.clone().sub(targetPos)
    } else {
        // point and spot lights: from the centre of the volume
        dir = lightPos.clone()
    }
    return dir.divide(boxSize)
}
