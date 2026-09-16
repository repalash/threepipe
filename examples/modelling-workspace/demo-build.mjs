/**
 * Scripted build of a floating house on a boat hull.
 *
 * Every step goes through the same public API the keyboard and gizmos drive, which is the point: the
 * scripting surface is the agent surface, so a tool that only works from a gizmo is not finished.
 *
 * The model is original. It is the same *subject* as the reference that inspired this project - a
 * stilt house on a hull, of the kind found on lake settlements - but the geometry, proportions and
 * layout are my own rather than a copy of anyone's model.
 *
 * Loaded into the page by the recorder; `ctx` carries the viewer and plugins.
 */

export function buildDemo(ctx) {
    const {viewer, picking, meshEdit, generators, THREE} = ctx

    const wait = ms => new Promise(r => setTimeout(r, ms))

    /** Add a primitive, name it, place it, size it. */
    function add(type, name, pos, scale, rot) {
        const obj = generators.generate('geometry-' + type, {})
        if (!obj) throw new Error('no generator for ' + type)
        obj.name = name
        obj.position.set(...pos)
        if (scale) obj.scale.set(...scale)
        if (rot) obj.rotation.set(...rot)
        obj.setDirty?.()
        return obj
    }

    /** Duplicate an object in object mode, offset it, and name the copy. */
    function dup(src, name, offset, scale) {
        const copy = src.clone()
        copy.name = name
        copy.position.set(
            src.position.x + offset[0], src.position.y + offset[1], src.position.z + offset[2])
        if (scale) copy.scale.set(...scale)
        viewer.scene.addObject(copy)
        return copy
    }

    /** Shape a mesh in edit mode: select faces by a predicate, then move or extrude them. */
    function editFaces(obj, {select, extrude, move, scale}) {
        picking.setSelectedObject(obj)
        meshEdit.enter(obj)
        const bm = meshEdit.state.bm
        meshEdit.setSelectMode(4) // face
        meshEdit.deselectAllElements()

        let picked = 0
        for (const f of [...bm.faces]) {
            const verts = [...f.eachLoop()].map(l => l.v)
            const c = verts.reduce((a, v) => [a[0] + v.x, a[1] + v.y, a[2] + v.z], [0, 0, 0])
                .map(x => x / verts.length)
            if (select(c, verts)) {
                meshEdit.selectElement(f, true)
                picked++
            }
        }
        if (picked) {
            if (extrude) {
                meshEdit.extrude()
                const t = meshEdit.activeTransform
                // Drive the modal transform exactly as a typed value would.
                t.setAxis(extrude.axis)
                for (const ch of String(extrude.amount)) t.handleNumericKey(ch)
                meshEdit.confirmTransform()
            }
            if (move) {
                meshEdit.startTransform('translate')
                const t = meshEdit.activeTransform
                t.setAxis(move.axis)
                for (const ch of String(move.amount)) t.handleNumericKey(ch)
                meshEdit.confirmTransform()
            }
            if (scale) {
                meshEdit.startTransform('resize')
                const t = meshEdit.activeTransform
                if (scale.axis !== undefined) t.setAxis(scale.axis)
                for (const ch of String(scale.amount)) t.handleNumericKey(ch)
                meshEdit.confirmTransform()
            }
        }
        meshEdit.exit(true)
        return picked
    }

    /**
     * Frame the scene from an angle. Eased rather than cut, so the recording reads as a camera move
     * instead of a jump.
     */
    async function look(azimuth, elevation, distance, ms = 900) {
        const cam = viewer.scene.mainCamera
        const from = cam.position.clone()
        const target = new (from.constructor)(
            Math.cos(elevation) * Math.sin(azimuth) * distance,
            Math.sin(elevation) * distance + 1.2,
            Math.cos(elevation) * Math.cos(azimuth) * distance)
        const frames = Math.max(1, Math.round(ms / 16))
        for (let i = 1; i <= frames; i++) {
            const t = i / frames
            const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2 // ease in-out
            cam.position.set(
                from.x + (target.x - from.x) * e,
                from.y + (target.y - from.y) * e,
                from.z + (target.z - from.z) * e)
            cam.target.set(0, 0.9, 0)
            cam.setDirty?.()
            viewer.setDirty()
            await wait(16)
        }
    }

    return (async () => {
        const steps = []
        const log = s => {
            steps.push(s)
            const el = document.getElementById('build-log')
            if (el) el.textContent = s
        }

        // ---- 1. the hull ------------------------------------------------------------------
        log('Hull: a box, tapered below the waterline')
        const hull = add('box', 'hull', [0, 0, 0], [6.4, 0.9, 2.4])
        await wait(500)

        // Pull the bottom face in to give the hull a keel-ward taper.
        editFaces(hull, {select: c => c[1] < -0.3, scale: {amount: 0.55}})
        await wait(400)
        // And narrow the bow by moving its face inward.
        editFaces(hull, {select: c => c[0] > 0.3, scale: {amount: 0.6}})
        await wait(500)
        await look(0.9, 0.3, 11)

        // ---- 2. the deck ------------------------------------------------------------------
        log('Deck: a thin slab across the hull')
        const deck = add('box', 'deck', [0, 0.55, 0], [6.6, 0.12, 2.7])
        await wait(600)

        // ---- 3. the cabin -----------------------------------------------------------------
        log('Cabin: a box, walls extruded upward in edit mode')
        const cabin = add('box', 'cabin', [-1.1, 1.15, 0], [3.4, 1.1, 2.2])
        await wait(500)
        // Extrude the roof face up to make the wall taller, using the typed modal transform.
        editFaces(cabin, {select: c => c[1] > 0.3, extrude: {axis: 1, amount: 0.35}})
        await wait(600)
        await look(1.7, 0.35, 12)

        // ---- 4. the roof ------------------------------------------------------------------
        log('Roof: a pitched slab, duplicated and mirrored')
        const roofA = add('box', 'roof-a', [-1.1, 2.0, -0.62], [3.8, 0.08, 1.5], [0.42, 0, 0])
        await wait(450)
        const roofB = dup(roofA, 'roof-b', [0, 0, 1.24])
        roofB.rotation.set(-0.42, 0, 0)
        roofB.setDirty?.()
        await wait(600)

        // ---- 5. the veranda posts ---------------------------------------------------------
        log('Posts: one cylinder, duplicated along the deck')
        const post = add('cylinder', 'post', [1.25, 1.25, -1.0], [0.07, 1.3, 0.07])
        await wait(450)
        const posts = [post]
        for (const [i, p] of [[0, [0, 0, 2.0]], [1, [1.4, 0, 0]], [2, [1.4, 0, 2.0]]]) {
            posts.push(dup(post, 'post-' + i, p))
            await wait(220)
        }
        await look(2.5, 0.28, 12)

        // ---- 6. the veranda roof ----------------------------------------------------------
        log('Veranda roof')
        add('box', 'veranda-roof', [1.95, 1.95, 0], [2.6, 0.07, 2.4])
        await wait(500)

        // ---- 7. railings ------------------------------------------------------------------
        log('Railings: a rail, duplicated down both sides')
        const rail = add('box', 'rail', [1.95, 0.95, -1.15], [2.5, 0.05, 0.05])
        await wait(350)
        dup(rail, 'rail-b', [0, 0, 2.3])
        await wait(350)

        // ---- 8. floats and clutter --------------------------------------------------------
        log('Floats: cylinders along the hull, then crates on deck')
        const float = add('cylinder', 'float', [-2.6, -0.15, -1.35], [0.28, 0.5, 0.28],
            [Math.PI / 2, 0, 0])
        await wait(300)
        for (const [i, p] of [[0, [2.0, 0, 0]], [1, [0, 0, 2.7]], [2, [2.0, 0, 2.7]]]) {
            dup(float, 'float-' + i, p)
            await wait(200)
        }

        const crate = add('box', 'crate', [2.3, 0.85, 0.55], [0.45, 0.45, 0.45])
        await wait(250)
        dup(crate, 'crate-b', [-0.55, 0, -0.2], [0.34, 0.34, 0.34])
        await wait(250)
        dup(crate, 'crate-c', [0.1, 0.45, 0.05], [0.3, 0.3, 0.3])
        await wait(300)

        // ---- 9. a chimney, shaped with a taper --------------------------------------------
        log('Chimney: extruded and tapered')
        const pipe = add('cylinder', 'chimney', [-2.2, 2.35, 0.4], [0.09, 0.45, 0.09])
        await wait(400)

        // ---- 10. final orbit ---------------------------------------------------------------
        log('Done')
        picking.setSelectedObject(null)
        await look(0.6, 0.22, 13, 700)
        await look(2.2, 0.3, 12, 900)
        await look(3.9, 0.25, 12, 900)
        await look(5.4, 0.35, 13, 900)

        return {
            steps: steps.length,
            objects: viewer.scene.modelRoot.children.filter(c => c.assetType !== 'widget').length,
        }
    })()
}
