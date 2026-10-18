/**
 * Properties of the machine Blender ran on that change geometry-node *results* (not just speed).
 *
 * `BLI_system_thread_count()`: `mesh_calc_edges` splits edges over `power_of_2_min(min(8, threads))` hash
 * maps for meshes with 1000+ faces (`mesh_calc_edges.cc:177`), which decides the edge order. The default,
 * 8, matches every machine with 8 or more threads (the reference Mac). Set it to reproduce output from a
 * machine with fewer threads.
 */
export const blenderSystem = {
    threadCount: 8,
}

/** `power_of_2_min_i` (`math_base_inline.cc:123`). */
export function powerOf2MinI(n: number): number {
    while (n & (n - 1)) n = n & (n - 1)
    return n
}
