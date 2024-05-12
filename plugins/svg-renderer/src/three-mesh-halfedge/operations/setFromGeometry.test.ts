// // Author: Axel Antoine
// // mail: ax.antoine@gmail.com
// // website: https://axantoine.com
// // 09/12/2021
//
// // Loki, Inria project-team with Université de Lille
// // within the Joint Research Unit UMR 9189 CNRS-Centrale
// // Lille-Université de Lille, CRIStAL.
// // https://loki.lille.inria.fr
//
// // LICENCE: Licence.md
//
// import { computeVerticesIndexArray } from './setFromGeometry';
// import {
//   CylinderGeometry,
//   BoxGeometry,
//   BufferAttribute, BufferGeometry} from 'three';
// import { generatorSize } from '../utils/testutils';
// import { HalfedgeDS } from '../core/HalfedgeDS';
// import { Halfedge } from '../core/Halfedge';
//
// const struct = new HalfedgeDS();
//
// function runCommonTests(
//     struct: HalfedgeDS,
//     nFace: number,
//     nEdges: number,
//     nVertices: number) {
//
//   describe("Base Tests", () => {
//
//     test('Test sets size', () => {
//       expect(struct.faces).toHaveLength(nFace);
//       expect(struct.halfedges).toHaveLength(nEdges*2);
//       expect(struct.vertices).toHaveLength(nVertices);
//     });
//
//     test("Test halfedge prev/next references", () => {
//       for (const halfedge of struct.halfedges) {
//         expect(halfedge.next.prev).toBe(halfedge);
//         expect(halfedge.prev.next).toBe(halfedge);
//       }
//     });
//
//     test("Test halfedges pairs", () => {
//       for (const halfEdge of struct.halfedges) {
//         expect(halfEdge.twin.twin).toBe(halfEdge);
//       }
//     });
//
//     test('Test face loops size', () => {
//       for (const face of struct.faces) {
//         expect(generatorSize(face.halfedge.nextLoop())).toBe(3);
//         expect(generatorSize(face.halfedge.prevLoop())).toBe(3);
//       }
//     });
//
//     test('Test face reference', () => {
//       for (const face of struct.faces) {
//         for (const halfedge of face.halfedge.nextLoop()) {
//           expect(halfedge.face).toBe(face);
//         }
//       }
//     });
//   });
// }
//
// describe("Triangle topology", () => {
//
//   const array = new Int8Array([0,0,0, 0,2,0, 2,0,0]);
//   const buffer = new BufferAttribute(array, 3);
//   const geometry = new BufferGeometry();
//   geometry.setAttribute('position', buffer);
//
//   beforeAll(() => {
//     struct.setFromGeometry(geometry);
//   });
//
//   runCommonTests(struct, 1, 3, 3);
//
//   test("Test number of boundary halfedges", () => {
//     let boundaries = 0;
//     for (const halfedge of struct.halfedges) {
//       if (!halfedge.face) {
//         boundaries += 1;
//       }
//     }
//     expect(boundaries).toBe(3);
//   });
//
// });
//
// describe("Double triangles topology", () => {
//
//   const array = new Int8Array([0,0,0, 0,2,0, 2,0,0, 2,0,0, 4,0,0, 4,2,0]);
//   const buffer = new BufferAttribute(array, 3);
//   const geometry = new BufferGeometry();
//   geometry.setAttribute('position', buffer);
//
//   beforeAll(() => {
//     struct.setFromGeometry(geometry);
//   });
//
//   runCommonTests(struct, 2, 6, 5);
//
//   test('Test number of loops', () => {
//     let boundaryLoops = 0;
//     let faceLoops = 0;
//     for (const loop of struct.loops()) {
//       if (!loop.face) {
//         boundaryLoops += 1;
//       } else {
//         faceLoops += 1;
//       }
//     }
//     expect(boundaryLoops).toBe(1);
//     expect(faceLoops).toBe(2);
//   });
//
//   test("Test number of boundary halfedges", () => {
//     let boundaries = 0;
//     for (const halfedge of struct.halfedges) {
//       if (!halfedge.face) {
//         boundaries += 1;
//       }
//     }
//     expect(boundaries).toBe(6);
//   });
//
// });
//
// describe("Cylinder topology", () => {
//
//   // https://threejs.org/docs/scenes/geometry-browser.html#CylinderGeometry
//   const geometry = new CylinderGeometry(2, 2, 1, 6, 1, true);
//
//   beforeAll(() => {
//     struct.setFromGeometry(geometry);
//   });
//
//   runCommonTests(struct, 12, 24, 12);
//
//   test("Test boundary loops", () => {
//     const loops = struct.loops();
//     const boundaryLoops = new Array<Halfedge>();
//     for (const he of loops) {
//       if (!he.face) {
//         boundaryLoops.push(he);
//       }
//     }
//     expect(boundaryLoops).toHaveLength(2);
//     for (const bloop of boundaryLoops) {
//       expect(generatorSize(bloop.nextLoop())).toBe(6);
//     }
//   });
//
// });
//
// describe("Cube topology", () => {
//
//   const geometry = new BoxGeometry(1, 1, 1);
//
//   beforeAll(() => {
//     struct.setFromGeometry(geometry);
//   });
//
//   runCommonTests(struct, 12, 18, 8);
//
// });
//
// describe("Degenerated geometries", () => {
//
//   test("No positions attribute", () => {
//     const geometry = new BufferGeometry();
//
//     expect(() => {struct.setFromGeometry(geometry);}).toThrow(Error);
//   });
// });
//
//
// describe("Check merge of vertices", () => {
//
//   test("Expect position indices to be merged", () => {
//     const array = new Int8Array([1,2,3,4,5,6,7,8,9,1,2,3,4,5,6]);
//     const buffer = new BufferAttribute(array, 3);
//     const idxArray = computeVerticesIndexArray(buffer, 1);
//     expect(idxArray).toHaveLength(5);
//     expect(idxArray[0]).toBe(0);
//     expect(idxArray[1]).toBe(1);
//     expect(idxArray[2]).toBe(2);
//     expect(idxArray[3]).toBe(0);
//     expect(idxArray[4]).toBe(1);
//   });
//
//   test("Expect decimals to be trunked when precision changes", () => {
//     const array = new Float32Array([1.110,2.220,3.330,1.111,2.222,3.333]);
//     const buffer = new BufferAttribute(array, 3);
//     let idxArray = computeVerticesIndexArray(buffer, 1E-1);
//     expect(idxArray).toHaveLength(2);
//     expect(idxArray[0]).toBe(0);
//     expect(idxArray[1]).toBe(0);
//
//     idxArray = computeVerticesIndexArray(buffer, 1E-2);
//     expect(idxArray).toHaveLength(2);
//     expect(idxArray[0]).toBe(0);
//     expect(idxArray[1]).toBe(0);
//
//     idxArray = computeVerticesIndexArray(buffer, 1E-3);
//     expect(idxArray).toHaveLength(2);
//     expect(idxArray[0]).toBe(0);
//     expect(idxArray[1]).toBe(1);
//   });
//
// });
//
//
