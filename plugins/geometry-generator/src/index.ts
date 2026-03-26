// Re-export core geometry symbols for backward compatibility
export {
    /* GeometryGeneratorPlugin, */type IGeometryGeneratorMap,
    AGeometryGenerator, updateUi, type GeometryGenerator,
    BoxGeometryGenerator, type BoxGeometryGeneratorParams,
    CircleGeometryGenerator, type CircleGeometryGeneratorParams,
    CylinderGeometryGenerator, type CylinderGeometryGeneratorParams,
    PlaneGeometryGenerator, type PlaneGeometryGeneratorParams,
    SphereGeometryGenerator, type SphereGeometryGeneratorParams,
    TorusGeometryGenerator, type TorusGeometryGeneratorParams,
    LineGeometryGenerator, type LineGeometryGeneratorParams,
    type SupportedCurveTypes,
} from 'threepipe'

// Extra generators (not in core — depends on three/examples/jsm)
export {TextGeometryGenerator, type TextGeometryGeneratorParams} from './primitives/TextGeometryGenerator'
export {FontLibrary} from './FontLibrary'
export {GeometryGeneratorExtrasPlugin, GeometryGeneratorPlugin} from './GeometryGeneratorExtrasPlugin'

// Module augmentation for type safety when using extra generators
declare module 'threepipe' {
    interface IGeometryGeneratorMap {
        text: import('./primitives/TextGeometryGenerator').TextGeometryGenerator
    }
}
