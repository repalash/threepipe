import {UnlitMaterial} from 'threepipe'

import {GaussianSplatMaterialExtension} from './GaussianSplatMaterialExtension'

export class GaussianSplatMaterialUnlit extends UnlitMaterial {
    readonly isGaussianSplatMaterialUnlit = true
    gsplatExtension = new GaussianSplatMaterialExtension()

    constructor() {
        super({
            depthTest: true,
            depthWrite: false,
            transparent: true,
            vertexColors: false,
        })
        // this.userData.renderToGBuffer = true
        // this.userData.renderToDepth = true
        this.registerMaterialExtensions([this.gsplatExtension])
    }

    dispose() {
        this.gsplatExtension.dispose()
        return super.dispose()
    }
}

