/**
 * Draco.js — pure-JavaScript Draco decoder for three.js.
 * https://mrdoob.github.io/draco.js/  @license MIT
 */
import { Loader, FileLoader, BufferGeometry, BufferAttribute, Color, ColorManagement } from 'three';
// MODIFICATION (threepipe): the package build rewrites `from 'three'` to `from 'threepipe'`, which
// does not re-export these two string constants. Define them locally (stable three.js values:
// 'srgb' / 'srgb-linear') so the package needs no extra threepipe surface and stays self-contained.
const SRGBColorSpace = 'srgb';
const LinearSRGBColorSpace = 'srgb-linear';

// compression/config/CompressionShared.js - ported from compression/config/compression_shared.h

// Latest Draco bit-stream versions.
const kDracoPointCloudBitstreamVersionMajor = 2;
const kDracoPointCloudBitstreamVersionMinor = 3;
const kDracoMeshBitstreamVersionMajor = 2;
const kDracoMeshBitstreamVersionMinor = 2;

function DRACO_BITSTREAM_VERSION(major, minor) {
  return (major << 8) | minor;
}

const EncodedGeometryType = {
  INVALID_GEOMETRY_TYPE: -1,
  POINT_CLOUD: 0,
  TRIANGULAR_MESH: 1,
  NUM_ENCODED_GEOMETRY_TYPES: 2
};

const MeshEncoderMethod = {
  MESH_SEQUENTIAL_ENCODING: 0,
  MESH_EDGEBREAKER_ENCODING: 1
};

const SequentialAttributeEncoderType = {
  SEQUENTIAL_ATTRIBUTE_ENCODER_GENERIC: 0,
  SEQUENTIAL_ATTRIBUTE_ENCODER_INTEGER: 1,
  SEQUENTIAL_ATTRIBUTE_ENCODER_QUANTIZATION: 2,
  SEQUENTIAL_ATTRIBUTE_ENCODER_NORMALS: 3
};

const PredictionSchemeMethod = {
  PREDICTION_NONE: -2,
  MESH_PREDICTION_PARALLELOGRAM: 1,
  MESH_PREDICTION_MULTI_PARALLELOGRAM: 2,
  MESH_PREDICTION_CONSTRAINED_MULTI_PARALLELOGRAM: 4,
  MESH_PREDICTION_TEX_COORDS_PORTABLE: 5,
  MESH_PREDICTION_GEOMETRIC_NORMAL: 6,
  NUM_PREDICTION_SCHEMES: 7
};

const PredictionSchemeTransformType = {
  PREDICTION_TRANSFORM_NONE: -1,
  PREDICTION_TRANSFORM_WRAP: 1,
  PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON: 2,
  PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON_CANONICALIZED: 3,
  NUM_PREDICTION_SCHEME_TRANSFORM_TYPES: 4
};

const MeshTraversalMethod = {
  MESH_TRAVERSAL_DEPTH_FIRST: 0,
  MESH_TRAVERSAL_PREDICTION_DEGREE: 1,
  NUM_TRAVERSAL_METHODS: 2
};

const MeshEdgebreakerConnectivityEncodingMethod = {
  MESH_EDGEBREAKER_STANDARD_ENCODING: 0,
  MESH_EDGEBREAKER_PREDICTIVE_ENCODING: 1, // Deprecated.
  MESH_EDGEBREAKER_VALENCE_ENCODING: 2
};

// Draco header V1
class DracoHeader {

  constructor() {
    this.versionMajor = 0;
    this.versionMinor = 0;
    this.encoderType = 0;
    this.encoderMethod = 0;
    this.flags = 0;
  }

}

const SymbolCodingMethod = {
  SYMBOL_CODING_TAGGED: 0,
  SYMBOL_CODING_RAW: 1};

// Mask for setting and getting the bit for metadata in |flags| of header.
const METADATA_FLAG_MASK = 0x8000;

// core/BitUtils.js - ported from bit_utils.h/cc

// Branchless inlined zigzag decode: (val>>>1) ^ -(val&1) avoids a per-value call/branch.
function convertSymbolsToSignedInts(input, count, output) {
  for (let i = 0; i < count; i++) {
    const val = input[i];
    output[i] = (val >>> 1) ^ -(val & 1);
  }
}

function convertSymbolToSignedInt(val) {
  const isPositive = (val & 1) === 0;
  val >>>= 1;
  if (isPositive) {
    return val;
  }
  return -(val) - 1;
}

// core/VarintDecoding.js - ported from varint_decoding.h


// Unsigned varint, MSB continuation coding. Returns undefined on error.
function decodeVarintUnsigned(buffer, maxBytes) {
  let result = 0;
  for (let i = 0; i < maxBytes; i++) {
    const byte = buffer.decodeUint8();
    if (byte === undefined) return undefined;
    if (byte & 0x80) {
      // C++ builds the value MSB-first via recursion (recurse, then shift and OR).
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
      // Last byte read is the most significant.
      result = bytes[bytes.length - 1];
      for (let k = bytes.length - 2; k >= 0; k--) {
        result = (result * 128) + bytes[k];
      }
      return result;
    } else {
      return byte;
    }
  }
  return undefined;
}

// signed applies zigzag decoding. Returns undefined on error.
function decodeVarint(buffer, signed = false) {
  const maxBytes = 10;
  const value = decodeVarintUnsigned(buffer, maxBytes);
  if (value === undefined) return undefined;
  if (signed) {
    return convertSymbolToSignedInt(value);
  }
  return value;
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

  getBits(nbits) {
    if (nbits > 32) return undefined;
    const buf = this._bitBuffer;
    let off = this._bitOffset;
    const byteOffset = off >> 3;
    const bitShift = off & 7;

    // Fast path: enough bytes remain to read 32 bits safely.
    if (byteOffset + 4 < this._byteLength) {
      const val = (buf[byteOffset] | (buf[byteOffset + 1] << 8) | (buf[byteOffset + 2] << 16) | (buf[byteOffset + 3] << 24)) >>> 0;
      let result;
      if (nbits > 32 - bitShift) {
        const val2 = buf[byteOffset + 4];
        const low = val >>> bitShift;
        const high = val2 << (32 - bitShift);
        result = (low | high) >>> 0;
      } else {
        result = val >>> bitShift;
      }

      this._bitOffset = off + nbits;
      return nbits === 32 ? result : (result & ((1 << nbits) - 1));
    }

    // Safe fallback path near the end of the buffer.
    let value = 0;
    let bitsRead = 0;
    let currOff = off;
    while (bitsRead < nbits) {
      const bOff = currOff >> 3;
      if (bOff >= this._byteLength) break;
      const bShift = currOff & 7;
      const bitsAvail = 8 - bShift;
      const bitsNeeded = nbits - bitsRead;
      const bitsToRead = bitsAvail < bitsNeeded ? bitsAvail : bitsNeeded;
      const mask = (1 << bitsToRead) - 1;
      value |= ((buf[bOff] >> bShift) & mask) << bitsRead;
      bitsRead += bitsToRead;
      currOff += bitsToRead;
    }
    this._bitOffset = currOff;
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

  // Typed little-endian reads.
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

  decodeBytes(size) {
    if (this._pos + size > this._dataSize) return undefined;
    const result = this._data.slice(this._pos, this._pos + size);
    this._pos += size;
    return result;
  }

  startBitDecoding(decodeSize) {
    let outSize = 0;
    if (decodeSize) {
      // Mesh decoding rejects pre-2.2 streams before reading any bit data.
      outSize = decodeVarint(this, false);
      if (outSize === undefined) return undefined;
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

  decodeVarintUint32() {
    return decodeVarint(this, false);
  }

  decodeVarintUint64() {
    return decodeVarint(this, false);
  }

  advance(bytes) {
    this._pos += bytes;
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

// Must match the C++ GeometryAttribute::Type enum count.
const NAMED_ATTRIBUTES_COUNT = 8;

class PointCloud {

  constructor() {

    this.num_points_ = 0;
    this.attributes_ = [];

    // named_attribute_index_[type] = [att_id, ...]
    this.named_attribute_index_ = [];
    for (let i = 0; i < NAMED_ATTRIBUTES_COUNT; ++i) {

      this.named_attribute_index_.push([]);

    }

  }

  numNamedAttributes(type) {

    if (type < 0 || type >= NAMED_ATTRIBUTES_COUNT) {
      return 0;
    }

    return this.named_attribute_index_[type].length;

  }

  getNamedAttributeId(type, i) {

    if (i === undefined) i = 0;
    if (this.numNamedAttributes(type) <= i) {
      return -1;
    }

    return this.named_attribute_index_[type][i];

  }

  getNamedAttribute(type, i) {

    if (i === undefined) i = 0;
    const attId = this.getNamedAttributeId(type, i);
    if (attId === -1) {
      return null;
    }

    return this.attributes_[attId];

  }

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

  addAttribute(pa) {

    this.setAttribute(this.attributes_.length, pa);
    return this.attributes_.length - 1;

  }

  setAttribute(attId, pa) {

    if (this.attributes_.length <= attId) {

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

  numPoints() {

    return this.num_points_;

  }

  setNumPoints(num) {

    this.num_points_ = num;

  }

}

// mesh/Mesh.js - ported from mesh/mesh.h/cc


const MeshAttributeElementType = {
  MESH_VERTEX_ATTRIBUTE: 0,
  MESH_CORNER_ATTRIBUTE: 1};

class Mesh extends PointCloud {

  constructor() {

    super();
    // Flat Int32Array, 3 point indices per face, for cache locality and to avoid
    // a per-face allocation. faces_[3*f + c] is corner c of face f; corner index
    // ci maps directly to faces_[ci].
    this.faces_ = new Int32Array(0);
    this.numFaces_ = 0;
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

  setNumFaces(numFaces) {

    this._ensureFaceCapacity(numFaces);
    this.numFaces_ = numFaces;

  }

  numFaces() {

    return this.numFaces_;

  }

  // Allocates a fresh [v0, v1, v2]; hot internal loops read faces_ directly.
  face(faceId) {

    const o = faceId * 3;
    return [this.faces_[o], this.faces_[o + 1], this.faces_[o + 2]];

  }

  setAttribute(attId, pa) {

    super.setAttribute(attId, pa);
    while (this.attribute_data_.length <= attId) {
      this.attribute_data_.push({ elementType: MeshAttributeElementType.MESH_CORNER_ATTRIBUTE });
    }

  }

}

// core/Status.js - ported from status.h/cc

const StatusCode = {
  OK: 0,
  DRACO_ERROR: -1,
  IO_ERROR: -2,
  UNKNOWN_VERSION: -5};

class Status {

  constructor(code = StatusCode.OK, errorMsg = '') {
    this.code = code;
    this.errorMsg = errorMsg;
  }

  ok() {
    return this.code === StatusCode.OK;
  }

}

function okStatus() {
  return new Status(StatusCode.OK);
}

// metadata/MetadataDecoder.js - ported from metadata/metadata_decoder.h/cc
// Metadata is never surfaced, so this only parses far enough to consume the exact
// bytes it occupies, keeping the bitstream aligned. (Full port lives in git history.)


// Nesting-depth cap to avoid stack overflow.
const kMaxSubmetadataLevel = 1000;

class MetadataDecoder {

  constructor() {
    this.buffer_ = null;
  }

  // Skips per-attribute metadata followed by the geometry-level metadata.
  skipGeometryMetadata(inBuffer) {
    this.buffer_ = inBuffer;

    const numAttMetadata = decodeVarint(this.buffer_);
    if (numAttMetadata === undefined) {
      return false;
    }

    for (let i = 0; i < numAttMetadata; ++i) {
      // Attribute unique id, then its metadata block.
      if (decodeVarint(this.buffer_) === undefined) {
        return false;
      }
      if (!this._skipMetadata(0)) {
        return false;
      }
    }

    return this._skipMetadata(0);
  }

  // Discards one metadata block (key-value entries plus nested sub-metadata).
  // Sub-blocks read depth-first in stream order, matching the C++ stack traversal.
  _skipMetadata(level) {
    if (level > kMaxSubmetadataLevel) {
      return false;
    }

    const numEntries = decodeVarint(this.buffer_);
    if (numEntries === undefined) {
      return false;
    }
    for (let i = 0; i < numEntries; ++i) {
      if (!this._skipEntry()) {
        return false;
      }
    }

    const numSubMetadata = decodeVarint(this.buffer_);
    if (numSubMetadata === undefined) {
      return false;
    }
    if (numSubMetadata > this.buffer_.remainingSize) {
      return false;
    }
    for (let i = 0; i < numSubMetadata; ++i) {
      // Sub-metadata name, then its block.
      if (!this._skipName()) {
        return false;
      }
      if (!this._skipMetadata(level + 1)) {
        return false;
      }
    }

    return true;
  }

  // Skips a key-value entry: name then a length-prefixed value.
  _skipEntry() {
    if (!this._skipName()) {
      return false;
    }
    const dataSize = decodeVarint(this.buffer_);
    if (dataSize === undefined || dataSize === 0) {
      return false;
    }
    if (dataSize > this.buffer_.remainingSize) {
      return false;
    }
    this.buffer_.advance(dataSize);
    return true;
  }

  // Skips a name (uint8 length prefix followed by that many bytes).
  _skipName() {
    const nameLen = this.buffer_.decodeUint8();
    if (nameLen === undefined || nameLen > this.buffer_.remainingSize) {
      return false;
    }
    this.buffer_.advance(nameLen);
    return true;
  }

}

// compression/point_cloud/PointCloudDecoder.js - ported from point_cloud/point_cloud_decoder.h/cc


// Abstract base for all point cloud and mesh decoders; holds shared logic.
class PointCloudDecoder {

  constructor() {
    this._pointCloud = null;
    this._buffer = null;
    this._versionMajor = 0;
    this._versionMinor = 0;
    this._attributesDecoders = [];
    this._attributeToDecoderMap = [];
  }

  // Returns a Status; on success outHeader is populated.
  static decodeHeader(buffer, outHeader) {
    const kIoErrorMsg = 'Failed to parse Draco header.';
    const bytes = buffer.decodeBytes(5);
    if (bytes === undefined) {
      return new Status(StatusCode.IO_ERROR, kIoErrorMsg);
    }
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

  // Main entry point for point cloud decoding.
  decode(inBuffer, outPointCloud) {
    this._buffer = inBuffer;
    this._pointCloud = outPointCloud;

    const header = new DracoHeader();
    const headerStatus = PointCloudDecoder.decodeHeader(this._buffer, header);
    if (!headerStatus.ok()) {
      return headerStatus;
    }

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

    // Version compatibility check.
    if (this._versionMajor < 1 || this._versionMajor > maxSupportedMajorVersion) {
      return new Status(StatusCode.UNKNOWN_VERSION, 'Unknown major version.');
    }
    if (this._versionMajor === maxSupportedMajorVersion &&
        this._versionMinor > maxSupportedMinorVersion) {
      return new Status(StatusCode.UNKNOWN_VERSION, 'Unknown minor version.');
    }

    this._buffer.bitstreamVersion =
      DRACO_BITSTREAM_VERSION(this._versionMajor, this._versionMinor);

    // Only the current Draco 2.2 mesh bitstream is supported; pre-2.2 decode
    // paths were removed, so older meshes are rejected rather than mis-decoded.
    if (header.encoderType === EncodedGeometryType.TRIANGULAR_MESH &&
        this._buffer.bitstreamVersion < DRACO_BITSTREAM_VERSION(2, 2)) {
      return new Status(StatusCode.UNKNOWN_VERSION,
        'Unsupported bitstream version (only Draco 2.2 meshes are supported).');
    }

    if (header.flags & METADATA_FLAG_MASK) {
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

  // -- Protected virtual methods (override in subclasses) --

  initializeDecoder() {
    return true;
  }

  decodeGeometryData() {
    return true;
  }

  decodePointAttributes() {
    const numAttributesDecoders = this._buffer.decodeUint8();
    if (numAttributesDecoders === undefined) {
      return false;
    }
    for (let i = 0; i < numAttributesDecoders; ++i) {
      if (!this.createAttributesDecoder(i)) {
        return false;
      }
    }
    for (let i = 0; i < this._attributesDecoders.length; ++i) {
      if (!this._attributesDecoders[i].init(this, this._pointCloud)) {
        return false;
      }
    }
    for (let i = 0; i < numAttributesDecoders; ++i) {
      if (!this._attributesDecoders[i].decodeAttributesDecoderData(this._buffer)) {
        return false;
      }
    }
    // Map each attribute id to its decoder id.
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
    // Skip (not surface) the geometry metadata so its bytes are consumed and the
    // bitstream stays aligned; otherwise a metadata-bearing file decodes to empty.
    const metadataDecoder = new MetadataDecoder();
    if (!metadataDecoder.skipGeometryMetadata(this._buffer)) {
      return new Status(StatusCode.DRACO_ERROR, 'Failed to decode metadata.');
    }
    return okStatus();
  }

}

// compression/mesh/MeshDecoder.js - ported from mesh/mesh_decoder.h/cc


class MeshDecoder extends PointCloudDecoder {

  constructor() {
    super();
    this._mesh = null;
  }

  getGeometryType() {
    return EncodedGeometryType.TRIANGULAR_MESH;
  }

  decodeMesh(inBuffer, outMesh) {
    this._mesh = outMesh;
    return this.decode(inBuffer, outMesh);
  }

  getCornerTable() {
    return null;
  }

  getAttributeCornerTable(/* attId */) {
    return null;
  }

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

}

// compression/entropy/ANSCoding.js - ported from compression/entropy/ans.h
// Asymmetric Numeral Systems (rANS), decode-only. http://arxiv.org/abs/1311.2540v2

const ANS_P8_PRECISION = 256;
const ANS_L_BASE = 4096;
const ANS_IO_BASE = 256;

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

class AnsDecoder {

  constructor() {
    this.buf = null; // Uint8Array
    this.bufOffset = 0;
    this.state = 0;
  }

}

// offset is the number of encoded bytes. Returns 0 on success, 1 on error.
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

class RAnsDecoder {

  constructor(ransPrecisionBits) {
    this.ransPrecisionBits = ransPrecisionBits;
    this.ransPrecision = 1 << ransPrecisionBits;
    this.ransPrecisionMask = this.ransPrecision - 1;
    this.lRansBase = this.ransPrecision * 4;
    this.lutTable = null; // Uint32Array
    this.probTable = null; // Uint32Array, flat
    this.cumProbTable = null; // Uint32Array, flat
    // State inlined (not a nested AnsDecoder) so the ransRead() hot loop touches own props.
    this.buf = null;
    this.bufOffset = 0;
    this.state = 0;
  }

  // offset is the number of bytes encoded. Returns 0 on success, non-zero on error.
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

  ransRead() {
    // Cache state in locals for the renormalization loop: read once, write back once.
    const buf = this.buf;
    const lRansBase = this.lRansBase;
    let state = this.state;
    let bufOffset = this.bufOffset;
    while (state < lRansBase && bufOffset > 0) {
      state = (state << 8) | buf[--bufOffset];
    }
    const quo = state >>> this.ransPrecisionBits;
    const rem = state & this.ransPrecisionMask;
    const symbol = this.lutTable[rem];
    this.state = quo * this.probTable[symbol] + rem - this.cumProbTable[symbol];
    this.bufOffset = bufOffset;
    return symbol;
  }

  // Batch ransRead() into out[0..count): all fields hoisted to locals, state
  // written back once. Removes per-symbol property reads and call indirection.
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
        state = (state << 8) | buf[--bufOffset];
      }
      const rem = state & ransPrecisionMask;
      const symbol = lutTable[rem];
      out[i] = symbol;
      state = (state >>> ransPrecisionBits) * probTable[symbol] + rem - cumProbTable[symbol];
    }
    this.state = state;
    this.bufOffset = bufOffset;
  }

  // Builds the ransPrecision-entry lookup table. Returns false on bad input data.
  ransBuildLookUpTable(tokenProbs, numSymbols) {
    // lutTable is indexed by `rem` (random in [0, ransPrecision)), so it's the
    // hottest random read in decodeSymbols()/ransRead(). Its values are symbol
    // ids (< numSymbols), so pick the narrowest element type that holds them:
    // shrinking the table (up to 4x) keeps that random access closer to cache.
    const LutArray = numSymbols <= 256 ? Uint8Array
      : (numSymbols <= 65536 ? Uint16Array : Uint32Array);
    const lutTable = new LutArray(this.ransPrecision);
    const cumProbTable = new Uint32Array(numSymbols);
    this.lutTable = lutTable;
    // RAnsSymbolDecoder owns this table and never changes it during decoding.
    // Retain it instead of allocating and copying identical probabilities.
    this.probTable = tokenProbs;
    this.cumProbTable = cumProbTable;
    let cumProb = 0;
    let actProb = 0;
    for (let i = 0; i < numSymbols; ++i) {
      const prob = tokenProbs[i];
      cumProbTable[i] = cumProb;
      cumProb += prob;
      if (cumProb > this.ransPrecision) {
        return false;
      }
      // Manual loop for short runs: fill()'s per-call overhead dominates them.
      if (prob < 32) {
        for (let j = actProb; j < cumProb; ++j) {
          lutTable[j] = i;
        }
      } else {
        lutTable.fill(i, actProb, cumProb);
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


// rANS precision for the given unique-symbols bit length, clamped to [12, 20].
function computeRAnsPrecisionFromUniqueSymbolsBitLength(symbolsBitLength) {
  const unclamped = Math.trunc((3 * symbolsBitLength) / 2);
  if (unclamped < 12) return 12;
  if (unclamped > 20) return 20;
  return unclamped;
}

// Decodes symbols using rANS. uniqueSymbolsBitLength must match the encoder's.
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
    if (buffer.bitstreamVersion === 0) {
      return false;
    }

    const val = buffer.decodeVarintUint32();
    if (val === undefined) return false;
    this.numSymbols_ = val;

    // Reject an unreasonably high symbol count.
    if (Math.trunc(this.numSymbols_ / 64) > buffer.remainingSize) {
      return false;
    }

    const numSymbols = this.numSymbols_;
    const probabilityTable = new Uint32Array(numSymbols);
    this.probabilityTable_ = probabilityTable;
    if (numSymbols === 0) {
      return true;
    }

    // Read via a local cursor instead of a decodeUint8() call per byte.
    const data = buffer.data;
    const startPos = buffer.decodedSize;
    const endPos = startPos + buffer.remainingSize;
    let pos = startPos;
    for (let i = 0; i < numSymbols; ++i) {
      if (pos >= endPos) return false;
      const probData = data[pos++];

      // Low 2 bits = token: 0-2 is the extra-byte count, 3 is run-length of zero-prob entries.
      const token = probData & 3;
      if (token === 3) {
        const offset = probData >> 2;
        if (i + offset >= numSymbols) {
          return false;
        }
        // The run's probabilities stay 0; the freshly allocated table already is.
        i += offset;
      } else {
        const extraBytes = token;
        let prob = probData >> 2;
        for (let b = 0; b < extraBytes; ++b) {
          if (pos >= endPos) return false;
          // Shift 8 bits per extra byte, minus 2 for the two token bits.
          prob |= data[pos++] << (8 * (b + 1) - 2);
        }
        probabilityTable[i] = prob;
      }
    }
    buffer.advance(pos - startPos);

    if (!this.ans_.ransBuildLookUpTable(this.probabilityTable_, this.numSymbols_)) {
      return false;
    }
    return true;
  }

  // Starts decoding, advancing buffer past the encoded data.
  startDecoding(buffer) {
    const bytesEncoded = buffer.decodeVarintUint64();
    if (bytesEncoded === undefined) return false;

    if (bytesEncoded > buffer.remainingSize) {
      return false;
    }

    const dataHead = buffer.dataHead;
    buffer.advance(Number(bytesEncoded));
    if (this.ans_.readInit(dataHead, Number(bytesEncoded)) !== 0) {
      return false;
    }
    return true;
  }

  endDecoding() {
    this.ans_.readEnd();
  }

}

// compression/entropy/SymbolDecoding.js - ported from compression/entropy/symbol_decoding.h/cc


// Decodes numValues entropy-coded symbols into outValues (Uint32Array).
// numComponents is used for tagged coding. Returns false on error.
function decodeSymbols(numValues, numComponents, srcBuffer, outValues) {
  if (numValues === 0) {
    return true;
  }
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
  const tagDecoder = new RAnsSymbolDecoder(5);
  if (!tagDecoder.create(srcBuffer)) {
    return false;
  }

  if (!tagDecoder.startDecoding(srcBuffer)) {
    return false;
  }

  if (numValues > 0 && tagDecoder.numSymbols === 0) {
    return false;
  }

  srcBuffer.startBitDecoding(false);
  // After startBitDecoding(false) the buffer is in bit mode, so getBits can be
  // called directly, skipping decodeLeastSignificantBits32's per-component dispatch.
  const bd = srcBuffer._bitDecoder;
  // tagDecoder.decodeSymbol() is just a delegation to ans_.ransRead(); hoist it.
  const tagAns = tagDecoder.ans_;
  let valueId = 0;
  for (let i = 0; i < numValues; i += numComponents) {
    const bitLength = tagAns.ransRead();
    for (let j = 0; j < numComponents; ++j) {
      const val = bd.getBits(bitLength);
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
    return false;
  }

  if (!decoder.startDecoding(srcBuffer)) {
    return false;
  }
  decoder.ans_.decodeSymbols(outValues, numValues);
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

// attributes/GeometryIndices.js - ported from attributes/geometry_indices.h

// Invalid-index sentinel; matches C++ std::numeric_limits<uint32_t>::max().
const kInvalidAttributeValueIndex = 0xFFFFFFFF >>> 0;

// Decoder-owned attribute record. Values stay in encoded entry order; the
// original type and optional transform are applied only to requested output.

const AttributeArrays = {
  1: Int8Array, 2: Uint8Array, 3: Int16Array, 4: Uint16Array,
  5: Int32Array, 6: Uint32Array, 9: Float32Array, 10: Float64Array,
};

class PointAttribute {
  constructor(attributeType, dataType, numComponents, normalized) {
    this.attributeType = attributeType;
    this.dataType = dataType;
    this.numComponents = numComponents;
    this.normalized = normalized;
    this.uniqueId = 0;
    this.size = 0;
    this.values = null;
    this.portable = false;
    this.portableComponents = numComponents;
    this.transform = null;
    this.indicesMap = null;
  }

  get isMappingIdentity() { return this.indicesMap === null; }

  setIdentityMapping() { this.indicesMap = null; }

  setExplicitMapping(numPoints) {
    this.indicesMap = new Uint32Array(numPoints);
    this.indicesMap.fill(kInvalidAttributeValueIndex);
  }

  extractTo(OutputTypedArray, numPoints, map = this.indicesMap) {
    const nc = this.numComponents;
    const output = new OutputTypedArray(numPoints * nc);
    const values = this.values;
    if (values === null || numPoints === 0) return output;
    if (this.transform !== null) {
      this.transform.extractTo(values, map, output, nc);
      return output;
    }

    // Raw INT64/UINT64/BOOL conversion was unsupported by the old scalar
    // accessor and yielded zero. Keep that behavior while consuming its bytes.
    if (!AttributeArrays[this.dataType]) return output;

    if (this.portable) {
      // Reconstruct the ORIGINAL integer width/sign before converting to the
      // requested array. Portable Int32 values are also used by later predictors
      // and must not be narrowed or overwritten in place.
      const shift = 32 - dataTypeLength(this.dataType) * 8;
      const unsigned = this.dataType % 2 === 0;
      for (let p = 0, d = 0; p < numPoints; p++) {
        const s = (map === null ? p : map[p]) * nc;
        for (let c = 0; c < nc; c++, d++) {
          const value = values[s + c];
          output[d] = value === undefined ? value
            : unsigned ? (value << shift) >>> shift : (value << shift) >> shift;
        }
      }
      return output;
    }

    if (map === null) {
      output.set(values.subarray(0, output.length));
    } else if (nc === 3) {
      for (let p = 0, d = 0; p < numPoints; p++, d += 3) {
        const s = map[p] * 3;
        output[d] = values[s]; output[d + 1] = values[s + 1]; output[d + 2] = values[s + 2];
      }
    } else if (nc === 2) {
      for (let p = 0, d = 0; p < numPoints; p++, d += 2) {
        const s = map[p] * 2;
        output[d] = values[s]; output[d + 1] = values[s + 1];
      }
    } else {
      for (let p = 0, d = 0; p < numPoints; p++) {
        const s = map[p] * nc;
        for (let c = 0; c < nc; c++) output[d++] = values[s + c];
      }
    }
    return output;
  }
}

// Prediction parents are the same records, read in portable integer form.
// The parent map is immutable after sequencing; no second map or buffer exists.
function buildInt32PositionCache(attribute, pointIds, numEntries) {
  const values = attribute.values;
  const map = attribute.indicesMap;
  const cache = new Int32Array(numEntries * 3);
  for (let i = 0, d = 0; i < numEntries; i++, d += 3) {
    const point = pointIds[i];
    const s = (map === null ? point : map[point]) * 3;
    cache[d] = values[s]; cache[d + 1] = values[s + 1]; cache[d + 2] = values[s + 2];
  }
  return cache;
}

// compression/attributes/AttributesDecoder.js - ported from compression/attributes/attributes_decoder.h/cc


// Base class for AttributesDecoders; shared functionality for all of them.
class AttributesDecoder {

  constructor() {
    this._pointAttributeIds = [];
    // Inverse of _pointAttributeIds: point attribute id -> local id.
    this._pointAttributeToLocalIdMap = [];
    this._pointCloudDecoder = null;
    this._pointCloud = null;
  }

  init(decoder, pointCloud) {
    this._pointCloudDecoder = decoder;
    this._pointCloud = pointCloud;
    return true;
  }

  decodeAttributesDecoderData(buffer) {
    let numAttributes;

    numAttributes = decodeVarint(buffer, false);
    if (numAttributes === undefined) return false;

    if (numAttributes === 0) {
      return false;
    }
    if (numAttributes > 5 * buffer.remainingSize) {
      // Unreasonably high; reject.
      return false;
    }

    this._pointAttributeIds.length = numAttributes;
    const pc = this._pointCloud;

    for (let i = 0; i < numAttributes; i++) {
      const attType = buffer.decodeUint8();
      if (attType === undefined) return false;

      const dataType = buffer.decodeUint8();
      if (dataType === undefined) return false;

      const numComponents = buffer.decodeUint8();
      if (numComponents === undefined) return false;

      const normalized = buffer.decodeUint8();
      if (normalized === undefined) return false;

      if (attType >= 5) {
        return false;
      }
      if (dataType === DataType.INVALID || dataType >= DataType.TYPES_COUNT) {
        return false;
      }

      if (numComponents === 0) {
        return false;
      }

      const uniqueId = decodeVarint(buffer, false);
      if (uniqueId === undefined) return false;
      const pa = new PointAttribute(attType, dataType, numComponents, normalized > 0);
      const attId = pc.addAttribute(pa);
      pc.attribute(attId).uniqueId = uniqueId;
      this._pointAttributeIds[i] = attId;

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

  decodeAttributes(buffer) {
    if (!this.decodePortableAttributes(buffer)) {
      return false;
    }
    if (!this.decodeDataNeededByPortableTransforms(buffer)) {
      return false;
    }
    if (!this.finalizeAttributes()) {
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

}

// compression/attributes/SequentialAttributeDecoder.js - ported from compression/attributes/sequential_attribute_decoder.h/cc


// A base class for decoding attribute values encoded by the
// SequentialAttributeEncoder.
class SequentialAttributeDecoder {

  constructor() {
    this._decoder = null;
    this._attribute = null;
    this._attributeId = -1;
  }

  init(decoder, attributeId) {
    this._decoder = decoder;
    this._attribute = decoder.pointCloud().attribute(attributeId);
    this._attributeId = attributeId;
    return true;
  }

  decodePortableAttribute(pointIds, buffer) {
    if (this._attribute.numComponents <= 0) {
      return false;
    }
    this._attribute.size = pointIds.length;
    return this.decodeValues(pointIds, buffer);
  }

  // No-op by default; subclasses with a transform override this.
  decodeDataNeededByPortableTransform(pointIds, buffer) {
    return true;
  }

  // No-op by default; subclasses with a transform override this.
  finalizeAttribute(pointIds) {
    return true;
  }

  getPortableAttribute() {
    return this._attribute.portable ? this._attribute : null;
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

  initPredictionScheme(ps) {
    for (let i = 0; i < ps.getNumParentAttributes(); i++) {
      const attId = this._decoder.pointCloud().getNamedAttributeId(
        ps.getParentAttributeType(i)
      );
      if (attId === -1) {
        return false; // Requested attribute does not exist.
      }
      const pa = this._decoder.getPortableAttribute(attId);
      if (pa === null || !ps.setParentAttribute(pa)) {
        return false;
      }
    }
    return true;
  }

  // Decodes raw attribute values in their original format.
  decodeValues(pointIds, buffer) {
    const numValues = pointIds.length;
    const attribute = this._attribute;
    const entrySize = dataTypeLength(attribute.dataType) * attribute.numComponents;
    const ArrayType = AttributeArrays[attribute.dataType];
    attribute.values = ArrayType ? new ArrayType(numValues * attribute.numComponents)
      : new Uint8Array(numValues * entrySize);
    const bytes = new Uint8Array(attribute.values.buffer);
    let outBytePos = 0;
    for (let i = 0; i < numValues; i++) {
      const valueData = buffer.decodeBytes(entrySize);
      if (valueData === undefined) {
        return false;
      }
      bytes.set(valueData, outBytePos);
      outBytePos += entrySize;
    }
    return true;
  }

}

// compression/attributes/prediction_schemes/PredictionSchemeDecoder.js - ported from compression/attributes/prediction_schemes/prediction_scheme_decoder.h

/**
 * Base class for typed prediction scheme decoders. C++ templates this on
 * <DataTypeT, TransformT>; here the transform is a constructor param.
 */
class PredictionSchemeDecoder {

  constructor(attribute, transform) {
    this._transform = transform;
  }

  decodePredictionData(buffer) {
    if (!this._transform.decodeTransformData(buffer)) {
      return false;
    }
    return true;
  }

  getNumParentAttributes() {
    return 0;
  }

  getParentAttributeType(i) {
    return -1; // INVALID
  }

  setParentAttribute(att) {
    return false;
  }

  areCorrectionsPositive() {
    return this._transform.areCorrectionsPositive();
  }

}

// compression/attributes/prediction_schemes/PredictionSchemeDeltaDecoder.js - ported from compression/attributes/prediction_schemes/prediction_scheme_delta_decoder.h


/**
 * Decoder for delta coding: value[i] = value[i-1] + correction[i].
 */
class PredictionSchemeDeltaDecoder extends PredictionSchemeDecoder {

  constructor(attribute, transform) {
    super(attribute, transform);
  }

  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    this._transform.init(numComponents);

    // First element has an all-zero "predicted" value.
    const zeroVals = new Int32Array(numComponents);
    this._transform.computeOriginalValue(
      zeroVals, 0,
      inCorr, 0,
      outData, 0
    );

    // D(i) = D(i-1) + correction(i).
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

// compression/attributes/prediction_schemes/MeshPredictionSchemeDecoder.js - ported from compression/attributes/prediction_schemes/mesh_prediction_scheme_decoder.h


/**
 * Base class for mesh prediction scheme decoders that use mesh connectivity.
 * C++ templates this on MeshDataT; here meshData is a constructor param.
 */
class MeshPredictionSchemeDecoder extends PredictionSchemeDecoder {

  constructor(attribute, transform, meshData) {
    super(attribute, transform);
    this._meshData = meshData;
  }

}

// compression/attributes/prediction_schemes/MeshPredictionSchemeParallelogramDecoder.js - ported from compression/attributes/prediction_schemes/mesh_prediction_scheme_parallelogram_decoder.h


/**
 * Decoder for the standard parallelogram prediction: the parallelogram formed
 * by the triangle opposite the current corner predicts the attribute value.
 */
class MeshPredictionSchemeParallelogramDecoder extends MeshPredictionSchemeDecoder {

  constructor(attribute, transform, meshData) {
    super(attribute, transform, meshData);
  }

  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    this._transform.init(numComponents);

    if (this._transform.getType &&
        this._transform.getType() === PredictionSchemeTransformType.PREDICTION_TRANSFORM_WRAP) {
      return this._computeOriginalValuesWrap(inCorr, outData, numComponents);
    }

    const table = this._meshData.cornerTable;
    const vertexToDataMap = this._meshData.vertexToDataMap;
    // Flat connectivity arrays (Int32Array) for the per-value prediction loop.
    const oppositeCorners = table.oppositeCornerArray();
    const cornerToVertex = table.cornerToVertexArray();
    const dataToCornerMap = this._meshData.dataToCornerMap;

    const predVals = new Int32Array(numComponents);

    this._transform.computeOriginalValue(
      predVals, 0, inCorr, 0, outData, 0
    );

    const cornerMapSize = dataToCornerMap.length;
    for (let p = 1; p < cornerMapSize; ++p) {
      const cornerId = dataToCornerMap[p];
      const dstOffset = p * numComponents;

      const oci = oppositeCorners[cornerId];
      let hasPrediction = false;
      if (oci >= 0) {
        const rem = oci - ((oci / 3) | 0) * 3;
        const nextOci = rem === 2 ? oci - 2 : oci + 1;
        const prevOci = rem === 0 ? oci + 2 : oci - 1;

        const vertOpp = vertexToDataMap[cornerToVertex[oci]];
        const vertNext = vertexToDataMap[cornerToVertex[nextOci]];
        const vertPrev = vertexToDataMap[cornerToVertex[prevOci]];

        if (vertOpp < p && vertNext < p && vertPrev < p) {
          const vOppOff = vertOpp * numComponents;
          const vNextOff = vertNext * numComponents;
          const vPrevOff = vertPrev * numComponents;
          for (let c = 0; c < numComponents; ++c) {
            predVals[c] = (outData[vNextOff + c] + outData[vPrevOff + c]) - outData[vOppOff + c];
          }
          hasPrediction = true;
        }
      }

      if (!hasPrediction) {
        // No parallelogram: fall back to delta from previous value.
        const srcOffset = (p - 1) * numComponents;
        this._transform.computeOriginalValue(
          outData, srcOffset, inCorr, dstOffset, outData, dstOffset
        );
      } else {
        this._transform.computeOriginalValue(
          predVals, 0, inCorr, dstOffset, outData, dstOffset
        );
      }
    }
    return true;
  }

  _computeOriginalValuesWrap(inCorr, outData, numComponents) {
    if (numComponents === 2) {
      return this._computeOriginalValuesWrap2(inCorr, outData);
    }
    if (numComponents === 3) {
      return this._computeOriginalValuesWrap3(inCorr, outData);
    }

    const table = this._meshData.cornerTable;
    const vertexToDataMap = this._meshData.vertexToDataMap;
    const oppositeCorners = table.oppositeCornerArray();
    const cornerToVertex = table.cornerToVertexArray();
    const dataToCornerMap = this._meshData.dataToCornerMap;
    const minValue = this._transform._minValue;
    const maxValue = this._transform._maxValue;
    const maxDif = this._transform._maxDif;

    for (let c = 0; c < numComponents; ++c) {
      let pred = 0;
      if (pred > maxValue) {
        pred = maxValue;
      } else if (pred < minValue) {
        pred = minValue;
      }
      let orig = (pred + inCorr[c]) | 0;
      if (orig > maxValue) {
        orig -= maxDif;
      } else if (orig < minValue) {
        orig += maxDif;
      }
      outData[c] = orig;
    }

    const cornerMapSize = dataToCornerMap.length;
    for (let p = 1; p < cornerMapSize; ++p) {
      const cornerId = dataToCornerMap[p];
      const dstOffset = p * numComponents;

      const oci = oppositeCorners[cornerId];
      let hasPrediction = false;
      let vOppOff = 0;
      let vNextOff = 0;
      let vPrevOff = 0;
      if (oci >= 0) {
        const rem = oci - ((oci / 3) | 0) * 3;
        const nextOci = rem === 2 ? oci - 2 : oci + 1;
        const prevOci = rem === 0 ? oci + 2 : oci - 1;

        const vertOpp = vertexToDataMap[cornerToVertex[oci]];
        const vertNext = vertexToDataMap[cornerToVertex[nextOci]];
        const vertPrev = vertexToDataMap[cornerToVertex[prevOci]];

        if (vertOpp < p && vertNext < p && vertPrev < p) {
          vOppOff = vertOpp * numComponents;
          vNextOff = vertNext * numComponents;
          vPrevOff = vertPrev * numComponents;
          hasPrediction = true;
        }
      }

      if (hasPrediction) {
        for (let c = 0; c < numComponents; ++c) {
          let pred = ((outData[vNextOff + c] + outData[vPrevOff + c]) - outData[vOppOff + c]) | 0;
          if (pred > maxValue) {
            pred = maxValue;
          } else if (pred < minValue) {
            pred = minValue;
          }
          let orig = (pred + inCorr[dstOffset + c]) | 0;
          if (orig > maxValue) {
            orig -= maxDif;
          } else if (orig < minValue) {
            orig += maxDif;
          }
          outData[dstOffset + c] = orig;
        }
      } else {
        const srcOffset = (p - 1) * numComponents;
        for (let c = 0; c < numComponents; ++c) {
          let pred = outData[srcOffset + c];
          if (pred > maxValue) {
            pred = maxValue;
          } else if (pred < minValue) {
            pred = minValue;
          }
          let orig = (pred + inCorr[dstOffset + c]) | 0;
          if (orig > maxValue) {
            orig -= maxDif;
          } else if (orig < minValue) {
            orig += maxDif;
          }
          outData[dstOffset + c] = orig;
        }
      }
    }

    return true;
  }

  _computeOriginalValuesWrap2(inCorr, outData) {
    const table = this._meshData.cornerTable;
    const vertexToDataMap = this._meshData.vertexToDataMap;
    const oppositeCorners = table.oppositeCornerArray();
    const cornerToVertex = table.cornerToVertexArray();
    const dataToCornerMap = this._meshData.dataToCornerMap;
    const minValue = this._transform._minValue;
    const maxValue = this._transform._maxValue;
    const maxDif = this._transform._maxDif;
    let pred0 = 0;
    let pred1 = 0;
    if (pred0 > maxValue) {
      pred0 = maxValue;
    } else if (pred0 < minValue) {
      pred0 = minValue;
    }
    if (pred1 > maxValue) {
      pred1 = maxValue;
    } else if (pred1 < minValue) {
      pred1 = minValue;
    }
    let orig0 = (pred0 + inCorr[0]) | 0;
    let orig1 = (pred1 + inCorr[1]) | 0;
    if (orig0 > maxValue) {
      orig0 -= maxDif;
    } else if (orig0 < minValue) {
      orig0 += maxDif;
    }
    if (orig1 > maxValue) {
      orig1 -= maxDif;
    } else if (orig1 < minValue) {
      orig1 += maxDif;
    }
    outData[0] = orig0;
    outData[1] = orig1;

    const cornerMapSize = dataToCornerMap.length;
    for (let p = 1; p < cornerMapSize; ++p) {
      const cornerId = dataToCornerMap[p];
      const dstOffset = p * 2;
      const oci = oppositeCorners[cornerId];
      let hasPrediction = false;
      let vOppOff = 0;
      let vNextOff = 0;
      let vPrevOff = 0;
      if (oci >= 0) {
        const rem = oci - ((oci / 3) | 0) * 3;
        const nextOci = rem === 2 ? oci - 2 : oci + 1;
        const prevOci = rem === 0 ? oci + 2 : oci - 1;
        const vertOpp = vertexToDataMap[cornerToVertex[oci]];
        const vertNext = vertexToDataMap[cornerToVertex[nextOci]];
        const vertPrev = vertexToDataMap[cornerToVertex[prevOci]];
        if (vertOpp < p && vertNext < p && vertPrev < p) {
          vOppOff = vertOpp * 2;
          vNextOff = vertNext * 2;
          vPrevOff = vertPrev * 2;
          hasPrediction = true;
        }
      }

      if (hasPrediction) {
        pred0 = ((outData[vNextOff] + outData[vPrevOff]) - outData[vOppOff]) | 0;
        pred1 = ((outData[vNextOff + 1] + outData[vPrevOff + 1]) - outData[vOppOff + 1]) | 0;
      } else {
        const srcOffset = dstOffset - 2;
        pred0 = outData[srcOffset];
        pred1 = outData[srcOffset + 1];
      }
      if (pred0 > maxValue) {
        pred0 = maxValue;
      } else if (pred0 < minValue) {
        pred0 = minValue;
      }
      if (pred1 > maxValue) {
        pred1 = maxValue;
      } else if (pred1 < minValue) {
        pred1 = minValue;
      }
      orig0 = (pred0 + inCorr[dstOffset]) | 0;
      orig1 = (pred1 + inCorr[dstOffset + 1]) | 0;
      if (orig0 > maxValue) {
        orig0 -= maxDif;
      } else if (orig0 < minValue) {
        orig0 += maxDif;
      }
      if (orig1 > maxValue) {
        orig1 -= maxDif;
      } else if (orig1 < minValue) {
        orig1 += maxDif;
      }
      outData[dstOffset] = orig0;
      outData[dstOffset + 1] = orig1;
    }

    return true;
  }

  _computeOriginalValuesWrap3(inCorr, outData) {
    const table = this._meshData.cornerTable;
    const vertexToDataMap = this._meshData.vertexToDataMap;
    const oppositeCorners = table.oppositeCornerArray();
    const cornerToVertex = table.cornerToVertexArray();
    const dataToCornerMap = this._meshData.dataToCornerMap;
    const minValue = this._transform._minValue;
    const maxValue = this._transform._maxValue;
    const maxDif = this._transform._maxDif;
    let pred0 = 0;
    let pred1 = 0;
    let pred2 = 0;
    if (pred0 > maxValue) {
      pred0 = maxValue;
    } else if (pred0 < minValue) {
      pred0 = minValue;
    }
    if (pred1 > maxValue) {
      pred1 = maxValue;
    } else if (pred1 < minValue) {
      pred1 = minValue;
    }
    if (pred2 > maxValue) {
      pred2 = maxValue;
    } else if (pred2 < minValue) {
      pred2 = minValue;
    }
    let orig0 = (pred0 + inCorr[0]) | 0;
    let orig1 = (pred1 + inCorr[1]) | 0;
    let orig2 = (pred2 + inCorr[2]) | 0;
    if (orig0 > maxValue) {
      orig0 -= maxDif;
    } else if (orig0 < minValue) {
      orig0 += maxDif;
    }
    if (orig1 > maxValue) {
      orig1 -= maxDif;
    } else if (orig1 < minValue) {
      orig1 += maxDif;
    }
    if (orig2 > maxValue) {
      orig2 -= maxDif;
    } else if (orig2 < minValue) {
      orig2 += maxDif;
    }
    outData[0] = orig0;
    outData[1] = orig1;
    outData[2] = orig2;

    const cornerMapSize = dataToCornerMap.length;
    for (let p = 1; p < cornerMapSize; ++p) {
      const cornerId = dataToCornerMap[p];
      const dstOffset = p * 3;
      const oci = oppositeCorners[cornerId];
      let hasPrediction = false;
      let vOppOff = 0;
      let vNextOff = 0;
      let vPrevOff = 0;
      if (oci >= 0) {
        const rem = oci - ((oci / 3) | 0) * 3;
        const nextOci = rem === 2 ? oci - 2 : oci + 1;
        const prevOci = rem === 0 ? oci + 2 : oci - 1;
        const vertOpp = vertexToDataMap[cornerToVertex[oci]];
        const vertNext = vertexToDataMap[cornerToVertex[nextOci]];
        const vertPrev = vertexToDataMap[cornerToVertex[prevOci]];
        if (vertOpp < p && vertNext < p && vertPrev < p) {
          vOppOff = vertOpp * 3;
          vNextOff = vertNext * 3;
          vPrevOff = vertPrev * 3;
          hasPrediction = true;
        }
      }

      if (hasPrediction) {
        pred0 = ((outData[vNextOff] + outData[vPrevOff]) - outData[vOppOff]) | 0;
        pred1 = ((outData[vNextOff + 1] + outData[vPrevOff + 1]) - outData[vOppOff + 1]) | 0;
        pred2 = ((outData[vNextOff + 2] + outData[vPrevOff + 2]) - outData[vOppOff + 2]) | 0;
      } else {
        const srcOffset = dstOffset - 3;
        pred0 = outData[srcOffset];
        pred1 = outData[srcOffset + 1];
        pred2 = outData[srcOffset + 2];
      }
      if (pred0 > maxValue) {
        pred0 = maxValue;
      } else if (pred0 < minValue) {
        pred0 = minValue;
      }
      if (pred1 > maxValue) {
        pred1 = maxValue;
      } else if (pred1 < minValue) {
        pred1 = minValue;
      }
      if (pred2 > maxValue) {
        pred2 = maxValue;
      } else if (pred2 < minValue) {
        pred2 = minValue;
      }
      orig0 = (pred0 + inCorr[dstOffset]) | 0;
      orig1 = (pred1 + inCorr[dstOffset + 1]) | 0;
      orig2 = (pred2 + inCorr[dstOffset + 2]) | 0;
      if (orig0 > maxValue) {
        orig0 -= maxDif;
      } else if (orig0 < minValue) {
        orig0 += maxDif;
      }
      if (orig1 > maxValue) {
        orig1 -= maxDif;
      } else if (orig1 < minValue) {
        orig1 += maxDif;
      }
      if (orig2 > maxValue) {
        orig2 -= maxDif;
      } else if (orig2 < minValue) {
        orig2 += maxDif;
      }
      outData[dstOffset] = orig0;
      outData[dstOffset + 1] = orig1;
      outData[dstOffset + 2] = orig2;
    }

    return true;
  }

}

// compression/attributes/prediction_schemes/MeshPredictionSchemeParallelogramShared.js - ported from compression/attributes/prediction_schemes/mesh_prediction_scheme_parallelogram_shared.h

/**
 * Computes parallelogram prediction P = next + prev - opp for a corner/entry.
 *
 * Operates on the flat Int32Array connectivity (oppositeCornerArray /
 * cornerToVertexArray) rather than the table accessors: the table may be a
 * CornerTable or MeshAttributeCornerTable, so method calls would be polymorphic
 * and not inlined; the flat arrays keep this hot path monomorphic.
 * next()/previous() are inlined as corner-triple arithmetic.
 *
 * @returns {boolean} true if a prediction was computed
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

// compression/attributes/prediction_schemes/MeshPredictionSchemeMultiParallelogramDecoder.js - ported from compression/attributes/prediction_schemes/mesh_prediction_scheme_multi_parallelogram_decoder.h


const kInvalidCornerIndex$5 = -1;

/**
 * Decoder for the multi-parallelogram scheme: parallelogram predictions around
 * a vertex are averaged to produce the final prediction.
 */
class MeshPredictionSchemeMultiParallelogramDecoder extends MeshPredictionSchemeDecoder {

  constructor(attribute, transform, meshData) {
    super(attribute, transform, meshData);
  }

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

      while (cornerId !== kInvalidCornerIndex$5) {
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
          cornerId = kInvalidCornerIndex$5;
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


// Decodes bits encoded with RAnsBitEncoder.
class RAnsBitDecoder {

  constructor() {
    this.ansDecoder_ = new AnsDecoder();
    this.probZero_ = 0;
    this.p_ = 0; // ANS_P8_PRECISION - probZero, precomputed
  }

  // Returns false when the data is invalid.
  startDecoding(sourceBuffer) {
    this.clear();

    const probZero = sourceBuffer.decodeUint8();
    if (probZero === undefined) {
      return false;
    }
    this.probZero_ = probZero;
    this.p_ = ANS_P8_PRECISION - probZero;

    const sizeInBytes = sourceBuffer.decodeVarintUint32();
    if (sizeInBytes === undefined) return false;

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

  decodeNextBit() {
    const ans = this.ansDecoder_;
    const p = this.p_;
    if (ans.state < ANS_L_BASE && ans.bufOffset > 0) {
      ans.state = (ans.state << 8) | ans.buf[--ans.bufOffset];
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

  endDecoding() {}

  clear() {
    ansReadEnd(this.ansDecoder_);
  }

}

// compression/attributes/prediction_schemes/MeshPredictionSchemeConstrainedMultiParallelogramDecoder.js - ported from compression/attributes/prediction_schemes/mesh_prediction_scheme_constrained_multi_parallelogram_decoder.h


const kInvalidCornerIndex$4 = -1;

const MAX_NUM_PARALLELOGRAMS = 4;

/**
 * Decoder for the constrained multi-parallelogram encoder. Crease edge flags
 * determine which parallelograms to use.
 */
class MeshPredictionSchemeConstrainedMultiParallelogramDecoder extends MeshPredictionSchemeDecoder {

  constructor(attribute, transform, meshData) {
    super(attribute, transform, meshData);
    // Crease edges stored per context (number of available parallelograms).
    this._isCreaseEdge = [];
    for (let i = 0; i < MAX_NUM_PARALLELOGRAMS; ++i) {
      this._isCreaseEdge.push([]);
    }
  }

  decodePredictionData(buffer) {
    // Decode crease edge flags via rANS bit coder, one context per parallelogram count.
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
    return super.decodePredictionData(buffer);
  }

  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    this._transform.init(numComponents);

    // Predicted values for all simple parallelograms.
    const predVals = [];
    for (let i = 0; i < MAX_NUM_PARALLELOGRAMS; ++i) {
      predVals.push(new Int32Array(numComponents));
    }

    this._transform.computeOriginalValue(
      predVals[0], 0, inCorr, 0, outData, 0
    );

    const table = this._meshData.cornerTable;
    const vertexToDataMap = this._meshData.vertexToDataMap;
    const oppositeCorners = table.oppositeCornerArray();
    const cornerToVertex = table.cornerToVertexArray();

    const isCreaseEdgePos = new Int32Array(MAX_NUM_PARALLELOGRAMS);
    const multiPredVals = new Int32Array(numComponents);

    const cornerMapSize = this._meshData.dataToCornerMap.length;
    for (let p = 1; p < cornerMapSize; ++p) {
      const startCornerId = this._meshData.dataToCornerMap[p];
      let cornerId = startCornerId;
      let numParallelograms = 0;
      let firstPass = true;

      while (cornerId !== kInvalidCornerIndex$4) {
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
        if (cornerId === kInvalidCornerIndex$4 && firstPass) {
          firstPass = false;
          cornerId = table.swingRight(startCornerId);
        }
      }

      // Crease edge flags select which parallelograms contribute.
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

// compression/attributes/prediction_schemes/MeshPredictionSchemeTexCoordsPortablePredictor.js - ported from compression/attributes/prediction_schemes/mesh_prediction_scheme_tex_coords_portable_predictor.h


// 2^53: integer products below this are exact as a JS double; at or above it
// the double path may lose precision and we switch to the BigInt path.
const SAFE_PRODUCT = 9007199254740992;

const MASK64 = (1n << 64n) - 1n;
const INT64_MAX_BIG = (1n << 63n) - 1n;

// Floor of the integer square root of a non-negative BigInt; matches C++ IntSqrt.
function bigIntSqrt(value) {
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + value / x) >> 1n;
  }
  return x;
}

/**
 * Predictor functionality used for portable UV prediction by both encoder and
 * decoder. This implements only the decoder path (is_encoder_t = false).
 */
class MeshPredictionSchemeTexCoordsPortablePredictor {

  static NUM_COMPONENTS = 2;

  constructor(meshData) {
    this._posAttribute = null;
    this._entryToPointIdMap = null;
    this._predictedValue = new Int32Array(2);
    this._orientations = new Uint8Array(0);
    this._numOrientations = 0;
    this._meshData = meshData;
    // Flat Int32 position cache so fetches are array reads, not convertValue calls.
    this._posCache = null;
    this._cornerToVertex = null;
  }

  setPositionAttribute(positionAttribute) {
    this._posAttribute = positionAttribute;
  }

  setEntryToPointIdMap(map) {
    this._entryToPointIdMap = map;
  }

  get predictedValue() {
    return this._predictedValue;
  }

  resizeOrientations(numOrientations) {
    this._orientations = new Uint8Array(numOrientations);
    this._numOrientations = numOrientations;
  }

  setOrientation(i, v) {
    this._orientations[i] = v ? 1 : 0;
  }

  buildPositionCache(numEntries) {
    this._posCache = buildInt32PositionCache(
      this._posAttribute, this._entryToPointIdMap, numEntries);
    this._cornerToVertex = this._meshData.cornerTable.cornerToVertexArray();
  }

  computePredictedValue(cornerId, data, dataId) {
    const rem = cornerId - ((cornerId / 3) | 0) * 3;
    const nextCornerId = rem === 2 ? cornerId - 2 : cornerId + 1;
    const prevCornerId = rem === 0 ? cornerId + 2 : cornerId - 1;

    const cornerToVertex = this._cornerToVertex;
    const nextVertId = cornerToVertex[nextCornerId];
    const prevVertId = cornerToVertex[prevCornerId];

    const vertexToDataMap = this._meshData.vertexToDataMap;
    const nextDataId = vertexToDataMap[nextVertId];
    const prevDataId = vertexToDataMap[prevVertId];

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

      const posCache = this._posCache;
      let posOffset = dataId * 3;
      const tip0 = posCache[posOffset];
      const tip1 = posCache[posOffset + 1];
      const tip2 = posCache[posOffset + 2];
      posOffset = nextDataId * 3;
      const next0 = posCache[posOffset];
      const next1 = posCache[posOffset + 1];
      const next2 = posCache[posOffset + 2];
      posOffset = prevDataId * 3;
      const prev0 = posCache[posOffset];
      const prev1 = posCache[posOffset + 1];
      const prev2 = posCache[posOffset + 2];

      const pn0 = prev0 - next0;
      const pn1 = prev1 - next1;
      const pn2 = prev2 - next2;
      const pnNorm2Squared = pn0 * pn0 + pn1 * pn1 + pn2 * pn2;

      if (pnNorm2Squared !== 0) {
        const cn0 = tip0 - next0;
        const cn1 = tip1 - next1;
        const cn2 = tip2 - next2;
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

        // Remaining arithmetic is int64 in C++. With small quantized positions
        // every intermediate fits 2^53 so double math is bit-exact; high
        // quantization (e.g. cl10's 20-bit) overflows 2^53 and we drop to the
        // BigInt path mirroring C++ int64/uint64. Products that can exceed 2^53:
        // nUV*pnNorm2, cnDotPn*pnUV, cnDotPn*pn, and cxNorm2*pnNorm2 (the last
        // bounded by cnNorm2*pnNorm2, since cx is never longer than cn).
        const cnNorm2 = cn0 * cn0 + cn1 * cn1 + cn2 * cn2;
        const pnAbsMaxG = Math.max(Math.abs(pn0), Math.abs(pn1), Math.abs(pn2));
        const cnDotPnAbs = Math.abs(cnDotPn);
        if (cnNorm2 > SAFE_PRODUCT / pnNorm2Squared ||
            nUVAbsMax > SAFE_PRODUCT / pnNorm2Squared ||
            (pnUVAbsMax > 0 && cnDotPnAbs > SAFE_PRODUCT / pnUVAbsMax) ||
            (pnAbsMaxG > 0 && cnDotPnAbs > SAFE_PRODUCT / pnAbsMaxG)) {
          return this._computePredictedValueBig(
            tip0, tip1, tip2, next0, next1, next2,
            pn0, pn1, pn2, nUV0, nUV1, pUV0, pUV1, pnNorm2Squared);
        }

        // x_uv = nUV * pnNorm2Squared + cnDotPn * pnUV
        const xUV0 = nUV0 * pnNorm2Squared + cnDotPn * pnUV0;
        const xUV1 = nUV1 * pnNorm2Squared + cnDotPn * pnUV1;

        const pnAbsMax = Math.max(Math.abs(pn0), Math.abs(pn1), Math.abs(pn2));
        if (pnAbsMax > 0 && Math.abs(cnDotPn) > INT64_MAX / pnAbsMax) {
          return false;
        }

        // x_pos = nextPos + (cnDotPn * pn) / pnNorm2Squared
        const xPos0 = next0 + Math.trunc((cnDotPn * pn0) / pnNorm2Squared);
        const xPos1 = next1 + Math.trunc((cnDotPn * pn1) / pnNorm2Squared);
        const xPos2 = next2 + Math.trunc((cnDotPn * pn2) / pnNorm2Squared);
        const cx0 = tip0 - xPos0;
        const cx1 = tip1 - xPos1;
        const cx2 = tip2 - xPos2;
        const cxNorm2Squared = cx0 * cx0 + cx1 * cx1 + cx2 * cx2;

        // Rotated pnUV by 90 degrees.
        const normSquared = Math.floor(Math.sqrt(cxNorm2Squared * pnNorm2Squared));
        const cxUV0 = pnUV1 * normSquared;
        const cxUV1 = -pnUV0 * normSquared;

        if (this._numOrientations === 0) {
          return false;
        }
        const orientation = this._orientations[--this._numOrientations];

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

  // 64-bit-exact projection prediction, used when the double path would lose
  // precision (high position quantization). Mirrors C++ VectorD<int64_t>/
  // <uint64_t>, including the uint64 wraparound in IntSqrt(cxNorm2*pnNorm2) and
  // the unsigned add/sub forming the final UV. Returns false in the same
  // overflow cases as the double path so encoder and decoder agree on fallback.
  _computePredictedValueBig(tip0, tip1, tip2, next0, next1, next2,
    pn0, pn1, pn2, nUV0, nUV1, pUV0, pUV1, pnNorm2SquaredNum) {
    const B = BigInt;
    const tip = [B(tip0), B(tip1), B(tip2)];
    const nxt = [B(next0), B(next1), B(next2)];
    const pn = [B(pn0), B(pn1), B(pn2)];
    const nUVb0 = B(nUV0), nUVb1 = B(nUV1);
    const pnN2 = B(pnNorm2SquaredNum);

    const cn0 = tip[0] - nxt[0];
    const cn1 = tip[1] - nxt[1];
    const cn2 = tip[2] - nxt[2];
    const cnDotPn = pn[0] * cn0 + pn[1] * cn1 + pn[2] * cn2;
    const pnUV0 = B(pUV0) - nUVb0;
    const pnUV1 = B(pUV1) - nUVb1;

    const babs = (x) => (x < 0n ? -x : x);
    const nUVAbsMax = babs(nUVb0) > babs(nUVb1) ? babs(nUVb0) : babs(nUVb1);
    if (nUVAbsMax > INT64_MAX_BIG / pnN2) return false;
    let pnUVAbsMax = babs(pnUV0) > babs(pnUV1) ? babs(pnUV0) : babs(pnUV1);
    if (pnUVAbsMax > 0n && babs(cnDotPn) > INT64_MAX_BIG / pnUVAbsMax) return false;

    // x_uv = nUV * pnNorm2 + cnDotPn * pnUV (int64 vector; wraps on overflow).
    const xUV0 = B.asIntN(64, nUVb0 * pnN2 + cnDotPn * pnUV0);
    const xUV1 = B.asIntN(64, nUVb1 * pnN2 + cnDotPn * pnUV1);

    let pnAbsMax = babs(pn[0]);
    if (babs(pn[1]) > pnAbsMax) pnAbsMax = babs(pn[1]);
    if (babs(pn[2]) > pnAbsMax) pnAbsMax = babs(pn[2]);
    if (pnAbsMax > 0n && babs(cnDotPn) > INT64_MAX_BIG / pnAbsMax) return false;

    // x_pos = next + (cnDotPn * pn) / pnNorm2 (signed truncating division).
    const xPos0 = nxt[0] + (cnDotPn * pn[0]) / pnN2;
    const xPos1 = nxt[1] + (cnDotPn * pn[1]) / pnN2;
    const xPos2 = nxt[2] + (cnDotPn * pn[2]) / pnN2;
    const cx0 = tip[0] - xPos0;
    const cx1 = tip[1] - xPos1;
    const cx2 = tip[2] - xPos2;
    const cxNorm2 = cx0 * cx0 + cx1 * cx1 + cx2 * cx2;

    // norm_squared = IntSqrt(cxNorm2 * pnNorm2), with the multiply in uint64.
    const normSquared = bigIntSqrt((cxNorm2 * pnN2) & MASK64);

    // cx_uv = Rot(pnUV) * normSquared (int64; wraps on overflow).
    const cxUV0 = B.asIntN(64, pnUV1 * normSquared);
    const cxUV1 = B.asIntN(64, (-pnUV0) * normSquared);

    if (this._numOrientations === 0) return false;
    const orientation = this._orientations[--this._numOrientations];

    // predicted_uv = (uint64(x_uv) +/- uint64(cx_uv)) / pnNorm2, as int64,
    // then truncated to int32 (static_cast<int>).
    let s0, s1;
    if (orientation) {
      s0 = B.asUintN(64, B.asUintN(64, xUV0) + B.asUintN(64, cxUV0));
      s1 = B.asUintN(64, B.asUintN(64, xUV1) + B.asUintN(64, cxUV1));
    } else {
      s0 = B.asUintN(64, B.asUintN(64, xUV0) - B.asUintN(64, cxUV0));
      s1 = B.asUintN(64, B.asUintN(64, xUV1) - B.asUintN(64, cxUV1));
    }
    this._predictedValue[0] = Number(B.asIntN(32, B.asIntN(64, s0) / pnN2));
    this._predictedValue[1] = Number(B.asIntN(32, B.asIntN(64, s1) / pnN2));
    return true;
  }

}

// compression/attributes/prediction_schemes/MeshPredictionSchemeTexCoordsPortableDecoder.js - ported from compression/attributes/prediction_schemes/mesh_prediction_scheme_tex_coords_portable_decoder.h


const GEOMETRY_ATTRIBUTE_POSITION$1 = 0;

/**
 * Decoder for UV coordinate predictions using the portable predictor; preferred
 * over the deprecated MeshPredictionSchemeTexCoordsDecoder.
 */
class MeshPredictionSchemeTexCoordsPortableDecoder extends MeshPredictionSchemeDecoder {

  constructor(attribute, transform, meshData) {
    super(attribute, transform, meshData);
    this._predictor = new MeshPredictionSchemeTexCoordsPortablePredictor(meshData);
  }

  getNumParentAttributes() {
    return 1;
  }

  getParentAttributeType(i) {
    return GEOMETRY_ATTRIBUTE_POSITION$1;
  }

  setParentAttribute(att) {
    if (!att || att.attributeType !== GEOMETRY_ATTRIBUTE_POSITION$1) return false;
    if (att.portableComponents !== 3) return false;
    this._predictor.setPositionAttribute(att);
    return true;
  }

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

  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    if (numComponents !== MeshPredictionSchemeTexCoordsPortablePredictor.NUM_COMPONENTS) {
      return false;
    }
    this._predictor.setEntryToPointIdMap(entryToPointIdMap);
    this._transform.init(numComponents);

    const cornerMapSize = this._meshData.dataToCornerMap.length;
    // Cache integer positions once to avoid per-fetch mappedIndex + convertValue.
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

// compression/attributes/NormalCompressionUtils.js - ported from compression/attributes/normal_compression_utils.h

// Converts unit vectors to/from octahedral coordinates for normal compression.
// Invariants: maxQuantizedValue = 2^q - 1 (odd); maxValue = maxQuantizedValue - 1
// (even); centerValue = maxValue / 2.
class OctahedronToolBox {

  constructor() {
    this._quantizationBits = -1;
    this._maxQuantizedValue = -1;
    this._maxValue = -1;
    this._dequantizationScale = 1.0;
    this._centerValue = -1;
  }

  // q: quantization bits, valid range 2..30.
  setQuantizationBits(q) {
    if (q < 2 || q > 30) return false;
    this._quantizationBits = q;
    this._maxQuantizedValue = (1 << q) - 1;
    this._maxValue = this._maxQuantizedValue - 1;
    this._dequantizationScale = Math.fround(2.0 / Math.fround(this._maxValue));
    this._centerValue = (this._maxValue / 2) | 0;
    return true;
  }

  quantizationBits() { return this._quantizationBits; }

  // Canonicalizes edge points into consistent quadrants. Writes result into
  // out[0], out[1] (caller-owned reusable 2-element array).
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

  // Precondition: abs sum of intVec ([x,y,z]) must equal centerValue.
  // Writes result to out[0], out[1].
  integerVectorToQuantizedOctahedralCoords(intVec, out) {
    let s, t;
    if (intVec[0] >= 0) {
      s = intVec[1] + this._centerValue;
      t = intVec[2] + this._centerValue;
    } else {
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

  // Normalizes vec ([x,y,z], modified in place) so its abs sum equals centerValue.
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

  quantizedOctahedralCoordsToUnitVector(inS, inT, outVector, offset = 0) {
    // float32 throughout (Math.fround) to stay bit-identical to the WASM
    // decoder, matching the live copy in AttributeOctahedronTransform.js.
    const fround = Math.fround;
    this._octahedralCoordsToUnitVector(
      fround(fround(fround(inS) * this._dequantizationScale) - 1.0),
      fround(fround(fround(inT) * this._dequantizationScale) - 1.0),
      outVector, offset
    );
  }

  _octahedralCoordsToUnitVector(inSScaled, inTScaled, outVector, offset) {
    // float32 throughout (see quantizedOctahedralCoordsToUnitVector) so normals
    // are bit-identical to WASM.
    const fround = Math.fround;
    let y = inSScaled;
    let z = inTScaled;
    const x = fround(fround(1.0 - Math.abs(y)) - Math.abs(z));

    let xOffset = -x;
    if (xOffset < 0) xOffset = 0;

    y = fround(y + (y < 0 ? xOffset : -xOffset));
    z = fround(z + (z < 0 ? xOffset : -xOffset));

    const normSquared = fround(fround(fround(x * x) + fround(y * y)) + fround(z * z));
    if (normSquared < 1e-6) {
      outVector[offset + 0] = 0;
      outVector[offset + 1] = 0;
      outVector[offset + 2] = 0;
    } else {
      const d = fround(1.0 / fround(Math.sqrt(normSquared)));
      outVector[offset + 0] = fround(x * d);
      outVector[offset + 1] = fround(y * d);
      outVector[offset + 2] = fround(z * d);
    }
  }

}

// compression/attributes/prediction_schemes/MeshPredictionSchemeGeometricNormalPredictorArea.js - ported from compression/attributes/prediction_schemes/mesh_prediction_scheme_geometric_normal_predictor_area.h
// and mesh_prediction_scheme_geometric_normal_predictor_base.h


const UPPER_BOUND = 1 << 29;

/**
 * Predictor that estimates the normal via the surrounding triangles of a
 * given corner, weighted by triangle area.
 */
class MeshPredictionSchemeGeometricNormalPredictorArea {

  constructor(meshData) {
    this._posAttribute = null;
    this._entryToPointIdMap = null;
    this._meshData = meshData;
    this._posCache = null;            // flat Int32 positions, indexed by data id
    this._cornerToVertex = null;
    this._oppositeCorners = null;
    this._cornerToOffset = null;      // corner -> posCache offset, precomputed
  }

  setPositionAttribute(positionAttribute) {
    this._posAttribute = positionAttribute;
  }

  setEntryToPointIdMap(map) {
    this._entryToPointIdMap = map;
  }

  buildPositionCache(numEntries) {
    this._posCache = buildInt32PositionCache(
      this._posAttribute, this._entryToPointIdMap, numEntries);
    const table = this._meshData.cornerTable;
    this._cornerToVertex = table.cornerToVertexArray();
    this._oppositeCorners = table.oppositeCornerArray();
    // Precompute corner -> posCache offset once so the ring walk folds the
    // vertexToDataMap[cornerToVertex[c]]*3 double indirection into one load.
    const cornerToVertex = this._cornerToVertex;
    const vertexToDataMap = this._meshData.vertexToDataMap;
    const nc = cornerToVertex.length;
    const c2o = new Int32Array(nc);
    for (let c = 0; c < nc; ++c) {
      const v = cornerToVertex[c];
      c2o[c] = v < 0 ? -1 : vertexToDataMap[v] * 3;
    }
    this._cornerToOffset = c2o;
  }

  computePredictedValue(cornerId, prediction) {
    const oppositeCorners = this._oppositeCorners;
    const cornerToOffset = this._cornerToOffset;
    const posCache = this._posCache;
    const centerOffset = cornerToOffset[cornerId];
    const centX = posCache[centerOffset];
    const centY = posCache[centerOffset + 1];
    const centZ = posCache[centerOffset + 2];

    let normalX = 0, normalY = 0, normalZ = 0;

    // Draco 2.2 uses TRIANGLE_AREA: visit every corner around the vertex like C++
    // VertexCornersIterator -- swing LEFT to a boundary/full loop, then (only
    // if an open boundary was hit) swing RIGHT for the other side. Right-only
    // would drop triangles left of the start corner on boundary vertices.
    let currentCorner = cornerId;
    let leftTraversal = true;

    while (currentCorner >= 0) {
      const rem = currentCorner - ((currentCorner / 3) | 0) * 3;
      const cNext = rem === 2 ? currentCorner - 2 : currentCorner + 1;
      const cPrev = rem === 0 ? currentCorner + 2 : currentCorner - 1;
      let posOffset = cornerToOffset[cNext];
      const nextX = posCache[posOffset];
      const nextY = posCache[posOffset + 1];
      const nextZ = posCache[posOffset + 2];
      posOffset = cornerToOffset[cPrev];
      const prevX = posCache[posOffset];
      const prevY = posCache[posOffset + 1];
      const prevZ = posCache[posOffset + 2];

      const dNextX = nextX - centX;
      const dNextY = nextY - centY;
      const dNextZ = nextZ - centZ;
      const dPrevX = prevX - centX;
      const dPrevY = prevY - centY;
      const dPrevZ = prevZ - centZ;

      normalX += dNextY * dPrevZ - dNextZ * dPrevY;
      normalY += dNextZ * dPrevX - dNextX * dPrevZ;
      normalZ += dNextX * dPrevY - dNextY * dPrevX;

      // Advance like VertexCornersIterator::Next().
      if (leftTraversal) {
        const opp = oppositeCorners[cNext];
        if (opp < 0) {
          currentCorner = -1;
        } else {
          const oppRem = opp - ((opp / 3) | 0) * 3;
          currentCorner = oppRem === 2 ? opp - 2 : opp + 1;
        }
        if (currentCorner < 0) {
          // Open boundary reached; cover the other side from the start.
          const startRem = cornerId - ((cornerId / 3) | 0) * 3;
          const startPrev = startRem === 0 ? cornerId + 2 : cornerId - 1;
          const startOpp = oppositeCorners[startPrev];
          if (startOpp < 0) {
            currentCorner = -1;
          } else {
            const startOppRem = startOpp - ((startOpp / 3) | 0) * 3;
            currentCorner = startOppRem === 0 ? startOpp + 2 : startOpp - 1;
          }
          leftTraversal = false;
        } else if (currentCorner === cornerId) {
          // Returned to the start: full ring visited.
          currentCorner = -1;
        }
      } else {
        const opp = oppositeCorners[cPrev];
        if (opp < 0) {
          currentCorner = -1;
        } else {
          const oppRem = opp - ((opp / 3) | 0) * 3;
          currentCorner = oppRem === 0 ? opp + 2 : opp - 1;
        }
      }
    }

    // Clamp to int32 with int64 INTEGER division like C++: quotient floored,
    // each component truncated toward zero. Naive float division diverges for
    // UPPER_BOUND < absSum < 2*UPPER_BOUND, where C++ quotient is 1 (no change).
    const absSum = Math.abs(normalX) + Math.abs(normalY) + Math.abs(normalZ);
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

// compression/attributes/prediction_schemes/MeshPredictionSchemeGeometricNormalDecoder.js - ported from compression/attributes/prediction_schemes/mesh_prediction_scheme_geometric_normal_decoder.h


const GEOMETRY_ATTRIBUTE_POSITION = 0;

/**
 * Decoder for geometric normal prediction. Predicts normals using the
 * surrounding triangle geometry, then converts to octahedral coordinates.
 */
class MeshPredictionSchemeGeometricNormalDecoder extends MeshPredictionSchemeDecoder {

  constructor(attribute, transform, meshData) {
    super(attribute, transform, meshData);
    this._predictor = new MeshPredictionSchemeGeometricNormalPredictorArea(meshData);
    this._octahedronToolBox = new OctahedronToolBox();
    this._flipNormalBitDecoder = new RAnsBitDecoder();
  }

  getNumParentAttributes() {
    return 1;
  }

  getParentAttributeType(i) {
    return GEOMETRY_ATTRIBUTE_POSITION;
  }

  setParentAttribute(att) {
    if (att.attributeType !== GEOMETRY_ATTRIBUTE_POSITION) return false;
    if (att.portableComponents !== 3) return false;
    this._predictor.setPositionAttribute(att);
    return true;
  }

  setQuantizationBits(q) {
    this._octahedronToolBox.setQuantizationBits(q);
  }

  decodePredictionData(buffer) {
    if (!this._transform.decodeTransformData(buffer)) return false;

    if (!this._flipNormalBitDecoder.startDecoding(buffer)) return false;

    return true;
  }

  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    this.setQuantizationBits(this._transform.quantizationBits());
    this._predictor.setEntryToPointIdMap(entryToPointIdMap);

    const cornerMapSize = this._meshData.dataToCornerMap.length;

    // Cache integer positions once so the per-corner ring traversal reads from
    // a flat array instead of mappedIndex + convertValue per fetch.
    this._predictor.buildPositionCache(cornerMapSize);

    const predNormal3D = new Int32Array(3);
    const predNormalOct = new Int32Array(2);

    for (let dataId = 0; dataId < cornerMapSize; ++dataId) {
      const cornerId = this._meshData.dataToCornerMap[dataId];
      this._predictor.computePredictedValue(cornerId, predNormal3D);

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

// compression/attributes/prediction_schemes/MeshPredictionSchemeData.js - ported from compression/attributes/prediction_schemes/mesh_prediction_scheme_data.h

/**
 * Stores mesh connectivity data and how it was encoded/decoded.
 */
class MeshPredictionSchemeData {

  constructor() {
    this._cornerTable = null;
    this._vertexToDataMap = null;
    this._dataToCornerMap = null;
  }

  set(cornerTable, dataToCornerMap, vertexToDataMap) {
    this._cornerTable = cornerTable;
    this._dataToCornerMap = dataToCornerMap;
    this._vertexToDataMap = vertexToDataMap;
  }

  get cornerTable() { return this._cornerTable; }

  get vertexToDataMap() { return this._vertexToDataMap; }

  get dataToCornerMap() { return this._dataToCornerMap; }

}

// compression/attributes/prediction_schemes/PredictionSchemeDecoderFactory.js - ported from compression/attributes/prediction_schemes/prediction_scheme_decoder_factory.h


function createMeshPredictionSchemeDecoder(method, attribute, transform,
  meshData, transformType) {

  // Normal octahedron transforms only support geometric normal prediction.
  if (transformType === PredictionSchemeTransformType.PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON_CANONICALIZED ||
      transformType === PredictionSchemeTransformType.PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON) {
    if (method === PredictionSchemeMethod.MESH_PREDICTION_GEOMETRIC_NORMAL) {
      return new MeshPredictionSchemeGeometricNormalDecoder(
        attribute, transform, meshData
      );
    }
    return null;
  }

  // Wrap and delta transforms accept any mesh prediction scheme.
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
 * Creates a prediction scheme for a decoder and method. If the method is
 * mesh-based and mesh data is available, builds the matching mesh scheme;
 * otherwise falls back to a delta decoder.
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

      meshData.set(
        attCornerTable !== null ? attCornerTable : cornerTable,
        encodingData.encodedAttributeValueIndexToCornerMap,
        encodingData.vertexToEncodedAttributeValueIndexMap
      );

      const transformType = transform.getType ? transform.getType() : -1;
      const ret = createMeshPredictionSchemeDecoder(
        method, att, transform, meshData, transformType
      );
      if (ret !== null) return ret;
    }
  }

  return new PredictionSchemeDeltaDecoder(att, transform);
}

// compression/attributes/prediction_schemes/PredictionSchemeWrapDecodingTransform.js - ported from compression/attributes/prediction_schemes/prediction_scheme_wrap_decoding_transform.h


// Unwraps values encoded with the wrap transform: the encoder stored a
// correction wrapped into the data range; decoding adds it to the prediction
// and wraps the result back into [min, max].
class PredictionSchemeWrapDecodingTransform {

  constructor() {
    this._numComponents = 0;
    this._minValue = 0;
    this._maxValue = 0;
    this._maxDif = 0;
  }

  getType() {
    return PredictionSchemeTransformType.PREDICTION_TRANSFORM_WRAP;
  }

  init(numComponents) {
    this._numComponents = numComponents;
  }

  areCorrectionsPositive() {
    return false;
  }

  computeOriginalValue(predictedVals, predictedOffset, corrVals, corrOffset,
    outOriginalVals, outOffset) {
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
      // 32-bit (| 0) arithmetic to avoid signed overflow.
      let orig = (pred + corrVals[corrOffset + i]) | 0;
      if (orig > maxValue) {
        orig -= maxDif;
      } else if (orig < minValue) {
        orig += maxDif;
      }
      outOriginalVals[outOffset + i] = orig;
    }
  }

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

  _initCorrectionBounds() {
    const dif = this._maxValue - this._minValue;
    if (dif < 0 || dif >= 0x7FFFFFFF) {
      return false;
    }
    this._maxDif = 1 + dif;
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

  finalizeAttribute() {
    // Keep the former store-time validation even for unrequested attributes.
    return this.attribute.dataType >= DataType.INT8 && this.attribute.dataType <= DataType.UINT32;
  }

  decodeValues(pointIds, buffer) {
    const predictionSchemeMethod = buffer.decodeInt8();
    if (predictionSchemeMethod === undefined) return false;

    if (predictionSchemeMethod < PredictionSchemeMethod.PREDICTION_NONE ||
        predictionSchemeMethod >= PredictionSchemeMethod.NUM_PREDICTION_SCHEMES) {
      return false;
    }

    if (predictionSchemeMethod !== PredictionSchemeMethod.PREDICTION_NONE) {
      const predictionTransformType = buffer.decodeInt8();
      if (predictionTransformType === undefined) return false;

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
      // decodeSymbols writes uint32 values into the provided array.
      const outUint32 = new Uint32Array(portableAttributeData.buffer,
        portableAttributeData.byteOffset, numValues);
      if (!decodeSymbols(numValues, numComponents, buffer, outUint32)) {
        return false;
      }
    } else {
      const numBytes = buffer.decodeUint8();
      if (numBytes === undefined) return false;

      if (numBytes === dataTypeLength(DataType.INT32)) {
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
          // Little-endian; |= with << sign-extends into a 32-bit int.
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
      // Reinterpret the Int32Array as Uint32 for the signed conversion.
      const asUint32 = new Uint32Array(portableAttributeData.buffer, portableAttributeData.byteOffset, numValues);
      convertSymbolsToSignedInts(asUint32, numValues, portableAttributeData);
    }

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

  // Prediction scheme for decoding integer values; subclasses override for others.
  createIntPredictionScheme(method, transformType) {
    if (transformType !== PredictionSchemeTransformType.PREDICTION_TRANSFORM_WRAP) {
      return null; // For now we support only wrap transform.
    }
    const transform = new PredictionSchemeWrapDecodingTransform();
    return createPredictionSchemeForDecoder(
      method, this.attributeId, this.decoder, transform
    );
  }

  getNumValueComponents() {
    return this.attribute.numComponents;
  }

  preparePortableAttribute(numEntries, numComponents) {
    this.attribute.portable = true;
    this.attribute.portableComponents = numComponents;
    this.attribute.values = new Int32Array(numEntries * numComponents);
  }

  getPortableAttributeData() {
    return this.attribute.size === 0 ? null : this.attribute.values;
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
    // C++ computes delta_ as `range / static_cast<float>(max_quantized_value)` in float32.
    // JS double division is 1-2 ULP off the WASM decoder, so fround every step.
    this._delta = Math.fround(range / Math.fround(maxQuantizedValue));
    return true;
  }

  get delta() {
    return this._delta;
  }

}

// attributes/AttributeQuantizationTransform.js - ported from attributes/attribute_quantization_transform.h/cc


class AttributeQuantizationTransform {

  constructor() {
    this._quantizationBits = -1;
    this._minValues = [];
    this._range = 0;
  }

  decodeParameters(attribute, decoderBuffer) {
    const numComponents = attribute.numComponents;
    this._minValues = new Array(numComponents);

    for (let i = 0; i < numComponents; i++) {
      const val = decoderBuffer.decodeFloat32();
      if (val === undefined) return false;
      this._minValues[i] = val;
    }

    const range = decoderBuffer.decodeFloat32();
    if (range === undefined) return false;
    this._range = range;

    const qBits = decoderBuffer.decodeUint8();
    if (qBits === undefined) return false;
    if (!AttributeQuantizationTransform._isQuantizationValid(qBits)) {
      return false;
    }
    this._quantizationBits = qBits;
    return true;
  }

  init() {
    const maxQuantizedValue = ((1 << this._quantizationBits) >>> 0) - 1;
    const dequantizer = new Dequantizer();
    if (!dequantizer.initFromRange(this._range, maxQuantizedValue)) return false;
    this._delta = dequantizer.delta;
    return true;
  }

  extractTo(values, map, output, nc) {
    const count = output.length / nc;
    const delta = this._delta;
    const min = this._minValues;
    const fround = Math.fround;
    // The original attribute was FLOAT32 even when the caller requests integer
    // output: round the final addition BEFORE the destination's conversion.
    if (nc === 3) {
      const m0 = min[0], m1 = min[1], m2 = min[2];
      for (let p = 0, d = 0; p < count; p++, d += 3) {
        const s = (map === null ? p : map[p]) * 3;
        output[d] = fround(fround(fround(values[s]) * delta) + m0);
        output[d + 1] = fround(fround(fround(values[s + 1]) * delta) + m1);
        output[d + 2] = fround(fround(fround(values[s + 2]) * delta) + m2);
      }
    } else if (nc === 2) {
      const m0 = min[0], m1 = min[1];
      for (let p = 0, d = 0; p < count; p++, d += 2) {
        const s = (map === null ? p : map[p]) * 2;
        output[d] = fround(fround(fround(values[s]) * delta) + m0);
        output[d + 1] = fround(fround(fround(values[s + 1]) * delta) + m1);
      }
    } else {
      for (let p = 0, d = 0; p < count; p++) {
        const s = (map === null ? p : map[p]) * nc;
        for (let c = 0; c < nc; c++) {
          output[d++] = fround(fround(fround(values[s + c]) * delta) + min[c]);
        }
      }
    }
  }

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
    // Only floating point attributes can be quantized.
    if (attribute.dataType !== DataType.FLOAT32) {
      return false;
    }
    return true;
  }

  decodeDataNeededByPortableTransform(pointIds, buffer) {
    return this._quantizationTransform.decodeParameters(this.attribute, buffer);
  }

  finalizeAttribute() {
    if (!this._quantizationTransform.init()) return false;
    this.attribute.transform = this._quantizationTransform;
    return true;
  }

}

// attributes/AttributeOctahedronTransform.js - ported from attributes/attribute_octahedron_transform.h/cc


class AttributeOctahedronTransform {

  constructor() {
    this._quantizationBits = -1;
  }

  decodeParameters(attribute, decoderBuffer) {
    const qBits = decoderBuffer.decodeUint8();
    if (qBits === undefined) return false;
    this._quantizationBits = qBits;
    return true;
  }

  init() {
    this._toolBox = new OctahedronToolBox();
    return this._toolBox.setQuantizationBits(this._quantizationBits);
  }

  extractTo(values, map, output) {
    const count = output.length / 3;
    for (let p = 0, d = 0; p < count; p++, d += 3) {
      const s = (map === null ? p : map[p]) * 2;
      // The toolbox explicitly rounds every result to FLOAT32, including when
      // output is an integer array. No intermediate normal vector is needed.
      this._toolBox.quantizedOctahedralCoordsToUnitVector(values[s], values[s + 1], output, d);
    }
  }

}

// compression/attributes/prediction_schemes/PredictionSchemeNormalOctahedronTransformBase.js - ported from compression/attributes/prediction_schemes/prediction_scheme_normal_octahedron_transform_base.h
//
// Shared base for the octahedral-normal decoding transforms. Holds the
// OctahedronToolBox and the quantization-bit plumbing; each subclass supplies
// its own getType / decodeTransformData / computeOriginalValue.


class PredictionSchemeNormalOctahedronTransformBase {

  constructor() {
    this._octahedronToolBox = new OctahedronToolBox();
  }

  areCorrectionsPositive() {
    return true;
  }

  /** No-op to fulfill the transform interface. */
  init(numComponents) {}

  quantizationBits() {
    return this._octahedronToolBox.quantizationBits();
  }

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

// compression/attributes/prediction_schemes/PredictionSchemeNormalOctahedronCanonicalizedDecodingTransform.js - ported from compression/attributes/prediction_schemes/prediction_scheme_normal_octahedron_canonicalized_decoding_transform.h


/**
 * Decodes correction values that were transformed using the canonicalized
 * octahedral normal transform back to original values.
 */
class PredictionSchemeNormalOctahedronCanonicalizedDecodingTransform extends PredictionSchemeNormalOctahedronTransformBase {

  getType() {
    return PredictionSchemeTransformType.PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON_CANONICALIZED;
  }

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

  computeOriginalValue(predVals, predOffset, corrVals, corrOffset,
    outOrigVals, outOffset) {
    const toolBox = this._octahedronToolBox;
    const center = toolBox._centerValue;
    const maxQuantizedValue = toolBox._maxQuantizedValue;
    const corrS = corrVals[corrOffset];
    const corrT = corrVals[corrOffset + 1];

    let predS = predVals[predOffset] - center;
    let predT = predVals[predOffset + 1] - center;

    const predIsInDiamond = (Math.abs(predS) + Math.abs(predT)) <= center;
    if (!predIsInDiamond) {
      let signS = 0;
      let signT = 0;
      if (predS >= 0 && predT >= 0) {
        signS = 1; signT = 1;
      } else if (predS <= 0 && predT <= 0) {
        signS = -1; signT = -1;
      } else {
        signS = (predS > 0) ? 1 : -1;
        signT = (predT > 0) ? 1 : -1;
      }
      const cornerPointS = signS * center;
      const cornerPointT = signT * center;
      let us = (predS * 2 - cornerPointS) | 0;
      let ut = (predT * 2 - cornerPointT) | 0;
      if (signS * signT >= 0) {
        const temp = us;
        us = -ut;
        ut = -temp;
      } else {
        const temp = us;
        us = ut;
        ut = temp;
      }
      predS = ((us + cornerPointS) / 2) | 0;
      predT = ((ut + cornerPointT) / 2) | 0;
    }

    const predIsInBottomLeft = (predS === 0 && predT === 0) || (predS < 0 && predT <= 0);

    let rotationCount = 0;
    if (predS === 0) {
      if (predT > 0) rotationCount = 3;
      else if (predT < 0) rotationCount = 1;
    } else if (predS > 0) {
      if (predT >= 0) rotationCount = 2;
      else rotationCount = 1;
    } else {
      if (predT > 0) rotationCount = 3;
    }

    if (!predIsInBottomLeft) {
      const s = predS, t = predT;
      // `(-x) | 0` normalises -0 (from negating 0) to +0 so V8 keeps the Smi
      // fast path instead of deopting; bit-exact for these int32 values.
      switch (rotationCount) {
        case 1: predS = t; predT = (-s) | 0; break;
        case 2: predS = (-s) | 0; predT = (-t) | 0; break;
        case 3: predS = (-t) | 0; predT = s; break;
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
      switch ((4 - rotationCount) & 3) {
        case 1: origS = t; origT = (-s) | 0; break;
        case 2: origS = (-s) | 0; origT = (-t) | 0; break;
        case 3: origS = (-t) | 0; origT = s; break;
      }
    }

    if (!predIsInDiamond) {
      let signS = 0;
      let signT = 0;
      if (origS >= 0 && origT >= 0) {
        signS = 1; signT = 1;
      } else if (origS <= 0 && origT <= 0) {
        signS = -1; signT = -1;
      } else {
        signS = (origS > 0) ? 1 : -1;
        signT = (origT > 0) ? 1 : -1;
      }
      const cornerPointS = signS * center;
      const cornerPointT = signT * center;
      let us = (origS * 2 - cornerPointS) | 0;
      let ut = (origT * 2 - cornerPointT) | 0;
      if (signS * signT >= 0) {
        const temp = us;
        us = -ut;
        ut = -temp;
      } else {
        const temp = us;
        us = ut;
        ut = temp;
      }
      origS = ((us + cornerPointS) / 2) | 0;
      origT = ((ut + cornerPointT) / 2) | 0;
    }

    outOrigVals[outOffset] = origS + center;
    outOrigVals[outOffset + 1] = origT + center;
  }

}

// compression/attributes/prediction_schemes/PredictionSchemeNormalOctahedronDecodingTransform.js - ported from compression/attributes/prediction_schemes/prediction_scheme_normal_octahedron_decoding_transform.h


/**
 * Decodes correction values that were transformed using the octahedral normal
 * transform back to original values. Used for backwards compatibility.
 */
class PredictionSchemeNormalOctahedronDecodingTransform extends PredictionSchemeNormalOctahedronTransformBase {

  getType() {
    return PredictionSchemeTransformType.PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON;
  }

  decodeTransformData(buffer) {
    const maxQuantizedValue = buffer.decodeInt32();
    if (maxQuantizedValue === undefined) return false;

    return this._setMaxQuantizedValue(maxQuantizedValue);
  }

  computeOriginalValue(predVals, predOffset, corrVals, corrOffset,
    outOrigVals, outOffset) {
    const toolBox = this._octahedronToolBox;
    const center = toolBox._centerValue;
    const maxQuantizedValue = toolBox._maxQuantizedValue;

    const predS = predVals[predOffset] - center;
    const predT = predVals[predOffset + 1] - center;
    const corrS = corrVals[corrOffset];
    const corrT = corrVals[corrOffset + 1];

    const predIsInDiamond = (Math.abs(predS) + Math.abs(predT)) <= center;

    let ps = predS;
    let pt = predT;
    if (!predIsInDiamond) {
      let signS = 0;
      let signT = 0;
      if (ps >= 0 && pt >= 0) {
        signS = 1; signT = 1;
      } else if (ps <= 0 && pt <= 0) {
        signS = -1; signT = -1;
      } else {
        signS = (ps > 0) ? 1 : -1;
        signT = (pt > 0) ? 1 : -1;
      }
      const cornerPointS = signS * center;
      const cornerPointT = signT * center;
      let us = (ps * 2 - cornerPointS) | 0;
      let ut = (pt * 2 - cornerPointT) | 0;
      if (signS * signT >= 0) {
        const temp = us;
        us = -ut;
        ut = -temp;
      } else {
        const temp = us;
        us = ut;
        ut = temp;
      }
      ps = ((us + cornerPointS) / 2) | 0;
      pt = ((ut + cornerPointT) / 2) | 0;
    }

    // Unsigned addition to avoid signed overflow.
    let origS = (ps + corrS) | 0;
    let origT = (pt + corrT) | 0;

    if (origS > center) origS -= maxQuantizedValue;
    else if (origS < -center) origS += maxQuantizedValue;
    if (origT > center) origT -= maxQuantizedValue;
    else if (origT < -center) origT += maxQuantizedValue;

    if (!predIsInDiamond) {
      let signS = 0;
      let signT = 0;
      if (origS >= 0 && origT >= 0) {
        signS = 1; signT = 1;
      } else if (origS <= 0 && origT <= 0) {
        signS = -1; signT = -1;
      } else {
        signS = (origS > 0) ? 1 : -1;
        signT = (origT > 0) ? 1 : -1;
      }
      const cornerPointS = signS * center;
      const cornerPointT = signT * center;
      let us = (origS * 2 - cornerPointS) | 0;
      let ut = (origT * 2 - cornerPointT) | 0;
      if (signS * signT >= 0) {
        const temp = us;
        us = -ut;
        ut = -temp;
      } else {
        const temp = us;
        us = ut;
        ut = temp;
      }
      origS = ((us + cornerPointS) / 2) | 0;
      origT = ((ut + cornerPointT) / 2) | 0;
    }

    outOrigVals[outOffset] = (origS + center) | 0;
    outOrigVals[outOffset + 1] = (origT + center) | 0;
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
    // Only 3-component FLOAT32 normals are supported.
    if (this.attribute.numComponents !== 3) {
      return false;
    }
    if (this.attribute.dataType !== DataType.FLOAT32) {
      return false;
    }
    return true;
  }

  // Normals quantize into two octahedral components.
  getNumValueComponents() {
    return 2;
  }

  decodeDataNeededByPortableTransform(pointIds, buffer) {
    return this._octahedralTransform.decodeParameters(
      this.attribute, buffer
    );
  }

  finalizeAttribute() {
    if (!this._octahedralTransform.init()) return false;
    this.attribute.transform = this._octahedralTransform;
    return true;
  }

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


// Creates one SequentialAttributeDecoder per attribute; the decoder type is
// chosen from the id encoded by the matching encoder.
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
    const numAttributes = this.getNumAttributes();
    this._sequentialDecoders.length = numAttributes;
    for (let i = 0; i < numAttributes; i++) {
      const decoderType = buffer.decodeUint8();
      if (decoderType === undefined) return false;

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

  finalizeAttributes() {
    const numAttributes = this.getNumAttributes();
    for (let i = 0; i < numAttributes; i++) {
      if (!this._sequentialDecoders[i].finalizeAttribute(
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
    return null;
  }

}

// compression/attributes/LinearSequencer.js - ported from compression/attributes/linear_sequencer.h

// Sequencer that preserves point order: generates the sequence [0, numPoints-1].
// Used by the mesh sequential decoder. Implements the interface driven by
// SequentialAttributeDecodersController.
class LinearSequencer {

  constructor(numPoints) {
    this._numPoints = numPoints;
    this._outPointIds = new Int32Array(0);
  }

  generateSequence(/* outPointIds */) {
    if (this._numPoints < 0) {
      return false;
    }
    const ids = new Int32Array(this._numPoints);
    for (let i = 0; i < this._numPoints; ++i) {
      ids[i] = i;
    }
    this._outPointIds = ids;
    return true;
  }

  getOutputPointIds() {
    return this._outPointIds;
  }

  updatePointToAttributeIndexMapping(attribute) {
    attribute.setIdentityMapping();
    return true;
  }

}

// compression/mesh/MeshSequentialDecoder.js - ported from mesh/mesh_sequential_decoder.h/cc


class MeshSequentialDecoder extends MeshDecoder {

  constructor() {
    super();
  }

  decodeConnectivity() {
    let numFaces;
    let numPoints;

    numFaces = decodeVarint(this.buffer());
    if (numFaces === undefined) return false;
    numPoints = decodeVarint(this.buffer());
    if (numPoints === undefined) return false;

    // Compressed sequential encoding can only handle (2^32 - 1) / 3 indices.
    if (numFaces > 0xFFFFFFFF / 3) {
      return false;
    }
    if (numFaces > this.buffer().remainingSize / 3) {
      return false;
    }

    const connectivityMethod = this.buffer().decodeUint8();
    if (connectivityMethod === undefined) {
      return false;
    }

    // Reserve once without changing the count: addFace still appends and keeps
    // partial-decode behavior, without copying the entire buffer for each face.
    const mesh = this.mesh();
    mesh._ensureFaceCapacity(mesh.numFaces() + numFaces);

    if (connectivityMethod === 0) {
      if (!this._decodeAndDecompressIndices(numFaces)) {
        return false;
      }
    } else {
      if (numPoints < 256) {
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
        for (let i = 0; i < numFaces; ++i) {
          const face = [0, 0, 0];
          for (let j = 0; j < 3; ++j) {
            const val = this.buffer().decodeUint16();
            if (val === undefined) return false;
            face[j] = val;
          }
          this.mesh().addFace(face);
        }
      } else if (numPoints < (1 << 21)) {
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
    // Sequential meshes store attribute values directly in point order, so a
    // LinearSequencer drives the SequentialAttributeDecodersController.
    return this.setAttributesDecoder(
      attDecoderId,
      new SequentialAttributeDecodersController(
        new LinearSequencer(this.pointCloud().numPoints())
      )
    );
  }

  _decodeAndDecompressIndices(numFaces) {
    const indicesBuffer = new Uint32Array(numFaces * 3);
    if (!decodeSymbols(numFaces * 3, 1, this.buffer(), indicesBuffer)) {
      return false;
    }
    // Reconstruct the indices from the differences.
    // See MeshSequentialEncoder::CompressAndEncodeIndices() for more details.
    let lastIndexValue = 0; // This will always be >= 0.
    let vertexIndex = 0;
    for (let i = 0; i < numFaces; ++i) {
      const face = [0, 0, 0];
      for (let j = 0; j < 3; ++j) {
        const encodedVal = indicesBuffer[vertexIndex++];
        let indexDiff = (encodedVal >>> 1);
        if (encodedVal & 1) {
          if (indexDiff > lastIndexValue) {
            // Subtracting indexDiff would result in a negative index.
            return false;
          }
          indexDiff = -indexDiff;
        } else {
          if (indexDiff > (0x7FFFFFFF - lastIndexValue)) {
            // Adding indexDiff to lastIndexValue would overflow.
            return false;
          }
        }
        const indexValue = (indexDiff + lastIndexValue) | 0;
        face[j] = indexValue;
        lastIndexValue = indexValue;
      }
      this.mesh().addFace(face);
    }
    return true;
  }

}

// compression/mesh/MeshEdgebreakerShared.js - ported from mesh/mesh_edgebreaker_shared.h

// Edgebreaker topology bit patterns (variable-length codes; trailing comment is
// the bit sequence as stored in the bitstream).
const TOPOLOGY_C = 0x0;  // 0
const TOPOLOGY_S = 0x1;  // 1 0 0
const TOPOLOGY_L = 0x3;  // 1 1 0
const TOPOLOGY_R = 0x5;  // 1 0 1
const TOPOLOGY_E = 0x7;  // 1 1 1
const TOPOLOGY_INVALID = 9;

const edgeBreakerSymbolToTopologyId = [
  TOPOLOGY_C, TOPOLOGY_S, TOPOLOGY_L, TOPOLOGY_R, TOPOLOGY_E
];

// Edge relative to the tip vertex of a visited triangle (the other is the left edge).
const RIGHT_FACE_EDGE = 1;

// Data about a source face connecting to an already-traversed face that was
// either the initial face or one encoded with the topology S (split) symbol.
class TopologySplitEventData {

  constructor() {
    this.splitSymbolId = 0;
    this.sourceSymbolId = 0;
    this.sourceEdge = 0; // 0 = LEFT_FACE_EDGE, 1 = RIGHT_FACE_EDGE
  }

}

// compression/mesh/traverser/DepthFirstTraverser.js - ported from compression/mesh/traverser/depth_first_traverser.h

const kInvalidCornerIndex$3 = -1;
const kInvalidFaceIndex$1 = -1;
const kInvalidVertexIndex$1 = -1;

// DFS traversal of a mesh over the CornerTable.
class DepthFirstTraverser {

  constructor() {
    this._cornerTable = null;
    this._observer = null;
    this._isFaceVisited = null;
    this._isVertexVisited = null;
    this._cornerTraversalStack = [];
    this._numVisitedFaces = 0;
    // Identifies the traversal order for the shared traversal cache
    // (MESH_TRAVERSAL_DEPTH_FIRST). See MeshTraversalSequencer.
    this._traversalMethodId = 0;
  }

  init(cornerTable, observer) {
    this._cornerTable = cornerTable;
    this._observer = observer;
    this._numVisitedFaces = 0;
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

  onTraversalStart() {
    this._observer.onTraversalStart();
    // The sequencer calls this only after a traversal-cache miss. Allocate
    // scratch storage here so attributes reusing a traversal need none of it.
    const cornerTable = this._cornerTable;
    this._isFaceVisited = new Uint8Array(cornerTable.numFaces());
    this._isVertexVisited = new Uint8Array(cornerTable.numVertices());
    // Storage follows traversal depth, which is usually much smaller than the
    // number of mesh corners. Grow only when a branch needs another slot.
    this._cornerTraversalStack = new Int32Array(64);
    this._numVisitedFaces = 0;
  }
  onTraversalEnd() {}

  traverseFromCorner(cornerId) {
    if (this._isFaceVisited[(cornerId / 3) | 0]) {
      return true; // Already traversed.
    }

    const isFaceVisited = this._isFaceVisited;
    const isVertexVisited = this._isVertexVisited;
    const observer = this._observer;
    const cornerToVertex = this._cornerToVertex;
    const oppositeCorners = this._oppositeCorners;
    const vertexLeftmost = this._vertexLeftmost;
    let stack = this._cornerTraversalStack;
    let numVisitedFaces = this._numVisitedFaces;

    let stackSize = 0;
    stack[stackSize++] = cornerId;

    // For the first face the other two corners may not be processed yet.
    const nextCorner = (cornerId % 3) === 2 ? cornerId - 2 : cornerId + 1;
    const prevCorner = (cornerId % 3) === 0 ? cornerId + 2 : cornerId - 1;
    const nextVert = cornerToVertex[nextCorner];
    const prevVert = cornerToVertex[prevCorner];
    if (nextVert === kInvalidVertexIndex$1 || prevVert === kInvalidVertexIndex$1) {
      return false;
    }
    if (!isVertexVisited[nextVert]) {
      isVertexVisited[nextVert] = true;
      observer.onNewVertexVisited(nextVert, nextCorner);
    }
    if (!isVertexVisited[prevVert]) {
      isVertexVisited[prevVert] = true;
      observer.onNewVertexVisited(prevVert, prevCorner);
    }

    while (stackSize > 0) {
      cornerId = stack[stackSize - 1];
      let faceId = (cornerId / 3) | 0;

      if (cornerId === kInvalidCornerIndex$3 || isFaceVisited[faceId]) {
        stackSize--;
        continue;
      }

      while (true) {
        isFaceVisited[faceId] = true;
        numVisitedFaces++;

        const vertId = cornerToVertex[cornerId];
        if (vertId === kInvalidVertexIndex$1) {
          return false;
        }
        if (!isVertexVisited[vertId]) {
          // Inlined isOnBoundary
          const lc = vertexLeftmost[vertId];
          let onBoundary = true;
          if (lc !== undefined && lc >= 0) {
            const nextLc = (lc % 3) === 2 ? lc - 2 : lc + 1;
            onBoundary = oppositeCorners[nextLc] < 0;
          }
          isVertexVisited[vertId] = true;
          observer.onNewVertexVisited(vertId, cornerId);
          if (!onBoundary) {
            // Move to the right corner: opposite(next(cornerId)).
            const nextCornerId = (cornerId % 3) === 2 ? cornerId - 2 : cornerId + 1;
            cornerId = oppositeCorners[nextCornerId];
            faceId = (cornerId / 3) | 0;
            continue;
          }
        }

        // The current vertex has been already visited or it was on a boundary.
        const nextCornerId = (cornerId % 3) === 2 ? cornerId - 2 : cornerId + 1;
        const rightCornerId = oppositeCorners[nextCornerId];

        const prevCornerId = (cornerId % 3) === 0 ? cornerId + 2 : cornerId - 1;
        const leftCornerId = oppositeCorners[prevCornerId];

        const rightFaceId = rightCornerId === kInvalidCornerIndex$3
          ? kInvalidFaceIndex$1 : (rightCornerId / 3) | 0;
        const leftFaceId = leftCornerId === kInvalidCornerIndex$3
          ? kInvalidFaceIndex$1 : (leftCornerId / 3) | 0;

        const isRightVisited = rightFaceId === kInvalidFaceIndex$1 ||
          isFaceVisited[rightFaceId];
        const isLeftVisited = leftFaceId === kInvalidFaceIndex$1 ||
          isFaceVisited[leftFaceId];

        if (isRightVisited) {
          if (isLeftVisited) {
            // Both neighbors visited: this branch ends.
            stackSize--;
            break;
          } else {
            cornerId = leftCornerId;
            faceId = leftFaceId;
          }
        } else {
          if (isLeftVisited) {
            cornerId = rightCornerId;
            faceId = rightFaceId;
          } else {
            // Both neighbors unvisited: continue left, push right to resume later.
            stack[stackSize - 1] = leftCornerId;
            if (stackSize === stack.length) {
              const grown = new Int32Array(stack.length * 2);
              grown.set(stack);
              this._cornerTraversalStack = stack = grown;
            }
            stack[stackSize++] = rightCornerId;
            break;
          }
        }
      }
    }
    this._numVisitedFaces = numVisitedFaces;
    return true;
  }

}

// compression/mesh/traverser/MaxPredictionDegreeTraverser.js - ported from compression/mesh/traverser/max_prediction_degree_traverser.h

const kInvalidCornerIndex$2 = -1;
const kInvalidFaceIndex = -1;

// For efficiency the priority traversal uses buckets, where each bucket is a
// stack of available corners for a given priority. Corners with the highest
// priority (lowest bucket index) are always processed first.
const kMaxPriority = 3;

// Traverser that visits a mesh in an order implicitly guided by the prediction
// degree of the destination vertices ("Multi-way Geometry Encoding",
// Cohen-or et al. '02). Implements the same interface as DepthFirstTraverser so
// it is a drop-in alternative inside MeshTraversalSequencer. Used when the
// bitstream selects MESH_TRAVERSAL_PREDICTION_DEGREE (higher compression
// levels).
class MaxPredictionDegreeTraverser {

  constructor() {
    this._cornerTable = null;
    this._observer = null;
    this._isFaceVisited = null;
    this._isVertexVisited = null;
    this._numVisitedFaces = 0;
    // One stack (bucket) per priority level [0, kMaxPriority).
    this._traversalStacks = null;
    this._bestPriority = 0;
    // Prediction degree accumulated per vertex during traversal.
    this._predictionDegree = null;
    // Flat connectivity arrays (see DepthFirstTraverser for why).
    this._cornerToVertex = null;
    this._oppositeCorners = null;
    // Identifies the traversal order for the shared traversal cache
    // (MESH_TRAVERSAL_PREDICTION_DEGREE). See MeshTraversalSequencer.
    this._traversalMethodId = 1;
  }

  init(cornerTable, observer) {
    this._cornerTable = cornerTable;
    this._observer = observer;
    this._numVisitedFaces = 0;
    this._cornerToVertex = cornerTable.cornerToVertexArray();
    this._oppositeCorners = cornerTable.oppositeCornerArray();
    this._bestPriority = 0;
  }

  cornerTable() {
    return this._cornerTable;
  }

  // corner is always valid (>= 0) where these are used.
  _next(c) {
    return (c % 3) === 2 ? c - 2 : c + 1;
  }
  _previous(c) {
    return (c % 3) === 0 ? c + 2 : c - 1;
  }

  onTraversalStart() {
    this._observer.onTraversalStart();
    // Cache hits never start a traversal, so they do not need visited flags,
    // priority buckets or prediction-degree storage.
    const cornerTable = this._cornerTable;
    this._isFaceVisited = new Uint8Array(cornerTable.numFaces());
    this._isVertexVisited = new Uint8Array(cornerTable.numVertices());
    this._traversalStacks = [[], [], []]; // kMaxPriority buckets
    this._predictionDegree = new Int32Array(cornerTable.numVertices());
    this._numVisitedFaces = 0;
    this._bestPriority = 0;
  }

  onTraversalEnd() {}

  // Returns the priority of traversing the edge leading to cornerId. Mutates
  // the prediction degree of the destination vertex.
  _computePriority(cornerId) {
    const vTip = this._cornerToVertex[cornerId];
    // Priority 0 when traversing to already visited vertices.
    let priority = 0;
    if (!this._isVertexVisited[vTip]) {
      const degree = ++this._predictionDegree[vTip];
      // Priority 1 when prediction degree > 1, otherwise 2.
      priority = degree > 1 ? 1 : 2;
    }
    if (priority >= kMaxPriority) {
      priority = kMaxPriority - 1;
    }
    return priority;
  }

  _addCornerToTraversalStack(ci, priority) {
    this._traversalStacks[priority].push(ci);
    // Keep the best available priority up to date.
    if (priority < this._bestPriority) {
      this._bestPriority = priority;
    }
  }

  // Retrieves the next available corner to traverse, processed by priority.
  // Returns kInvalidCornerIndex when no corner is available.
  _popNextCornerToTraverse() {
    for (let i = this._bestPriority; i < kMaxPriority; ++i) {
      const stack = this._traversalStacks[i];
      if (stack.length > 0) {
        const ret = stack.pop();
        this._bestPriority = i;
        return ret;
      }
    }
    return kInvalidCornerIndex$2;
  }

  traverseFromCorner(cornerId) {
    if (this._predictionDegree.length === 0) {
      return true;
    }

    const cornerToVertex = this._cornerToVertex;
    const oppositeCorners = this._oppositeCorners;
    const isFaceVisited = this._isFaceVisited;
    const isVertexVisited = this._isVertexVisited;
    const observer = this._observer;

    this._traversalStacks[0].push(cornerId);
    this._bestPriority = 0;

    // For the first face the other two corners may not be processed yet.
    const firstNext = this._next(cornerId);
    const firstPrev = this._previous(cornerId);
    const nextVert = cornerToVertex[firstNext];
    const prevVert = cornerToVertex[firstPrev];
    if (!isVertexVisited[nextVert]) {
      isVertexVisited[nextVert] = 1;
      observer.onNewVertexVisited(nextVert, firstNext);
    }
    if (!isVertexVisited[prevVert]) {
      isVertexVisited[prevVert] = 1;
      observer.onNewVertexVisited(prevVert, firstPrev);
    }
    const tipVertex = cornerToVertex[cornerId];
    if (!isVertexVisited[tipVertex]) {
      isVertexVisited[tipVertex] = 1;
      observer.onNewVertexVisited(tipVertex, cornerId);
    }

    while ((cornerId = this._popNextCornerToTraverse()) !== kInvalidCornerIndex$2) {
      let faceId = (cornerId / 3) | 0;
      if (isFaceVisited[faceId]) {
        continue;
      }

      while (true) {
        faceId = (cornerId / 3) | 0;
        isFaceVisited[faceId] = 1;
        this._numVisitedFaces++;

        const vertId = cornerToVertex[cornerId];
        if (!isVertexVisited[vertId]) {
          isVertexVisited[vertId] = 1;
          observer.onNewVertexVisited(vertId, cornerId);
        }

        // right = opposite(next(corner)); left = opposite(previous(corner)).
        const rightCornerId = oppositeCorners[this._next(cornerId)];
        const leftCornerId = oppositeCorners[this._previous(cornerId)];
        const rightFaceId = rightCornerId === kInvalidCornerIndex$2
          ? kInvalidFaceIndex : (rightCornerId / 3) | 0;
        const leftFaceId = leftCornerId === kInvalidCornerIndex$2
          ? kInvalidFaceIndex : (leftCornerId / 3) | 0;
        const isRightFaceVisited = rightFaceId === kInvalidFaceIndex ||
          isFaceVisited[rightFaceId] !== 0;
        const isLeftFaceVisited = leftFaceId === kInvalidFaceIndex ||
          isFaceVisited[leftFaceId] !== 0;

        if (!isLeftFaceVisited) {
          const priority = this._computePriority(leftCornerId);
          if (isRightFaceVisited && priority <= this._bestPriority) {
            // Best priority and nothing else pending: traverse left without
            // a stack round-trip.
            cornerId = leftCornerId;
            continue;
          } else {
            this._addCornerToTraversalStack(leftCornerId, priority);
          }
        }
        if (!isRightFaceVisited) {
          const priority = this._computePriority(rightCornerId);
          if (priority <= this._bestPriority) {
            // Best priority: traverse right without a stack round-trip.
            cornerId = rightCornerId;
            continue;
          } else {
            this._addCornerToTraversalStack(rightCornerId, priority);
          }
        }

        // Couldn't proceed directly to the next corner.
        break;
      }
    }
    return true;
  }

}

// compression/mesh/traverser/MeshTraversalSequencer.js - ported from compression/mesh/traverser/mesh_traversal_sequencer.h

// Sequencer that generates point sequence in an order given by a deterministic
// traversal on the mesh surface.
class MeshTraversalSequencer {

  constructor(mesh, encodingData, traversalCache = null) {
    this._mesh = mesh;
    this._encodingData = encodingData;
    this._traverser = null;
    this._outPointIds = new Int32Array(0);
    this._numOutPoints = 0;
    // Optional per-decode cache, keyed by corner table, shared across the
    // attribute decoders of one mesh (see MeshEdgebreakerDecoderImpl).
    this._traversalCache = traversalCache;
  }

  setTraverser(traverser) {
    this._traverser = traverser;
  }

  generateSequence(/* outPointIds */) {
    // A traversal's output (point order + encoding maps) depends only on the
    // corner table's connectivity AND the traversal method, not on the
    // attribute being decoded. Meshes with several vertex-mapped attributes
    // share one corner table, so reuse a previously computed result instead of
    // repeating the O(faces) traversal — but only for the same traversal
    // method, since different methods produce different orders.
    const cornerTable = this._traverser.cornerTable();
    const methodId = this._traverser._traversalMethodId;
    // Key the cache by the flat cornerToVertex array, not the corner-table
    // instance: attributes with identical seams share these arrays (via
    // adoptVertexRecompute) so they produce the same traversal, and within a
    // prim all attributes share faces_ -- so the cached point order/maps apply.
    const cacheKey = cornerTable.cornerToVertexArray();
    if (this._traversalCache) {
      const byMethod = this._traversalCache.get(cacheKey);
      const cached = byMethod && byMethod.get(methodId);
      if (cached !== undefined) {
        this._outPointIds = cached.pointIds;
        this._encodingData.adoptTraversalResult(
          cached.vertexMap, cached.cornerMap, cached.numValues);
        return true;
      }
    }

    if (!this._generateSequenceInternal()) {
      return false;
    }

    if (this._encodingData.numValues < this._encodingData._encodedAttributeValueIndexToCornerMap.length) {
      this._encodingData._encodedAttributeValueIndexToCornerMap =
        this._encodingData._encodedAttributeValueIndexToCornerMap.subarray(0, this._encodingData.numValues);
    }

    if (this._traversalCache) {
      let byMethod = this._traversalCache.get(cacheKey);
      if (byMethod === undefined) {
        byMethod = new Map();
        this._traversalCache.set(cacheKey, byMethod);
      }
      byMethod.set(methodId, {
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
    this._outPointIds[this._numOutPoints++] = pointId;
  }

  updatePointToAttributeIndexMapping(attribute) {
    const cornerTable = this._traverser.cornerTable();
    const numFaces = this._mesh.numFaces();
    const numPoints = this._mesh.numPoints();
    attribute.setExplicitMapping(numPoints);
    // Iterate corners directly over the flat connectivity arrays: the corner
    // table is one of two classes, so vertex()/cornerToPointId()/setPointMapEntry()
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
    this._numOutPoints = 0;
    this._outPointIds = new Int32Array(this._mesh.numPoints());

    this._traverser.onTraversalStart();
    const numFaces = this._traverser.cornerTable().numFaces();
    for (let i = 0; i < numFaces && this._traverser._numVisitedFaces < numFaces; ++i) {
      if (!this._traverser.traverseFromCorner(3 * i)) {
        return false;
      }
    }
    this._traverser.onTraversalEnd();

    if (this._numOutPoints < this._outPointIds.length) {
      this._outPointIds = this._outPointIds.subarray(0, this._numOutPoints);
    }
    return true;
  }

}

// compression/mesh/traverser/MeshAttributeIndicesEncodingObserver.js - ported from compression/mesh/traverser/mesh_attribute_indices_encoding_observer.h

// Observer that records vertex visit order during mesh traversal.
// Used to generate encoding/decoding order for attribute values.
class MeshAttributeIndicesEncodingObserver {

  constructor(mesh, sequencer, encodingData) {
    this._encodingData = encodingData;
    this._sequencer = sequencer;
    this._faces = mesh.faces_;
  }

  onTraversalStart() {
    this._encodingData.allocate();
    this._vertexToEncodedMap = this._encodingData.vertexToEncodedAttributeValueIndexMap;
    this._encodedToCornerMap = this._encodingData.encodedAttributeValueIndexToCornerMap;
  }

  onNewVertexVisited(vertex, corner) {
    const pointId = this._faces[corner];
    this._sequencer.addPointId(pointId);

    const numValues = this._encodingData.numValues;
    this._encodedToCornerMap[numValues] = corner;
    this._vertexToEncodedMap[vertex] = numValues;
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
    this.corner_table_ = null;

  }

  initEmpty(table) {

    if (table === null) {
      return false;
    }

    // Only seam flags are needed before recomputation or adoption of an
    // identical seam layout. Delay the corner map until recomputation is needed.
    this.is_edge_on_seam_ = new Uint8Array(table.numCorners());
    this.is_vertex_on_seam_ = new Uint8Array(table.numVertices());
    this.corner_to_vertex_map_ = null;
    this.vertex_to_left_most_corner_map_ = [];
    // Lazily built; see oppositeCornerArray.
    this._effectiveOpposite = null;
    this._hasCompactBaseVertices = false;
    this.corner_table_ = table;
    this.no_interior_seams_ = true;
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

  recomputeVertices() {

    this._hasCompactBaseVertices = false;
    if (this.no_interior_seams_ && this._recomputeBaseVertices()) {
      return true;
    }
    return this._recomputeVerticesInternal();

  }

  // With boundary seams only, attribute vertices are the non-isolated base
  // vertices in ascending order. Preserve that dense numbering with a flat
  // remap instead of walking each vertex ring.
  _recomputeBaseVertices() {

    const ct = this.corner_table_;
    const numVertices = ct.numVertices();
    const numCorners = ct.numCorners();
    const baseCorners = ct.cornerToVertexArray();
    const baseOpposite = ct.oppositeCornerArray();
    const baseLeftmost = ct.vertexLeftmostCornerArray();
    const compact = new Int32Array(numVertices).fill(kInvalidVertexIndex);
    let numNewVertices = 0;

    for (let v = 0; v < numVertices; ++v) {
      const c = baseLeftmost[v];
      if (c === kInvalidCornerIndex$1) continue;
      if (c < 0 || c >= numCorners || baseCorners[c] !== v) return false;
      // CornerTable guarantees a boundary vertex's leftmost corner is at its
      // boundary end. Keep the original ring walk for unusual input that does
      // not satisfy that invariant, including its malformed-cycle rejection.
      if (this.is_vertex_on_seam_[v]) {
        const next = c % 3 === 2 ? c - 2 : c + 1;
        if (baseOpposite[next] !== kInvalidCornerIndex$1) return false;
      }
      compact[v] = numNewVertices++;
    }

    const cornerToVertex = new Int32Array(numCorners);
    for (let c = 0; c < numCorners; ++c) {
      const v = baseCorners[c];
      if (v < 0 || v >= numVertices || compact[v] === kInvalidVertexIndex) {
        return false;
      }
      cornerToVertex[c] = compact[v];
    }
    const leftmost = new Int32Array(numNewVertices);
    for (let v = 0; v < numVertices; ++v) {
      if (compact[v] !== kInvalidVertexIndex) {
        leftmost[compact[v]] = baseLeftmost[v];
      }
    }

    this.corner_to_vertex_map_ = cornerToVertex;
    this.vertex_to_left_most_corner_map_ = leftmost;
    // Boundary opposites are already -1, so no seam-masked copy is needed.
    this._effectiveOpposite = baseOpposite;
    this._hasCompactBaseVertices = true;
    return true;

  }

  // Only the C++ RecomputeVertices(nullptr, nullptr) path: the decoder always
  // rebuilds the attribute-vertex maps from connectivity alone.
  _recomputeVerticesInternal() {

    const ct = this.corner_table_;
    const numCorners = ct.numCorners();
    const numBaseVertices = ct.numVertices();
    // Preallocate leftMostMap by new-vertex id (new-vertex count <= numCorners).
    const leftMostMap = new Int32Array(numCorners);
    const cornerToVertex = new Int32Array(numCorners).fill(kInvalidVertexIndex);
    this.corner_to_vertex_map_ = cornerToVertex;
    const isVertexOnSeam = this.is_vertex_on_seam_;
    const isEdgeOnSeam = this.is_edge_on_seam_;
    // Flat connectivity arrays so the per-corner swings inline to typed-array
    // arithmetic instead of polymorphic dispatch.
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
      if (c === kInvalidCornerIndex$1) continue;

      if (!isVertexOnSeam[v]) {
        const firstVertId = numNewVertices++;
        leftMostMap[firstVertId] = c;
        cornerToVertex[c] = firstVertId;

        let pv = (c % 3 === 0) ? c + 2 : c - 1;
        let bopp = baseOpp[pv];
        let actC = bopp < 0 ? kInvalidCornerIndex$1 : ((bopp % 3 === 0) ? bopp + 2 : bopp - 1);
        while (actC !== kInvalidCornerIndex$1 && actC !== c) {
          cornerToVertex[actC] = firstVertId;
          pv = (actC % 3 === 0) ? actC + 2 : actC - 1;
          bopp = baseOpp[pv];
          actC = bopp < 0 ? kInvalidCornerIndex$1 : ((bopp % 3 === 0) ? bopp + 2 : bopp - 1);
        }
      } else {
        let firstVertId = numNewVertices++;

        let firstC = c;
        let actC;

        let nx = (firstC % 3 === 2) ? firstC - 2 : firstC + 1;
        let opp = seamOpp[nx];
        actC = opp < 0 ? kInvalidCornerIndex$1 : ((opp % 3 === 2) ? opp - 2 : opp + 1);
        while (actC !== kInvalidCornerIndex$1) {
          firstC = actC;
          nx = (firstC % 3 === 2) ? firstC - 2 : firstC + 1;
          opp = seamOpp[nx];
          actC = opp < 0 ? kInvalidCornerIndex$1 : ((opp % 3 === 2) ? opp - 2 : opp + 1);
          if (actC === c) return false;
        }

        cornerToVertex[firstC] = firstVertId;
        leftMostMap[firstVertId] = firstC;

        let pv = (firstC % 3 === 0) ? firstC + 2 : firstC - 1;
        let bopp = baseOpp[pv];
        actC = bopp < 0 ? kInvalidCornerIndex$1 : ((bopp % 3 === 0) ? bopp + 2 : bopp - 1);
        while (actC !== kInvalidCornerIndex$1 && actC !== firstC) {
          const nAct = (actC % 3 === 2) ? actC - 2 : actC + 1;
          if (isEdgeOnSeam[nAct]) {
            firstVertId = numNewVertices++;
            leftMostMap[firstVertId] = actC;
          }
          cornerToVertex[actC] = firstVertId;
          pv = (actC % 3 === 0) ? actC + 2 : actC - 1;
          bopp = baseOpp[pv];
          actC = bopp < 0 ? kInvalidCornerIndex$1 : ((bopp % 3 === 0) ? bopp + 2 : bopp - 1);
        }
      }
    }

    // subarray, not copy: exact-length view so accessors see the right length.
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


  swingRight(corner) {

    return this.previous(this.opposite(this.previous(corner)));

  }

  swingLeft(corner) {

    return this.next(this.opposite(this.next(corner)));

  }

  numVertices() {

    return this.vertex_to_left_most_corner_map_.length;

  }

  numFaces() {

    return this.corner_table_.numFaces();

  }

  numCorners() {

    return this.corner_table_.numCorners();

  }

  // --- Flat-array accessors: let DepthFirstTraverser avoid per-corner dispatch. ---

  cornerToVertexArray() {
    return this.corner_to_vertex_map_;
  }

  // Seam-aware opposite corners (seam edges -> -1), matching opposite(). Cached on
  // first use; seams and connectivity are finalized before traversal, so it's stable.
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

  // Per-base-vertex seam flag (Uint8Array); exposed so hot dedup loops inline the lookup.
  vertexOnSeamArray() {
    return this.is_vertex_on_seam_;
  }

  hasSameSeams(other) {
    if (other === null || other === undefined) return false;
    const seamA = this.is_edge_on_seam_;
    const seamB = other.is_edge_on_seam_;
    if (seamA.length !== seamB.length) return false;
    for (let i = 0, l = seamA.length; i < l; ++i) {
      if (seamA[i] !== seamB[i]) return false;
    }
    return true;
  }

  adoptVertexRecompute(other) {
    this.corner_to_vertex_map_ = other.corner_to_vertex_map_;
    this.vertex_to_left_most_corner_map_ = other.vertex_to_left_most_corner_map_;
    this.no_interior_seams_ = other.no_interior_seams_;
    this._effectiveOpposite = other._effectiveOpposite;
    this._hasCompactBaseVertices = other._hasCompactBaseVertices;
  }

}

// compression/mesh/MeshEdgebreakerDecoderImpl.js - ported from mesh/mesh_edgebreaker_decoder_impl.h/cc


const kInvalidCornerIndex = -1;

// Edgebreaker decoder; based on Isenburg et al'02 "Spirale Reversi: Reverse
// decoding of the Edgebreaker encoding".
class MeshEdgebreakerDecoderImpl {

  constructor(TraversalDecoderClass) {
    this._decoder = null;
    this._cornerTable = null;
    this._cornerTraversalStack = [];
    this._topologySplitData = [];
    this._initFaceConfigurations = [];
    this._initCorners = [];
    this._isVertHole = [];
    this._numEncodedVertices = 0;
    this._posEncodingData = new MeshAttributeIndicesEncodingData();
    this._posDataDecoderId = -1;
    // Cache of vertex-traversal results keyed by corner table, so attributes
    // sharing connectivity traverse once.
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

    const traversalMethod = this._decoder.buffer().decodeUint8();
    if (traversalMethod === undefined) return false;
    if (traversalMethod >= MeshTraversalMethod.NUM_TRAVERSAL_METHODS) {
      return false;
    }

    const mesh = this._decoder.mesh();
    let sequencer = null;

    if (decoderType === MeshAttributeElementType.MESH_VERTEX_ATTRIBUTE) {
      let encodingData = null;
      if (attDataId < 0) {
        encodingData = this._posEncodingData;
      } else {
        encodingData = this._attributeData[attDataId].encodingData;
        this._attributeData[attDataId].isConnectivityUsed = false;
      }

      sequencer = this._createVertexTraversalSequencer(
        encodingData, this._cornerTable, mesh, traversalMethod);
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
        encodingData, attCornerTable, mesh, traversalMethod);
    }

    if (!sequencer) {
      return false;
    }

    const attController = new SequentialAttributeDecodersController(sequencer);
    return this._decoder.setAttributesDecoder(attDecoderId, attController);
  }

  _createVertexTraversalSequencer(encodingData, cornerTable, mesh, traversalMethod) {
    const traversalSequencer = new MeshTraversalSequencer(
      mesh, encodingData, this._vertexTraversalCache);

    const observer = new MeshAttributeIndicesEncodingObserver(
      mesh, traversalSequencer, encodingData);

    const traverser =
      traversalMethod === MeshTraversalMethod.MESH_TRAVERSAL_PREDICTION_DEGREE
        ? new MaxPredictionDegreeTraverser()
        : new DepthFirstTraverser();
    traverser.init(cornerTable, observer);

    traversalSequencer.setTraverser(traverser);
    return traversalSequencer;
  }

  decodeConnectivity() {
    const numEncodedVertices = decodeVarint(this._decoder.buffer());
    if (numEncodedVertices === undefined) return false;
    this._numEncodedVertices = numEncodedVertices;

    const numFaces = decodeVarint(this._decoder.buffer());
    if (numFaces === undefined) return false;

    if (numFaces > 0x7FFFFFFF / 3) {
      return false; // Draco cannot handle this many faces.
    }
    if (this._numEncodedVertices > numFaces * 3) {
      return false;
    }

    // Min edges assuming each is shared by two faces vs max edges between the
    // vertices; if max < min a manifold mesh is impossible.
    const minNumFaceEdges = Math.floor(3 * numFaces / 2);
    const maxNumVertexEdges = this._numEncodedVertices *
      (this._numEncodedVertices - 1) / 2;
    if (maxNumVertexEdges < minNumFaceEdges) {
      return false;
    }

    const numAttributeData = this._decoder.buffer().decodeUint8();
    if (numAttributeData === undefined) return false;

    const numEncodedSymbols = decodeVarint(this._decoder.buffer());
    if (numEncodedSymbols === undefined) return false;

    if (numFaces < numEncodedSymbols) {
      return false;
    }
    const maxEncodedFaces = numEncodedSymbols + Math.floor(numEncodedSymbols / 3);
    if (numFaces > maxEncodedFaces) {
      return false;
    }

    const numEncodedSplitSymbols = decodeVarint(this._decoder.buffer());
    if (numEncodedSplitSymbols === undefined) return false;

    if (numEncodedSplitSymbols > numEncodedSymbols) {
      return false; // Split symbols are a sub-set of all symbols.
    }
    this._cornerTable = new CornerTable();
    this._vertexTraversalCache = new Map();
    this._topologySplitData = [];
    this._initFaceConfigurations = [];
    this._initCorners = [];

    this._attributeData = [];
    for (let i = 0; i < numAttributeData; ++i) {
      this._attributeData.push(new AttributeData());
    }

    if (!this._cornerTable.reset(
      numFaces, this._numEncodedVertices + numEncodedSplitSymbols)) {
      return false;
    }

    // All vertices start as holes (boundaries). Uint8Array (1=hole) keeps the
    // per-vertex reads/writes monomorphic; vertex count never exceeds this
    // length (enforced via maxNumVertices), so fixed-size storage is safe.
    this._isVertHole = new Uint8Array(
      this._numEncodedVertices + numEncodedSplitSymbols).fill(1);

    if (this._decodeHoleAndTopologySplitEvents(this._decoder.buffer()) === -1) {
      return false;
    }

    this._traversalDecoder.init(this);
    // One extra vertex per split symbol.
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

    this._decoder.buffer().init(
      traversalEndBuffer.dataHead,
      traversalEndBuffer.remainingSize,
      this._decoder.buffer().bitstreamVersion
    );

    if (this._attributeData.length > 0) {
      this._decodeAttributeConnectivities();
    }
    this._traversalDecoder.done();

    let previousConnectivityData = null;
    for (let i = 0; i < this._attributeData.length; ++i) {
      const connectivityData = this._attributeData[i].connectivityData;
      if (connectivityData.hasSameSeams(previousConnectivityData)) {
        connectivityData.adoptVertexRecompute(previousConnectivityData);
      } else if (!connectivityData.recomputeVertices(null, null)) {
        return false;
      }
      previousConnectivityData = connectivityData;
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

  _isTopologySplit(encoderSymbolId, outResult) {
    if (this._topologySplitData.length === 0) {
      return false;
    }
    const back = this._topologySplitData[this._topologySplitData.length - 1];
    if (back.sourceSymbolId > encoderSymbolId) {
      // Malformed: source symbol is greater than the current encoder_symbol_id.
      outResult.encoderSplitSymbolId = -1;
      return true;
    }
    if (back.sourceSymbolId !== encoderSymbolId) {
      return false;
    }
    outResult.faceEdge = back.sourceEdge;
    outResult.encoderSplitSymbolId = back.splitSymbolId;
    this._topologySplitData.pop();
    return true;
  }


  _decodeConnectivity(numSymbols) {
    // Reverse decoding of the edgebreaker-encoded symbols.
    const activeCornerStack =
      new Int32Array(numSymbols + this._topologySplitData.length + 16);
    let activeCornerStackSize = 0;
    const topologySplitActiveCorners = new Map();
    const invalidVertices = [];
    const removeInvalidVertices = this._attributeData.length === 0;

    let maxNumVertices = this._isVertHole.length;
    let numFacesDecoded = 0;

    // Hoist the two corner-indexed flat arrays. Unlike _vertexCorners (grown by
    // addNewVertex), these are sized once in reset() and never reallocated, so
    // direct indexed writes are safe and skip the per-call method dispatch that
    // showed up in profiles. All corners written below are fresh (>= 0).
    const cornerToVertex = this._cornerTable._cornerToVertex;
    const oppositeCorners = this._cornerTable._oppositeCorners;
    const numCorners = this._cornerTable.numCorners();

    // Inlinable accessors that handle negative indices and avoid polymorphic dispatch.
    const next = (c) => c < 0 ? -1 : ((c % 3 === 2) ? c - 2 : c + 1);
    const prev = (c) => c < 0 ? -1 : ((c % 3 === 0) ? c + 2 : c - 1);
    const vertex = (c) => (c < 0 || c >= numCorners) ? -1 : cornerToVertex[c];
    const opposite = (c) => (c < 0 || c >= numCorners) ? -1 : oppositeCorners[c];
    const leftMostCorner = (v) => (v < 0 || v >= this._cornerTable._vertexCorners.length) ? -1 : this._cornerTable._vertexCorners[v];

    const swingLeft = (c) => {
      const n = next(c);
      const o = opposite(n);
      return o < 0 ? -1 : next(o);
    };
    const swingRight = (c) => {
      const p = prev(c);
      const o = opposite(p);
      return o < 0 ? -1 : prev(o);
    };

    // Hot loop: accessors are inlined as flat-array reads + corner-triple
    // arithmetic rather than calling the helpers above. _decodeConnectivity
    // exceeds V8's inlining budget, so those helpers stayed real monomorphic
    // calls costing ~15% of decode in profiles. All corners reached here in a
    // well-formed stream are valid (>= 0, < numCorners) and the flat arrays are
    // -1-initialized, so the helpers' guards are unneeded -- except the swing-
    // left boundary terminator below. Helpers remain for the cold post-loop code.
    const vc = this._cornerTable; // _vertexCorners is re-read (addNewVertex may realloc).
    for (let symbolId = 0; symbolId < numSymbols; ++symbolId) {
      const faceIndex = numFacesDecoded++;
      let checkTopologySplit = false;
      const symbol = this._traversalDecoder.decodeSymbol();

      if (symbol === TOPOLOGY_C) {
        // Create a new face between two edges on the open boundary.
        if (activeCornerStackSize === 0) return -1;

        const cornerA = activeCornerStack[activeCornerStackSize - 1];
        const nA = cornerA % 3 === 2 ? cornerA - 2 : cornerA + 1; // next(cornerA)
        const vertexX = cornerToVertex[nA];
        const lmcX = vc._vertexCorners[vertexX];                  // leftMostCorner(vertexX)
        const cornerB = lmcX % 3 === 2 ? lmcX - 2 : lmcX + 1;     // next(lmcX)

        if (cornerA === cornerB) return -1;
        if (oppositeCorners[cornerA] !== kInvalidCornerIndex ||
            oppositeCorners[cornerB] !== kInvalidCornerIndex) {
          return -1;
        }

        const corner = 3 * faceIndex;
        oppositeCorners[cornerA] = corner + 1;
        oppositeCorners[corner + 1] = cornerA;
        oppositeCorners[cornerB] = corner + 2;
        oppositeCorners[corner + 2] = cornerB;

        const pA = cornerA % 3 === 0 ? cornerA + 2 : cornerA - 1; // prev(cornerA)
        const nB = cornerB % 3 === 2 ? cornerB - 2 : cornerB + 1; // next(cornerB)
        const vertAPrev = cornerToVertex[pA];
        const vertBNext = cornerToVertex[nB];

        if (vertexX === vertAPrev || vertexX === vertBNext) return -1;

        cornerToVertex[corner] = vertexX;
        cornerToVertex[corner + 1] = vertBNext;
        cornerToVertex[corner + 2] = vertAPrev;
        vc._vertexCorners[vertAPrev] = corner + 2;
        this._isVertHole[vertexX] = 0; // mark vertex x interior
        activeCornerStack[activeCornerStackSize - 1] = corner;

      } else if (symbol === TOPOLOGY_R || symbol === TOPOLOGY_L) {
        // Create a new face extending from the open boundary edge.
        if (activeCornerStackSize === 0) return -1;

        const cornerA = activeCornerStack[activeCornerStackSize - 1];
        if (oppositeCorners[cornerA] !== kInvalidCornerIndex) {
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
        vc._vertexCorners[newVertIndex] = oppCorner;

        const pA = cornerA % 3 === 0 ? cornerA + 2 : cornerA - 1; // prev(cornerA)
        const vertexR = cornerToVertex[pA];
        cornerToVertex[cornerR] = vertexR;
        vc._vertexCorners[vertexR] = cornerR;

        const nA = cornerA % 3 === 2 ? cornerA - 2 : cornerA + 1; // next(cornerA)
        cornerToVertex[cornerL] = cornerToVertex[nA];

        activeCornerStack[activeCornerStackSize - 1] = corner;
        checkTopologySplit = true;

      } else if (symbol === TOPOLOGY_S) {
        // Merge the two last active edges from the active stack into a new face.
        if (activeCornerStackSize === 0) return -1;

        const cornerB = activeCornerStack[activeCornerStackSize - 1];
        activeCornerStackSize--;

        // Corner "a" may be a normal active edge or one from a topology split event.
        const splitCorner = topologySplitActiveCorners.get(symbolId);
        if (splitCorner !== undefined) {
          activeCornerStack[activeCornerStackSize++] = splitCorner;
        }
        if (activeCornerStackSize === 0) return -1;

        const cornerA = activeCornerStack[activeCornerStackSize - 1];
        if (cornerA === cornerB) return -1;
        if (oppositeCorners[cornerA] !== kInvalidCornerIndex ||
            oppositeCorners[cornerB] !== kInvalidCornerIndex) {
          return -1;
        }

        const corner = 3 * faceIndex;
        oppositeCorners[cornerA] = corner + 2;
        oppositeCorners[corner + 2] = cornerA;
        oppositeCorners[cornerB] = corner + 1;
        oppositeCorners[corner + 1] = cornerB;

        const pA = cornerA % 3 === 0 ? cornerA + 2 : cornerA - 1; // prev(cornerA)
        const vertexP = cornerToVertex[pA];
        cornerToVertex[corner] = vertexP;
        const nA = cornerA % 3 === 2 ? cornerA - 2 : cornerA + 1; // next(cornerA)
        cornerToVertex[corner + 1] = cornerToVertex[nA];

        const pB = cornerB % 3 === 0 ? cornerB + 2 : cornerB - 1; // prev(cornerB)
        const vertBPrev = cornerToVertex[pB];
        cornerToVertex[corner + 2] = vertBPrev;
        vc._vertexCorners[vertBPrev] = corner + 2;

        let cornerN = cornerB % 3 === 2 ? cornerB - 2 : cornerB + 1; // next(cornerB)
        const vertexN = cornerToVertex[cornerN];
        this._traversalDecoder.mergeVertices(vertexP, vertexN);
        // Update the left-most corner on the newly merged vertex.
        vc._vertexCorners[vertexP] = vc._vertexCorners[vertexN]; // leftMostCorner(vertexN)

        // Update vertex id at corner "n" and all corners CCW from it.
        // swingLeft(c) = next(opposite(next(c))).
        const firstCorner = cornerN;
        while (cornerN !== kInvalidCornerIndex) {
          cornerToVertex[cornerN] = vertexP;
          const sn = cornerN % 3 === 2 ? cornerN - 2 : cornerN + 1; // next(cornerN)
          const so = oppositeCorners[sn];                           // opposite(sn)
          cornerN = so < 0 ? -1 : (so % 3 === 2 ? so - 2 : so + 1); // next(so) or boundary
          if (cornerN === firstCorner) {
            return -1; // back at start: should not happen for split symbols
          }
        }
        // Isolate the old vertex n.
        vc._vertexCorners[vertexN] = -1;
        if (removeInvalidVertices) {
          invalidVertices.push(vertexN);
        }
        activeCornerStack[activeCornerStackSize - 1] = corner;

      } else if (symbol === TOPOLOGY_E) {
        const corner = 3 * faceIndex;
        const firstVertIndex = this._cornerTable.addNewVertex();
        // Three new vertices at the corners of the new face.
        this._cornerTable.addNewVertex();
        this._cornerTable.addNewVertex();

        if (this._cornerTable.numVertices() > maxNumVertices) return -1;

        cornerToVertex[corner] = firstVertIndex;
        cornerToVertex[corner + 1] = firstVertIndex + 1;
        cornerToVertex[corner + 2] = firstVertIndex + 2;

        vc._vertexCorners[firstVertIndex] = corner;
        vc._vertexCorners[firstVertIndex + 1] = corner + 1;
        vc._vertexCorners[firstVertIndex + 2] = corner + 2;
        activeCornerStack[activeCornerStackSize++] = corner; // push the tip corner
        checkTopologySplit = true;

      } else {
        return -1; // unknown symbol
      }

      this._traversalDecoder.newActiveCornerReached(
        activeCornerStack[activeCornerStackSize - 1]);

      if (checkTopologySplit) {
        const encoderSymbolId = numSymbols - symbolId - 1;
        const splitResult = { faceEdge: 0, encoderSplitSymbolId: 0 };
        while (this._isTopologySplit(encoderSymbolId, splitResult)) {
          if (splitResult.encoderSplitSymbolId < 0) return -1;

          const actTopCorner = activeCornerStack[activeCornerStackSize - 1];
          let newActiveCorner;
          if (splitResult.faceEdge === RIGHT_FACE_EDGE) {
            // next(actTopCorner)
            newActiveCorner = actTopCorner % 3 === 2 ? actTopCorner - 2 : actTopCorner + 1;
          } else {
            // prev(actTopCorner)
            newActiveCorner = actTopCorner % 3 === 0 ? actTopCorner + 2 : actTopCorner - 1;
          }
          // Encoder split symbol id -> decoder symbol id.
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
    while (activeCornerStackSize > 0) {
      const corner = activeCornerStack[activeCornerStackSize - 1];
      activeCornerStackSize--;

      const interiorFace =
        this._traversalDecoder.decodeStartFaceConfiguration();

      if (interiorFace) {
        if (numFacesDecoded >= this._cornerTable.numFaces()) {
          return -1;
        }

        const cornerA = corner;
        const vertN = vertex(next(cornerA));
        const cornerB = next(leftMostCorner(vertN));

        const vertX = vertex(next(cornerB));
        const cornerC = next(leftMostCorner(vertX));

        if (corner === cornerB || corner === cornerC || cornerB === cornerC) {
          return -1;
        }
        if (opposite(corner) !== kInvalidCornerIndex ||
            opposite(cornerB) !== kInvalidCornerIndex ||
            opposite(cornerC) !== kInvalidCornerIndex) {
          return -1;
        }

        const vertP = vertex(next(cornerC));

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

        // Mark all three vertices interior.
        this._isVertHole[vertX] = 0;
        this._isVertHole[vertP] = 0;
        this._isVertHole[vertN] = 0;

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
      let srcVert = numVertices - 1;
      while (leftMostCorner(srcVert) === kInvalidCornerIndex) {
        srcVert = --numVertices - 1;
      }
      if (srcVert < invalidVert) continue;

      // Remap all corners of srcVert to invalidVert. VertexCornersIterator
      // logic: swing left first, then swing right on boundary.
      const startCid = leftMostCorner(srcVert);
      let cid = startCid;
      let leftTraversal = true;
      while (cid !== kInvalidCornerIndex) {
        if (vertex(cid) !== srcVert) {
          return -1;
        }
        cornerToVertex[cid] = invalidVert;
        if (leftTraversal) {
          const nextC = swingLeft(cid);
          if (nextC === kInvalidCornerIndex) {
            // Open boundary reached; switch to right traversal from start.
            leftTraversal = false;
            cid = swingRight(startCid);
          } else if (nextC === startCid) {
            break; // closed fan
          } else {
            cid = nextC;
          }
        } else {
          cid = swingRight(cid);
        }
      }

      this._cornerTable._vertexCorners[invalidVert] = leftMostCorner(srcVert);
      this._cornerTable._vertexCorners[srcVert] = -1;
      this._isVertHole[invalidVert] = this._isVertHole[srcVert];
      this._isVertHole[srcVert] = 0;
      numVertices--;
    }
    return numVertices;
  }

  // Hole events were removed from the bitstream in 2.1; for 2.2 this only
  // decodes the inline topology-split events.
  _decodeHoleAndTopologySplitEvents(decoderBuffer) {
    const numTopologySplits = decodeVarint(decoderBuffer);
    if (numTopologySplits === undefined) return -1;

    if (numTopologySplits > 0) {
      if (numTopologySplits > this._cornerTable.numFaces()) {
        return -1;
      }
      // Source and split symbol ids use delta + varint coding.
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
      // Split edges come from a direct bit decoder.
      decoderBuffer.startBitDecoding(false);
      for (let i = 0; i < numTopologySplits; ++i) {
        const edgeData = decoderBuffer.decodeLeastSignificantBits32(1);
        this._topologySplitData[i].sourceEdge = edgeData & 1;
      }
      decoderBuffer.endBitDecoding();
    }
    return decoderBuffer.decodedSize;
  }

  // Decode every face's attribute seam connectivity in one flat pass over
  // corners (bitstream >= 2.1). The per-face entry point this replaces re-read
  // the opposite-corner array, attribute-data list and connectivity decoders on
  // each of its numFaces calls; hoisting them here leaves only the irreducible
  // per-corner decodeNextBit work. Within each face the three corners are
  // visited in encoder edge order [base, next, prev] = [c, c+1, c+2] (the
  // caller always starts a face at its base corner, so next/prev need no wrap).
  _decodeAttributeConnectivities() {
    const oppositeCorners = this._cornerTable.oppositeCornerArray();
    const attributeData = this._attributeData;
    const numAttrData = attributeData.length;
    const connectivityDecoders =
      this._traversalDecoder._attributeConnectivityDecoders;
    const numCorners = this._cornerTable.numCorners();

    // Base connectivity is final. Mark each decoded seam directly, in the same
    // per-attribute corner order, without staging a face-sized corner list.
    for (let i = 0; i < numAttrData; ++i) {
      attributeData[i].connectivityData.initEmpty(this._cornerTable);
    }

    for (let corner = 0; corner < numCorners; corner += 3) {
      const srcFaceId = (corner / 3) | 0;
      for (let k = 0; k < 3; ++k) {
        const cc = corner + k;
        const oppCorner = oppositeCorners[cc];
        if (oppCorner === kInvalidCornerIndex) {
          for (let i = 0; i < numAttrData; ++i) {
            attributeData[i].connectivityData.addSeamEdge(cc);
          }
        } else if (((oppCorner / 3) | 0) >= srcFaceId) {
          for (let i = 0; i < numAttrData; ++i) {
            if (connectivityDecoders[i].decodeNextBit()) {
              attributeData[i].connectivityData.addSeamEdge(cc);
            }
          }
        }
      }
    }
  }

  _assignPointsToCorners(numConnectivityVerts) {
    this._decoder.mesh().setNumFaces(this._cornerTable.numFaces());

    const mesh = this._decoder.mesh();
    const ct = this._cornerTable;

    if (this._attributeData.length === 0) {
      // Position-only connectivity: vertex indices equal point indices.
      const numFaces = mesh.numFaces();
      const faces = mesh.faces_;
      const baseCornerToVertex = ct.cornerToVertexArray();
      faces.set(baseCornerToVertex.subarray(0, numFaces * 3));
      this._decoder.pointCloud().setNumPoints(numConnectivityVerts);
      return true;
    }

    // Multiple attributes: deduplicate. pointToCornerMap is only used for its
    // length (the running point id), so track it as a counter, not an array.
    const attributeData = this._attributeData;
    const numAttrData = attributeData.length;
    let allBaseVertices = true;
    for (let i = 0; i < numAttrData; ++i) {
      if (!attributeData[i].connectivityData._hasCompactBaseVertices) {
        allBaseVertices = false;
        break;
      }
    }
    if (allBaseVertices) {
      // With no interior attribute seams, final point IDs have the same dense
      // base-vertex numbering as the compact attribute connectivity.
      const connectivity = attributeData[0].connectivityData;
      mesh.faces_.set(connectivity.cornerToVertexArray());
      this._decoder.pointCloud().setNumPoints(connectivity.numVertices());
      return true;
    }
    let numPoints = 0;
    // A corner's final point id is also its face-index entry. Write into the
    // output buffer directly; the connectivity being traversed is separate.
    const cornerToPointMap = mesh.faces_;

    const numVertices = ct.numVertices();
    // Flat connectivity for the inlined swingRight ring walk and per-attribute
    // lookups — avoids dispatch on the polymorphic corner tables for every
    // corner of every ring. swingRight(x) = previous(baseOpp[previous(x)]).
    const vertexLeftmost = ct.vertexLeftmostCornerArray();
    const baseOpp = ct.oppositeCornerArray();
    ct.cornerToVertexArray();
    const isVertHole = this._isVertHole;
    const attCornerToVertex = new Array(numAttrData);
    const attVertexOnSeam = new Array(numAttrData);
    for (let i = 0; i < numAttrData; ++i) {
      attCornerToVertex[i] = attributeData[i].connectivityData.cornerToVertexArray();
      attVertexOnSeam[i] = attributeData[i].connectivityData.vertexOnSeamArray();
    }
    const singleAttC2V = numAttrData === 1 ? attCornerToVertex[0] : null;

    // Unified per-vertex anyAttVertexOnSeam flag.
    let anyAttVertexOnSeam;
    if (numAttrData === 1) {
      anyAttVertexOnSeam = attVertexOnSeam[0];
    } else {
      anyAttVertexOnSeam = new Uint8Array(numVertices);
      for (let i = 0; i < numAttrData; ++i) {
        const attSeam = attVertexOnSeam[i];
        for (let v = 0; v < numVertices; ++v) {
          if (attSeam[v]) {
            anyAttVertexOnSeam[v] = 1;
          }
        }
      }
    }

    for (let v = 0; v < numVertices; ++v) {
      let c = vertexLeftmost[v];
      if (c === kInvalidCornerIndex) continue; // isolated vertex

      const isSeamVertex = isVertHole[v] || anyAttVertexOnSeam[v];

      if (!isSeamVertex) {
        // Fast path: every corner in this ring gets the same point id.
        const initialC = c;
        const pointId = numPoints++;
        cornerToPointMap[initialC] = pointId;
        // swingRight (c = prev(baseOpp[prev(c)]))
        let rem = initialC % 3;
        let pv = rem === 0 ? initialC + 2 : initialC - 1;
        let opp = baseOpp[pv];
        c = opp < 0 ? kInvalidCornerIndex : ((opp % 3) === 0 ? opp + 2 : opp - 1);
        while (c !== kInvalidCornerIndex && c !== initialC) {
          cornerToPointMap[c] = pointId;
          rem = c % 3;
          pv = rem === 0 ? c + 2 : c - 1;
          opp = baseOpp[pv];
          c = opp < 0 ? kInvalidCornerIndex : ((opp % 3) === 0 ? opp + 2 : opp - 1);
        }
      } else {
        let deduplicationFirstCorner = c;
        let rem, pv, opp;
        if (!isVertHole[v]) {
          // Find the first seam (of any attribute).
          if (numAttrData === 1) {
            const vertId = singleAttC2V[c];
            rem = c % 3;
            pv = rem === 0 ? c + 2 : c - 1;
            opp = baseOpp[pv];
            let actC = opp < 0 ? kInvalidCornerIndex
              : ((opp % 3) === 0 ? opp + 2 : opp - 1);
            while (actC !== c) {
              if (actC === kInvalidCornerIndex) return false;
              if (singleAttC2V[actC] !== vertId) {
                deduplicationFirstCorner = actC;
                break;
              }
              rem = actC % 3;
              pv = rem === 0 ? actC + 2 : actC - 1;
              opp = baseOpp[pv];
              actC = opp < 0 ? kInvalidCornerIndex
                : ((opp % 3) === 0 ? opp + 2 : opp - 1);
            }
          } else {
            for (let i = 0; i < numAttrData; ++i) {
              if (!attVertexOnSeam[i][v]) {
                continue;
              }
              const attC2V = attCornerToVertex[i];
              const vertId = attC2V[c];
              rem = c % 3;
              pv = rem === 0 ? c + 2 : c - 1;
              opp = baseOpp[pv];
              let actC = opp < 0 ? kInvalidCornerIndex
                : ((opp % 3) === 0 ? opp + 2 : opp - 1);
              let seamFound = false;
              while (actC !== c) {
                if (actC === kInvalidCornerIndex) return false;
                if (attC2V[actC] !== vertId) {
                  deduplicationFirstCorner = actC;
                  seamFound = true;
                  break;
                }
                rem = actC % 3;
                pv = rem === 0 ? actC + 2 : actC - 1;
                opp = baseOpp[pv];
                actC = opp < 0 ? kInvalidCornerIndex
                  : ((opp % 3) === 0 ? opp + 2 : opp - 1);
              }
              if (seamFound) break;
            }
          }
        }

        // Deduplication pass over corners on the processed vertex.
        c = deduplicationFirstCorner;
        cornerToPointMap[c] = numPoints++;
        // Traverse in CW direction (swingRight inlined).
        let prevC = c;
        rem = c % 3;
        pv = rem === 0 ? c + 2 : c - 1;
        opp = baseOpp[pv];
        c = opp < 0 ? kInvalidCornerIndex
          : ((opp % 3) === 0 ? opp + 2 : opp - 1);
        while (c !== kInvalidCornerIndex && c !== deduplicationFirstCorner) {
          let attributeSeam;
          if (numAttrData === 1) {
            attributeSeam = singleAttC2V[c] !== singleAttC2V[prevC];
          } else {
            attributeSeam = false;
            for (let i = 0; i < numAttrData; ++i) {
              const attC2V = attCornerToVertex[i];
              if (attC2V[c] !== attC2V[prevC]) {
                attributeSeam = true;
                break;
              }
            }
          }
          if (attributeSeam) {
            cornerToPointMap[c] = numPoints++;
          } else {
            cornerToPointMap[c] = cornerToPointMap[prevC];
          }
          prevC = c;
          rem = c % 3;
          pv = rem === 0 ? c + 2 : c - 1;
          opp = baseOpp[pv];
          c = opp < 0 ? kInvalidCornerIndex
            : ((opp % 3) === 0 ? opp + 2 : opp - 1);
        }
      }
    }

    this._decoder.pointCloud().setNumPoints(numPoints);
    return true;
  }

}

// Helper class for mesh attribute indices encoding data.
class MeshAttributeIndicesEncodingData {

  constructor() {
    this._vertexToEncodedAttributeValueIndexMap = new Int32Array(0);
    this._encodedAttributeValueIndexToCornerMap = new Int32Array(0);
    this._numValues = 0;
  }

  init(numVertices) {
    this._numVertices = numVertices;
    this._numValues = 0;
  }

  allocate() {
    // Int32Array (non-negative data indices) keeps the hot prediction-lookup
    // reads monomorphic. A cached traversal adopts its maps without allocating.
    this._vertexToEncodedAttributeValueIndexMap = new Int32Array(this._numVertices);
    this._encodedAttributeValueIndexToCornerMap = new Int32Array(this._numVertices);
  }

  // Adopts a traversal result from an identical corner table, avoiding a
  // redundant traversal. The maps depend only on connectivity and are read-only
  // downstream, so sharing is safe.
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
  }

}

// Minimal CornerTable for the decoder (the full one lives in the mesh module).
class CornerTable {

  constructor() {
    this._numFaces = 0;
    this._numCorners = 0;
    this._numVertices = 0;
    this._cornerToVertex = null;   // corner -> vertex
    this._oppositeCorners = null;  // corner -> opposite corner
    this._vertexCorners = null;    // vertex -> left-most corner
  }

  reset(numFaces, numVertices) {
    this._numFaces = numFaces;
    this._numCorners = numFaces * 3;
    // C++ reserve() allocates capacity but keeps size 0; vertices are added
    // incrementally via addNewVertex().
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

  vertex(corner) {
    if (corner < 0 || corner >= this._numCorners) return -1;
    return this._cornerToVertex[corner];
  }

  opposite(corner) {
    if (corner < 0 || corner >= this._numCorners) return -1;
    return this._oppositeCorners[corner];
  }

  // Flat-array accessors; let callers avoid polymorphic per-corner dispatch.
  cornerToVertexArray() {
    return this._cornerToVertex;
  }
  oppositeCornerArray() {
    return this._oppositeCorners;
  }
  vertexLeftmostCornerArray() {
    return this._vertexCorners;
  }

  // Mirrors C++ CornerTable::AddNewVertex() (push_back(kInvalidCornerIndex)).
  addNewVertex() {
    const newVertex = this._numVertices;
    this._numVertices++;
    // Array pre-allocated in reset(); extend only when capacity is exceeded.
    if (newVertex >= this._vertexCorners.length) {
      const newArr = new Int32Array(this._vertexCorners.length + 64);
      newArr.fill(-1);
      newArr.set(this._vertexCorners);
      this._vertexCorners = newArr;
    }
    this._vertexCorners[newVertex] = -1;
    return newVertex;
  }

  // Next corner around a vertex, CCW. SwingLeft(c) = Next(Opposite(Next(c))).
  swingLeft(corner) {
    const nextCorner = this.next(corner);
    const oppCorner = this.opposite(nextCorner);
    if (oppCorner < 0) return -1;
    return this.next(oppCorner);
  }

  // Next corner around a vertex, CW. SwingRight(c) = Previous(Opposite(Previous(c))).
  swingRight(corner) {
    const prevCorner = this.previous(corner);
    const oppCorner = this.opposite(prevCorner);
    if (oppCorner < 0) return -1;
    return this.previous(oppCorner);
  }

}

// compression/mesh/MeshEdgebreakerTraversalDecoder.js - ported from mesh/mesh_edgebreaker_traversal_decoder.h


// Default traversal decoder: reads traversal data directly from a buffer.
class MeshEdgebreakerTraversalDecoder {

  constructor() {
    this._buffer = new DecoderBuffer();
    this._symbolBuffer = new DecoderBuffer();
    this._startFaceDecoder = null; // RAnsBitDecoder
    this._attributeConnectivityDecoders = null; // Array of RAnsBitDecoder
    this._numAttributeData = 0;
  }

  init(decoder) {
    const srcBuffer = decoder.getDecoder().buffer();
    this._buffer.init(
      srcBuffer.dataHead,
      srcBuffer.remainingSize,
      srcBuffer.bitstreamVersion
    );
  }

  // Ignored by default; overridden by predictive/valence decoders.
  setNumEncodedVertices(/* numVertices */) {}

  setNumAttributeData(numData) {
    this._numAttributeData = numData;
  }

  // Sets outBuffer to the data encoded after the traversal section.
  start(outBuffer) {
    if (!this.decodeTraversalSymbols()) {
      return false;
    }
    if (!this.decodeStartFaces()) {
      return false;
    }
    if (!this.decodeAttributeSeams()) {
      return false;
    }
    outBuffer.init(
      this._buffer.dataHead,
      this._buffer.remainingSize,
      this._buffer.bitstreamVersion
    );
    return true;
  }

  decodeStartFaceConfiguration() {
    if (this._startFaceDecoder === null) return false;
    return this._startFaceDecoder.decodeNextBit() ? true : false;
  }

  decodeSymbol() {
    let symbol = this._symbolBuffer.decodeLeastSignificantBits32(1);
    if (symbol === TOPOLOGY_C) {
      return symbol;
    }
    // Non-C symbols carry two additional bits.
    const symbolSuffix = this._symbolBuffer.decodeLeastSignificantBits32(2);
    symbol |= (symbolSuffix << 1);
    return symbol;
  }

  newActiveCornerReached(/* corner */) {}

  mergeVertices(/* dest, source */) {}

  done() {
    if (this._symbolBuffer.bitDecoderActive) {
      this._symbolBuffer.endBitDecoding();
    }
    if (this._startFaceDecoder !== null) {
      this._startFaceDecoder.endDecoding();
    }
  }

  get buffer() {
    return this._buffer;
  }

  decodeTraversalSymbols() {
    this._symbolBuffer.init(
      this._buffer.dataHead,
      this._buffer.remainingSize,
      this._buffer.bitstreamVersion
    );
    const traversalSize = this._symbolBuffer.startBitDecoding(true);
    if (traversalSize === undefined) {
      return false;
    }
    // Advance the main buffer past the symbol data.
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
    // Start faces are coded with an RAnsBitDecoder.
    try {
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
    if (this._predictedSymbol !== -1) {
      // The bit confirms whether the prediction was correct.
      if (this._predictionDecoder.decodeNextBit()) {
        this._lastSymbol = this._predictedSymbol;
        return this._predictedSymbol;
      }
    }
    // No prediction or mis-predicted: decode directly.
    this._lastSymbol = super.decodeSymbol();
    return this._lastSymbol;
  }

  newActiveCornerReached(corner) {
    const ct = this._cornerTable;
    const next = ct.next(corner);
    const prev = ct.previous(corner);

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

    this._minValence = 2;
    this._maxValence = 7;

    if (this._numVertices < 0) {
      return false;
    }
    this._vertexValences = new Array(this._numVertices).fill(0);

    const numUniqueValences = this._maxValence - this._minValence + 1;

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
      // The first symbol is always E.
      this._lastSymbol = TOPOLOGY_E;
    }
    return this._lastSymbol;
  }

  newActiveCornerReached(corner) {
    const ct = this._cornerTable;
    const next = ct.next(corner);
    const prev = ct.previous(corner);

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

    // The clamped valence of the next vertex selects the entropy context.
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
    this._vertexValences[dest] += this._vertexValences[source];
  }

}

// compression/mesh/MeshEdgebreakerDecoder.js - ported from mesh/mesh_edgebreaker_decoder.h/cc


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


// Reads the Draco header from a copy of inBuffer without advancing the original,
// so the geometry type can be checked before picking a decoder.
// Returns { ok, header, message }.
function peekHeader(inBuffer) {

  const tempBuffer = new DecoderBuffer();
  tempBuffer.init(inBuffer.data, inBuffer.data.length);
  tempBuffer.bitstreamVersion = inBuffer.bitstreamVersion;
  tempBuffer.advance(inBuffer.decodedSize); // match the original's position

  const header = new DracoHeader();
  const status = PointCloudDecoder.decodeHeader(tempBuffer, header);
  return { ok: status.ok(), header, message: status.errorMsg };

}

function createMeshDecoder(method) {

  if (method === MeshEncoderMethod.MESH_SEQUENTIAL_ENCODING) {

    return new MeshSequentialDecoder();

  } else if (method === MeshEncoderMethod.MESH_EDGEBREAKER_ENCODING) {

    return new MeshEdgebreakerDecoder();

  }

  throw new Error('Unsupported mesh encoding method.');

}

// Decodes Draco-compressed meshes and point clouds.
class Decoder {

  // Returns an EncodedGeometryType value, or INVALID_GEOMETRY_TYPE on error.
  static getEncodedGeometryType(inBuffer) {

    const result = peekHeader(inBuffer);
    if (!result.ok) {
      return EncodedGeometryType.INVALID_GEOMETRY_TYPE;
    }

    if (result.header.encoderType >= EncodedGeometryType.NUM_ENCODED_GEOMETRY_TYPES) {
      return EncodedGeometryType.INVALID_GEOMETRY_TYPE;
    }

    return result.header.encoderType;

  }

  // Returns { mesh, ok, message }.
  decodeMeshFromBuffer(inBuffer) {

    const mesh = new Mesh();
    const status = this.decodeBufferToMesh(inBuffer, mesh);
    if (!status.ok) {
      return { mesh: null, ok: false, message: status.message };
    }

    return { mesh, ok: true, message: '' };

  }

  // Returns { ok, message }.
  decodeBufferToMesh(inBuffer, outGeometry) {

    const result = peekHeader(inBuffer);
    if (!result.ok) {
      return { ok: false, message: result.message };
    }

    if (result.header.encoderType !== EncodedGeometryType.TRIANGULAR_MESH) {
      return { ok: false, message: 'Input is not a mesh.' };
    }

    const decoder = createMeshDecoder(result.header.encoderMethod);
    const status = decoder.decodeMesh(inBuffer, outGeometry);
    return { ok: status.ok(), message: status.errorMsg };

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

		if ( geometryType !== EncodedGeometryType.TRIANGULAR_MESH ) {

			throw new Error( 'THREE.DRACOLoader: Unexpected geometry type.' );

		}

		const decoder = new Decoder();
		const result = decoder.decodeMeshFromBuffer( decoderBuffer );

		if ( ! result.ok ) {

			throw new Error( 'THREE.DRACOLoader: ' + result.message );

		}

		return this._buildGeometry( result.mesh, taskConfig );

	}

	_buildGeometry( dracoGeometry, taskConfig ) {

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

		const numFaces = dracoGeometry.numFaces();
		const faces = dracoGeometry.faces_;
		// The decoded mesh is private to this geometry. Keep its index buffer,
		// reinterpreting signed storage as the unsigned type required by three.
		const index = new Uint32Array( faces.buffer, faces.byteOffset, numFaces * 3 );

		geometry.setIndex( new BufferAttribute( index, 1 ) );

		return geometry;

	}

	_extractAttributeData( dracoGeometry, attribute, numPoints, OutputTypedArray ) {

		return attribute.extractTo( OutputTypedArray, numPoints );

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
