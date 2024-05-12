// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 24/05/2022

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md

declare global {
  interface Array<T> {
    clear(): Array<T>;
    remove(t: T): boolean;
  }
}

Array.prototype.clear = function() {
  this.splice(0, this.length);
  return this;
}

Array.prototype.remove = function<T>(t: T) {
  const idx = this.indexOf(t);
  if (idx === -1) {
    return false;
  }
  this.splice(idx, 1);
  return true;
}

export {}

