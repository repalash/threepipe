export function bakeGetters(
    obj: any,
    replacer?: (key: string, value: any) => any | (string | number)[] | null,
): string {
    const ss = new Set<any>()

    // Create a plain object that includes getter values
    function toPlainObject(source: any, level = 0): any {
        if (!source || typeof source !== 'object') {
            return source
        }
        if (ss.has(source)) {
            console.warn('duplicate', source, level)
            // debugger
            return 'duplicate'
        }
        ss.add(source)

        if (Array.isArray(source)) {
            return source.map(toPlainObject)
        }

        const result: Record<string, any> = {}

        // Get all enumerable properties (including getters)
        for (const key in source) {
            if (key.startsWith('__')) continue
            try {
                const v = source[key]
                if (v === source || v === undefined) continue
                // result[key] = 'a'

                if (key === 'typemap') console.log(v)
                // const v = source[key]
                // if (v === source) continue
                // console.log(key, v)
                if (typeof v === 'object' && v?.buffer instanceof ArrayBuffer) {
                    result[key] = Object.getPrototypeOf(v).constructor.name
                } else
                    result[key] = toPlainObject(v, level + 1)
            } catch (e) {
                // Skip properties that throw errors when accessed
            }
        }

        return result
    }

    const plainObj = toPlainObject(obj)
    return plainObj
}
