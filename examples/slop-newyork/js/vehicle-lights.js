(function () {
const { THREE } = window.NYC;

// A restrained pair of low beams. Intensity is calibrated for inverse-square decay (the previous lights used 1.22).
// Keep these ordinary, unshadowed spots so they stay in the clustered lighting path.
const HEADLIGHTS = {
  color: 0xfff8ec,
  intensity: 700,
  busIntensity: 900,
  distance: 36,
  angle: 0.14,
  penumbra: 0.85,
  decay: 2,
  pitch: 0.145,
  toeOut: 0.005,
  noseOffset: 0.08
};

function createVehicleHeadlight() {
  return new THREE.SpotLight(HEADLIGHTS.color, 0, HEADLIGHTS.distance, HEADLIGHTS.angle, HEADLIGHTS.penumbra, HEADLIGHTS.decay);
}

function placeVehicleHeadlight(spot, spec, side, matrix = null) {
  const x = side * spec.headlight[0];
  const y = spec.headlight[1];
  const z = spec.zFront + HEADLIGHTS.noseOffset;
  const aim = 10;
  spot.position.set(x, y, z);
  // The upper cone edge stays just below the vehicle's horizon. A soft circular cone approximates a low beam;
  // it is not a projector cutoff. Aim relative to the chassis so bumps, banking and highway slopes carry the beam.
  spot.target.position.set(x + side * aim * HEADLIGHTS.toeOut, y - aim * Math.tan(HEADLIGHTS.pitch), z + aim);
  if (matrix) {
    spot.position.applyMatrix4(matrix);
    spot.target.position.applyMatrix4(matrix);
  }
}

Object.assign(window.NYC, { HEADLIGHTS, createVehicleHeadlight, placeVehicleHeadlight });
})();
