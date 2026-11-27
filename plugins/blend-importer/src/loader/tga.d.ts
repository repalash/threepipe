/** Decode a TGA file into RGBA8 pixels, rows top-down. Throws on invalid or unsupported data. */
export declare function decodeTGA(buffer: ArrayBuffer): {data: Uint8Array & {buffer: ArrayBuffer}, width: number, height: number}
