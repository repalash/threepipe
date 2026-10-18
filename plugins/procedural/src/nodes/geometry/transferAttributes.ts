/**
 * Transfer Attributes (`node_geo_transfer_attributes.cc`): attributes whose names match the patterns are copied from
 * the Source to the Target component of the same type, element by element, by index or by matching ID fields per
 * domain. Attributes are stored as arrays here, so Blender's single-value and implicit-sharing shortcuts take the
 * array paths with the same values.
 */

import {AttrDomain} from '@threepipe/mesh-kernel'
import {FieldContext, FieldEvaluation, GField, IndexFieldInput} from '../../fields'
import type {AttributeAccessor} from '../../geometry/attributeAccessor'
import {DATA_TYPES, DataType} from '../../geometry/dataTypes'
import {ComponentType} from '../../geometry/GeometrySet'
import {BlenderStringVectorSet} from '../../blender/map'
import {GList} from '../../runtime/list'
import {registerNodeType} from '../../runtime/registry'
import {Pattern, patternFromString, patternMatch} from './attributeOps'

const DOMAINS: [string, AttrDomain][] = [
    ['Point', AttrDomain.Point], ['Edge', AttrDomain.Edge], ['Face', AttrDomain.Face], ['Corner', AttrDomain.Corner],
    ['Curve', AttrDomain.Curve], ['Instance', AttrDomain.Instance],
]

interface IDs {
    byIndex: boolean
    srcByDst?: Int32Array
    gather?: number[]
    defaults?: number[]
}

/** `transfer_attributes` (:85). */
function transfer(patterns: Pattern[], exclude: boolean, srcType: ComponentType, src: AttributeAccessor, srcComponent: unknown,
    dst: AttributeAccessor, dstComponent: unknown, srcIds: Map<AttrDomain, GField>, dstIds: Map<AttrDomain, GField>,
    transferred: BlenderStringVectorSet, found: boolean[]): void {
    const items: {name: string, domain: AttrDomain, type: DataType}[] = []
    const domains = new Map<AttrDomain, IDs>()
    for (const name of src.names()) {
        // `should_transfer` (:66).
        if (name === '.corner_vert' || name === '.corner_edge' || name === '.edge_verts') continue
        let match = false
        patterns.forEach((p, i) => {
            if (patternMatch(p, name)) {
                match = true
                found[i] = true
            }
        })
        if (exclude ? match : !match) continue
        const meta = src.lookupMeta(name)!
        items.push({name, domain: meta.domain, type: meta.type})
        if (!domains.has(meta.domain)) domains.set(meta.domain, {byIndex: false})
    }
    for (const [domain, ids] of domains) {
        const s = srcIds.get(domain)!, d = dstIds.get(domain)!
        if (s.node instanceof IndexFieldInput && d.node instanceof IndexFieldInput) {
            ids.byIndex = true
            continue
        }
        const srcSize = src.domainSize(domain), dstSize = dst.domainSize(domain)
        const sv = new FieldEvaluation(new FieldContext(srcType, srcComponent as never, domain), srcSize).evaluate(s)
        const dv = new FieldEvaluation(new FieldContext(srcType, dstComponent as never, domain), dstSize).evaluate(d)
        // `Map::add`: the first source element with an ID wins.
        const byId = new Map<number, number>()
        for (let i = 0; i < srcSize; i++) if (!byId.has(sv.get(i))) byId.set(sv.get(i), i)
        ids.srcByDst = Int32Array.from({length: dstSize}, (_, i) => byId.get(dv.get(i)) ?? -1)
        ids.gather = []
        ids.defaults = []
        for (let i = 0; i < dstSize; i++) (ids.srcByDst[i] >= 0 ? ids.gather : ids.defaults).push(i)
    }
    for (const item of items) {
        const ids = domains.get(item.domain)!
        const c = DATA_TYPES[item.type].components
        const srcData = src.storage.get(item.name)!.data
        const srcSize = src.domainSize(item.domain), dstSize = dst.domainSize(item.domain)
        const old = dst.lookupMeta(item.name)
        const matching = !!old && old.domain === item.domain && old.type === item.type
        const def = DATA_TYPES[item.type].defaultValue
        /** `add_override`: remove, then add (fails for built-ins that cannot be removed). */
        const addOverride = (data: ArrayLike<number>) => {
            dst.remove(item.name)
            const arr = new DATA_TYPES[item.type].array(dstSize * c)
            arr.set(Array.from(data))
            if (dst.add(item.name, item.domain, item.type, arr)) transferred.add(item.name)
        }
        const copy = (out: ArrayLike<number> & {[i: number]: number}, d: number, s: number) => {
            for (let k = 0; k < c; k++) out[d * c + k] = srcData[s * c + k]
        }
        if (ids.byIndex) {
            const n = Math.min(srcSize, dstSize)
            if (old) {
                if (matching) {
                    const layer = dst.layerForWrite(item.name)!
                    for (let i = 0; i < n; i++) copy(layer.data, i, i)
                    transferred.add(item.name)
                    continue
                }
                // The rest keeps the old values, read on the item's domain as its type.
                const adapted = dst.lookup(item.name, item.domain, item.type)
                if (!adapted) continue
                const data = new Array<number>(dstSize * c)
                for (let i = 0; i < dstSize; i++) for (let k = 0; k < c; k++) data[i * c + k] = i < n ? srcData[i * c + k] : adapted.get(i, k)
                addOverride(data)
                continue
            }
            const data = new Array<number>(dstSize * c)
            for (let i = 0; i < dstSize; i++) for (let k = 0; k < c; k++) data[i * c + k] = i < n ? srcData[i * c + k] : def[k]
            const arr = new DATA_TYPES[item.type].array(dstSize * c)
            arr.set(data)
            if (dst.add(item.name, item.domain, item.type, arr)) transferred.add(item.name)
            continue
        }
        const map = ids.srcByDst!
        if (ids.gather!.length === dstSize) {
            if (matching) {
                const layer = dst.layerForWrite(item.name)!
                for (let i = 0; i < dstSize; i++) copy(layer.data, i, map[i])
                transferred.add(item.name)
                continue
            }
            const data = new Array<number>(dstSize * c)
            for (let i = 0; i < dstSize; i++) for (let k = 0; k < c; k++) data[i * c + k] = srcData[map[i] * c + k]
            addOverride(data)
            continue
        }
        if (matching) {
            const layer = dst.layerForWrite(item.name)!
            for (const i of ids.gather!) copy(layer.data, i, map[i])
            transferred.add(item.name)
            continue
        }
        const data = new Array<number>(dstSize * c).fill(0)
        for (const i of ids.gather!) for (let k = 0; k < c; k++) data[i * c + k] = srcData[map[i] * c + k]
        if (!old) {
            for (const i of ids.defaults!) for (let k = 0; k < c; k++) data[i * c + k] = def[k]
            const arr = new DATA_TYPES[item.type].array(dstSize * c)
            arr.set(data)
            if (dst.add(item.name, item.domain, item.type, arr)) transferred.add(item.name)
            continue
        }
        const adapted = dst.lookup(item.name, item.domain, item.type)
        if (!adapted) continue
        for (const i of ids.defaults!) for (let k = 0; k < c; k++) data[i * c + k] = adapted.get(i, k)
        addOverride(data)
    }
}

registerNodeType({
    idname: 'GeometryNodeTransferAttributes',
    label: 'Transfer Attributes',
    declare(b) {
        b.input('GEOMETRY', 'Target')
        b.output('GEOMETRY', 'Target')
        b.output('STRING', 'Transferred Names').list()
        for (const [d] of DOMAINS) b.input('INT', `Target ${d} ID`).implicit('INDEX').field()
        b.input('GEOMETRY', 'Source')
        for (const [d] of DOMAINS) b.input('INT', `Source ${d} ID`).implicit('INDEX').field()
        b.input('MENU', 'Pattern Mode').default('Wildcard')
        b.input('STRING', 'Attribute Names').list()
        b.input('BOOLEAN', 'Exclude Names').default(false)
    },
    // `node_geo_exec` (:366).
    execute(p) {
        const dst = p.geometry('Target'), src = p.geometry('Source')
        const mode = p.string('Pattern Mode')
        const list = p.get('Attribute Names')
        const exclude = p.bool('Exclude Names')
        const dstIds = new Map(DOMAINS.map(([d, dom]) => [dom, p.field(`Target ${d} ID`)]))
        const srcIds = new Map(DOMAINS.map(([d, dom]) => [dom, p.field(`Source ${d} ID`)]))
        const patterns: Pattern[] = []
        if (list instanceof GList && list.type === 'STRING') {
            for (let i = 0; i < list.size; i++) {
                const pattern = patternFromString(mode, String(list.item(i)))
                if (typeof pattern === 'string') p.warn(pattern)
                else patterns.push(pattern)
            }
        }
        if (!patterns.length && !exclude) {
            p.set('Target', dst)
            p.set('Transferred Names', GList.fromItems('STRING', []))
            return
        }
        const transferred = new BlenderStringVectorSet()
        const found = patterns.map(() => false)
        for (const type of ['mesh', 'pointcloud', 'curves', 'instances'] as ComponentType[]) {
            if (!dst.has(type) || !src.has(type)) continue
            transfer(patterns, exclude, type, src.attributes(type)!, src.get(type), dst.attributesForWrite(type)!, dst.get(type), srcIds, dstIds, transferred, found)
        }
        // `remove_if` on the VectorSet (:502): internal names go, the last names filling their places.
        transferred.removeIf(name => name.startsWith('.'))
        if (!exclude) {
            patterns.forEach((pattern, i) => {
                const full = 'exact' in pattern ? pattern.exact : `${pattern.prefix}*${pattern.suffix}`
                if (full && !found[i]) p.warn(`No attribute found matching "${full}"`)
            })
        }
        p.set('Target', dst)
        p.set('Transferred Names', GList.fromItems('STRING', [...transferred.keys]))
    },
})
