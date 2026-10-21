/**
 * Шум для детализации рельефа.
 *
 * Карта мира замкнута по долготе, поэтому шум считается не на плоскости, а на цилиндре:
 * точка (x, y) км превращается в (R·cos θ, R·sin θ, y), где θ = 2π·x / ширина мира.
 * Левый и правый край карты получаются одной и той же точкой, шва нет, а повороты шума
 * по октавам ломают привязку к осям.
 */

export function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(iz, 0x85ebca6b) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Трёхмерный шум значений с гладкой интерполяцией, значения 0..1. */
export function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z),
    fx = x - ix,
    fy = y - iy,
    fz = z - iz,
    u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy),
    w = fz * fz * (3 - 2 * fz);
  const a = hash3(ix, iy, iz, seed),
    b = hash3(ix + 1, iy, iz, seed),
    c = hash3(ix, iy + 1, iz, seed),
    d = hash3(ix + 1, iy + 1, iz, seed),
    e = hash3(ix, iy, iz + 1, seed),
    f = hash3(ix + 1, iy, iz + 1, seed),
    g = hash3(ix, iy + 1, iz + 1, seed),
    h = hash3(ix + 1, iy + 1, iz + 1, seed);
  const x00 = a + (b - a) * u,
    x10 = c + (d - c) * u,
    x01 = e + (f - e) * u,
    x11 = g + (h - g) * u;
  const y0 = x00 + (x10 - x00) * v,
    y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

/** Матрицы поворота для октав: одни и те же у всех плиток. */
function rotation(ax: number, ay: number, az: number): number[] {
  const cx = Math.cos(ax),
    sx = Math.sin(ax),
    cy = Math.cos(ay),
    sy = Math.sin(ay),
    cz = Math.cos(az),
    sz = Math.sin(az);
  return [
    cy * cz,
    -cy * sz,
    sy,
    sx * sy * cz + cx * sz,
    -sx * sy * sz + cx * cz,
    -sx * cy,
    -cx * sy * cz + sx * sz,
    cx * sy * sz + sx * cz,
    cx * cy,
  ];
}
const OCTAVES = 7;
const ROT = Array.from({ length: OCTAVES }, (_, o) =>
  rotation(0.9 + o * 0.83, 0.4 + o * 1.17, 1.7 + o * 0.61),
);

export const RIDGE_BASE_KM = 300; // длина волны первой октавы
export const RIDGE_GAIN = 0.52;
export const RIDGE_LACUNARITY = 2.05;

/**
 * Хребтовый шум 0..1: острые гребни и долины. Октавы короче двух пикселей отбрасываются,
 * последняя плавно гаснет, чтобы при смене масштаба картинка не «вспыхивала».
 * Нормировка по всем октавам одинакова, поэтому высота гор не зависит от масштаба.
 */
export function ridged(px: number, py: number, pz: number, seed: number, pixKm: number): number {
  // искривление области делает гребни извилистыми
  const wx = px + 110 * (noise3(px / 260, py / 260, pz / 260, seed + 11) - 0.5),
    wy = py + 110 * (noise3(px / 260 + 7.3, py / 260 + 1.9, pz / 260, seed + 23) - 0.5),
    wz = pz + 110 * (noise3(px / 260 + 3.1, py / 260 + 5.7, pz / 260 + 9.2, seed + 37) - 0.5);
  let amp = 1,
    f = 1 / RIDGE_BASE_KM,
    sum = 0,
    norm = 0,
    weight = 1;
  for (let o = 0; o < OCTAVES; o++) {
    norm += amp;
    const wave = 1 / f,
      fade = Math.min(1, Math.max(0, (wave / pixKm - 2) / 2));
    if (fade > 0) {
      const r = ROT[o];
      let n = noise3(
        (wx * r[0] + wy * r[1] + wz * r[2]) * f,
        (wx * r[3] + wy * r[4] + wz * r[5]) * f,
        (wx * r[6] + wy * r[7] + wz * r[8]) * f,
        seed + o * 101,
      );
      n = 1 - Math.abs(2 * n - 1);
      n = n * n * weight;
      weight = Math.min(1, n * 2);
      sum += n * amp * fade;
    }
    amp *= RIDGE_GAIN;
    f *= RIDGE_LACUNARITY;
  }
  return sum / norm;
}
