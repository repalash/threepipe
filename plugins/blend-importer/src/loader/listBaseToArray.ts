import type {NodeTree} from '../gltf/blender_types'

export interface ListBaseItem{
    next: ListBaseItem;
}
export interface ListBase<T = any>{
    first: ListBaseItem;
}
export function bToArray<T>(l: ListBase<T>): T[] {
    let i = l.first
    if (!i) return []
    const r = [i]
    while (i.next) {
        i = i.next
        r.push(i)
    }
    return r
}
