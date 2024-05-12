/*
 * Author: Axel Antoine
 * mail: ax.antoine@gmail.com
 * website: http://axantoine.com
 * Created on Thu Oct 20 2022
 *
 * Loki, Inria project-team with Université de Lille
 * within the Joint Research Unit UMR 9189 
 * CNRS - Centrale Lille - Université de Lille, CRIStAL
 * https://loki.lille.inria.fr
 *
 * Licence: Licence.md
 */

import { Matrix4, Triangle, Vector3 } from "three";

const _matrix = new Matrix4();

/**
 * Determines whether the point `d` is to the left of, to the right of, or on 
 * the oriented plane defined by triangle `abc` appearing in counter-clockwise
 * order when viewed from above the plane.
 * 
 * See https://hal.inria.fr/hal-02189483 Appendix C.2 Orientation test
 * 
 * @param a Triangle point
 * @param b Triangle point
 * @param c Triangle point
 * @param d Test point
 * @param epsilon Precision, default to `1e-10`
 * @returns `1` if on the right side, `-1` if left, `0` if coplanar
 */
export function orient3D(a: Vector3, b: Vector3, c: Vector3, d: Vector3, epsilon = 1e-10): 1|-1|0{
  _matrix.set(
    a.x, a.y, a.z, 1,
    b.x, b.y, b.z, 1,
    c.x, c.y, c.z, 1,
    d.x, d.y, d.z, 1
  );
  const det = _matrix.determinant();

  if (det > epsilon) {
    return 1;
  } else if (det < -epsilon) {
    return -1;
  }
  return 0;
}

/**
 * 
 * Determines whether the point `d` is to the left of, to the right of, or on 
 * the oriented plane defined by triangle `abc` appearing in counter-clockwise
 * order when viewed from above the plane.
 * 
 * See https://hal.inria.fr/hal-02189483 Appendix C.2 Orientation test
 * 
 * @param tri Triangle
 * @param p Test point
 * @param epsilon Precision, default to `1e-10`
 * @returns `1` if on the right side, `-1` if left, `0` if coplanar
 */
export function triOrient3D(tri: Triangle, p: Vector3, epsilon = 1e-10) {
  return orient3D(tri.a, tri.b, tri.c, p, epsilon);
}

/**
 * Returns whether the point `d` is front facing the triangle `abc`.
 * 
 * See https://hal.inria.fr/hal-02189483 Appendix C.2 Orientation test
 * 
 * @param a Triangle point
 * @param b Triangle point
 * @param c Triangle point
 * @param d Camera position
 * @param epsilon Precision, default to `1e-10`
 * @returns `True` if triangle if front facing, `False` otherwise
 */
export function frontSide(a: Vector3, b: Vector3, c: Vector3, d: Vector3, epsilon = 1e-10) {
  return orient3D(d, b, c, a, epsilon) > 0;
}

/**
 * Returns whether the points `d` and `e` are on the same side of the triangle `abc`.
 * 
 * See https://hal.inria.fr/hal-02189483 Appendix C.2 Orientation test
 * 
 * @param a Triangle point
 * @param b Triangle point
 * @param c Triangle point
 * @param d Test point
 * @param e Test point
 * @param epsilon Precision, default to `1e-10`
 * @returns `True` if points are on the same side, `False` otherwise
 */
export function sameSide(a: Vector3, b: Vector3, c: Vector3, d: Vector3, e: Vector3, epsilon = 1e-10) {
  return (orient3D(a,b,c,d,epsilon) > 0) === (orient3D(a,b,c,e,epsilon) > 0);
}

/**
 * Rounds the number `num` with the given `divider`.
 * @param num Number to round
 * @param divider Value of the divider, default `100`.
 * @returns Rounded number
 */
export function round(num: number, divider = 100) {
  return Math.round(num * divider)/divider;
}
