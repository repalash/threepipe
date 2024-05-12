/*
 * Author: Axel Antoine
 * mail: ax.antoine@gmail.com
 * website: http://axantoine.com
 * Created on Fri Nov 18 2022
 *
 * Loki, Inria project-team with Université de Lille
 * within the Joint Research Unit UMR 9189
 * CNRS - Centrale Lille - Université de Lille, CRIStAL
 * https://loki.lille.inria.fr
 *
 * Licence: Licence.md
 */

import {BufferAttribute, BufferGeometry, InterleavedBufferAttribute, Vector3} from "three";
import {Halfedge} from "../core/Halfedge";
import {HalfedgeDS} from "../core/HalfedgeDS";
import {Vertex} from "../core/Vertex";

const pos_ = new Vector3();

export function setFromGeometry(
    struct: HalfedgeDS,
    geometry: BufferGeometry,
    tolerance= 1e-10) {

  struct.clear();

  // Check position and normal attributes
  if (!geometry.hasAttribute("position")) {
    throw new Error("BufferGeometry does not have a position BufferAttribute.");
  }

  // console.log(geometry)
  const positions = geometry.getAttribute('position');

  // Get the merged vertices Array
  const indexVertexArray = computeVerticesIndexArray(positions, tolerance);

  // If the geometry is not indexed, we get the indexes of faces vertices from
  // the position buffer attribute directly in group of 3
  let nbOfFaces = positions.count/3;
  let getVertexIndex = function(bufferIndex: number) {
    return indexVertexArray[bufferIndex];
  }
  // Otherwise, if the geometry is indexed, we get the index of faces vertices
  // from the index buffer in group of 3
  const indexBuffer = geometry.getIndex();
  if (indexBuffer) {
    nbOfFaces = indexBuffer.count/3;
    getVertexIndex = function(bufferIndex: number) {
      return indexVertexArray[indexBuffer.array[bufferIndex]];
    }
  }

  // Save halfedges in a map where with a hash <src-vertex-id>
  // their hash is index1-index2, so that it is easier to find the twin
  const halfedgeMap = new Map<string, Halfedge>();
  const vertexMap = new Map<number, Vertex>();


  for (let faceIndex = 0; faceIndex < nbOfFaces; faceIndex++) {
    let loopHalfedges = [] as Halfedge[]
    let addedVertex = [] as Vertex[]
    let addedEdges = [] as Halfedge[]

    for (let i=0; i<3; i++) {

      // Get the source vertex v1
      const i1 = getVertexIndex(faceIndex*3 + i);
      let v1 = vertexMap.get(i1);
      // if(!v1?.isFree()) break
      if (!v1) {
        pos_.fromBufferAttribute(positions, i1);
        v1 = struct.addVertex(pos_);
        addedVertex.push(v1);
        vertexMap.set(i1, v1);
      }
      // if(!v1.isFree()) break

      // Get the destitation vertex
      const i2 = getVertexIndex(faceIndex*3 + (i+1)%3);
      let v2 = vertexMap.get(i2);
      // if(!v2?.isFree()) break
      if (!v2) {
        pos_.fromBufferAttribute(positions, i2);
        v2 = struct.addVertex(pos_);
        addedVertex.push(v1);
        vertexMap.set(i2, v2);
      }
      // if(!v2.isFree()) break

      // Get the halfedge from v1 to v2
      const hash1 = i1+'-'+i2;
      let h1 = halfedgeMap.get(hash1);
      if(h1?.face) h1 = undefined

      if (!h1) {

        try {
          // console.log(h1)
          h1 = struct.addEdge(v1, v2);
          addedEdges.push(h1);
          const h2 = h1.twin;
          const hash2 = i2 + '-' + i1;
          halfedgeMap.set(hash1, h1);
          halfedgeMap.set(hash2, h2);
          // console.log(h1.face)
        }catch (e){
          // console.error(e);
        }
      }

      if(h1) loopHalfedges.push(h1);
      else break;
    }

    try {
      if(loopHalfedges.length < 3) throw 'need 3 for face'
        struct.addFace(loopHalfedges);
    }catch (e){
      // console.error(e);
      // for (const addedEdge of addedEdges) {
      //   struct.removeEdge(addedEdge);
      // }
      // if(!addedEdges.length)
      //   for (const addedVert of addedVertex) {
      //       struct.removeVertex(addedVert);
      //   }
    }
  }
}



/**
 * Returns an array where each index points to its new index in the buffer
 * attribute
 *
 * @param positions Vertices positions buffer
 * @param tolerance Distance tolerance of the vertices to merge
 * @returns
 */
export function computeVerticesIndexArray(
    positions: BufferAttribute | InterleavedBufferAttribute,
    tolerance = 1e-10){

  const decimalShift = Math.log10(1 / tolerance);
  const shiftMultiplier = Math.pow(10, decimalShift);

  const hashMap = new Map<string, number>();
  const indexArray = new Array<number>();

  for (let i=0; i < positions.count; i++) {
    // Compute a hash based on the vertex position rounded to a given precision
    let hash = "";
    for (let j=0; j<3; j++) {
      hash += `${Math.round(positions.array[i*3+j] * shiftMultiplier)}`;
    }

    // If hash already exist, then set the buffer index to the existing vertex,
    // otherwise, create it
    let vertexIndex = hashMap.get(hash);
    if (vertexIndex === undefined) {
      vertexIndex = i;
      hashMap.set(hash, i);
    }
    indexArray.push(vertexIndex);
  }
  return indexArray;
}



