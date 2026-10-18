/**
 * Which objects a box touches in object mode.
 *
 * Blender's `do_object_box_select` (`editors/space_view3d/view3d_select.cc`) draws every selectable
 * object with its select id under `GPU_SELECT_ALL`: depth test "always" and one occlusion query per
 * object (`gpu/intern/gpu_select_sample_query.cc`). An object is inside when any of its triangles
 * covers a pixel of the rectangle - whether or not something else is in front of it. That is unlike
 * edit-mode box select, which only takes visible elements.
 *
 * This is the same test on the CPU: each triangle is projected and intersected with the rectangle,
 * after a projected-bounding-box early out. Triangles with a corner behind the camera are skipped;
 * Blender clips them, which only matters for objects the camera is inside.
 */

/** A world position in canvas CSS pixels (y down), or null when behind the camera. */
export type ProjectToCanvas = (x: number, y: number, z: number) => [number, number] | null

export interface CanvasRect {
    x0: number
    y0: number
    x1: number
    y1: number
}

function normRect(r: CanvasRect): CanvasRect {
    return {x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1)}
}

/**
 * Whether a 2D triangle and an axis-aligned rectangle overlap: the separating axis test over the
 * rectangle's two axes and the triangle's three edge normals.
 */
export function triangleIntersectsRect(
    ax: number, ay: number, bx: number, by: number, cx: number, cy: number, rect: CanvasRect,
): boolean {
    const r = normRect(rect)
    // The rectangle's axes.
    if (Math.max(ax, bx, cx) < r.x0 || Math.min(ax, bx, cx) > r.x1) return false
    if (Math.max(ay, by, cy) < r.y0 || Math.min(ay, by, cy) > r.y1) return false
    // The triangle's edges.
    const corners = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]
    const tri = [[ax, ay], [bx, by], [cx, cy]]
    for (let i = 0; i < 3; i++) {
        const [px, py] = tri[i]
        const [qx, qy] = tri[(i + 1) % 3]
        const nx = qy - py
        const ny = px - qx
        let tMin = Infinity, tMax = -Infinity
        for (const [x, y] of tri) {
            const d = nx * x + ny * y
            tMin = Math.min(tMin, d)
            tMax = Math.max(tMax, d)
        }
        let rMin = Infinity, rMax = -Infinity
        for (const [x, y] of corners) {
            const d = nx * x + ny * y
            rMin = Math.min(rMin, d)
            rMax = Math.max(rMax, d)
        }
        if (tMax < rMin || rMax < tMin) return false
    }
    return true
}

/**
 * Whether any triangle of a mesh (positions in world space after `toWorld`) covers part of the
 * rectangle. `index` null means a non-indexed triangle list.
 */
export function meshTouchesRect(
    positions: ArrayLike<number>,
    index: ArrayLike<number> | null,
    project: ProjectToCanvas,
    rect: CanvasRect,
): boolean {
    const r = normRect(rect)
    const n = positions.length / 3
    const sx = new Float64Array(n)
    const sy = new Float64Array(n)
    const ok = new Uint8Array(n)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < n; i++) {
        const p = project(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
        if (!p) continue
        ok[i] = 1
        sx[i] = p[0]
        sy[i] = p[1]
        minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0])
        minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1])
    }
    // Early outs on the projected bounds.
    if (maxX < r.x0 || minX > r.x1 || maxY < r.y0 || minY > r.y1) return false
    const triCount = index ? Math.floor(index.length / 3) : Math.floor(n / 3)
    for (let t = 0; t < triCount; t++) {
        const a = index ? index[t * 3] : t * 3
        const b = index ? index[t * 3 + 1] : t * 3 + 1
        const c = index ? index[t * 3 + 2] : t * 3 + 2
        if (!ok[a] || !ok[b] || !ok[c]) continue
        if (triangleIntersectsRect(sx[a], sy[a], sx[b], sy[b], sx[c], sy[c], r)) return true
    }
    return false
}
