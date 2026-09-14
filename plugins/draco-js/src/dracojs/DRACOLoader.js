/**
 * Draco.js — a pure-JavaScript Draco mesh loader for three.js.
 *
 * Draco (https://google.github.io/draco/) is an open source library for
 * compressing and decompressing 3D meshes and point clouds. Draco.js is a
 * pure-JavaScript port of its decoder — a drop-in replacement for three.js's
 * DRACOLoader, usable on its own or inside GLTFLoader.
 *
 * https://mrdoob.github.io/draco.js/
 *
 * @license MIT
 */
import { Loader, FileLoader, BufferGeometry, BufferAttribute, Color, ColorManagement } from 'three';
// MODIFICATION (threepipe): the package build rewrites `from 'three'` to `from 'threepipe'`, which
// does not re-export these two string constants. Define them locally (stable three.js values:
// 'srgb' / 'srgb-linear') so the package needs no extra threepipe surface and stays self-contained.
const SRGBColorSpace = 'srgb';
const LinearSRGBColorSpace = 'srgb-linear';

// compression/config/CompressionShared.js - ported from compression/config/compression_shared.h

// Latest Draco bit-stream version.
const kDracoPointCloudBitstreamVersionMajor = 2;
const kDracoPointCloudBitstreamVersionMinor = 3;
const kDracoMeshBitstreamVersionMajor = 2;
const kDracoMeshBitstreamVersionMinor = 2;

function DRACO_BITSTREAM_VERSION(major, minor) {
  return (major << 8) | minor;
}

// Currently, we support point cloud and triangular mesh encoding.
const EncodedGeometryType = {
  INVALID_GEOMETRY_TYPE: -1,
  POINT_CLOUD: 0,
  TRIANGULAR_MESH: 1,
  NUM_ENCODED_GEOMETRY_TYPES: 2
};

// List of encoding methods for point clouds.
const PointCloudEncodingMethod = {
  POINT_CLOUD_SEQUENTIAL_ENCODING: 0,
  POINT_CLOUD_KD_TREE_ENCODING: 1
};

// List of encoding methods for meshes.
const MeshEncoderMethod = {
  MESH_SEQUENTIAL_ENCODING: 0,
  MESH_EDGEBREAKER_ENCODING: 1
};

// List of various sequential attribute encoder/decoders.
const SequentialAttributeEncoderType = {
  SEQUENTIAL_ATTRIBUTE_ENCODER_GENERIC: 0,
  SEQUENTIAL_ATTRIBUTE_ENCODER_INTEGER: 1,
  SEQUENTIAL_ATTRIBUTE_ENCODER_QUANTIZATION: 2,
  SEQUENTIAL_ATTRIBUTE_ENCODER_NORMALS: 3
};

// List of all prediction methods currently supported by our framework.
const PredictionSchemeMethod = {
  PREDICTION_NONE: -2,
  PREDICTION_DIFFERENCE: 0,
  MESH_PREDICTION_PARALLELOGRAM: 1,
  MESH_PREDICTION_MULTI_PARALLELOGRAM: 2,
  MESH_PREDICTION_TEX_COORDS_DEPRECATED: 3,
  MESH_PREDICTION_CONSTRAINED_MULTI_PARALLELOGRAM: 4,
  MESH_PREDICTION_TEX_COORDS_PORTABLE: 5,
  MESH_PREDICTION_GEOMETRIC_NORMAL: 6,
  NUM_PREDICTION_SCHEMES: 7
};

// List of all prediction scheme transforms used by our framework.
const PredictionSchemeTransformType = {
  PREDICTION_TRANSFORM_NONE: -1,
  PREDICTION_TRANSFORM_WRAP: 1,
  PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON: 2,
  PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON_CANONICALIZED: 3,
  NUM_PREDICTION_SCHEME_TRANSFORM_TYPES: 4
};

// List of all mesh traversal methods supported by Draco framework.
const MeshTraversalMethod = {
  MESH_TRAVERSAL_DEPTH_FIRST: 0,
  NUM_TRAVERSAL_METHODS: 2
};

// List of all variants of the edgebreaker method.
const MeshEdgebreakerConnectivityEncodingMethod = {
  MESH_EDGEBREAKER_STANDARD_ENCODING: 0,
  MESH_EDGEBREAKER_PREDICTIVE_ENCODING: 1, // Deprecated.
  MESH_EDGEBREAKER_VALENCE_ENCODING: 2
};

// Draco header V1
class DracoHeader {

  constructor() {
    this.dracoString = new Int8Array(5);
    this.versionMajor = 0;
    this.versionMinor = 0;
    this.encoderType = 0;
    this.encoderMethod = 0;
    this.flags = 0;
  }

}

const NormalPredictionMode = {
  ONE_TRIANGLE: 0, // To be deprecated.
  TRIANGLE_AREA: 1
};

// Different methods used for symbol entropy encoding.
const SymbolCodingMethod = {
  SYMBOL_CODING_TAGGED: 0,
  SYMBOL_CODING_RAW: 1};

// Mask for setting and getting the bit for metadata in |flags| of header.
const METADATA_FLAG_MASK = 0x8000;

// compression/config/DracoOptions.js - ported from compression/config/draco_options.h

// Base option class used to control encoding and decoding. The geometry coding
// can be controlled through the following options:
//   1. Global options - Options specific to overall geometry or options common
//                       for all attributes
//   2. Per attribute options - Options specific to a given attribute.
//                              Each attribute is identified by a key (e.g.
//                              attribute type or attribute id).
class DracoOptions {

  constructor() {
    // Global options stored as a Map of string -> value
    this._globalOptions = new Map();
    // Per-attribute options stored as a Map of attributeKey -> Map(string -> value)
    this._attributeOptions = new Map();
  }

  // --- Global option accessors ---

  getGlobalInt(name, defaultVal) {
    if (this._globalOptions.has(name)) {
      return this._globalOptions.get(name) | 0;
    }
    return defaultVal;
  }

  setGlobalInt(name, val) {
    this._globalOptions.set(name, val | 0);
  }

  getGlobalFloat(name, defaultVal) {
    if (this._globalOptions.has(name)) {
      return +this._globalOptions.get(name);
    }
    return defaultVal;
  }

  setGlobalFloat(name, val) {
    this._globalOptions.set(name, +val);
  }

  getGlobalBool(name, defaultVal) {
    if (this._globalOptions.has(name)) {
      return !!this._globalOptions.get(name);
    }
    return defaultVal;
  }

  setGlobalBool(name, val) {
    this._globalOptions.set(name, val ? 1 : 0);
  }

  isGlobalOptionSet(name) {
    return this._globalOptions.has(name);
  }

  setGlobalOptions(optionsMap) {
    this._globalOptions = new Map(optionsMap);
  }

  getGlobalOptions() {
    return this._globalOptions;
  }

  // --- Attribute-specific option accessors ---

  _getOrCreateAttributeOptions(attKey) {
    if (!this._attributeOptions.has(attKey)) {
      this._attributeOptions.set(attKey, new Map());
    }
    return this._attributeOptions.get(attKey);
  }

  findAttributeOptions(attKey) {
    if (this._attributeOptions.has(attKey)) {
      return this._attributeOptions.get(attKey);
    }
    return null;
  }

  getAttributeInt(attKey, name, defaultVal) {
    const attOpts = this.findAttributeOptions(attKey);
    if (attOpts !== null && attOpts.has(name)) {
      return attOpts.get(name) | 0;
    }
    return this.getGlobalInt(name, defaultVal);
  }

  setAttributeInt(attKey, name, val) {
    this._getOrCreateAttributeOptions(attKey).set(name, val | 0);
  }

  getAttributeFloat(attKey, name, defaultVal) {
    const attOpts = this.findAttributeOptions(attKey);
    if (attOpts !== null && attOpts.has(name)) {
      return +attOpts.get(name);
    }
    return this.getGlobalFloat(name, defaultVal);
  }

  setAttributeFloat(attKey, name, val) {
    this._getOrCreateAttributeOptions(attKey).set(name, +val);
  }

  getAttributeBool(attKey, name, defaultVal) {
    const attOpts = this.findAttributeOptions(attKey);
    if (attOpts !== null && attOpts.has(name)) {
      return !!attOpts.get(name);
    }
    return this.getGlobalBool(name, defaultVal);
  }

  setAttributeBool(attKey, name, val) {
    this._getOrCreateAttributeOptions(attKey).set(name, val ? 1 : 0);
  }

  isAttributeOptionSet(attKey, name) {
    const attOpts = this.findAttributeOptions(attKey);
    if (attOpts !== null) {
      return attOpts.has(name);
    }
    return this._globalOptions.has(name);
  }

  setAttributeOptions(attKey, optionsMap) {
    this._attributeOptions.set(attKey, new Map(optionsMap));
  }

}

// compression/config/DecoderOptions.js - ported from compression/config/decoder_options.h


class DecoderOptions extends DracoOptions {

  constructor() {
    super();
  }

}

// core/BitUtils.js - ported from bit_utils.h/cc

// Converts an array of unsigned symbols back to signed int32 values.
// Branchless zigzag decode, inlined: for even val -> val>>>1, for odd val ->
// -(val>>>1)-1. (val >>> 1) ^ -(val & 1) yields exactly that without a per-value
// call or branch.
function convertSymbolsToSignedInts(input, count, output) {
  for (let i = 0; i < count; i++) {
    const val = input[i];
    output[i] = (val >>> 1) ^ -(val & 1);
  }
}

// Converts a single unsigned symbol back to a signed integer (zigzag decoding).
function convertSymbolToSignedInt(val) {
  const isPositive = (val & 1) === 0;
  val >>>= 1;
  if (isPositive) {
    return val;
  }
  return -(val) - 1;
}

// core/VarintDecoding.js - ported from varint_decoding.h


// Decodes an unsigned varint, MSB continuation coding.
// Returns the decoded value, or undefined on error.
function decodeVarintUnsigned(buffer, maxBytes) {
  let result = 0;
  for (let i = 0; i < maxBytes; i++) {
    const byte = buffer.decodeUint8();
    if (byte === undefined) return undefined;
    if (byte & 0x80) {
      // More bytes follow — recurse in original, here we iterate.
      // The original C++ builds the value MSB-first via recursion:
      //   recurse first, then shift and OR.
      // We replicate that by collecting bytes and building MSB-first.
      const bytes = [byte & 0x7F];
      let done = false;
      for (let j = i + 1; j < maxBytes; j++) {
        const next = buffer.decodeUint8();
        if (next === undefined) return undefined;
        if (next & 0x80) {
          bytes.push(next & 0x7F);
        } else {
          bytes.push(next);
          done = true;
          break;
        }
      }
      if (!done) return undefined;
      // Build MSB-first: last byte read is the most significant.
      result = bytes[bytes.length - 1];
      for (let k = bytes.length - 2; k >= 0; k--) {
        result = (result * 128) + bytes[k];
      }
      return result;
    } else {
      // Last byte
      return byte;
    }
  }
  return undefined;
}

// Decodes a varint from the decoder buffer.
// If signed is true, applies zigzag decoding.
// Returns the decoded value, or undefined on error.
function decodeVarint(buffer, signed = false) {
  // Max bytes: for uint64 it's 10, for uint32 it's 5
  const maxBytes = 10;
  const value = decodeVarintUnsigned(buffer, maxBytes);
  if (value === undefined) return undefined;
  if (signed) {
    return convertSymbolToSignedInt(value);
  }
  return value;
}

// core/Macros.js - ported from macros.h

// Converts major/minor version into a single uint16 number.
function bitstreamVersion(major, minor) {
  return ((major & 0xFF) << 8) | (minor & 0xFF);
}

// core/DecoderBuffer.js - ported from decoder_buffer.h/cc


class BitDecoder {

  constructor() {
    this._bitBuffer = null;
    this._bitOffset = 0;
    this._byteLength = 0;
  }

  reset(uint8Array, byteLength) {
    this._bitBuffer = uint8Array;
    this._byteLength = byteLength;
    this._bitOffset = 0;
  }

  bitsDecoded() {
    return this._bitOffset;
  }

  availBits() {
    return (this._byteLength * 8) - this._bitOffset;
  }

  getBits(nbits) {
    if (nbits > 32) return undefined;
    const buf = this._bitBuffer;
    let off = this._bitOffset;
    let value = 0;
    let bitsRead = 0;

    // Read bits in bulk from byte-aligned chunks.
    while (bitsRead < nbits) {
      const byteOffset = off >> 3;
      if (byteOffset >= this._byteLength) break;
      const bitShift = off & 7;
      // Number of bits available in this byte.
      const bitsAvail = 8 - bitShift;
      const bitsNeeded = nbits - bitsRead;
      const bitsToRead = bitsAvail < bitsNeeded ? bitsAvail : bitsNeeded;
      const mask = (1 << bitsToRead) - 1;
      value |= ((buf[byteOffset] >> bitShift) & mask) << bitsRead;
      bitsRead += bitsToRead;
      off += bitsToRead;
    }

    this._bitOffset = off;
    return value;
  }

}

class DecoderBuffer {

  constructor() {
    this._data = null;
    this._dataView = null;
    this._dataSize = 0;
    this._pos = 0;
    this._bitDecoder = new BitDecoder();
    this._bitMode = false;
    this._bitstreamVersion = 0;
  }

  init(data, dataSize, version) {
    if (data instanceof ArrayBuffer) {
      this._data = new Uint8Array(data);
    } else if (data instanceof Uint8Array) {
      this._data = data;
    } else {
      this._data = new Uint8Array(data);
    }
    this._dataView = new DataView(this._data.buffer, this._data.byteOffset, this._data.byteLength);
    this._dataSize = dataSize !== undefined ? dataSize : this._data.length;
    this._pos = 0;
    if (version !== undefined) {
      this._bitstreamVersion = version;
    }
  }

  // Decode typed values (little-endian)
  decodeUint8() {
    if (this._pos + 1 > this._dataSize) return undefined;
    const val = this._data[this._pos];
    this._pos += 1;
    return val;
  }

  decodeInt8() {
    if (this._pos + 1 > this._dataSize) return undefined;
    const val = this._dataView.getInt8(this._pos);
    this._pos += 1;
    return val;
  }

  decodeUint16() {
    if (this._pos + 2 > this._dataSize) return undefined;
    const val = this._dataView.getUint16(this._pos, true);
    this._pos += 2;
    return val;
  }

  decodeInt16() {
    if (this._pos + 2 > this._dataSize) return undefined;
    const val = this._dataView.getInt16(this._pos, true);
    this._pos += 2;
    return val;
  }

  decodeUint32() {
    if (this._pos + 4 > this._dataSize) return undefined;
    const val = this._dataView.getUint32(this._pos, true);
    this._pos += 4;
    return val;
  }

  decodeInt32() {
    if (this._pos + 4 > this._dataSize) return undefined;
    const val = this._dataView.getInt32(this._pos, true);
    this._pos += 4;
    return val;
  }

  decodeFloat32() {
    if (this._pos + 4 > this._dataSize) return undefined;
    const val = this._dataView.getFloat32(this._pos, true);
    this._pos += 4;
    return val;
  }

  decodeFloat64() {
    if (this._pos + 8 > this._dataSize) return undefined;
    const val = this._dataView.getFloat64(this._pos, true);
    this._pos += 8;
    return val;
  }

  decodeUint64() {
    if (this._pos + 8 > this._dataSize) return undefined;
    const lo = this._dataView.getUint32(this._pos, true);
    const hi = this._dataView.getUint32(this._pos + 4, true);
    this._pos += 8;
    // Return as BigInt-free number (safe up to 2^53)
    return hi * 0x100000000 + lo;
  }

  // Decode raw bytes into a Uint8Array
  decodeBytes(size) {
    if (this._pos + size > this._dataSize) return undefined;
    const result = this._data.slice(this._pos, this._pos + size);
    this._pos += size;
    return result;
  }

  // Peek without advancing
  peekUint8() {
    if (this._pos + 1 > this._dataSize) return undefined;
    return this._data[this._pos];
  }

  // Bit decoding
  startBitDecoding(decodeSize) {
    let outSize = 0;
    if (decodeSize) {
      if (this._bitstreamVersion < bitstreamVersion(2, 2)) {
        outSize = this.decodeUint64();
        if (outSize === undefined) return undefined;
      } else {
        outSize = decodeVarint(this, false);
        if (outSize === undefined) return undefined;
      }
    }
    this._bitMode = true;
    this._bitDecoder.reset(
      this._data.subarray(this._pos),
      this._dataSize - this._pos
    );
    return outSize;
  }

  endBitDecoding() {
    this._bitMode = false;
    const bitsDecoded = this._bitDecoder.bitsDecoded();
    const bytesDecoded = Math.ceil(bitsDecoded / 8);
    this._pos += bytesDecoded;
  }

  decodeLeastSignificantBits32(nbits) {
    if (!this._bitMode) return undefined;
    return this._bitDecoder.getBits(nbits);
  }

  // Decode a varint-encoded uint32 value.
  decodeVarintUint32() {
    return decodeVarint(this, false);
  }

  // Decode a varint-encoded uint64 value.
  decodeVarintUint64() {
    return decodeVarint(this, false);
  }

  advance(bytes) {
    this._pos += bytes;
  }

  startDecodingFrom(offset) {
    this._pos = offset;
  }

  get bitstreamVersion() { return this._bitstreamVersion; }
  set bitstreamVersion(v) { this._bitstreamVersion = v; }

  get data() { return this._data; }
  get dataHead() { return this._data.subarray(this._pos); }
  get remainingSize() { return this._dataSize - this._pos; }
  get decodedSize() { return this._pos; }
  get bitDecoderActive() { return this._bitMode; }

}

// point_cloud/PointCloud.js - ported from point_cloud/point_cloud.h/cc


// Mirrors GeometryAttribute::Type enum values used for named attribute indexing.
// These must match the C++ GeometryAttribute::Type enum.
const NAMED_ATTRIBUTES_COUNT = 8;

class PointCloud {

  constructor() {

    this.num_points_ = 0;
    this.attributes_ = [];
    this.metadata_ = null;

    // Array of arrays: named_attribute_index_[type] = [att_id, ...]
    this.named_attribute_index_ = [];
    for (let i = 0; i < NAMED_ATTRIBUTES_COUNT; ++i) {

      this.named_attribute_index_.push([]);

    }

  }

  // Returns the number of named attributes of a given type.
  numNamedAttributes(type) {

    if (type < 0 || type >= NAMED_ATTRIBUTES_COUNT) {
      return 0;
    }

    return this.named_attribute_index_[type].length;

  }

  // Returns attribute id of the i-th named attribute with a given type or -1.
  getNamedAttributeId(type, i) {

    if (i === undefined) i = 0;
    if (this.numNamedAttributes(type) <= i) {
      return -1;
    }

    return this.named_attribute_index_[type][i];

  }

  // Returns the first or i-th named attribute of a given type or null.
  getNamedAttribute(type, i) {

    if (i === undefined) i = 0;
    const attId = this.getNamedAttributeId(type, i);
    if (attId === -1) {
      return null;
    }

    return this.attributes_[attId];

  }

  // Returns the named attribute with a given unique id.
  getNamedAttributeByUniqueId(type, uniqueId) {

    const namedIndex = this.named_attribute_index_[type];
    for (let i = 0; i < namedIndex.length; ++i) {

      if (this.attributes_[namedIndex[i]].uniqueId === uniqueId) {
        return this.attributes_[namedIndex[i]];
      }

    }

    return null;

  }

  // Returns the attribute with a given unique id.
  getAttributeByUniqueId(uniqueId) {

    const attId = this.getAttributeIdByUniqueId(uniqueId);
    if (attId === -1) {
      return null;
    }

    return this.attributes_[attId];

  }

  getAttributeIdByUniqueId(uniqueId) {

    for (let i = 0; i < this.attributes_.length; ++i) {

      if (this.attributes_[i].uniqueId === uniqueId) {
        return i;
      }

    }

    return -1;

  }

  numAttributes() {

    return this.attributes_.length;

  }

  attribute(attId) {

    return this.attributes_[attId];

  }

  // Adds a new attribute to the point cloud. Returns the attribute id.
  addAttribute(pa) {

    this.setAttribute(this.attributes_.length, pa);
    return this.attributes_.length - 1;

  }

  // Assigns an attribute to a given attribute id.
  setAttribute(attId, pa) {

    if (this.attributes_.length <= attId) {

      // Resize the array to accommodate the new attribute id.
      while (this.attributes_.length <= attId) {
        this.attributes_.push(null);
      }

    }

    if (pa.attributeType < NAMED_ATTRIBUTES_COUNT) {

      this.named_attribute_index_[pa.attributeType].push(attId);

    }

    pa.uniqueId = attId;
    this.attributes_[attId] = pa;

  }

  deleteAttribute(attId) {

    if (attId < 0 || attId >= this.attributes_.length) {
      return;
    }

    const attType = this.attributes_[attId].attributeType();
    const uniqueId = this.attributes_[attId].uniqueId;
    this.attributes_.splice(attId, 1);

    // Remove metadata if applicable.
    if (this.metadata_) {
      this.metadata_.deleteAttributeMetadataByUniqueId(uniqueId);
    }

    // Remove from named attribute list.
    if (attType < NAMED_ATTRIBUTES_COUNT) {

      const idx = this.named_attribute_index_[attType].indexOf(attId);
      if (idx !== -1) {
        this.named_attribute_index_[attType].splice(idx, 1);
      }

    }

    // Update ids of all subsequent named attributes.
    for (let i = 0; i < NAMED_ATTRIBUTES_COUNT; ++i) {

      for (let j = 0; j < this.named_attribute_index_[i].length; ++j) {

        if (this.named_attribute_index_[i][j] > attId) {
          this.named_attribute_index_[i][j]--;
        }

      }

    }

  }

  numPoints() {

    return this.num_points_;

  }

  setNumPoints(num) {

    this.num_points_ = num;

  }

  setMetadata(metadata) {

    this.metadata_ = metadata;

  }

  getMetadata() {

    return this.metadata_;

  }

}

// mesh/Mesh.js - ported from mesh/mesh.h/cc


// Mesh attribute element types.
const MeshAttributeElementType = {
  MESH_VERTEX_ATTRIBUTE: 0,
  MESH_CORNER_ATTRIBUTE: 1};

class Mesh extends PointCloud {

  constructor() {

    super();
    // Faces stored as a flat Int32Array of point indices (3 per face) for cache
    // locality and to avoid an allocation per face. faces_[3*f + c] is the c-th
    // corner's point index of face f; corner index ci maps directly to faces_[ci].
    this.faces_ = new Int32Array(0);
    this.numFaces_ = 0;
    // Per-attribute data tracking element type.
    this.attribute_data_ = [];

  }

  _ensureFaceCapacity(numFaces) {

    if (this.faces_.length >= numFaces * 3) {
      return;
    }
    const grown = new Int32Array(numFaces * 3);
    grown.set(this.faces_);
    this.faces_ = grown;

  }

  addFace(face) {

    const f = this.numFaces_;
    this._ensureFaceCapacity(f + 1);
    const o = f * 3;
    this.faces_[o] = face[0];
    this.faces_[o + 1] = face[1];
    this.faces_[o + 2] = face[2];
    this.numFaces_ = f + 1;

  }

  setFace(faceId, face) {

    if (faceId >= this.numFaces_) {
      this._ensureFaceCapacity(faceId + 1);
      this.numFaces_ = faceId + 1;
    }
    const o = faceId * 3;
    this.faces_[o] = face[0];
    this.faces_[o + 1] = face[1];
    this.faces_[o + 2] = face[2];

  }

  // Like setFace() but takes the three corner point indices directly, avoiding
  // a temporary [v0, v1, v2] array allocation per face in the hot decode path.
  setFaceVertices(faceId, v0, v1, v2) {

    if (faceId >= this.numFaces_) {
      this._ensureFaceCapacity(faceId + 1);
      this.numFaces_ = faceId + 1;
    }
    const o = faceId * 3;
    this.faces_[o] = v0;
    this.faces_[o + 1] = v1;
    this.faces_[o + 2] = v2;

  }

  setNumFaces(numFaces) {

    this._ensureFaceCapacity(numFaces);
    this.numFaces_ = numFaces;

  }

  numFaces() {

    return this.numFaces_;

  }

  // Returns a fresh [v0, v1, v2] array (public API). Hot internal loops should
  // use faceVertex() to avoid the allocation.
  face(faceId) {

    const o = faceId * 3;
    return [this.faces_[o], this.faces_[o + 1], this.faces_[o + 2]];

  }

  // Returns a single corner's point index without allocating.
  faceVertex(faceId, corner) {

    return this.faces_[faceId * 3 + corner];

  }

  setAttribute(attId, pa) {

    super.setAttribute(attId, pa);
    while (this.attribute_data_.length <= attId) {
      this.attribute_data_.push({ elementType: MeshAttributeElementType.MESH_CORNER_ATTRIBUTE });
    }

  }

  deleteAttribute(attId) {

    super.deleteAttribute(attId);
    if (attId >= 0 && attId < this.attribute_data_.length) {
      this.attribute_data_.splice(attId, 1);
    }

  }

  getAttributeElementType(attId) {

    return this.attribute_data_[attId].elementType;

  }

  setAttributeElementType(attId, et) {

    this.attribute_data_[attId].elementType = et;

  }

  // Returns the point id for a corner index (plain integer). With the flat face
  // layout the corner index is a direct index into faces_.
  cornerToPointId(ci) {

    if (ci < 0) {
      return -1;
    }
    return this.faces_[ci];

  }

}

// core/Status.js - ported from status.h/cc

const StatusCode = {
  OK: 0,
  DRACO_ERROR: -1,
  IO_ERROR: -2,
  INVALID_PARAMETER: -3,
  UNSUPPORTED_VERSION: -4,
  UNKNOWN_VERSION: -5,
  UNSUPPORTED_FEATURE: -6
};

const CODE_STRINGS = {
  [StatusCode.OK]: 'OK',
  [StatusCode.DRACO_ERROR]: 'DRACO_ERROR',
  [StatusCode.IO_ERROR]: 'IO_ERROR',
  [StatusCode.INVALID_PARAMETER]: 'INVALID_PARAMETER',
  [StatusCode.UNSUPPORTED_VERSION]: 'UNSUPPORTED_VERSION',
  [StatusCode.UNKNOWN_VERSION]: 'UNKNOWN_VERSION',
  [StatusCode.UNSUPPORTED_FEATURE]: 'UNSUPPORTED_FEATURE'
};

class Status {

  constructor(code = StatusCode.OK, errorMsg = '') {
    this.code = code;
    this.errorMsg = errorMsg;
  }

  ok() {
    return this.code === StatusCode.OK;
  }

  codeString() {
    return CODE_STRINGS[this.code] || 'UNKNOWN_STATUS_VALUE';
  }

  toString() {
    if (this.errorMsg) {
      return this.codeString() + ': ' + this.errorMsg;
    }
    return this.codeString();
  }

}

function okStatus() {
  return new Status(StatusCode.OK);
}

// compression/point_cloud/PointCloudDecoder.js - ported from point_cloud/point_cloud_decoder.h/cc


// Abstract base class for all point cloud and mesh decoders. It provides a
// basic functionality that is shared between different decoders.
class PointCloudDecoder {

  constructor() {
    this._pointCloud = null;
    this._buffer = null;
    this._versionMajor = 0;
    this._versionMinor = 0;
    this._options = null;
    this._attributesDecoders = [];
    this._attributeToDecoderMap = [];
  }

  getGeometryType() {
    return EncodedGeometryType.POINT_CLOUD;
  }

  // Decodes a Draco header from the provided buffer.
  // Returns a Status. On success, out_header is populated.
  static decodeHeader(buffer, outHeader) {
    const kIoErrorMsg = 'Failed to parse Draco header.';
    const bytes = buffer.decodeBytes(5);
    if (bytes === undefined) {
      return new Status(StatusCode.IO_ERROR, kIoErrorMsg);
    }
    for (let i = 0; i < 5; i++) {
      outHeader.dracoString[i] = bytes[i];
    }
    // Check for "DRACO" magic string
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
    if (magic !== 'DRACO') {
      return new Status(StatusCode.DRACO_ERROR, 'Not a Draco file.');
    }
    outHeader.versionMajor = buffer.decodeUint8();
    if (outHeader.versionMajor === undefined) {
      return new Status(StatusCode.IO_ERROR, kIoErrorMsg);
    }
    outHeader.versionMinor = buffer.decodeUint8();
    if (outHeader.versionMinor === undefined) {
      return new Status(StatusCode.IO_ERROR, kIoErrorMsg);
    }
    outHeader.encoderType = buffer.decodeUint8();
    if (outHeader.encoderType === undefined) {
      return new Status(StatusCode.IO_ERROR, kIoErrorMsg);
    }
    outHeader.encoderMethod = buffer.decodeUint8();
    if (outHeader.encoderMethod === undefined) {
      return new Status(StatusCode.IO_ERROR, kIoErrorMsg);
    }
    outHeader.flags = buffer.decodeUint16();
    if (outHeader.flags === undefined) {
      return new Status(StatusCode.IO_ERROR, kIoErrorMsg);
    }
    return okStatus();
  }

  // The main entry point for point cloud decoding.
  decode(options, inBuffer, outPointCloud) {
    this._options = options;
    this._buffer = inBuffer;
    this._pointCloud = outPointCloud;

    const header = new DracoHeader();
    const headerStatus = PointCloudDecoder.decodeHeader(this._buffer, header);
    if (!headerStatus.ok()) {
      return headerStatus;
    }

    // Sanity check that we are using the right decoder.
    if (header.encoderType !== this.getGeometryType()) {
      return new Status(StatusCode.DRACO_ERROR,
        'Using incompatible decoder for the input geometry.');
    }

    this._versionMajor = header.versionMajor;
    this._versionMinor = header.versionMinor;

    const maxSupportedMajorVersion =
      header.encoderType === EncodedGeometryType.POINT_CLOUD
        ? kDracoPointCloudBitstreamVersionMajor
        : kDracoMeshBitstreamVersionMajor;
    const maxSupportedMinorVersion =
      header.encoderType === EncodedGeometryType.POINT_CLOUD
        ? kDracoPointCloudBitstreamVersionMinor
        : kDracoMeshBitstreamVersionMinor;

    // Check for version compatibility (backwards compatibility supported).
    if (this._versionMajor < 1 || this._versionMajor > maxSupportedMajorVersion) {
      return new Status(StatusCode.UNKNOWN_VERSION, 'Unknown major version.');
    }
    if (this._versionMajor === maxSupportedMajorVersion &&
        this._versionMinor > maxSupportedMinorVersion) {
      return new Status(StatusCode.UNKNOWN_VERSION, 'Unknown minor version.');
    }

    this._buffer.bitstreamVersion =
      DRACO_BITSTREAM_VERSION(this._versionMajor, this._versionMinor);

    if (this.bitstreamVersion() >= DRACO_BITSTREAM_VERSION(1, 3) &&
        (header.flags & METADATA_FLAG_MASK)) {
      const metadataStatus = this._decodeMetadata();
      if (!metadataStatus.ok()) {
        return metadataStatus;
      }
    }

    if (!this.initializeDecoder()) {
      return new Status(StatusCode.DRACO_ERROR, 'Failed to initialize the decoder.');
    }
    if (!this.decodeGeometryData()) {
      return new Status(StatusCode.DRACO_ERROR, 'Failed to decode geometry data.');
    }
    if (!this.decodePointAttributes()) {
      return new Status(StatusCode.DRACO_ERROR, 'Failed to decode point attributes.');
    }
    return okStatus();
  }

  bitstreamVersion() {
    return DRACO_BITSTREAM_VERSION(this._versionMajor, this._versionMinor);
  }

  setAttributesDecoder(attDecoderId, decoder) {
    if (attDecoderId < 0) {
      return false;
    }
    while (this._attributesDecoders.length <= attDecoderId) {
      this._attributesDecoders.push(null);
    }
    this._attributesDecoders[attDecoderId] = decoder;
    return true;
  }

  getPortableAttribute(parentAttId) {
    if (parentAttId < 0 || parentAttId >= this._pointCloud.numAttributes()) {
      return null;
    }
    const parentAttDecoderId = this._attributeToDecoderMap[parentAttId];
    return this._attributesDecoders[parentAttDecoderId].getPortableAttribute(parentAttId);
  }

  attributesDecoder(decId) {
    return this._attributesDecoders[decId];
  }

  numAttributesDecoders() {
    return this._attributesDecoders.length;
  }

  pointCloud() {
    return this._pointCloud;
  }

  buffer() {
    return this._buffer;
  }

  options() {
    return this._options;
  }

  // -- Protected virtual methods (override in subclasses) --

  initializeDecoder() {
    return true;
  }

  // Must be implemented by derived classes.
  createAttributesDecoder(/* attDecoderId */) {
    return false;
  }

  decodeGeometryData() {
    return true;
  }

  decodePointAttributes() {
    const numAttributesDecoders = this._buffer.decodeUint8();
    if (numAttributesDecoders === undefined) {
      return false;
    }
    // Create all attribute decoders.
    for (let i = 0; i < numAttributesDecoders; ++i) {
      if (!this.createAttributesDecoder(i)) {
        return false;
      }
    }
    // Initialize all attributes decoders.
    for (let i = 0; i < this._attributesDecoders.length; ++i) {
      if (!this._attributesDecoders[i].init(this, this._pointCloud)) {
        return false;
      }
    }
    // Decode data needed by the attribute decoders.
    for (let i = 0; i < numAttributesDecoders; ++i) {
      if (!this._attributesDecoders[i].decodeAttributesDecoderData(this._buffer)) {
        return false;
      }
    }
    // Create map between attribute and decoder ids.
    for (let i = 0; i < numAttributesDecoders; ++i) {
      const numAttributes = this._attributesDecoders[i].getNumAttributes();
      for (let j = 0; j < numAttributes; ++j) {
        const attId = this._attributesDecoders[i].getAttributeId(j);
        while (this._attributeToDecoderMap.length <= attId) {
          this._attributeToDecoderMap.push(0);
        }
        this._attributeToDecoderMap[attId] = i;
      }
    }
    // Decode the actual attributes.
    if (!this.decodeAllAttributes()) {
      return false;
    }
    if (!this.onAttributesDecoded()) {
      return false;
    }
    return true;
  }

  decodeAllAttributes() {
    for (let i = 0; i < this._attributesDecoders.length; i++) {
      if (!this._attributesDecoders[i].decodeAttributes(this._buffer)) {
        return false;
      }
    }
    return true;
  }

  onAttributesDecoded() {
    return true;
  }

  _decodeMetadata() {
    // Metadata decoding is a stub - actual MetadataDecoder would be needed.
    // For now, skip metadata if present (this mirrors the typical JS decoder).
    return okStatus();
  }

}

// compression/point_cloud/PointCloudSequentialDecoder.js - ported from point_cloud/point_cloud_sequential_decoder.h/cc


// Point cloud decoder for data encoded by the PointCloudSequentialEncoder.
// All attribute values are decoded using an identity mapping between point ids
// and attribute value ids.
class PointCloudSequentialDecoder extends PointCloudDecoder {

  decodeGeometryData() {
    const numPoints = this.buffer().decodeInt32();
    if (numPoints === undefined) {
      return false;
    }
    this.pointCloud().setNumPoints(numPoints);
    return true;
  }

  createAttributesDecoder(attDecoderId) {
    // Always create the basic attribute decoder.
    // The SequentialAttributeDecodersController with a LinearSequencer
    // would be instantiated here. This is a placeholder that matches
    // the C++ structure - actual implementation depends on the
    // SequentialAttributeDecodersController and LinearSequencer modules.
    //
    // return this.setAttributesDecoder(
    //   attDecoderId,
    //   new SequentialAttributeDecodersController(
    //     new LinearSequencer(this.pointCloud().numPoints())
    //   )
    // );
    //
    // For now, return false to indicate the dependent modules are needed.
    return false;
  }

}

// compression/point_cloud/PointCloudKdTreeDecoder.js - ported from point_cloud/point_cloud_kd_tree_decoder.h/cc


// Decodes PointCloud encoded with the PointCloudKdTreeEncoder.
class PointCloudKdTreeDecoder extends PointCloudDecoder {

  decodeGeometryData() {
    const numPoints = this.buffer().decodeInt32();
    if (numPoints === undefined) {
      return false;
    }
    if (numPoints < 0) {
      return false;
    }
    this.pointCloud().setNumPoints(numPoints);
    return true;
  }

  createAttributesDecoder(attDecoderId) {
    // Always create the basic attribute decoder using a KdTreeAttributesDecoder.
    // The actual KdTreeAttributesDecoder module would be needed here.
    //
    // return this.setAttributesDecoder(
    //   attDecoderId,
    //   new KdTreeAttributesDecoder()
    // );
    //
    // For now, return false to indicate the dependent module is needed.
    return false;
  }

}

// compression/mesh/MeshDecoder.js - ported from mesh/mesh_decoder.h/cc


// Class that reconstructs a 3D mesh from input data that was encoded by
// MeshEncoder.
class MeshDecoder extends PointCloudDecoder {

  constructor() {
    super();
    this._mesh = null;
  }

  getGeometryType() {
    return EncodedGeometryType.TRIANGULAR_MESH;
  }

  // The main entry point for mesh decoding.
  decodeMesh(options, inBuffer, outMesh) {
    this._mesh = outMesh;
    return this.decode(options, inBuffer, outMesh);
  }

  // Returns the base connectivity of the decoded mesh (or null if not initialized).
  getCornerTable() {
    return null;
  }

  // Returns the attribute connectivity data or null if it does not exist.
  getAttributeCornerTable(/* attId */) {
    return null;
  }

  // Returns the decoding data for a given attribute or null when the data
  // does not exist.
  getAttributeEncodingData(/* attId */) {
    return null;
  }

  mesh() {
    return this._mesh;
  }

  decodeGeometryData() {
    if (this._mesh === null) {
      return false;
    }
    if (!this.decodeConnectivity()) {
      return false;
    }
    return super.decodeGeometryData();
  }

  // Must be implemented by derived classes.
  decodeConnectivity() {
    return false;
  }

}

// compression/mesh/MeshSequentialDecoder.js - ported from mesh/mesh_sequential_decoder.h/cc


// Class for decoding data encoded by MeshSequentialEncoder.
class MeshSequentialDecoder extends MeshDecoder {

  constructor() {
    super();
  }

  decodeConnectivity() {
    let numFaces;
    let numPoints;

    if (this.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 2)) {
      numFaces = this.buffer().decodeUint32();
      if (numFaces === undefined) return false;
      numPoints = this.buffer().decodeUint32();
      if (numPoints === undefined) return false;
    } else {
      numFaces = decodeVarint(this.buffer());
      if (numFaces === undefined) return false;
      numPoints = decodeVarint(this.buffer());
      if (numPoints === undefined) return false;
    }

    // Check that numFaces is a valid value.
    // Compressed sequential encoding can only handle (2^32 - 1) / 3 indices.
    if (numFaces > 0xFFFFFFFF / 3) {
      return false;
    }
    if (numFaces > this.buffer().remainingSize / 3) {
      // The number of faces is unreasonably high.
      return false;
    }

    const connectivityMethod = this.buffer().decodeUint8();
    if (connectivityMethod === undefined) {
      return false;
    }

    if (connectivityMethod === 0) {
      if (!this._decodeAndDecompressIndices(numFaces)) {
        return false;
      }
    } else {
      if (numPoints < 256) {
        // Decode indices as uint8.
        for (let i = 0; i < numFaces; ++i) {
          const face = [0, 0, 0];
          for (let j = 0; j < 3; ++j) {
            const val = this.buffer().decodeUint8();
            if (val === undefined) return false;
            face[j] = val;
          }
          this.mesh().addFace(face);
        }
      } else if (numPoints < (1 << 16)) {
        // Decode indices as uint16.
        for (let i = 0; i < numFaces; ++i) {
          const face = [0, 0, 0];
          for (let j = 0; j < 3; ++j) {
            const val = this.buffer().decodeUint16();
            if (val === undefined) return false;
            face[j] = val;
          }
          this.mesh().addFace(face);
        }
      } else if (numPoints < (1 << 21) &&
                 this.bitstreamVersion() >= DRACO_BITSTREAM_VERSION(2, 2)) {
        // Decode indices as varint.
        for (let i = 0; i < numFaces; ++i) {
          const face = [0, 0, 0];
          for (let j = 0; j < 3; ++j) {
            const val = decodeVarint(this.buffer());
            if (val === undefined) return false;
            face[j] = val;
          }
          this.mesh().addFace(face);
        }
      } else {
        // Decode faces as uint32 (default).
        for (let i = 0; i < numFaces; ++i) {
          const face = [0, 0, 0];
          for (let j = 0; j < 3; ++j) {
            const val = this.buffer().decodeUint32();
            if (val === undefined) return false;
            face[j] = val;
          }
          this.mesh().addFace(face);
        }
      }
    }

    this.pointCloud().setNumPoints(numPoints);
    return true;
  }

  createAttributesDecoder(attDecoderId) {
    // Always create the basic attribute decoder.
    // The SequentialAttributeDecodersController with a LinearSequencer
    // would be instantiated here. Dependent on those modules being ported.
    //
    // return this.setAttributesDecoder(
    //   attDecoderId,
    //   new SequentialAttributeDecodersController(
    //     new LinearSequencer(this.pointCloud().numPoints())
    //   )
    // );
    return false;
  }

  // Decodes face indices that were compressed with an entropy code.
  _decodeAndDecompressIndices(numFaces) {
    // Get decoded indices differences that were encoded with an entropy code.
    // This requires the DecodeSymbols function from the entropy module.
    // For now this is a placeholder that mirrors the C++ logic.
    //
    // const indicesBuffer = new Uint32Array(numFaces * 3);
    // if (!decodeSymbols(numFaces * 3, 1, this.buffer(), indicesBuffer)) {
    //   return false;
    // }
    //
    // Reconstruct the indices from the differences.
    // let lastIndexValue = 0;
    // let vertexIndex = 0;
    // for (let i = 0; i < numFaces; ++i) {
    //   const face = [0, 0, 0];
    //   for (let j = 0; j < 3; ++j) {
    //     const encodedVal = indicesBuffer[vertexIndex++];
    //     let indexDiff = (encodedVal >> 1);
    //     if (encodedVal & 1) {
    //       if (indexDiff > lastIndexValue) return false;
    //       indexDiff = -indexDiff;
    //     } else {
    //       if (indexDiff > (0x7FFFFFFF - lastIndexValue)) return false;
    //     }
    //     const indexValue = indexDiff + lastIndexValue;
    //     face[j] = indexValue;
    //     lastIndexValue = indexValue;
    //   }
    //   this.mesh().addFace(face);
    // }
    // return true;
    return false;
  }

}

// compression/mesh/MeshEdgebreakerShared.js - ported from mesh/mesh_edgebreaker_shared.h

// Edgebreaker topology bit patterns.
// Variable length encoding for storing all possible topology configurations
// during traversal of mesh's surface.
const TOPOLOGY_C = 0x0;  // 0
const TOPOLOGY_S = 0x1;  // 1 0 0
const TOPOLOGY_L = 0x3;  // 1 1 0
const TOPOLOGY_R = 0x5;  // 1 0 1
const TOPOLOGY_E = 0x7;  // 1 1 1
// Special value used to indicate an invalid symbol.
const TOPOLOGY_INVALID = 9;

// Reverse mapping between symbol id and topology pattern symbol.
const edgeBreakerSymbolToTopologyId = [
  TOPOLOGY_C, TOPOLOGY_S, TOPOLOGY_L, TOPOLOGY_R, TOPOLOGY_E
];
const RIGHT_FACE_EDGE = 1;

// Struct used for storing data about a source face that connects to an
// already traversed face that was either the initial face or a face encoded
// with the topology S (split) symbol.
class TopologySplitEventData {

  constructor() {
    this.splitSymbolId = 0;
    this.sourceSymbolId = 0;
    this.sourceEdge = 0; // 0 = LEFT_FACE_EDGE, 1 = RIGHT_FACE_EDGE
  }

}

// Hole event is used to store info about the first symbol that reached a
// vertex of a so far unvisited hole.
class HoleEventData {

  constructor(symbolId) {
    this.symbolId = symbolId !== undefined ? symbolId : 0;
  }

}

// List of supported modes for valence based edgebreaker coding.
const EDGEBREAKER_VALENCE_MODE_2_7 = 0;

// compression/attributes/AttributesDecoderInterface.js - ported from compression/attributes/attributes_decoder_interface.h

// Interface class for decoding one or more attributes that were encoded with a
// matching AttributesEncoder. It provides only the basic interface
// that is used by the PointCloudDecoder. The actual decoding must be
// implemented in derived classes using the decodeAttributes() method.
class AttributesDecoderInterface {

  constructor() {
    // Abstract interface - no state.
  }

  // Called after all attribute decoders are created. It can be used to perform
  // any custom initialization.
  init(decoder, pointCloud) {
    return false; // Must be overridden.
  }

  // Decodes any attribute decoder specific data from the buffer.
  decodeAttributesDecoderData(buffer) {
    return false; // Must be overridden.
  }

  // Decode attribute data from the source buffer. Needs to be implemented by
  // the derived classes.
  decodeAttributes(buffer) {
    return false; // Must be overridden.
  }

  getAttributeId(i) {
    return -1; // Must be overridden.
  }

  getNumAttributes() {
    return 0; // Must be overridden.
  }

  getDecoder() {
    return null; // Must be overridden.
  }

  // Returns an attribute containing data processed by the attribute transform.
  // (see transformToPortableFormat() method). This data is guaranteed to be
  // same for encoder and decoder and it can be used by predictors.
  getPortableAttribute(pointAttributeId) {
    return null;
  }

}

// core/DracoTypes.js - ported from draco_types.h/cc

const DataType = {
  INVALID: 0,
  INT8: 1,
  UINT8: 2,
  INT16: 3,
  UINT16: 4,
  INT32: 5,
  UINT32: 6,
  INT64: 7,
  UINT64: 8,
  FLOAT32: 9,
  FLOAT64: 10,
  BOOL: 11,
  TYPES_COUNT: 12
};

function dataTypeLength(dt) {
  switch (dt) {
    case DataType.INT8:
    case DataType.UINT8:
      return 1;
    case DataType.INT16:
    case DataType.UINT16:
      return 2;
    case DataType.INT32:
    case DataType.UINT32:
      return 4;
    case DataType.INT64:
    case DataType.UINT64:
      return 8;
    case DataType.FLOAT32:
      return 4;
    case DataType.FLOAT64:
      return 8;
    case DataType.BOOL:
      return 1;
    default:
      return -1;
  }
}

// core/DataBuffer.js - ported from data_buffer.h/cc

class DataBuffer {

  constructor() {
    this._data = new Uint8Array(0);
    this._updateCount = 0;
  }

  update(data, size, offset = 0) {
    if (data === null || data === undefined) {
      if (size + offset < 0) return false;
      this._resize(size + offset);
    } else {
      if (size < 0) return false;
      if (size + offset > this._data.length) {
        this._resize(size + offset);
      }
      const src = new Uint8Array(data.buffer || data, data.byteOffset || 0, size);
      this._data.set(src, offset);
    }
    this._updateCount++;
    return true;
  }

  resize(newSize) {
    this._resize(newSize);
    this._updateCount++;
  }

  read(bytePos, outArray, dataSize) {
    outArray.set(this._data.subarray(bytePos, bytePos + dataSize));
  }

  write(bytePos, inArray, dataSize) {
    // Fast path: the overwhelmingly common caller passes a Uint8Array view of
    // exactly dataSize bytes (one attribute entry). Avoid allocating a wrapper
    // view on every value, which otherwise dominates attribute storage time and
    // GC pressure.
    if (inArray instanceof Uint8Array) {
      this._data.set(inArray.length === dataSize ? inArray : inArray.subarray(0, dataSize), bytePos);
      return;
    }
    const src = new Uint8Array(inArray.buffer || inArray, inArray.byteOffset || 0, dataSize);
    this._data.set(src, bytePos);
  }

  copy(dstOffset, srcBuf, srcOffset, size) {
    this._data.set(srcBuf._data.subarray(srcOffset, srcOffset + size), dstOffset);
  }

  get data() { return this._data; }
  get dataSize() { return this._data.length; }
  get updateCount() { return this._updateCount; }

  _resize(newSize) {
    if (newSize === this._data.length) return;
    const newData = new Uint8Array(newSize);
    newData.set(this._data.subarray(0, Math.min(this._data.length, newSize)));
    this._data = newData;
  }

}

// attributes/GeometryAttribute.js - ported from attributes/geometry_attribute.h/cc


const Type = {
  INVALID: -1,
  NAMED_ATTRIBUTES_COUNT: 5
};

class GeometryAttribute {

  constructor() {
    this._buffer = null;
    this._numComponents = 1;
    this._dataType = DataType.FLOAT32;
    this._normalized = false;
    this._byteStride = 0;
    this._byteOffset = 0;
    this._attributeType = Type.INVALID;
    this._uniqueId = 0;
  }

  init(attributeType, buffer, numComponents, dataType, normalized, byteStride, byteOffset) {
    this._buffer = buffer;
    this._numComponents = numComponents;
    this._dataType = dataType;
    this._normalized = normalized;
    this._byteStride = byteStride;
    this._byteOffset = byteOffset;
    this._attributeType = attributeType;
  }

  isValid() {
    return this._buffer !== null;
  }

  // Returns the byte position of the attribute entry in the data buffer.
  getBytePos(attIndex) {
    return this._byteOffset + this._byteStride * attIndex;
  }

  // Returns a Uint8Array subarray pointing to the attribute entry in the buffer.
  getAddress(attIndex) {
    const bytePos = this.getBytePos(attIndex);
    return this._buffer.data.subarray(bytePos);
  }

  // Fills outData (Uint8Array) with the raw value of the requested attribute entry.
  getValue(attIndex, outData) {
    const bytePos = this._byteOffset + this._byteStride * attIndex;
    this._buffer.read(bytePos, outData, this._byteStride);
  }

  // Sets a value of an attribute entry. value should be a Uint8Array or typed array.
  setAttributeValue(entryIndex, value) {
    const bytePos = entryIndex * this._byteStride;
    this._buffer.write(bytePos, value, this._byteStride);
  }

  // Copies data from the source attribute to this attribute.
  copyFrom(srcAtt) {
    this._numComponents = srcAtt._numComponents;
    this._dataType = srcAtt._dataType;
    this._normalized = srcAtt._normalized;
    this._byteStride = srcAtt._byteStride;
    this._byteOffset = srcAtt._byteOffset;
    this._attributeType = srcAtt._attributeType;
    this._uniqueId = srcAtt._uniqueId;

    if (srcAtt._buffer === null) {
      this._buffer = null;
    } else {
      if (this._buffer === null) {
        return false;
      }
      this._buffer.update(srcAtt._buffer.data, srcAtt._buffer.dataSize);
    }
    return true;
  }

  // Sets a new internal storage for the attribute.
  resetBuffer(buffer, byteStride, byteOffset) {
    this._buffer = buffer;
    this._byteStride = byteStride;
    this._byteOffset = byteOffset;
  }

  get attributeType() { return this._attributeType; }
  set attributeType(type) { this._attributeType = type; }

  get dataType() { return this._dataType; }

  get numComponents() { return this._numComponents; }

  get normalized() { return this._normalized; }
  set normalized(value) { this._normalized = value; }

  get buffer() { return this._buffer; }

  get byteStride() { return this._byteStride; }

  get byteOffset() { return this._byteOffset; }
  set byteOffset(value) { this._byteOffset = value; }

  get uniqueId() { return this._uniqueId; }
  set uniqueId(id) { this._uniqueId = id; }

}

// attributes/GeometryIndices.js - ported from attributes/geometry_indices.h

// Sentinel for an invalid attribute value index.
// In C++ this is std::numeric_limits<uint32_t>::max(), i.e. 0xFFFFFFFF.
const kInvalidAttributeValueIndex = 0xFFFFFFFF >>> 0;

// attributes/PointAttribute.js - ported from attributes/point_attribute.h/cc


class PointAttribute extends GeometryAttribute {

  constructor(geometryAttribute) {
    super();
    this._identityMapping = false;
    this._numUniqueEntries = 0;
    this._indicesMap = [];
    this._attributeBuffer = null;
    this._attributeTransformData = null;

    // Copy-construct from a GeometryAttribute if provided.
    if (geometryAttribute instanceof GeometryAttribute) {
      this._buffer = geometryAttribute._buffer;
      this._numComponents = geometryAttribute._numComponents;
      this._dataType = geometryAttribute._dataType;
      this._normalized = geometryAttribute._normalized;
      this._byteStride = geometryAttribute._byteStride;
      this._byteOffset = geometryAttribute._byteOffset;
      this._attributeType = geometryAttribute._attributeType;
      this._uniqueId = geometryAttribute._uniqueId;
    }
  }

  // Initializes a point attribute with identity mapping.
  init(attributeType, numComponents, dataType, normalized, numAttributeValues) {
    this._attributeBuffer = new DataBuffer();
    const byteStride = dataTypeLength(dataType) * numComponents;
    super.init(attributeType, this._attributeBuffer, numComponents, dataType, normalized, byteStride, 0);
    this.reset(numAttributeValues);
    this.setIdentityMapping();
  }

  // Prepares the attribute storage for the specified number of entries.
  reset(numAttributeValues) {
    if (this._attributeBuffer === null) {
      this._attributeBuffer = new DataBuffer();
    }
    const entrySize = dataTypeLength(this.dataType) * this.numComponents;
    this._attributeBuffer.update(null, numAttributeValues * entrySize);
    // Assign the new buffer to the parent attribute.
    this.resetBuffer(this._attributeBuffer, entrySize, 0);
    this._numUniqueEntries = numAttributeValues;
    return true;
  }

  // Resizes the attribute storage.
  resize(newNumUniqueEntries) {
    this._numUniqueEntries = newNumUniqueEntries;
    this._attributeBuffer.resize(newNumUniqueEntries * this.byteStride);
  }

  get size() {
    return this._numUniqueEntries;
  }

  // Returns the mapped attribute value index for a given point index.
  mappedIndex(pointIndex) {
    if (this._identityMapping) {
      return pointIndex;
    }
    return this._indicesMap[pointIndex];
  }

  get isMappingIdentity() {
    return this._identityMapping;
  }

  get indicesMapSize() {
    if (this._identityMapping) {
      return 0;
    }
    return this._indicesMap.length;
  }

  // Direct access to the explicit point->value index map (Uint32Array after
  // setExplicitMapping). Lets hot mapping loops write entries without a
  // per-entry setPointMapEntry() dispatch.
  get indicesMap() {
    return this._indicesMap;
  }

  // Sets the mapping to implicit (point indices equal attribute entry indices).
  setIdentityMapping() {
    this._identityMapping = true;
    this._indicesMap = [];
  }

  // Sets the mapping to be explicit using the indicesMap array.
  setExplicitMapping(numPoints) {
    this._identityMapping = false;
    // Uint32Array (rather than a plain Array) keeps mappedIndex() monomorphic
    // and avoids boxed-number storage; it is read once per point per attribute.
    // Must be UNSIGNED so the 0xFFFFFFFF invalid sentinel round-trips intact.
    this._indicesMap = new Uint32Array(numPoints);
    this._indicesMap.fill(kInvalidAttributeValueIndex);
  }

  // Sets an explicit map entry for a specific point index.
  setPointMapEntry(pointIndex, entryIndex) {
    this._indicesMap[pointIndex] = entryIndex;
  }

  // Set attribute transform data for the attribute.
  setAttributeTransformData(transformData) {
    this._attributeTransformData = transformData;
  }

  getAttributeTransformData() {
    return this._attributeTransformData;
  }

  // Converts the attribute value at the given index into the output array.
  // Mirrors C++ PointAttribute::ConvertValue<T>().
  convertValue(attIndex, outVal) {
    const bytePos = this._byteOffset + this._byteStride * attIndex;
    const bufData = this._buffer.data;
    const dt = this._dataType;
    const nc = this._numComponents;

    // Fast path for FLOAT32 (most common case).
    if (dt === DataType.FLOAT32) {
      if (this._cachedFloat32View === undefined || this._cachedFloat32Buffer !== bufData.buffer) {
        this._cachedFloat32Buffer = bufData.buffer;
        this._cachedFloat32View = new Float32Array(bufData.buffer);
      }
      const baseIndex = (bufData.byteOffset + bytePos) >> 2;
      for (let i = 0; i < nc; ++i) {
        outVal[i] = this._cachedFloat32View[baseIndex + i];
      }
      return;
    }

    // Fast path for INT32 — the type of every portable (decoded-integer)
    // attribute, read per-corner by the geometric-normal / texcoords
    // predictors. A cached Int32Array view indexed by element avoids the
    // per-component DataView.getInt32 dispatch. Base byte position is always
    // 4-aligned for these attributes (byteStride is a multiple of 4).
    if (dt === DataType.INT32) {
      if (this._cachedInt32View === undefined || this._cachedInt32Buffer !== bufData.buffer) {
        this._cachedInt32Buffer = bufData.buffer;
        this._cachedInt32View = new Int32Array(bufData.buffer);
      }
      const baseIndex = (bufData.byteOffset + bytePos) >> 2;
      for (let i = 0; i < nc; ++i) {
        outVal[i] = this._cachedInt32View[baseIndex + i];
      }
      return;
    }

    if (dt === DataType.UINT32) {
      if (this._cachedUint32View === undefined || this._cachedUint32Buffer !== bufData.buffer) {
        this._cachedUint32Buffer = bufData.buffer;
        this._cachedUint32View = new Uint32Array(bufData.buffer);
      }
      const baseIndex = (bufData.byteOffset + bytePos) >> 2;
      for (let i = 0; i < nc; ++i) {
        outVal[i] = this._cachedUint32View[baseIndex + i];
      }
      return;
    }

    // General path using cached DataView.
    if (this._cachedDataView === undefined || this._cachedDVBuffer !== bufData.buffer) {
      this._cachedDVBuffer = bufData.buffer;
      this._cachedDataView = new DataView(bufData.buffer, bufData.byteOffset, bufData.byteLength);
    }
    const dv = this._cachedDataView;
    for (let i = 0; i < nc; ++i) {
      switch (dt) {
        case DataType.INT8:
          outVal[i] = dv.getInt8(bytePos + i); break;
        case DataType.UINT8:
          outVal[i] = dv.getUint8(bytePos + i); break;
        case DataType.INT16:
          outVal[i] = dv.getInt16(bytePos + i * 2, true); break;
        case DataType.UINT16:
          outVal[i] = dv.getUint16(bytePos + i * 2, true); break;
        case DataType.INT32:
          outVal[i] = dv.getInt32(bytePos + i * 4, true); break;
        case DataType.UINT32:
          outVal[i] = dv.getUint32(bytePos + i * 4, true); break;
        case DataType.FLOAT64:
          outVal[i] = dv.getFloat64(bytePos + i * 8, true); break;
        default:
          outVal[i] = 0; break;
      }
    }
  }

  // Copies attribute data from the provided source attribute.
  copyFrom(srcAtt) {
    if (this.buffer === null) {
      this._attributeBuffer = new DataBuffer();
      this.resetBuffer(this._attributeBuffer, 0, 0);
    }
    if (!super.copyFrom(srcAtt)) {
      return;
    }
    this._identityMapping = srcAtt._identityMapping;
    this._numUniqueEntries = srcAtt._numUniqueEntries;
    this._indicesMap = srcAtt._indicesMap.slice();
    if (srcAtt._attributeTransformData) {
      // Shallow copy of transform data -- typically set fresh during decode.
      this._attributeTransformData = srcAtt._attributeTransformData;
    } else {
      this._attributeTransformData = null;
    }
  }

}

// compression/attributes/AttributesDecoder.js - ported from compression/attributes/attributes_decoder.h/cc


// Base class for decoding one or more attributes that were encoded with a
// matching AttributesEncoder. It is a basic implementation of
// AttributesDecoderInterface that provides functionality that is shared between
// all AttributesDecoders.
class AttributesDecoder extends AttributesDecoderInterface {

  constructor() {
    super();
    // List of attribute ids that need to be decoded with this decoder.
    this._pointAttributeIds = [];
    // Map between point attribute id and the local id (inverse of _pointAttributeIds).
    this._pointAttributeToLocalIdMap = [];
    this._pointCloudDecoder = null;
    this._pointCloud = null;
  }

  // Called after all attribute decoders are created.
  init(decoder, pointCloud) {
    this._pointCloudDecoder = decoder;
    this._pointCloud = pointCloud;
    return true;
  }

  // Decodes any attribute decoder specific data from the buffer.
  decodeAttributesDecoderData(buffer) {
    // Decode and create attributes.
    let numAttributes;

    if (this._pointCloudDecoder.bitstreamVersion() <
        DRACO_BITSTREAM_VERSION(2, 0)) {
      numAttributes = buffer.decodeUint32();
      if (numAttributes === undefined) return false;
    } else {
      numAttributes = decodeVarint(buffer, false);
      if (numAttributes === undefined) return false;
    }

    // Check that decoded number of attributes is valid.
    if (numAttributes === 0) {
      return false;
    }
    if (numAttributes > 5 * buffer.remainingSize) {
      // The decoded number of attributes is unreasonably high.
      return false;
    }

    // Decode attribute descriptor data.
    this._pointAttributeIds.length = numAttributes;
    const pc = this._pointCloud;

    for (let i = 0; i < numAttributes; i++) {
      // Decode attribute descriptor data.
      const attType = buffer.decodeUint8();
      if (attType === undefined) return false;

      const dataType = buffer.decodeUint8();
      if (dataType === undefined) return false;

      const numComponents = buffer.decodeUint8();
      if (numComponents === undefined) return false;

      const normalized = buffer.decodeUint8();
      if (normalized === undefined) return false;

      if (attType >= Type.NAMED_ATTRIBUTES_COUNT) {
        return false;
      }
      if (dataType === DataType.INVALID || dataType >= DataType.TYPES_COUNT) {
        return false;
      }

      // Check decoded attribute descriptor data.
      if (numComponents === 0) {
        return false;
      }

      // Create a GeometryAttribute and init it.
      const ga = new GeometryAttribute();
      ga.init(
        attType, null, numComponents, dataType,
        normalized > 0,
        dataTypeLength(dataType) * numComponents, 0
      );

      let uniqueId;
      if (this._pointCloudDecoder.bitstreamVersion() <
          DRACO_BITSTREAM_VERSION(1, 3)) {
        uniqueId = buffer.decodeUint16();
        if (uniqueId === undefined) return false;
        ga.uniqueId = uniqueId;
      } else {
        uniqueId = decodeVarint(buffer, false);
        if (uniqueId === undefined) return false;
        ga.uniqueId = uniqueId;
      }

      // Add the attribute to the point cloud.
      const pa = new PointAttribute(ga);
      const attId = pc.addAttribute(pa);
      pc.attribute(attId).uniqueId = uniqueId;
      this._pointAttributeIds[i] = attId;

      // Update the inverse map.
      if (attId >= this._pointAttributeToLocalIdMap.length) {
        const oldLen = this._pointAttributeToLocalIdMap.length;
        this._pointAttributeToLocalIdMap.length = attId + 1;
        for (let j = oldLen; j <= attId; j++) {
          this._pointAttributeToLocalIdMap[j] = -1;
        }
      }
      this._pointAttributeToLocalIdMap[attId] = i;
    }
    return true;
  }

  getAttributeId(i) {
    return this._pointAttributeIds[i];
  }

  getNumAttributes() {
    return this._pointAttributeIds.length;
  }

  getDecoder() {
    return this._pointCloudDecoder;
  }

  // Decodes attribute data from the source buffer.
  decodeAttributes(buffer) {
    if (!this.decodePortableAttributes(buffer)) {
      return false;
    }
    if (!this.decodeDataNeededByPortableTransforms(buffer)) {
      return false;
    }
    if (!this.transformAttributesToOriginalFormat()) {
      return false;
    }
    return true;
  }

  getLocalIdForPointAttribute(pointAttributeId) {
    if (pointAttributeId >= this._pointAttributeToLocalIdMap.length) {
      return -1;
    }
    return this._pointAttributeToLocalIdMap[pointAttributeId];
  }

  // Must be overridden.
  decodePortableAttributes(buffer) {
    return false;
  }

  decodeDataNeededByPortableTransforms(buffer) {
    return true;
  }

  transformAttributesToOriginalFormat() {
    return true;
  }

  get pointCloud() {
    return this._pointCloud;
  }

}

// compression/attributes/SequentialAttributeDecoder.js - ported from compression/attributes/sequential_attribute_decoder.h/cc


// A base class for decoding attribute values encoded by the
// SequentialAttributeEncoder.
class SequentialAttributeDecoder {

  constructor() {
    this._decoder = null;
    this._attribute = null;
    this._attributeId = -1;
    // Storage for decoded portable attribute (after lossless decoding).
    this._portableAttribute = null;
  }

  init(decoder, attributeId) {
    this._decoder = decoder;
    this._attribute = decoder.pointCloud().attribute(attributeId);
    this._attributeId = attributeId;
    return true;
  }

  // Initialization for a specific attribute. This can be used mostly for
  // standalone decoding of an attribute without a PointCloudDecoder.
  initializeStandalone(attribute) {
    this._attribute = attribute;
    this._attributeId = -1;
    return true;
  }

  // Performs lossless decoding of the portable attribute data.
  decodePortableAttribute(pointIds, buffer) {
    if (this._attribute.numComponents <= 0) {
      return false;
    }
    if (!this._attribute.reset(pointIds.length)) {
      return false;
    }
    return this.decodeValues(pointIds, buffer);
  }

  // Decodes any data needed to revert portable transform of the decoded attribute.
  decodeDataNeededByPortableTransform(pointIds, buffer) {
    // Default implementation does not apply any transform.
    return true;
  }

  // Reverts transformation performed by encoder.
  transformAttributeToOriginalFormat(pointIds) {
    // Default implementation does not apply any transform.
    return true;
  }

  getPortableAttribute() {
    // If needed, copy point to attribute value index mapping from the final
    // attribute to the portable attribute. Both maps are Uint32Array (the
    // source is explicit here), so copy in one shot instead of per-entry
    // mappedIndex()/setPointMapEntry() calls.
    if (!this._attribute.isMappingIdentity && this._portableAttribute &&
        this._portableAttribute.isMappingIdentity) {
      const size = this._attribute.indicesMapSize;
      this._portableAttribute.setExplicitMapping(size);
      const src = this._attribute.indicesMap;
      const dst = this._portableAttribute.indicesMap;
      if (src.length === size) {
        dst.set(src);
      } else {
        dst.set(src.subarray(0, size));
      }
    }
    return this._portableAttribute;
  }

  get attribute() {
    return this._attribute;
  }

  get attributeId() {
    return this._attributeId;
  }

  get decoder() {
    return this._decoder;
  }

  // Should be used to initialize newly created prediction scheme.
  initPredictionScheme(ps) {
    for (let i = 0; i < ps.getNumParentAttributes(); i++) {
      const attId = this._decoder.pointCloud().getNamedAttributeId(
        ps.getParentAttributeType(i)
      );
      if (attId === -1) {
        return false; // Requested attribute does not exist.
      }
      if (this._decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 0)) {
        if (!ps.setParentAttribute(this._decoder.pointCloud().attribute(attId))) {
          return false;
        }
      } else {
        const pa = this._decoder.getPortableAttribute(attId);
        if (pa === null || !ps.setParentAttribute(pa)) {
          return false;
        }
      }
    }
    return true;
  }

  // The actual implementation of the attribute decoding.
  decodeValues(pointIds, buffer) {
    const numValues = pointIds.length;
    const entrySize = this._attribute.byteStride;
    let outBytePos = 0;
    // Decode raw attribute values in their original format.
    for (let i = 0; i < numValues; i++) {
      const valueData = buffer.decodeBytes(entrySize);
      if (valueData === undefined) {
        return false;
      }
      this._attribute.buffer.write(outBytePos, valueData, entrySize);
      outBytePos += entrySize;
    }
    return true;
  }

  setPortableAttribute(att) {
    this._portableAttribute = att;
  }

  get portableAttribute() {
    return this._portableAttribute;
  }

}

// compression/entropy/ANSCoding.js - ported from compression/entropy/ans.h
//
// An implementation of Asymmetric Numeral Systems (rANS).
// See http://arxiv.org/abs/1311.2540v2 for more information on rANS.
// Decode-only port.

// Constants
const ANS_P8_PRECISION = 256;
const ANS_L_BASE = 4096;
const ANS_IO_BASE = 256;

// --- Little-endian memory read helpers ---

function memGetLe16(buf, offset) {
  return buf[offset] | (buf[offset + 1] << 8);
}

function memGetLe24(buf, offset) {
  return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16);
}

function memGetLe32(buf, offset) {
  return (
    (buf[offset]) |
    (buf[offset + 1] << 8) |
    (buf[offset + 2] << 16) |
    ((buf[offset + 3] << 24) >>> 0) // >>> 0 to stay unsigned
  );
}

// --- AnsDecoder state object ---

class AnsDecoder {

  constructor() {
    this.buf = null; // Uint8Array
    this.bufOffset = 0;
    this.state = 0;
  }

}

// --- Core ANS read init / end ---

// Initializes the AnsDecoder from a buffer and an offset (number of encoded bytes).
// Returns 0 on success, 1 on error.
function ansReadInit(ans, buf, offset) {
  if (offset < 1) {
    return 1;
  }
  ans.buf = buf;
  const x = buf[offset - 1] >> 6;
  if (x === 0) {
    ans.bufOffset = offset - 1;
    ans.state = buf[offset - 1] & 0x3F;
  } else if (x === 1) {
    if (offset < 2) {
      return 1;
    }
    ans.bufOffset = offset - 2;
    ans.state = memGetLe16(buf, offset - 2) & 0x3FFF;
  } else if (x === 2) {
    if (offset < 3) {
      return 1;
    }
    ans.bufOffset = offset - 3;
    ans.state = memGetLe24(buf, offset - 3) & 0x3FFFFF;
  } else {
    return 1;
  }
  ans.state += ANS_L_BASE;
  if (ans.state >= ANS_L_BASE * ANS_IO_BASE) {
    return 1;
  }
  return 0;
}

function ansReadEnd(ans) {
  return ans.state === ANS_L_BASE;
}

// --- rANS decoder class (template parameter = precision bits) ---

class RAnsDecoder {

  constructor(ransPrecisionBits) {
    this.ransPrecisionBits = ransPrecisionBits;
    this.ransPrecision = 1 << ransPrecisionBits;
    this.ransPrecisionMask = this.ransPrecision - 1;
    this.lRansBase = this.ransPrecision * 4;
    this.lutTable = null; // Uint32Array
    this.probTable = null; // Uint32Array — flat array of prob values
    this.cumProbTable = null; // Uint32Array — flat array of cumProb values
    // rANS decoder state, inlined here (rather than a nested AnsDecoder object)
    // so the per-symbol ransRead() hot loop touches own properties / locals.
    this.buf = null;
    this.bufOffset = 0;
    this.state = 0;
  }

  // Initializes the decoder from the input buffer.
  // |offset| is the number of bytes encoded by the encoder.
  // Returns 0 on success, non-zero on error.
  readInit(buf, offset) {
    if (offset < 1) {
      return 1;
    }
    this.buf = buf;
    const x = buf[offset - 1] >> 6;
    if (x === 0) {
      this.bufOffset = offset - 1;
      this.state = buf[offset - 1] & 0x3F;
    } else if (x === 1) {
      if (offset < 2) {
        return 1;
      }
      this.bufOffset = offset - 2;
      this.state = memGetLe16(buf, offset - 2) & 0x3FFF;
    } else if (x === 2) {
      if (offset < 3) {
        return 1;
      }
      this.bufOffset = offset - 3;
      this.state = memGetLe24(buf, offset - 3) & 0x3FFFFF;
    } else if (x === 3) {
      this.bufOffset = offset - 4;
      this.state = memGetLe32(buf, offset - 4) & 0x3FFFFFFF;
    } else {
      return 1;
    }
    this.state += this.lRansBase;
    if (this.state >= this.lRansBase * ANS_IO_BASE) {
      return 1;
    }
    return 0;
  }

  readEnd() {
    return this.state === this.lRansBase;
  }

  readerHasError() {
    return this.state < this.lRansBase && this.bufOffset === 0;
  }

  ransRead() {
    // Cache state in locals for the renormalization loop; properties are read
    // once and written back once. ransRead runs once per decoded symbol.
    const buf = this.buf;
    const lRansBase = this.lRansBase;
    let state = this.state;
    let bufOffset = this.bufOffset;
    while (state < lRansBase && bufOffset > 0) {
      state = state * ANS_IO_BASE + buf[--bufOffset];
    }
    const quo = state >>> this.ransPrecisionBits;
    const rem = state & this.ransPrecisionMask;
    const symbol = this.lutTable[rem];
    this.state = quo * this.probTable[symbol] + rem - this.cumProbTable[symbol];
    this.bufOffset = bufOffset;
    return symbol;
  }

  // Decodes |count| symbols into out[0..count). Identical per-symbol arithmetic
  // to ransRead(), but every decoder field is hoisted into a local for the
  // whole batch and the state/offset are written back once — removing the
  // per-symbol property reads and the decodeSymbol()->ransRead() call
  // indirection that dominated raw symbol decoding.
  decodeSymbols(out, count) {
    const buf = this.buf;
    const lRansBase = this.lRansBase;
    const ransPrecisionBits = this.ransPrecisionBits;
    const ransPrecisionMask = this.ransPrecisionMask;
    const lutTable = this.lutTable;
    const probTable = this.probTable;
    const cumProbTable = this.cumProbTable;
    let state = this.state;
    let bufOffset = this.bufOffset;
    for (let i = 0; i < count; ++i) {
      while (state < lRansBase && bufOffset > 0) {
        state = state * ANS_IO_BASE + buf[--bufOffset];
      }
      const rem = state & ransPrecisionMask;
      const symbol = lutTable[rem];
      out[i] = symbol;
      state = (state >>> ransPrecisionBits) * probTable[symbol] + rem - cumProbTable[symbol];
    }
    this.state = state;
    this.bufOffset = bufOffset;
  }

  // Construct a lookup table with |ransPrecision| number of entries.
  // Returns false if the table couldn't be built (because of wrong input data).
  ransBuildLookUpTable(tokenProbs, numSymbols) {
    this.lutTable = new Uint32Array(this.ransPrecision);
    this.probTable = new Uint32Array(numSymbols);
    this.cumProbTable = new Uint32Array(numSymbols);
    let cumProb = 0;
    let actProb = 0;
    for (let i = 0; i < numSymbols; ++i) {
      this.probTable[i] = tokenProbs[i];
      this.cumProbTable[i] = cumProb;
      cumProb += tokenProbs[i];
      if (cumProb > this.ransPrecision) {
        return false;
      }
      for (let j = actProb; j < cumProb; ++j) {
        this.lutTable[j] = i;
      }
      actProb = cumProb;
    }
    if (cumProb !== this.ransPrecision) {
      return false;
    }
    return true;
  }

}

// compression/entropy/RAnsSymbolDecoder.js - ported from compression/entropy/rans_symbol_decoder.h


// Computes the desired precision of the rANS method for the specified number of
// unique symbols (defined by their bit_length). Clamped to [12, 20].
function computeRAnsPrecisionFromUniqueSymbolsBitLength(symbolsBitLength) {
  const unclamped = Math.trunc((3 * symbolsBitLength) / 2);
  if (unclamped < 12) return 12;
  if (unclamped > 20) return 20;
  return unclamped;
}

// A helper class for decoding symbols using the rANS algorithm.
// |uniqueSymbolsBitLength| must be the same as the one used for the
// corresponding RAnsSymbolEncoder.
class RAnsSymbolDecoder {

  constructor(uniqueSymbolsBitLength) {
    this.uniqueSymbolsBitLength_ = uniqueSymbolsBitLength;
    this.ransPrecisionBits_ = computeRAnsPrecisionFromUniqueSymbolsBitLength(uniqueSymbolsBitLength);
    this.ransPrecision_ = 1 << this.ransPrecisionBits_;
    this.probabilityTable_ = null;
    this.numSymbols_ = 0;
    this.ans_ = new RAnsDecoder(this.ransPrecisionBits_);
  }

  get numSymbols() {
    return this.numSymbols_;
  }

  // Initialize the decoder and decode the probability table.
  create(buffer) {
    // Check that the DecoderBuffer version is set.
    if (buffer.bitstreamVersion === 0) {
      return false;
    }

    // Decode the number of alphabet symbols.
    if (buffer.bitstreamVersion < DRACO_BITSTREAM_VERSION(2, 0)) {
      this.numSymbols_ = buffer.decodeUint32();
      if (this.numSymbols_ === undefined) return false;
    } else {
      const val = buffer.decodeVarintUint32();
      if (val === undefined) return false;
      this.numSymbols_ = val;
    }

    // Check that decoded number of symbols is not unreasonably high.
    if (Math.trunc(this.numSymbols_ / 64) > buffer.remainingSize) {
      return false;
    }

    this.probabilityTable_ = new Uint32Array(this.numSymbols_);
    if (this.numSymbols_ === 0) {
      return true;
    }

    // Decode the probability table.
    for (let i = 0; i < this.numSymbols_; ++i) {
      const probData = buffer.decodeUint8();
      if (probData === undefined) return false;

      // Token is stored in the first two bits of the first byte.
      // Values 0-2 indicate the number of extra bytes.
      // Value 3 is a special symbol for run-length coding of zero probability entries.
      const token = probData & 3;
      if (token === 3) {
        const offset = probData >> 2;
        if (i + offset >= this.numSymbols_) {
          return false;
        }
        // Set zero probability for all symbols in the specified range.
        for (let j = 0; j < offset + 1; ++j) {
          this.probabilityTable_[i + j] = 0;
        }
        i += offset;
      } else {
        const extraBytes = token;
        let prob = probData >> 2;
        for (let b = 0; b < extraBytes; ++b) {
          const eb = buffer.decodeUint8();
          if (eb === undefined) return false;
          // Shift 8 bits for each extra byte and subtract 2 for the two first bits.
          prob |= eb << (8 * (b + 1) - 2);
        }
        this.probabilityTable_[i] = prob;
      }
    }

    if (!this.ans_.ransBuildLookUpTable(this.probabilityTable_, this.numSymbols_)) {
      return false;
    }
    return true;
  }

  // Starts decoding from the buffer. The buffer will be advanced past the
  // encoded data after this call.
  startDecoding(buffer) {
    let bytesEncoded;

    if (buffer.bitstreamVersion < DRACO_BITSTREAM_VERSION(2, 0)) {
      bytesEncoded = buffer.decodeUint64();
      if (bytesEncoded === undefined) return false;
    } else {
      bytesEncoded = buffer.decodeVarintUint64();
      if (bytesEncoded === undefined) return false;
    }

    if (bytesEncoded > buffer.remainingSize) {
      return false;
    }

    const dataHead = buffer.dataHead;
    // Advance the buffer past the rANS data.
    buffer.advance(Number(bytesEncoded));
    if (this.ans_.readInit(dataHead, Number(bytesEncoded)) !== 0) {
      return false;
    }
    return true;
  }

  decodeSymbol() {
    return this.ans_.ransRead();
  }

  // Decodes |count| symbols directly into out[0..count). See
  // RAnsDecoder.decodeSymbols.
  decodeSymbols(out, count) {
    this.ans_.decodeSymbols(out, count);
  }

  endDecoding() {
    this.ans_.readEnd();
  }

}

// compression/entropy/SymbolDecoding.js - ported from compression/entropy/symbol_decoding.h/cc


// Decodes an array of symbols that was previously encoded with an entropy code.
// Returns false on error.
// |numValues| - number of values to decode
// |numComponents| - number of components (used for tagged coding)
// |srcBuffer| - DecoderBuffer to read from
// |outValues| - Uint32Array to write decoded symbols into
function decodeSymbols(numValues, numComponents, srcBuffer, outValues) {
  if (numValues === 0) {
    return true;
  }
  // Decode which scheme to use.
  const scheme = srcBuffer.decodeUint8();
  if (scheme === undefined) {
    return false;
  }
  if (scheme === SymbolCodingMethod.SYMBOL_CODING_TAGGED) {
    return decodeTaggedSymbols(numValues, numComponents, srcBuffer, outValues);
  } else if (scheme === SymbolCodingMethod.SYMBOL_CODING_RAW) {
    return decodeRawSymbols(numValues, srcBuffer, outValues);
  }
  return false;
}

function decodeTaggedSymbols(numValues, numComponents, srcBuffer, outValues) {
  // Decode the encoded data using a tag decoder with 5 precision bits.
  const tagDecoder = new RAnsSymbolDecoder(5);
  if (!tagDecoder.create(srcBuffer)) {
    return false;
  }

  if (!tagDecoder.startDecoding(srcBuffer)) {
    return false;
  }

  if (numValues > 0 && tagDecoder.numSymbols === 0) {
    return false; // Wrong number of symbols.
  }

  // srcBuffer now points behind the encoded tag data (to the place where the
  // values are encoded).
  srcBuffer.startBitDecoding(false);
  let valueId = 0;
  for (let i = 0; i < numValues; i += numComponents) {
    // Decode the tag.
    const bitLength = tagDecoder.decodeSymbol();
    // Decode the actual value.
    for (let j = 0; j < numComponents; ++j) {
      const val = srcBuffer.decodeLeastSignificantBits32(bitLength);
      if (val === undefined) {
        return false;
      }
      outValues[valueId++] = val;
    }
  }
  tagDecoder.endDecoding();
  srcBuffer.endBitDecoding();
  return true;
}

function decodeRawSymbolsInternal(uniqueSymbolsBitLength, numValues, srcBuffer, outValues) {
  const decoder = new RAnsSymbolDecoder(uniqueSymbolsBitLength);
  if (!decoder.create(srcBuffer)) {
    return false;
  }

  if (numValues > 0 && decoder.numSymbols === 0) {
    return false; // Wrong number of symbols.
  }

  if (!decoder.startDecoding(srcBuffer)) {
    return false;
  }
  decoder.decodeSymbols(outValues, numValues);
  decoder.endDecoding();
  return true;
}

function decodeRawSymbols(numValues, srcBuffer, outValues) {
  const maxBitLength = srcBuffer.decodeUint8();
  if (maxBitLength === undefined) {
    return false;
  }
  if (maxBitLength < 1 || maxBitLength > 18) {
    return false;
  }
  return decodeRawSymbolsInternal(maxBitLength, numValues, srcBuffer, outValues);
}

// src/compression/attributes/prediction_schemes/PredictionSchemeDecoderInterface.js
// Ported from draco/compression/attributes/prediction_schemes/prediction_scheme_decoder_interface.h


/**
 * Abstract interface for all prediction schemes used during attribute decoding.
 * Subclasses should implement all methods.
 */
class PredictionSchemeDecoderInterface {

  /**
   * Returns the prediction method used by this scheme.
   * @returns {number} One of PredictionSchemeMethod values.
   */
  getPredictionMethod() {
    return PredictionSchemeMethod.PREDICTION_NONE;
  }

  /**
   * Returns true when the prediction scheme is fully initialized.
   * @returns {boolean}
   */
  isInitialized() {
    return false;
  }

  /**
   * Returns true if all correction values are guaranteed to be positive.
   * @returns {boolean}
   */
  areCorrectionsPositive() {
    return false;
  }

  /**
   * Returns the number of parent attributes needed for the prediction.
   * @returns {number}
   */
  getNumParentAttributes() {
    return 0;
  }

  /**
   * Returns the type of the parent attribute at index i.
   * @param {number} i
   * @returns {number}
   */
  getParentAttributeType(i) {
    return -1; // INVALID
  }

  /**
   * Sets the required parent attribute.
   * @param {object} att - PointAttribute
   * @returns {boolean}
   */
  setParentAttribute(att) {
    return false;
  }

  /**
   * Returns the transform type used by the prediction scheme.
   * @returns {number}
   */
  getTransformType() {
    return -1;
  }

  /**
   * Returns the encoded/decoded attribute.
   * @returns {object|null}
   */
  getAttribute() {
    return null;
  }

  /**
   * Decodes prediction scheme-specific data from the input buffer.
   * @param {DecoderBuffer} buffer
   * @returns {boolean}
   */
  decodePredictionData(buffer) {
    return true;
  }

  /**
   * Reverts changes made by the prediction scheme during encoding.
   * @param {Int32Array|TypedArray} inCorr - correction values
   * @param {Int32Array|TypedArray} outData - output original values
   * @param {number} size - total number of values
   * @param {number} numComponents - components per entry
   * @param {Array|null} entryToPointIdMap
   * @returns {boolean}
   */
  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    return false;
  }

}

// src/compression/attributes/prediction_schemes/PredictionSchemeDecoder.js
// Ported from draco/compression/attributes/prediction_schemes/prediction_scheme_decoder.h


/**
 * Base class for typed prediction scheme decoders. Provides basic access
 * to the encoded attribute and the supplied prediction transform.
 *
 * In C++ this is a template: PredictionSchemeDecoder<DataTypeT, TransformT>.
 * In JS, the transform is passed as a constructor parameter.
 */
class PredictionSchemeDecoder extends PredictionSchemeDecoderInterface {

  /**
   * @param {object} attribute - PointAttribute
   * @param {object} transform - A decoding transform instance
   */
  constructor(attribute, transform) {
    super();
    this._attribute = attribute;
    this._transform = transform;
  }

  /**
   * Decodes prediction data by delegating to the transform.
   * @param {DecoderBuffer} buffer
   * @returns {boolean}
   */
  decodePredictionData(buffer) {
    if (!this._transform.decodeTransformData(buffer)) {
      return false;
    }
    return true;
  }

  /** @returns {object} */
  getAttribute() {
    return this._attribute;
  }

  /** @returns {number} */
  getNumParentAttributes() {
    return 0;
  }

  /**
   * @param {number} i
   * @returns {number}
   */
  getParentAttributeType(i) {
    return -1; // INVALID
  }

  /**
   * @param {object} att
   * @returns {boolean}
   */
  setParentAttribute(att) {
    return false;
  }

  /** @returns {boolean} */
  areCorrectionsPositive() {
    return this._transform.areCorrectionsPositive();
  }

  /** @returns {number} */
  getTransformType() {
    return this._transform.getType();
  }

  /** @returns {object} */
  get attribute() {
    return this._attribute;
  }

  /** @returns {object} */
  get transform() {
    return this._transform;
  }

}

// src/compression/attributes/prediction_schemes/PredictionSchemeDeltaDecoder.js
// Ported from draco/compression/attributes/prediction_schemes/prediction_scheme_delta_decoder.h


/**
 * Decoder for values encoded with delta coding.
 * Delta prediction: value[i] = value[i-1] + correction[i].
 */
class PredictionSchemeDeltaDecoder extends PredictionSchemeDecoder {

  /**
   * @param {object} attribute - PointAttribute
   * @param {object} transform - A decoding transform instance
   */
  constructor(attribute, transform) {
    super(attribute, transform);
  }

  /**
   * @returns {number}
   */
  getPredictionMethod() {
    return PredictionSchemeMethod.PREDICTION_DIFFERENCE;
  }

  /**
   * @returns {boolean}
   */
  isInitialized() {
    return true;
  }

  /**
   * Computes original values from corrections using delta prediction.
   * @param {Int32Array|TypedArray} inCorr - correction values
   * @param {Int32Array|TypedArray} outData - output buffer for original values
   * @param {number} size - total number of values
   * @param {number} numComponents - components per entry
   * @param {Array|null} entryToPointIdMap
   * @returns {boolean}
   */
  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    this._transform.init(numComponents);

    // Decode the original value for the first element.
    // The "predicted" value for the first element is all zeros.
    const zeroVals = new Int32Array(numComponents);
    this._transform.computeOriginalValue(
      zeroVals, 0,
      inCorr, 0,
      outData, 0
    );

    // Decode data from the front: D(i) = D(i-1) + correction(i).
    for (let i = numComponents; i < size; i += numComponents) {
      this._transform.computeOriginalValue(
        outData, i - numComponents,
        inCorr, i,
        outData, i
      );
    }

    return true;
  }

}

// src/compression/attributes/prediction_schemes/MeshPredictionSchemeDecoder.js
// Ported from draco/compression/attributes/prediction_schemes/mesh_prediction_scheme_decoder.h


/**
 * Base class for all mesh prediction scheme decoders that use mesh
 * connectivity data. Extends PredictionSchemeDecoder with mesh data access.
 *
 * In C++ this is templated on MeshDataT. In JS, meshData is a constructor param.
 */
class MeshPredictionSchemeDecoder extends PredictionSchemeDecoder {

  /**
   * @param {object} attribute - PointAttribute
   * @param {object} transform - A decoding transform instance
   * @param {object} meshData - MeshPredictionSchemeData instance
   */
  constructor(attribute, transform, meshData) {
    super(attribute, transform);
    this._meshData = meshData;
  }

  /**
   * Returns the mesh data used by this prediction scheme.
   * @returns {object}
   */
  get meshData() {
    return this._meshData;
  }

}

// src/compression/attributes/prediction_schemes/MeshPredictionSchemeParallelogramShared.js
// Ported from draco/compression/attributes/prediction_schemes/mesh_prediction_scheme_parallelogram_shared.h

/**
 * Computes parallelogram prediction for a given corner and data entry id.
 * The prediction is: P = next + prev - opp.
 *
 * Operates directly on the corner table's flat Int32Array connectivity
 * (oppositeCornerArray / cornerToVertexArray) rather than calling the table's
 * accessor methods. The table can be either the base CornerTable or a
 * MeshAttributeCornerTable, so method calls here would be polymorphic and not
 * inlined; the flat arrays are always Int32Arrays and keep this hot path
 * monomorphic. next()/previous() are inlined as corner-triple arithmetic.
 *
 * @param {number} dataEntryId - the current entry being decoded
 * @param {number} ci - corner index
 * @param {Int32Array} oppositeCorners - seam-aware opposite corner per corner
 * @param {Int32Array} cornerToVertex - vertex (data) index per corner
 * @param {Int32Array|Array} vertexToDataMap
 * @param {Int32Array|TypedArray} inData - already decoded data
 * @param {number} numComponents - components per entry
 * @param {Int32Array} outPrediction - buffer to store predicted values
 * @returns {boolean} true if prediction was computed, false otherwise
 */
function computeParallelogramPrediction(dataEntryId, ci, oppositeCorners,
  cornerToVertex, vertexToDataMap, inData, numComponents, outPrediction) {
  const oci = oppositeCorners[ci];
  if (oci < 0) {
    return false;
  }

  // Inlined next(oci)/previous(oci) (corners are grouped in triples).
  const rem = oci - ((oci / 3) | 0) * 3;
  const nextOci = rem === 2 ? oci - 2 : oci + 1;
  const prevOci = rem === 0 ? oci + 2 : oci - 1;

  const vertOpp = vertexToDataMap[cornerToVertex[oci]];
  const vertNext = vertexToDataMap[cornerToVertex[nextOci]];
  const vertPrev = vertexToDataMap[cornerToVertex[prevOci]];

  if (vertOpp < dataEntryId && vertNext < dataEntryId && vertPrev < dataEntryId) {
    const vOppOff = vertOpp * numComponents;
    const vNextOff = vertNext * numComponents;
    const vPrevOff = vertPrev * numComponents;
    for (let c = 0; c < numComponents; ++c) {
      outPrediction[c] =
        (inData[vNextOff + c] + inData[vPrevOff + c]) - inData[vOppOff + c];
    }
    return true;
  }
  return false;
}

// src/compression/attributes/prediction_schemes/MeshPredictionSchemeParallelogramDecoder.js
// Ported from draco/compression/attributes/prediction_schemes/mesh_prediction_scheme_parallelogram_decoder.h


/**
 * Decoder for attribute values encoded with the standard parallelogram
 * prediction. Uses the parallelogram formed by three vertices of a triangle
 * opposite to the current corner to predict the attribute value.
 */
class MeshPredictionSchemeParallelogramDecoder extends MeshPredictionSchemeDecoder {

  /**
   * @param {object} attribute - PointAttribute
   * @param {object} transform - A decoding transform instance
   * @param {object} meshData - MeshPredictionSchemeData instance
   */
  constructor(attribute, transform, meshData) {
    super(attribute, transform, meshData);
  }

  /** @returns {number} */
  getPredictionMethod() {
    return PredictionSchemeMethod.MESH_PREDICTION_PARALLELOGRAM;
  }

  /** @returns {boolean} */
  isInitialized() {
    return this._meshData.isInitialized();
  }

  /**
   * Computes original values using parallelogram prediction.
   * @param {Int32Array} inCorr
   * @param {Int32Array} outData
   * @param {number} size
   * @param {number} numComponents
   * @param {Array|null} entryToPointIdMap
   * @returns {boolean}
   */
  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    this._transform.init(numComponents);

    const table = this._meshData.cornerTable;
    const vertexToDataMap = this._meshData.vertexToDataMap;
    // Flat connectivity arrays (Int32Array) — see computeParallelogramPrediction.
    const oppositeCorners = table.oppositeCornerArray();
    const cornerToVertex = table.cornerToVertexArray();
    const dataToCornerMap = this._meshData.dataToCornerMap;

    // Storage for prediction values (initialized to zero).
    const predVals = new Int32Array(numComponents);

    // Restore the first value.
    this._transform.computeOriginalValue(
      predVals, 0, inCorr, 0, outData, 0
    );

    const cornerMapSize = dataToCornerMap.length;
    for (let p = 1; p < cornerMapSize; ++p) {
      const cornerId = dataToCornerMap[p];
      const dstOffset = p * numComponents;

      const result = computeParallelogramPrediction(
        p, cornerId, oppositeCorners, cornerToVertex, vertexToDataMap,
        outData, numComponents, predVals
      );

      if (!result) {
        // Parallelogram could not be computed. Use delta coding (previous value).
        const srcOffset = (p - 1) * numComponents;
        this._transform.computeOriginalValue(
          outData, srcOffset, inCorr, dstOffset, outData, dstOffset
        );
      } else {
        // Apply the parallelogram prediction.
        this._transform.computeOriginalValue(
          predVals, 0, inCorr, dstOffset, outData, dstOffset
        );
      }
    }
    return true;
  }

}

// mesh/ValenceCache.js - ported from mesh/valence_cache.h

// Sentinel value for invalid indices (matches uint32 max).
const kInvalidVertexIndex$2 = -1;
const kInvalidCornerIndex$5 = -1;

class ValenceCache {

  constructor(table) {

    this.table_ = table;
    this.vertex_valence_cache_8_bit_ = null;
    this.vertex_valence_cache_32_bit_ = null;

  }

  valenceFromCacheInaccurate(c) {

    if (c === kInvalidCornerIndex$5) {
      return -1;
    }

    return this.valenceFromCacheInaccurateVertex(this.table_.vertex(c));

  }

  valenceFromCache(c) {

    if (c === kInvalidCornerIndex$5) {
      return -1;
    }

    return this.valenceFromCacheVertex(this.table_.vertex(c));

  }

  confidentValenceFromCacheVertex(v) {

    return this.vertex_valence_cache_32_bit_[v];

  }

  // Cache all vertex valences (8-bit, clamped to 127).
  cacheValencesInaccurate() {

    if (this.vertex_valence_cache_8_bit_ === null) {

      const vertexCount = this.table_.numVertices();
      this.vertex_valence_cache_8_bit_ = new Int8Array(vertexCount);

      for (let v = 0; v < vertexCount; ++v) {

        this.vertex_valence_cache_8_bit_[v] = Math.min(127, this.table_.valence(v));

      }

    }

  }

  // Cache all vertex valences (32-bit, accurate).
  cacheValences() {

    if (this.vertex_valence_cache_32_bit_ === null) {

      const vertexCount = this.table_.numVertices();
      this.vertex_valence_cache_32_bit_ = new Int32Array(vertexCount);

      for (let v = 0; v < vertexCount; ++v) {

        this.vertex_valence_cache_32_bit_[v] = this.table_.valence(v);

      }

    }

  }

  confidentValenceFromCacheInaccurateCorner(c) {

    return this.confidentValenceFromCacheInaccurateVertex(this.table_.confidentVertex(c));

  }

  confidentValenceFromCacheCorner(c) {

    return this.confidentValenceFromCacheVertex(this.table_.confidentVertex(c));

  }

  valenceFromCacheInaccurateVertex(v) {

    if (v === kInvalidVertexIndex$2 || v >= this.table_.numVertices()) {
      return -1;
    }

    return this.confidentValenceFromCacheInaccurateVertex(v);

  }

  confidentValenceFromCacheInaccurateVertex(v) {

    return this.vertex_valence_cache_8_bit_[v];

  }

  valenceFromCacheVertex(v) {

    if (v === kInvalidVertexIndex$2 || v >= this.table_.numVertices()) {
      return -1;
    }

    return this.confidentValenceFromCacheVertex(v);

  }

  clearValenceCacheInaccurate() {

    this.vertex_valence_cache_8_bit_ = null;

  }

  clearValenceCache() {

    this.vertex_valence_cache_32_bit_ = null;

  }

  isCacheEmpty() {

    return this.vertex_valence_cache_8_bit_ === null &&
           this.vertex_valence_cache_32_bit_ === null;

  }

}

// mesh/CornerTableIterators.js - ported from mesh/corner_table_iterators.h

const kInvalidCornerIndex$4 = -1;

// Iterates over vertices in the 1-ring around a specified vertex.
class VertexRingIterator {

  constructor(table, vertId) {

    if (table === undefined) {

      this.corner_table_ = null;
      this.start_corner_ = kInvalidCornerIndex$4;
      this.corner_ = kInvalidCornerIndex$4;
      this.left_traversal_ = true;

    } else {

      this.corner_table_ = table;
      this.start_corner_ = table.leftMostCorner(vertId);
      this.corner_ = this.start_corner_;
      this.left_traversal_ = true;

    }

  }

  // Gets the last visited ring vertex.
  vertex() {

    const ringCorner = this.left_traversal_
      ? this.corner_table_.previous(this.corner_)
      : this.corner_table_.next(this.corner_);
    return this.corner_table_.vertex(ringCorner);

  }

  // Returns a corner opposite to the edge connecting the current ring vertex
  // with the central vertex.
  edgeCorner() {

    return this.left_traversal_
      ? this.corner_table_.next(this.corner_)
      : this.corner_table_.previous(this.corner_);

  }

  // Returns true when all ring vertices have been visited.
  end() {

    return this.corner_ === kInvalidCornerIndex$4;

  }

  // Proceeds to the next ring vertex.
  next() {

    if (this.left_traversal_) {

      this.corner_ = this.corner_table_.swingLeft(this.corner_);
      if (this.corner_ === kInvalidCornerIndex$4) {

        // Open boundary reached.
        this.corner_ = this.start_corner_;
        this.left_traversal_ = false;

      } else if (this.corner_ === this.start_corner_) {

        // End reached (full circle).
        this.corner_ = kInvalidCornerIndex$4;

      }

    } else {

      // Go to the right until we reach a boundary.
      this.corner_ = this.corner_table_.swingRight(this.corner_);

    }

  }

}

// mesh/CornerTable.js - ported from mesh/corner_table.h/cc


const kInvalidCornerIndex$3 = -1;

// src/compression/attributes/prediction_schemes/MeshPredictionSchemeMultiParallelogramDecoder.js
// Ported from draco/compression/attributes/prediction_schemes/mesh_prediction_scheme_multi_parallelogram_decoder.h


/**
 * Decoder for predictions encoded by multi-parallelogram encoding scheme.
 * Multiple parallelogram predictions around a vertex are averaged to
 * produce the final prediction.
 */
class MeshPredictionSchemeMultiParallelogramDecoder extends MeshPredictionSchemeDecoder {

  /**
   * @param {object} attribute - PointAttribute
   * @param {object} transform - A decoding transform instance
   * @param {object} meshData - MeshPredictionSchemeData instance
   */
  constructor(attribute, transform, meshData) {
    super(attribute, transform, meshData);
  }

  /** @returns {number} */
  getPredictionMethod() {
    return PredictionSchemeMethod.MESH_PREDICTION_MULTI_PARALLELOGRAM;
  }

  /** @returns {boolean} */
  isInitialized() {
    return this._meshData.isInitialized();
  }

  /**
   * @param {Int32Array} inCorr
   * @param {Int32Array} outData
   * @param {number} size
   * @param {number} numComponents
   * @param {Array|null} entryToPointIdMap
   * @returns {boolean}
   */
  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    this._transform.init(numComponents);

    const predVals = new Int32Array(numComponents);
    const parallelogramPredVals = new Int32Array(numComponents);

    // First value: predicted = 0.
    this._transform.computeOriginalValue(
      predVals, 0, inCorr, 0, outData, 0
    );

    const table = this._meshData.cornerTable;
    const vertexToDataMap = this._meshData.vertexToDataMap;
    const oppositeCorners = table.oppositeCornerArray();
    const cornerToVertex = table.cornerToVertexArray();
    const cornerMapSize = this._meshData.dataToCornerMap.length;

    for (let p = 1; p < cornerMapSize; ++p) {
      const startCornerId = this._meshData.dataToCornerMap[p];
      let cornerId = startCornerId;
      let numParallelograms = 0;

      for (let i = 0; i < numComponents; ++i) {
        predVals[i] = 0;
      }

      while (cornerId !== kInvalidCornerIndex$3) {
        if (computeParallelogramPrediction(
          p, cornerId, oppositeCorners, cornerToVertex, vertexToDataMap,
          outData, numComponents, parallelogramPredVals)) {
          for (let c = 0; c < numComponents; ++c) {
            predVals[c] = (predVals[c] + parallelogramPredVals[c]) | 0;
          }
          ++numParallelograms;
        }

        cornerId = table.swingRight(cornerId);
        if (cornerId === startCornerId) {
          cornerId = kInvalidCornerIndex$3;
        }
      }

      const dstOffset = p * numComponents;
      if (numParallelograms === 0) {
        // No valid parallelogram. Use delta from previous point.
        const srcOffset = (p - 1) * numComponents;
        this._transform.computeOriginalValue(
          outData, srcOffset, inCorr, dstOffset, outData, dstOffset
        );
      } else {
        // Average the parallelogram predictions.
        for (let c = 0; c < numComponents; ++c) {
          predVals[c] = (predVals[c] / numParallelograms) | 0;
        }
        this._transform.computeOriginalValue(
          predVals, 0, inCorr, dstOffset, outData, dstOffset
        );
      }
    }
    return true;
  }

}

// compression/bit_coders/RAnsBitDecoder.js - ported from compression/bit_coders/rans_bit_decoder.h/cc


// Class for decoding a sequence of bits that were encoded with RAnsBitEncoder.
class RAnsBitDecoder {

  constructor() {
    this.ansDecoder_ = new AnsDecoder();
    this.probZero_ = 0;
    this.p_ = 0; // ANS_P8_PRECISION - probZero, precomputed
  }

  // Sets |sourceBuffer| as the buffer to decode bits from.
  // Returns false when the data is invalid.
  startDecoding(sourceBuffer) {
    this.clear();

    const probZero = sourceBuffer.decodeUint8();
    if (probZero === undefined) {
      return false;
    }
    this.probZero_ = probZero;
    this.p_ = ANS_P8_PRECISION - probZero;

    let sizeInBytes;
    if (sourceBuffer.bitstreamVersion < DRACO_BITSTREAM_VERSION(2, 2)) {
      sizeInBytes = sourceBuffer.decodeUint32();
      if (sizeInBytes === undefined) return false;
    } else {
      sizeInBytes = sourceBuffer.decodeVarintUint32();
      if (sizeInBytes === undefined) return false;
    }

    if (sizeInBytes > sourceBuffer.remainingSize) {
      return false;
    }

    const dataHead = sourceBuffer.dataHead;
    if (ansReadInit(this.ansDecoder_, dataHead, sizeInBytes) !== 0) {
      return false;
    }
    sourceBuffer.advance(sizeInBytes);
    return true;
  }

  // Decode one bit. Returns true if the bit is a 1, otherwise false.
  decodeNextBit() {
    const ans = this.ansDecoder_;
    const p = this.p_;
    if (ans.state < ANS_L_BASE && ans.bufOffset > 0) {
      ans.state = ans.state * ANS_IO_BASE + ans.buf[--ans.bufOffset];
    }
    const x = ans.state;
    const quot = x >>> 8;
    const rem = x & 0xFF;
    const xn = quot * p;
    if (rem < p) {
      ans.state = xn + rem;
      return true;
    }
    ans.state = x - xn - p;
    return false;
  }

  // Decode the next |nbits| and return the sequence in a uint32. |nbits| must be
  // > 0 and <= 32.
  decodeLeastSignificantBits32(nbits) {
    const ans = this.ansDecoder_;
    const p = this.p_;
    let result = 0;
    for (let i = 0; i < nbits; i++) {
      if (ans.state < ANS_L_BASE && ans.bufOffset > 0) {
        ans.state = ans.state * ANS_IO_BASE + ans.buf[--ans.bufOffset];
      }
      const x = ans.state;
      const quot = x >>> 8;
      const rem = x & 0xFF;
      const xn = quot * p;
      if (rem < p) {
        ans.state = xn + rem;
        result = (result << 1) + 1;
      } else {
        ans.state = x - xn - p;
        result = result << 1;
      }
    }
    return result;
  }

  endDecoding() {}

  clear() {
    ansReadEnd(this.ansDecoder_);
  }

}

// src/compression/attributes/prediction_schemes/MeshPredictionSchemeConstrainedMultiParallelogramDecoder.js
// Ported from draco/compression/attributes/prediction_schemes/mesh_prediction_scheme_constrained_multi_parallelogram_decoder.h


const OPTIMAL_MULTI_PARALLELOGRAM = 0;
const MAX_NUM_PARALLELOGRAMS = 4;

/**
 * Decoder for predictions encoded with the constrained multi-parallelogram
 * encoder. Uses crease edge flags to determine which parallelograms to use.
 */
class MeshPredictionSchemeConstrainedMultiParallelogramDecoder extends MeshPredictionSchemeDecoder {

  /**
   * @param {object} attribute - PointAttribute
   * @param {object} transform - A decoding transform instance
   * @param {object} meshData - MeshPredictionSchemeData instance
   */
  constructor(attribute, transform, meshData) {
    super(attribute, transform, meshData);
    this._selectedMode = OPTIMAL_MULTI_PARALLELOGRAM;
    // Crease edges stored per context (number of available parallelograms).
    this._isCreaseEdge = [];
    for (let i = 0; i < MAX_NUM_PARALLELOGRAMS; ++i) {
      this._isCreaseEdge.push([]);
    }
  }

  /** @returns {number} */
  getPredictionMethod() {
    return PredictionSchemeMethod.MESH_PREDICTION_CONSTRAINED_MULTI_PARALLELOGRAM;
  }

  /** @returns {boolean} */
  isInitialized() {
    return this._meshData.isInitialized();
  }

  /**
   * Decodes prediction data including crease edge flags.
   * @param {DecoderBuffer} buffer
   * @returns {boolean}
   */
  decodePredictionData(buffer) {
    if (buffer.bitstreamVersion < 0x0202) {
      // Decode prediction mode.
      const mode = buffer.decodeUint8();
      if (mode === undefined) return false;
      if (mode !== OPTIMAL_MULTI_PARALLELOGRAM) return false;
    }

    // Decode crease edge flags using rANS bit coder for each context.
    for (let i = 0; i < MAX_NUM_PARALLELOGRAMS; ++i) {
      const numFlags = buffer.decodeVarintUint32();
      if (numFlags === undefined) return false;
      if (numFlags > this._meshData.cornerTable.numCorners()) return false;
      if (numFlags > 0) {
        this._isCreaseEdge[i] = new Array(numFlags);
        const decoder = new RAnsBitDecoder();
        if (!decoder.startDecoding(buffer)) return false;
        for (let j = 0; j < numFlags; ++j) {
          this._isCreaseEdge[i][j] = decoder.decodeNextBit();
        }
        decoder.endDecoding();
      }
    }
    // Call base class to decode transform data.
    return super.decodePredictionData(buffer);
  }

  /**
   * @param {Int32Array} inCorr
   * @param {Int32Array} outData
   * @param {number} size
   * @param {number} numComponents
   * @param {Array|null} entryToPointIdMap
   * @returns {boolean}
   */
  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    this._transform.init(numComponents);

    // Predicted values for all simple parallelograms.
    const predVals = [];
    for (let i = 0; i < MAX_NUM_PARALLELOGRAMS; ++i) {
      predVals.push(new Int32Array(numComponents));
    }

    // First value.
    this._transform.computeOriginalValue(
      predVals[0], 0, inCorr, 0, outData, 0
    );

    const table = this._meshData.cornerTable;
    const vertexToDataMap = this._meshData.vertexToDataMap;
    const oppositeCorners = table.oppositeCornerArray();
    const cornerToVertex = table.cornerToVertexArray();

    // Position in each isCreaseEdge context.
    const isCreaseEdgePos = new Int32Array(MAX_NUM_PARALLELOGRAMS);

    // Multi-prediction accumulator.
    const multiPredVals = new Int32Array(numComponents);

    const cornerMapSize = this._meshData.dataToCornerMap.length;
    for (let p = 1; p < cornerMapSize; ++p) {
      const startCornerId = this._meshData.dataToCornerMap[p];
      let cornerId = startCornerId;
      let numParallelograms = 0;
      let firstPass = true;

      while (cornerId !== kInvalidCornerIndex$3) {
        if (computeParallelogramPrediction(
          p, cornerId, oppositeCorners, cornerToVertex, vertexToDataMap,
          outData, numComponents, predVals[numParallelograms])) {
          ++numParallelograms;
          if (numParallelograms === MAX_NUM_PARALLELOGRAMS) break;
        }

        // First swing left, then swing right from start if boundary hit.
        if (firstPass) {
          cornerId = table.swingLeft(cornerId);
        } else {
          cornerId = table.swingRight(cornerId);
        }
        if (cornerId === startCornerId) break;
        if (cornerId === kInvalidCornerIndex$3 && firstPass) {
          firstPass = false;
          cornerId = table.swingRight(startCornerId);
        }
      }

      // Check which parallelograms are used via crease edge flags.
      let numUsedParallelograms = 0;
      if (numParallelograms > 0) {
        for (let i = 0; i < numComponents; ++i) {
          multiPredVals[i] = 0;
        }
        for (let i = 0; i < numParallelograms; ++i) {
          const context = numParallelograms - 1;
          const pos = isCreaseEdgePos[context]++;
          if (this._isCreaseEdge[context].length <= pos) return false;
          const isCrease = this._isCreaseEdge[context][pos];
          if (!isCrease) {
            ++numUsedParallelograms;
            for (let j = 0; j < numComponents; ++j) {
              multiPredVals[j] = (multiPredVals[j] + predVals[i][j]) | 0;
            }
          }
        }
      }

      const dstOffset = p * numComponents;
      if (numUsedParallelograms === 0) {
        const srcOffset = (p - 1) * numComponents;
        this._transform.computeOriginalValue(
          outData, srcOffset, inCorr, dstOffset, outData, dstOffset
        );
      } else {
        for (let c = 0; c < numComponents; ++c) {
          multiPredVals[c] = (multiPredVals[c] / numUsedParallelograms) | 0;
        }
        this._transform.computeOriginalValue(
          multiPredVals, 0, inCorr, dstOffset, outData, dstOffset
        );
      }
    }
    return true;
  }

}

// src/compression/attributes/prediction_schemes/MeshPredictionSchemeTexCoordsDecoder.js
// Ported from draco/compression/attributes/prediction_schemes/mesh_prediction_scheme_tex_coords_decoder.h


const GEOMETRY_ATTRIBUTE_POSITION$2 = 0;

/**
 * Decoder for predictions of UV coordinates using mesh geometry.
 * This predictor is not portable and is used for backwards compatibility only.
 * See MeshPredictionSchemeTexCoordsPortableDecoder for the portable version.
 */
class MeshPredictionSchemeTexCoordsDecoder extends MeshPredictionSchemeDecoder {

  /**
   * @param {object} attribute - PointAttribute
   * @param {object} transform - A decoding transform instance
   * @param {object} meshData - MeshPredictionSchemeData instance
   * @param {number} version - bitstream version
   */
  constructor(attribute, transform, meshData, version) {
    super(attribute, transform, meshData);
    this._posAttribute = null;
    this._entryToPointIdMap = null;
    this._predictedValue = null;
    this._numComponents = 0;
    this._orientations = [];
    this._version = version;
  }

  /** @returns {number} */
  getPredictionMethod() {
    return PredictionSchemeMethod.MESH_PREDICTION_TEX_COORDS_DEPRECATED;
  }

  /** @returns {boolean} */
  isInitialized() {
    if (this._posAttribute === null) return false;
    if (!this._meshData.isInitialized()) return false;
    return true;
  }

  /** @returns {number} */
  getNumParentAttributes() {
    return 1;
  }

  /**
   * @param {number} i
   * @returns {number}
   */
  getParentAttributeType(i) {
    return GEOMETRY_ATTRIBUTE_POSITION$2;
  }

  /**
   * @param {object} att - PointAttribute
   * @returns {boolean}
   */
  setParentAttribute(att) {
    if (att === null) return false;
    if (att.attributeType !== GEOMETRY_ATTRIBUTE_POSITION$2) return false;
    if (att.numComponents !== 3) return false;
    this._posAttribute = att;
    return true;
  }

  /**
   * Decodes prediction data including orientation flags.
   * @param {DecoderBuffer} buffer
   * @returns {boolean}
   */
  decodePredictionData(buffer) {
    let numOrientations = 0;
    if (buffer.bitstreamVersion < 0x0202) {
      numOrientations = buffer.decodeUint32();
      if (numOrientations === undefined) return false;
    } else {
      numOrientations = buffer.decodeVarintUint32();
      if (numOrientations === undefined) return false;
    }
    if (numOrientations === 0) return false;
    if (numOrientations > this._meshData.cornerTable.numCorners()) return false;

    this._orientations = new Array(numOrientations);
    let lastOrientation = true;
    const decoder = new RAnsBitDecoder();
    if (!decoder.startDecoding(buffer)) return false;
    for (let i = 0; i < numOrientations; ++i) {
      if (!decoder.decodeNextBit()) {
        lastOrientation = !lastOrientation;
      }
      this._orientations[i] = lastOrientation;
    }
    decoder.endDecoding();
    return super.decodePredictionData(buffer);
  }

  /**
   * @param {Int32Array} inCorr
   * @param {Int32Array} outData
   * @param {number} size
   * @param {number} numComponents
   * @param {Array} entryToPointIdMap
   * @returns {boolean}
   */
  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    if (numComponents !== 2) return false;
    this._numComponents = numComponents;
    this._entryToPointIdMap = entryToPointIdMap;
    this._predictedValue = new Int32Array(numComponents);
    this._transform.init(numComponents);

    const cornerMapSize = this._meshData.dataToCornerMap.length;
    for (let p = 0; p < cornerMapSize; ++p) {
      const cornerId = this._meshData.dataToCornerMap[p];
      if (!this._computePredictedValue(cornerId, outData, p)) return false;

      const dstOffset = p * numComponents;
      this._transform.computeOriginalValue(
        this._predictedValue, 0, inCorr, dstOffset, outData, dstOffset
      );
    }
    return true;
  }

  /**
   * @private
   */
  _getPositionForEntryId(entryId) {
    const pointId = this._entryToPointIdMap[entryId];
    const pos = new Float32Array(3);
    this._posAttribute.convertValue(
      this._posAttribute.mappedIndex(pointId), pos
    );
    return pos;
  }

  /**
   * @private
   */
  _getTexCoordForEntryId(entryId, data) {
    const dataOffset = entryId * this._numComponents;
    return [data[dataOffset], data[dataOffset + 1]];
  }

  /**
   * @private
   */
  _computePredictedValue(cornerId, data, dataId) {
    const table = this._meshData.cornerTable;
    const nextCornerId = table.next(cornerId);
    const prevCornerId = table.previous(cornerId);

    const nextVertId = table.vertex(nextCornerId);
    const prevVertId = table.vertex(prevCornerId);

    const nextDataId = this._meshData.vertexToDataMap[nextVertId];
    const prevDataId = this._meshData.vertexToDataMap[prevVertId];

    if (prevDataId < dataId && nextDataId < dataId) {
      const nUV = this._getTexCoordForEntryId(nextDataId, data);
      const pUV = this._getTexCoordForEntryId(prevDataId, data);

      if (pUV[0] === nUV[0] && pUV[1] === nUV[1]) {
        // Degenerated UV triangle.
        for (let i = 0; i < 2; ++i) {
          const v = pUV[i];
          if (isNaN(v) || v > 0x7FFFFFFF || v < -2147483648) {
            this._predictedValue[i] = -2147483648;
          } else {
            this._predictedValue[i] = v | 0;
          }
        }
        return true;
      }

      const tipPos = this._getPositionForEntryId(dataId);
      const nextPos = this._getPositionForEntryId(nextDataId);
      const prevPos = this._getPositionForEntryId(prevDataId);

      // Compute vectors pn = prev - next, cn = tip - next.
      const pn = [
        prevPos[0] - nextPos[0],
        prevPos[1] - nextPos[1],
        prevPos[2] - nextPos[2]
      ];
      const cn = [
        tipPos[0] - nextPos[0],
        tipPos[1] - nextPos[1],
        tipPos[2] - nextPos[2]
      ];

      const pnNorm2Squared = pn[0] * pn[0] + pn[1] * pn[1] + pn[2] * pn[2];

      let s, t;
      if (this._version < 0x0102 || pnNorm2Squared > 0) {
        s = (pn[0] * cn[0] + pn[1] * cn[1] + pn[2] * cn[2]) / pnNorm2Squared;
        // t = |cn - pn * s| / |pn|
        const diff = [cn[0] - pn[0] * s, cn[1] - pn[1] * s, cn[2] - pn[2] * s];
        const diffNorm2 = diff[0] * diff[0] + diff[1] * diff[1] + diff[2] * diff[2];
        t = Math.sqrt(diffNorm2 / pnNorm2Squared);
      } else {
        s = 0;
        t = 0;
      }

      const pnUV = [pUV[0] - nUV[0], pUV[1] - nUV[1]];
      const pnus = pnUV[0] * s + nUV[0];
      const pnut = pnUV[0] * t;
      const pnvs = pnUV[1] * s + nUV[1];
      const pnvt = pnUV[1] * t;

      if (this._orientations.length === 0) return false;

      const orientation = this._orientations[this._orientations.length - 1];
      this._orientations.length--;

      let predictedU, predictedV;
      if (orientation) {
        predictedU = pnus - pnvt;
        predictedV = pnvs + pnut;
      } else {
        predictedU = pnus + pnvt;
        predictedV = pnvs - pnut;
      }

      // Round the predicted value for integer types.
      const u = Math.floor(predictedU + 0.5);
      if (isNaN(u) || u > 0x7FFFFFFF || u < -2147483648) {
        this._predictedValue[0] = -2147483648;
      } else {
        this._predictedValue[0] = u | 0;
      }
      const v = Math.floor(predictedV + 0.5);
      if (isNaN(v) || v > 0x7FFFFFFF || v < -2147483648) {
        this._predictedValue[1] = -2147483648;
      } else {
        this._predictedValue[1] = v | 0;
      }

      return true;
    }

    // Fallback: delta coding when both corners are not available.
    let dataOffset = 0;
    if (prevDataId < dataId) {
      dataOffset = prevDataId * this._numComponents;
    }
    if (nextDataId < dataId) {
      dataOffset = nextDataId * this._numComponents;
    } else {
      if (dataId > 0) {
        dataOffset = (dataId - 1) * this._numComponents;
      } else {
        for (let i = 0; i < this._numComponents; ++i) {
          this._predictedValue[i] = 0;
        }
        return true;
      }
    }
    for (let i = 0; i < this._numComponents; ++i) {
      this._predictedValue[i] = data[dataOffset + i];
    }
    return true;
  }

}

// src/compression/attributes/prediction_schemes/MeshPredictionSchemeTexCoordsPortablePredictor.js
// Ported from draco/compression/attributes/prediction_schemes/mesh_prediction_scheme_tex_coords_portable_predictor.h

/**
 * Predictor functionality used for portable UV prediction by both encoder and
 * decoder. This implements only the decoder path (is_encoder_t = false).
 */
class MeshPredictionSchemeTexCoordsPortablePredictor {

  static NUM_COMPONENTS = 2;

  /**
   * @param {object} meshData - MeshPredictionSchemeData instance
   */
  constructor(meshData) {
    this._posAttribute = null;
    this._entryToPointIdMap = null;
    this._predictedValue = new Int32Array(2);
    this._orientations = [];
    this._meshData = meshData;
    this._tempPos = new Array(3);
    // Reusable scratch for the per-corner position fetches (hot loop).
    this._nextPos = new Array(3);
    this._prevPos = new Array(3);
    // Flat Int32 position cache indexed by data entry id (built once per
    // decode) so position fetches are array reads, not convertValue calls.
    this._posCache = null;
  }

  /**
   * @param {object} positionAttribute - PointAttribute for positions
   */
  setPositionAttribute(positionAttribute) {
    this._posAttribute = positionAttribute;
  }

  /**
   * @param {Array} map
   */
  setEntryToPointIdMap(map) {
    this._entryToPointIdMap = map;
  }

  /** @returns {boolean} */
  isInitialized() {
    return this._posAttribute !== null;
  }

  /** @returns {Int32Array} */
  get predictedValue() {
    return this._predictedValue;
  }

  /**
   * @param {number} numOrientations
   */
  resizeOrientations(numOrientations) {
    this._orientations = new Array(numOrientations);
  }

  /**
   * @param {number} i
   * @param {boolean} v
   */
  setOrientation(i, v) {
    this._orientations[i] = v;
  }

  /**
   * Precomputes the integer position of every data entry once so position
   * fetches in the hot loop are flat-array reads.
   * @param {number} numEntries
   */
  buildPositionCache(numEntries) {
    const cache = new Int32Array(numEntries * 3);
    const tmp = this._tempPos;
    const att = this._posAttribute;
    const map = this._entryToPointIdMap;
    for (let d = 0; d < numEntries; ++d) {
      att.convertValue(att.mappedIndex(map[d]), tmp);
      const o = d * 3;
      cache[o] = tmp[0];
      cache[o + 1] = tmp[1];
      cache[o + 2] = tmp[2];
    }
    this._posCache = cache;
  }

  /**
   * Returns the 3D position (as int64-safe values) for a given entry id.
   * @private
   */
  _getPositionForEntryId(entryId, out) {
    const c = this._posCache;
    const o = entryId * 3;
    out[0] = c[o];
    out[1] = c[o + 1];
    out[2] = c[o + 2];
  }

  /**
   * Computes predicted UV coordinates on a given corner (decoder path).
   * @param {number} cornerId
   * @param {Int32Array} data
   * @param {number} dataId
   * @returns {boolean}
   */
  computePredictedValue(cornerId, data, dataId) {
    const table = this._meshData.cornerTable;
    const nextCornerId = table.next(cornerId);
    const prevCornerId = table.previous(cornerId);

    const nextVertId = table.vertex(nextCornerId);
    const prevVertId = table.vertex(prevCornerId);

    const nextDataId = this._meshData.vertexToDataMap[nextVertId];
    const prevDataId = this._meshData.vertexToDataMap[prevVertId];

    if (prevDataId < dataId && nextDataId < dataId) {
      const nDataOff = nextDataId * 2;
      const pDataOff = prevDataId * 2;
      const nUV0 = data[nDataOff], nUV1 = data[nDataOff + 1];
      const pUV0 = data[pDataOff], pUV1 = data[pDataOff + 1];

      if (pUV0 === nUV0 && pUV1 === nUV1) {
        this._predictedValue[0] = pUV0;
        this._predictedValue[1] = pUV1;
        return true;
      }

      const tipPos = this._tempPos;
      const nextPos = this._nextPos;
      const prevPos = this._prevPos;
      this._getPositionForEntryId(dataId, tipPos);
      this._getPositionForEntryId(nextDataId, nextPos);
      this._getPositionForEntryId(prevDataId, prevPos);

      // pn = prevPos - nextPos
      const pn0 = prevPos[0] - nextPos[0];
      const pn1 = prevPos[1] - nextPos[1];
      const pn2 = prevPos[2] - nextPos[2];
      const pnNorm2Squared = pn0 * pn0 + pn1 * pn1 + pn2 * pn2;

      if (pnNorm2Squared !== 0) {
        const cn0 = tipPos[0] - nextPos[0];
        const cn1 = tipPos[1] - nextPos[1];
        const cn2 = tipPos[2] - nextPos[2];
        const cnDotPn = pn0 * cn0 + pn1 * cn1 + pn2 * cn2;

        const pnUV0 = pUV0 - nUV0;
        const pnUV1 = pUV1 - nUV1;

        const INT64_MAX = 9223372036854775807;
        const nUVAbsMax = Math.max(Math.abs(nUV0), Math.abs(nUV1));
        if (nUVAbsMax > INT64_MAX / pnNorm2Squared) {
          return false;
        }

        const pnUVAbsMax = Math.max(Math.abs(pnUV0), Math.abs(pnUV1));
        if (pnUVAbsMax > 0 && Math.abs(cnDotPn) > INT64_MAX / pnUVAbsMax) {
          return false;
        }

        // x_uv = nUV * pnNorm2Squared + cnDotPn * pnUV
        const xUV0 = nUV0 * pnNorm2Squared + cnDotPn * pnUV0;
        const xUV1 = nUV1 * pnNorm2Squared + cnDotPn * pnUV1;

        const pnAbsMax = Math.max(Math.abs(pn0), Math.abs(pn1), Math.abs(pn2));
        if (pnAbsMax > 0 && Math.abs(cnDotPn) > INT64_MAX / pnAbsMax) {
          return false;
        }

        // x_pos = nextPos + (cnDotPn * pn) / pnNorm2Squared
        const xPos0 = nextPos[0] + Math.trunc((cnDotPn * pn0) / pnNorm2Squared);
        const xPos1 = nextPos[1] + Math.trunc((cnDotPn * pn1) / pnNorm2Squared);
        const xPos2 = nextPos[2] + Math.trunc((cnDotPn * pn2) / pnNorm2Squared);
        const cx0 = tipPos[0] - xPos0;
        const cx1 = tipPos[1] - xPos1;
        const cx2 = tipPos[2] - xPos2;
        const cxNorm2Squared = cx0 * cx0 + cx1 * cx1 + cx2 * cx2;

        // Rotated pnUV by 90 degrees.
        const normSquared = Math.floor(Math.sqrt(cxNorm2Squared * pnNorm2Squared));
        const cxUV0 = pnUV1 * normSquared;
        const cxUV1 = -pnUV0 * normSquared;

        if (this._orientations.length === 0) {
          return false;
        }
        const orientation = this._orientations[this._orientations.length - 1];
        this._orientations.length--;

        if (orientation) {
          this._predictedValue[0] = Math.trunc((xUV0 + cxUV0) / pnNorm2Squared);
          this._predictedValue[1] = Math.trunc((xUV1 + cxUV1) / pnNorm2Squared);
        } else {
          this._predictedValue[0] = Math.trunc((xUV0 - cxUV0) / pnNorm2Squared);
          this._predictedValue[1] = Math.trunc((xUV1 - cxUV1) / pnNorm2Squared);
        }
        return true;
      }
    }

    // Fallback: delta coding.
    let dataOffset = 0;
    if (prevDataId < dataId) {
      dataOffset = prevDataId * 2;
    }
    if (nextDataId < dataId) {
      dataOffset = nextDataId * 2;
    } else {
      if (dataId > 0) {
        dataOffset = (dataId - 1) * 2;
      } else {
        this._predictedValue[0] = 0;
        this._predictedValue[1] = 0;
        return true;
      }
    }
    this._predictedValue[0] = data[dataOffset];
    this._predictedValue[1] = data[dataOffset + 1];
    return true;
  }

}

// src/compression/attributes/prediction_schemes/MeshPredictionSchemeTexCoordsPortableDecoder.js
// Ported from draco/compression/attributes/prediction_schemes/mesh_prediction_scheme_tex_coords_portable_decoder.h


const GEOMETRY_ATTRIBUTE_POSITION$1 = 0;

/**
 * Decoder for predictions of UV coordinates using the portable texture
 * coordinate predictor. This is the preferred version over the deprecated
 * MeshPredictionSchemeTexCoordsDecoder.
 */
class MeshPredictionSchemeTexCoordsPortableDecoder extends MeshPredictionSchemeDecoder {

  /**
   * @param {object} attribute - PointAttribute
   * @param {object} transform - A decoding transform instance
   * @param {object} meshData - MeshPredictionSchemeData instance
   */
  constructor(attribute, transform, meshData) {
    super(attribute, transform, meshData);
    this._predictor = new MeshPredictionSchemeTexCoordsPortablePredictor(meshData);
  }

  /** @returns {number} */
  getPredictionMethod() {
    return PredictionSchemeMethod.MESH_PREDICTION_TEX_COORDS_PORTABLE;
  }

  /** @returns {boolean} */
  isInitialized() {
    if (!this._predictor.isInitialized()) return false;
    if (!this._meshData.isInitialized()) return false;
    return true;
  }

  /** @returns {number} */
  getNumParentAttributes() {
    return 1;
  }

  /**
   * @param {number} i
   * @returns {number}
   */
  getParentAttributeType(i) {
    return GEOMETRY_ATTRIBUTE_POSITION$1;
  }

  /**
   * @param {object} att - PointAttribute
   * @returns {boolean}
   */
  setParentAttribute(att) {
    if (!att || att.attributeType !== GEOMETRY_ATTRIBUTE_POSITION$1) return false;
    if (att.numComponents !== 3) return false;
    this._predictor.setPositionAttribute(att);
    return true;
  }

  /**
   * Decodes orientation flags.
   * @param {DecoderBuffer} buffer
   * @returns {boolean}
   */
  decodePredictionData(buffer) {
    let numOrientations = buffer.decodeInt32();
    if (numOrientations === undefined || numOrientations < 0) return false;

    this._predictor.resizeOrientations(numOrientations);
    let lastOrientation = true;
    const decoder = new RAnsBitDecoder();
    if (!decoder.startDecoding(buffer)) return false;
    for (let i = 0; i < numOrientations; ++i) {
      if (!decoder.decodeNextBit()) {
        lastOrientation = !lastOrientation;
      }
      this._predictor.setOrientation(i, lastOrientation);
    }
    decoder.endDecoding();
    return super.decodePredictionData(buffer);
  }

  /**
   * @param {Int32Array} inCorr
   * @param {Int32Array} outData
   * @param {number} size
   * @param {number} numComponents
   * @param {Array} entryToPointIdMap
   * @returns {boolean}
   */
  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    if (numComponents !== MeshPredictionSchemeTexCoordsPortablePredictor.NUM_COMPONENTS) {
      return false;
    }
    this._predictor.setEntryToPointIdMap(entryToPointIdMap);
    this._transform.init(numComponents);

    const cornerMapSize = this._meshData.dataToCornerMap.length;
    // Cache integer positions once (see predictor) to avoid per-fetch
    // mappedIndex + convertValue in the prediction loop.
    this._predictor.buildPositionCache(cornerMapSize);
    for (let p = 0; p < cornerMapSize; ++p) {
      const cornerId = this._meshData.dataToCornerMap[p];
      if (!this._predictor.computePredictedValue(cornerId, outData, p)) {
        return false;
      }

      const dstOffset = p * numComponents;
      this._transform.computeOriginalValue(
        this._predictor.predictedValue, 0,
        inCorr, dstOffset,
        outData, dstOffset
      );
    }
    return true;
  }

}

// src/compression/attributes/NormalCompressionUtils.js
// Ported from draco/compression/attributes/normal_compression_utils.h

/**
 * OctahedronToolBox provides utilities for converting unit vectors to
 * octahedral coordinates and back, used for normal compression.
 *
 * Key values:
 *   q: number of quantization bits
 *   maxQuantizedValue: max representable value with q bits (odd)
 *   maxValue: maxQuantizedValue - 1 (even)
 *   centerValue: maxValue / 2
 */
let OctahedronToolBox$1 = class OctahedronToolBox {

  constructor() {
    this._quantizationBits = -1;
    this._maxQuantizedValue = -1;
    this._maxValue = -1;
    this._dequantizationScale = 1.0;
    this._centerValue = -1;
  }

  /**
   * @param {number} q - quantization bits (2..30)
   * @returns {boolean}
   */
  setQuantizationBits(q) {
    if (q < 2 || q > 30) return false;
    this._quantizationBits = q;
    this._maxQuantizedValue = (1 << q) - 1;
    this._maxValue = this._maxQuantizedValue - 1;
    this._dequantizationScale = 2.0 / this._maxValue;
    this._centerValue = (this._maxValue / 2) | 0;
    return true;
  }

  /** @returns {boolean} */
  isInitialized() {
    return this._quantizationBits !== -1;
  }

  /** @returns {number} */
  quantizationBits() { return this._quantizationBits; }

  /** @returns {number} */
  maxQuantizedValue() { return this._maxQuantizedValue; }

  /** @returns {number} */
  maxValue() { return this._maxValue; }

  /** @returns {number} */
  centerValue() { return this._centerValue; }

  /**
   * Canonicalizes edge points so they are in consistent quadrants. Writes the
   * result into out[0], out[1] (caller-owned reusable 2-element array).
   * @param {number} s
   * @param {number} t
   * @param {number[]|Int32Array} out
   */
  canonicalizeOctahedralCoords(s, t, out) {
    if ((s === 0 && t === 0) || (s === 0 && t === this._maxValue) ||
        (s === this._maxValue && t === 0)) {
      s = this._maxValue;
      t = this._maxValue;
    } else if (s === 0 && t > this._centerValue) {
      t = this._centerValue - (t - this._centerValue);
    } else if (s === this._maxValue && t < this._centerValue) {
      t = this._centerValue + (this._centerValue - t);
    } else if (t === this._maxValue && s < this._centerValue) {
      s = this._centerValue + (this._centerValue - s);
    } else if (t === 0 && s > this._centerValue) {
      s = this._centerValue - (s - this._centerValue);
    }
    out[0] = s;
    out[1] = t;
  }

  /**
   * Converts an integer vector to quantized octahedral coordinates.
   * Precondition: abs sum of intVec must equal centerValue.
   * @param {Int32Array|Array} intVec - [x, y, z]
   * @param {Int32Array|Array} out - output [s, t] or writes to out[0], out[1]
   */
  integerVectorToQuantizedOctahedralCoords(intVec, out) {
    let s, t;
    if (intVec[0] >= 0) {
      // Right hemisphere.
      s = intVec[1] + this._centerValue;
      t = intVec[2] + this._centerValue;
    } else {
      // Left hemisphere.
      if (intVec[1] < 0) {
        s = Math.abs(intVec[2]);
      } else {
        s = this._maxValue - Math.abs(intVec[2]);
      }
      if (intVec[2] < 0) {
        t = Math.abs(intVec[1]);
      } else {
        t = this._maxValue - Math.abs(intVec[1]);
      }
    }
    this.canonicalizeOctahedralCoords(s, t, out);
  }

  /**
   * Normalizes intVec so its abs sum equals centerValue.
   * @param {Int32Array|Array} vec - [x, y, z], modified in place
   */
  canonicalizeIntegerVector(vec) {
    const absSum = Math.abs(vec[0]) + Math.abs(vec[1]) + Math.abs(vec[2]);
    if (absSum === 0) {
      vec[0] = this._centerValue;
      // vec[1] and vec[2] remain 0.
    } else {
      vec[0] = Math.trunc((vec[0] * this._centerValue) / absSum);
      vec[1] = Math.trunc((vec[1] * this._centerValue) / absSum);
      if (vec[2] >= 0) {
        vec[2] = this._centerValue - Math.abs(vec[0]) - Math.abs(vec[1]);
      } else {
        vec[2] = -(this._centerValue - Math.abs(vec[0]) - Math.abs(vec[1]));
      }
    }
  }

  /**
   * Converts quantized octahedral coordinates to a unit vector.
   * @param {number} inS
   * @param {number} inT
   * @param {Float32Array|Array} outVector - [x, y, z]
   */
  quantizedOctahedralCoordsToUnitVector(inS, inT, outVector) {
    this._octahedralCoordsToUnitVector(
      inS * this._dequantizationScale - 1.0,
      inT * this._dequantizationScale - 1.0,
      outVector
    );
  }

  /**
   * Checks if the point (s, t) is inside the diamond. Expects center at origin.
   * @param {number} s
   * @param {number} t
   * @returns {boolean}
   */
  isInDiamond(s, t) {
    const st = Math.abs(s) + Math.abs(t);
    return st <= this._centerValue;
  }

  /**
   * Inverts the diamond mapping. Expects center at origin. Writes the result
   * into out[0], out[1] (out is a caller-owned reusable 2-element array) to
   * avoid allocating per call in the per-normal decode hot path.
   * @param {number} s
   * @param {number} t
   * @param {number[]|Int32Array} out
   */
  invertDiamond(s, t, out) {
    let signS = 0;
    let signT = 0;
    if (s >= 0 && t >= 0) {
      signS = 1;
      signT = 1;
    } else if (s <= 0 && t <= 0) {
      signS = -1;
      signT = -1;
    } else {
      signS = (s > 0) ? 1 : -1;
      signT = (t > 0) ? 1 : -1;
    }

    const cornerPointS = signS * this._centerValue;
    const cornerPointT = signT * this._centerValue;

    // Unsigned arithmetic to avoid signed overflow.
    let us = s | 0;
    let ut = t | 0;
    us = us + us - cornerPointS;
    ut = ut + ut - cornerPointT;

    if (signS * signT >= 0) {
      const temp = us;
      us = -ut;
      ut = -temp;
    } else {
      const temp = us;
      us = ut;
      ut = temp;
    }

    us = us + cornerPointS;
    ut = ut + cornerPointT;

    out[0] = (us / 2) | 0;
    out[1] = (ut / 2) | 0;
  }

  /**
   * Modular wrapping around the quantization range for correction values.
   * @param {number} x
   * @returns {number}
   */
  modMax(x) {
    if (x > this._centerValue) {
      return x - this._maxQuantizedValue;
    }
    if (x < -this._centerValue) {
      return x + this._maxQuantizedValue;
    }
    return x;
  }

  /**
   * Makes a correction value positive.
   * @param {number} x
   * @returns {number}
   */
  makePositive(x) {
    if (x < 0) return x + this._maxQuantizedValue;
    return x;
  }

  /**
   * @private
   */
  _octahedralCoordsToUnitVector(inSScaled, inTScaled, outVector) {
    let y = inSScaled;
    let z = inTScaled;
    const x = 1.0 - Math.abs(y) - Math.abs(z);

    let xOffset = -x;
    if (xOffset < 0) xOffset = 0;

    y += (y < 0) ? xOffset : -xOffset;
    z += (z < 0) ? xOffset : -xOffset;

    const normSquared = x * x + y * y + z * z;
    if (normSquared < 1e-6) {
      outVector[0] = 0;
      outVector[1] = 0;
      outVector[2] = 0;
    } else {
      const d = 1.0 / Math.sqrt(normSquared);
      outVector[0] = x * d;
      outVector[1] = y * d;
      outVector[2] = z * d;
    }
  }

};

// src/compression/attributes/prediction_schemes/MeshPredictionSchemeGeometricNormalPredictorArea.js
// Ported from draco/compression/attributes/prediction_schemes/mesh_prediction_scheme_geometric_normal_predictor_area.h
// and mesh_prediction_scheme_geometric_normal_predictor_base.h


const UPPER_BOUND = 1 << 29;

/**
 * Predictor that estimates the normal via the surrounding triangles of a
 * given corner, weighted by triangle area.
 */
class MeshPredictionSchemeGeometricNormalPredictorArea {

  /**
   * @param {object} meshData - MeshPredictionSchemeData instance
   */
  constructor(meshData) {
    this._posAttribute = null;
    this._entryToPointIdMap = null;
    this._meshData = meshData;
    this._normalPredictionMode = NormalPredictionMode.TRIANGLE_AREA;
    this._tempPos = new Array(3);
    // Reusable scratch for the per-corner position fetches (hot loop).
    this._posNext = new Array(3);
    this._posPrev = new Array(3);
    // Flat Int32 position cache indexed by data id (built once per decode).
    // The predictor reads the position of a corner's vertex O(valence) times
    // per ring; caching turns O(corners*valence) convertValue calls into one
    // per data entry.
    this._posCache = null;
  }

  /**
   * @param {object} positionAttribute - PointAttribute for positions
   */
  setPositionAttribute(positionAttribute) {
    this._posAttribute = positionAttribute;
  }

  /**
   * @param {Array} map
   */
  setEntryToPointIdMap(map) {
    this._entryToPointIdMap = map;
  }

  /** @returns {boolean} */
  isInitialized() {
    return this._posAttribute !== null && this._entryToPointIdMap !== null;
  }

  /**
   * @param {number} mode
   * @returns {boolean}
   */
  setNormalPredictionMode(mode) {
    if (mode === NormalPredictionMode.ONE_TRIANGLE ||
        mode === NormalPredictionMode.TRIANGLE_AREA) {
      this._normalPredictionMode = mode;
      return true;
    }
    return false;
  }

  /** @returns {number} */
  getNormalPredictionMode() {
    return this._normalPredictionMode;
  }

  /**
   * Precomputes the integer position of every data entry once, so the hot
   * per-corner ring traversal reads from a flat Int32Array instead of going
   * through mappedIndex + convertValue on every fetch.
   * @param {number} numEntries
   */
  buildPositionCache(numEntries) {
    const cache = new Int32Array(numEntries * 3);
    const tmp = this._tempPos;
    const att = this._posAttribute;
    const map = this._entryToPointIdMap;
    for (let d = 0; d < numEntries; ++d) {
      att.convertValue(att.mappedIndex(map[d]), tmp);
      const o = d * 3;
      cache[o] = tmp[0];
      cache[o + 1] = tmp[1];
      cache[o + 2] = tmp[2];
    }
    this._posCache = cache;
  }

  /**
   * Gets the 3D position for a given data id.
   * @private
   */
  _getPositionForDataId(dataId, out) {
    const c = this._posCache;
    const o = dataId * 3;
    out[0] = c[o];
    out[1] = c[o + 1];
    out[2] = c[o + 2];
  }

  /**
   * Gets the 3D position for a given corner.
   * @private
   */
  _getPositionForCorner(ci, out) {
    const table = this._meshData.cornerTable;
    const vertId = table.vertex(ci);
    const dataId = this._meshData.vertexToDataMap[vertId];
    this._getPositionForDataId(dataId, out);
  }

  /**
   * Computes predicted normal for a given corner.
   * @param {number} cornerId
   * @param {Int32Array} prediction - output [x, y, z]
   */
  computePredictedValue(cornerId, prediction) {
    const table = this._meshData.cornerTable;
    const posCent = this._tempPos;
    const posNext = this._posNext;
    const posPrev = this._posPrev;
    this._getPositionForCorner(cornerId, posCent);

    let normalX = 0, normalY = 0, normalZ = 0;

    // Iterate over vertex corners.
    if (this._normalPredictionMode === NormalPredictionMode.ONE_TRIANGLE) {
      // Only use the single triangle at cornerId.
      const cNext = table.next(cornerId);
      const cPrev = table.previous(cornerId);
      this._getPositionForCorner(cNext, posNext);
      this._getPositionForCorner(cPrev, posPrev);

      const dNextX = posNext[0] - posCent[0];
      const dNextY = posNext[1] - posCent[1];
      const dNextZ = posNext[2] - posCent[2];
      const dPrevX = posPrev[0] - posCent[0];
      const dPrevY = posPrev[1] - posCent[1];
      const dPrevZ = posPrev[2] - posCent[2];

      // Cross product.
      normalX = dNextY * dPrevZ - dNextZ * dPrevY;
      normalY = dNextZ * dPrevX - dNextX * dPrevZ;
      normalZ = dNextX * dPrevY - dNextY * dPrevX;
    } else {
      // TRIANGLE_AREA: iterate over all corners around the vertex exactly like
      // C++ VertexCornersIterator(corner_table, corner_id): swing LEFT from the
      // start corner until a boundary or a full loop, then (only if an open
      // boundary was reached) swing RIGHT from the start corner to cover the
      // other side. Only swinging right (as before) silently dropped every
      // triangle to the left of the start corner for boundary vertices, which
      // corrupted the predicted normal on any mesh with open edges.
      let currentCorner = cornerId;
      let leftTraversal = true;

      while (currentCorner >= 0) {
        const cNext = table.next(currentCorner);
        const cPrev = table.previous(currentCorner);
        this._getPositionForCorner(cNext, posNext);
        this._getPositionForCorner(cPrev, posPrev);

        const dNextX = posNext[0] - posCent[0];
        const dNextY = posNext[1] - posCent[1];
        const dNextZ = posNext[2] - posCent[2];
        const dPrevX = posPrev[0] - posCent[0];
        const dPrevY = posPrev[1] - posCent[1];
        const dPrevZ = posPrev[2] - posCent[2];

        // Cross product.
        normalX += dNextY * dPrevZ - dNextZ * dPrevY;
        normalY += dNextZ * dPrevX - dNextX * dPrevZ;
        normalZ += dNextX * dPrevY - dNextY * dPrevX;

        // Advance like VertexCornersIterator::Next().
        if (leftTraversal) {
          currentCorner = table.swingLeft(currentCorner);
          if (currentCorner < 0) {
            // Open boundary reached; cover the other side from the start.
            currentCorner = table.swingRight(cornerId);
            leftTraversal = false;
          } else if (currentCorner === cornerId) {
            // Returned to the start: full ring visited.
            currentCorner = -1;
          }
        } else {
          currentCorner = table.swingRight(currentCorner);
        }
      }
    }

    // Convert to int32, making sure entries are not too large. This mirrors the
    // C++ which does the clamp with int64 INTEGER division: the quotient is
    // floored and each component is divided with truncation toward zero. A naive
    // float division diverges whenever UPPER_BOUND < absSum < 2 * UPPER_BOUND,
    // where the C++ quotient is exactly 1 and the normal is left unchanged.
    let absSum;
    if (this._normalPredictionMode === NormalPredictionMode.ONE_TRIANGLE) {
      // C++ casts AbsSum() to int32_t before the comparison in this branch.
      absSum = (Math.abs(normalX) + Math.abs(normalY) + Math.abs(normalZ)) | 0;
    } else {
      absSum = Math.abs(normalX) + Math.abs(normalY) + Math.abs(normalZ);
    }
    if (absSum > UPPER_BOUND) {
      const quotient = Math.floor(absSum / UPPER_BOUND);
      normalX = Math.trunc(normalX / quotient);
      normalY = Math.trunc(normalY / quotient);
      normalZ = Math.trunc(normalZ / quotient);
    }

    prediction[0] = Math.trunc(normalX);
    prediction[1] = Math.trunc(normalY);
    prediction[2] = Math.trunc(normalZ);
  }

}

// src/compression/attributes/prediction_schemes/MeshPredictionSchemeGeometricNormalDecoder.js
// Ported from draco/compression/attributes/prediction_schemes/mesh_prediction_scheme_geometric_normal_decoder.h


const GEOMETRY_ATTRIBUTE_POSITION = 0;

/**
 * Decoder for geometric normal prediction. Predicts normals using the
 * surrounding triangle geometry, then converts to octahedral coordinates.
 */
class MeshPredictionSchemeGeometricNormalDecoder extends MeshPredictionSchemeDecoder {

  /**
   * @param {object} attribute - PointAttribute
   * @param {object} transform - A decoding transform instance
   * @param {object} meshData - MeshPredictionSchemeData instance
   */
  constructor(attribute, transform, meshData) {
    super(attribute, transform, meshData);
    this._predictor = new MeshPredictionSchemeGeometricNormalPredictorArea(meshData);
    this._octahedronToolBox = new OctahedronToolBox$1();
    this._flipNormalBitDecoder = new RAnsBitDecoder();
  }

  /** @returns {number} */
  getPredictionMethod() {
    return PredictionSchemeMethod.MESH_PREDICTION_GEOMETRIC_NORMAL;
  }

  /** @returns {boolean} */
  isInitialized() {
    if (!this._predictor.isInitialized()) return false;
    if (!this._meshData.isInitialized()) return false;
    if (!this._octahedronToolBox.isInitialized()) return false;
    return true;
  }

  /** @returns {number} */
  getNumParentAttributes() {
    return 1;
  }

  /**
   * @param {number} i
   * @returns {number}
   */
  getParentAttributeType(i) {
    return GEOMETRY_ATTRIBUTE_POSITION;
  }

  /**
   * @param {object} att - PointAttribute
   * @returns {boolean}
   */
  setParentAttribute(att) {
    if (att.attributeType !== GEOMETRY_ATTRIBUTE_POSITION) return false;
    if (att.numComponents !== 3) return false;
    this._predictor.setPositionAttribute(att);
    return true;
  }

  /**
   * Sets quantization bits for the octahedron tool box.
   * @param {number} q
   */
  setQuantizationBits(q) {
    this._octahedronToolBox.setQuantizationBits(q);
  }

  /**
   * Decodes prediction data including transform data, prediction mode, and
   * normal flip bits.
   * @param {DecoderBuffer} buffer
   * @returns {boolean}
   */
  decodePredictionData(buffer) {
    // Get data needed for transform.
    if (!this._transform.decodeTransformData(buffer)) return false;

    if (buffer.bitstreamVersion < 0x0202) {
      const predictionMode = buffer.decodeUint8();
      if (predictionMode === undefined) return false;
      if (predictionMode > NormalPredictionMode.TRIANGLE_AREA) return false;
      if (!this._predictor.setNormalPredictionMode(predictionMode)) return false;
    }

    // Init normal flips.
    if (!this._flipNormalBitDecoder.startDecoding(buffer)) return false;

    return true;
  }

  /**
   * @param {Int32Array} inCorr
   * @param {Int32Array} outData
   * @param {number} size
   * @param {number} numComponents
   * @param {Array} entryToPointIdMap
   * @returns {boolean}
   */
  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    this.setQuantizationBits(this._transform.quantizationBits());
    this._predictor.setEntryToPointIdMap(entryToPointIdMap);

    // Expecting octahedral coordinates (2 components).
    const cornerMapSize = this._meshData.dataToCornerMap.length;

    // Cache the integer positions once so the per-corner ring traversal reads
    // from a flat array instead of mappedIndex + convertValue per fetch.
    this._predictor.buildPositionCache(cornerMapSize);

    const predNormal3D = new Int32Array(3);
    const predNormalOct = new Int32Array(2);

    for (let dataId = 0; dataId < cornerMapSize; ++dataId) {
      const cornerId = this._meshData.dataToCornerMap[dataId];
      this._predictor.computePredictedValue(cornerId, predNormal3D);

      // Compute predicted octahedral coordinates.
      this._octahedronToolBox.canonicalizeIntegerVector(predNormal3D);

      if (this._flipNormalBitDecoder.decodeNextBit()) {
        predNormal3D[0] = -predNormal3D[0];
        predNormal3D[1] = -predNormal3D[1];
        predNormal3D[2] = -predNormal3D[2];
      }

      this._octahedronToolBox.integerVectorToQuantizedOctahedralCoords(
        predNormal3D, predNormalOct
      );

      const dataOffset = dataId * 2;
      this._transform.computeOriginalValue(
        predNormalOct, 0,
        inCorr, dataOffset,
        outData, dataOffset
      );
    }

    this._flipNormalBitDecoder.endDecoding();
    return true;
  }

}

// src/compression/attributes/prediction_schemes/MeshPredictionSchemeData.js
// Ported from draco/compression/attributes/prediction_schemes/mesh_prediction_scheme_data.h

/**
 * Stores connectivity data about the mesh and information about how it was
 * encoded/decoded.
 */
class MeshPredictionSchemeData {

  constructor() {
    this._mesh = null;
    this._cornerTable = null;
    this._vertexToDataMap = null;
    this._dataToCornerMap = null;
  }

  /**
   * Initializes the data with mesh connectivity information.
   * @param {object} mesh
   * @param {object} cornerTable
   * @param {Array|Int32Array} dataToCornerMap
   * @param {Array|Int32Array} vertexToDataMap
   */
  set(mesh, cornerTable, dataToCornerMap, vertexToDataMap) {
    this._mesh = mesh;
    this._cornerTable = cornerTable;
    this._dataToCornerMap = dataToCornerMap;
    this._vertexToDataMap = vertexToDataMap;
  }

  /** @returns {object} */
  get mesh() { return this._mesh; }

  /** @returns {object} */
  get cornerTable() { return this._cornerTable; }

  /** @returns {Array|Int32Array} */
  get vertexToDataMap() { return this._vertexToDataMap; }

  /** @returns {Array|Int32Array} */
  get dataToCornerMap() { return this._dataToCornerMap; }

  /** @returns {boolean} */
  isInitialized() {
    return this._mesh !== null &&
           this._cornerTable !== null &&
           this._vertexToDataMap !== null &&
           this._dataToCornerMap !== null;
  }

}

// src/compression/attributes/prediction_schemes/PredictionSchemeDecoderFactory.js
// Ported from draco/compression/attributes/prediction_schemes/prediction_scheme_decoder_factory.h


/**
 * Creates a mesh prediction scheme decoder based on the prediction method.
 *
 * @param {number} method - PredictionSchemeMethod enum value
 * @param {object} attribute - PointAttribute
 * @param {object} transform - A decoding transform instance
 * @param {object} meshData - MeshPredictionSchemeData instance
 * @param {number} bitstreamVersion
 * @param {number} transformType - PredictionSchemeTransformType
 * @returns {object|null} Prediction scheme decoder or null
 */
function createMeshPredictionSchemeDecoder(method, attribute, transform,
  meshData, bitstreamVersion, transformType) {

  // For normal octahedron transforms, only geometric normal is supported.
  if (transformType === PredictionSchemeTransformType.PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON_CANONICALIZED ||
      transformType === PredictionSchemeTransformType.PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON) {
    if (method === PredictionSchemeMethod.MESH_PREDICTION_GEOMETRIC_NORMAL) {
      return new MeshPredictionSchemeGeometricNormalDecoder(
        attribute, transform, meshData
      );
    }
    return null;
  }

  // For wrap and delta transforms, any mesh prediction scheme is valid.
  switch (method) {
    case PredictionSchemeMethod.MESH_PREDICTION_PARALLELOGRAM:
      return new MeshPredictionSchemeParallelogramDecoder(
        attribute, transform, meshData
      );

    case PredictionSchemeMethod.MESH_PREDICTION_MULTI_PARALLELOGRAM:
      return new MeshPredictionSchemeMultiParallelogramDecoder(
        attribute, transform, meshData
      );

    case PredictionSchemeMethod.MESH_PREDICTION_CONSTRAINED_MULTI_PARALLELOGRAM:
      return new MeshPredictionSchemeConstrainedMultiParallelogramDecoder(
        attribute, transform, meshData
      );

    case PredictionSchemeMethod.MESH_PREDICTION_TEX_COORDS_DEPRECATED:
      return new MeshPredictionSchemeTexCoordsDecoder(
        attribute, transform, meshData, bitstreamVersion
      );

    case PredictionSchemeMethod.MESH_PREDICTION_TEX_COORDS_PORTABLE:
      return new MeshPredictionSchemeTexCoordsPortableDecoder(
        attribute, transform, meshData
      );

    case PredictionSchemeMethod.MESH_PREDICTION_GEOMETRIC_NORMAL:
      return new MeshPredictionSchemeGeometricNormalDecoder(
        attribute, transform, meshData
      );

    default:
      return null;
  }
}

/**
 * Creates a prediction scheme for a given decoder and given prediction method.
 * If the method specifies a mesh-based prediction and mesh data is available,
 * the appropriate mesh prediction scheme is created. Otherwise, a delta
 * decoder is returned as fallback.
 *
 * @param {number} method - PredictionSchemeMethod
 * @param {number} attId - attribute id
 * @param {object} decoder - PointCloudDecoder or MeshDecoder
 * @param {object} transform - A decoding transform instance
 * @returns {object|null} Prediction scheme decoder or null
 */
function createPredictionSchemeForDecoder(method, attId, decoder, transform) {
  if (method === PredictionSchemeMethod.PREDICTION_NONE) {
    return null;
  }

  const att = decoder.pointCloud().attribute(attId);

  if (decoder.getGeometryType() === 1) { // TRIANGULAR_MESH
    const meshDecoder = decoder;
    const cornerTable = meshDecoder.getCornerTable();
    const encodingData = meshDecoder.getAttributeEncodingData(attId);

    if (cornerTable !== null && encodingData !== null) {
      const meshData = new MeshPredictionSchemeData();
      const attCornerTable = meshDecoder.getAttributeCornerTable(attId);

      if (attCornerTable !== null) {
        meshData.set(
          meshDecoder.mesh(),
          attCornerTable,
          encodingData.encodedAttributeValueIndexToCornerMap,
          encodingData.vertexToEncodedAttributeValueIndexMap
        );
      } else {
        meshData.set(
          meshDecoder.mesh(),
          cornerTable,
          encodingData.encodedAttributeValueIndexToCornerMap,
          encodingData.vertexToEncodedAttributeValueIndexMap
        );
      }

      const transformType = transform.getType ? transform.getType() : -1;
      const ret = createMeshPredictionSchemeDecoder(
        method, att, transform, meshData,
        decoder.bitstreamVersion(), transformType
      );
      if (ret !== null) return ret;
    }
  }

  // Fallback: delta decoder.
  return new PredictionSchemeDeltaDecoder(att, transform);
}

// src/compression/attributes/prediction_schemes/PredictionSchemeWrapDecodingTransform.js
// Ported from draco/compression/attributes/prediction_schemes/prediction_scheme_wrap_decoding_transform.h


/**
 * PredictionSchemeWrapDecodingTransform unwraps values encoded with the
 * wrap encoding transform. Values are wrapped around min/max range.
 *
 * The wrapping works as follows:
 *   - Encoding stores correction X = O - P, wrapped around the data range N:
 *       X + N if X < -N/2
 *       X - N if X > N/2
 *   - Decoding unwraps: F = P + X, then:
 *       F + N if F < MIN
 *       F - N if F > MAX
 */
class PredictionSchemeWrapDecodingTransform {

  constructor() {
    this._numComponents = 0;
    this._minValue = 0;
    this._maxValue = 0;
    this._maxDif = 0;
    this._maxCorrection = 0;
    this._minCorrection = 0;
    this._clampedValue = null;
  }

  /**
   * @returns {number}
   */
  getType() {
    return PredictionSchemeTransformType.PREDICTION_TRANSFORM_WRAP;
  }

  /**
   * @param {number} numComponents
   */
  init(numComponents) {
    this._numComponents = numComponents;
    this._clampedValue = new Int32Array(numComponents);
  }

  /**
   * @returns {boolean}
   */
  areCorrectionsPositive() {
    return false;
  }

  /**
   * @returns {number}
   */
  numComponents() {
    return this._numComponents;
  }

  /**
   * @returns {number}
   */
  quantizationBits() {
    return -1;
  }

  /**
   * Clamps predicted values to the [minValue, maxValue] range.
   * Returns the clamped array (internal buffer reused).
   * @param {Int32Array|TypedArray} predictedVal
   * @param {number} offset
   * @returns {Int32Array}
   */
  clampPredictedValue(predictedVal, offset) {
    for (let i = 0; i < this._numComponents; ++i) {
      const v = predictedVal[offset + i];
      if (v > this._maxValue) {
        this._clampedValue[i] = this._maxValue;
      } else if (v < this._minValue) {
        this._clampedValue[i] = this._minValue;
      } else {
        this._clampedValue[i] = v;
      }
    }
    return this._clampedValue;
  }

  /**
   * Computes the original value from predicted and correction values,
   * unwrapping values that fall outside the [min, max] range.
   * @param {Int32Array|TypedArray} predictedVals
   * @param {number} predictedOffset
   * @param {Int32Array|TypedArray} corrVals
   * @param {number} corrOffset
   * @param {Int32Array|TypedArray} outOriginalVals
   * @param {number} outOffset
   */
  computeOriginalValue(predictedVals, predictedOffset, corrVals, corrOffset,
    outOriginalVals, outOffset) {
    // Clamp and wrap fused into a single pass over the components, reading the
    // bounds from locals — avoids the scratch _clampedValue round-trip and a
    // second loop. Semantics are identical to clampPredictedValue() followed by
    // the wrap below.
    const nc = this._numComponents;
    const minValue = this._minValue;
    const maxValue = this._maxValue;
    const maxDif = this._maxDif;
    for (let i = 0; i < nc; ++i) {
      let pred = predictedVals[predictedOffset + i];
      if (pred > maxValue) {
        pred = maxValue;
      } else if (pred < minValue) {
        pred = minValue;
      }
      // Perform the wrapping using 32-bit arithmetic to avoid signed overflow.
      let orig = (pred + corrVals[corrOffset + i]) | 0;
      if (orig > maxValue) {
        orig -= maxDif;
      } else if (orig < minValue) {
        orig += maxDif;
      }
      outOriginalVals[outOffset + i] = orig;
    }
  }

  /**
   * Decodes the transform-specific data (min and max values) from the buffer.
   * @param {DecoderBuffer} buffer
   * @returns {boolean}
   */
  decodeTransformData(buffer) {
    const minValue = buffer.decodeInt32();
    if (minValue === undefined) return false;
    const maxValue = buffer.decodeInt32();
    if (maxValue === undefined) return false;
    if (minValue > maxValue) return false;

    this._minValue = minValue;
    this._maxValue = maxValue;
    return this._initCorrectionBounds();
  }

  /**
   * @private
   * @returns {boolean}
   */
  _initCorrectionBounds() {
    const dif = this._maxValue - this._minValue;
    if (dif < 0 || dif >= 0x7FFFFFFF) {
      return false;
    }
    this._maxDif = 1 + dif;
    this._maxCorrection = (this._maxDif / 2) | 0;
    this._minCorrection = -this._maxCorrection;
    if ((this._maxDif & 1) === 0) {
      this._maxCorrection -= 1;
    }
    return true;
  }

}

// compression/attributes/SequentialIntegerAttributeDecoder.js - ported from compression/attributes/sequential_integer_attribute_decoder.h/cc


// Decoder for attributes encoded with the SequentialIntegerAttributeEncoder.
class SequentialIntegerAttributeDecoder extends SequentialAttributeDecoder {

  constructor() {
    super();
    this._predictionScheme = null;
  }

  init(decoder, attributeId) {
    if (!super.init(decoder, attributeId)) {
      return false;
    }
    return true;
  }

  transformAttributeToOriginalFormat(pointIds) {
    if (this.decoder &&
        this.decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 0)) {
      return true; // Don't revert the transform here for older files.
    }
    return this._storeValues(pointIds.length);
  }

  decodeValues(pointIds, buffer) {
    // Decode prediction scheme.
    const predictionSchemeMethod = buffer.decodeInt8();
    if (predictionSchemeMethod === undefined) return false;

    // Check that decoded prediction scheme method type is valid.
    if (predictionSchemeMethod < PredictionSchemeMethod.PREDICTION_NONE ||
        predictionSchemeMethod >= PredictionSchemeMethod.NUM_PREDICTION_SCHEMES) {
      return false;
    }

    if (predictionSchemeMethod !== PredictionSchemeMethod.PREDICTION_NONE) {
      const predictionTransformType = buffer.decodeInt8();
      if (predictionTransformType === undefined) return false;

      // Check that decoded prediction scheme transform type is valid.
      if (predictionTransformType < PredictionSchemeTransformType.PREDICTION_TRANSFORM_NONE ||
          predictionTransformType >= PredictionSchemeTransformType.NUM_PREDICTION_SCHEME_TRANSFORM_TYPES) {
        return false;
      }

      this._predictionScheme = this.createIntPredictionScheme(
        predictionSchemeMethod, predictionTransformType
      );
    }

    if (this._predictionScheme) {
      if (!this.initPredictionScheme(this._predictionScheme)) {
        return false;
      }
    }

    if (!this.decodeIntegerValues(pointIds, buffer)) {
      return false;
    }

    if (this.decoder &&
        this.decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 0)) {
      // For older files, revert the transform right after we decode the data.
      if (!this._storeValues(pointIds.length)) {
        return false;
      }
    }
    return true;
  }

  decodeIntegerValues(pointIds, buffer) {
    const numComponents = this.getNumValueComponents();
    if (numComponents <= 0) {
      return false;
    }
    const numEntries = pointIds.length;
    const numValues = numEntries * numComponents;
    this.preparePortableAttribute(numEntries, numComponents);
    const portableAttributeData = this.getPortableAttributeData();
    if (portableAttributeData === null) {
      return false;
    }

    const compressed = buffer.decodeUint8();
    if (compressed === undefined) return false;

    if (compressed > 0) {
      // Decode compressed values using symbol decoding.
      // DecodeSymbols writes uint32 values into the provided array.
      const outUint32 = new Uint32Array(portableAttributeData.buffer,
        portableAttributeData.byteOffset, numValues);
      if (!decodeSymbols(numValues, numComponents, buffer, outUint32)) {
        return false;
      }
    } else {
      // Decode the integer data directly.
      const numBytes = buffer.decodeUint8();
      if (numBytes === undefined) return false;

      if (numBytes === dataTypeLength(DataType.INT32)) {
        // 4 bytes per value - decode directly.
        if (portableAttributeData.byteLength < 4 * numValues) {
          return false;
        }
        const bytes = buffer.decodeBytes(4 * numValues);
        if (bytes === undefined) return false;
        const srcView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < numValues; i++) {
          portableAttributeData[i] = srcView.getInt32(i * 4, true);
        }
      } else {
        if (buffer.remainingSize < numBytes * numValues) {
          return false;
        }
        for (let i = 0; i < numValues; i++) {
          const valueBytes = buffer.decodeBytes(numBytes);
          if (valueBytes === undefined) return false;
          // Read the value from the raw bytes (little-endian), sign-extending.
          let val = 0;
          for (let b = 0; b < numBytes; b++) {
            val |= valueBytes[b] << (b * 8);
          }
          portableAttributeData[i] = val;
        }
      }
    }

    if (numValues > 0 && (this._predictionScheme === null ||
                          !this._predictionScheme.areCorrectionsPositive())) {
      // Convert the values back to the original signed format.
      // portableAttributeData is Int32Array; we need to interpret as Uint32 for conversion.
      const asUint32 = new Uint32Array(portableAttributeData.buffer, portableAttributeData.byteOffset, numValues);
      convertSymbolsToSignedInts(asUint32, numValues, portableAttributeData);
    }

    // If the data was encoded with a prediction scheme, we must revert it.
    if (this._predictionScheme) {
      if (!this._predictionScheme.decodePredictionData(buffer)) {
        return false;
      }
      if (numValues > 0) {
        if (!this._predictionScheme.computeOriginalValues(
              portableAttributeData, portableAttributeData,
              numValues, numComponents, pointIds)) {
          return false;
        }
      }
    }
    return true;
  }

  // Returns a prediction scheme that should be used for decoding of the
  // integer values. Override in subclasses for different prediction schemes.
  createIntPredictionScheme(method, transformType) {
    if (transformType !== PredictionSchemeTransformType.PREDICTION_TRANSFORM_WRAP) {
      return null; // For now we support only wrap transform.
    }
    const transform = new PredictionSchemeWrapDecodingTransform();
    return createPredictionSchemeForDecoder(
      method, this.attributeId, this.decoder, transform
    );
  }

  // Returns the number of integer attribute components.
  getNumValueComponents() {
    return this.attribute.numComponents;
  }

  // Called after all integer values are decoded. Stores values into the attribute.
  _storeValues(numValues) {
    const dt = this.attribute.dataType;
    switch (dt) {
      case DataType.UINT8:
        this._storeTypedValues(numValues, Uint8Array);
        break;
      case DataType.INT8:
        this._storeTypedValues(numValues, Int8Array);
        break;
      case DataType.UINT16:
        this._storeTypedValues(numValues, Uint16Array);
        break;
      case DataType.INT16:
        this._storeTypedValues(numValues, Int16Array);
        break;
      case DataType.UINT32:
        this._storeTypedValues(numValues, Uint32Array);
        break;
      case DataType.INT32:
        this._storeTypedValues(numValues, Int32Array);
        break;
      default:
        return false;
    }
    return true;
  }

  _storeTypedValues(numValues, TypedArrayClass) {
    const numComponents = this.attribute.numComponents;
    const total = numValues * numComponents;
    if (total === 0) {
      return;
    }
    const src = this.getPortableAttributeData(); // Int32Array of the decoded values.
    // Copy straight into a typed view of the destination buffer (byteOffset 0,
    // so aligned). TypedArray.set performs the target type's coercion per
    // element -- identical to the old per-entry byte copy, without the
    // per-value buffer.write() dispatch.
    const dstAddr = this.attribute.getAddress(0);
    const dst = new TypedArrayClass(dstAddr.buffer, dstAddr.byteOffset, total);
    dst.set(src);
  }

  preparePortableAttribute(numEntries, numComponents) {
    const ga = new GeometryAttribute();
    ga.init(
      this.attribute.attributeType, null, numComponents, DataType.INT32,
      false, numComponents * dataTypeLength(DataType.INT32), 0
    );
    const portAtt = new PointAttribute(ga);
    portAtt.setIdentityMapping();
    portAtt.reset(numEntries);
    portAtt.uniqueId = this.attribute.uniqueId;
    this.setPortableAttribute(portAtt);
  }

  getPortableAttributeData() {
    if (this.portableAttribute.size === 0) {
      return null;
    }
    // Return Int32Array view of the portable attribute data.
    const addr = this.portableAttribute.getAddress(0);
    return new Int32Array(addr.buffer, addr.byteOffset,
      this.portableAttribute.size * this.portableAttribute.numComponents);
  }

}

// attributes/AttributeTransformType.js - ported from attributes/attribute_transform_type.h

const AttributeTransformType = {
  INVALID: -1,
  QUANTIZATION_TRANSFORM: 1,
  OCTAHEDRON_TRANSFORM: 2
};

// attributes/AttributeTransformData.js - ported from attributes/attribute_transform_data.h


class AttributeTransformData {

  constructor() {
    this._transformType = AttributeTransformType.INVALID;
    this._buffer = new DataBuffer();
  }

  get transformType() {
    return this._transformType;
  }

  set transformType(type) {
    this._transformType = type;
  }

  // Reads a parameter value at the given byte offset.
  // |type| is a string: 'int32', 'uint32', 'float32', 'uint8', etc.
  getParameterValue(byteOffset, type) {
    const data = this._buffer.data;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    switch (type) {
      case 'int32': return view.getInt32(byteOffset, true);
      case 'uint32': return view.getUint32(byteOffset, true);
      case 'float32': return view.getFloat32(byteOffset, true);
      case 'float64': return view.getFloat64(byteOffset, true);
      case 'int8': return view.getInt8(byteOffset);
      case 'uint8': return view.getUint8(byteOffset);
      case 'int16': return view.getInt16(byteOffset, true);
      case 'uint16': return view.getUint16(byteOffset, true);
      default: return view.getInt32(byteOffset, true);
    }
  }

  // Writes a parameter value at the given byte offset.
  // |type| is a string: 'int32', 'uint32', 'float32', 'uint8', etc.
  setParameterValue(byteOffset, value, type) {
    const sizeNeeded = byteOffset + this._typeSize(type);
    if (sizeNeeded > this._buffer.dataSize) {
      this._buffer.resize(sizeNeeded);
    }
    const data = this._buffer.data;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    switch (type) {
      case 'int32': view.setInt32(byteOffset, value, true); break;
      case 'uint32': view.setUint32(byteOffset, value, true); break;
      case 'float32': view.setFloat32(byteOffset, value, true); break;
      case 'float64': view.setFloat64(byteOffset, value, true); break;
      case 'int8': view.setInt8(byteOffset, value); break;
      case 'uint8': view.setUint8(byteOffset, value); break;
      case 'int16': view.setInt16(byteOffset, value, true); break;
      case 'uint16': view.setUint16(byteOffset, value, true); break;
      default: view.setInt32(byteOffset, value, true); break;
    }
  }

  // Appends a parameter value at the end of the buffer.
  appendParameterValue(value, type) {
    this.setParameterValue(this._buffer.dataSize, value, type);
  }

  _typeSize(type) {
    switch (type) {
      case 'int8': case 'uint8': return 1;
      case 'int16': case 'uint16': return 2;
      case 'int32': case 'uint32': case 'float32': return 4;
      case 'float64': return 8;
      default: return 4;
    }
  }

}

// attributes/AttributeTransform.js - ported from attributes/attribute_transform.h/cc


class AttributeTransform {

  // Virtual: return the attribute transform type.
  type() {
    return -1; // INVALID, must be overridden
  }

  // Virtual: try to init transform from attribute.
  initFromAttribute(/* attribute */) {
    return false;
  }

  // Virtual: copy parameter values into the provided AttributeTransformData.
  copyToAttributeTransformData(/* outData */) {
    // Must be overridden.
  }

  // Transfers transform data to the attribute.
  transferToAttribute(attribute) {
    const transformData = new AttributeTransformData();
    this.copyToAttributeTransformData(transformData);
    attribute.setAttributeTransformData(transformData);
    return true;
  }

  // Virtual: applies the transform to attribute, stores result in targetAttribute.
  transformAttribute(/* attribute, pointIds, targetAttribute */) {
    return false;
  }

  // Virtual: applies an inverse transform to attribute.
  inverseTransformAttribute(/* attribute, targetAttribute */) {
    return false;
  }

  // Virtual: decodes all data needed to transform attribute back to original format.
  decodeParameters(/* attribute, decoderBuffer */) {
    return false;
  }

  // Virtual: returns the data type of the transformed attribute.
  getTransformedDataType(/* attribute */) {
    return -1;
  }

  // Virtual: returns the number of components of the transformed attribute.
  getTransformedNumComponents(/* attribute */) {
    return -1;
  }

  // Initializes a transformed attribute that can be used as target in
  // inverseTransformAttribute().
  initTransformedAttribute(srcAttribute, numEntries) {
    const numComponents = this.getTransformedNumComponents(srcAttribute);
    const dt = this.getTransformedDataType(srcAttribute);
    const ga = new GeometryAttribute();
    ga.init(
      srcAttribute.attributeType, null, numComponents, dt, false,
      numComponents * dataTypeLength(dt), 0
    );
    const transformedAttribute = new PointAttribute(ga);
    transformedAttribute.reset(numEntries);
    transformedAttribute.setIdentityMapping();
    transformedAttribute.uniqueId = srcAttribute.uniqueId;
    return transformedAttribute;
  }

}

// core/QuantizationUtils.js - ported from quantization_utils.h/cc
// (Decoder-only: the encoder-side Quantizer is not ported.)

class Dequantizer {

  constructor() {
    this._delta = 1.0;
  }

  initFromRange(range, maxQuantizedValue) {
    if (maxQuantizedValue <= 0) return false;
    this._delta = range / maxQuantizedValue;
    return true;
  }

  initFromDelta(delta) {
    this._delta = delta;
    return true;
  }

  dequantizeFloat(val) {
    return val * this._delta;
  }

  get delta() {
    return this._delta;
  }

}

// attributes/AttributeQuantizationTransform.js - ported from attributes/attribute_quantization_transform.h/cc


class AttributeQuantizationTransform extends AttributeTransform {

  constructor() {
    super();
    this._quantizationBits = -1;
    this._minValues = [];
    this._range = 0;
  }

  type() {
    return AttributeTransformType.QUANTIZATION_TRANSFORM;
  }

  // Try to init transform from attribute's existing transform data.
  initFromAttribute(attribute) {
    const transformData = attribute.getAttributeTransformData();
    if (!transformData || transformData.transformType !== AttributeTransformType.QUANTIZATION_TRANSFORM) {
      return false;
    }
    let byteOffset = 0;
    this._quantizationBits = transformData.getParameterValue(byteOffset, 'int32');
    byteOffset += 4;
    this._minValues = new Array(attribute.numComponents);
    for (let i = 0; i < attribute.numComponents; i++) {
      this._minValues[i] = transformData.getParameterValue(byteOffset, 'float32');
      byteOffset += 4;
    }
    this._range = transformData.getParameterValue(byteOffset, 'float32');
    return true;
  }

  // Copy parameter values into the provided AttributeTransformData instance.
  copyToAttributeTransformData(outData) {
    outData.transformType = AttributeTransformType.QUANTIZATION_TRANSFORM;
    outData.appendParameterValue(this._quantizationBits, 'int32');
    for (let i = 0; i < this._minValues.length; i++) {
      outData.appendParameterValue(this._minValues[i], 'float32');
    }
    outData.appendParameterValue(this._range, 'float32');
  }

  // Decodes quantization parameters from the decoder buffer.
  decodeParameters(attribute, decoderBuffer) {
    const numComponents = attribute.numComponents;
    this._minValues = new Array(numComponents);

    // Read min values (float32 per component).
    for (let i = 0; i < numComponents; i++) {
      const val = decoderBuffer.decodeFloat32();
      if (val === undefined) return false;
      this._minValues[i] = val;
    }

    // Read range (float32).
    const range = decoderBuffer.decodeFloat32();
    if (range === undefined) return false;
    this._range = range;

    // Read quantization bits (uint8).
    const qBits = decoderBuffer.decodeUint8();
    if (qBits === undefined) return false;
    if (!AttributeQuantizationTransform._isQuantizationValid(qBits)) {
      return false;
    }
    this._quantizationBits = qBits;
    return true;
  }

  // Inverse transform: dequantizes uint32 values back to float32.
  inverseTransformAttribute(attribute, targetAttribute) {
    if (targetAttribute.dataType !== DataType.FLOAT32) {
      return false;
    }

    const maxQuantizedValue = ((1 << this._quantizationBits) >>> 0) - 1;
    const numComponents = targetAttribute.numComponents;
    const dequantizer = new Dequantizer();
    if (!dequantizer.initFromRange(this._range, maxQuantizedValue)) {
      return false;
    }

    const numValues = targetAttribute.size;
    const total = numValues * numComponents;
    const delta = dequantizer.delta;
    const minValues = this._minValues;

    // The portable (source) attribute holds native-endian int32; the target
    // holds float32. Attribute buffers start at byteOffset 0, so typed-array
    // views are aligned -- read/write through them directly to avoid a
    // per-component DataView dispatch and a per-entry buffer copy.
    const srcAddr = attribute.getAddress(0);
    const srcI32 = new Int32Array(srcAddr.buffer, srcAddr.byteOffset, total);
    const dstAddr = targetAttribute.getAddress(0);
    const dstF32 = new Float32Array(dstAddr.buffer, dstAddr.byteOffset, total);

    let o = 0;
    for (let i = 0; i < numValues; i++) {
      for (let c = 0; c < numComponents; c++) {
        dstF32[o] = srcI32[o] * delta + minValues[c];
        o++;
      }
    }
    return true;
  }

  getTransformedDataType(/* attribute */) {
    return DataType.UINT32;
  }

  getTransformedNumComponents(attribute) {
    return attribute.numComponents;
  }

  get quantizationBits() { return this._quantizationBits; }
  get range() { return this._range; }
  get minValues() { return this._minValues; }
  get isInitialized() { return this._quantizationBits !== -1; }

  minValue(axis) { return this._minValues[axis]; }

  static _isQuantizationValid(quantizationBits) {
    return quantizationBits >= 1 && quantizationBits <= 30;
  }

}

// compression/attributes/SequentialQuantizationAttributeDecoder.js - ported from compression/attributes/sequential_quantization_attribute_decoder.h/cc


// Decoder for attribute values encoded with the
// SequentialQuantizationAttributeEncoder.
class SequentialQuantizationAttributeDecoder extends SequentialIntegerAttributeDecoder {

  constructor() {
    super();
    this._quantizationTransform = new AttributeQuantizationTransform();
  }

  init(decoder, attributeId) {
    if (!super.init(decoder, attributeId)) {
      return false;
    }
    const attribute = decoder.pointCloud().attribute(attributeId);
    // Currently we can quantize only floating point arguments.
    if (attribute.dataType !== DataType.FLOAT32) {
      return false;
    }
    return true;
  }

  decodeIntegerValues(pointIds, buffer) {
    if (this.decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 0) &&
        !this._decodeQuantizedDataInfo()) {
      return false;
    }
    return super.decodeIntegerValues(pointIds, buffer);
  }

  decodeDataNeededByPortableTransform(pointIds, buffer) {
    if (this.decoder.bitstreamVersion() >= DRACO_BITSTREAM_VERSION(2, 0)) {
      // Decode quantization data here only for files with bitstream version 2.0+
      if (!this._decodeQuantizedDataInfo()) {
        return false;
      }
    }

    // Store the decoded transform data in portable attribute.
    return this._quantizationTransform.transferToAttribute(this.portableAttribute);
  }

  // Override: instead of generic integer store, dequantize the values.
  _storeValues(numPoints) {
    return this._dequantizeValues(numPoints);
  }

  _decodeQuantizedDataInfo() {
    // Get attribute used as source for decoding.
    let att = this.getPortableAttribute();
    if (att === null) {
      // This should happen only in the backward compatibility mode.
      att = this.attribute;
    }
    return this._quantizationTransform.decodeParameters(att, this.decoder.buffer());
  }

  _dequantizeValues(numValues) {
    // Convert all quantized values back to floats.
    return this._quantizationTransform.inverseTransformAttribute(
      this.getPortableAttribute(), this.attribute
    );
  }

}

// attributes/AttributeOctahedronTransform.js - ported from attributes/attribute_octahedron_transform.h/cc


// Inline OctahedronToolBox math (ported from normal_compression_utils.h).
// Only the decode-side method QuantizedOctahedralCoordsToUnitVector is needed.
class OctahedronToolBox {

  constructor() {
    this._quantizationBits = -1;
    this._maxQuantizedValue = -1;
    this._maxValue = -1;
    this._dequantizationScale = 1.0;
    this._centerValue = -1;
  }

  setQuantizationBits(q) {
    if (q < 2 || q > 30) {
      return false;
    }
    this._quantizationBits = q;
    this._maxQuantizedValue = ((1 << q) >>> 0) - 1;
    this._maxValue = this._maxQuantizedValue - 1;
    this._dequantizationScale = 2.0 / this._maxValue;
    this._centerValue = (this._maxValue / 2) | 0;
    return true;
  }

  get isInitialized() { return this._quantizationBits !== -1; }
  get quantizationBits() { return this._quantizationBits; }
  get maxQuantizedValue() { return this._maxQuantizedValue; }
  get maxValue() { return this._maxValue; }
  get centerValue() { return this._centerValue; }

  // Converts quantized octahedral coordinates to a unit vector.
  quantizedOctahedralCoordsToUnitVector(inS, inT, outVector) {
    this._octahedralCoordsToUnitVector(
      inS * this._dequantizationScale - 1.0,
      inT * this._dequantizationScale - 1.0,
      outVector
    );
  }

  _octahedralCoordsToUnitVector(inSScaled, inTScaled, outVector) {
    let y = inSScaled;
    let z = inTScaled;

    // Remaining coordinate can be computed by projecting (y, z) onto the
    // surface of the octahedron.
    const x = 1.0 - Math.abs(y) - Math.abs(z);

    // x is a signed distance from the diagonal edges of the diamond.
    // Positive => right hemisphere, negative => left hemisphere.
    let xOffset = -x;
    if (xOffset < 0) xOffset = 0;

    // Mirror (y, z) along nearest diagonal edge for points on left hemisphere.
    y += y < 0 ? xOffset : -xOffset;
    z += z < 0 ? xOffset : -xOffset;

    // Normalize the computed vector.
    const normSquared = x * x + y * y + z * z;
    if (normSquared < 1e-6) {
      outVector[0] = 0;
      outVector[1] = 0;
      outVector[2] = 0;
    } else {
      const d = 1.0 / Math.sqrt(normSquared);
      outVector[0] = x * d;
      outVector[1] = y * d;
      outVector[2] = z * d;
    }
  }

}

class AttributeOctahedronTransform extends AttributeTransform {

  constructor() {
    super();
    this._quantizationBits = -1;
  }

  type() {
    return AttributeTransformType.OCTAHEDRON_TRANSFORM;
  }

  // Try to init transform from attribute's existing transform data.
  initFromAttribute(attribute) {
    const transformData = attribute.getAttributeTransformData();
    if (!transformData || transformData.transformType !== AttributeTransformType.OCTAHEDRON_TRANSFORM) {
      return false;
    }
    this._quantizationBits = transformData.getParameterValue(0, 'int32');
    return true;
  }

  // Copy parameter values into the provided AttributeTransformData instance.
  copyToAttributeTransformData(outData) {
    outData.transformType = AttributeTransformType.OCTAHEDRON_TRANSFORM;
    outData.appendParameterValue(this._quantizationBits, 'int32');
  }

  // Decodes quantization bits from the decoder buffer.
  decodeParameters(attribute, decoderBuffer) {
    const qBits = decoderBuffer.decodeUint8();
    if (qBits === undefined) return false;
    this._quantizationBits = qBits;
    return true;
  }

  // Inverse transform: converts octahedral coordinates to unit vectors (float32).
  inverseTransformAttribute(attribute, targetAttribute) {
    if (targetAttribute.dataType !== DataType.FLOAT32) {
      return false;
    }

    const numPoints = targetAttribute.size;
    const numComponents = targetAttribute.numComponents;
    if (numComponents !== 3) {
      return false;
    }

    const toolBox = new OctahedronToolBox();
    if (!toolBox.setQuantizationBits(this._quantizationBits)) {
      return false;
    }

    // Source holds native-endian int32 octahedral coords (2 per point); target
    // holds float32 unit vectors (3 per point). Attribute buffers start at
    // byteOffset 0, so typed-array views are aligned -- read/write directly,
    // avoiding a per-point DataView dispatch and per-entry buffer copy.
    const srcAddr = attribute.getAddress(0);
    const srcI32 = new Int32Array(srcAddr.buffer, srcAddr.byteOffset, numPoints * 2);
    const dstAddr = targetAttribute.getAddress(0);
    const dstF32 = new Float32Array(dstAddr.buffer, dstAddr.byteOffset, numPoints * 3);

    const outVec = this._tmpVec || (this._tmpVec = new Float32Array(3));
    let si = 0;
    let di = 0;
    for (let i = 0; i < numPoints; i++) {
      toolBox.quantizedOctahedralCoordsToUnitVector(srcI32[si], srcI32[si + 1], outVec);
      si += 2;
      dstF32[di] = outVec[0];
      dstF32[di + 1] = outVec[1];
      dstF32[di + 2] = outVec[2];
      di += 3;
    }
    return true;
  }

  getTransformedDataType(/* attribute */) {
    return DataType.UINT32;
  }

  getTransformedNumComponents(/* attribute */) {
    return 2;
  }

  get quantizationBits() { return this._quantizationBits; }
  get isInitialized() { return this._quantizationBits !== -1; }

}

// src/compression/attributes/prediction_schemes/PredictionSchemeNormalOctahedronCanonicalizedDecodingTransform.js
// Ported from draco/compression/attributes/prediction_schemes/prediction_scheme_normal_octahedron_canonicalized_decoding_transform.h


/**
 * Decodes correction values that were transformed using the canonicalized
 * octahedral normal transform back to original values.
 */
class PredictionSchemeNormalOctahedronCanonicalizedDecodingTransform {

  constructor() {
    this._octahedronToolBox = new OctahedronToolBox$1();
    // Reusable scratch for invertDiamond (per-normal hot path).
    this._scratch = [0, 0];
  }

  /**
   * @returns {number}
   */
  getType() {
    return PredictionSchemeTransformType.PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON_CANONICALIZED;
  }

  /**
   * @returns {boolean}
   */
  areCorrectionsPositive() {
    return true;
  }

  /**
   * Dummy init to fulfill interface.
   * @param {number} numComponents
   */
  init(numComponents) {}

  /**
   * @returns {number}
   */
  quantizationBits() {
    return this._octahedronToolBox.quantizationBits();
  }

  /**
   * @returns {number}
   */
  maxQuantizedValue() {
    return this._octahedronToolBox.maxQuantizedValue();
  }

  /**
   * @returns {number}
   */
  centerValue() {
    return this._octahedronToolBox.centerValue();
  }

  /**
   * Decodes the transform data from the buffer.
   * @param {DecoderBuffer} buffer
   * @returns {boolean}
   */
  decodeTransformData(buffer) {
    const maxQuantizedValue = buffer.decodeInt32();
    if (maxQuantizedValue === undefined) return false;
    // center_value is read but ignored.
    const centerValue = buffer.decodeInt32();
    if (centerValue === undefined) return false;

    if (!this._setMaxQuantizedValue(maxQuantizedValue)) return false;

    if (this._octahedronToolBox.quantizationBits() < 2) return false;
    if (this._octahedronToolBox.quantizationBits() > 30) return false;

    return true;
  }

  /**
   * Computes the original value from predicted and correction values.
   * @param {Int32Array|TypedArray} predVals
   * @param {number} predOffset
   * @param {Int32Array|TypedArray} corrVals
   * @param {number} corrOffset
   * @param {Int32Array|TypedArray} outOrigVals
   * @param {number} outOffset
   */
  computeOriginalValue(predVals, predOffset, corrVals, corrOffset,
    outOrigVals, outOffset) {
    // Hoist the toolbox bounds into locals and inline isInDiamond / modMax
    // (both tiny and called per normal) to avoid the per-normal method dispatch.
    const toolBox = this._octahedronToolBox;
    const center = toolBox._centerValue;
    const maxQuantizedValue = toolBox._maxQuantizedValue;
    const corrS = corrVals[corrOffset];
    const corrT = corrVals[corrOffset + 1];

    let predS = predVals[predOffset] - center;
    let predT = predVals[predOffset + 1] - center;

    const scratch = this._scratch;
    const predIsInDiamond =
      (Math.abs(predS) + Math.abs(predT)) <= center;
    if (!predIsInDiamond) {
      toolBox.invertDiamond(predS, predT, scratch);
      predS = scratch[0];
      predT = scratch[1];
    }

    const predIsInBottomLeft = this._isInBottomLeft(predS, predT);
    const rotationCount = this._getRotationCount(predS, predT);

    if (!predIsInBottomLeft) {
      // Inline _rotatePoint to avoid a per-normal array allocation.
      const s = predS, t = predT;
      switch (rotationCount) {
        case 1: predS = t; predT = -s; break;
        case 2: predS = -s; predT = -t; break;
        case 3: predS = -t; predT = s; break;
      }
    }

    // Unsigned addition to avoid signed overflow, then modMax (inlined).
    let origS = (predS + corrS) | 0;
    if (origS > center) origS -= maxQuantizedValue;
    else if (origS < -center) origS += maxQuantizedValue;
    let origT = (predT + corrT) | 0;
    if (origT > center) origT -= maxQuantizedValue;
    else if (origT < -center) origT += maxQuantizedValue;

    if (!predIsInBottomLeft) {
      const s = origS, t = origT;
      switch ((4 - rotationCount) % 4) {
        case 1: origS = t; origT = -s; break;
        case 2: origS = -s; origT = -t; break;
        case 3: origS = -t; origT = s; break;
      }
    }

    if (!predIsInDiamond) {
      this._octahedronToolBox.invertDiamond(origS, origT, scratch);
      origS = scratch[0];
      origT = scratch[1];
    }

    outOrigVals[outOffset] = origS + center;
    outOrigVals[outOffset + 1] = origT + center;
  }

  /**
   * Checks if a point is in the bottom-left quadrant.
   * @private
   * @param {number} s
   * @param {number} t
   * @returns {boolean}
   */
  _isInBottomLeft(s, t) {
    if (s === 0 && t === 0) return true;
    return (s < 0 && t <= 0);
  }

  /**
   * Computes the rotation count for canonicalization.
   * @private
   * @param {number} signX
   * @param {number} signY
   * @returns {number}
   */
  _getRotationCount(signX, signY) {
    if (signX === 0) {
      if (signY === 0) return 0;
      if (signY > 0) return 3;
      return 1;
    }
    if (signX > 0) {
      if (signY >= 0) return 2;
      return 1;
    }
    // signX < 0
    if (signY <= 0) return 0;
    return 3;
  }

  /**
   * @private
   * @param {number} maxQuantizedValue
   * @returns {boolean}
   */
  _setMaxQuantizedValue(maxQuantizedValue) {
    if (maxQuantizedValue % 2 === 0) return false;
    let q = 0;
    let v = maxQuantizedValue;
    while (v > 0) {
      v >>>= 1;
      q++;
    }
    return this._octahedronToolBox.setQuantizationBits(q);
  }

}

// src/compression/attributes/prediction_schemes/PredictionSchemeNormalOctahedronDecodingTransform.js
// Ported from draco/compression/attributes/prediction_schemes/prediction_scheme_normal_octahedron_decoding_transform.h


/**
 * Decodes correction values that were transformed using the octahedral normal
 * transform back to original values. Used for backwards compatibility.
 */
class PredictionSchemeNormalOctahedronDecodingTransform {

  constructor() {
    this._octahedronToolBox = new OctahedronToolBox$1();
    // Reusable scratch for invertDiamond (per-normal hot path).
    this._scratch = [0, 0];
  }

  /**
   * @returns {number}
   */
  getType() {
    return PredictionSchemeTransformType.PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON;
  }

  /**
   * @returns {boolean}
   */
  areCorrectionsPositive() {
    return true;
  }

  /**
   * Dummy init to fulfill interface.
   * @param {number} numComponents
   */
  init(numComponents) {}

  /**
   * @returns {number}
   */
  quantizationBits() {
    return this._octahedronToolBox.quantizationBits();
  }

  /**
   * @returns {number}
   */
  maxQuantizedValue() {
    return this._octahedronToolBox.maxQuantizedValue();
  }

  /**
   * @returns {number}
   */
  centerValue() {
    return this._octahedronToolBox.centerValue();
  }

  /**
   * Decodes the max quantized value from the buffer.
   * @param {DecoderBuffer} buffer
   * @returns {boolean}
   */
  decodeTransformData(buffer) {
    const maxQuantizedValue = buffer.decodeInt32();
    if (maxQuantizedValue === undefined) return false;

    if (buffer.bitstreamVersion < 0x0202) { // DRACO_BITSTREAM_VERSION(2, 2)
      // center_value is read but ignored.
      const centerValue = buffer.decodeInt32();
      if (centerValue === undefined) return false;
    }

    return this._setMaxQuantizedValue(maxQuantizedValue);
  }

  /**
   * Computes the original value from predicted and correction values.
   * @param {Int32Array|TypedArray} predVals
   * @param {number} predOffset
   * @param {Int32Array|TypedArray} corrVals
   * @param {number} corrOffset
   * @param {Int32Array|TypedArray} outOrigVals
   * @param {number} outOffset
   */
  computeOriginalValue(predVals, predOffset, corrVals, corrOffset,
    outOrigVals, outOffset) {
    const center = this._octahedronToolBox.centerValue();

    const predS = predVals[predOffset] - center;
    const predT = predVals[predOffset + 1] - center;
    const corrS = corrVals[corrOffset];
    const corrT = corrVals[corrOffset + 1];

    const predIsInDiamond = this._octahedronToolBox.isInDiamond(predS, predT);

    let ps = predS;
    let pt = predT;
    const scratch = this._scratch;
    if (!predIsInDiamond) {
      this._octahedronToolBox.invertDiamond(ps, pt, scratch);
      ps = scratch[0];
      pt = scratch[1];
    }

    // Unsigned addition to avoid signed overflow.
    let origS = (ps + corrS) | 0;
    let origT = (pt + corrT) | 0;

    origS = this._octahedronToolBox.modMax(origS);
    origT = this._octahedronToolBox.modMax(origT);

    if (!predIsInDiamond) {
      this._octahedronToolBox.invertDiamond(origS, origT, scratch);
      origS = scratch[0];
      origT = scratch[1];
    }

    origS = (origS + center) | 0;
    origT = (origT + center) | 0;

    outOrigVals[outOffset] = origS;
    outOrigVals[outOffset + 1] = origT;
  }

  /**
   * @private
   * @param {number} maxQuantizedValue
   * @returns {boolean}
   */
  _setMaxQuantizedValue(maxQuantizedValue) {
    if (maxQuantizedValue % 2 === 0) return false;
    let q = 0;
    let v = maxQuantizedValue;
    while (v > 0) {
      v >>>= 1;
      q++;
    }
    return this._octahedronToolBox.setQuantizationBits(q);
  }

}

// compression/attributes/SequentialNormalAttributeDecoder.js - ported from compression/attributes/sequential_normal_attribute_decoder.h/cc


// Decoder for attributes encoded with SequentialNormalAttributeEncoder.
class SequentialNormalAttributeDecoder extends SequentialIntegerAttributeDecoder {

  constructor() {
    super();
    this._octahedralTransform = new AttributeOctahedronTransform();
  }

  init(decoder, attributeId) {
    if (!super.init(decoder, attributeId)) {
      return false;
    }
    // Currently, this decoder works only for 3-component normal vectors.
    if (this.attribute.numComponents !== 3) {
      return false;
    }
    // Also the data type must be DT_FLOAT32.
    if (this.attribute.dataType !== DataType.FLOAT32) {
      return false;
    }
    return true;
  }

  // We quantize everything into two components.
  getNumValueComponents() {
    return 2;
  }

  decodeIntegerValues(pointIds, buffer) {
    if (this.decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 0)) {
      // Note: in older bitstreams, we do not have a portableAttribute decoded
      // at this stage so we cannot pass it down to the decodeParameters() call.
      if (!this._octahedralTransform.decodeParameters(this.attribute, buffer)) {
        return false;
      }
    }
    return super.decodeIntegerValues(pointIds, buffer);
  }

  decodeDataNeededByPortableTransform(pointIds, buffer) {
    if (this.decoder.bitstreamVersion() >= DRACO_BITSTREAM_VERSION(2, 0)) {
      // For newer file version, decode attribute transform data here.
      if (!this._octahedralTransform.decodeParameters(
            this.getPortableAttribute(), buffer)) {
        return false;
      }
    }

    // Store the decoded transform data in portable attribute.
    return this._octahedralTransform.transferToAttribute(this.portableAttribute);
  }

  // Override: convert quantized values back to float normals.
  _storeValues(numPoints) {
    return this._octahedralTransform.inverseTransformAttribute(
      this.getPortableAttribute(), this.attribute
    );
  }

  // Override: create prediction scheme for normal octahedral transforms.
  createIntPredictionScheme(method, transformType) {
    switch (transformType) {
      case PredictionSchemeTransformType.PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON: {
        const transform = new PredictionSchemeNormalOctahedronDecodingTransform();
        return createPredictionSchemeForDecoder(
          method, this.attributeId, this.decoder, transform
        );
      }
      case PredictionSchemeTransformType.PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON_CANONICALIZED: {
        const transform = new PredictionSchemeNormalOctahedronCanonicalizedDecodingTransform();
        return createPredictionSchemeForDecoder(
          method, this.attributeId, this.decoder, transform
        );
      }
      default:
        return null;
    }
  }

}

// compression/attributes/SequentialAttributeDecodersController.js - ported from compression/attributes/sequential_attribute_decoders_controller.h/cc


// A basic implementation of an attribute decoder that decodes data encoded by
// the SequentialAttributeEncodersController class. Creates a single
// SequentialAttributeDecoder for each of the decoded attributes, where the
// type of the decoder is determined by the unique identifier encoded by the encoder.
class SequentialAttributeDecodersController extends AttributesDecoder {

  constructor(sequencer) {
    super();
    this._sequentialDecoders = [];
    this._pointIds = [];
    this._sequencer = sequencer;
  }

  decodeAttributesDecoderData(buffer) {
    if (!super.decodeAttributesDecoderData(buffer)) {
      return false;
    }
    // Decode unique ids of all sequential encoders and create them.
    const numAttributes = this.getNumAttributes();
    this._sequentialDecoders.length = numAttributes;
    for (let i = 0; i < numAttributes; i++) {
      const decoderType = buffer.decodeUint8();
      if (decoderType === undefined) return false;

      // Create the decoder from the id.
      this._sequentialDecoders[i] = this.createSequentialDecoder(decoderType);
      if (!this._sequentialDecoders[i]) {
        return false;
      }
      if (!this._sequentialDecoders[i].init(this.getDecoder(), this.getAttributeId(i))) {
        return false;
      }
    }
    return true;
  }

  decodeAttributes(buffer) {
    if (!this._sequencer) {
      return false;
    }
    if (!this._sequencer.generateSequence(this._pointIds)) {
      return false;
    }
    this._pointIds = this._sequencer.getOutputPointIds();

    const numAttributes = this.getNumAttributes();
    for (let i = 0; i < numAttributes; i++) {
      const pa = this.getDecoder().pointCloud().attribute(this.getAttributeId(i));
      if (!this._sequencer.updatePointToAttributeIndexMapping(pa)) {
        return false;
      }
    }
    return super.decodeAttributes(buffer);
  }

  getPortableAttribute(pointAttributeId) {
    const locId = this.getLocalIdForPointAttribute(pointAttributeId);
    if (locId < 0) {
      return null;
    }
    return this._sequentialDecoders[locId].getPortableAttribute();
  }

  decodePortableAttributes(buffer) {
    const numAttributes = this.getNumAttributes();
    for (let i = 0; i < numAttributes; i++) {
      if (!this._sequentialDecoders[i].decodePortableAttribute(
            this._pointIds, buffer)) {
        return false;
      }
    }
    return true;
  }

  decodeDataNeededByPortableTransforms(buffer) {
    const numAttributes = this.getNumAttributes();
    for (let i = 0; i < numAttributes; i++) {
      if (!this._sequentialDecoders[i].decodeDataNeededByPortableTransform(
            this._pointIds, buffer)) {
        return false;
      }
    }
    return true;
  }

  transformAttributesToOriginalFormat() {
    const numAttributes = this.getNumAttributes();
    for (let i = 0; i < numAttributes; i++) {
      // Check whether the attribute transform should be skipped.
      if (this.getDecoder().options()) {
        const attribute = this._sequentialDecoders[i].attribute;
        const portableAttribute = this._sequentialDecoders[i].getPortableAttribute();
        if (portableAttribute &&
            this.getDecoder().options().getAttributeBool(
              attribute.attributeType, 'skip_attribute_transform', false)) {
          // Attribute transform should not be performed. In this case, we replace
          // the output geometry attribute with the portable attribute.
          this._sequentialDecoders[i].attribute.copyFrom(portableAttribute);
          continue;
        }
      }
      if (!this._sequentialDecoders[i].transformAttributeToOriginalFormat(
            this._pointIds)) {
        return false;
      }
    }
    return true;
  }

  createSequentialDecoder(decoderType) {
    switch (decoderType) {
      case SequentialAttributeEncoderType.SEQUENTIAL_ATTRIBUTE_ENCODER_GENERIC:
        return new SequentialAttributeDecoder();

      case SequentialAttributeEncoderType.SEQUENTIAL_ATTRIBUTE_ENCODER_INTEGER:
        return new SequentialIntegerAttributeDecoder();

      case SequentialAttributeEncoderType.SEQUENTIAL_ATTRIBUTE_ENCODER_QUANTIZATION:
        return new SequentialQuantizationAttributeDecoder();

      case SequentialAttributeEncoderType.SEQUENTIAL_ATTRIBUTE_ENCODER_NORMALS:
        return new SequentialNormalAttributeDecoder();
    }
    // Unknown or unsupported decoder type.
    return null;
  }

}

// compression/mesh/traverser/DepthFirstTraverser.js
// Ported from compression/mesh/traverser/depth_first_traverser.h

const kInvalidCornerIndex$2 = -1;
const kInvalidFaceIndex = -1;
const kInvalidVertexIndex$1 = -1;

// Basic traverser that traverses a mesh in a DFS like fashion using the
// CornerTable data structure.
class DepthFirstTraverser {

  constructor() {
    this._cornerTable = null;
    this._observer = null;
    this._isFaceVisited = null;
    this._isVertexVisited = null;
    this._cornerTraversalStack = [];
  }

  init(cornerTable, observer) {
    this._cornerTable = cornerTable;
    this._observer = observer;
    // Uint8Array (0/1) instead of Array(bool): these flags are read and written
    // on every corner of the hottest decode loop (traverseFromCorner).
    this._isFaceVisited = new Uint8Array(cornerTable.numFaces());
    this._isVertexVisited = new Uint8Array(cornerTable.numVertices());
    // Extract the corner table's connectivity as flat arrays once, so the
    // traversal reads them directly (via the monomorphic _* helpers below)
    // instead of dispatching through the corner table on every corner. The
    // corner table is one of two classes, so direct ct.vertex()/opposite()
    // calls in the hot loop are polymorphic and not inlined by the JIT.
    this._cornerToVertex = cornerTable.cornerToVertexArray();
    this._oppositeCorners = cornerTable.oppositeCornerArray();
    this._vertexLeftmost = cornerTable.vertexLeftmostCornerArray();
    this._numCorners = cornerTable.numCorners();
  }

  cornerTable() {
    return this._cornerTable;
  }

  // Connectivity accessors operating on the extracted flat arrays. They mirror
  // the corner table's methods exactly but are monomorphic (the receiver is
  // always this traverser and the arrays are always typed), so the JIT inlines
  // them. next/previous are only ever called with a valid (>= 0) corner here.
  _next(c) {
    const r = c - ((c / 3) | 0) * 3;
    return r === 2 ? c - 2 : c + 1;
  }
  _previous(c) {
    const r = c - ((c / 3) | 0) * 3;
    return r === 0 ? c + 2 : c - 1;
  }
  _vertex(c) {
    return (c < 0 || c >= this._numCorners) ? -1 : this._cornerToVertex[c];
  }
  _getRightCorner(c) {
    return c < 0 ? -1 : this._oppositeCorners[this._next(c)];
  }
  _getLeftCorner(c) {
    return c < 0 ? -1 : this._oppositeCorners[this._previous(c)];
  }
  _isOnBoundary(v) {
    const lc = this._vertexLeftmost[v];
    if (lc === undefined || lc < 0) return true;
    // swingLeft(lc) is invalid iff the opposite across next(lc) is invalid.
    return this._oppositeCorners[this._next(lc)] < 0;
  }

  onTraversalStart() {}
  onTraversalEnd() {}

  traverseFromCorner(cornerId) {
    if (this._isFaceVisited[(cornerId / 3) | 0]) {
      return true; // Already traversed.
    }

    this._cornerTraversalStack.length = 0;
    this._cornerTraversalStack.push(cornerId);

    // For the first face, check the remaining corners as they may not be
    // processed yet.
    const nextCorner = this._next(cornerId);
    const prevCorner = this._previous(cornerId);
    const nextVert = this._vertex(nextCorner);
    const prevVert = this._vertex(prevCorner);
    if (nextVert === kInvalidVertexIndex$1 || prevVert === kInvalidVertexIndex$1) {
      return false;
    }
    if (!this._isVertexVisited[nextVert]) {
      this._isVertexVisited[nextVert] = true;
      this._observer.onNewVertexVisited(nextVert, nextCorner);
    }
    if (!this._isVertexVisited[prevVert]) {
      this._isVertexVisited[prevVert] = true;
      this._observer.onNewVertexVisited(prevVert, prevCorner);
    }

    // Start the actual traversal.
    while (this._cornerTraversalStack.length > 0) {
      cornerId = this._cornerTraversalStack[this._cornerTraversalStack.length - 1];
      let faceId = (cornerId / 3) | 0;

      // Make sure the face hasn't been visited yet.
      if (cornerId === kInvalidCornerIndex$2 || this._isFaceVisited[faceId]) {
        this._cornerTraversalStack.pop();
        continue;
      }

      while (true) {
        this._isFaceVisited[faceId] = true;
        this._observer.onNewFaceVisited(faceId);

        const vertId = this._vertex(cornerId);
        if (vertId === kInvalidVertexIndex$1) {
          return false;
        }
        if (!this._isVertexVisited[vertId]) {
          const onBoundary = this._isOnBoundary(vertId);
          this._isVertexVisited[vertId] = true;
          this._observer.onNewVertexVisited(vertId, cornerId);
          if (!onBoundary) {
            cornerId = this._getRightCorner(cornerId);
            faceId = (cornerId / 3) | 0;
            continue;
          }
        }

        // The current vertex has been already visited or it was on a boundary.
        const rightCornerId = this._getRightCorner(cornerId);
        const leftCornerId = this._getLeftCorner(cornerId);
        const rightFaceId = rightCornerId === kInvalidCornerIndex$2
          ? kInvalidFaceIndex : (rightCornerId / 3) | 0;
        const leftFaceId = leftCornerId === kInvalidCornerIndex$2
          ? kInvalidFaceIndex : (leftCornerId / 3) | 0;

        const isRightVisited = rightFaceId === kInvalidFaceIndex ||
          this._isFaceVisited[rightFaceId];
        const isLeftVisited = leftFaceId === kInvalidFaceIndex ||
          this._isFaceVisited[leftFaceId];

        if (isRightVisited) {
          if (isLeftVisited) {
            // Both neighboring faces are visited. End reached.
            this._cornerTraversalStack.pop();
            break;
          } else {
            // Go to the left face.
            cornerId = leftCornerId;
            faceId = leftFaceId;
          }
        } else {
          if (isLeftVisited) {
            // Left face visited, go to the right one.
            cornerId = rightCornerId;
            faceId = rightFaceId;
          } else {
            // Both neighboring faces are unvisited, split the traversal.
            this._cornerTraversalStack[this._cornerTraversalStack.length - 1] = leftCornerId;
            this._cornerTraversalStack.push(rightCornerId);
            break;
          }
        }
      }
    }
    return true;
  }

}

// compression/mesh/traverser/MeshTraversalSequencer.js
// Ported from compression/mesh/traverser/mesh_traversal_sequencer.h

// Sequencer that generates point sequence in an order given by a deterministic
// traversal on the mesh surface.
class MeshTraversalSequencer {

  constructor(mesh, encodingData, traversalCache = null) {
    this._mesh = mesh;
    this._encodingData = encodingData;
    this._traverser = null;
    this._outPointIds = [];
    // Optional per-decode cache, keyed by corner table, shared across the
    // attribute decoders of one mesh (see MeshEdgebreakerDecoderImpl).
    this._traversalCache = traversalCache;
  }

  setTraverser(traverser) {
    this._traverser = traverser;
  }

  // Called by SequentialAttributeDecodersController.
  generateSequence(/* outPointIds */) {
    // A traversal's output (point order + encoding maps) depends only on the
    // corner table's connectivity, not on the attribute being decoded. Meshes
    // with several vertex-mapped attributes share one corner table, so reuse a
    // previously computed result instead of repeating the O(faces) traversal.
    const cornerTable = this._traverser.cornerTable();
    if (this._traversalCache) {
      const cached = this._traversalCache.get(cornerTable);
      if (cached !== undefined) {
        this._outPointIds = cached.pointIds;
        this._encodingData.adoptTraversalResult(
          cached.vertexMap, cached.cornerMap, cached.numValues);
        return true;
      }
    }

    this._outPointIds = [];
    if (!this._generateSequenceInternal()) {
      return false;
    }

    if (this._traversalCache) {
      this._traversalCache.set(cornerTable, {
        pointIds: this._outPointIds,
        vertexMap: this._encodingData.vertexToEncodedAttributeValueIndexMap,
        cornerMap: this._encodingData.encodedAttributeValueIndexToCornerMap,
        numValues: this._encodingData.numValues,
      });
    }
    return true;
  }

  getOutputPointIds() {
    return this._outPointIds;
  }

  addPointId(pointId) {
    this._outPointIds.push(pointId);
  }

  updatePointToAttributeIndexMapping(attribute) {
    const cornerTable = this._traverser.cornerTable();
    const numFaces = this._mesh.numFaces();
    const numPoints = this._mesh.numPoints();
    attribute.setExplicitMapping(numPoints);
    // Iterate corners directly over the flat connectivity arrays: the corner
    // table is one of two classes, so vertex()/faceVertex()/setPointMapEntry()
    // would all be polymorphic per corner. faces_[ci] is the corner's point id
    // and cornerToVertex[ci] its vertex; write straight into the indices map.
    const numCorners = numFaces * 3;
    const faces = this._mesh.faces_;
    const cornerToVertex = cornerTable.cornerToVertexArray();
    const vertexToAttEntry =
      this._encodingData.vertexToEncodedAttributeValueIndexMap;
    const indicesMap = attribute.indicesMap;
    for (let ci = 0; ci < numCorners; ++ci) {
      const vertId = cornerToVertex[ci];
      if (vertId < 0) {
        return false;
      }
      const attEntryId = vertexToAttEntry[vertId];
      const pointId = faces[ci];
      if (pointId >= numPoints || attEntryId >= numPoints) {
        return false;
      }
      indicesMap[pointId] = attEntryId;
    }
    return true;
  }

  _generateSequenceInternal() {
    // Preallocate.
    this._outPointIds.length = 0;

    this._traverser.onTraversalStart();
    const numFaces = this._traverser.cornerTable().numFaces();
    for (let i = 0; i < numFaces; ++i) {
      if (!this._traverser.traverseFromCorner(3 * i)) {
        return false;
      }
    }
    this._traverser.onTraversalEnd();
    return true;
  }

}

// compression/mesh/traverser/MeshAttributeIndicesEncodingObserver.js
// Ported from compression/mesh/traverser/mesh_attribute_indices_encoding_observer.h

// Observer that records vertex visit order during mesh traversal.
// Used to generate encoding/decoding order for attribute values.
class MeshAttributeIndicesEncodingObserver {

  constructor(attConnectivity, mesh, sequencer, encodingData) {
    this._attConnectivity = attConnectivity;
    this._encodingData = encodingData;
    this._mesh = mesh;
    this._sequencer = sequencer;
  }

  onNewFaceVisited(/* face */) {}

  onNewVertexVisited(vertex, corner) {
    const faceIndex = (corner / 3) | 0;
    const localIndex = corner - faceIndex * 3;
    const pointId = this._mesh.faceVertex(faceIndex, localIndex);
    // Append the visited attribute to the encoding order.
    this._sequencer.addPointId(pointId);

    // Keep track of visited corners.
    this._encodingData.encodedAttributeValueIndexToCornerMap.push(corner);

    this._encodingData.vertexToEncodedAttributeValueIndexMap[vertex] =
      this._encodingData.numValues;

    this._encodingData.numValues++;
  }

}

// mesh/MeshAttributeCornerTable.js - ported from mesh/mesh_attribute_corner_table.h/cc


const kInvalidCornerIndex$1 = -1;
const kInvalidVertexIndex = -1;

class MeshAttributeCornerTable {

  constructor() {

    this.is_edge_on_seam_ = [];
    this.is_vertex_on_seam_ = [];
    this.no_interior_seams_ = true;
    this.corner_to_vertex_map_ = [];
    this.vertex_to_left_most_corner_map_ = [];
    this.vertex_to_attribute_entry_id_map_ = [];
    this.corner_table_ = null;
    this.valence_cache_ = new ValenceCache(this);

  }

  initEmpty(table) {

    if (table === null) {
      return false;
    }

    this.valence_cache_.clearValenceCache();
    this.valence_cache_.clearValenceCacheInaccurate();

    // Typed arrays keep the hot accessors (isEdgeOnSeam/vertex/opposite, called
    // per corner during attribute connectivity recompute) monomorphic. Uint8Array
    // defaults to 0 (== false); corner_to_vertex_map_ uses signed -1 sentinel.
    this.is_edge_on_seam_ = new Uint8Array(table.numCorners());
    this.is_vertex_on_seam_ = new Uint8Array(table.numVertices());
    this.corner_to_vertex_map_ = new Int32Array(table.numCorners()).fill(kInvalidVertexIndex);
    this.vertex_to_attribute_entry_id_map_ = [];
    this.vertex_to_left_most_corner_map_ = [];
    // Lazily built seam-aware opposite array (see oppositeCornerArray).
    this._effectiveOpposite = null;
    this.corner_table_ = table;
    this.no_interior_seams_ = true;
    return true;

  }

  initFromAttribute(mesh, table, att) {

    if (!this.initEmpty(table)) {
      return false;
    }

    this.valence_cache_.clearValenceCache();
    this.valence_cache_.clearValenceCacheInaccurate();

    for (let c = 0; c < this.corner_table_.numCorners(); ++c) {

      const f = this.corner_table_.face(c);
      if (this.corner_table_.isDegenerated(f)) {
        continue;
      }

      const oppCorner = this.corner_table_.opposite(c);
      if (oppCorner === kInvalidCornerIndex$1) {

        // Boundary. Mark as seam edge.
        this.is_edge_on_seam_[c] = true;
        let v;
        v = this.corner_table_.vertex(this.corner_table_.next(c));
        this.is_vertex_on_seam_[v] = true;
        v = this.corner_table_.vertex(this.corner_table_.previous(c));
        this.is_vertex_on_seam_[v] = true;
        continue;

      }

      if (oppCorner < c) {
        continue; // Already processed.
      }

      let actC = c;
      let actSiblingC = oppCorner;

      for (let i = 0; i < 2; ++i) {

        actC = this.corner_table_.next(actC);
        actSiblingC = this.corner_table_.previous(actSiblingC);

        const pointId = mesh.cornerToPointId(actC);
        const siblingPointId = mesh.cornerToPointId(actSiblingC);

        if (att.mappedIndex(pointId) !== att.mappedIndex(siblingPointId)) {

          this.no_interior_seams_ = false;
          this.is_edge_on_seam_[c] = true;
          this.is_edge_on_seam_[oppCorner] = true;

          this.is_vertex_on_seam_[this.corner_table_.vertex(this.corner_table_.next(c))] = true;
          this.is_vertex_on_seam_[this.corner_table_.vertex(this.corner_table_.previous(c))] = true;
          this.is_vertex_on_seam_[this.corner_table_.vertex(this.corner_table_.next(oppCorner))] = true;
          this.is_vertex_on_seam_[this.corner_table_.vertex(this.corner_table_.previous(oppCorner))] = true;
          break;

        }

      }

    }

    this.recomputeVertices(mesh, att);
    return true;

  }

  addSeamEdge(c) {

    const cornerToVertex = this.corner_table_.cornerToVertexArray();
    const oppositeCorners = this.corner_table_.oppositeCornerArray();
    const isEdge = this.is_edge_on_seam_;
    const isVert = this.is_vertex_on_seam_;

    isEdge[c] = 1;
    // Inlined next(c)/previous(c).
    let rem = c - ((c / 3) | 0) * 3;
    isVert[cornerToVertex[rem === 2 ? c - 2 : c + 1]] = 1;
    isVert[cornerToVertex[rem === 0 ? c + 2 : c - 1]] = 1;

    const oppCorner = oppositeCorners[c];
    if (oppCorner !== kInvalidCornerIndex$1) {

      this.no_interior_seams_ = false;
      isEdge[oppCorner] = 1;
      rem = oppCorner - ((oppCorner / 3) | 0) * 3;
      isVert[cornerToVertex[rem === 2 ? oppCorner - 2 : oppCorner + 1]] = 1;
      isVert[cornerToVertex[rem === 0 ? oppCorner + 2 : oppCorner - 1]] = 1;

    }

  }

  recomputeVertices(mesh, att) {

    if (mesh !== null && mesh !== undefined && att !== null && att !== undefined) {
      return this._recomputeVerticesInternal(true, mesh, att);
    } else {
      return this._recomputeVerticesInternal(false, null, null);
    }

  }

  _recomputeVerticesInternal(initVertexToAttributeEntryMap, mesh, att) {

    const ct = this.corner_table_;
    const numCorners = ct.numCorners();
    const numBaseVertices = ct.numVertices();
    // Each corner maps to exactly one attribute entry, so the number of new
    // (attribute) vertices is bounded by the corner count. Preallocate the two
    // maps as Int32Arrays indexed by new-vertex id (the push order equals the
    // numNewVertices counter), avoiding per-entry Array.push() growth + GC.
    const attEntryMap = new Int32Array(numCorners);
    const leftMostMap = new Int32Array(numCorners);
    const cornerToVertex = this.corner_to_vertex_map_;
    const isVertexOnSeam = this.is_vertex_on_seam_;
    const isEdgeOnSeam = this.is_edge_on_seam_;
    // Flat connectivity arrays so the per-corner swing operations are inlined
    // typed-array arithmetic instead of polymorphic method dispatch.
    //   - seamOpp: seam-aware opposite (== this.opposite), used by swingLeft.
    //   - baseOpp: raw opposite of the underlying table, used by swingRight
    //     (matches corner_table_.swingRight, which is NOT seam-aware here).
    // Both are final: all seams were added before recomputeVertices() runs.
    const seamOpp = this.oppositeCornerArray();
    const baseOpp = ct.oppositeCornerArray();
    const vertexLeftmost = ct.vertexLeftmostCornerArray();
    let numNewVertices = 0;

    for (let v = 0; v < numBaseVertices; ++v) {

      const c = vertexLeftmost[v];
      if (c === kInvalidCornerIndex$1) {
        continue; // Isolated vertex.
      }

      let firstVertId = numNewVertices++;
      if (initVertexToAttributeEntryMap) {
        attEntryMap[firstVertId] = att.mappedIndex(mesh.cornerToPointId(c));
      } else {
        attEntryMap[firstVertId] = firstVertId;
      }

      let firstC = c;
      let actC;

      // If vertex is on seam, swing left to find the first attribute entry.
      // swingLeft(x) = next(seamOpp[next(x)]).
      if (isVertexOnSeam[v]) {

        let rem = firstC - ((firstC / 3) | 0) * 3;
        let nx = rem === 2 ? firstC - 2 : firstC + 1;
        let opp = seamOpp[nx];
        actC = opp < 0 ? kInvalidCornerIndex$1
          : ((opp - ((opp / 3) | 0) * 3) === 2 ? opp - 2 : opp + 1);
        while (actC !== kInvalidCornerIndex$1) {

          firstC = actC;
          rem = firstC - ((firstC / 3) | 0) * 3;
          nx = rem === 2 ? firstC - 2 : firstC + 1;
          opp = seamOpp[nx];
          actC = opp < 0 ? kInvalidCornerIndex$1
            : ((opp - ((opp / 3) | 0) * 3) === 2 ? opp - 2 : opp + 1);
          if (actC === c) {
            return false;
          }

        }

      }

      cornerToVertex[firstC] = firstVertId;
      leftMostMap[firstVertId] = firstC;

      // swingRight(x) = previous(baseOpp[previous(x)]).
      let prem = firstC - ((firstC / 3) | 0) * 3;
      let pv = prem === 0 ? firstC + 2 : firstC - 1;
      let bopp = baseOpp[pv];
      actC = bopp < 0 ? kInvalidCornerIndex$1
        : ((bopp - ((bopp / 3) | 0) * 3) === 0 ? bopp + 2 : bopp - 1);
      while (actC !== kInvalidCornerIndex$1 && actC !== firstC) {

        // isCornerOppositeToSeamEdge(next(actC)).
        const arem = actC - ((actC / 3) | 0) * 3;
        const nAct = arem === 2 ? actC - 2 : actC + 1;
        if (isEdgeOnSeam[nAct]) {

          firstVertId = numNewVertices++;
          if (initVertexToAttributeEntryMap) {
            attEntryMap[firstVertId] = att.mappedIndex(mesh.cornerToPointId(actC));
          } else {
            attEntryMap[firstVertId] = firstVertId;
          }
          leftMostMap[firstVertId] = actC;

        }

        cornerToVertex[actC] = firstVertId;
        prem = actC - ((actC / 3) | 0) * 3;
        pv = prem === 0 ? actC + 2 : actC - 1;
        bopp = baseOpp[pv];
        actC = bopp < 0 ? kInvalidCornerIndex$1
          : ((bopp - ((bopp / 3) | 0) * 3) === 0 ? bopp + 2 : bopp - 1);

      }

    }

    // Expose exact-length views (no copy) so numVertices() and the per-vertex
    // accessors see the right length.
    this.vertex_to_attribute_entry_id_map_ = attEntryMap.subarray(0, numNewVertices);
    this.vertex_to_left_most_corner_map_ = leftMostMap.subarray(0, numNewVertices);

    return true;

  }

  isCornerOppositeToSeamEdge(corner) {

    return this.is_edge_on_seam_[corner];

  }

  opposite(corner) {

    if (corner === kInvalidCornerIndex$1 || this.isCornerOppositeToSeamEdge(corner)) {
      return kInvalidCornerIndex$1;
    }

    return this.corner_table_.opposite(corner);

  }

  next(corner) {

    return this.corner_table_.next(corner);

  }

  previous(corner) {

    return this.corner_table_.previous(corner);

  }

  isCornerOnSeam(corner) {

    return this.is_vertex_on_seam_[this.corner_table_.vertex(corner)];

  }

  getLeftCorner(corner) {

    return this.opposite(this.previous(corner));

  }

  getRightCorner(corner) {

    return this.opposite(this.next(corner));

  }

  swingRight(corner) {

    return this.previous(this.opposite(this.previous(corner)));

  }

  swingLeft(corner) {

    return this.next(this.opposite(this.next(corner)));

  }

  numVertices() {

    return this.vertex_to_attribute_entry_id_map_.length;

  }

  numFaces() {

    return this.corner_table_.numFaces();

  }

  numCorners() {

    return this.corner_table_.numCorners();

  }

  vertex(corner) {

    return this.confidentVertex(corner);

  }

  confidentVertex(corner) {

    return this.corner_to_vertex_map_[corner];

  }

  // Returns the attribute entry id associated to the given vertex.
  vertexParent(vert) {

    return this.vertex_to_attribute_entry_id_map_[vert];

  }

  leftMostCorner(v) {

    return this.vertex_to_left_most_corner_map_[v];

  }

  face(corner) {

    return this.corner_table_.face(corner);

  }

  firstCorner(faceIndex) {

    return this.corner_table_.firstCorner(faceIndex);

  }

  allCorners(faceIndex) {

    return this.corner_table_.allCorners(faceIndex);

  }

  isOnBoundary(vert) {

    const corner = this.leftMostCorner(vert);
    if (corner === kInvalidCornerIndex$1) {
      return true;
    }

    if (this.swingLeft(corner) === kInvalidCornerIndex$1) {
      return true;
    }

    return false;

  }

  // --- Flat-array accessors used by DepthFirstTraverser to avoid polymorphic
  // per-corner method dispatch in the traversal hot loop. ---

  cornerToVertexArray() {
    return this.corner_to_vertex_map_;
  }

  // Returns an Int32Array of seam-aware opposite corners (seam edges map to -1),
  // matching opposite(). Built once on first use; the seam data and underlying
  // connectivity are finalized before traversal, so the result is stable.
  oppositeCornerArray() {
    if (this._effectiveOpposite === null) {
      const nc = this.corner_table_.numCorners();
      const eff = new Int32Array(nc);
      const seam = this.is_edge_on_seam_;
      const ct = this.corner_table_;
      for (let c = 0; c < nc; ++c) {
        eff[c] = seam[c] ? kInvalidCornerIndex$1 : ct.opposite(c);
      }
      this._effectiveOpposite = eff;
    }
    return this._effectiveOpposite;
  }

  vertexLeftmostCornerArray() {
    return this.vertex_to_left_most_corner_map_;
  }

  // Per-(base-)vertex seam flag (Uint8Array). isCornerOnSeam(c) reads this at
  // the corner's base vertex; exposed so hot dedup loops can inline that.
  vertexOnSeamArray() {
    return this.is_vertex_on_seam_;
  }

  isDegenerated(faceIndex) {

    return this.corner_table_.isDegenerated(faceIndex);

  }

  noInteriorSeams() {

    return this.no_interior_seams_;

  }

  cornerTable() {

    return this.corner_table_;

  }

  valence(v) {

    if (v === kInvalidVertexIndex) {
      return -1;
    }

    return this.confidentValenceVertex(v);

  }

  confidentValenceVertex(v) {

    const vi = new VertexRingIterator(this, v);
    let valence = 0;
    while (!vi.end()) {

      ++valence;
      vi.next();

    }

    return valence;

  }

  valenceFromCorner(c) {

    if (c === kInvalidCornerIndex$1) {
      return -1;
    }

    return this.confidentValenceVertex(this.vertex(c));

  }

  getValenceCache() {

    return this.valence_cache_;

  }

}

// compression/mesh/MeshEdgebreakerDecoderImpl.js - ported from mesh/mesh_edgebreaker_decoder_impl.h/cc


// Invalid index constant (used for corners and vertices).
const kInvalidCornerIndex = -1;

// Implementation of the edgebreaker decoder that decodes data encoded with the
// MeshEdgebreakerEncoderImpl class. The implementation is based on the
// algorithm presented in Isenburg et al'02 "Spirale Reversi: Reverse
// decoding of the Edgebreaker encoding".
class MeshEdgebreakerDecoderImpl {

  constructor(TraversalDecoderClass) {
    this._decoder = null;
    this._cornerTable = null;
    this._cornerTraversalStack = [];
    this._vertexTraversalLength = [];
    this._topologySplitData = [];
    this._holeEventData = [];
    this._initFaceConfigurations = [];
    this._initCorners = [];
    this._lastSymbolId = -1;
    this._lastVertId = -1;
    this._lastFaceId = -1;
    this._visitedFaces = [];
    this._visitedVerts = [];
    this._isVertHole = [];
    this._numNewVertices = 0;
    this._newToParentVertexMap = new Map();
    this._numEncodedVertices = 0;
    this._processedCornerIds = [];
    this._processedConnectivityCorners = [];
    this._posEncodingData = new MeshAttributeIndicesEncodingData();
    this._posDataDecoderId = -1;
    // Per-decode cache of vertex-traversal results, keyed by corner table, so
    // multiple vertex-mapped attributes that share connectivity traverse once.
    this._vertexTraversalCache = new Map();
    this._attributeData = [];
    this._traversalDecoder = new TraversalDecoderClass();
  }

  init(decoder) {
    this._decoder = decoder;
    return true;
  }

  getDecoder() {
    return this._decoder;
  }

  getCornerTable() {
    return this._cornerTable;
  }

  getAttributeCornerTable(attId) {
    for (let i = 0; i < this._attributeData.length; ++i) {
      const decoderId = this._attributeData[i].decoderId;
      if (decoderId < 0 || decoderId >= this._decoder.numAttributesDecoders()) {
        continue;
      }
      const dec = this._decoder.attributesDecoder(decoderId);
      for (let j = 0; j < dec.getNumAttributes(); ++j) {
        if (dec.getAttributeId(j) === attId) {
          if (this._attributeData[i].isConnectivityUsed) {
            return this._attributeData[i].connectivityData;
          }
          return null;
        }
      }
    }
    return null;
  }

  getAttributeEncodingData(attId) {
    for (let i = 0; i < this._attributeData.length; ++i) {
      const decoderId = this._attributeData[i].decoderId;
      if (decoderId < 0 || decoderId >= this._decoder.numAttributesDecoders()) {
        continue;
      }
      const dec = this._decoder.attributesDecoder(decoderId);
      for (let j = 0; j < dec.getNumAttributes(); ++j) {
        if (dec.getAttributeId(j) === attId) {
          return this._attributeData[i].encodingData;
        }
      }
    }
    return this._posEncodingData;
  }

  createAttributesDecoder(attDecoderId) {
    const attDataId = this._decoder.buffer().decodeInt8();
    if (attDataId === undefined) return false;

    const decoderType = this._decoder.buffer().decodeUint8();
    if (decoderType === undefined) return false;

    if (attDataId >= 0) {
      if (attDataId >= this._attributeData.length) {
        return false; // Unexpected attribute data.
      }
      if (this._attributeData[attDataId].decoderId >= 0) {
        return false;
      }
      this._attributeData[attDataId].decoderId = attDecoderId;
    } else {
      if (this._posDataDecoderId >= 0) {
        return false;
      }
      this._posDataDecoderId = attDecoderId;
    }

    let traversalMethod = MeshTraversalMethod.MESH_TRAVERSAL_DEPTH_FIRST;
    if (this._decoder.bitstreamVersion() >= DRACO_BITSTREAM_VERSION(1, 2)) {
      const traversalMethodEncoded = this._decoder.buffer().decodeUint8();
      if (traversalMethodEncoded === undefined) return false;
      if (traversalMethodEncoded >= MeshTraversalMethod.NUM_TRAVERSAL_METHODS) {
        return false;
      }
      traversalMethod = traversalMethodEncoded;
    }

    const mesh = this._decoder.mesh();
    let sequencer = null;

    if (decoderType === MeshAttributeElementType.MESH_VERTEX_ATTRIBUTE) {
      // Per-vertex attribute decoder.
      let encodingData = null;
      if (attDataId < 0) {
        encodingData = this._posEncodingData;
      } else {
        encodingData = this._attributeData[attDataId].encodingData;
        this._attributeData[attDataId].isConnectivityUsed = false;
      }

      // Create vertex traversal sequencer using the main corner table.
      sequencer = this._createVertexTraversalSequencer(
        encodingData, this._cornerTable, mesh);
    } else {
      // Per-corner attribute decoder.
      if (traversalMethod !== MeshTraversalMethod.MESH_TRAVERSAL_DEPTH_FIRST) {
        return false;
      }
      if (attDataId < 0) {
        return false;
      }

      const encodingData = this._attributeData[attDataId].encodingData;
      const attCornerTable = this._attributeData[attDataId].connectivityData;

      sequencer = this._createVertexTraversalSequencer(
        encodingData, attCornerTable, mesh);
    }

    if (!sequencer) {
      return false;
    }

    const attController = new SequentialAttributeDecodersController(sequencer);
    return this._decoder.setAttributesDecoder(attDecoderId, attController);
  }

  _createVertexTraversalSequencer(encodingData, cornerTable, mesh) {
    const traversalSequencer = new MeshTraversalSequencer(
      mesh, encodingData, this._vertexTraversalCache);

    const observer = new MeshAttributeIndicesEncodingObserver(
      cornerTable, mesh, traversalSequencer, encodingData);

    const traverser = new DepthFirstTraverser();
    traverser.init(cornerTable, observer);

    traversalSequencer.setTraverser(traverser);
    return traversalSequencer;
  }

  decodeConnectivity() {
    this._numNewVertices = 0;
    this._newToParentVertexMap.clear();

    if (this._decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 2)) {
      let numNewVerts;
      if (this._decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 0)) {
        numNewVerts = this._decoder.buffer().decodeUint32();
        if (numNewVerts === undefined) return false;
      } else {
        numNewVerts = decodeVarint(this._decoder.buffer());
        if (numNewVerts === undefined) return false;
      }
      this._numNewVertices = numNewVerts;
    }

    let numEncodedVertices;
    if (this._decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 0)) {
      numEncodedVertices = this._decoder.buffer().decodeUint32();
      if (numEncodedVertices === undefined) return false;
    } else {
      numEncodedVertices = decodeVarint(this._decoder.buffer());
      if (numEncodedVertices === undefined) return false;
    }
    this._numEncodedVertices = numEncodedVertices;

    let numFaces;
    if (this._decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 0)) {
      numFaces = this._decoder.buffer().decodeUint32();
      if (numFaces === undefined) return false;
    } else {
      numFaces = decodeVarint(this._decoder.buffer());
      if (numFaces === undefined) return false;
    }

    if (numFaces > 0x7FFFFFFF / 3) {
      return false; // Draco cannot handle this many faces.
    }
    if (this._numEncodedVertices > numFaces * 3) {
      return false; // There cannot be more vertices than 3 * numFaces.
    }

    // Minimum number of edges of the mesh assuming each edge is shared between
    // two faces.
    const minNumFaceEdges = Math.floor(3 * numFaces / 2);
    // Maximum number of edges that can exist between numEncodedVertices.
    const maxNumVertexEdges = this._numEncodedVertices *
      (this._numEncodedVertices - 1) / 2;
    if (maxNumVertexEdges < minNumFaceEdges) {
      return false; // Impossible to construct a manifold mesh.
    }

    const numAttributeData = this._decoder.buffer().decodeUint8();
    if (numAttributeData === undefined) return false;

    let numEncodedSymbols;
    if (this._decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 0)) {
      numEncodedSymbols = this._decoder.buffer().decodeUint32();
      if (numEncodedSymbols === undefined) return false;
    } else {
      numEncodedSymbols = decodeVarint(this._decoder.buffer());
      if (numEncodedSymbols === undefined) return false;
    }

    if (numFaces < numEncodedSymbols) {
      return false;
    }
    const maxEncodedFaces = numEncodedSymbols + Math.floor(numEncodedSymbols / 3);
    if (numFaces > maxEncodedFaces) {
      return false;
    }

    let numEncodedSplitSymbols;
    if (this._decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 0)) {
      numEncodedSplitSymbols = this._decoder.buffer().decodeUint32();
      if (numEncodedSplitSymbols === undefined) return false;
    } else {
      numEncodedSplitSymbols = decodeVarint(this._decoder.buffer());
      if (numEncodedSplitSymbols === undefined) return false;
    }

    if (numEncodedSplitSymbols > numEncodedSymbols) {
      return false; // Split symbols are a sub-set of all symbols.
    }
    // Decode topology (connectivity).
    this._vertexTraversalLength = [];
    this._cornerTable = new CornerTable();
    this._vertexTraversalCache = new Map();
    this._processedCornerIds = [];
    this._processedConnectivityCorners = [];
    this._topologySplitData = [];
    this._holeEventData = [];
    this._initFaceConfigurations = [];
    this._initCorners = [];

    this._lastSymbolId = -1;
    this._lastFaceId = -1;
    this._lastVertId = -1;

    this._attributeData = [];
    for (let i = 0; i < numAttributeData; ++i) {
      this._attributeData.push(new AttributeData());
    }

    if (!this._cornerTable.reset(
      numFaces, this._numEncodedVertices + numEncodedSplitSymbols)) {
      return false;
    }

    // Start with all vertices marked as holes (boundaries). Uint8Array (1=hole)
    // keeps the per-vertex reads/writes in _decodeConnectivity and
    // _assignPointsToCorners monomorphic. The vertex count never exceeds this
    // length (enforced via maxNumVertices), so fixed-size storage is safe.
    this._isVertHole = new Uint8Array(
      this._numEncodedVertices + numEncodedSplitSymbols).fill(1);

    let topologySplitDecodedBytes = -1;
    if (this._decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 2)) {
      let encodedConnectivitySize;
      if (this._decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 0)) {
        encodedConnectivitySize = this._decoder.buffer().decodeUint32();
        if (encodedConnectivitySize === undefined) return false;
      } else {
        encodedConnectivitySize = decodeVarint(this._decoder.buffer());
        if (encodedConnectivitySize === undefined) return false;
      }
      if (encodedConnectivitySize === 0 ||
          encodedConnectivitySize > this._decoder.buffer().remainingSize) {
        return false;
      }
      const eventBuffer = new DecoderBuffer();
      const head = this._decoder.buffer().dataHead;
      eventBuffer.init(
        head.subarray(encodedConnectivitySize),
        this._decoder.buffer().remainingSize - encodedConnectivitySize,
        this._decoder.buffer().bitstreamVersion
      );
      topologySplitDecodedBytes =
        this._decodeHoleAndTopologySplitEvents(eventBuffer);
      if (topologySplitDecodedBytes === -1) {
        return false;
      }
    } else {
      if (this._decodeHoleAndTopologySplitEvents(this._decoder.buffer()) === -1) {
        return false;
      }
    }

    this._traversalDecoder.init(this);
    // Add one extra vertex for each split symbol.
    this._traversalDecoder.setNumEncodedVertices(
      this._numEncodedVertices + numEncodedSplitSymbols);
    this._traversalDecoder.setNumAttributeData(numAttributeData);

    const traversalEndBuffer = new DecoderBuffer();
    if (!this._traversalDecoder.start(traversalEndBuffer)) {
      return false;
    }

    const numConnectivityVerts = this._decodeConnectivity(numEncodedSymbols);
    if (numConnectivityVerts === -1) {
      return false;
    }

    // Set the main buffer to the end of the traversal.
    this._decoder.buffer().init(
      traversalEndBuffer.dataHead,
      traversalEndBuffer.remainingSize,
      this._decoder.buffer().bitstreamVersion
    );

    if (this._decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 2)) {
      // Skip topology split data that was already decoded earlier.
      this._decoder.buffer().advance(topologySplitDecodedBytes);
    }

    // Decode connectivity of non-position attributes.
    if (this._attributeData.length > 0) {
      if (this._decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 1)) {
        for (let ci = 0; ci < this._cornerTable.numCorners(); ci += 3) {
          if (!this._decodeAttributeConnectivitiesOnFaceLegacy(ci)) {
            return false;
          }
        }
      } else {
        for (let ci = 0; ci < this._cornerTable.numCorners(); ci += 3) {
          if (!this._decodeAttributeConnectivitiesOnFace(ci)) {
            return false;
          }
        }
      }
    }
    this._traversalDecoder.done();

    // Decode attribute connectivity.
    for (let i = 0; i < this._attributeData.length; ++i) {
      const connectivityData = this._attributeData[i].connectivityData;
      connectivityData.initEmpty(this._cornerTable);
      // Add all seams (indexed loop — avoids a for..of iterator per seam).
      const seamCorners = this._attributeData[i].attributeSeamCorners;
      for (let s = 0; s < seamCorners.length; ++s) {
        connectivityData.addSeamEdge(seamCorners[s]);
      }
      // Recompute vertices from the newly added seam edges.
      if (!connectivityData.recomputeVertices(null, null)) {
        return false;
      }
    }

    this._posEncodingData.init(this._cornerTable.numVertices());
    for (let i = 0; i < this._attributeData.length; ++i) {
      let attConnectivityVerts =
        this._attributeData[i].connectivityData.numVertices();
      if (attConnectivityVerts < this._cornerTable.numVertices()) {
        attConnectivityVerts = this._cornerTable.numVertices();
      }
      this._attributeData[i].encodingData.init(attConnectivityVerts);
    }
    if (!this._assignPointsToCorners(numConnectivityVerts)) {
      return false;
    }
    return true;
  }

  onAttributesDecoded() {
    return true;
  }

  // --- Private methods ---

  _isTopologySplit(encoderSymbolId, outResult) {
    if (this._topologySplitData.length === 0) {
      return false;
    }
    const back = this._topologySplitData[this._topologySplitData.length - 1];
    if (back.sourceSymbolId > encoderSymbolId) {
      // Something is wrong; the desired source symbol is greater than the
      // current encoder_symbol_id.
      outResult.encoderSplitSymbolId = -1;
      return true;
    }
    if (back.sourceSymbolId !== encoderSymbolId) {
      return false;
    }
    outResult.faceEdge = back.sourceEdge;
    outResult.encoderSplitSymbolId = back.splitSymbolId;
    // Remove the latest split event.
    this._topologySplitData.pop();
    return true;
  }

  _setOppositeCorners(corner0, corner1) {
    this._cornerTable.setOppositeCorner(corner0, corner1);
    this._cornerTable.setOppositeCorner(corner1, corner0);
  }

  _isFaceVisited(cornerId) {
    if (cornerId < 0) {
      return true; // Invalid corner signalizes that the face does not exist.
    }
    return this._visitedFaces[this._cornerTable.face(cornerId)];
  }

  _decodeConnectivity(numSymbols) {
    // Algorithm does the reverse decoding of the symbols encoded with the
    // edgebreaker method.
    const activeCornerStack = [];
    const topologySplitActiveCorners = new Map();
    const invalidVertices = [];
    const removeInvalidVertices = this._attributeData.length === 0;

    let maxNumVertices = this._isVertHole.length;
    let numFacesDecoded = 0;

    // Hoist the two corner-indexed flat arrays. Unlike _vertexCorners (grown by
    // addNewVertex), these are sized once in reset() and never reallocated, so
    // direct indexed writes are safe here and skip the per-call method dispatch
    // (mapCornerToVertex / setOppositeCorner) that showed up in profiles. All
    // corners written below are freshly constructed (>= 0), so no guard needed.
    const cornerToVertex = this._cornerTable._cornerToVertex;
    const oppositeCorners = this._cornerTable._oppositeCorners;

    for (let symbolId = 0; symbolId < numSymbols; ++symbolId) {
      const faceIndex = numFacesDecoded++;
      let checkTopologySplit = false;
      const symbol = this._traversalDecoder.decodeSymbol();

      if (symbol === TOPOLOGY_C) {
        // Create a new face between two edges on the open boundary.
        if (activeCornerStack.length === 0) return -1;

        const cornerA = activeCornerStack[activeCornerStack.length - 1];
        const vertexX = this._cornerTable.vertex(
          this._cornerTable.next(cornerA));
        const cornerB = this._cornerTable.next(
          this._cornerTable.leftMostCorner(vertexX));

        if (cornerA === cornerB) return -1;
        if (this._cornerTable.opposite(cornerA) !== kInvalidCornerIndex ||
            this._cornerTable.opposite(cornerB) !== kInvalidCornerIndex) {
          return -1;
        }

        const corner = 3 * faceIndex;
        oppositeCorners[cornerA] = corner + 1;
        oppositeCorners[corner + 1] = cornerA;
        oppositeCorners[cornerB] = corner + 2;
        oppositeCorners[corner + 2] = cornerB;

        const vertAPrev = this._cornerTable.vertex(
          this._cornerTable.previous(cornerA));
        const vertBNext = this._cornerTable.vertex(
          this._cornerTable.next(cornerB));

        if (vertexX === vertAPrev || vertexX === vertBNext) return -1;

        cornerToVertex[corner] = vertexX;
        cornerToVertex[corner + 1] = vertBNext;
        cornerToVertex[corner + 2] = vertAPrev;
        this._cornerTable.setLeftMostCorner(vertAPrev, corner + 2);
        // Mark the vertex x as interior.
        this._isVertHole[vertexX] = 0;
        activeCornerStack[activeCornerStack.length - 1] = corner;

      } else if (symbol === TOPOLOGY_R || symbol === TOPOLOGY_L) {
        // Create a new face extending from the open boundary edge.
        if (activeCornerStack.length === 0) return -1;

        const cornerA = activeCornerStack[activeCornerStack.length - 1];
        if (this._cornerTable.opposite(cornerA) !== kInvalidCornerIndex) {
          return -1;
        }

        const corner = 3 * faceIndex;
        let oppCorner, cornerL, cornerR;
        if (symbol === TOPOLOGY_R) {
          oppCorner = corner + 2;
          cornerL = corner + 1;
          cornerR = corner;
        } else {
          oppCorner = corner + 1;
          cornerL = corner;
          cornerR = corner + 2;
        }
        oppositeCorners[oppCorner] = cornerA;
        oppositeCorners[cornerA] = oppCorner;

        const newVertIndex = this._cornerTable.addNewVertex();
        if (this._cornerTable.numVertices() > maxNumVertices) return -1;

        cornerToVertex[oppCorner] = newVertIndex;
        this._cornerTable.setLeftMostCorner(newVertIndex, oppCorner);

        const vertexR = this._cornerTable.vertex(
          this._cornerTable.previous(cornerA));
        cornerToVertex[cornerR] = vertexR;
        this._cornerTable.setLeftMostCorner(vertexR, cornerR);

        cornerToVertex[cornerL] =
          this._cornerTable.vertex(this._cornerTable.next(cornerA));

        activeCornerStack[activeCornerStack.length - 1] = corner;
        checkTopologySplit = true;

      } else if (symbol === TOPOLOGY_S) {
        // Create a new face that merges two last active edges from the active
        // stack.
        if (activeCornerStack.length === 0) return -1;

        const cornerB = activeCornerStack[activeCornerStack.length - 1];
        activeCornerStack.pop();

        // Corner "a" can correspond to a normal active edge, or to an edge
        // created from the topology split event.
        const splitCorner = topologySplitActiveCorners.get(symbolId);
        if (splitCorner !== undefined) {
          activeCornerStack.push(splitCorner);
        }
        if (activeCornerStack.length === 0) return -1;

        const cornerA = activeCornerStack[activeCornerStack.length - 1];
        if (cornerA === cornerB) return -1;
        if (this._cornerTable.opposite(cornerA) !== kInvalidCornerIndex ||
            this._cornerTable.opposite(cornerB) !== kInvalidCornerIndex) {
          return -1;
        }

        const corner = 3 * faceIndex;
        oppositeCorners[cornerA] = corner + 2;
        oppositeCorners[corner + 2] = cornerA;
        oppositeCorners[cornerB] = corner + 1;
        oppositeCorners[corner + 1] = cornerB;

        const vertexP = this._cornerTable.vertex(
          this._cornerTable.previous(cornerA));
        cornerToVertex[corner] = vertexP;
        cornerToVertex[corner + 1] =
          this._cornerTable.vertex(this._cornerTable.next(cornerA));

        const vertBPrev = this._cornerTable.vertex(
          this._cornerTable.previous(cornerB));
        cornerToVertex[corner + 2] = vertBPrev;
        this._cornerTable.setLeftMostCorner(vertBPrev, corner + 2);

        let cornerN = this._cornerTable.next(cornerB);
        const vertexN = this._cornerTable.vertex(cornerN);
        this._traversalDecoder.mergeVertices(vertexP, vertexN);
        // Update the left most corner on the newly merged vertex.
        this._cornerTable.setLeftMostCorner(
          vertexP, this._cornerTable.leftMostCorner(vertexN));

        // Update vertex id at corner "n" and all corners connected to it
        // in the CCW direction.
        const firstCorner = cornerN;
        while (cornerN !== kInvalidCornerIndex) {
          cornerToVertex[cornerN] = vertexP;
          cornerN = this._cornerTable.swingLeft(cornerN);
          if (cornerN === firstCorner) {
            // We reached the start again which should not happen for split
            // symbols.
            return -1;
          }
        }
        // Make the old vertex n isolated.
        this._cornerTable.makeVertexIsolated(vertexN);
        if (removeInvalidVertices) {
          invalidVertices.push(vertexN);
        }
        activeCornerStack[activeCornerStack.length - 1] = corner;

      } else if (symbol === TOPOLOGY_E) {
        const corner = 3 * faceIndex;
        const firstVertIndex = this._cornerTable.addNewVertex();
        // Create three new vertices at the corners of the new face.
        cornerToVertex[corner] = firstVertIndex;
        cornerToVertex[corner + 1] = this._cornerTable.addNewVertex();
        cornerToVertex[corner + 2] = this._cornerTable.addNewVertex();

        if (this._cornerTable.numVertices() > maxNumVertices) return -1;

        this._cornerTable.setLeftMostCorner(firstVertIndex, corner);
        this._cornerTable.setLeftMostCorner(firstVertIndex + 1, corner + 1);
        this._cornerTable.setLeftMostCorner(firstVertIndex + 2, corner + 2);
        // Add the tip corner to the active stack.
        activeCornerStack.push(corner);
        checkTopologySplit = true;

      } else {
        // Unknown symbol.
        return -1;
      }

      // Inform the traversal decoder that a new corner has been reached.
      this._traversalDecoder.newActiveCornerReached(
        activeCornerStack[activeCornerStack.length - 1]);

      if (checkTopologySplit) {
        // Check for topology splits.
        const encoderSymbolId = numSymbols - symbolId - 1;
        const splitResult = { faceEdge: 0, encoderSplitSymbolId: 0 };
        while (this._isTopologySplit(encoderSymbolId, splitResult)) {
          if (splitResult.encoderSplitSymbolId < 0) return -1;

          const actTopCorner = activeCornerStack[activeCornerStack.length - 1];
          let newActiveCorner;
          if (splitResult.faceEdge === RIGHT_FACE_EDGE) {
            newActiveCorner = this._cornerTable.next(actTopCorner);
          } else {
            newActiveCorner = this._cornerTable.previous(actTopCorner);
          }
          // Convert the encoder split symbol id to decoder symbol id.
          const decoderSplitSymbolId =
            numSymbols - splitResult.encoderSplitSymbolId - 1;
          topologySplitActiveCorners.set(decoderSplitSymbolId, newActiveCorner);
        }
      }
    }

    if (this._cornerTable.numVertices() > maxNumVertices) {
      return -1;
    }

    // Decode start faces and connect them to the faces from the active stack.
    while (activeCornerStack.length > 0) {
      const corner = activeCornerStack[activeCornerStack.length - 1];
      activeCornerStack.pop();

      const interiorFace =
        this._traversalDecoder.decodeStartFaceConfiguration();

      if (interiorFace) {
        if (numFacesDecoded >= this._cornerTable.numFaces()) {
          return -1;
        }

        const cornerA = corner;
        const vertN = this._cornerTable.vertex(
          this._cornerTable.next(cornerA));
        const cornerB = this._cornerTable.next(
          this._cornerTable.leftMostCorner(vertN));

        const vertX = this._cornerTable.vertex(
          this._cornerTable.next(cornerB));
        const cornerC = this._cornerTable.next(
          this._cornerTable.leftMostCorner(vertX));

        if (corner === cornerB || corner === cornerC || cornerB === cornerC) {
          return -1;
        }
        if (this._cornerTable.opposite(corner) !== kInvalidCornerIndex ||
            this._cornerTable.opposite(cornerB) !== kInvalidCornerIndex ||
            this._cornerTable.opposite(cornerC) !== kInvalidCornerIndex) {
          return -1;
        }

        const vertP = this._cornerTable.vertex(
          this._cornerTable.next(cornerC));

        const faceIndex = numFacesDecoded++;
        const newCorner = 3 * faceIndex;
        oppositeCorners[newCorner] = corner;
        oppositeCorners[corner] = newCorner;
        oppositeCorners[newCorner + 1] = cornerB;
        oppositeCorners[cornerB] = newCorner + 1;
        oppositeCorners[newCorner + 2] = cornerC;
        oppositeCorners[cornerC] = newCorner + 2;

        cornerToVertex[newCorner] = vertX;
        cornerToVertex[newCorner + 1] = vertP;
        cornerToVertex[newCorner + 2] = vertN;

        // Mark all three vertices as interior.
        for (let ci = 0; ci < 3; ++ci) {
          this._isVertHole[
            this._cornerTable.vertex(newCorner + ci)] = 0;
        }

        this._initFaceConfigurations.push(true);
        this._initCorners.push(newCorner);
      } else {
        // The initial face wasn't interior.
        this._initFaceConfigurations.push(false);
        this._initCorners.push(corner);
      }
    }

    if (numFacesDecoded !== this._cornerTable.numFaces()) {
      return -1;
    }

    let numVertices = this._cornerTable.numVertices();
    // Remove invalid (isolated) vertices by swapping them with the last valid
    // vertex in the table. Matches C++ mesh_edgebreaker_decoder_impl.cc.
    // Must iterate forward (not reverse) to match C++ iteration order.
    for (let ivIdx = 0; ivIdx < invalidVertices.length; ++ivIdx) {
      const invalidVert = invalidVertices[ivIdx];
      // Find the last valid vertex.
      let srcVert = numVertices - 1;
      while (this._cornerTable.leftMostCorner(srcVert) === kInvalidCornerIndex) {
        srcVert = --numVertices - 1;
      }
      if (srcVert < invalidVert) continue;

      // Remap all corners mapped to srcVert to invalidVert.
      // Use VertexCornersIterator logic: swing left first, then swing right
      // on boundary to cover all corners around the vertex.
      const startCid = this._cornerTable.leftMostCorner(srcVert);
      let cid = startCid;
      let leftTraversal = true;
      while (cid !== kInvalidCornerIndex) {
        if (this._cornerTable.vertex(cid) !== srcVert) {
          return -1;
        }
        cornerToVertex[cid] = invalidVert;
        // Advance to the next corner around the vertex.
        if (leftTraversal) {
          const nextCid = this._cornerTable.swingLeft(cid);
          if (nextCid === kInvalidCornerIndex) {
            // Open boundary reached, switch to right traversal from start.
            leftTraversal = false;
            cid = this._cornerTable.swingRight(startCid);
          } else if (nextCid === startCid) {
            // Closed fan, we're done.
            break;
          } else {
            cid = nextCid;
          }
        } else {
          cid = this._cornerTable.swingRight(cid);
        }
      }

      this._cornerTable.setLeftMostCorner(
        invalidVert, this._cornerTable.leftMostCorner(srcVert));
      this._cornerTable.makeVertexIsolated(srcVert);
      this._isVertHole[invalidVert] = this._isVertHole[srcVert];
      this._isVertHole[srcVert] = 0;
      numVertices--;
    }
    return numVertices;
  }

  _decodeHoleAndTopologySplitEvents(decoderBuffer) {
    let numTopologySplits;
    if (this._decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 0)) {
      numTopologySplits = decoderBuffer.decodeUint32();
      if (numTopologySplits === undefined) return -1;
    } else {
      numTopologySplits = decodeVarint(decoderBuffer);
      if (numTopologySplits === undefined) return -1;
    }

    if (numTopologySplits > 0) {
      if (numTopologySplits > this._cornerTable.numFaces()) {
        return -1;
      }
      if (this._decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(1, 2)) {
        for (let i = 0; i < numTopologySplits; ++i) {
          const eventData = new TopologySplitEventData();
          eventData.splitSymbolId = decoderBuffer.decodeUint32();
          if (eventData.splitSymbolId === undefined) return -1;
          eventData.sourceSymbolId = decoderBuffer.decodeUint32();
          if (eventData.sourceSymbolId === undefined) return -1;
          const edgeData = decoderBuffer.decodeUint8();
          if (edgeData === undefined) return -1;
          eventData.sourceEdge = edgeData & 1;
          this._topologySplitData.push(eventData);
        }
      } else {
        // Decode source and split symbol ids using delta and varint coding.
        let lastSourceSymbolId = 0;
        for (let i = 0; i < numTopologySplits; ++i) {
          const eventData = new TopologySplitEventData();
          const delta = decodeVarint(decoderBuffer);
          if (delta === undefined) return -1;
          eventData.sourceSymbolId = delta + lastSourceSymbolId;
          const delta2 = decodeVarint(decoderBuffer);
          if (delta2 === undefined) return -1;
          if (delta2 > eventData.sourceSymbolId) return -1;
          eventData.splitSymbolId = eventData.sourceSymbolId - delta2;
          lastSourceSymbolId = eventData.sourceSymbolId;
          this._topologySplitData.push(eventData);
        }
        // Split edges are decoded from a direct bit decoder.
        decoderBuffer.startBitDecoding(false);
        for (let i = 0; i < numTopologySplits; ++i) {
          let edgeData;
          if (this._decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 2)) {
            edgeData = decoderBuffer.decodeLeastSignificantBits32(2);
          } else {
            edgeData = decoderBuffer.decodeLeastSignificantBits32(1);
          }
          this._topologySplitData[i].sourceEdge = edgeData & 1;
        }
        decoderBuffer.endBitDecoding();
      }
    }

    let numHoleEvents = 0;
    if (this._decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 0)) {
      numHoleEvents = decoderBuffer.decodeUint32();
      if (numHoleEvents === undefined) return -1;
    } else if (this._decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 1)) {
      numHoleEvents = decodeVarint(decoderBuffer);
      if (numHoleEvents === undefined) return -1;
    }

    if (numHoleEvents > 0) {
      if (this._decoder.bitstreamVersion() < DRACO_BITSTREAM_VERSION(1, 2)) {
        for (let i = 0; i < numHoleEvents; ++i) {
          const symbolId = decoderBuffer.decodeInt32();
          if (symbolId === undefined) return -1;
          this._holeEventData.push(new HoleEventData(symbolId));
        }
      } else {
        let lastSymbolId = 0;
        for (let i = 0; i < numHoleEvents; ++i) {
          const delta = decodeVarint(decoderBuffer);
          if (delta === undefined) return -1;
          const eventData = new HoleEventData(delta + lastSymbolId);
          lastSymbolId = eventData.symbolId;
          this._holeEventData.push(eventData);
        }
      }
    }
    return decoderBuffer.decodedSize;
  }

  _decodeAttributeConnectivitiesOnFaceLegacy(corner) {
    const corners = [
      corner,
      this._cornerTable.next(corner),
      this._cornerTable.previous(corner)
    ];

    for (let c = 0; c < 3; ++c) {
      const oppCorner = this._cornerTable.opposite(corners[c]);
      if (oppCorner === kInvalidCornerIndex) {
        // Boundary edge is automatically an attribute seam.
        for (let i = 0; i < this._attributeData.length; ++i) {
          this._attributeData[i].attributeSeamCorners.push(corners[c]);
        }
        continue;
      }
      for (let i = 0; i < this._attributeData.length; ++i) {
        const isSeam = this._traversalDecoder.decodeAttributeSeam(i);
        if (isSeam) {
          this._attributeData[i].attributeSeamCorners.push(corners[c]);
        }
      }
    }
    return true;
  }

  _decodeAttributeConnectivitiesOnFace(corner) {
    // corner is the first corner of a face (a multiple of 3), so its three
    // corners are corner, corner+1, corner+2. Iterate them without allocating a
    // [corner, next, prev] array, reading opposites from the flat array.
    const ct = this._cornerTable;
    const oppositeCorners = ct.oppositeCornerArray();
    const attributeData = this._attributeData;
    const numAttrData = attributeData.length;
    const srcFaceId = (corner / 3) | 0;
    const faceBase = srcFaceId * 3;

    // Visit the face's corners in the order [corner, next(corner),
    // previous(corner)] to match the encoder's edge order exactly.
    const rem = corner - faceBase;
    const nextCorner = rem === 2 ? corner - 2 : corner + 1;
    const prevCorner = rem === 0 ? corner + 2 : corner - 1;

    for (let c = 0; c < 3; ++c) {
      const cc = c === 0 ? corner : (c === 1 ? nextCorner : prevCorner);
      const oppCorner = oppositeCorners[cc];
      if (oppCorner === kInvalidCornerIndex) {
        // Boundary edge is automatically an attribute seam.
        for (let i = 0; i < numAttrData; ++i) {
          attributeData[i].attributeSeamCorners.push(cc);
        }
        continue;
      }
      const oppFaceId = (oppCorner / 3) | 0;
      // Don't decode edges when the opposite face has been already processed.
      if (oppFaceId < srcFaceId) {
        continue;
      }
      for (let i = 0; i < numAttrData; ++i) {
        const isSeam = this._traversalDecoder.decodeAttributeSeam(i);
        if (isSeam) {
          attributeData[i].attributeSeamCorners.push(cc);
        }
      }
    }
    return true;
  }

  _assignPointsToCorners(numConnectivityVerts) {
    // Map between the existing and deduplicated point ids.
    this._decoder.mesh().setNumFaces(this._cornerTable.numFaces());

    const mesh = this._decoder.mesh();
    const ct = this._cornerTable;

    if (this._attributeData.length === 0) {
      // We have connectivity for position only. In this case all vertex indices
      // are equal to point indices.
      const numFaces = mesh.numFaces();
      for (let f = 0; f < numFaces; ++f) {
        const startCorner = 3 * f;
        mesh.setFaceVertices(f,
          ct.vertex(startCorner),
          ct.vertex(startCorner + 1),
          ct.vertex(startCorner + 2));
      }
      this._decoder.pointCloud().setNumPoints(numConnectivityVerts);
      return true;
    }

    // Else we need to deduplicate multiple attributes. pointToCornerMap is only
    // ever used for its length (the running point id), so track that as a
    // counter instead of growing an array.
    const attributeData = this._attributeData;
    const numAttrData = attributeData.length;
    let numPoints = 0;
    const cornerToPointMap = new Int32Array(ct.numCorners());

    const numVertices = ct.numVertices();
    // Flat connectivity for the inlined swingRight ring walk and per-attribute
    // vertex / seam lookups — avoids method dispatch on the (polymorphic) corner
    // tables for every corner of every vertex ring. swingRight(x) here is the
    // base table's: previous(baseOpp[previous(x)]).
    const vertexLeftmost = ct.vertexLeftmostCornerArray();
    const baseOpp = ct.oppositeCornerArray();
    const baseCornerToVertex = ct.cornerToVertexArray();
    const isVertHole = this._isVertHole;
    const attCornerToVertex = new Array(numAttrData);
    const attVertexOnSeam = new Array(numAttrData);
    for (let i = 0; i < numAttrData; ++i) {
      attCornerToVertex[i] = attributeData[i].connectivityData.cornerToVertexArray();
      attVertexOnSeam[i] = attributeData[i].connectivityData.vertexOnSeamArray();
    }

    for (let v = 0; v < numVertices; ++v) {
      let c = vertexLeftmost[v];
      if (c === kInvalidCornerIndex) continue; // Isolated vertex.

      let deduplicationFirstCorner = c;
      let rem, pv, opp;
      if (isVertHole[v]) {
        deduplicationFirstCorner = c;
      } else {
        // Find the first seam (of any attribute).
        for (let i = 0; i < numAttrData; ++i) {
          const attC2V = attCornerToVertex[i];
          // isCornerOnSeam(c) == is_vertex_on_seam_[baseVertex(c)].
          if (!attVertexOnSeam[i][baseCornerToVertex[c]]) {
            continue;
          }
          const vertId = attC2V[c];
          rem = c - ((c / 3) | 0) * 3;
          pv = rem === 0 ? c + 2 : c - 1;
          opp = baseOpp[pv];
          let actC = opp < 0 ? kInvalidCornerIndex
            : ((opp - ((opp / 3) | 0) * 3) === 0 ? opp + 2 : opp - 1);
          let seamFound = false;
          while (actC !== c) {
            if (actC === kInvalidCornerIndex) return false;
            if (attC2V[actC] !== vertId) {
              deduplicationFirstCorner = actC;
              seamFound = true;
              break;
            }
            rem = actC - ((actC / 3) | 0) * 3;
            pv = rem === 0 ? actC + 2 : actC - 1;
            opp = baseOpp[pv];
            actC = opp < 0 ? kInvalidCornerIndex
              : ((opp - ((opp / 3) | 0) * 3) === 0 ? opp + 2 : opp - 1);
          }
          if (seamFound) break;
        }
      }

      // Deduplication pass over corners on the processed vertex.
      c = deduplicationFirstCorner;
      cornerToPointMap[c] = numPoints++;
      // Traverse in CW direction (swingRight inlined).
      let prevC = c;
      rem = c - ((c / 3) | 0) * 3;
      pv = rem === 0 ? c + 2 : c - 1;
      opp = baseOpp[pv];
      c = opp < 0 ? kInvalidCornerIndex
        : ((opp - ((opp / 3) | 0) * 3) === 0 ? opp + 2 : opp - 1);
      while (c !== kInvalidCornerIndex && c !== deduplicationFirstCorner) {
        let attributeSeam = false;
        for (let i = 0; i < numAttrData; ++i) {
          const attC2V = attCornerToVertex[i];
          if (attC2V[c] !== attC2V[prevC]) {
            attributeSeam = true;
            break;
          }
        }
        if (attributeSeam) {
          cornerToPointMap[c] = numPoints++;
        } else {
          cornerToPointMap[c] = cornerToPointMap[prevC];
        }
        prevC = c;
        rem = c - ((c / 3) | 0) * 3;
        pv = rem === 0 ? c + 2 : c - 1;
        opp = baseOpp[pv];
        c = opp < 0 ? kInvalidCornerIndex
          : ((opp - ((opp / 3) | 0) * 3) === 0 ? opp + 2 : opp - 1);
      }
    }

    // Add faces.
    const numFaces = mesh.numFaces();
    for (let f = 0; f < numFaces; ++f) {
      const o = 3 * f;
      mesh.setFaceVertices(f,
        cornerToPointMap[o],
        cornerToPointMap[o + 1],
        cornerToPointMap[o + 2]);
    }
    this._decoder.pointCloud().setNumPoints(numPoints);
    return true;
  }

}

// Helper class for mesh attribute indices encoding data.
class MeshAttributeIndicesEncodingData {

  constructor() {
    this._vertexToEncodedAttributeValueIndexMap = [];
    this._encodedAttributeValueIndexToCornerMap = [];
    this._numValues = 0;
  }

  init(numVertices) {
    // Int32Array: written by index only (encoding observer) and read in every
    // parallelogram/texcoord/normal prediction lookup; values are non-negative
    // data indices, so keeping it typed keeps those hot reads monomorphic.
    this._vertexToEncodedAttributeValueIndexMap = new Int32Array(numVertices);
    this._encodedAttributeValueIndexToCornerMap = [];
    this._numValues = 0;
  }

  // Adopts a traversal result computed for an identical corner table, avoiding a
  // redundant full mesh traversal. These maps depend only on connectivity (not
  // on attribute values) and are read-only downstream, so they can be shared.
  adoptTraversalResult(vertexToEncodedMap, encodedToCornerMap, numValues) {
    this._vertexToEncodedAttributeValueIndexMap = vertexToEncodedMap;
    this._encodedAttributeValueIndexToCornerMap = encodedToCornerMap;
    this._numValues = numValues;
  }

  get vertexToEncodedAttributeValueIndexMap() {
    return this._vertexToEncodedAttributeValueIndexMap;
  }

  get encodedAttributeValueIndexToCornerMap() {
    return this._encodedAttributeValueIndexToCornerMap;
  }

  get numValues() {
    return this._numValues;
  }

  set numValues(val) {
    this._numValues = val;
  }

}

// Per-attribute data used by the edgebreaker decoder.
class AttributeData {

  constructor() {
    this.decoderId = -1;
    this.connectivityData = new MeshAttributeCornerTable();
    this.isConnectivityUsed = true;
    this.encodingData = new MeshAttributeIndicesEncodingData();
    this.attributeSeamCorners = [];
  }

}

// Minimal CornerTable class for use within the decoder.
// The full CornerTable would be in the mesh module.
class CornerTable {

  constructor() {
    this._numFaces = 0;
    this._numCorners = 0;
    this._numVertices = 0;
    // For each corner, the vertex it maps to.
    this._cornerToVertex = null;
    // For each corner, the opposite corner.
    this._oppositeCorners = null;
    // For each vertex, the left-most corner.
    this._vertexCorners = null;
  }

  reset(numFaces, numVertices) {
    this._numFaces = numFaces;
    this._numCorners = numFaces * 3;
    // C++ uses reserve() which allocates capacity but keeps size at 0.
    // Vertices are added incrementally via addNewVertex().
    this._numVertices = 0;
    this._cornerToVertex = new Int32Array(this._numCorners).fill(-1);
    this._oppositeCorners = new Int32Array(this._numCorners).fill(-1);
    this._vertexCorners = new Int32Array(numVertices).fill(-1);
    return true;
  }

  numFaces() {
    return this._numFaces;
  }

  numCorners() {
    return this._numCorners;
  }

  numVertices() {
    return this._numVertices;
  }

  // Corner traversal.
  next(corner) {
    if (corner < 0) return -1;
    const rem = corner - ((corner / 3) | 0) * 3;
    return rem === 2 ? corner - 2 : corner + 1;
  }

  previous(corner) {
    if (corner < 0) return -1;
    const rem = corner - ((corner / 3) | 0) * 3;
    return rem === 0 ? corner + 2 : corner - 1;
  }

  face(corner) {
    if (corner < 0) return -1;
    return (corner / 3) | 0;
  }

  // Get the vertex at a corner.
  vertex(corner) {
    if (corner < 0 || corner >= this._numCorners) return -1;
    return this._cornerToVertex[corner];
  }

  // Get the opposite corner.
  opposite(corner) {
    if (corner < 0 || corner >= this._numCorners) return -1;
    return this._oppositeCorners[corner];
  }

  // Get the left-most corner of a vertex.
  leftMostCorner(vertex) {
    if (vertex < 0 || vertex >= this._numVertices) return -1;
    return this._vertexCorners[vertex];
  }

  // --- Flat-array accessors used by DepthFirstTraverser to avoid polymorphic
  // per-corner method dispatch in the traversal hot loop. ---
  cornerToVertexArray() {
    return this._cornerToVertex;
  }
  oppositeCornerArray() {
    return this._oppositeCorners;
  }
  vertexLeftmostCornerArray() {
    return this._vertexCorners;
  }

  // Map a corner to a vertex.
  mapCornerToVertex(corner, vertex) {
    this._cornerToVertex[corner] = vertex;
  }

  // Set the opposite corner.
  setOppositeCorner(corner, opposite) {
    this._oppositeCorners[corner] = opposite;
  }

  // Set the left-most corner of a vertex.
  setLeftMostCorner(vertex, corner) {
    if (vertex >= 0 && vertex < this._numVertices) {
      this._vertexCorners[vertex] = corner;
    }
  }

  // Add a new vertex. Mirrors C++ CornerTable::AddNewVertex() which does
  // vertex_corners_.push_back(kInvalidCornerIndex).
  addNewVertex() {
    const newVertex = this._numVertices;
    this._numVertices++;
    // The array was pre-allocated with capacity in reset().
    // Extend only if we exceed that capacity.
    if (newVertex >= this._vertexCorners.length) {
      const newArr = new Int32Array(this._vertexCorners.length + 64);
      newArr.fill(-1);
      newArr.set(this._vertexCorners);
      this._vertexCorners = newArr;
    }
    this._vertexCorners[newVertex] = -1;
    return newVertex;
  }

  // Make a vertex isolated (no corners point to it).
  makeVertexIsolated(vertex) {
    if (vertex >= 0 && vertex < this._numVertices) {
      this._vertexCorners[vertex] = -1;
    }
  }

  // GetLeftCorner(c) = Opposite(Previous(c))
  getLeftCorner(corner) {
    if (corner < 0) return -1;
    return this.opposite(this.previous(corner));
  }

  // GetRightCorner(c) = Opposite(Next(c))
  getRightCorner(corner) {
    if (corner < 0) return -1;
    return this.opposite(this.next(corner));
  }

  isOnBoundary(vert) {
    const corner = this.leftMostCorner(vert);
    if (corner < 0) return true;
    return this.swingLeft(corner) < 0;
  }

  // Swing left: go to the next corner around a vertex in the CCW direction.
  // SwingLeft(c) = Next(Opposite(Next(c)))
  swingLeft(corner) {
    const nextCorner = this.next(corner);
    const oppCorner = this.opposite(nextCorner);
    if (oppCorner < 0) return -1;
    return this.next(oppCorner);
  }

  // Swing right: go to the next corner around a vertex in the CW direction.
  // SwingRight(c) = Previous(Opposite(Previous(c)))
  swingRight(corner) {
    const prevCorner = this.previous(corner);
    const oppCorner = this.opposite(prevCorner);
    if (oppCorner < 0) return -1;
    return this.previous(oppCorner);
  }

}

// compression/mesh/MeshEdgebreakerTraversalDecoder.js - ported from mesh/mesh_edgebreaker_traversal_decoder.h


// Default implementation of the edgebreaker traversal decoder that reads the
// traversal data directly from a buffer.
class MeshEdgebreakerTraversalDecoder {

  constructor() {
    this._buffer = new DecoderBuffer();
    this._symbolBuffer = new DecoderBuffer();
    this._startFaceDecoder = null; // RAnsBitDecoder
    this._startFaceBuffer = new DecoderBuffer();
    this._attributeConnectivityDecoders = null; // Array of RAnsBitDecoder
    this._numAttributeData = 0;
    this._decoderImpl = null;
  }

  init(decoder) {
    this._decoderImpl = decoder;
    const srcBuffer = decoder.getDecoder().buffer();
    this._buffer.init(
      srcBuffer.dataHead,
      srcBuffer.remainingSize,
      srcBuffer.bitstreamVersion
    );
  }

  // Returns the Draco bitstream version.
  bitstreamVersion() {
    return this._decoderImpl.getDecoder().bitstreamVersion();
  }

  // Used to tell the decoder what is the number of expected decoded vertices.
  // Ignored by default.
  setNumEncodedVertices(/* numVertices */) {}

  // Set the number of non-position attribute data for which we need to decode
  // the connectivity.
  setNumAttributeData(numData) {
    this._numAttributeData = numData;
  }

  // Called before the traversal decoding is started.
  // Returns true on success and sets outBuffer to data encoded after traversal.
  start(outBuffer) {
    // Decode symbols from the main buffer decoder and face configurations from
    // the start_face_buffer decoder.
    if (!this.decodeTraversalSymbols()) {
      return false;
    }
    if (!this.decodeStartFaces()) {
      return false;
    }
    if (!this.decodeAttributeSeams()) {
      return false;
    }
    // Copy buffer state to outBuffer.
    outBuffer.init(
      this._buffer.dataHead,
      this._buffer.remainingSize,
      this._buffer.bitstreamVersion
    );
    return true;
  }

  // Returns the configuration of a new initial face.
  decodeStartFaceConfiguration() {
    if (this._buffer.bitstreamVersion < DRACO_BITSTREAM_VERSION(2, 2)) {
      const faceConfiguration = this._startFaceBuffer.decodeLeastSignificantBits32(1);
      return faceConfiguration ? true : false;
    } else {
      if (this._startFaceDecoder === null) return false;
      return this._startFaceDecoder.decodeNextBit() ? true : false;
    }
  }

  // Returns the next edgebreaker symbol that was reached during the traversal.
  decodeSymbol() {
    let symbol = this._symbolBuffer.decodeLeastSignificantBits32(1);
    if (symbol === TOPOLOGY_C) {
      return symbol;
    }
    // Else decode two additional bits.
    const symbolSuffix = this._symbolBuffer.decodeLeastSignificantBits32(2);
    symbol |= (symbolSuffix << 1);
    return symbol;
  }

  // Called whenever a new active corner is set in the decoder.
  newActiveCornerReached(/* corner */) {}

  // Called whenever source vertex is about to be merged into the dest vertex.
  mergeVertices(/* dest, source */) {}

  // Returns true if there is an attribute seam for the next processed pair
  // of visited faces.
  decodeAttributeSeam(attribute) {
    return this._attributeConnectivityDecoders[attribute].decodeNextBit() ? true : false;
  }

  // Called when the traversal is finished.
  done() {
    if (this._symbolBuffer.bitDecoderActive) {
      this._symbolBuffer.endBitDecoding();
    }
    if (this._buffer.bitstreamVersion < DRACO_BITSTREAM_VERSION(2, 2)) {
      this._startFaceBuffer.endBitDecoding();
    } else {
      if (this._startFaceDecoder !== null) {
        this._startFaceDecoder.endDecoding();
      }
    }
  }

  // -- Protected methods --

  get buffer() {
    return this._buffer;
  }

  decodeTraversalSymbols() {
    // Copy current buffer state to symbolBuffer.
    this._symbolBuffer.init(
      this._buffer.dataHead,
      this._buffer.remainingSize,
      this._buffer.bitstreamVersion
    );
    const traversalSize = this._symbolBuffer.startBitDecoding(true);
    if (traversalSize === undefined) {
      return false;
    }
    // Update buffer to point after the symbol data.
    this._buffer.init(
      this._symbolBuffer.dataHead,
      this._symbolBuffer.remainingSize,
      this._symbolBuffer.bitstreamVersion
    );
    if (traversalSize > this._buffer.remainingSize) {
      return false;
    }
    this._buffer.advance(traversalSize);
    return true;
  }

  decodeStartFaces() {
    if (this._buffer.bitstreamVersion < DRACO_BITSTREAM_VERSION(2, 2)) {
      this._startFaceBuffer.init(
        this._buffer.dataHead,
        this._buffer.remainingSize,
        this._buffer.bitstreamVersion
      );
      const traversalSize = this._startFaceBuffer.startBitDecoding(true);
      if (traversalSize === undefined) {
        return false;
      }
      this._buffer.init(
        this._startFaceBuffer.dataHead,
        this._startFaceBuffer.remainingSize,
        this._startFaceBuffer.bitstreamVersion
      );
      if (traversalSize > this._buffer.remainingSize) {
        return false;
      }
      this._buffer.advance(traversalSize);
      return true;
    }
    // For version >= 2.2, use the RAnsBitDecoder for start faces.
    // The RAnsBitDecoder must be provided from the bit_coders module.
    // Placeholder: create a lazy-loaded decoder.
    try {
      // Dynamically create RAnsBitDecoder if available
      this._startFaceDecoder = this._createRAnsBitDecoder();
      if (this._startFaceDecoder === null) {
        return false;
      }
      return this._startFaceDecoder.startDecoding(this._buffer);
    } catch (e) {
      return false;
    }
  }

  decodeAttributeSeams() {
    if (this._numAttributeData > 0) {
      this._attributeConnectivityDecoders = [];
      for (let i = 0; i < this._numAttributeData; ++i) {
        const decoder = this._createRAnsBitDecoder();
        if (decoder === null) {
          return false;
        }
        if (!decoder.startDecoding(this._buffer)) {
          return false;
        }
        this._attributeConnectivityDecoders.push(decoder);
      }
    }
    return true;
  }

  // Factory method for creating a RAnsBitDecoder.
  _createRAnsBitDecoder() {
    return new RAnsBitDecoder();
  }

}

// compression/mesh/MeshEdgebreakerTraversalPredictiveDecoder.js - ported from mesh/mesh_edgebreaker_traversal_predictive_decoder.h


// Decoder for traversal encoded with the
// MeshEdgebreakerTraversalPredictiveEncoder. The decoder maintains valences
// of the decoded portion of the traversed mesh and it uses them to predict
// symbols that are about to be decoded.
class MeshEdgebreakerTraversalPredictiveDecoder extends MeshEdgebreakerTraversalDecoder {

  constructor() {
    super();
    this._cornerTable = null;
    this._numVertices = 0;
    this._lastSymbol = -1;
    this._predictedSymbol = -1;
    this._vertexValences = [];
    this._predictionDecoder = null; // RAnsBitDecoder
  }

  init(decoder) {
    super.init(decoder);
    this._cornerTable = decoder.getCornerTable();
  }

  setNumEncodedVertices(numVertices) {
    this._numVertices = numVertices;
  }

  start(outBuffer) {
    if (!super.start(outBuffer)) {
      return false;
    }
    const numSplitSymbols = outBuffer.decodeInt32();
    if (numSplitSymbols === undefined || numSplitSymbols < 0) {
      return false;
    }
    if (numSplitSymbols >= this._numVertices) {
      return false;
    }
    // Set the valences of all initial vertices to 0.
    this._vertexValences = new Array(this._numVertices).fill(0);
    this._predictionDecoder = this._createRAnsBitDecoder();
    if (this._predictionDecoder === null) {
      return false;
    }
    if (!this._predictionDecoder.startDecoding(outBuffer)) {
      return false;
    }
    return true;
  }

  decodeSymbol() {
    // First check if we have a predicted symbol.
    if (this._predictedSymbol !== -1) {
      // Double check that the predicted symbol was predicted correctly.
      if (this._predictionDecoder.decodeNextBit()) {
        this._lastSymbol = this._predictedSymbol;
        return this._predictedSymbol;
      }
    }
    // We don't have a predicted symbol or the symbol was mis-predicted.
    // Decode it directly.
    this._lastSymbol = super.decodeSymbol();
    return this._lastSymbol;
  }

  newActiveCornerReached(corner) {
    const ct = this._cornerTable;
    const next = ct.next(corner);
    const prev = ct.previous(corner);

    // Update valences.
    switch (this._lastSymbol) {
      case TOPOLOGY_C:
      case TOPOLOGY_S:
        this._vertexValences[ct.vertex(next)] += 1;
        this._vertexValences[ct.vertex(prev)] += 1;
        break;
      case TOPOLOGY_R:
        this._vertexValences[ct.vertex(corner)] += 1;
        this._vertexValences[ct.vertex(next)] += 1;
        this._vertexValences[ct.vertex(prev)] += 2;
        break;
      case TOPOLOGY_L:
        this._vertexValences[ct.vertex(corner)] += 1;
        this._vertexValences[ct.vertex(next)] += 2;
        this._vertexValences[ct.vertex(prev)] += 1;
        break;
      case TOPOLOGY_E:
        this._vertexValences[ct.vertex(corner)] += 2;
        this._vertexValences[ct.vertex(next)] += 2;
        this._vertexValences[ct.vertex(prev)] += 2;
        break;
    }

    // Compute the new predicted symbol.
    if (this._lastSymbol === TOPOLOGY_C || this._lastSymbol === TOPOLOGY_R) {
      const pivot = ct.vertex(ct.next(corner));
      if (this._vertexValences[pivot] < 6) {
        this._predictedSymbol = TOPOLOGY_R;
      } else {
        this._predictedSymbol = TOPOLOGY_C;
      }
    } else {
      this._predictedSymbol = -1;
    }
  }

  mergeVertices(dest, source) {
    // Update valences on the merged vertices.
    this._vertexValences[dest] += this._vertexValences[source];
  }

}

// compression/mesh/MeshEdgebreakerTraversalValenceDecoder.js - ported from mesh/mesh_edgebreaker_traversal_valence_decoder.h


// Decoder for traversal encoded with MeshEdgebreakerTraversalValenceEncoder.
// The decoder maintains valences of the decoded portion of the traversed mesh
// and it uses them to select entropy context used for decoding of the actual
// symbols.
class MeshEdgebreakerTraversalValenceDecoder extends MeshEdgebreakerTraversalDecoder {

  constructor() {
    super();
    this._cornerTable = null;
    this._numVertices = 0;
    this._lastSymbol = -1;
    this._activeContext = -1;
    this._minValence = 2;
    this._maxValence = 7;
    this._vertexValences = [];
    this._contextSymbols = [];
    this._contextCounters = [];
  }

  init(decoder) {
    super.init(decoder);
    this._cornerTable = decoder.getCornerTable();
  }

  setNumEncodedVertices(numVertices) {
    this._numVertices = numVertices;
  }

  start(outBuffer) {
    if (this.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 2)) {
      if (!this.decodeTraversalSymbols()) {
        return false;
      }
    }

    if (!this.decodeStartFaces()) {
      return false;
    }
    if (!this.decodeAttributeSeams()) {
      return false;
    }
    outBuffer.init(
      this.buffer.dataHead,
      this.buffer.remainingSize,
      this.buffer.bitstreamVersion
    );

    if (this.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 2)) {
      let numSplitSymbols;
      if (this.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 0)) {
        numSplitSymbols = outBuffer.decodeUint32();
        if (numSplitSymbols === undefined) return false;
      } else {
        numSplitSymbols = decodeVarint(outBuffer);
        if (numSplitSymbols === undefined) return false;
      }
      if (numSplitSymbols >= this._numVertices) {
        return false;
      }
      const mode = outBuffer.decodeInt8();
      if (mode === undefined) return false;
      if (mode === EDGEBREAKER_VALENCE_MODE_2_7) {
        this._minValence = 2;
        this._maxValence = 7;
      } else {
        // Unsupported mode.
        return false;
      }
    } else {
      this._minValence = 2;
      this._maxValence = 7;
    }

    if (this._numVertices < 0) {
      return false;
    }
    // Set the valences of all initial vertices to 0.
    this._vertexValences = new Array(this._numVertices).fill(0);

    const numUniqueValences = this._maxValence - this._minValence + 1;

    // Decode all symbols for all contexts.
    this._contextSymbols = new Array(numUniqueValences);
    this._contextCounters = new Array(numUniqueValences);

    for (let i = 0; i < numUniqueValences; ++i) {
      const numSymbols = decodeVarint(outBuffer);
      if (numSymbols === undefined) {
        return false;
      }
      if (numSymbols > this._cornerTable.numFaces()) {
        return false;
      }
      if (numSymbols > 0) {
        this._contextSymbols[i] = new Uint32Array(numSymbols);
        if (!decodeSymbols(numSymbols, 1, outBuffer, this._contextSymbols[i])) {
          return false;
        }
        // All symbols are going to be processed from the back.
        this._contextCounters[i] = numSymbols;
      } else {
        this._contextSymbols[i] = new Uint32Array(0);
        this._contextCounters[i] = 0;
      }
    }
    return true;
  }

  decodeSymbol() {
    // First check if we have a valid context.
    if (this._activeContext !== -1) {
      const contextCounter = --this._contextCounters[this._activeContext];
      if (contextCounter < 0) {
        return TOPOLOGY_INVALID;
      }
      const symbolId = this._contextSymbols[this._activeContext][contextCounter];
      if (symbolId > 4) {
        return TOPOLOGY_INVALID;
      }
      this._lastSymbol = edgeBreakerSymbolToTopologyId[symbolId];
    } else {
      if (this.bitstreamVersion() < DRACO_BITSTREAM_VERSION(2, 2)) {
        // We don't have a predicted symbol or the symbol was mis-predicted.
        // Decode it directly.
        this._lastSymbol = super.decodeSymbol();
      } else {
        // The first symbol must be E.
        this._lastSymbol = TOPOLOGY_E;
      }
    }
    return this._lastSymbol;
  }

  newActiveCornerReached(corner) {
    const ct = this._cornerTable;
    const next = ct.next(corner);
    const prev = ct.previous(corner);

    // Update valences.
    switch (this._lastSymbol) {
      case TOPOLOGY_C:
      case TOPOLOGY_S:
        this._vertexValences[ct.vertex(next)] += 1;
        this._vertexValences[ct.vertex(prev)] += 1;
        break;
      case TOPOLOGY_R:
        this._vertexValences[ct.vertex(corner)] += 1;
        this._vertexValences[ct.vertex(next)] += 1;
        this._vertexValences[ct.vertex(prev)] += 2;
        break;
      case TOPOLOGY_L:
        this._vertexValences[ct.vertex(corner)] += 1;
        this._vertexValences[ct.vertex(next)] += 2;
        this._vertexValences[ct.vertex(prev)] += 1;
        break;
      case TOPOLOGY_E:
        this._vertexValences[ct.vertex(corner)] += 2;
        this._vertexValences[ct.vertex(next)] += 2;
        this._vertexValences[ct.vertex(prev)] += 2;
        break;
    }

    // Compute the new context that is going to be used to decode the next
    // symbol.
    const activeValence = this._vertexValences[ct.vertex(next)];
    let clampedValence;
    if (activeValence < this._minValence) {
      clampedValence = this._minValence;
    } else if (activeValence > this._maxValence) {
      clampedValence = this._maxValence;
    } else {
      clampedValence = activeValence;
    }
    this._activeContext = clampedValence - this._minValence;
  }

  mergeVertices(dest, source) {
    // Update valences on the merged vertices.
    this._vertexValences[dest] += this._vertexValences[source];
  }

}

// compression/mesh/MeshEdgebreakerDecoder.js - ported from mesh/mesh_edgebreaker_decoder.h/cc


// Class for decoding data encoded by MeshEdgebreakerEncoder.
class MeshEdgebreakerDecoder extends MeshDecoder {

  constructor() {
    super();
    this._impl = null;
  }

  getCornerTable() {
    return this._impl ? this._impl.getCornerTable() : null;
  }

  getAttributeCornerTable(attId) {
    return this._impl ? this._impl.getAttributeCornerTable(attId) : null;
  }

  getAttributeEncodingData(attId) {
    return this._impl ? this._impl.getAttributeEncodingData(attId) : null;
  }

  initializeDecoder() {
    const traversalDecoderType = this.buffer().decodeUint8();
    if (traversalDecoderType === undefined) {
      return false;
    }

    this._impl = null;

    if (traversalDecoderType ===
        MeshEdgebreakerConnectivityEncodingMethod.MESH_EDGEBREAKER_STANDARD_ENCODING) {
      this._impl = new MeshEdgebreakerDecoderImpl(
        MeshEdgebreakerTraversalDecoder);
    } else if (traversalDecoderType ===
        MeshEdgebreakerConnectivityEncodingMethod.MESH_EDGEBREAKER_PREDICTIVE_ENCODING) {
      this._impl = new MeshEdgebreakerDecoderImpl(
        MeshEdgebreakerTraversalPredictiveDecoder);
    } else if (traversalDecoderType ===
        MeshEdgebreakerConnectivityEncodingMethod.MESH_EDGEBREAKER_VALENCE_ENCODING) {
      this._impl = new MeshEdgebreakerDecoderImpl(
        MeshEdgebreakerTraversalValenceDecoder);
    }

    if (!this._impl) {
      return false;
    }
    if (!this._impl.init(this)) {
      return false;
    }
    return true;
  }

  createAttributesDecoder(attDecoderId) {
    return this._impl.createAttributesDecoder(attDecoderId);
  }

  decodeConnectivity() {
    return this._impl.decodeConnectivity();
  }

  onAttributesDecoded() {
    return this._impl.onAttributesDecoded();
  }

}

// compression/Decode.js - ported from compression/decode.h/cc


// Decodes the Draco header from the buffer. Returns { header, ok, message }.
function decodeHeader(buffer) {

  const header = new DracoHeader();

  // Read 5-byte magic string "DRACO"
  for (let i = 0; i < 5; ++i) {

    const byte = buffer.decodeInt8();
    if (byte === undefined) {
      return { header: null, ok: false, message: 'Failed to read header magic bytes.' };
    }

    header.dracoString[i] = byte;

  }

  // Verify magic string
  const magic = String.fromCharCode(
    header.dracoString[0] & 0xFF,
    header.dracoString[1] & 0xFF,
    header.dracoString[2] & 0xFF,
    header.dracoString[3] & 0xFF,
    header.dracoString[4] & 0xFF
  );

  if (magic !== 'DRACO') {
    return { header: null, ok: false, message: 'Not a Draco encoded file.' };
  }

  // Read version
  header.versionMajor = buffer.decodeUint8();
  if (header.versionMajor === undefined) {
    return { header: null, ok: false, message: 'Failed to read version major.' };
  }

  header.versionMinor = buffer.decodeUint8();
  if (header.versionMinor === undefined) {
    return { header: null, ok: false, message: 'Failed to read version minor.' };
  }

  // Read encoder type
  header.encoderType = buffer.decodeUint8();
  if (header.encoderType === undefined) {
    return { header: null, ok: false, message: 'Failed to read encoder type.' };
  }

  // Read encoder method
  header.encoderMethod = buffer.decodeUint8();
  if (header.encoderMethod === undefined) {
    return { header: null, ok: false, message: 'Failed to read encoder method.' };
  }

  // Read flags
  header.flags = buffer.decodeUint16();
  if (header.flags === undefined) {
    return { header: null, ok: false, message: 'Failed to read flags.' };
  }

  return { header, ok: true, message: '' };

}

// Creates a point cloud decoder based on the encoding method.
function createPointCloudDecoder(method) {

  if (method === PointCloudEncodingMethod.POINT_CLOUD_SEQUENTIAL_ENCODING) {

    return new PointCloudSequentialDecoder();

  } else if (method === PointCloudEncodingMethod.POINT_CLOUD_KD_TREE_ENCODING) {

    return new PointCloudKdTreeDecoder();

  }

  throw new Error('Unsupported point cloud encoding method.');

}

// Creates a mesh decoder based on the encoding method.
function createMeshDecoder(method) {

  if (method === MeshEncoderMethod.MESH_SEQUENTIAL_ENCODING) {

    return new MeshSequentialDecoder();

  } else if (method === MeshEncoderMethod.MESH_EDGEBREAKER_ENCODING) {

    return new MeshEdgebreakerDecoder();

  }

  throw new Error('Unsupported mesh encoding method.');

}

// Class responsible for decoding meshes and point clouds that were
// compressed by a Draco encoder.
class Decoder {

  constructor() {

    this.options_ = new DecoderOptions();

  }

  // Returns the geometry type encoded in the input buffer.
  // The return value is one of EncodedGeometryType values:
  // POINT_CLOUD, TRIANGULAR_MESH, or INVALID_GEOMETRY_TYPE on error.
  static getEncodedGeometryType(inBuffer) {

    // Use a copy of the buffer so we don't advance the original position.
    const tempBuffer = new DecoderBuffer();
    tempBuffer.init(inBuffer.data, inBuffer.data.length);
    tempBuffer.bitstreamVersion = inBuffer.bitstreamVersion;
    // Restore position to match the original buffer's current position.
    tempBuffer.advance(inBuffer.decodedSize);

    const result = decodeHeader(tempBuffer);
    if (!result.ok) {
      return EncodedGeometryType.INVALID_GEOMETRY_TYPE;
    }

    if (result.header.encoderType >= EncodedGeometryType.NUM_ENCODED_GEOMETRY_TYPES) {
      return EncodedGeometryType.INVALID_GEOMETRY_TYPE;
    }

    return result.header.encoderType;

  }

  // Decodes point cloud from the provided buffer. If the input contains a
  // mesh, the returned instance will be a Mesh (which extends PointCloud).
  // Returns { pointCloud, ok, message }.
  decodePointCloudFromBuffer(inBuffer) {

    const type = Decoder.getEncodedGeometryType(inBuffer);

    if (type === EncodedGeometryType.POINT_CLOUD) {

      const pointCloud = new PointCloud();
      const status = this.decodeBufferToPointCloud(inBuffer, pointCloud);
      if (!status.ok) {
        return { pointCloud: null, ok: false, message: status.message };
      }

      return { pointCloud, ok: true, message: '' };

    } else if (type === EncodedGeometryType.TRIANGULAR_MESH) {

      const mesh = new Mesh();
      const status = this.decodeBufferToMesh(inBuffer, mesh);
      if (!status.ok) {
        return { pointCloud: null, ok: false, message: status.message };
      }

      return { pointCloud: mesh, ok: true, message: '' };

    }

    return { pointCloud: null, ok: false, message: 'Unsupported geometry type.' };

  }

  // Decodes a triangular mesh from the provided buffer.
  // Returns { mesh, ok, message }.
  decodeMeshFromBuffer(inBuffer) {

    const mesh = new Mesh();
    const status = this.decodeBufferToMesh(inBuffer, mesh);
    if (!status.ok) {
      return { mesh: null, ok: false, message: status.message };
    }

    return { mesh, ok: true, message: '' };

  }

  // Decodes the buffer into a provided PointCloud geometry.
  // Returns { ok, message }.
  decodeBufferToPointCloud(inBuffer, outGeometry) {

    // Read header from a temporary copy to check type without advancing inBuffer.
    const tempBuffer = new DecoderBuffer();
    tempBuffer.init(inBuffer.data, inBuffer.data.length);
    tempBuffer.bitstreamVersion = inBuffer.bitstreamVersion;
    tempBuffer.advance(inBuffer.decodedSize);

    const result = decodeHeader(tempBuffer);
    if (!result.ok) {
      return { ok: false, message: result.message };
    }

    if (result.header.encoderType !== EncodedGeometryType.POINT_CLOUD) {
      return { ok: false, message: 'Input is not a point cloud.' };
    }

    const decoder = createPointCloudDecoder(result.header.encoderMethod);
    return decoder.decode(this.options_, inBuffer, outGeometry);

  }

  // Decodes the buffer into a provided Mesh geometry.
  // Returns { ok, message }.
  decodeBufferToMesh(inBuffer, outGeometry) {

    // Read header from a temporary copy to check type without advancing inBuffer.
    const tempBuffer = new DecoderBuffer();
    tempBuffer.init(inBuffer.data, inBuffer.data.length);
    tempBuffer.bitstreamVersion = inBuffer.bitstreamVersion;
    tempBuffer.advance(inBuffer.decodedSize);

    const result = decodeHeader(tempBuffer);
    if (!result.ok) {
      return { ok: false, message: result.message };
    }

    if (result.header.encoderType !== EncodedGeometryType.TRIANGULAR_MESH) {
      return { ok: false, message: 'Input is not a mesh.' };
    }

    const decoder = createMeshDecoder(result.header.encoderMethod);
    return decoder.decodeMesh(this.options_, inBuffer, outGeometry);

  }

  // When set, the decoder will skip the attribute transform for a given
  // attribute type. For example, for quantized attributes the decoder would
  // skip the dequantization step.
  setSkipAttributeTransform(attType) {

    this.options_.setAttributeBool(attType, 'skip_attribute_transform', true);

  }

  // Returns the options instance used by the decoder.
  options() {

    return this.options_;

  }

}

const _taskCache = new WeakMap();

const _attributeTypeMap = {
	'POSITION': 0,
	'NORMAL': 1,
	'COLOR': 2,
	'TEX_COORD': 3,
	'GENERIC': 4
};

const _typedArrayMap = {
	'Float32Array': Float32Array,
	'Int8Array': Int8Array,
	'Int16Array': Int16Array,
	'Int32Array': Int32Array,
	'Uint8Array': Uint8Array,
	'Uint16Array': Uint16Array,
	'Uint32Array': Uint32Array
};

class DRACOLoader extends Loader {

	constructor( manager ) {

		super( manager );

		this.defaultAttributeIDs = {
			position: 'POSITION',
			normal: 'NORMAL',
			color: 'COLOR',
			uv: 'TEX_COORD'
		};

		this.defaultAttributeTypes = {
			position: 'Float32Array',
			normal: 'Float32Array',
			color: 'Float32Array',
			uv: 'Float32Array'
		};

	}

	setDecoderPath() {

		return this;

	}

	setDecoderConfig() {

		return this;

	}

	setWorkerLimit() {

		return this;

	}

	load( url, onLoad, onProgress, onError ) {

		const loader = new FileLoader( this.manager );

		loader.setPath( this.path );
		loader.setResponseType( 'arraybuffer' );
		loader.setRequestHeader( this.requestHeader );
		loader.setWithCredentials( this.withCredentials );

		loader.load( url, ( buffer ) => {

			this.parse( buffer, onLoad, onError );

		}, onProgress, onError );

	}

	parse( buffer, onLoad, onError = () => {} ) {

		this.decodeDracoFile( buffer, onLoad, null, null, SRGBColorSpace, onError ).catch( onError );

	}

	decodeDracoFile( buffer, callback, attributeIDs, attributeTypes, vertexColorSpace = LinearSRGBColorSpace, onError = () => {} ) {

		const taskConfig = {
			attributeIDs: attributeIDs || this.defaultAttributeIDs,
			attributeTypes: attributeTypes || this.defaultAttributeTypes,
			useUniqueIDs: !! attributeIDs,
			vertexColorSpace: vertexColorSpace,
		};

		return this.decodeGeometry( buffer, taskConfig ).then( callback ).catch( onError );

	}

	decodeGeometry( buffer, taskConfig ) {

		const taskKey = JSON.stringify( taskConfig );

		if ( _taskCache.has( buffer ) ) {

			const cachedTask = _taskCache.get( buffer );

			if ( cachedTask.key === taskKey ) {

				return cachedTask.promise;

			} else if ( buffer.byteLength === 0 ) {

				throw new Error(

					'THREE.DRACOLoader: Unable to re-decode a buffer with different ' +
					'settings. Buffer has already been transferred.'

				);

			}

		}

		const geometryPending = new Promise( ( resolve, reject ) => {

			try {

				const geometry = this._decodeBuffer( buffer, taskConfig );
				resolve( geometry );

			} catch ( e ) {

				reject( e );

			}

		} );

		_taskCache.set( buffer, {

			key: taskKey,
			promise: geometryPending

		} );

		return geometryPending;

	}

	_decodeBuffer( buffer, taskConfig ) {

		const byteArray = new Uint8Array( buffer );
		const decoderBuffer = new DecoderBuffer();
		decoderBuffer.init( byteArray, byteArray.length );

		const geometryType = Decoder.getEncodedGeometryType( decoderBuffer );

		const decoder = new Decoder();
		let dracoGeometry;
		let isMesh;

		if ( geometryType === EncodedGeometryType.TRIANGULAR_MESH ) {

			const result = decoder.decodeMeshFromBuffer( decoderBuffer );

			if ( ! result.ok ) {

				throw new Error( 'THREE.DRACOLoader: ' + result.message );

			}

			dracoGeometry = result.mesh;
			isMesh = true;

		} else if ( geometryType === EncodedGeometryType.POINT_CLOUD ) {

			const result = decoder.decodePointCloudFromBuffer( decoderBuffer );

			if ( ! result.ok ) {

				throw new Error( 'THREE.DRACOLoader: ' + result.message );

			}

			dracoGeometry = result.pointCloud;
			isMesh = false;

		} else {

			throw new Error( 'THREE.DRACOLoader: Unexpected geometry type.' );

		}

		return this._buildGeometry( dracoGeometry, isMesh, taskConfig );

	}

	_buildGeometry( dracoGeometry, isMesh, taskConfig ) {

		const attributeIDs = taskConfig.attributeIDs;
		const attributeTypes = taskConfig.attributeTypes;

		const geometry = new BufferGeometry();
		const numPoints = dracoGeometry.numPoints();

		// Extract requested attributes.

		for ( const attributeName in attributeIDs ) {

			const OutputTypedArray = _typedArrayMap[ attributeTypes[ attributeName ] ];
			if ( ! OutputTypedArray ) continue;

			let attribute;

			if ( taskConfig.useUniqueIDs ) {

				const uniqueId = attributeIDs[ attributeName ];
				attribute = dracoGeometry.getAttributeByUniqueId( uniqueId );

			} else {

				const typeEnum = _attributeTypeMap[ attributeIDs[ attributeName ] ];
				if ( typeEnum === undefined ) continue;

				attribute = dracoGeometry.getNamedAttribute( typeEnum );

			}

			if ( ! attribute ) continue;

			const itemSize = attribute.numComponents;
			const array = this._extractAttributeData( dracoGeometry, attribute, numPoints, OutputTypedArray );

			const bufferAttribute = new BufferAttribute( array, itemSize );

			if ( attributeName === 'color' ) {

				this._assignVertexColorSpace( bufferAttribute, taskConfig.vertexColorSpace );
				bufferAttribute.normalized = ( array instanceof Float32Array ) === false;

			}

			geometry.setAttribute( attributeName, bufferAttribute );

		}

		// Extract face indices.

		if ( isMesh ) {

			const numFaces = dracoGeometry.numFaces();
			const index = new Uint32Array( numFaces * 3 );

			for ( let i = 0; i < numFaces; i ++ ) {

				const face = dracoGeometry.face( i );
				index[ i * 3 ] = face[ 0 ];
				index[ i * 3 + 1 ] = face[ 1 ];
				index[ i * 3 + 2 ] = face[ 2 ];

			}

			geometry.setIndex( new BufferAttribute( index, 1 ) );

		}

		return geometry;

	}

	_extractAttributeData( dracoGeometry, attribute, numPoints, OutputTypedArray ) {

		const numComponents = attribute.numComponents;
		const array = new OutputTypedArray( numPoints * numComponents );
		const temp = new Array( numComponents );

		for ( let i = 0; i < numPoints; i ++ ) {

			const attIndex = attribute.mappedIndex( i );
			attribute.convertValue( attIndex, temp );

			const offset = i * numComponents;

			for ( let j = 0; j < numComponents; j ++ ) {

				array[ offset + j ] = temp[ j ];

			}

		}

		return array;

	}

	_assignVertexColorSpace( attribute, inputColorSpace ) {

		if ( inputColorSpace !== SRGBColorSpace ) return;

		const _color = new Color();

		for ( let i = 0, il = attribute.count; i < il; i ++ ) {

			_color.fromBufferAttribute( attribute, i );
			ColorManagement.colorSpaceToWorking( _color, SRGBColorSpace );
			attribute.setXYZ( i, _color.r, _color.g, _color.b );

		}

	}

	preload() {

		return this;

	}

	dispose() {

		return this;

	}

}

export { DRACOLoader };
