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
// import { HalfedgeDS } from "../core/HalfedgeDS";
// import { Vertex } from "../core/Vertex";
//
// const v1 = new Vertex();
// v1.position.set(2, 3, 4);
// const position = new Vector3();
// const struct = new HalfedgeDS();
//
// beforeEach(() => {
//   struct.clear();
//   struct.vertices.push(v1);
// });
//
// test("Add vertex new position", () => {
//
//   position.set(1,2,3);
//   const v = struct.addVertex(position);
//
//   expect(struct.vertices).toHaveLength(2);
//   expect(struct.vertices.includes(v)).toBeTruthy();
//
// });
//
// describe ("Add vertex existing position", () => {
//
//   test("duplicates not allowed", () => {
//     position.set(2, 3, 4);
//     const v = struct.addVertex(position, true);
//
//     expect(struct.vertices).toHaveLength(1);
//     expect(v).toBe(v1);
//   });
//
//   test("duplicates allowed", () => {
//     position.set(2, 3, 4);
//     const v = struct.addVertex(position);
//
//     expect(struct.vertices).toHaveLength(2);
//     expect(struct.vertices.includes(v)).toBeTruthy();
//     expect(v).not.toBe(v1);
//   });
//
//
// });
//
