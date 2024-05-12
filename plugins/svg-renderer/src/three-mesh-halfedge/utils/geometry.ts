// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 06/09/2021

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md

import {Matrix4, Vector3} from 'three';

const EPSILON = 1e-10;

// See https://hal.inria.fr/hal-02189483 appendix C.2 Orientation test
const _matrix = new Matrix4();
export function orient3D(a: Vector3, b: Vector3, c: Vector3, d: Vector3) {
  _matrix.set(
    a.x, a.y, a.z, 1,
    b.x, b.y, b.z, 1,
    c.x, c.y, c.z, 1,
    d.x, d.y, d.z, 1
  );
  const det = _matrix.determinant();

  if (det > EPSILON) {
    return 1;
  } else if (det < -EPSILON) {
    return -1;
  }
  return 0;
}

// See https://hal.inria.fr/hal-02189483 appendix C.2 Orientation test
export function frontSide(a: Vector3, b: Vector3, c: Vector3, d: Vector3) {
  return orient3D(d, b, c, a);
}

// See https://hal.inria.fr/hal-02189483 appendix C.2 Orientation test
export function sameSide(a: Vector3, b: Vector3, c: Vector3, d: Vector3, e: Vector3) {
  return (orient3D(a,b,c,d) > 0) === (orient3D(a,b,c,e) > 0);
}