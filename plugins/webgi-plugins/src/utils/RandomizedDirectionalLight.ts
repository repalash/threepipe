import {
    Color,
    copyObject3DUserData,
    DirectionalLight2,
    IDisposable,
    Serialization,
    SerializationMetaType,
    serialize,
    ThreeSerialization,
    Vector2,
    Vector3
} from 'threepipe'
import Rand from "rand-seed";

export interface RDShadowParams {
    frustumSize: number,
    far: number,
    bias: number,
    width: number,
    near: number,
    enabled: boolean,
    height: number,
    normalBias: number,
    radius: number
}

export interface RDRandomParams {
    minDistanceScale: Vector3,
    distanceScale: number,
    focus: number,
    spread: number,
    direction: Vector3
    normalDirection: Vector3
}

export class RandomizedDirectionalLight extends DirectionalLight2 implements IDisposable {
    @serialize('shadowParams')
    private _shadowParams: RDShadowParams = {
        enabled: true,
        radius: 2,
        width: 1024,
        height: 1024,
        bias: -0.001,
        normalBias: 0,
        near: 1.5,
        far: 4,
        frustumSize: 4,
    }

    @serialize('randomParams')
    private _randomParams: RDRandomParams = {
        focus: 1, // 0 to 1
        spread: 0.01, // 0 to 4
        distanceScale: 50, // distance from target sort of
        minDistanceScale: new Vector3(10, 10, 10), // distance from target sort of
        // normalDirection: new Vector3(0.01, 0.33, 0.9).normalize(),
        normalDirection: new Vector3(0.01, 0.98, 0.01).normalize(),
        direction: new Vector3(-.9, 0.5, -1.),
        // direction: new Vector3(3, 2, 1).multiply(this.camera.position),
    }
    isRandomizedDirectionalLight = true

    // Set renderer.shadowMap settings if using shadows.
    constructor(color?: Color | string | number, intensity?: number, shadow?: Partial<RDShadowParams>, random?: Partial<RDRandomParams>) {
        super(color, intensity)
        this.shadowParams = shadow ?? {}
        this.randomParams = random ?? {}
        this.updateShadowParams = this.updateShadowParams.bind(this)
        // this.target.removeFromParent()
    }

    /**
     * call setter to change. or call updateShadowParams after changing
     */
    get shadowParams(): Partial<RDShadowParams> {
        return this._shadowParams
    }

    set shadowParams(value: Partial<RDShadowParams>) {
        // @ts-expect-error ignore
        Object.keys(value).forEach(key => value[key] === undefined && delete value[key])
        this._shadowParams = {...this._shadowParams, ...value}
        this.updateShadowParams()
    }


    get randomParams(): Partial<RDRandomParams> {
        return this._randomParams
    }

    set randomParams(value: Partial<RDRandomParams>) {
        // @ts-expect-error ignore
        Object.keys(value).forEach(key => value[key] === undefined && delete value[key])
        Object.assign(this._randomParams, value)
    }

    updateShadowParams() {
        this.castShadow = this._shadowParams.enabled

        this.shadow.mapSize.x = this._shadowParams.width // default
        this.shadow.mapSize.y = this._shadowParams.height // default
        // this.shadow.bias = -0.001;
        this.shadow.bias = this._shadowParams.bias
        this.shadow.normalBias = this._shadowParams.normalBias
        // this.shadow.normalBias = 0.0000001;
        // this.shadow.camera.near = 20;
        // this.shadow.camera.far = 75;
        // this.shadow.camera.near = this._shadowParams.near;
        // this.shadow.camera.far = this._shadowParams.far;
        this.refreshShadowCamNearFar()

        this.shadow.radius = this._shadowParams.radius

        this.shadow.camera.right = this._shadowParams.frustumSize / 2
        this.shadow.camera.left = -this._shadowParams.frustumSize / 2
        this.shadow.camera.top = this._shadowParams.frustumSize / 2
        this.shadow.camera.bottom = -this._shadowParams.frustumSize / 2

        this.shadow.camera.updateProjectionMatrix()
        this.matrixWorldNeedsUpdate = true
    }

    randomizePosition(seed: number, focus: number|null = null, spread: number|null = null) {
        // todo remove dependency to rand-seed
        const rand = new Rand(seed.toString())

        const rnd = new Vector2(rand.next() * Math.PI * 2, Math.asin(rand.next() * 2 - 1))
        let dir = new Vector3(Math.cos(rnd.x) * Math.cos(rnd.y), Math.sin(rnd.y), Math.sin(rnd.x) * Math.cos(rnd.y))
        // const dir = vec3.random(vec3.create(), 30);
        // const light_params = {
        //     directionalWeight: 0.7,
        //     randomWeight: 1.5,
        //     sampleHemisphere: true,
        //     direction: new Vector3(-2, 1, 2),
        //     // direction: new Vector3(3, 2, 1).multiply(this.camera.position),
        // }
        // if (rand.next() < Math.pow(focus ?? this._randomParams.focus, 2)) {
        //     dir.multiplyScalar((spread ?? this._randomParams.spread) * Math.sqrt(rand.next())).add(this._randomParams.direction);
        // }

        /**
         * @type {string}
         */
        // let h = this._randomParams.hemisphere;
        // while ((h?.length ?? 0) >= 2) { // negate direction if < or > 0
        //     if ((dir[h[0]] * (h[1] === '+' ? -1 : 1)) < 0) dir[h[0]] *= -1;
        //     h = h.substr(2);
        // }

        const v2 = new Vector2()

        for (let kk = 0; kk < 5; kk++) {
            v2.set(rand.next(), rand.next())
            dir = getSample(v2, this._randomParams.normalDirection, 0.4)

            if (rand.next() < Math.sqrt(focus ?? this._randomParams.focus)) {
                v2.set(rand.next(), rand.next())
                dir = getSample(v2, this._randomParams.direction, Math.pow((spread ?? this._randomParams.spread) / 2., 2))
            }

            const cd = dir.dot(this._randomParams.normalDirection)
            if (cd > 0 && cd < 0.4) break
        }
        dir.normalize()

        dir.multiplyScalar(this._randomParams.distanceScale)

        // dir.x += Math.sign(dir.x) * this._randomParams.minDistanceScale.x;
        // dir.y += Math.sign(dir.y) * this._randomParams.minDistanceScale.y;
        // dir.z += Math.sign(dir.z) * this._randomParams.minDistanceScale.z;
        // dir.z = 15. + 10 * dir.z / 50;
        // vec3.mul(dir, dir, [500, 500, 500]);
        // console.log(vec3.len(dir));
        // vec3.add(dir, dir, [0,10,0]);

        // let useY = Math.max(...dir.toArray()) !== dir.y;
        // let up = new Vector3(!useY?1:0, useY?1:0, 0).cross(dir).normalize();
        // console.log(dir);
        this.position.set(0, 0, 0)
        this.target.position.copy(dir.normalize().negate())
        this.target.updateMatrixWorld()
        this.refreshShadowCamNearFar()

        this.updateMatrixWorld()

    }

    refreshShadowCamNearFar() {
        const dist = new Vector3().subVectors(this.target.position, this.shadow.camera.position).length()
        this.shadow.camera.near = dist - this._shadowParams.near * this._shadowParams.frustumSize / 2
        this.shadow.camera.far = dist + this._shadowParams.far * this._shadowParams.frustumSize / 2
    }

    dispose(): void {
        super.dispose() // DirectionalLight: frees the shadow map
    }

    // todo move to commons and base class in threepipe like materials
    toJSON(meta?: SerializationMetaType, _internal = false): any {
        // todo uncomment after ts-browser-helpers update
        // if (!_internal) {
        //     return ThreeSerialization.Serialize(this, meta, false)
        // }
        const {userData, children} = this
        this.userData = {}
        this.children = []
        const data: any = super.toJSON(meta)
        const copiedData = copyObject3DUserData({}, userData)
        data.userData = Serialization.Serialize(copiedData) // no meta here, since we dont support textures etc inside lights
        this.userData = userData
        this.children = children

        data.type = 'DirectionalLight2'
        data.target = this.target.position.toArray()
        // return Object.assign(data, serializeObject(this, true, meta)) // for subclasses like RandomizedDirectionalLight
        return {
            ...data,
            ...ThreeSerialization.Serialize(this, meta, true), // this will serialize the properties of this class(like defined with @serialize and @serialize attribute)
        } // for subclasses like RandomizedDirectionalLight
 // this will call toJSON again, but with baseOnly=true, that's why we set isThis to false.
    }

    // todo move to commons and base class in threepipe
    fromJSON(data: any, meta?: SerializationMetaType, _internal = false): this | null {
        // todo uncomment after ts-browser-helpers update
        // if(!_internal) {
        //     return ThreeSerialization.Deserialize(data, this, meta, false)
        // }

        if (data.type !== 'DirectionalLight2') return null // todo type
        const target = data.target
        const object = data.object
        if (data.target) {
            this.target.position.fromArray(data.target)
            this.target.updateMatrixWorld()
            delete data.target
        }
        if (data.object) {
            delete data.object
        }
        ThreeSerialization.Deserialize(data, this, meta, true)
        if (target) {
            data.target = target
        }
        if (object) {
            if (object.color !== undefined) this.color.set(object.color)
            if (object.intensity !== undefined) this.intensity = object.intensity
            data.object = object
        }
        // todo: shadow (use ObjectLoader)


        // for this class
        this.updateShadowParams()


        return this
    }

    // fromJSON(data: any, meta?: any): this | null {
    //     // if (!super.fromJSON(data, meta)) return null
    //     this.updateShadowParams()
    //     return this
    // }

//
    // setDefaultPosition() {
    //     this.position.copy(this._randomParams.direction).multiplyScalar(this._randomParams.distanceScale)
    //     this.position.z = 15. + 10 * this.position.z / 50;
    //     this.updateMatrixWorld()
    // }
}

/**
 * Random direction, uniformly distributed over the cone around `dir` in which cos(angle to dir)
 * is between 1 - extent and 1: phi = 2 pi u, cos(theta) = 1 - v extent, with (u, v) = rand in [0, 1).
 * Basis: b1 = (0, -dir.z, dir.y) and b2 = dir x b1, both zero when dir is along x.
 */
function getSample(rand: Vector2, dir: Vector3, extent: number) {
    const w = dir.clone().normalize()
    const b1 = new Vector3(0., -w.z, w.y).normalize()
    const b2 = new Vector3().crossVectors(w, b1).normalize()

    const phi = rand.x * 2. * Math.PI
    const cosTheta = 1.0 - rand.y * extent
    const sinTheta = Math.sqrt(1.0 - cosTheta * cosTheta)
    return b1.multiplyScalar(Math.cos(phi) * sinTheta).add(b2.multiplyScalar(Math.sin(phi) * sinTheta)).add(w.multiplyScalar(cosTheta))
}
