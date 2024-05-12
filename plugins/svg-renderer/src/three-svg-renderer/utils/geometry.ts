

import {Vector2, Vector3, PerspectiveCamera, Line3} from 'three';

const _u = new Vector3();

export interface PointLike {
  x: number;
  y: number;
}

export interface SizeLike {
  w: number;
  h: number;
}

export interface RectLike extends PointLike, SizeLike {}

export function projectPointNDC(
    point: Vector3,
    target: Vector2,
    camera: PerspectiveCamera
): Vector2 {

  _u.copy(point).project(camera);
  return target.set(_u.x, _u.y);
}

export function projectPoint(
    point: Vector3,
    target: Vector2,
    camera: PerspectiveCamera,
    renderSize: SizeLike): Vector2 {

  projectPointNDC(point, target, camera);
  NDCPointToImage(target, target, renderSize);
  return target;
}

/**
 * Converts a point from the NDC coordinates to the image coordinates
 * @param point Point in NDC to be converted
 * @param size Size of the render
 * @returns 
 */
export function NDCPointToImage(point: Vector2, target: Vector2, size: SizeLike): Vector2 {
  return target.set(
    (point.x + 1)/2 * size.w,
    (1 - point.y)/2 * size.h
  );
}

/**
 * Converts a point from the image coordinates to the NDC coordinates
 * @param point Point in the image coordinates
 * @param size Size of the render
 * @returns 
 */
export function imagePointToNDC(point: Vector2, target: Vector2, size: SizeLike): Vector2 {
  return target.set(
    2/size.w*point.x - 1,
    1 - 2/size.h*point.y
  );
}

export function hashVector3(vec: Vector3, multiplier = 1e10) {
  const gap = 1e-3/multiplier;
  return `${hashNumber(vec.x+gap, multiplier)},` +
         `${hashNumber(vec.y+gap, multiplier)},` +
         `${hashNumber(vec.z+gap, multiplier)}`;
}

export function hashVector2(vec: Vector2, multiplier = 1e10) {
  const gap = 1e-3/multiplier;
  return `${hashNumber(vec.x+gap, multiplier)},` +
         `${hashNumber(vec.y+gap, multiplier)}`;
}

function hashNumber(value: number, multiplier = 1e10) {
  // return (~ ~ (value*multiplier));
  return Math.trunc(value*multiplier);
}

/**
 * Checks wether lines intersect and computes the intersection point.
 * 
 * Adapted from mathjs
 * 
 * @param line1 First segment/line
 * @param line2 Second segment/line
 * @param target Destination of the intersection point
 * @param infiniteLine Wether to consider segments as infinite lines. Default, false
 * @param tolerance Tolerance from which points are considred equal
 * @returns true if lines intersect, false otherwise
 */
export function intersectLines(
    line1: Line3,
    line2: Line3,
    target: Vector3,
    infiniteLine = false,
    tolerance = 1e-10) {

  const {x : x1, y : y1, z : z1} = line1.start;
  const {x : x2, y : y2, z : z2} = line1.end;
  const {x : x3, y : y3, z : z3} = line2.start;
  const {x : x4, y : y4, z : z4} = line2.end;

  // (a - b)*(c - d) + (e - f)*(g - h) + (i - j)*(k - l)
  const d1343 = (x1 - x3)*(x4 - x3) + (y1 - y3)*(y4 - y3) + (z1 - z3)*(z4 - z3);
  const d4321 = (x4 - x3)*(x2 - x1) + (y4 - y3)*(y2 - y1) + (z4 - z3)*(z2 - z1);
  const d1321 = (x1 - x3)*(x2 - x1) + (y1 - y3)*(y2 - y1) + (z1 - z3)*(z2 - z1);
  const d4343 = (x4 - x3)*(x4 - x3) + (y4 - y3)*(y4 - y3) + (z4 - z3)*(z4 - z3);
  const d2121 = (x2 - x1)*(x2 - x1) + (y2 - y1)*(y2 - y1) + (z2 - z1)*(z2 - z1);


  const numerator = (d1343 * d4321) - (d1321 * d4343);
  const denominator = (d2121 * d4343) - (d4321 * d4321);
  if (denominator < tolerance) {
    return false;
  }
  const ta = numerator / denominator;
  const tb = ((d1343 + (ta * d4321)) / d4343);

  if (!infiniteLine && (ta < 0 || ta > 1 || tb < 0 || tb > 1)) {
    return false;
  }

  const pax = x1 + (ta * (x2 - x1));
  const pay = y1 + (ta * (y2 - y1));
  const paz = z1 + (ta * (z2 - z1));
  const pbx = x3 + (tb * (x4 - x3));
  const pby = y3 + (tb * (y4 - y3));
  const pbz = z3 + (tb * (z4 - z3));
  if (Math.abs(pax - pbx) < tolerance && 
      Math.abs(pay - pby) < tolerance &&
      Math.abs(paz - pbz) < tolerance) {
    target.set(pax, pay, paz);
    return true;
  } 
  return false;
}

export function vectors3Equal(a: Vector3, b: Vector3, tolerance = 1e-10) {
  return (
    Math.abs(a.x - b.x) < tolerance &&
    Math.abs(a.y - b.y) < tolerance &&
    Math.abs(a.z - b.z) < tolerance
  );
}

export function vectors2Equal(a: Vector2, b: Vector2, tolerance = 1e-10) {
  return (
    Math.abs(a.x - b.x) < tolerance &&
    Math.abs(a.y - b.y) < tolerance
  );
}
