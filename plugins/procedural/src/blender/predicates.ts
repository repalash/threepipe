/**
 * Shewchuk's adaptive exact predicates `orient2d` and `incircle` as Blender 5.2.2 builds them
 * (`blenlib/intern/math_boolean.cc:83-1888`, "Routines for Arbitrary Precision Floating-point Arithmetic and Fast Robust
 * Geometric Predicates", Jonathan Richard Shewchuk, public domain), with the `sgn` wrappers (:2462-2479).
 *
 * Generated from the C source by expanding its macros (`Two_Sum`, `Two_Product`, ... :115-388) into the functions that
 * use them, statement for statement; JavaScript numbers are IEEE doubles with round-to-nearest and no contraction,
 * which is what the algorithm requires.
 */

/* eslint-disable */

type Arr = {[i: number]: number}

// region `exactinit` (:400)
let splitter = 1, epsilon = 1
{
    let half = 0.5, check = 1, lastcheck = 0, everyOther = 1
    do {
        lastcheck = check
        epsilon *= half
        if (everyOther) splitter *= 2.0
        everyOther = everyOther ? 0 : 1
        check = 1.0 + epsilon
    } while (!(check === 1.0 || check === lastcheck))
    splitter += 1.0
}
const resulterrbound = (3.0 + 8.0 * epsilon) * epsilon
const ccwerrboundA = (3.0 + 16.0 * epsilon) * epsilon
const ccwerrboundB = (2.0 + 12.0 * epsilon) * epsilon
const ccwerrboundC = (9.0 + 64.0 * epsilon) * epsilon * epsilon
const iccerrboundA = (10.0 + 96.0 * epsilon) * epsilon
const iccerrboundB = (4.0 + 48.0 * epsilon) * epsilon
const iccerrboundC = (44.0 + 576.0 * epsilon) * epsilon * epsilon
// endregion

function fast_expansion_sum_zeroelim(elen: number, e: Arr, flen: number, f: Arr, h: Arr): number {
    let Q = 0, Qnew = 0, hh = 0, bvirt = 0, avirt = 0, bround = 0, around = 0, eindex = 0, findex = 0, hindex = 0, enow = 0, fnow = 0
  enow = e[0];
  fnow = f[0];
  eindex = findex = 0;
  if ((fnow > enow) == (fnow > -enow)) {
    Q = enow;
    enow = e[++eindex];
  }
  else {
    Q = fnow;
    fnow = f[++findex];
  }
  hindex = 0;
  if ((eindex < elen) && (findex < flen)) {
    if ((fnow > enow) == (fnow > -enow)) {
         Qnew = (enow + Q);       bvirt = Qnew - enow;    hh = Q - bvirt;
      enow = e[++eindex];
    }
    else {
         Qnew = (fnow + Q);       bvirt = Qnew - fnow;    hh = Q - bvirt;
      fnow = f[++findex];
    }
    Q = Qnew;
    if (hh != 0.0) {
      h[hindex++] = hh;
    }
    while ((eindex < elen) && (findex < flen)) {
      if ((fnow > enow) == (fnow > -enow)) {
           Qnew = (Q + enow);       bvirt = (Qnew - Q);    avirt = Qnew - bvirt;    bround = enow - bvirt;    around = Q - avirt;    hh = around + bround;
        if (++eindex < elen) {
          enow = e[eindex];
        }
      }
      else {
           Qnew = (Q + fnow);       bvirt = (Qnew - Q);    avirt = Qnew - bvirt;    bround = fnow - bvirt;    around = Q - avirt;    hh = around + bround;
        if (++findex < flen) {
          fnow = f[findex];
        }
      }
      Q = Qnew;
      if (hh != 0.0) {
        h[hindex++] = hh;
      }
    }
  }
  while (eindex < elen) {
       Qnew = (Q + enow);       bvirt = (Qnew - Q);    avirt = Qnew - bvirt;    bround = enow - bvirt;    around = Q - avirt;    hh = around + bround;
    if (++eindex < elen) {
      enow = e[eindex];
    }
    Q = Qnew;
    if (hh != 0.0) {
      h[hindex++] = hh;
    }
  }
  while (findex < flen) {
       Qnew = (Q + fnow);       bvirt = (Qnew - Q);    avirt = Qnew - bvirt;    bround = fnow - bvirt;    around = Q - avirt;    hh = around + bround;
    if (++findex < flen) {
      fnow = f[findex];
    }
    Q = Qnew;
    if (hh != 0.0) {
      h[hindex++] = hh;
    }
  }
  if ((Q != 0.0) || (hindex == 0)) {
    h[hindex++] = Q;
  }
  return hindex;
}

function scale_expansion_zeroelim(elen: number, e: Arr, b: number, h: Arr): number {
    let Q = 0, sum = 0, hh = 0, product1 = 0, product0 = 0, eindex = 0, hindex = 0, enow = 0, bvirt = 0, avirt = 0, bround = 0, around = 0, c = 0, abig = 0, ahi = 0, alo = 0, bhi = 0, blo = 0, err1 = 0, err2 = 0, err3 = 0
     c = (splitter * b);    abig = (c - b);    bhi = c - abig;    blo = b - bhi;
     Q = (e[0] * b);       c = (splitter * e[0]);    abig = (c - e[0]);    ahi = c - abig;    alo = e[0] - ahi;    err1 = Q - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    hh = (alo * blo) - err3;
  hindex = 0;
  if (hh != 0) {
    h[hindex++] = hh;
  }
  for (eindex = 1; eindex < elen; eindex++) {
    enow = e[eindex];
       product1 = (enow * b);       c = (splitter * enow);    abig = (c - enow);    ahi = c - abig;    alo = enow - ahi;    err1 = product1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    product0 = (alo * blo) - err3;
       sum = (Q + product0);       bvirt = (sum - Q);    avirt = sum - bvirt;    bround = product0 - bvirt;    around = Q - avirt;    hh = around + bround;
    if (hh != 0) {
      h[hindex++] = hh;
    }
       Q = (product1 + sum);       bvirt = Q - product1;    hh = sum - bvirt;
    if (hh != 0) {
      h[hindex++] = hh;
    }
  }
  if ((Q != 0.0) || (hindex == 0)) {
    h[hindex++] = Q;
  }
  return hindex;
}

function estimate(elen: number, e: Arr): number {
    let Q = 0, eindex = 0
  Q = e[0];
  for (eindex = 1; eindex < elen; eindex++) {
    Q += e[eindex];
  }
  return Q;
}

function orient2dadapt(pa: Arr, pb: Arr, pc: Arr, detsum: number): number {
    let acx = 0, acy = 0, bcx = 0, bcy = 0, acxtail = 0, acytail = 0, bcxtail = 0, bcytail = 0, detleft = 0, detright = 0, detlefttail = 0, detrighttail = 0, det = 0, errbound = 0, B3 = 0, C1length = 0, C2length = 0, Dlength = 0, u3 = 0, s1 = 0, t1 = 0, s0 = 0, t0 = 0, bvirt = 0, avirt = 0, bround = 0, around = 0, c = 0, abig = 0, ahi = 0, alo = 0, bhi = 0, blo = 0, err1 = 0, err2 = 0, err3 = 0, _i = 0, _j = 0, _0 = 0
    const B = new Float64Array(4)
    const C1 = new Float64Array(8)
    const C2 = new Float64Array(12)
    const D = new Float64Array(16)
    const u = new Float64Array(4)
  acx = (pa[0] - pc[0]);
  bcx = (pb[0] - pc[0]);
  acy = (pa[1] - pc[1]);
  bcy = (pb[1] - pc[1]);
     detleft = (acx * bcy);          c = (splitter * acx);    abig = (c - acx);    ahi = c - abig;    alo = acx - ahi;       c = (splitter * bcy);    abig = (c - bcy);    bhi = c - abig;    blo = bcy - bhi;    err1 = detleft - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    detlefttail = (alo * blo) - err3;
     detright = (acy * bcx);          c = (splitter * acy);    abig = (c - acy);    ahi = c - abig;    alo = acy - ahi;       c = (splitter * bcx);    abig = (c - bcx);    bhi = c - abig;    blo = bcx - bhi;    err1 = detright - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    detrighttail = (alo * blo) - err3;
           _i = (detlefttail - detrighttail);       bvirt = (detlefttail - _i);    avirt = _i + bvirt;    bround = bvirt - detrighttail;    around = detlefttail - avirt;    B[0] = around + bround;       _j = (detleft + _i);       bvirt = (_j - detleft);    avirt = _j - bvirt;    bround = _i - bvirt;    around = detleft - avirt;    _0 = around + bround;          _i = (_0 - detright);       bvirt = (_0 - _i);    avirt = _i + bvirt;    bround = bvirt - detright;    around = _0 - avirt;    B[1] = around + bround;       B3 = (_j + _i);       bvirt = (B3 - _j);    avirt = B3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    B[2] = around + bround;
  B[3] = B3;
  det = estimate(4, B);
  errbound = ccwerrboundB * detsum;
  if ((det >= errbound) || (-det >= errbound)) {
    return det;
  }
     bvirt = (pa[0] - acx);    avirt = acx + bvirt;    bround = bvirt - pc[0];    around = pa[0] - avirt;    acxtail = around + bround;
     bvirt = (pb[0] - bcx);    avirt = bcx + bvirt;    bround = bvirt - pc[0];    around = pb[0] - avirt;    bcxtail = around + bround;
     bvirt = (pa[1] - acy);    avirt = acy + bvirt;    bround = bvirt - pc[1];    around = pa[1] - avirt;    acytail = around + bround;
     bvirt = (pb[1] - bcy);    avirt = bcy + bvirt;    bround = bvirt - pc[1];    around = pb[1] - avirt;    bcytail = around + bround;
  if ((acxtail == 0.0) && (acytail == 0.0) && (bcxtail == 0.0) && (bcytail == 0.0)) {
    return det;
  }
  errbound = ccwerrboundC * detsum + resulterrbound * Math.abs(det);
  det += (acx * bcytail + bcy * acxtail) - (acy * bcxtail + bcx * acytail);
  if ((det >= errbound) || (-det >= errbound)) {
    return det;
  }
     s1 = (acxtail * bcy);          c = (splitter * acxtail);    abig = (c - acxtail);    ahi = c - abig;    alo = acxtail - ahi;       c = (splitter * bcy);    abig = (c - bcy);    bhi = c - abig;    blo = bcy - bhi;    err1 = s1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    s0 = (alo * blo) - err3;
     t1 = (acytail * bcx);          c = (splitter * acytail);    abig = (c - acytail);    ahi = c - abig;    alo = acytail - ahi;       c = (splitter * bcx);    abig = (c - bcx);    bhi = c - abig;    blo = bcx - bhi;    err1 = t1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    t0 = (alo * blo) - err3;
           _i = (s0 - t0);       bvirt = (s0 - _i);    avirt = _i + bvirt;    bround = bvirt - t0;    around = s0 - avirt;    u[0] = around + bround;       _j = (s1 + _i);       bvirt = (_j - s1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = s1 - avirt;    _0 = around + bround;          _i = (_0 - t1);       bvirt = (_0 - _i);    avirt = _i + bvirt;    bround = bvirt - t1;    around = _0 - avirt;    u[1] = around + bround;       u3 = (_j + _i);       bvirt = (u3 - _j);    avirt = u3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    u[2] = around + bround;
  u[3] = u3;
  C1length = fast_expansion_sum_zeroelim(4, B, 4, u, C1);
     s1 = (acx * bcytail);          c = (splitter * acx);    abig = (c - acx);    ahi = c - abig;    alo = acx - ahi;       c = (splitter * bcytail);    abig = (c - bcytail);    bhi = c - abig;    blo = bcytail - bhi;    err1 = s1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    s0 = (alo * blo) - err3;
     t1 = (acy * bcxtail);          c = (splitter * acy);    abig = (c - acy);    ahi = c - abig;    alo = acy - ahi;       c = (splitter * bcxtail);    abig = (c - bcxtail);    bhi = c - abig;    blo = bcxtail - bhi;    err1 = t1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    t0 = (alo * blo) - err3;
           _i = (s0 - t0);       bvirt = (s0 - _i);    avirt = _i + bvirt;    bround = bvirt - t0;    around = s0 - avirt;    u[0] = around + bround;       _j = (s1 + _i);       bvirt = (_j - s1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = s1 - avirt;    _0 = around + bround;          _i = (_0 - t1);       bvirt = (_0 - _i);    avirt = _i + bvirt;    bround = bvirt - t1;    around = _0 - avirt;    u[1] = around + bround;       u3 = (_j + _i);       bvirt = (u3 - _j);    avirt = u3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    u[2] = around + bround;
  u[3] = u3;
  C2length = fast_expansion_sum_zeroelim(C1length, C1, 4, u, C2);
     s1 = (acxtail * bcytail);          c = (splitter * acxtail);    abig = (c - acxtail);    ahi = c - abig;    alo = acxtail - ahi;       c = (splitter * bcytail);    abig = (c - bcytail);    bhi = c - abig;    blo = bcytail - bhi;    err1 = s1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    s0 = (alo * blo) - err3;
     t1 = (acytail * bcxtail);          c = (splitter * acytail);    abig = (c - acytail);    ahi = c - abig;    alo = acytail - ahi;       c = (splitter * bcxtail);    abig = (c - bcxtail);    bhi = c - abig;    blo = bcxtail - bhi;    err1 = t1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    t0 = (alo * blo) - err3;
           _i = (s0 - t0);       bvirt = (s0 - _i);    avirt = _i + bvirt;    bround = bvirt - t0;    around = s0 - avirt;    u[0] = around + bround;       _j = (s1 + _i);       bvirt = (_j - s1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = s1 - avirt;    _0 = around + bround;          _i = (_0 - t1);       bvirt = (_0 - _i);    avirt = _i + bvirt;    bround = bvirt - t1;    around = _0 - avirt;    u[1] = around + bround;       u3 = (_j + _i);       bvirt = (u3 - _j);    avirt = u3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    u[2] = around + bround;
  u[3] = u3;
  Dlength = fast_expansion_sum_zeroelim(C2length, C2, 4, u, D);
  return (D[Dlength - 1]);
}

function orient2dRaw(pa: Arr, pb: Arr, pc: Arr): number {
    let detleft = 0, detright = 0, det = 0, detsum = 0, errbound = 0
  detleft = (pa[0] - pc[0]) * (pb[1] - pc[1]);
  detright = (pa[1] - pc[1]) * (pb[0] - pc[0]);
  det = detleft - detright;
  if (detleft > 0.0) {
    if (detright <= 0.0) {
      return det;
    }
    detsum = detleft + detright;
  }
  else if (detleft < 0.0) {
    if (detright >= 0.0) {
      return det;
    }
    detsum = -detleft - detright;
  }
  else {
    return det;
  }
  errbound = ccwerrboundA * detsum;
  if ((det >= errbound) || (-det >= errbound)) {
    return det;
  }
  return orient2dadapt(pa, pb, pc, detsum);
}

function incircleadapt(pa: Arr, pb: Arr, pc: Arr, pd: Arr, permanent: number): number {
    let adx = 0, bdx = 0, cdx = 0, ady = 0, bdy = 0, cdy = 0, det = 0, errbound = 0, bdxcdy1 = 0, cdxbdy1 = 0, cdxady1 = 0, adxcdy1 = 0, adxbdy1 = 0, bdxady1 = 0, bdxcdy0 = 0, cdxbdy0 = 0, cdxady0 = 0, adxcdy0 = 0, adxbdy0 = 0, bdxady0 = 0, bc3 = 0, ca3 = 0, ab3 = 0, axbclen = 0, axxbclen = 0, aybclen = 0, ayybclen = 0, alen = 0, bxcalen = 0, bxxcalen = 0, bycalen = 0, byycalen = 0, blen = 0, cxablen = 0, cxxablen = 0, cyablen = 0, cyyablen = 0, clen = 0, ablen = 0, finlength = 0, adxtail = 0, bdxtail = 0, cdxtail = 0, adytail = 0, bdytail = 0, cdytail = 0, adxadx1 = 0, adyady1 = 0, bdxbdx1 = 0, bdybdy1 = 0, cdxcdx1 = 0, cdycdy1 = 0, adxadx0 = 0, adyady0 = 0, bdxbdx0 = 0, bdybdy0 = 0, cdxcdx0 = 0, cdycdy0 = 0, aa3 = 0, bb3 = 0, cc3 = 0, ti1 = 0, tj1 = 0, ti0 = 0, tj0 = 0, u3 = 0, v3 = 0, temp8len = 0, temp16alen = 0, temp16blen = 0, temp16clen = 0, temp32alen = 0, temp32blen = 0, temp48len = 0, temp64len = 0, axtbblen = 0, axtcclen = 0, aytbblen = 0, aytcclen = 0, bxtaalen = 0, bxtcclen = 0, bytaalen = 0, bytcclen = 0, cxtaalen = 0, cxtbblen = 0, cytaalen = 0, cytbblen = 0, axtbclen = 0, aytbclen = 0, bxtcalen = 0, bytcalen = 0, cxtablen = 0, cytablen = 0, axtbctlen = 0, aytbctlen = 0, bxtcatlen = 0, bytcatlen = 0, cxtabtlen = 0, cytabtlen = 0, axtbcttlen = 0, aytbcttlen = 0, bxtcattlen = 0, bytcattlen = 0, cxtabttlen = 0, cytabttlen = 0, abtlen = 0, bctlen = 0, catlen = 0, abttlen = 0, bcttlen = 0, cattlen = 0, abtt3 = 0, bctt3 = 0, catt3 = 0, negate = 0, bvirt = 0, avirt = 0, bround = 0, around = 0, c = 0, abig = 0, ahi = 0, alo = 0, bhi = 0, blo = 0, err1 = 0, err2 = 0, err3 = 0, _i = 0, _j = 0, _0 = 0
    const bc = new Float64Array(4)
    const ca = new Float64Array(4)
    const ab = new Float64Array(4)
    const axbc = new Float64Array(8)
    const axxbc = new Float64Array(16)
    const aybc = new Float64Array(8)
    const ayybc = new Float64Array(16)
    const adet = new Float64Array(32)
    const bxca = new Float64Array(8)
    const bxxca = new Float64Array(16)
    const byca = new Float64Array(8)
    const byyca = new Float64Array(16)
    const bdet = new Float64Array(32)
    const cxab = new Float64Array(8)
    const cxxab = new Float64Array(16)
    const cyab = new Float64Array(8)
    const cyyab = new Float64Array(16)
    const cdet = new Float64Array(32)
    const abdet = new Float64Array(64)
    const fin1 = new Float64Array(1152)
    const fin2 = new Float64Array(1152)
    const aa = new Float64Array(4)
    const bb = new Float64Array(4)
    const cc = new Float64Array(4)
    const u = new Float64Array(4)
    const v = new Float64Array(4)
    const temp8 = new Float64Array(8)
    const temp16a = new Float64Array(16)
    const temp16b = new Float64Array(16)
    const temp16c = new Float64Array(16)
    const temp32a = new Float64Array(32)
    const temp32b = new Float64Array(32)
    const temp48 = new Float64Array(48)
    const temp64 = new Float64Array(64)
    const axtbb = new Float64Array(8)
    const axtcc = new Float64Array(8)
    const aytbb = new Float64Array(8)
    const aytcc = new Float64Array(8)
    const bxtaa = new Float64Array(8)
    const bxtcc = new Float64Array(8)
    const bytaa = new Float64Array(8)
    const bytcc = new Float64Array(8)
    const cxtaa = new Float64Array(8)
    const cxtbb = new Float64Array(8)
    const cytaa = new Float64Array(8)
    const cytbb = new Float64Array(8)
    const axtbc = new Float64Array(8)
    const aytbc = new Float64Array(8)
    const bxtca = new Float64Array(8)
    const bytca = new Float64Array(8)
    const cxtab = new Float64Array(8)
    const cytab = new Float64Array(8)
    const axtbct = new Float64Array(16)
    const aytbct = new Float64Array(16)
    const bxtcat = new Float64Array(16)
    const bytcat = new Float64Array(16)
    const cxtabt = new Float64Array(16)
    const cytabt = new Float64Array(16)
    const axtbctt = new Float64Array(8)
    const aytbctt = new Float64Array(8)
    const bxtcatt = new Float64Array(8)
    const bytcatt = new Float64Array(8)
    const cxtabtt = new Float64Array(8)
    const cytabtt = new Float64Array(8)
    const abt = new Float64Array(8)
    const bct = new Float64Array(8)
    const cat = new Float64Array(8)
    const abtt = new Float64Array(4)
    const bctt = new Float64Array(4)
    const catt = new Float64Array(4)
    let finnow: Float64Array
    let finother: Float64Array
    let finswap: Float64Array
  adx = (pa[0] - pd[0]);
  bdx = (pb[0] - pd[0]);
  cdx = (pc[0] - pd[0]);
  ady = (pa[1] - pd[1]);
  bdy = (pb[1] - pd[1]);
  cdy = (pc[1] - pd[1]);
     bdxcdy1 = (bdx * cdy);          c = (splitter * bdx);    abig = (c - bdx);    ahi = c - abig;    alo = bdx - ahi;       c = (splitter * cdy);    abig = (c - cdy);    bhi = c - abig;    blo = cdy - bhi;    err1 = bdxcdy1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    bdxcdy0 = (alo * blo) - err3;
     cdxbdy1 = (cdx * bdy);          c = (splitter * cdx);    abig = (c - cdx);    ahi = c - abig;    alo = cdx - ahi;       c = (splitter * bdy);    abig = (c - bdy);    bhi = c - abig;    blo = bdy - bhi;    err1 = cdxbdy1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    cdxbdy0 = (alo * blo) - err3;
           _i = (bdxcdy0 - cdxbdy0);       bvirt = (bdxcdy0 - _i);    avirt = _i + bvirt;    bround = bvirt - cdxbdy0;    around = bdxcdy0 - avirt;    bc[0] = around + bround;       _j = (bdxcdy1 + _i);       bvirt = (_j - bdxcdy1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = bdxcdy1 - avirt;    _0 = around + bround;          _i = (_0 - cdxbdy1);       bvirt = (_0 - _i);    avirt = _i + bvirt;    bround = bvirt - cdxbdy1;    around = _0 - avirt;    bc[1] = around + bround;       bc3 = (_j + _i);       bvirt = (bc3 - _j);    avirt = bc3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    bc[2] = around + bround;
  bc[3] = bc3;
  axbclen = scale_expansion_zeroelim(4, bc, adx, axbc);
  axxbclen = scale_expansion_zeroelim(axbclen, axbc, adx, axxbc);
  aybclen = scale_expansion_zeroelim(4, bc, ady, aybc);
  ayybclen = scale_expansion_zeroelim(aybclen, aybc, ady, ayybc);
  alen = fast_expansion_sum_zeroelim(axxbclen, axxbc, ayybclen, ayybc, adet);
     cdxady1 = (cdx * ady);          c = (splitter * cdx);    abig = (c - cdx);    ahi = c - abig;    alo = cdx - ahi;       c = (splitter * ady);    abig = (c - ady);    bhi = c - abig;    blo = ady - bhi;    err1 = cdxady1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    cdxady0 = (alo * blo) - err3;
     adxcdy1 = (adx * cdy);          c = (splitter * adx);    abig = (c - adx);    ahi = c - abig;    alo = adx - ahi;       c = (splitter * cdy);    abig = (c - cdy);    bhi = c - abig;    blo = cdy - bhi;    err1 = adxcdy1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    adxcdy0 = (alo * blo) - err3;
           _i = (cdxady0 - adxcdy0);       bvirt = (cdxady0 - _i);    avirt = _i + bvirt;    bround = bvirt - adxcdy0;    around = cdxady0 - avirt;    ca[0] = around + bround;       _j = (cdxady1 + _i);       bvirt = (_j - cdxady1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = cdxady1 - avirt;    _0 = around + bround;          _i = (_0 - adxcdy1);       bvirt = (_0 - _i);    avirt = _i + bvirt;    bround = bvirt - adxcdy1;    around = _0 - avirt;    ca[1] = around + bround;       ca3 = (_j + _i);       bvirt = (ca3 - _j);    avirt = ca3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    ca[2] = around + bround;
  ca[3] = ca3;
  bxcalen = scale_expansion_zeroelim(4, ca, bdx, bxca);
  bxxcalen = scale_expansion_zeroelim(bxcalen, bxca, bdx, bxxca);
  bycalen = scale_expansion_zeroelim(4, ca, bdy, byca);
  byycalen = scale_expansion_zeroelim(bycalen, byca, bdy, byyca);
  blen = fast_expansion_sum_zeroelim(bxxcalen, bxxca, byycalen, byyca, bdet);
     adxbdy1 = (adx * bdy);          c = (splitter * adx);    abig = (c - adx);    ahi = c - abig;    alo = adx - ahi;       c = (splitter * bdy);    abig = (c - bdy);    bhi = c - abig;    blo = bdy - bhi;    err1 = adxbdy1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    adxbdy0 = (alo * blo) - err3;
     bdxady1 = (bdx * ady);          c = (splitter * bdx);    abig = (c - bdx);    ahi = c - abig;    alo = bdx - ahi;       c = (splitter * ady);    abig = (c - ady);    bhi = c - abig;    blo = ady - bhi;    err1 = bdxady1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    bdxady0 = (alo * blo) - err3;
           _i = (adxbdy0 - bdxady0);       bvirt = (adxbdy0 - _i);    avirt = _i + bvirt;    bround = bvirt - bdxady0;    around = adxbdy0 - avirt;    ab[0] = around + bround;       _j = (adxbdy1 + _i);       bvirt = (_j - adxbdy1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = adxbdy1 - avirt;    _0 = around + bround;          _i = (_0 - bdxady1);       bvirt = (_0 - _i);    avirt = _i + bvirt;    bround = bvirt - bdxady1;    around = _0 - avirt;    ab[1] = around + bround;       ab3 = (_j + _i);       bvirt = (ab3 - _j);    avirt = ab3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    ab[2] = around + bround;
  ab[3] = ab3;
  cxablen = scale_expansion_zeroelim(4, ab, cdx, cxab);
  cxxablen = scale_expansion_zeroelim(cxablen, cxab, cdx, cxxab);
  cyablen = scale_expansion_zeroelim(4, ab, cdy, cyab);
  cyyablen = scale_expansion_zeroelim(cyablen, cyab, cdy, cyyab);
  clen = fast_expansion_sum_zeroelim(cxxablen, cxxab, cyyablen, cyyab, cdet);
  ablen = fast_expansion_sum_zeroelim(alen, adet, blen, bdet, abdet);
  finlength = fast_expansion_sum_zeroelim(ablen, abdet, clen, cdet, fin1);
  det = estimate(finlength, fin1);
  errbound = iccerrboundB * permanent;
  if ((det >= errbound) || (-det >= errbound)) {
    return det;
  }
     bvirt = (pa[0] - adx);    avirt = adx + bvirt;    bround = bvirt - pd[0];    around = pa[0] - avirt;    adxtail = around + bround;
     bvirt = (pa[1] - ady);    avirt = ady + bvirt;    bround = bvirt - pd[1];    around = pa[1] - avirt;    adytail = around + bround;
     bvirt = (pb[0] - bdx);    avirt = bdx + bvirt;    bround = bvirt - pd[0];    around = pb[0] - avirt;    bdxtail = around + bround;
     bvirt = (pb[1] - bdy);    avirt = bdy + bvirt;    bround = bvirt - pd[1];    around = pb[1] - avirt;    bdytail = around + bround;
     bvirt = (pc[0] - cdx);    avirt = cdx + bvirt;    bround = bvirt - pd[0];    around = pc[0] - avirt;    cdxtail = around + bround;
     bvirt = (pc[1] - cdy);    avirt = cdy + bvirt;    bround = bvirt - pd[1];    around = pc[1] - avirt;    cdytail = around + bround;
  if ((adxtail == 0.0) && (bdxtail == 0.0) && (cdxtail == 0.0) && (adytail == 0.0) &&
      (bdytail == 0.0) && (cdytail == 0.0))
  {
    return det;
  }
  errbound = iccerrboundC * permanent + resulterrbound * Math.abs(det);
  det += ((adx * adx + ady * ady) *
              ((bdx * cdytail + cdy * bdxtail) - (bdy * cdxtail + cdx * bdytail)) +
          2.0 * (adx * adxtail + ady * adytail) * (bdx * cdy - bdy * cdx)) +
         ((bdx * bdx + bdy * bdy) *
              ((cdx * adytail + ady * cdxtail) - (cdy * adxtail + adx * cdytail)) +
          2.0 * (bdx * bdxtail + bdy * bdytail) * (cdx * ady - cdy * adx)) +
         ((cdx * cdx + cdy * cdy) *
              ((adx * bdytail + bdy * adxtail) - (ady * bdxtail + bdx * adytail)) +
          2.0 * (cdx * cdxtail + cdy * cdytail) * (adx * bdy - ady * bdx));
  if ((det >= errbound) || (-det >= errbound)) {
    return det;
  }
  finnow = fin1;
  finother = fin2;
  if ((bdxtail != 0.0) || (bdytail != 0.0) || (cdxtail != 0.0) || (cdytail != 0.0)) {
       adxadx1 = (adx * adx);          c = (splitter * adx);    abig = (c - adx);    ahi = c - abig;    alo = adx - ahi;    err1 = adxadx1 - (ahi * ahi);    err3 = err1 - ((ahi + ahi) * alo);    adxadx0 = (alo * alo) - err3;
       adyady1 = (ady * ady);          c = (splitter * ady);    abig = (c - ady);    ahi = c - abig;    alo = ady - ahi;    err1 = adyady1 - (ahi * ahi);    err3 = err1 - ((ahi + ahi) * alo);    adyady0 = (alo * alo) - err3;
             _i = (adxadx0 + adyady0);       bvirt = (_i - adxadx0);    avirt = _i - bvirt;    bround = adyady0 - bvirt;    around = adxadx0 - avirt;    aa[0] = around + bround;       _j = (adxadx1 + _i);       bvirt = (_j - adxadx1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = adxadx1 - avirt;    _0 = around + bround;          _i = (_0 + adyady1);       bvirt = (_i - _0);    avirt = _i - bvirt;    bround = adyady1 - bvirt;    around = _0 - avirt;    aa[1] = around + bround;       aa3 = (_j + _i);       bvirt = (aa3 - _j);    avirt = aa3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    aa[2] = around + bround;
    aa[3] = aa3;
  }
  if ((cdxtail != 0.0) || (cdytail != 0.0) || (adxtail != 0.0) || (adytail != 0.0)) {
       bdxbdx1 = (bdx * bdx);          c = (splitter * bdx);    abig = (c - bdx);    ahi = c - abig;    alo = bdx - ahi;    err1 = bdxbdx1 - (ahi * ahi);    err3 = err1 - ((ahi + ahi) * alo);    bdxbdx0 = (alo * alo) - err3;
       bdybdy1 = (bdy * bdy);          c = (splitter * bdy);    abig = (c - bdy);    ahi = c - abig;    alo = bdy - ahi;    err1 = bdybdy1 - (ahi * ahi);    err3 = err1 - ((ahi + ahi) * alo);    bdybdy0 = (alo * alo) - err3;
             _i = (bdxbdx0 + bdybdy0);       bvirt = (_i - bdxbdx0);    avirt = _i - bvirt;    bround = bdybdy0 - bvirt;    around = bdxbdx0 - avirt;    bb[0] = around + bround;       _j = (bdxbdx1 + _i);       bvirt = (_j - bdxbdx1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = bdxbdx1 - avirt;    _0 = around + bround;          _i = (_0 + bdybdy1);       bvirt = (_i - _0);    avirt = _i - bvirt;    bround = bdybdy1 - bvirt;    around = _0 - avirt;    bb[1] = around + bround;       bb3 = (_j + _i);       bvirt = (bb3 - _j);    avirt = bb3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    bb[2] = around + bround;
    bb[3] = bb3;
  }
  if ((adxtail != 0.0) || (adytail != 0.0) || (bdxtail != 0.0) || (bdytail != 0.0)) {
       cdxcdx1 = (cdx * cdx);          c = (splitter * cdx);    abig = (c - cdx);    ahi = c - abig;    alo = cdx - ahi;    err1 = cdxcdx1 - (ahi * ahi);    err3 = err1 - ((ahi + ahi) * alo);    cdxcdx0 = (alo * alo) - err3;
       cdycdy1 = (cdy * cdy);          c = (splitter * cdy);    abig = (c - cdy);    ahi = c - abig;    alo = cdy - ahi;    err1 = cdycdy1 - (ahi * ahi);    err3 = err1 - ((ahi + ahi) * alo);    cdycdy0 = (alo * alo) - err3;
             _i = (cdxcdx0 + cdycdy0);       bvirt = (_i - cdxcdx0);    avirt = _i - bvirt;    bround = cdycdy0 - bvirt;    around = cdxcdx0 - avirt;    cc[0] = around + bround;       _j = (cdxcdx1 + _i);       bvirt = (_j - cdxcdx1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = cdxcdx1 - avirt;    _0 = around + bround;          _i = (_0 + cdycdy1);       bvirt = (_i - _0);    avirt = _i - bvirt;    bround = cdycdy1 - bvirt;    around = _0 - avirt;    cc[1] = around + bround;       cc3 = (_j + _i);       bvirt = (cc3 - _j);    avirt = cc3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    cc[2] = around + bround;
    cc[3] = cc3;
  }
  if (adxtail != 0.0) {
    axtbclen = scale_expansion_zeroelim(4, bc, adxtail, axtbc);
    temp16alen = scale_expansion_zeroelim(axtbclen, axtbc, 2.0 * adx, temp16a);
    axtcclen = scale_expansion_zeroelim(4, cc, adxtail, axtcc);
    temp16blen = scale_expansion_zeroelim(axtcclen, axtcc, bdy, temp16b);
    axtbblen = scale_expansion_zeroelim(4, bb, adxtail, axtbb);
    temp16clen = scale_expansion_zeroelim(axtbblen, axtbb, -cdy, temp16c);
    temp32alen = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp16blen, temp16b, temp32a);
    temp48len = fast_expansion_sum_zeroelim(temp16clen, temp16c, temp32alen, temp32a, temp48);
    finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp48len, temp48, finother);
    finswap = finnow;
    finnow = finother;
    finother = finswap;
  }
  if (adytail != 0.0) {
    aytbclen = scale_expansion_zeroelim(4, bc, adytail, aytbc);
    temp16alen = scale_expansion_zeroelim(aytbclen, aytbc, 2.0 * ady, temp16a);
    aytbblen = scale_expansion_zeroelim(4, bb, adytail, aytbb);
    temp16blen = scale_expansion_zeroelim(aytbblen, aytbb, cdx, temp16b);
    aytcclen = scale_expansion_zeroelim(4, cc, adytail, aytcc);
    temp16clen = scale_expansion_zeroelim(aytcclen, aytcc, -bdx, temp16c);
    temp32alen = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp16blen, temp16b, temp32a);
    temp48len = fast_expansion_sum_zeroelim(temp16clen, temp16c, temp32alen, temp32a, temp48);
    finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp48len, temp48, finother);
    finswap = finnow;
    finnow = finother;
    finother = finswap;
  }
  if (bdxtail != 0.0) {
    bxtcalen = scale_expansion_zeroelim(4, ca, bdxtail, bxtca);
    temp16alen = scale_expansion_zeroelim(bxtcalen, bxtca, 2.0 * bdx, temp16a);
    bxtaalen = scale_expansion_zeroelim(4, aa, bdxtail, bxtaa);
    temp16blen = scale_expansion_zeroelim(bxtaalen, bxtaa, cdy, temp16b);
    bxtcclen = scale_expansion_zeroelim(4, cc, bdxtail, bxtcc);
    temp16clen = scale_expansion_zeroelim(bxtcclen, bxtcc, -ady, temp16c);
    temp32alen = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp16blen, temp16b, temp32a);
    temp48len = fast_expansion_sum_zeroelim(temp16clen, temp16c, temp32alen, temp32a, temp48);
    finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp48len, temp48, finother);
    finswap = finnow;
    finnow = finother;
    finother = finswap;
  }
  if (bdytail != 0.0) {
    bytcalen = scale_expansion_zeroelim(4, ca, bdytail, bytca);
    temp16alen = scale_expansion_zeroelim(bytcalen, bytca, 2.0 * bdy, temp16a);
    bytcclen = scale_expansion_zeroelim(4, cc, bdytail, bytcc);
    temp16blen = scale_expansion_zeroelim(bytcclen, bytcc, adx, temp16b);
    bytaalen = scale_expansion_zeroelim(4, aa, bdytail, bytaa);
    temp16clen = scale_expansion_zeroelim(bytaalen, bytaa, -cdx, temp16c);
    temp32alen = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp16blen, temp16b, temp32a);
    temp48len = fast_expansion_sum_zeroelim(temp16clen, temp16c, temp32alen, temp32a, temp48);
    finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp48len, temp48, finother);
    finswap = finnow;
    finnow = finother;
    finother = finswap;
  }
  if (cdxtail != 0.0) {
    cxtablen = scale_expansion_zeroelim(4, ab, cdxtail, cxtab);
    temp16alen = scale_expansion_zeroelim(cxtablen, cxtab, 2.0 * cdx, temp16a);
    cxtbblen = scale_expansion_zeroelim(4, bb, cdxtail, cxtbb);
    temp16blen = scale_expansion_zeroelim(cxtbblen, cxtbb, ady, temp16b);
    cxtaalen = scale_expansion_zeroelim(4, aa, cdxtail, cxtaa);
    temp16clen = scale_expansion_zeroelim(cxtaalen, cxtaa, -bdy, temp16c);
    temp32alen = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp16blen, temp16b, temp32a);
    temp48len = fast_expansion_sum_zeroelim(temp16clen, temp16c, temp32alen, temp32a, temp48);
    finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp48len, temp48, finother);
    finswap = finnow;
    finnow = finother;
    finother = finswap;
  }
  if (cdytail != 0.0) {
    cytablen = scale_expansion_zeroelim(4, ab, cdytail, cytab);
    temp16alen = scale_expansion_zeroelim(cytablen, cytab, 2.0 * cdy, temp16a);
    cytaalen = scale_expansion_zeroelim(4, aa, cdytail, cytaa);
    temp16blen = scale_expansion_zeroelim(cytaalen, cytaa, bdx, temp16b);
    cytbblen = scale_expansion_zeroelim(4, bb, cdytail, cytbb);
    temp16clen = scale_expansion_zeroelim(cytbblen, cytbb, -adx, temp16c);
    temp32alen = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp16blen, temp16b, temp32a);
    temp48len = fast_expansion_sum_zeroelim(temp16clen, temp16c, temp32alen, temp32a, temp48);
    finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp48len, temp48, finother);
    finswap = finnow;
    finnow = finother;
    finother = finswap;
  }
  if ((adxtail != 0.0) || (adytail != 0.0)) {
    if ((bdxtail != 0.0) || (bdytail != 0.0) || (cdxtail != 0.0) || (cdytail != 0.0)) {
         ti1 = (bdxtail * cdy);          c = (splitter * bdxtail);    abig = (c - bdxtail);    ahi = c - abig;    alo = bdxtail - ahi;       c = (splitter * cdy);    abig = (c - cdy);    bhi = c - abig;    blo = cdy - bhi;    err1 = ti1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    ti0 = (alo * blo) - err3;
         tj1 = (bdx * cdytail);          c = (splitter * bdx);    abig = (c - bdx);    ahi = c - abig;    alo = bdx - ahi;       c = (splitter * cdytail);    abig = (c - cdytail);    bhi = c - abig;    blo = cdytail - bhi;    err1 = tj1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    tj0 = (alo * blo) - err3;
               _i = (ti0 + tj0);       bvirt = (_i - ti0);    avirt = _i - bvirt;    bround = tj0 - bvirt;    around = ti0 - avirt;    u[0] = around + bround;       _j = (ti1 + _i);       bvirt = (_j - ti1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = ti1 - avirt;    _0 = around + bround;          _i = (_0 + tj1);       bvirt = (_i - _0);    avirt = _i - bvirt;    bround = tj1 - bvirt;    around = _0 - avirt;    u[1] = around + bround;       u3 = (_j + _i);       bvirt = (u3 - _j);    avirt = u3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    u[2] = around + bround;
      u[3] = u3;
      negate = -bdy;
         ti1 = (cdxtail * negate);          c = (splitter * cdxtail);    abig = (c - cdxtail);    ahi = c - abig;    alo = cdxtail - ahi;       c = (splitter * negate);    abig = (c - negate);    bhi = c - abig;    blo = negate - bhi;    err1 = ti1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    ti0 = (alo * blo) - err3;
      negate = -bdytail;
         tj1 = (cdx * negate);          c = (splitter * cdx);    abig = (c - cdx);    ahi = c - abig;    alo = cdx - ahi;       c = (splitter * negate);    abig = (c - negate);    bhi = c - abig;    blo = negate - bhi;    err1 = tj1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    tj0 = (alo * blo) - err3;
               _i = (ti0 + tj0);       bvirt = (_i - ti0);    avirt = _i - bvirt;    bround = tj0 - bvirt;    around = ti0 - avirt;    v[0] = around + bround;       _j = (ti1 + _i);       bvirt = (_j - ti1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = ti1 - avirt;    _0 = around + bround;          _i = (_0 + tj1);       bvirt = (_i - _0);    avirt = _i - bvirt;    bround = tj1 - bvirt;    around = _0 - avirt;    v[1] = around + bround;       v3 = (_j + _i);       bvirt = (v3 - _j);    avirt = v3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    v[2] = around + bround;
      v[3] = v3;
      bctlen = fast_expansion_sum_zeroelim(4, u, 4, v, bct);
         ti1 = (bdxtail * cdytail);          c = (splitter * bdxtail);    abig = (c - bdxtail);    ahi = c - abig;    alo = bdxtail - ahi;       c = (splitter * cdytail);    abig = (c - cdytail);    bhi = c - abig;    blo = cdytail - bhi;    err1 = ti1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    ti0 = (alo * blo) - err3;
         tj1 = (cdxtail * bdytail);          c = (splitter * cdxtail);    abig = (c - cdxtail);    ahi = c - abig;    alo = cdxtail - ahi;       c = (splitter * bdytail);    abig = (c - bdytail);    bhi = c - abig;    blo = bdytail - bhi;    err1 = tj1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    tj0 = (alo * blo) - err3;
               _i = (ti0 - tj0);       bvirt = (ti0 - _i);    avirt = _i + bvirt;    bround = bvirt - tj0;    around = ti0 - avirt;    bctt[0] = around + bround;       _j = (ti1 + _i);       bvirt = (_j - ti1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = ti1 - avirt;    _0 = around + bround;          _i = (_0 - tj1);       bvirt = (_0 - _i);    avirt = _i + bvirt;    bround = bvirt - tj1;    around = _0 - avirt;    bctt[1] = around + bround;       bctt3 = (_j + _i);       bvirt = (bctt3 - _j);    avirt = bctt3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    bctt[2] = around + bround;
      bctt[3] = bctt3;
      bcttlen = 4;
    }
    else {
      bct[0] = 0.0;
      bctlen = 1;
      bctt[0] = 0.0;
      bcttlen = 1;
    }
    if (adxtail != 0.0) {
      temp16alen = scale_expansion_zeroelim(axtbclen, axtbc, adxtail, temp16a);
      axtbctlen = scale_expansion_zeroelim(bctlen, bct, adxtail, axtbct);
      temp32alen = scale_expansion_zeroelim(axtbctlen, axtbct, 2.0 * adx, temp32a);
      temp48len = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp32alen, temp32a, temp48);
      finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp48len, temp48, finother);
      finswap = finnow;
      finnow = finother;
      finother = finswap;
      if (bdytail != 0.0) {
        temp8len = scale_expansion_zeroelim(4, cc, adxtail, temp8);
        temp16alen = scale_expansion_zeroelim(temp8len, temp8, bdytail, temp16a);
        finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp16alen, temp16a, finother);
        finswap = finnow;
        finnow = finother;
        finother = finswap;
      }
      if (cdytail != 0.0) {
        temp8len = scale_expansion_zeroelim(4, bb, -adxtail, temp8);
        temp16alen = scale_expansion_zeroelim(temp8len, temp8, cdytail, temp16a);
        finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp16alen, temp16a, finother);
        finswap = finnow;
        finnow = finother;
        finother = finswap;
      }
      temp32alen = scale_expansion_zeroelim(axtbctlen, axtbct, adxtail, temp32a);
      axtbcttlen = scale_expansion_zeroelim(bcttlen, bctt, adxtail, axtbctt);
      temp16alen = scale_expansion_zeroelim(axtbcttlen, axtbctt, 2.0 * adx, temp16a);
      temp16blen = scale_expansion_zeroelim(axtbcttlen, axtbctt, adxtail, temp16b);
      temp32blen = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp16blen, temp16b, temp32b);
      temp64len = fast_expansion_sum_zeroelim(temp32alen, temp32a, temp32blen, temp32b, temp64);
      finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp64len, temp64, finother);
      finswap = finnow;
      finnow = finother;
      finother = finswap;
    }
    if (adytail != 0.0) {
      temp16alen = scale_expansion_zeroelim(aytbclen, aytbc, adytail, temp16a);
      aytbctlen = scale_expansion_zeroelim(bctlen, bct, adytail, aytbct);
      temp32alen = scale_expansion_zeroelim(aytbctlen, aytbct, 2.0 * ady, temp32a);
      temp48len = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp32alen, temp32a, temp48);
      finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp48len, temp48, finother);
      finswap = finnow;
      finnow = finother;
      finother = finswap;
      temp32alen = scale_expansion_zeroelim(aytbctlen, aytbct, adytail, temp32a);
      aytbcttlen = scale_expansion_zeroelim(bcttlen, bctt, adytail, aytbctt);
      temp16alen = scale_expansion_zeroelim(aytbcttlen, aytbctt, 2.0 * ady, temp16a);
      temp16blen = scale_expansion_zeroelim(aytbcttlen, aytbctt, adytail, temp16b);
      temp32blen = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp16blen, temp16b, temp32b);
      temp64len = fast_expansion_sum_zeroelim(temp32alen, temp32a, temp32blen, temp32b, temp64);
      finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp64len, temp64, finother);
      finswap = finnow;
      finnow = finother;
      finother = finswap;
    }
  }
  if ((bdxtail != 0.0) || (bdytail != 0.0)) {
    if ((cdxtail != 0.0) || (cdytail != 0.0) || (adxtail != 0.0) || (adytail != 0.0)) {
         ti1 = (cdxtail * ady);          c = (splitter * cdxtail);    abig = (c - cdxtail);    ahi = c - abig;    alo = cdxtail - ahi;       c = (splitter * ady);    abig = (c - ady);    bhi = c - abig;    blo = ady - bhi;    err1 = ti1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    ti0 = (alo * blo) - err3;
         tj1 = (cdx * adytail);          c = (splitter * cdx);    abig = (c - cdx);    ahi = c - abig;    alo = cdx - ahi;       c = (splitter * adytail);    abig = (c - adytail);    bhi = c - abig;    blo = adytail - bhi;    err1 = tj1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    tj0 = (alo * blo) - err3;
               _i = (ti0 + tj0);       bvirt = (_i - ti0);    avirt = _i - bvirt;    bround = tj0 - bvirt;    around = ti0 - avirt;    u[0] = around + bround;       _j = (ti1 + _i);       bvirt = (_j - ti1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = ti1 - avirt;    _0 = around + bround;          _i = (_0 + tj1);       bvirt = (_i - _0);    avirt = _i - bvirt;    bround = tj1 - bvirt;    around = _0 - avirt;    u[1] = around + bround;       u3 = (_j + _i);       bvirt = (u3 - _j);    avirt = u3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    u[2] = around + bround;
      u[3] = u3;
      negate = -cdy;
         ti1 = (adxtail * negate);          c = (splitter * adxtail);    abig = (c - adxtail);    ahi = c - abig;    alo = adxtail - ahi;       c = (splitter * negate);    abig = (c - negate);    bhi = c - abig;    blo = negate - bhi;    err1 = ti1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    ti0 = (alo * blo) - err3;
      negate = -cdytail;
         tj1 = (adx * negate);          c = (splitter * adx);    abig = (c - adx);    ahi = c - abig;    alo = adx - ahi;       c = (splitter * negate);    abig = (c - negate);    bhi = c - abig;    blo = negate - bhi;    err1 = tj1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    tj0 = (alo * blo) - err3;
               _i = (ti0 + tj0);       bvirt = (_i - ti0);    avirt = _i - bvirt;    bround = tj0 - bvirt;    around = ti0 - avirt;    v[0] = around + bround;       _j = (ti1 + _i);       bvirt = (_j - ti1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = ti1 - avirt;    _0 = around + bround;          _i = (_0 + tj1);       bvirt = (_i - _0);    avirt = _i - bvirt;    bround = tj1 - bvirt;    around = _0 - avirt;    v[1] = around + bround;       v3 = (_j + _i);       bvirt = (v3 - _j);    avirt = v3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    v[2] = around + bround;
      v[3] = v3;
      catlen = fast_expansion_sum_zeroelim(4, u, 4, v, cat);
         ti1 = (cdxtail * adytail);          c = (splitter * cdxtail);    abig = (c - cdxtail);    ahi = c - abig;    alo = cdxtail - ahi;       c = (splitter * adytail);    abig = (c - adytail);    bhi = c - abig;    blo = adytail - bhi;    err1 = ti1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    ti0 = (alo * blo) - err3;
         tj1 = (adxtail * cdytail);          c = (splitter * adxtail);    abig = (c - adxtail);    ahi = c - abig;    alo = adxtail - ahi;       c = (splitter * cdytail);    abig = (c - cdytail);    bhi = c - abig;    blo = cdytail - bhi;    err1 = tj1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    tj0 = (alo * blo) - err3;
               _i = (ti0 - tj0);       bvirt = (ti0 - _i);    avirt = _i + bvirt;    bround = bvirt - tj0;    around = ti0 - avirt;    catt[0] = around + bround;       _j = (ti1 + _i);       bvirt = (_j - ti1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = ti1 - avirt;    _0 = around + bround;          _i = (_0 - tj1);       bvirt = (_0 - _i);    avirt = _i + bvirt;    bround = bvirt - tj1;    around = _0 - avirt;    catt[1] = around + bround;       catt3 = (_j + _i);       bvirt = (catt3 - _j);    avirt = catt3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    catt[2] = around + bround;
      catt[3] = catt3;
      cattlen = 4;
    }
    else {
      cat[0] = 0.0;
      catlen = 1;
      catt[0] = 0.0;
      cattlen = 1;
    }
    if (bdxtail != 0.0) {
      temp16alen = scale_expansion_zeroelim(bxtcalen, bxtca, bdxtail, temp16a);
      bxtcatlen = scale_expansion_zeroelim(catlen, cat, bdxtail, bxtcat);
      temp32alen = scale_expansion_zeroelim(bxtcatlen, bxtcat, 2.0 * bdx, temp32a);
      temp48len = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp32alen, temp32a, temp48);
      finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp48len, temp48, finother);
      finswap = finnow;
      finnow = finother;
      finother = finswap;
      if (cdytail != 0.0) {
        temp8len = scale_expansion_zeroelim(4, aa, bdxtail, temp8);
        temp16alen = scale_expansion_zeroelim(temp8len, temp8, cdytail, temp16a);
        finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp16alen, temp16a, finother);
        finswap = finnow;
        finnow = finother;
        finother = finswap;
      }
      if (adytail != 0.0) {
        temp8len = scale_expansion_zeroelim(4, cc, -bdxtail, temp8);
        temp16alen = scale_expansion_zeroelim(temp8len, temp8, adytail, temp16a);
        finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp16alen, temp16a, finother);
        finswap = finnow;
        finnow = finother;
        finother = finswap;
      }
      temp32alen = scale_expansion_zeroelim(bxtcatlen, bxtcat, bdxtail, temp32a);
      bxtcattlen = scale_expansion_zeroelim(cattlen, catt, bdxtail, bxtcatt);
      temp16alen = scale_expansion_zeroelim(bxtcattlen, bxtcatt, 2.0 * bdx, temp16a);
      temp16blen = scale_expansion_zeroelim(bxtcattlen, bxtcatt, bdxtail, temp16b);
      temp32blen = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp16blen, temp16b, temp32b);
      temp64len = fast_expansion_sum_zeroelim(temp32alen, temp32a, temp32blen, temp32b, temp64);
      finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp64len, temp64, finother);
      finswap = finnow;
      finnow = finother;
      finother = finswap;
    }
    if (bdytail != 0.0) {
      temp16alen = scale_expansion_zeroelim(bytcalen, bytca, bdytail, temp16a);
      bytcatlen = scale_expansion_zeroelim(catlen, cat, bdytail, bytcat);
      temp32alen = scale_expansion_zeroelim(bytcatlen, bytcat, 2.0 * bdy, temp32a);
      temp48len = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp32alen, temp32a, temp48);
      finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp48len, temp48, finother);
      finswap = finnow;
      finnow = finother;
      finother = finswap;
      temp32alen = scale_expansion_zeroelim(bytcatlen, bytcat, bdytail, temp32a);
      bytcattlen = scale_expansion_zeroelim(cattlen, catt, bdytail, bytcatt);
      temp16alen = scale_expansion_zeroelim(bytcattlen, bytcatt, 2.0 * bdy, temp16a);
      temp16blen = scale_expansion_zeroelim(bytcattlen, bytcatt, bdytail, temp16b);
      temp32blen = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp16blen, temp16b, temp32b);
      temp64len = fast_expansion_sum_zeroelim(temp32alen, temp32a, temp32blen, temp32b, temp64);
      finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp64len, temp64, finother);
      finswap = finnow;
      finnow = finother;
      finother = finswap;
    }
  }
  if ((cdxtail != 0.0) || (cdytail != 0.0)) {
    if ((adxtail != 0.0) || (adytail != 0.0) || (bdxtail != 0.0) || (bdytail != 0.0)) {
         ti1 = (adxtail * bdy);          c = (splitter * adxtail);    abig = (c - adxtail);    ahi = c - abig;    alo = adxtail - ahi;       c = (splitter * bdy);    abig = (c - bdy);    bhi = c - abig;    blo = bdy - bhi;    err1 = ti1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    ti0 = (alo * blo) - err3;
         tj1 = (adx * bdytail);          c = (splitter * adx);    abig = (c - adx);    ahi = c - abig;    alo = adx - ahi;       c = (splitter * bdytail);    abig = (c - bdytail);    bhi = c - abig;    blo = bdytail - bhi;    err1 = tj1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    tj0 = (alo * blo) - err3;
               _i = (ti0 + tj0);       bvirt = (_i - ti0);    avirt = _i - bvirt;    bround = tj0 - bvirt;    around = ti0 - avirt;    u[0] = around + bround;       _j = (ti1 + _i);       bvirt = (_j - ti1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = ti1 - avirt;    _0 = around + bround;          _i = (_0 + tj1);       bvirt = (_i - _0);    avirt = _i - bvirt;    bround = tj1 - bvirt;    around = _0 - avirt;    u[1] = around + bround;       u3 = (_j + _i);       bvirt = (u3 - _j);    avirt = u3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    u[2] = around + bround;
      u[3] = u3;
      negate = -ady;
         ti1 = (bdxtail * negate);          c = (splitter * bdxtail);    abig = (c - bdxtail);    ahi = c - abig;    alo = bdxtail - ahi;       c = (splitter * negate);    abig = (c - negate);    bhi = c - abig;    blo = negate - bhi;    err1 = ti1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    ti0 = (alo * blo) - err3;
      negate = -adytail;
         tj1 = (bdx * negate);          c = (splitter * bdx);    abig = (c - bdx);    ahi = c - abig;    alo = bdx - ahi;       c = (splitter * negate);    abig = (c - negate);    bhi = c - abig;    blo = negate - bhi;    err1 = tj1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    tj0 = (alo * blo) - err3;
               _i = (ti0 + tj0);       bvirt = (_i - ti0);    avirt = _i - bvirt;    bround = tj0 - bvirt;    around = ti0 - avirt;    v[0] = around + bround;       _j = (ti1 + _i);       bvirt = (_j - ti1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = ti1 - avirt;    _0 = around + bround;          _i = (_0 + tj1);       bvirt = (_i - _0);    avirt = _i - bvirt;    bround = tj1 - bvirt;    around = _0 - avirt;    v[1] = around + bround;       v3 = (_j + _i);       bvirt = (v3 - _j);    avirt = v3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    v[2] = around + bround;
      v[3] = v3;
      abtlen = fast_expansion_sum_zeroelim(4, u, 4, v, abt);
         ti1 = (adxtail * bdytail);          c = (splitter * adxtail);    abig = (c - adxtail);    ahi = c - abig;    alo = adxtail - ahi;       c = (splitter * bdytail);    abig = (c - bdytail);    bhi = c - abig;    blo = bdytail - bhi;    err1 = ti1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    ti0 = (alo * blo) - err3;
         tj1 = (bdxtail * adytail);          c = (splitter * bdxtail);    abig = (c - bdxtail);    ahi = c - abig;    alo = bdxtail - ahi;       c = (splitter * adytail);    abig = (c - adytail);    bhi = c - abig;    blo = adytail - bhi;    err1 = tj1 - (ahi * bhi);    err2 = err1 - (alo * bhi);    err3 = err2 - (ahi * blo);    tj0 = (alo * blo) - err3;
               _i = (ti0 - tj0);       bvirt = (ti0 - _i);    avirt = _i + bvirt;    bround = bvirt - tj0;    around = ti0 - avirt;    abtt[0] = around + bround;       _j = (ti1 + _i);       bvirt = (_j - ti1);    avirt = _j - bvirt;    bround = _i - bvirt;    around = ti1 - avirt;    _0 = around + bround;          _i = (_0 - tj1);       bvirt = (_0 - _i);    avirt = _i + bvirt;    bround = bvirt - tj1;    around = _0 - avirt;    abtt[1] = around + bround;       abtt3 = (_j + _i);       bvirt = (abtt3 - _j);    avirt = abtt3 - bvirt;    bround = _i - bvirt;    around = _j - avirt;    abtt[2] = around + bround;
      abtt[3] = abtt3;
      abttlen = 4;
    }
    else {
      abt[0] = 0.0;
      abtlen = 1;
      abtt[0] = 0.0;
      abttlen = 1;
    }
    if (cdxtail != 0.0) {
      temp16alen = scale_expansion_zeroelim(cxtablen, cxtab, cdxtail, temp16a);
      cxtabtlen = scale_expansion_zeroelim(abtlen, abt, cdxtail, cxtabt);
      temp32alen = scale_expansion_zeroelim(cxtabtlen, cxtabt, 2.0 * cdx, temp32a);
      temp48len = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp32alen, temp32a, temp48);
      finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp48len, temp48, finother);
      finswap = finnow;
      finnow = finother;
      finother = finswap;
      if (adytail != 0.0) {
        temp8len = scale_expansion_zeroelim(4, bb, cdxtail, temp8);
        temp16alen = scale_expansion_zeroelim(temp8len, temp8, adytail, temp16a);
        finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp16alen, temp16a, finother);
        finswap = finnow;
        finnow = finother;
        finother = finswap;
      }
      if (bdytail != 0.0) {
        temp8len = scale_expansion_zeroelim(4, aa, -cdxtail, temp8);
        temp16alen = scale_expansion_zeroelim(temp8len, temp8, bdytail, temp16a);
        finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp16alen, temp16a, finother);
        finswap = finnow;
        finnow = finother;
        finother = finswap;
      }
      temp32alen = scale_expansion_zeroelim(cxtabtlen, cxtabt, cdxtail, temp32a);
      cxtabttlen = scale_expansion_zeroelim(abttlen, abtt, cdxtail, cxtabtt);
      temp16alen = scale_expansion_zeroelim(cxtabttlen, cxtabtt, 2.0 * cdx, temp16a);
      temp16blen = scale_expansion_zeroelim(cxtabttlen, cxtabtt, cdxtail, temp16b);
      temp32blen = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp16blen, temp16b, temp32b);
      temp64len = fast_expansion_sum_zeroelim(temp32alen, temp32a, temp32blen, temp32b, temp64);
      finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp64len, temp64, finother);
      finswap = finnow;
      finnow = finother;
      finother = finswap;
    }
    if (cdytail != 0.0) {
      temp16alen = scale_expansion_zeroelim(cytablen, cytab, cdytail, temp16a);
      cytabtlen = scale_expansion_zeroelim(abtlen, abt, cdytail, cytabt);
      temp32alen = scale_expansion_zeroelim(cytabtlen, cytabt, 2.0 * cdy, temp32a);
      temp48len = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp32alen, temp32a, temp48);
      finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp48len, temp48, finother);
      finswap = finnow;
      finnow = finother;
      finother = finswap;
      temp32alen = scale_expansion_zeroelim(cytabtlen, cytabt, cdytail, temp32a);
      cytabttlen = scale_expansion_zeroelim(abttlen, abtt, cdytail, cytabtt);
      temp16alen = scale_expansion_zeroelim(cytabttlen, cytabtt, 2.0 * cdy, temp16a);
      temp16blen = scale_expansion_zeroelim(cytabttlen, cytabtt, cdytail, temp16b);
      temp32blen = fast_expansion_sum_zeroelim(temp16alen, temp16a, temp16blen, temp16b, temp32b);
      temp64len = fast_expansion_sum_zeroelim(temp32alen, temp32a, temp32blen, temp32b, temp64);
      finlength = fast_expansion_sum_zeroelim(finlength, finnow, temp64len, temp64, finother);
      finswap = finnow;
      finnow = finother;
      finother = finswap;
    }
  }
  return finnow[finlength - 1];
}

function incircleRaw(pa: Arr, pb: Arr, pc: Arr, pd: Arr): number {
    let adx = 0, bdx = 0, cdx = 0, ady = 0, bdy = 0, cdy = 0, bdxcdy = 0, cdxbdy = 0, cdxady = 0, adxcdy = 0, adxbdy = 0, bdxady = 0, alift = 0, blift = 0, clift = 0, det = 0, permanent = 0, errbound = 0
  adx = pa[0] - pd[0];
  bdx = pb[0] - pd[0];
  cdx = pc[0] - pd[0];
  ady = pa[1] - pd[1];
  bdy = pb[1] - pd[1];
  cdy = pc[1] - pd[1];
  bdxcdy = bdx * cdy;
  cdxbdy = cdx * bdy;
  alift = adx * adx + ady * ady;
  cdxady = cdx * ady;
  adxcdy = adx * cdy;
  blift = bdx * bdx + bdy * bdy;
  adxbdy = adx * bdy;
  bdxady = bdx * ady;
  clift = cdx * cdx + cdy * cdy;
  det = alift * (bdxcdy - cdxbdy) + blift * (cdxady - adxcdy) + clift * (adxbdy - bdxady);
  permanent = (Math.abs(bdxcdy) + Math.abs(cdxbdy)) * alift +
              (Math.abs(cdxady) + Math.abs(adxcdy)) * blift +
              (Math.abs(adxbdy) + Math.abs(bdxady)) * clift;
  errbound = iccerrboundA * permanent;
  if ((det > errbound) || (-det > errbound)) {
    return det;
  }
  return incircleadapt(pa, pb, pc, pd, permanent);
}


/** `sgn` (:2462). */
const sgn = (x: number) => (x < 0 ? -1 : x > 0 ? 1 : 0)

/** `orient2d(double2, double2, double2)` (:2467): the exact sign of the orientation of `a`, `b`, `c`. */
export function orient2d(a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>): number {
    return sgn(orient2dRaw(a as Arr, b as Arr, c as Arr))
}

/** `incircle(double2, double2, double2, double2)` (:2477): the exact sign of the in-circle test of `d`. */
export function incircle(a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>, d: ArrayLike<number>): number {
    return sgn(incircleRaw(a as Arr, b as Arr, c as Arr, d as Arr))
}
