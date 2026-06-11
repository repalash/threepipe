/* eslint-disable camelcase, no-unused-vars, no-empty, no-constant-condition */
const DNA1 = 826363460;
const ENDB = 1111772741;

/* Note: Blender coordinates treat the Z axis as the vertical an Y as depth. */

// web worker not functional in this version
let USE_WEBWORKER = false;

let worker = null;

// FR = new FileReader(),

const return_object = {
    loadBlendFromArrayBuffer: function (array_buffer) {
        return_object.ready = false;
        if (USE_WEBWORKER) {
            worker.postMessage(array_buffer, array_buffer);
        } else {
            worker.onmessage({
                data: array_buffer,
            });
        }
    },
    // loadBlendFromBlob: function (blob) {
    //     FR.onload = function () {
    //         return_object.loadBlendFromArrayBuffer(this.result);
    //     };
    //     FR.readAsArrayBuffer(blob);
    // },
    ready: true,
    onParseReady: function () {},
};

function worker_code () {
    'use strict';

    let data = null,
        _data = null,
        BIG_ENDIAN = false,
        pointer_size = 0,
        struct_names = [],
        offset = 0,
        working_blend_file = null,
        current_SDNA_template = null,
        templates = {},
        finished_objects = [],
        FILE = null,
        ERROR = null,
        AB = null;

    const self = this;

    function parseFile (msg) {

        if (typeof msg.data == 'object') {
            // reset global variables
            AB = null;
            data = null;
            BIG_ENDIAN = false;
            pointer_size = 0;
            struct_names = [];
            offset = 0;
            working_blend_file = null;
            finished_objects = [];
            current_SDNA_template = null;
            // ERROR is module-global; without this reset a failed parse (e.g. an unsupported
            // big-endian file) would be reported for the next, successful parse.
            ERROR = null;


            // set data
            _data = msg.data;

            AB = _data.slice();

            data = new DataView(_data);


            FILE = new BLENDER_FILE(AB);

            // start parsing
            readFile();

            // export parsed data
            self.postMessage(FILE, ERROR);
        }
    }

    /*
            Export object for a parsed __blender_file__.
        */

    const BLENDER_FILE = function (AB) {
        this.AB = AB;
        // this.double = new Float64Array(AB);
        this.byte = new Uint8Array(AB);

        this.dv = new DataView(AB);

        this.objects = {};
        this.memory_lookup = {},
        this.object_array = [];

        this.template = null;
    };

    BLENDER_FILE.prototype = {
        addObject: function (obj) {
            this.object_array.push(obj);
            if (!this.objects[obj.blender_name]) this.objects[obj.blender_name] = [];
            this.objects[obj.blender_name].push(obj);
        },

        getPointer: function (offset) {
            const pointerLow = this.dv.getUint32(offset, this.template.endianess);
            if (this.template.pointer_size > 4) {
                const pointerHigh = this.dv.getUint32(offset + 4, this.template.endianess);
                if (this.template.endianess) {
                    return (pointerLow) + 'l|h' + pointerHigh;
                } else {
                    return (pointerHigh) + 'h|l' + pointerLow;
                }
            } else {
                return pointerLow;
            }
        },

        // Alignment-safe TypedArray read over the file buffer. Consumers (e.g. loader/geometry.ts)
        // that reach into `__blender_file__.AB` at a datablock's `__data_address__` MUST use this
        // instead of `new Ctor(AB, byteOffset, n)` — Blender packs blocks with no padding, so on
        // v1 (17-byte header) and some v0 files the payload lands at an offset that isn't a multiple
        // of the element size, where a direct view throws RangeError. All supported files are
        // little-endian (big-endian is rejected at header parse), so a raw byte copy is correct.
        readTypedArray: function (Ctor, byteOffset, length) {
            return alignedTypedArray(Ctor, this.AB, byteOffset, length);
        },
    };

    self.onmessage = parseFile;
    // this.onmessage = parseFile;

    /*
            These functions map offsets in the blender __blender_file__ to basic types (byte,short,int,float) through TypedArrays;
            This allows the underlying binary data to be changed.
        */

    // Construct a TypedArray view over the file buffer, copying into a fresh aligned buffer when
    // the byte offset isn't a multiple of the element size. Blender packs blocks with no padding,
    // so on v1 (17-byte header) and some v0 files the payload lands at unaligned offsets where a
    // direct `new Float32Array(buf, oddOffset, n)` would throw. All supported files are
    // little-endian (big-endian is rejected at header parse), so a raw byte copy is correct.
    function alignedTypedArray (Ctor, buffer, byteOffset, length) {
        if ((byteOffset % Ctor.BYTES_PER_ELEMENT) === 0) {
            return new Ctor(buffer, byteOffset, length);
        }
        const out = new Ctor(length);
        new Uint8Array(out.buffer).set(new Uint8Array(buffer, byteOffset, length * Ctor.BYTES_PER_ELEMENT));
        return out;
    }

    function float64Prop (offset, Blender_Array_Length, length) {
        return {
            get: function () {
                return (Blender_Array_Length > 1) ?
                    alignedTypedArray(Float64Array, this.__blender_file__.AB, this.__data_address__ + offset, length) :
                    this.__blender_file__.dv.getFloat64(this.__data_address__ + offset, this.__blender_file__.template.endianess);
            },
            set: function (float) {
                if (Blender_Array_Length > 1) {} else {
                    this.__blender_file__.dv.setFloat64(this.__data_address__ + offset, float, this.__blender_file__.template.endianess);
                }
            },
            enumerable: true,
            configurable: true,
        };
    }

    function floatProp (offset, Blender_Array_Length, length) {
        return {
            get: function () {
                return (Blender_Array_Length > 1) ?
                    alignedTypedArray(Float32Array, this.__blender_file__.AB, this.__data_address__ + offset, length) :
                    this.__blender_file__.dv.getFloat32(this.__data_address__ + offset, this.__blender_file__.template.endianess);
            },
            set: function (float) {
                if (Blender_Array_Length > 1) {} else {
                    this.__blender_file__.dv.setFloat32(this.__data_address__ + offset, float, this.__blender_file__.template.endianess);
                }
            },
            enumerable: true,
            configurable: true,
        };
    }

    function intProp (offset, Blender_Array_Length, length) {
        return {
            get: function () {
                return (Blender_Array_Length > 1) ?
                    alignedTypedArray(Int32Array, this.__blender_file__.AB, this.__data_address__ + offset, length) :
                    this.__blender_file__.dv.getInt32(this.__data_address__ + offset, this.__blender_file__.template.endianess);
            },
            set: function (float) {
                if (Blender_Array_Length > 1) {} else {
                    this.__blender_file__.dv.setInt32(this.__data_address__ + offset, float, this.__blender_file__.template.endianess);
                }
            },
            enumerable: true,
            configurable: true,
        };
    }

    function uIntProp (offset, Blender_Array_Length, length) {
        return {
            get: function () {
                return (Blender_Array_Length > 1) ?
                    alignedTypedArray(Uint32Array, this.__blender_file__.AB, this.__data_address__ + offset, length) :
                    this.__blender_file__.dv.getUint32(this.__data_address__ + offset, this.__blender_file__.template.endianess);
            },
            set: function (float) {
                if (Blender_Array_Length > 1) {} else {
                    this.__blender_file__.dv.setUint32(this.__data_address__ + offset, float, this.__blender_file__.template.endianess);
                }
            },
            enumerable: true,
            configurable: true,
        };
    }

    function shortProp (offset, Blender_Array_Length, length) {
        return {
            get: function () {
                return (Blender_Array_Length > 1) ?
                    alignedTypedArray(Int16Array, this.__blender_file__.AB, this.__data_address__ + offset, length) :
                    this.__blender_file__.dv.getInt16(this.__data_address__ + offset, this.__blender_file__.template.endianess);
            },
            set: function (float) {
                if (Blender_Array_Length > 1) {} else {
                    this.__blender_file__.dv.setInt16(this.__data_address__ + offset, float, this.__blender_file__.template.endianess);
                }
            },
            enumerable: true,
            configurable: true,
        };
    }

    const uShortProp = (offset, Blender_Array_Length, length) => {
        return {
            get: function () {
                return (Blender_Array_Length > 1) ?
                    alignedTypedArray(Uint16Array, this.__blender_file__.AB, this.__data_address__ + offset, length) :
                    this.__blender_file__.dv.getUint16(this.__data_address__ + offset, this.__blender_file__.template.endianess);
            },
            set: function (float) {
                if (Blender_Array_Length > 1) {
                } else {
                    this.__blender_file__.dv.setUint16(this.__data_address__ + offset, float, this.__blender_file__.template.endianess);
                }
            },
            enumerable: true,
            configurable: true,
        };
    };

    function charProp (offset, Blender_Array_Length, length) {
        return {
            get: function () {
                if (Blender_Array_Length > 1) {
                    let start = this.__data_address__ + offset;
                    let end = start;
                    let buffer_guard = 0;

                    while (this.__blender_file__.byte[end] != 0 && buffer_guard++ < length) end++;

                    return toString(this.__blender_file__.AB, start, end);
                }
                return this.__blender_file__.byte[(this.__data_address__ + offset)];
            },
            set: function (byte) {
                if (Blender_Array_Length > 1) {
                    const string = byte + '';
                    let i = 0;
                    const l = string.length;
                    while (i < length) {
                        if (i < l) {
                            this.__blender_file__.byte[(this.__data_address__ + offset + i)] = string.charCodeAt(i) | 0;
                        } else {
                            this.__blender_file__.byte[(this.__data_address__ + offset + i)] = 0;
                        }
                        i++;
                    }
                } else {
                    this.__blender_file__.byte[(this.__data_address__ + offset)] = byte | 0;
                }
            },
            enumerable: true,
            configurable: true,
        };
    }

    function pointerProp2 (offset) {
        return {
            get: function () {
                const bf = this.__blender_file__;
                let pointer = bf.getPointer(this.__data_address__ + offset, bf);
                const link = bf.memory_lookup[pointer];

                const results = [];

                if (link) {
                    const address = link.__data_address__;
                    const ps = (bf.template && bf.template.pointer_size) || 8;
                    // The pointed-to block is a malloc'd array of `block_length / pointer_size` pointers
                    // (e.g. `Material **mat` is `totcol` pointers). Read the WHOLE array and keep null
                    // (unresolved) entries as null — Blender leaves empty/object-linked material slots as
                    // null pointers in the middle of the array, so breaking at the first null silently
                    // drops every slot after it (lost materials, invisible faces).
                    const count = (typeof link.__byte_length__ === 'number' && link.__byte_length__ > 0)
                        ? Math.floor(link.__byte_length__ / ps) : 0;
                    if (count > 0) {
                        for (let j = 0; j < count; j++) {
                            pointer = bf.getPointer(address + j * ps, bf);
                            results.push(bf.memory_lookup[pointer] || null);
                        }
                    } else {
                        // Fallback (no known block length): read until the first null, as before.
                        let j = 0;
                        while (true) {
                            pointer = bf.getPointer(address + j * ps, bf);
                            const obj = bf.memory_lookup[pointer];
                            if (!obj) break;
                            results.push(obj);
                            j++;
                        }
                    }
                }

                return results;
            },
            set: function () {},
            enumerable: true,
            configurable: true,
        };
    }

    function pointerProp (offset, Blender_Array_Length, length) {
        return {
            get: function () {
                if (Blender_Array_Length > 1) {
                    let array = [];
                    let j = 0;
                    let off = offset;
                    while (j < Blender_Array_Length) {
                        let pointer = this.__blender_file__.getPointer(this.__data_address__ + off, this.__blender_file__);

                        array.push(this.__blender_file__.memory_lookup[pointer]);
                        off += length;
                        j++;
                    }

                    return array;
                } else {
                    let pointer = this.__blender_file__.getPointer(this.__data_address__ + offset, this.__blender_file__);
                    return this.__blender_file__.memory_lookup[pointer];
                }
            },
            set: function () {},
            enumerable: true,
            configurable: true,
        };
    }

    // Signed 1-byte field (int8_t). Used widely in Blender 5.0 DNA (enum domains, flags, etc).
    function int8Prop (offset, Blender_Array_Length, length) {
        return {
            get: function () {
                return (Blender_Array_Length > 1) ?
                    alignedTypedArray(Int8Array, this.__blender_file__.AB, this.__data_address__ + offset, length) :
                    this.__blender_file__.dv.getInt8(this.__data_address__ + offset);
            },
            set: function (v) { if (Blender_Array_Length <= 1) this.__blender_file__.dv.setInt8(this.__data_address__ + offset, v); },
            enumerable: true, configurable: true,
        };
    }

    // 8-byte integer field (int64_t / uint64_t). Returned as a JS Number — .blend counts/sizes are
    // well under 2^53. Used by Blender 5.0 DNA (AttributeArray.size, LargeBHead lengths, etc).
    function int64Prop (offset, Blender_Array_Length, length, unsigned) {
        return {
            get: function () {
                if (Blender_Array_Length > 1) {
                    return alignedTypedArray(unsigned ? BigUint64Array : BigInt64Array, this.__blender_file__.AB, this.__data_address__ + offset, length);
                }
                const dv = this.__blender_file__.dv, le = this.__blender_file__.template.endianess;
                return Number(unsigned ? dv.getBigUint64(this.__data_address__ + offset, le) : dv.getBigInt64(this.__data_address__ + offset, le));
            },
            set: function () {},
            enumerable: true, configurable: true,
        };
    }

    function compileProp (obj, name, type, offset, array_size, IS_POINTER, pointer_size, length) {

        if (!IS_POINTER) {
            switch (type) {
            case 'double':
                Object.defineProperty(obj, name, float64Prop(offset, array_size, length >> 3));
                break;
            case 'float':
                Object.defineProperty(obj, name, floatProp(offset, array_size, length >> 2));
                break;
            case 'int':
            case 'int32_t':
                Object.defineProperty(obj, name, intProp(offset, array_size, length >> 2));
                break;
            case 'uint32_t':
                Object.defineProperty(obj, name, uIntProp(offset, array_size, length >> 2));
                break;
            case 'short':
            case 'int16_t':
                Object.defineProperty(obj, name, shortProp(offset, array_size, length >> 1));
                break;
            case 'ushort':
            case 'uint16_t':
                Object.defineProperty(obj, name, uShortProp(offset, array_size, length >> 1));
                break;
            case 'int8_t':
                Object.defineProperty(obj, name, int8Prop(offset, array_size, length));
                break;
            case 'char':
            case 'uchar':
            case 'uint8_t':
                Object.defineProperty(obj, name, charProp(offset, array_size, length));
                break;
            case 'int64_t':
                Object.defineProperty(obj, name, int64Prop(offset, array_size, length >> 3, false));
                break;
            case 'uint64_t':
                Object.defineProperty(obj, name, int64Prop(offset, array_size, length >> 3, true));
                break;
            default:
                // compile list to
                obj[name] = {};
                obj.__list__.push(name, type, length, offset, array_size, IS_POINTER);
            }
            obj._length += length;
            offset += length;
        } else {
            Object.defineProperty(obj, name, pointerProp(offset, array_size, pointer_size));
            obj._length += pointer_size * array_size;
            offset += pointer_size * array_size;
        }

        return offset;
    }

    // Store final DNA structs
    const MASTER_SDNA_SCHEMA = function (version) {
        this.version = version;
        this.SDNA_SET = false;
        this.byte_size = 0;
        this.struct_index = 0;
        this.structs = {};
        this.SDNA = {};
        this.endianess = false;
    };

    MASTER_SDNA_SCHEMA.prototype = {
        getSDNAStructureConstructor: function (name, struct) {
            if (struct) {
                const jsName = name === 'void' ? 'void_' : name
                const blen_struct = Function('function ' + jsName + '(){}; return ' + jsName)();

                // if(name === 'CustomDataLayer') debugger

                blen_struct.prototype = new BLENDER_STRUCTURE();
                blen_struct.prototype.blender_name = name;
                blen_struct.prototype.__pointers = [];
                blen_struct.prototype.__list__ = [];

                const DNA = this.SDNA[name] = {
                    constructor: blen_struct,
                };
                let offset = 0;
                // Create properties of struct
                for (let i = 0; i < struct.length; i += 3) {
                    let _name = struct[i];
                    const n = _name,
                        type = struct[i + 1];
                    let length = struct[i + 2],
                        array_length = 0,
                        match = null,
                        Blender_Array_Length = 1,
                        Suparray_match = 1,
                        PointerToArray = false,
                        Pointer_Match = 0;


                    let original_name = _name;

                    // mini type parser
                    if ((match = _name.match(/(\*?)(\*?)(\w+)(\[(\w*)\])?(\[(\w*)\])?/))) {

                        // base name
                        _name = match[3];

                        // pointer type
                        if (match[1]) {
                            Pointer_Match = 10;
                            blen_struct.prototype.__pointers.push(_name);
                        }

                        if (match[2]) {
                            PointerToArray = true;
                        }

                        // arrays
                        if (match[4]) {
                            if (match[6]) {
                                Suparray_match = parseInt(match[5]);
                                Blender_Array_Length = parseInt(match[7]);
                            } else {
                                Blender_Array_Length = parseInt(match[5]);
                            }
                        }
                        array_length = Blender_Array_Length * length;
                        length = array_length * Suparray_match;
                    }

                    DNA[n] = {
                        type: type,
                        length: length,
                        isArray: (Blender_Array_Length > 0),
                    };

                    if (PointerToArray) {
                        Object.defineProperty(blen_struct.prototype, _name, pointerProp2(offset));
                        offset += pointer_size;
                    } else if (Suparray_match > 1) {
                        const array_names = new Array(Suparray_match);

                        // construct sub_array object that will return the correct structs
                        for (let j = 0; j < Suparray_match; j++) {
                            let array_name_ = `__${_name}[${j}]__`;
                            array_names[j] = array_name_;

                            offset = compileProp(blen_struct.prototype, array_name_, type, offset, Blender_Array_Length, Pointer_Match, pointer_size, array_length);
                        }

                        Object.defineProperty(blen_struct.prototype, _name, {
                            get: (function (array_names) {
                                return function () {
                                    const array = [];
                                    for (let i = 0; i < array_names.length; i++) {
                                        array.push(this[array_names[i]]);
                                    }
                                    return array;
                                };
                            })(array_names),
                            enumerable: true,
                            configurable: true,
                        });
                    } else {
                        offset = compileProp(blen_struct.prototype, _name, type, offset, Blender_Array_Length, Pointer_Match, pointer_size, length);
                    }
                }

                return this.SDNA[name].constructor;

            } else {
                if (!this.SDNA[name]) {
                    return null;
                }
                return this.SDNA[name].constructor;
            }
        },
    };

    const BLENDER_STRUCTURE = function () {
        this.__blender_file__ = null;
        this.__list__ = null;
        this.__super_array_list__ = null;
        this.blender_name = '';
        this.__pointers = null;
        this.address = null;
        this.length = 0;
        this.__data_address__ = 0;
        this.blender_name = '';
        this._length = 0;
    };


    /*
            Returns a pre-constructed BLENDER_STRUCTURE or creates a new BLENDER_STRUCTURE to match the DNA struct type
        */
    const pointer_function = (pointer) => () => {
        return FILE.memory_lookup[pointer];
    };

    function getPointer (offset) {
        const pointerLow = data.getUint32(offset, BIG_ENDIAN);
        if (pointer_size > 4) {
            const pointerHigh = data.getUint32(offset + 4, BIG_ENDIAN);

            if (BIG_ENDIAN) {
                return (pointerLow) + '' + pointerHigh;
            } else {
                return (pointerHigh) + '' + pointerLow;
            }
        } else {
            return pointerLow;
        }
    }

    BLENDER_STRUCTURE.prototype = {
        setData: function (pointer, _data_offset, data_block_length, BLENDER_FILE) {
            if (this.__list__ === null) return this;
            BLENDER_FILE.addObject(this);

            this.__blender_file__ = BLENDER_FILE;
            // Byte length of this block's payload (data_block_length is the end offset). Lets
            // consumers derive element counts for raw DATA blocks (e.g. poly_offset_indices) whose
            // logical length isn't available elsewhere — needed for Blender 5.0 where Mesh.tot* are
            // runtime (post-geometry-nodes) counts, not the stored array sizes.
            this.__byte_length__ = data_block_length - _data_offset;

            const struct = this.__list__;
            let j = 0,
                i = 0,
                obj, name = '',
                type, length, Blender_Array_Length, Pointer_Match, offset, constructor;

            this.__data_address__ = _data_offset;

            // if(this.blender_name === 'CustomDataLayer') debugger

            if (struct === null) return this;

            for (i = 0; i < struct.length; i += 6) {
                obj = null;
                name = struct[i];
                type = struct[i + 1];
                Blender_Array_Length = struct[i + 4];
                Pointer_Match = struct[i + 5];
                offset = this.__data_address__ + struct[i + 3];

                if (Blender_Array_Length > 1) {
                    this[name] = [];
                    j = 0;
                    while (j < Blender_Array_Length) {
                        if (current_SDNA_template.getSDNAStructureConstructor(type)) {
                            constructor = current_SDNA_template.getSDNAStructureConstructor(type);
                            this[name].push((new constructor()).setData(0, offset, offset + length / Blender_Array_Length, BLENDER_FILE));
                        } else this[name].push(null);
                        offset += length / Blender_Array_Length;
                        j++;
                    }
                } else {
                    if (current_SDNA_template.getSDNAStructureConstructor(type)) {
                        constructor = current_SDNA_template.getSDNAStructureConstructor(type);
                        this[name] = (new constructor()).setData(0, offset, length + offset, BLENDER_FILE);
                    } else this[name] = null;
                }
            }
            // break connection to configuration list
            this.__list__ = null;
            return this;
        },

        get aname () {
            if (this.id) return this.id.name.slice(2);
            else return undefined;
        },
    };

    function toString (buffer, _in, _out) {
        return String.fromCharCode.apply(String, new Uint8Array(buffer, _in, _out - _in));
    }
    function seekCheck (buffer, _in, str) {
        const length = str.length;
        for (let i = 0; i < length; i++) {
            if (buffer.getUint8(_in + i) !== str.charCodeAt(i)) {
                return false;
            }
        }
        return true;
    }

    // Begin parsing blender __blender_file__

    function readFile () {
        let count = 0;
        let offset2 = 0;
        const root = 0;
        const i = 0;
        let data_offset = 0;
        let sdna_index = 0;
        let code = '';
        let block_length = 0;
        let curr_count = 0;
        let curr_count2 = 0;

        FILE.memory_lookup = {};
        struct_names = [];
        offset = 0;

        // Compressed (gzip/zstd) blend files are decompressed upstream in BlendLoadPlugin.loadAsync.
        // Make sure we have a .blend __blender_file__. All blend files have the first 12bytes
        // set with BLENDER-v### in Utf-8
        const magic = toString(_data, offset, 7)
        if (magic !== 'BLENDER') return ERROR = 'File supplied is not a .blend compatible Blender file.';

        // Decode the file header. Two formats exist
        // (.repos/blender/source/blender/blenloader_core/intern/blo_core_blend_header.cc):
        //   v0 (12 bytes): 'BLENDER' + ('_'|'-') + ('v'|'V') + 3-digit version
        //                  '_' = 4-byte pointers (BHead4), '-' = 8-byte pointers (SmallBHead8)
        //   v1 (17 bytes, Blender 5.0+): 'BLENDER' + '17' + '-' + '01' + 'v' + 4-digit version
        //                  always 8-byte pointers, little-endian, LargeBHead8 blocks.
        // BIG_ENDIAN is misleadingly named — it is `true` for little-endian files (the value is
        // passed straight to DataView getters as the `littleEndian` arg). Keep that convention.
        let version, large_bhead = false
        const fmtByte = toString(_data, 7, 8)
        if (fmtByte === '_' || fmtByte === '-') {
            pointer_size = fmtByte === '_' ? 4 : 8
            BIG_ENDIAN = toString(_data, 8, 9) !== 'V'
            version = toString(_data, 9, 12)
            offset = 12
        } else {
            // New-style 17-byte header. Bytes 7-8 = header size ('17'), 9 = '-',
            // 10-11 = file-format version ('01'), 12 = 'v', 13-16 = blender version.
            const headerSize = parseInt(toString(_data, 7, 9), 10)
            if (headerSize !== 17) return ERROR = 'Unsupported new-style blend header size: ' + headerSize;
            pointer_size = 8
            BIG_ENDIAN = true // v1 is always little-endian
            large_bhead = true
            version = toString(_data, 13, 17)
            offset = headerSize
        }

        if (!BIG_ENDIAN) {
            // Big-endian .blend files (ancient PowerPC/SGI era, e.g. Blender < 2.0) need every field
            // byte-swapped, which we don't do. Bail clearly instead of producing garbage.
            return ERROR = 'Big-endian .blend files are not supported';
        }

        // Per-format block-header layout. BHead variants
        // (.repos/blender/source/blender/blenloader_core/BLO_core_bhead.hh):
        //   BHead4 (ptr=4):     code@0 len@4(i32) old@8(u32) SDNAnr@12 nr@16        — 20 bytes
        //   SmallBHead8 (v0):   code@0 len@4(i32) old@8(u64) SDNAnr@16 nr@20        — 24 bytes
        //   LargeBHead8 (v1):   code@0 SDNAnr@4 old@8(u64) len@16(i64) nr@24(i64)   — 32 bytes
        // For v0 these reduce to the original parametrised offsets, so v0 behaviour is unchanged.
        const BLOCK_HDR = large_bhead ? 32 : (16 + pointer_size)
        const SDNA_OFF = large_bhead ? 4 : (8 + pointer_size)
        const LEN_OFF = large_bhead ? 16 : 4
        const NR_OFF = large_bhead ? 24 : (12 + pointer_size)
        const LEN_I64 = large_bhead
        const NR_I64 = large_bhead
        // Blender packs blocks with no inter-block padding (verified empirically + writefile.cc),
        // so block offsets advance by exactly BLOCK_HDR + len. The v1 17-byte header (and some v0
        // files) leave block payloads at offsets that aren't multiples of 4/8 — those are handled
        // at the TypedArray getter level (alignedTypedArray) rather than by realigning the buffer.
        const readLen = (o) => LEN_I64 ? Number(data.getBigInt64(o + LEN_OFF, true)) : data.getInt32(o + LEN_OFF, true)
        const readSdna = (o) => data.getInt32(o + SDNA_OFF, BIG_ENDIAN)
        const readNr = (o) => NR_I64 ? Number(data.getBigInt64(o + NR_OFF, true)) : data.getInt32(o + NR_OFF, BIG_ENDIAN)

        // create new master template if none exist for current blender version;
        // Key on format + version so a v0 "050" and a v1 "0500" can never share a template.
        const templateKey = (large_bhead ? 'v1:' : 'v0:') + version
        if (!templates[templateKey]) {
            templates[templateKey] = new MASTER_SDNA_SCHEMA(version);
        }

        current_SDNA_template = templates[templateKey];

        FILE.template = current_SDNA_template;

        // Set SDNA structs if template hasn't been set.
        // Todo: Move the following block into the MASTER_SDNA_SCHEMA object.
        //* Like so:*/ current_SDNA_template.set(AB);

        if (!current_SDNA_template.SDNA_SET) {
            current_SDNA_template.endianess = BIG_ENDIAN;
            current_SDNA_template.pointer_size = pointer_size;
            // find DNA1 data block
            offset2 = offset;

            while (true) {
                // Bounds guard: the SDNA-search loop walks block headers looking for DNA1.
                // If a previous block's block_length is wrong (happens on some Blender 4.x
                // geometry-nodes files), offset2 lands past EOF and the getInt32 below throws
                // RangeError synchronously, killing the whole load. Match the main block
                // loop's guard pattern (line ~810).
                if (offset2 + BLOCK_HDR > data.byteLength) {
                    ERROR = 'Unexpected end of file while searching for DNA1';
                    break
                }
                sdna_index = readSdna(offset2);
                // eslint-disable-next-line no-control-regex
                code = toString(_data, offset2, offset2 + 4).replace(/\u0000/g, '');
                block_length = readLen(offset2);
                offset2 += BLOCK_HDR;
                if (code === 'DNA1') {
                    // DNA found; This is the core of the __blender_file__ and contains all the structure for the various data types used in Blender.
                    count = 0;
                    let types = [],
                        fields = [],
                        names = [],
                        lengths = [],
                        name = '',
                        curr_name = '';

                    // skip SDNA and NAME identifiers
                    offset2 += 8;

                    // Number of structs.
                    count = data.getInt32(offset2, true);
                    offset2 += 4;

                    curr_count = 0;

                    // Build up list of names for structs
                    while (curr_count < count) {
                        curr_name = '';
                        while (data.getInt8(offset2) !== 0) {
                            curr_name += toString(_data, offset2, offset2 + 1);
                            offset2++;
                        }
                        names.push(curr_name);
                        offset2++;
                        curr_count++;
                    }

                    // Adjust for alignment TYPE
                    for (let j = 0; j < 8; j++) {
                        if(seekCheck(data, offset2, 'TYPE')) break
                        offset2++;
                    }
                    if(!seekCheck(data, offset2, 'TYPE')) {
                        ERROR = 'Unexpected alignment error in SDNA parsing';
                        break
                    }

                    offset2 += 4;

                    // Number of struct types
                    count = data.getUint32(offset2, true);
                    offset2 += 4;
                    curr_count = 0;

                    // Build up list of types
                    while (curr_count < count) {
                        curr_name = '';
                        while (data.getInt8(offset2) !== 0) {
                            curr_name += toString(_data, offset2, offset2 + 1);
                            offset2++;
                        }
                        types.push(curr_name);
                        offset2++;
                        curr_count++;
                    }

                    // Adjust for alignment
                    for (let j = 0; j < 8; j++) {
                        if(seekCheck(data, offset2, 'TLEN')) break
                        offset2++;
                    }
                    if(!seekCheck(data, offset2, 'TLEN')) {
                        ERROR = 'Unexpected alignment error in SDNA parsing';
                        break
                    }
                    offset2 += 4;
                    curr_count = 0;

                    // Build up list of byte lengths for types
                    while (curr_count < count) {
                        lengths.push(data.getInt16(offset2, BIG_ENDIAN));
                        offset2 += 2;
                        curr_count++;
                    }

                    // Adjust for alignment
                    for (let j = 0; j < 8; j++) {
                        if(seekCheck(data, offset2, 'STRC')) break
                        offset2++;
                    }
                    if(!seekCheck(data, offset2, 'STRC')) {
                        ERROR = 'Unexpected alignment error in SDNA parsing';
                        break
                    }
                    offset2 += 4;

                    // Number of structures
                    const structure_count = data.getInt32(offset2, BIG_ENDIAN);
                    offset2 += 4;
                    curr_count = 0;

                    // Create constructor objects from list of SDNA structs
                    while (curr_count < structure_count) {
                        const struct_name = types[data.getInt16(offset2, BIG_ENDIAN)];
                        offset2 += 2;
                        const obj = [];
                        count = data.getInt16(offset2, BIG_ENDIAN);
                        offset2 += 2;
                        curr_count2 = 0;
                        struct_names.push(struct_name);

                        // Fill an array with name, type, and length for each SDNA struct property
                        while (curr_count2 < count) {

                            // const n = names[data.getInt16(offset2 + 2, BIG_ENDIAN)]
                            // if(obj.find((o, i)=>i%3===0 && o===n)){
                            //     debugger
                            // }
                            obj.push(names[data.getInt16(offset2 + 2, BIG_ENDIAN)], types[data.getInt16(offset2, BIG_ENDIAN)], lengths[data.getInt16(offset2, BIG_ENDIAN)]);
                            offset2 += 4;
                            curr_count2++;
                        }

                        // Create a SDNA constructor by passing [type,name,lenth] array as second argument
                        current_SDNA_template.getSDNAStructureConstructor(struct_name, obj);
                        curr_count++;
                    }
                    current_SDNA_template.SDNA_SET = true;
                    current_SDNA_template.SDNA_NAMES = struct_names;
                    break;
                }
                offset2 += block_length;
            }
        }

        // parse the rest of the data, starting back at the top.

        // TODO: turn into "on-demand" parsing.

        // https://github.com/fschutt/mystery-of-the-blend-backup
        while (true) {
            // todo fix cleanup
            // this is not the case, see blend-load-test.blend and Ruins_Assets.blend
            // if ((offset % 4) > 0) {
            //     console.log('fix', offset, offset % 4)
            //     debugger
            //     offset = (4 - (offset % 4)) + offset;
            // }
            // Defensive: skip any stray NUL padding before a block header. Blender writes none
            // between blocks (verified), so for correctly-decoded files this is a no-op; it only
            // matters as a safety net against a mis-decoded length. Block codes are always A-Z.
            for (let j = 0; j < 8; j++) {
                if(data.getInt8(offset) === 0) {
                    offset++
                    continue
                }
                break
            }

            data_offset = offset;

            if (offset + BLOCK_HDR > data.byteLength) {
                ERROR = 'Unexpected end of file while parsing';
                break
            }

            sdna_index = readSdna(offset);
            const code_str = toString(_data, offset, offset + 4)

            offset2 = offset + BLOCK_HDR;

            const blockLength = readLen(offset);
            if (blockLength < 0 || offset + blockLength + BLOCK_HDR > data.byteLength) {
                ERROR = 'Invalid block length detected';
                break
            }

            offset += blockLength + BLOCK_HDR;

            if (code_str === 'DNA1') {} // skip - already processed at this point
            else if (code_str === 'ENDB') break; // end of __blender_file__ found
            else if (code_str === 'TEST') { // snapshot
                const data_start = data_offset + BLOCK_HDR;
                const width = data.getInt32(data_start, BIG_ENDIAN);
                const height = data.getInt32(data_start + 4, BIG_ENDIAN);
                if ((width * height > 0)) {
                    const data_len = width * height * 4; // RGBA
                    if(blockLength < data_len + 8) {
                        ERROR = 'Invalid TEST block length detected';
                        break;
                    }
                    const image_data = alignedTypedArray(Uint32Array, _data, data_start + 8, data_len >> 2);
                    const image = {
                        width: width,
                        height: height,
                        data: image_data,
                    };
                    FILE.thumbnail = image
                }
            }
            else {
                // Create a Blender object using a constructor template from current_SDNA_template
                const data_start = data_offset + BLOCK_HDR;

                // Get a SDNA constructor by name;
                const constructor = current_SDNA_template.getSDNAStructureConstructor(current_SDNA_template.SDNA_NAMES[sdna_index]);

                const size = readLen(data_offset);

                count = readNr(data_offset);

                if (count > 0 && constructor) {
                    let obj = new constructor();

                    const length = constructor.prototype._length;


                    const address = FILE.getPointer(data_offset + 8);

                    obj.address = address + '';

                    obj.setData(address, data_start, data_start + size, FILE);

                    if (count > 1) {
                        let array = [];
                        array.push(obj);
                        for (let u = 1; u < count; u++) {
                            obj = new constructor();
                            obj.setData(address, data_start + length * u, data_start + (length * u) + length, FILE);
                            array.push(obj);
                        }
                        FILE.memory_lookup[address] = array;
                    } else {
                        FILE.memory_lookup[address] = obj;
                    }
                }
            }
        }
    }
}

worker = new worker_code();

worker.postMessage = function (message, err) {
    return_object.onParseReady(message, err);
};

export default return_object;

// window.prettyPrintHex = function (view, offset = 0, length = view.byteLength - offset) {
//     const bytes = Array.from({ length }, (_, i) => view.getUint8(offset + i));
//     console.log(bytes.map((b, i) => (i % 16 === 0 ? '\n' : '') + b.toString(16).padStart(2, '0')).join(' '));
//     console.log(bytes.map((b, i) => (i % 16 === 0 ? '\n' : '') + String.fromCharCode(b)).join(''));
// }
