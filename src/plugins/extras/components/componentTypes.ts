import {IViewerPlugin, ThreeViewer} from '../../../viewer'
import type {EntityComponentPlugin} from '../EntityComponentPlugin.ts'
import {Class, Serialization} from 'ts-browser-helpers'

export interface ComponentCtx {
    viewer: ThreeViewer
    ecp: EntityComponentPlugin
    // throws error if the plugin is not found instead of returning undefined
    plugin: <T extends IViewerPlugin>(type: Class<T> | string) => T
}

const jsPropTypes = {
    string: (typeof '') as 'string',
    number: (typeof 0) as 'number',
    boolean: (typeof true) as 'boolean',
    // undefined: (typeof undefined) as 'undefined',
    object: (typeof {}) as 'object',
    // function: (typeof (()=>{return})) as 'function',
    // symbol: (typeof Symbol()) as 'symbol',
    // bigint: (typeof 1n) as 'bigint',
} as const

// StatePropTypes = "string" | "number" | "boolean" | "object" | `"${string}"` | `${number}` | "true" | "false"
export type JSPropTypes = (typeof jsPropTypes[keyof typeof jsPropTypes])
    | `"${string}"` // string literal type
    | `${number}` // number literal type
    | `${boolean}` // boolean literal type

type KeyofPropType = string/* | number | boolean*/
type ClassName = string
interface PropTypeArray {arrayOf: TypedType, type: 'Array'}
interface PropTypeObject {recordOf: Map<KeyofPropType, TypedType>, type: 'Object'}
interface PropTypeUnion {oneOf: Set<TypedType>, type: 'Union'}
export type TypedType = JSPropTypes | ClassName
    | 'null'
    | 'Object'
    | PropTypeUnion
    | PropTypeArray
    | PropTypeObject
    | {type: ClassName}

export interface StatePropConfig<T = any> {
    key: string
    label?: string
    type?: TypedType
    default?: T
    // description?: string
}

// export class CtxProxy {
//     isCtxProxy = true
//     // todo when env is set, loop through all properties and set env if they are EnvProxy too
//     ctx?: ComponentCtx
//     constructor(ctx?: ComponentCtx) {
//         this.ctx = ctx
//     }
// }

export interface ComponentDefn {ComponentType: string, StateProperties?: (string|StatePropConfig)[]}

export interface ComponentJSON{
    type: string
    state: Record<string, any>
}

export interface TypedClass<T = any>{
    key: ClassName
    getId: (obj: any)=>string
    ctor: Class<T>
    getLabel?: (obj?: T)=>string|any
    getIcon?: (obj?: T)=>string|any
    setName?: (obj: T, name: string)=>void
}

export class TypeSystem {
    static Classes = new Map</* PropType*/ ClassName, TypedClass>()

    static AddClass(def: TypedClass) {
        const sid = def.ctor.prototype.serializableClassId
        if (!sid) {
            console.error('Non Serializable class cannot be added to TypeSystem', def)
            return
        }
        if (sid !== def.key) {
            console.warn(`TypeSystem: class serializableClassId "${sid}" does not match registered className "${def.key}"`)
        }
        this.Classes.set(def.key, def)
    }

    static GetClass(type: TypedType) {
        const typeStr = typeof type === 'string' ? type : type.type
        return this.Classes.get(typeStr)
    }

    static GetClassType(ctor: Class<any>): ClassName|undefined {
        for (const [type, def] of this.Classes) {
            if (def.ctor === ctor) return type
        }
        return undefined
    }

    // todo cache res in weakmap?
    static GetType(v: any, allowSerializable = true): TypedType | false {
        if (v === undefined) return false // not serializable
        if (v === null) return 'null'
        if (typeof v === 'function') return false
        if (typeof v === 'number') return `${v}`
        if (typeof v === 'string') return `${JSON.stringify(v)}`
        if (typeof v === 'boolean') return `${v}`
        if (Array.isArray(v)) {
            const types = new Set<TypedType>()
            for (const item of v) {
                const typ = this.GetType(item)
                if (!typ) return false
                types.add(typ)
            }
            const typ: TypedType = types.size === 1 ? types.values().next().value : {oneOf: types, type: 'Union'}
            return {arrayOf: typ, type: 'Array'}
        }
        if (typeof v === 'object') {
            const cons = v.constructor
            if (cons) {
                if (cons !== Object) {
                    // if ((v as CtxProxy).isCtxProxy) {
                    //     (v as CtxProxy).ctx = ctx
                    //     // return true // any subclass has to be in SerializableClasses
                    // }
                    const typeName = this.GetClassType(cons)
                    if (typeName) return typeName

                    if (allowSerializable) {
                        if (v.type && Serialization.SerializableClasses.has(v.type)) return v.type
                        if (v.serializableClassId && Serialization.SerializableClasses.has(v.serializableClassId)) return v.serializableClassId
                        const custom = Serialization.GetSerializer(v)
                        // @ts-expect-error type in next version
                        if (custom && typeof custom.type === 'string' && !custom.type.startsWith('_')) return custom.type
                        return false
                    }
                }
            }
            const map = new Map<KeyofPropType, TypedType>()
            for (const k in v) {
                const val = v[k]
                if (typeof val === 'function') continue
                const typ = this.GetType(val)
                if (!typ) return false
                map.set(k, typ)
            }
            return {recordOf: map, type: 'Object'}
        }
        return false
    }

    static NonLiteral(type: TypedType): TypedType {
        if (typeof type !== 'string') return type
        if (/^"(?:[^"\\]|\\.)*"$/.test(type)) return 'string'
        if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(type)) return 'number'
        if (type === 'true' || type === 'false') return 'boolean'
        if (type === 'Infinity' || type === '-Infinity' || type === 'NaN') return 'number'
        return type
    }

    static TypeToString(type: TypedType): string {
        if (typeof type === 'string') return type
        if ('oneOf' in type) {
            return `(${Array.from(type.oneOf).map(t=>this.TypeToString(t)).join('|')})`
        }
        if ('arrayOf' in type) {
            return `Array<${this.TypeToString(type.arrayOf)}>`
        }
        if ('recordOf' in type) {
            const entries = Array.from(type.recordOf.entries()).map(([k, v])=>`${k}: ${this.TypeToString(v)}`)
            return `{ ${entries.join('; ')} }`
        }
        return type.type
    }
    /**
     * Returns true if `tar = src` is valid
     * @param src
     * @param tar
     * @constructor
     */
    static CanAssign(src: TypedType, tar: TypedType): boolean {
        if (src === tar) return true
        const srcClass = this.GetClass(src)
        const tarClass = this.GetClass(tar)
        if (srcClass && srcClass === tarClass) return true
        if (typeof tar === 'string') {
            if (typeof src === 'string') {
                const nonLiteralSrc = this.NonLiteral(src)
                if (nonLiteralSrc === tar) return true
                // console.log('mismatch', tar, src, nonLiteralSrc)
                return false
            }
            if ('oneOf' in src) {
                const union = src.oneOf
                for (const u of union) {
                    if (!this.CanAssign(u, tar)) return false
                }
                return true
            }
            if ('arrayOf' in src) {
                // return tar === 'Array'
                return false
            }
            if ('recordOf' in src) {
                // return tar === 'Object'
                return false
            }
            return false
        }
        if ('oneOf' in tar) {
            const union = tar.oneOf
            for (const u of union) {
                if (this.CanAssign(src, u)) return true
            }
            return false
        }
        if ('arrayOf' in tar) {
            if (typeof src !== 'string' && 'arrayOf' in src) {
                return this.CanAssign(src.arrayOf, tar.arrayOf)
            }
            return false
        }
        if ('recordOf' in tar) {
            if (typeof src !== 'string' && 'recordOf' in src) {
                for (const [k, v] of tar.recordOf) {
                    const srcV = src.recordOf.get(k)
                    if (!srcV || !this.CanAssign(srcV, v)) return false
                }
                return true
            }
            return false
        }
        return false
    }
}

/**
 * Sample usage -
 * ```typescript
 * export const physicsBodyType = ['static', 'dynamic', 'kinematic'] as const
 * export type PhysicsBodyType = typeof physicsBodyType[number]
 * export class PhysicsComponent extends Object3DComponent {
 *     static ComponentType = 'PhysicsComponent'
 *     static StateProperties: ComponentDefn['StateProperties'] = ['mass', {
 *         key: 'type',
 *         type: literalStrings(physicsBodyType),
 *     }]
 *     // ...
 * }
 * ```
 * @param type
 */
export function literalStrings<T extends string|number|boolean = string|number|boolean>(type: T[] | readonly T[]) {
    return {oneOf: type.map(t=>typeof t === 'number' || typeof t === 'boolean' ? `${t}` : `"${t}"`) as (`"${T}"`)[], type: 'Union'} as const
}
