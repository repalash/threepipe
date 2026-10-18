/**
 * Sorting algorithms whose order with ties (or with comparators that are not strict weak orders) must match Blender's:
 * `BLI_qsort_r` (`blenlib/intern/sort.cc`, FreeBSD qsort) and libc++ `std::stable_sort` (LLVM 19
 * `libcxx/include/__algorithm/stable_sort.h`, the buffered merge sort used for non-trivially-copyable elements such
 * as `std::unique_ptr`, i.e. `__stable_sort_switch` = 0).
 */

/** `BLI_qsort_r` (`sort.cc:72`) on an array of elements; `cmp` returns <0, 0, >0. Element swaps, block `vecswap`s. */
export function bliQsortR<T>(arr: T[], cmp: (a: T, b: T) => number, start = 0, count = arr.length): void {
    const swap = (i: number, j: number) => {
        const t = arr[i]
        arr[i] = arr[j]
        arr[j] = t
    }
    const vecswap = (i: number, j: number, n: number) => {
        for (let k = 0; k < n; k++) swap(i + k, j + k)
    }
    const med3 = (a: number, b: number, c: number) => (cmp(arr[a], arr[b]) < 0
        ? (cmp(arr[b], arr[c]) < 0 ? b : (cmp(arr[a], arr[c]) < 0 ? c : a))
        : (cmp(arr[b], arr[c]) > 0 ? b : (cmp(arr[a], arr[c]) < 0 ? a : c)))
    let a = start, n = count
    for (;;) {
        let swapCnt = 0
        if (n < 7) {
            for (let pm = a + 1; pm < a + n; pm++) for (let pl = pm; pl > a && cmp(arr[pl - 1], arr[pl]) > 0; pl--) swap(pl, pl - 1)
            return
        }
        let pm = a + Math.floor(n / 2)
        if (n > 7) {
            let pl = a
            let pn = a + n - 1
            if (n > 40) {
                const d = Math.floor(n / 8)
                pl = med3(pl, pl + d, pl + 2 * d)
                pm = med3(pm - d, pm, pm + d)
                pn = med3(pn - 2 * d, pn - d, pn)
            }
            pm = med3(pl, pm, pn)
        }
        swap(a, pm)
        let pa = a + 1, pb = a + 1
        let pc = a + n - 1, pd = a + n - 1
        for (;;) {
            let r: number
            while (pb <= pc && (r = cmp(arr[pb], arr[a])) <= 0) {
                if (r === 0) {
                    swapCnt = 1
                    swap(pa, pb)
                    pa++
                }
                pb++
            }
            while (pb <= pc && (r = cmp(arr[pc], arr[a])) >= 0) {
                if (r === 0) {
                    swapCnt = 1
                    swap(pc, pd)
                    pd--
                }
                pc--
            }
            if (pb > pc) break
            swap(pb, pc)
            swapCnt = 1
            pb++
            pc--
        }
        if (swapCnt === 0) {
            for (let pm2 = a + 1; pm2 < a + n; pm2++) for (let pl = pm2; pl > a && cmp(arr[pl - 1], arr[pl]) > 0; pl--) swap(pl, pl - 1)
            return
        }
        const pn = a + n
        let r = Math.min(pa - a, pb - pa)
        if (r > 0) vecswap(a, pb - r, r)
        r = Math.min(pd - pc, pn - pd - 1)
        if (r > 0) vecswap(pb, pn - r, r)
        if ((r = pb - pa) > 1) bliQsortR(arr, cmp, a, r)
        if ((r = pd - pc) > 1) {
            a = pn - r
            n = r
            continue
        }
        return
    }
}

/** `std::__insertion_sort_move` (`stable_sort.h:33`): sorts `src[f1..l1)` into `dst[f2..)`. */
function insertionSortMove<T>(src: T[], f1: number, l1: number, dst: T[], f2: number, less: (a: T, b: T) => boolean): void {
    if (f1 === l1) return
    let last2 = f2
    dst[last2] = src[f1]
    for (++last2; ++f1 !== l1; ++last2) {
        let j2 = last2
        let i2 = j2
        if (less(src[f1], dst[--i2])) {
            dst[j2] = dst[i2]
            for (--j2; i2 !== f2 && less(src[f1], dst[--i2]); --j2) dst[j2] = dst[i2]
            dst[j2] = src[f1]
        } else dst[j2] = src[f1]
    }
}

/** `std::__merge_move_construct` / `__merge_move_assign`: merges `a[f1..l1)` and `b[f2..l2)` into `out[o..)`. */
function mergeMove<T>(a: T[], f1: number, l1: number, b: T[], f2: number, l2: number, out: T[], o: number, less: (x: T, y: T) => boolean): void {
    // `a` and `b` are the same array in every call; read before writing is safe as `out` is a different array.
    for (;; ++o) {
        if (f1 === l1) {
            for (; f2 !== l2; ++f2, ++o) out[o] = b[f2]
            return
        }
        if (f2 === l2) {
            for (; f1 !== l1; ++f1, ++o) out[o] = a[f1]
            return
        }
        if (less(b[f2], a[f1])) out[o] = b[f2++]
        else out[o] = a[f1++]
    }
}

/** `std::__stable_sort_move` (`stable_sort.h:132`). */
function stableSortMove<T>(arr: T[], f1: number, l1: number, less: (a: T, b: T) => boolean, len: number, buf: T[], f2: number): void {
    switch (len) {
    case 0:
        return
    case 1:
        buf[f2] = arr[f1]
        return
    case 2:
        if (less(arr[l1 - 1], arr[f1])) {
            buf[f2] = arr[l1 - 1]
            buf[f2 + 1] = arr[f1]
        } else {
            buf[f2] = arr[f1]
            buf[f2 + 1] = arr[l1 - 1]
        }
        return
    }
    if (len <= 8) {
        insertionSortMove(arr, f1, l1, buf, f2, less)
        return
    }
    const l2 = Math.floor(len / 2)
    const m = f1 + l2
    stableSort(arr, f1, m, less, l2, buf, f2, l2)
    stableSort(arr, m, l1, less, len - l2, buf, f2 + l2, len - l2)
    mergeMove(arr, f1, m, arr, m, l1, buf, f2, less)
}

/** `std::__stable_sort` (`stable_sort.h:192`) with a buffer at least `len` long (always the case at the top level). */
function stableSort<T>(arr: T[], first: number, last: number, less: (a: T, b: T) => boolean, len: number, buf: T[], bo: number, bufSize: number): void {
    switch (len) {
    case 0:
    case 1:
        return
    case 2:
        if (less(arr[last - 1], arr[first])) {
            const t = arr[first]
            arr[first] = arr[last - 1]
            arr[last - 1] = t
        }
        return
    }
    const l2 = Math.floor(len / 2)
    const m = first + l2
    if (len <= bufSize) {
        stableSortMove(arr, first, m, less, l2, buf, bo)
        stableSortMove(arr, m, last, less, len - l2, buf, bo + l2)
        mergeMove(buf, bo, bo + l2, buf, bo + l2, bo + len, arr, first, less)
        return
    }
    throw new Error('std::stable_sort: the in-place merge path (insufficient temporary buffer) is not ported')
}

/** libc++ `std::stable_sort` for non-trivially-copy-assignable elements (`__stable_sort_switch` = 0). */
export function libcxxStableSort<T>(arr: T[], less: (a: T, b: T) => boolean): void {
    const buf: T[] = new Array(arr.length)
    stableSort(arr, 0, arr.length, less, arr.length, buf, 0, arr.length)
}
