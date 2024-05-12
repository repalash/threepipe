// /*
//  * Author: Axel Antoine
//  * mail: ax.antoine@gmail.com
//  * website: http://axantoine.com
//  * Created on Mon Nov 14 2022
//  *
//  * Loki, Inria project-team with Université de Lille
//  * within the Joint Research Unit UMR 9189
//  * CNRS - Centrale Lille - Université de Lille, CRIStAL
//  * https://loki.lille.inria.fr
//  *
//  * Licence: Licence.md
//  */
//
// import { Vector3 } from "three";
// import { addEdge, } from "../operations/addEdge";
// import { addVertex } from "../operations/addVertex";
// import { removeEdge } from "../operations/removeEdge";
// import { HalfedgeDS } from "./HalfedgeDS";
// import { Vertex } from "./Vertex";
// import { generatorToArray } from "../utils/testutils";
// import { addFace } from "../operations/addFace";
//
// const vec_ = new Vector3();
// let v1: Vertex, v2: Vertex, v3: Vertex, v4: Vertex;
// const struct = new HalfedgeDS();
//
// beforeEach(() => {
//   struct.clear();
//   v1 = addVertex(struct, vec_.set(1,1,1));
//   v2 = addVertex(struct, vec_.set(2,2,2));
//   v3 = addVertex(struct, vec_.set(3,3,3));
//   v4 = addVertex(struct, vec_.set(4,4,4));
// });
//
// test('Vertex is isolated', () => {
//
//   expect(v1.isIsolated()).toBe(true);
//   expect(v2.isIsolated()).toBe(true);
//
//   const half = addEdge(struct, v1, v2);
//
//   expect(v1.isIsolated()).toBe(false);
//   expect(v2.isIsolated()).toBe(false);
//
//   removeEdge(struct, half);
//
//   expect(v1.isIsolated()).toBe(true);
//   expect(v2.isIsolated()).toBe(true);
//
// });
//
// test('Vertex is connected to another vertex', () => {
//
//   expect(v1.isConnectedToVertex(v2)).toBe(false);
//   expect(v2.isConnectedToVertex(v1)).toBe(false);
//
//   const half = addEdge(struct, v1, v2);
//
//   expect(v1.isConnectedToVertex(v2)).toBe(true);
//   expect(v2.isConnectedToVertex(v1)).toBe(true);
//
//   removeEdge(struct, half);
//
//   expect(v1.isConnectedToVertex(v2)).toBe(false);
//   expect(v2.isConnectedToVertex(v1)).toBe(false);
//
// });
//
// test('Vertex loop CW', () => {
//
//   let array = generatorToArray(v1.loopCW());
//   expect(array).toHaveLength(0);
//
//   const v1v2 = addEdge(struct, v1, v2);
//   const v1v3 = addEdge(struct, v1, v3);
//   const v1v4 = addEdge(struct, v1, v4);
//
//   array = generatorToArray(v1.loopCW());
//   expect(array).toHaveLength(3);
//   expect(array).toContain(v1v2);
//   expect(array).toContain(v1v3);
//   expect(array).toContain(v1v4);
//
//   removeEdge(struct, v1v2);
//
//   array = generatorToArray(v1.loopCW());
//   expect(array).toHaveLength(2);
//   expect(array).toContain(v1v3);
//   expect(array).toContain(v1v4);
//
// });
//
// test('Vertex loop CCW', () => {
//
//   let array = generatorToArray(v1.loopCCW());
//   expect(array).toHaveLength(0);
//
//   const v1v2 = addEdge(struct, v1, v2);
//   const v1v3 = addEdge(struct, v1, v3);
//   const v1v4 = addEdge(struct, v1, v4);
//
//   array = generatorToArray(v1.loopCCW());
//   expect(array).toHaveLength(3);
//   expect(array).toContain(v1v2);
//   expect(array).toContain(v1v3);
//   expect(array).toContain(v1v4);
//
//   removeEdge(struct, v1v2);
//
//   array = generatorToArray(v1.loopCCW());
//   expect(array).toHaveLength(2);
//   expect(array).toContain(v1v3);
//   expect(array).toContain(v1v4);
//
// });
//
// test('Boundary in halfedges loop', () => {
//
//   let array = generatorToArray(v1.freeHalfedgesInLoop());
//   expect(array).toHaveLength(0);
//
//   const v1v2 = addEdge(struct, v1, v2);
//   const v1v3 = addEdge(struct, v1, v3);
//   const v1v4 = addEdge(struct, v1, v4);
//
//   array = generatorToArray(v1.freeHalfedgesInLoop());
//   expect(array).toHaveLength(3);
//   expect(array).toContain(v1v2.twin);
//   expect(array).toContain(v1v3.twin);
//   expect(array).toContain(v1v4.twin);
//
//   // Close 1-2-3 triangles
//   const v2v3 = addEdge(struct, v2, v3);
//   addFace(struct, [v1v2, v2v3, v1v3.twin]);
//   array = generatorToArray(v1.freeHalfedgesInLoop());
//   expect(array).toHaveLength(2);
//   expect(array).toContain(v1v2.twin);
//   expect(array).toContain(v1v4.twin);
//
//   // Close 1-3-4 and 1-4-2 triangles
//   const v3v4 = addEdge(struct, v3, v4);
//   addFace(struct, [v3v4, v1v4.twin, v1v3]);
//
//   const v4v2 = addEdge(struct, v4, v2);
//   addFace(struct, [v4v2, v1v2.twin, v1v4]);
//
//   array = generatorToArray(v1.freeHalfedgesInLoop());
//   expect(array).toHaveLength(0);
// });
//
// test('Boundary out halfedges loop', () => {
//
//   let array = generatorToArray(v1.freeHalfedgesOutLoop());
//   expect(array).toHaveLength(0);
//
//   const v1v2 = addEdge(struct, v1, v2);
//   const v1v3 = addEdge(struct, v1, v3);
//   const v1v4 = addEdge(struct, v1, v4);
//
//   array = generatorToArray(v1.freeHalfedgesOutLoop());
//   expect(array).toHaveLength(3);
//   expect(array).toContain(v1v2);
//   expect(array).toContain(v1v3);
//   expect(array).toContain(v1v4);
//
//   // Close 1-2-3 triangles
//   const v2v3 = addEdge(struct, v2, v3);
//   addFace(struct, [v1v2, v2v3, v1v3.twin]);
//   array = generatorToArray(v1.freeHalfedgesOutLoop());
//   expect(array).toHaveLength(2);
//   expect(array).toContain(v1v3);
//   expect(array).toContain(v1v4);
//
//   // Close 1-3-4 and 1-4-2 triangles
//   const v3v4 = addEdge(struct, v3, v4);
//   addFace(struct, [v3v4, v1v4.twin, v1v3]);
//
//   const v4v2 = addEdge(struct, v4, v2);
//   addFace(struct, [v4v2, v1v2.twin, v1v4]);
//
//   array = generatorToArray(v1.freeHalfedgesOutLoop());
//   expect(array).toHaveLength(0);
// });
//
