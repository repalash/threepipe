import {Light} from 'threepipe'
import {Ctx} from './ctx'

const blenderLightTypes = {
    point: 0,
    sun: 1,
    spot: 0,
    hemi: 0,
    area: 0,
}

export function createLight(lamp: any, ctx: Ctx) {
    const ldata = lamp.data

    const position = [lamp.loc[0], lamp.loc[2], -lamp.loc[1]]

    const color = ldata.r * 255 << 16 | ldata.g * 255 << 8 | ldata.b * 255 << 0
    const intensity = ldata.energy
    const distance = 0

    let light: Light | undefined = undefined

    switch (ldata.type) {
    case blenderLightTypes.point:
        light = new ctx.PointLight(color, intensity, distance)
        light!.position.fromArray(position, 0)
        light!.castShadow = true
        break
    case blenderLightTypes.sun:
        light = new ctx.PointLight(color, intensity, distance)
        light!.position.fromArray(position, 0)
        light!.castShadow = true
        if (light!.shadow) {
            light!.shadow.mapSize.width = 1024
            light!.shadow.mapSize.height = 1024
            // @ts-expect-error ??/
            light!.shadow.camera.near = 0.01
            // @ts-expect-error ??/
            light!.shadow.camera.far = 500
        }
        break
    default:
        console.warn('Unsupported light type', ldata.type)
    }

    return light
}
