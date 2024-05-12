// Author: Axel Antoine
// mail: ax.antoine@gmail.com
// website: https://axantoine.com
// 04/05/2021

// Loki, Inria project-team with Université de Lille
// within the Joint Research Unit UMR 9189 CNRS-Centrale
// Lille-Université de Lille, CRIStAL.
// https://loki.lille.inria.fr

// LICENCE: Licence.md 

declare module 'isect' {

  interface Point {
    x: number;
    y: number;
  }

  interface Segment {
    from: Point;
    to: Point;
  }

  interface ISectResults {
    run: ()=>void;
    step: ()=>void;
  }

  interface Intersection {
    point: Point;
    segments: Segment[];
  }

  interface Options {
    onFound?: (result: ISectResults) => boolean;
  }

  interface Detector {
    results: Intersection[];
    /**
     * Find all intersections synchronously.
     * 
     * @returns array of found intersections.
     */
    run(): Intersection[];
    /**
     * Performs a single step in the sweep line algorithm
     * 
     * @returns true if there was something to process; False if no more work to do
     */
    step(): boolean;
    /**
     * Add segment
     */
    addSegment(segment: Segment): void;
  }

  export function brute(segments: Segment[], options?: Options): Detector;

  export function bush(segments: Segment[], options?: Options): Detector;

  export function sweep(segments: Segment[], options?: Options): Detector;

}
