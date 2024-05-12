// /*
//  * Author: Axel Antoine
//  * mail: ax.antoine@gmail.com
//  * website: http://axantoine.com
//  * Created on Tue Dec 06 2022
//  *
//  * Loki, Inria project-team with Université de Lille
//  * within the Joint Research Unit UMR 9189
//  * CNRS - Centrale Lille - Université de Lille, CRIStAL
//  * https://loki.lille.inria.fr
//  *
//  * Licence: Licence.md
//  */
//
// import {Vector3} from 'three';
// import { Vertex } from 'three-mesh-halfedge';
//
// declare global {
//   namespace jest {
//     interface Matchers<R> {
//       toBeVertex(expected: Vertex): CustomMatcherResult;
//     }
//   }
// }
//
// expect.extend({
//
//   toBeVertex(received: Vertex, expected: Vertex) {
//     const pass = received === expected;
//
//     return {
//       message: () =>
//         `Expected Vertices ${pass? 'not ': ''}to be equal`+
//         `\nReceived: Vertex ${received.id} ${vecToStr(received.position)}`+
//         `\nExpected: Vertex ${expected.id} ${vecToStr(expected.position)}`,
//       pass: pass,
//     };
//   },
//
// });
//
// export function vecToStr(v: Vector3) {
//   return `(${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)})`;
// }
//
// export function generatorSize(g: Generator) {
//   let cpt = 0;
//   let v = g.next();
//   while(!v.done) {
//     cpt += 1;
//     v = g.next();
//   }
//   return cpt;
// }
//
// export function generatorToArray<T>(g: Generator<T>) {
//   const array = new Array<T>();
//   let v = g.next();
//   while(!v.done) {
//     array.push(v.value);
//     v = g.next();
//   }
//   return array;
// }
