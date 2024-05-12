/*
 * Author: Axel Antoine
 * mail: ax.antoine@gmail.com
 * website: http://axantoine.com
 * Created on Thu Nov 10 2022
 *
 * Loki, Inria project-team with Université de Lille
 * within the Joint Research Unit UMR 9189
 * CNRS - Centrale Lille - Université de Lille, CRIStAL
 * https://loki.lille.inria.fr
 *
 * Licence: Licence.md
 */

// declare global {
//   namespace jest {
//     interface Matchers<R> {
//       toBeHalfedge(expected: Halfedge): CustomMatcherResult;
//       toBeVertex(expected: Vertex): CustomMatcherResult;
//       toBeOneOfHalfedges(expected: Halfedge[]): CustomMatcherResult;
//     }
//   }
// }

// expect.extend({
//
//   toBeHalfedge(received: Halfedge, expected: Halfedge) {
//     const pass = received === expected;
//
//     return {
//       message: () =>
//         `Expected Halfedges ${pass? 'not ': ''}to be equal`+
//         '\nReceived: '+ received.id +
//         '\nExpected: '+ expected.id,
//       pass: pass,
//     };
//   },
//
//   toBeOneOfHalfedges(received: Halfedge, expected: Halfedge[]) {
//     const pass = expected.indexOf(received) !== -1;
//
//     return {
//       message: () =>
//         `Expected Halfedges ${pass? 'not ': ''}to be in the list`+
//         '\nReceived: '+ received.id +
//         '\nExpected list: '+ expected.map(e => e.id).join(', '),
//       pass: pass,
//     };
//   },
//
//   toBeVertex(received: Vertex, expected: Vertex) {
//     const pass = received === expected;
//
//     return {
//       message: () =>
//         `Expected Vertices ${pass? 'not ': ''}to be equal`+
//         '\nReceived: '+ received.id +
//         '\nExpected: '+ expected.id,
//       pass: pass,
//     };
//   },
//
// });

export function generatorSize(g: Generator) {
  let cpt = 0;
  let v = g.next();
  while(!v.done) {
    cpt += 1;
    v = g.next();
  }
  return cpt;
}

export function generatorToArray<T>(g: Generator<T>) {
  const array = new Array<T>();
  let v = g.next();
  while(!v.done) {
    array.push(v.value);
    v = g.next();
  }
  return array;
}
