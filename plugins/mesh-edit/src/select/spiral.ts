/**
 * Square-spiral search over a 2D array, outwards from a centre cell.
 *
 * Port of `_bli_array_iter_spiral_square` (`blenlib/intern/array_utils_c.cc:290`), which Blender's
 * selection buffer uses to find the id nearest the cursor (`DRW_select_buffer_find_nearest_to_point`,
 * `draw/intern/draw_select_buffer.cc`). The visiting order is kept exactly - centre first, then each
 * square ring from its negative-quadrant diagonal - because it decides which of two equally distant ids
 * wins, and matching Blender there is what makes a click land where a Blender user expects.
 *
 * Works on a row-major array with `shape = [rows, cols]` and `center = [row, col]`; Blender's code is
 * written over a byte pointer and strides, and the strides here are in elements.
 */
export function spiralSquare(
    shape: readonly [number, number],
    center: readonly [number, number],
    test: (index: number) => boolean,
): number {
    const rows = shape[0]
    const cols = shape[1]
    if (!(center[0] >= 0 && center[1] >= 0 && center[0] < rows && center[1] < cols)) {
        throw new Error(`spiralSquare: centre ${center} outside ${shape}`)
    }
    // Blender: stride = {arr_shape[0] * elem_size, elem_size}. Its first axis steps by `rows`, which
    // only equals a row step because every caller passes a square array; keep it, and require square.
    if (rows !== cols) throw new Error('spiralSquare: Blender\'s iterator assumes a square array')
    const stride = [rows, 1]

    // Test centre first.
    const ofs = [center[0] * stride[1], center[1] * stride[0]]
    if (test(ofs[0] + ofs[1])) return ofs[0] + ofs[1]

    // `steps_in`/`steps_out` are the "diameters" of the inscribed and circumscribed squares.
    const xMinus = center[0]
    const xPlus = rows - center[0] - 1
    const yMinus = center[1]
    const yPlus = cols - center[1] - 1
    const stepsIn = 2 * Math.min(xMinus, xPlus, yMinus, yPlus)
    const stepsOut = 2 * Math.max(xMinus, xPlus, yMinus, yPlus)

    // For bounds checks.
    const limits = [(rows - 1) * stride[0], stride[0] - stride[1]]

    let steps = 0
    while (steps < stepsOut) {
        steps += 2

        // Move one step to the diagonal of the negative quadrant.
        ofs[0] -= stride[0]
        ofs[1] -= stride[1]

        const checkBounds = steps > stepsIn

        // Sign: 0 = negative, 1 = positive.
        for (let sign = 2; sign--;) {
            // Axis: 0 = x, 1 = y.
            for (let axis = 2; axis--;) {
                let ofsStep = stride[axis]
                if (!sign) ofsStep *= -1

                let ofsIter = ofs[axis] + ofsStep
                let ofsDest = ofs[axis] + steps * ofsStep
                const ofsOther = ofs[axis === 0 ? 1 : 0]

                ofs[axis] = ofsDest
                if (checkBounds) {
                    const otherLimit = limits[axis === 0 ? 1 : 0]
                    if (ofsOther < 0 || ofsOther > otherLimit) continue // out of bounds
                    ofsIter = Math.min(Math.max(ofsIter, 0), limits[axis])
                    ofsDest = Math.min(Math.max(ofsDest, 0), limits[axis])
                }

                for (;;) {
                    const index = ofsOther + ofsIter
                    if (test(index)) return index
                    if (ofsIter === ofsDest) break
                    ofsIter += ofsStep
                }
            }
        }
    }
    return -1
}

/**
 * The id nearest the centre of a square id buffer, and its Manhattan distance in cells.
 *
 * `DRW_select_buffer_find_nearest_to_point`: ids are 1-based, 0 is empty. `ids` is row-major in GL
 * order (row 0 at the bottom), `size` its odd width.
 */
export function findNearestId(
    ids: ArrayLike<number>,
    size: number,
    accept: (id: number) => boolean = id => id !== 0,
): {id: number, dist: number} | null {
    const c = (size - 1) / 2
    const hit = spiralSquare([size, size], [c, c], i => {
        const id = ids[i]
        return id !== 0 && accept(id)
    })
    if (hit < 0) return null
    const row = Math.floor(hit / size)
    const col = hit % size
    return {id: ids[hit], dist: Math.abs(row - c) + Math.abs(col - c)}
}
