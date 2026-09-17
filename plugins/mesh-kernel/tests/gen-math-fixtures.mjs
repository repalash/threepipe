/**
 * Generate reference values for `src/math` straight out of three.js.
 *
 * three cannot be imported under plain Node - its module scope builds a Texture, which needs
 * ImageData - so this script stubs the one global it wants and then asks three for the answers. The
 * output is pasted into `math.test.ts`, the same way the Blender parity fixtures are produced.
 *
 *     node plugins/mesh-kernel/tests/gen-math-fixtures.mjs
 */
globalThis.ImageData = class ImageData {
    constructor(w, h) {
        this.width = w
        this.height = h
        this.data = new Uint8ClampedArray(w * h * 4)
    }
}
const t = await import('three')

const r = x => +x.toFixed(12)
const out = {}

out.rotationEulerXYZ = new t.Matrix4()
    .makeRotationFromEuler(new t.Euler(0.3, -0.5, 0.7, 'XYZ')).elements.map(r)

out.rotationAxis = new t.Matrix4()
    .makeRotationAxis(new t.Vector3(0.3, 0.9, -0.2).normalize(), 1.1).elements.map(r)

out.compose = new t.Matrix4().compose(
    new t.Vector3(1, -2, 3),
    new t.Quaternion().setFromEuler(new t.Euler(0.3, -0.5, 0.7, 'XYZ')),
    new t.Vector3(2, 0.5, 1.5)).elements.map(r)

out.multiply = new t.Matrix4()
    .multiplyMatrices(
        new t.Matrix4().makeRotationFromEuler(new t.Euler(0.3, -0.5, 0.7, 'XYZ')),
        new t.Matrix4().makeTranslation(1, -2, 3)).elements.map(r)

out.transformPoint = new t.Vector3(0.4, -1.2, 2.5)
    .applyMatrix4(new t.Matrix4().compose(
        new t.Vector3(1, -2, 3),
        new t.Quaternion().setFromEuler(new t.Euler(0.3, -0.5, 0.7, 'XYZ')),
        new t.Vector3(2, 0.5, 1.5))).toArray().map(r)

out.rotationBetween = new t.Matrix4().makeRotationFromQuaternion(
    new t.Quaternion().setFromUnitVectors(
        new t.Vector3(0.2, 0.9, -0.4).normalize(),
        new t.Vector3(-0.7, 0.1, 0.6).normalize())).elements.map(r)

out.rotationBetweenOpposed = new t.Matrix4().makeRotationFromQuaternion(
    new t.Quaternion().setFromUnitVectors(
        new t.Vector3(0, 1, 0),
        new t.Vector3(0, -1, 0))).elements.map(r)

console.log(JSON.stringify(out, null, 4))
