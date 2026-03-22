/**
 * ModuleKit — lightweight asset registry for reusable geometry/material pairs.
 * Used by building generators to swap architectural styles by changing the module kit.
 *
 * Not a plugin — just a class. Generators that need modular assets use it;
 * generators that don't (terrain, noise effects) ignore it.
 *
 * The pickBySize method mirrors Buildify's pattern:
 * "polygon size → small/medium/large detail collection."
 *
 * Reference: Buildify addon documentation
 * https://paveloliva.gumroad.com/l/buildify
 */

import {BoxGeometry, BufferGeometry, Color, CylinderGeometry, PlaneGeometry, type IMaterial, PhysicalMaterial} from 'threepipe'
import {SeededRandom} from '../utils/SeededRandom'

export interface ModuleMeta {
    width: number
    height: number
    depth: number
    tags?: string[]
    weight?: number
}

export interface ModuleEntry {
    geometry: BufferGeometry
    material: IMaterial
    meta: ModuleMeta
}

export class ModuleKit {
    private _categories = new Map<string, Map<string, ModuleEntry>>()

    add(category: string, id: string, geometry: BufferGeometry, material: IMaterial, meta: ModuleMeta): void {
        if (!this._categories.has(category)) this._categories.set(category, new Map())
        this._categories.get(category)!.set(id, {geometry, material, meta})
    }

    get(category: string, id?: string): ModuleEntry {
        const cat = this._categories.get(category)
        if (!cat || cat.size === 0) throw new Error(`ModuleKit: category '${category}' not found or empty`)
        if (id) {
            const entry = cat.get(id)
            if (!entry) throw new Error(`ModuleKit: module '${id}' not found in category '${category}'`)
            return entry
        }
        return cat.values().next().value!
    }

    getAll(category: string): ModuleEntry[] {
        const cat = this._categories.get(category)
        if (!cat) return []
        return [...cat.values()]
    }

    pick(category: string, rng: SeededRandom): ModuleEntry {
        const all = this.getAll(category)
        if (all.length === 0) throw new Error(`ModuleKit: category '${category}' is empty`)
        const totalWeight = all.reduce((sum, e) => sum + (e.meta.weight ?? 1), 0)
        let r = rng.next() * totalWeight
        for (const entry of all) {
            r -= entry.meta.weight ?? 1
            if (r <= 0) return entry
        }
        return all[all.length - 1]
    }

    /**
     * Pick a module whose size best matches the target area.
     * Mirrors Buildify's "face area → small/medium/large detail" pattern.
     */
    pickBySize(category: string, targetArea: number, rng: SeededRandom): ModuleEntry {
        const all = this.getAll(category)
        if (all.length === 0) throw new Error(`ModuleKit: category '${category}' is empty`)
        // Sort by area difference
        const sorted = all.map(e => ({
            entry: e,
            areaDiff: Math.abs(e.meta.width * e.meta.height - targetArea),
        })).sort((a, b) => a.areaDiff - b.areaDiff)
        // Pick from top 3 closest matches
        const candidates = sorted.slice(0, Math.min(3, sorted.length))
        return candidates[Math.floor(rng.next() * candidates.length)].entry
    }

    /**
     * Create a procedural architectural module kit.
     * Generates windows, doors, panels, and ledges from basic geometry.
     * No external assets needed.
     *
     * Dimensions based on standard architectural proportions:
     * Reference: Neufert, E. "Architects' Data" (standard architectural reference)
     * - Residential window: 1.0-1.4m wide × 1.2-1.6m tall
     * - Door: 0.9-1.2m wide × 2.1-2.4m tall
     * - Floor height: 2.8-3.2m residential, 3.5-4.0m commercial ground floor
     */
    static createArchKit(style: 'modern' | 'classical' | 'industrial'): ModuleKit {
        const kit = new ModuleKit()
        const rng = new SeededRandom(style === 'modern' ? 1 : style === 'classical' ? 2 : 3)

        // Style-dependent colors
        const wallColor = style === 'modern' ? 0xdddddd
            : style === 'classical' ? 0xd4c4a0
                : 0x888888
        const frameColor = style === 'modern' ? 0x333333
            : style === 'classical' ? 0xf0f0f0
                : 0x444444
        const glassColor = 0x88bbdd

        // Wall panel (blank wall section for corners/fills)
        const wallMat = new PhysicalMaterial({color: wallColor, roughness: 0.85, metalness: 0}) as IMaterial
        wallMat.name = 'Wall'

        kit.add('wall', 'blank', new BoxGeometry(1, 1, 0.2), wallMat, {width: 1, height: 1, depth: 0.2})

        // Window module — wall surround + glass pane (no boolean needed)
        // Built as a flat panel with a glass plane recessed behind it
        const frameMat = new PhysicalMaterial({color: frameColor, roughness: 0.3, metalness: style === 'modern' ? 0.8 : 0}) as IMaterial
        frameMat.name = 'Frame'
        const glassMat = new PhysicalMaterial({
            color: glassColor, roughness: 0.05, metalness: 0.1,
            transparent: true, opacity: 0.4,
        }) as IMaterial
        glassMat.name = 'Glass'

        // Small window (for narrow bays)
        const smallWindowGeo = new PlaneGeometry(0.8, 1.2)
        kit.add('window', 'small', smallWindowGeo, glassMat,
            {width: 0.8, height: 1.2, depth: 0.05, tags: ['window']})

        // Standard window
        const stdWindowGeo = new PlaneGeometry(1.2, 1.5)
        kit.add('window', 'standard', stdWindowGeo, glassMat,
            {width: 1.2, height: 1.5, depth: 0.05, tags: ['window'], weight: 2})

        // Large window (for wide bays)
        const largeWindowGeo = new PlaneGeometry(1.8, 1.5)
        kit.add('window', 'large', largeWindowGeo, glassMat,
            {width: 1.8, height: 1.5, depth: 0.05, tags: ['window']})

        // Door
        const doorGeo = new PlaneGeometry(1.0, 2.2)
        const doorMat = new PhysicalMaterial({
            color: style === 'modern' ? 0x333333 : 0x654321,
            roughness: 0.6, metalness: style === 'modern' ? 0.3 : 0,
        }) as IMaterial
        doorMat.name = 'Door'
        kit.add('door', 'standard', doorGeo, doorMat,
            {width: 1.0, height: 2.2, depth: 0.05, tags: ['door']})

        // Ledge/cornice (horizontal element between floors)
        const ledgeGeo = new BoxGeometry(1, 0.1, 0.25)
        kit.add('ledge', 'standard', ledgeGeo, wallMat,
            {width: 1, height: 0.1, depth: 0.25, tags: ['ledge']})

        return kit
    }

    /**
     * Create a procedural vegetation module kit.
     */
    static createVegKit(biome: 'temperate' | 'tropical' | 'arid'): ModuleKit {
        const kit = new ModuleKit()
        const rng = new SeededRandom(biome === 'temperate' ? 10 : biome === 'tropical' ? 20 : 30)

        const treeColor = biome === 'temperate' ? 0x3a7d2c
            : biome === 'tropical' ? 0x2d8a4e
                : 0x6b8e3b

        const treeMat = new PhysicalMaterial({color: treeColor, roughness: 0.9, metalness: 0}) as IMaterial
        treeMat.name = 'Tree'

        // Simple tree (cone canopy)
        const treeGeo = new CylinderGeometry(0, 0.4, 1.0, 6)
        treeGeo.translate(0, 0.8, 0)
        kit.add('tree', 'conifer', treeGeo, treeMat,
            {width: 0.8, height: 1.8, depth: 0.8, weight: 2})

        // Bush
        const bushMat = new PhysicalMaterial({
            color: new Color(treeColor).offsetHSL(0, 0, -0.05).getHex(),
            roughness: 0.95, metalness: 0,
        }) as IMaterial
        bushMat.name = 'Bush'
        const bushGeo = new CylinderGeometry(0.3, 0.3, 0.3, 6)
        bushGeo.translate(0, 0.15, 0)
        kit.add('bush', 'round', bushGeo, bushMat,
            {width: 0.6, height: 0.3, depth: 0.6})

        return kit
    }
}
