// /*
//  * Author: Axel Antoine
//  * mail: ax.antoine@gmail.com
//  * website: http://axantoine.com
//  * Created on Thu Nov 17 2022
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
// import { Face } from "../core/Face";
// import { Halfedge } from "../core/Halfedge";
// import { HalfedgeDS } from "../core/HalfedgeDS";
// import { Vertex } from "../core/Vertex";
//
// /**
//  * This is the global topology we are going to use.
//  * Before each test, all vertices exist, and the polygon v0-v3-v1-v7-v2
//  * is set
//  *
//  *       v2
//  *       | \
//  *       |   \
//  *       |    v7
//  *       |    |  \
//  *       |    v6   \
//  *       |     \     \
//  *       |      \      \
//  *       |      v5       \
//  *       |        \        \
//  *       |   f0   v4         \
//  *       |         \     f1    \
//  *       |          \            \
//  *      v0 --------- v3 --------- v1
//  */
//
// const vec = new Vector3();
// const struct = new HalfedgeDS();
// let v0: Vertex, v1: Vertex, v2: Vertex, v3: Vertex;
// let v4: Vertex, v5: Vertex, v6: Vertex, v7: Vertex;
// let f0: Face;
// let v4v5: Halfedge;
//
// beforeEach(() => {
//   struct.clear();
//   v0 = struct.addVertex(vec.set(0,0,0));
//   v1 = struct.addVertex(vec.set(1,1,1));
//   v2 = struct.addVertex(vec.set(2,2,2));
//
//   const v0v1 = struct.addEdge(v0, v1);
//   const v1v2 = struct.addEdge(v1, v2);
//   const v2v0 = struct.addEdge(v2, v0);
//
//   f0 = struct.addFace([v0v1, v1v2, v2v0]);
//
//   v3 = struct.splitEdge(v0v1, vec.set(3,3,3));
//
//   v4 = struct.addVertex(vec.set(4,4,4));
//   v5 = struct.addVertex(vec.set(5,5,5));
//   v6 = struct.addVertex(vec.set(6,6,6));
//
//   v7 = struct.splitEdge(v1v2, vec.set(7,7,7));
//
//   v4v5 = struct.addEdge(v4, v5);
// });
//
//
// test("Cut from center", () => {
//   const v5v6 = struct.addEdge(v5, v6);
//
//   // v4v5 already exist, v5v6 should be connected to it
//   expect(v5v6.next).toBeHalfedge(v5v6.twin);
//   expect(v5v6.prev).toBeHalfedge(v4v5);
//   expect(v4v5.next).toBeHalfedge(v5v6);
//   expect(v4v5.prev).toBeHalfedge(v4v5.twin);
//   expect(v5v6.twin.next).toBeHalfedge(v4v5.twin);
//
//   // Both halfedges should not be connected to the face f0
//   expect(v5v6.face).toBeNull();
//   expect(v5v6.twin.face).toBeNull();
//   expect(v4v5.face).toBeNull();
//   expect(v4v5.twin.face).toBeNull();
//
// });
//
// test("Connect from side", () => {
//
//   const v7v2 = f0.halfedgeFromVertex(v7);
//   expect(v7v2).not.toBeNull();
//
//   if (v7v2) {
//
//     const v1v7 = v7v2.prev;
//     const v6v7 = struct.cutFace(f0, v6, v7);
//
//     expect(v6v7.next).toBeHalfedge(v7v2);
//     expect(v6v7.prev).toBeHalfedge(v6v7.twin);
//     expect(v6v7.twin.next).toBeHalfedge(v6v7);
//     expect(v6v7.twin.prev).toBeHalfedge(v1v7);
//
//     expect(v6v7.face).toBe(f0);
//     expect(v6v7.twin.face).toBe(f0);
//
//   }
//
// });
//
// test("Connect the two cuts", () => {
//
//   const v7v2 = f0.halfedgeFromVertex(v7);
//   const v3v1 = f0.halfedgeFromVertex(v3);
//   expect(v7v2).not.toBeNull();
//   expect(v3v1).not.toBeNull();
//
//   if (v7v2 && v3v1) {
//
//     const v0v3 = v3v1.prev;
//     const v1v7 = v7v2.prev;
//     const v3v7 = struct.cutFace(f0, v3, v7);
//
//     // We expect a new face
//     const f1 = v3v7.twin.face;
//     expect(v3v7.face).toBe(f0);
//     expect(f1).not.toBe(f0)
//
//     // f0 next / prev
//     expect(v0v3.next).toBeHalfedge(v3v7);
//     expect(v3v7.next).toBeHalfedge(v7v2);
//     expect(v7v2.prev).toBeHalfedge(v3v7);
//     expect(v3v7.prev).toBeHalfedge(v0v3);
//
//     // f1 next / prev
//     expect(v1v7.next).toBeHalfedge(v3v7.twin);
//     expect(v3v7.twin.next).toBeHalfedge(v3v1);
//     expect(v3v1.prev).toBeHalfedge(v3v7.twin);
//     expect(v3v7.twin.prev).toBeHalfedge(v1v7);
//
//     // Check f0 loop
//     for (const h of v3v7.nextLoop()) {
//       expect(h.face).toBe(f0);
//     }
//
//     // Check f1 loop
//     for (const h of v3v7.twin.nextLoop()) {
//       expect(h.face).toBe(f1);
//     }
//   }
//
// });
//
//
//
