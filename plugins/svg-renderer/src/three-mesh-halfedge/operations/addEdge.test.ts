// /*
//  * Author: Axel Antoine
//  * mail: ax.antoine@gmail.com
//  * website: http://axantoine.com
//  * Created on Wed Nov 09 2022
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
// import { Halfedge } from "../core/Halfedge";
// import { HalfedgeDS } from "../core/HalfedgeDS";
//
// const position = new Vector3();
// const struct = new HalfedgeDS();
//
// /*
//  *       v2
//  *       | \
//  *       |   \
//  *       |     \
//  *      v0 ----- v1
//  */
//
// const v0 = struct.addVertex(position.set(0,0,0));
// const v1 = struct.addVertex(position.set(2,0,0));
// const v2 = struct.addVertex(position.set(0,2,0));
//
// let v0v1: Halfedge, v1v2: Halfedge, v2v0: Halfedge;
// let v1v0: Halfedge, v2v1: Halfedge, v0v2: Halfedge;
//
// test("Link isolated vertices", () => {
//   v0v1 = struct.addEdge(v0, v1);
//   v1v0 = v0v1.twin;
//   expect(v0v1.next).toBeHalfedge(v1v0);
//   expect(v0v1.prev).toBeHalfedge(v1v0);
//   expect(v1v0.next).toBeHalfedge(v0v1);
//   expect(v1v0.prev).toBeHalfedge(v0v1);
//   expect(v0.halfedge).toBeHalfedge(v0v1);
//   expect(v1.halfedge).toBeHalfedge(v1v0);
// });
//
// test("Link to another edge", () => {
//   v1v2 = struct.addEdge(v1, v2);
//   v2v1 = v1v2.twin;
//   expect(v1v2.next).toBeHalfedge(v2v1);
//   expect(v1v2.prev).toBeHalfedge(v0v1);
//   expect(v0v1.next).toBeHalfedge(v1v2);
//   expect(v2v1.next).toBeHalfedge(v1v0);
//   expect(v2v1.prev).toBeHalfedge(v1v2);
//   expect(v1v0.prev).toBeHalfedge(v2v1);
// });
//
// test("Closing a loop", () => {
//   v2v0 = struct.addEdge(v2, v0);
//   v0v2 = v2v0.twin;
//   expect(v2v0.next).toBeHalfedge(v0v1);
//   expect(v2v0.prev).toBeHalfedge(v1v2);
//   expect(v0v1.prev).toBeHalfedge(v2v0);
//   expect(v1v2.next).toBeHalfedge(v2v0);
//
//   expect(v0v2.next).toBeHalfedge(v2v1);
//   expect(v0v2.prev).toBeHalfedge(v1v0);
//   expect(v1v0.next).toBeHalfedge(v0v2);
//   expect(v2v1.prev).toBeHalfedge(v0v2);
// });
//
//
// /**
//  *       v2      v3
//  *       | \     | \
//  *       |   \   |   \
//  *       |     \ |     \
//  *      v0 ---- v1 ---- v4
//  */
//
// const v3 = struct.addVertex(position.set(2,2,0));
// const v4 = struct.addVertex(position.set(4,2,0));
//
// let v3v1: Halfedge, v1v4: Halfedge, v4v3: Halfedge;
// let v1v3: Halfedge, v4v1: Halfedge, v3v4: Halfedge;
//
// test("Connect to face", () => {
//   struct.addFace([v0v1, v1v2, v2v0]);
//
//   v3v1 = struct.addEdge(v3, v1);
//   v1v3 = v3v1.twin;
//
//   expect(v3v1.next).toBeHalfedge(v1v0);
//   expect(v3v1.prev).toBeHalfedge(v1v3);
//   expect(v1v3.next).toBeHalfedge(v3v1);
//   expect(v1v3.prev).toBeHalfedge(v2v1);
//
//   v1v4 = struct.addEdge(v1, v4);
//   v4v1 = v1v4.twin;
//
//   expect(v1v4.next).toBeHalfedge(v4v1);
//   expect(v4v1.prev).toBeHalfedge(v1v4);
//   expect(v4v1.next).toBeOneOfHalfedges([v1v0, v1v3]);
//   expect(v1v4.prev).toBeOneOfHalfedges([v2v1, v3v1]);
//
//   v4v3 = struct.addEdge(v4, v3);
//   v3v4 = v4v3.twin;
//   expect(v4v3.next).toBeHalfedge(v3v1);
//   expect(v4v3.prev).toBeHalfedge(v1v4);
//   expect(v3v4.next).toBeHalfedge(v4v1);
//   expect(v3v4.prev).toBeHalfedge(v1v3);
//
//   struct.addFace([v1v4, v4v3, v3v1]);
//
//   expect(v1v4.prev).toBeHalfedge(v3v1);
//   expect(v3v1.next).toBeHalfedge(v1v4);
//
// });
