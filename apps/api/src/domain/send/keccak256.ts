/**
 * keccak-256, in this repository, with no dependencies.
 *
 * ── Why this is here and not imported ────────────────────────────────────────
 *
 * EIP-55 is a keccak-256 checksum, and there is no `keccak` in the Worker: the
 * only hashing library this project has is `viem`, and `viem` is a **dev**
 * dependency. Importing it from `src/` would make the production bundle depend
 * on a package that is not installed where it runs — so the permutation lives
 * here, in twenty-odd lines of arithmetic, and is cross-checked against `viem` in
 * `test/domain/send.test.ts`.
 *
 * ── Why it is `bigint` and slow on purpose ───────────────────────────────────
 *
 * The state is 200 bits spread over 25 lanes of 64. With `number` that would be
 * two lanes' worth of precision, and a hash that is wrong in its high bits still
 * looks like a hash. With `bigint` the lanes are exact and the only cost is a
 * few microseconds on an address — which is called once per send, not in a loop.
 *
 * ── Why this is keccak and NOT SHA3 ──────────────────────────────────────────
 *
 * They differ in exactly one byte — the padding — and that one byte is the whole
 * reason EIP-55 exists as a standard: keccak-256 pads with `0x01`, SHA3-256
 * with `0x06`. The empty string is the vector that tells them apart:
 *
 *   keccak256("") = c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
 *   sha3_256("") = a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a
 */

/** The 64 bits that fit in a lane, and nothing above them. */
const MASK_64 = (1n << 64n) - 1n;

/**
 * The rotation offsets of the ρ step, indexed `[x][y]`.
 *
 * These twenty-five numbers are the definition of keccak's diffusion. They are
 * not a pattern: writing them in any other order produces a hash that is
 * perfectly well-behaved and completely wrong, which is why the empty-string
 * vector above is asserted next to every use of this file.
 */
const ROTATION: readonly (readonly number[])[] = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

/** The ι step's round constants, the first twenty-four of sixty. */
const ROUND_CONSTANTS: readonly bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

/** `state[x + 5y]`, the lane layout the specification uses. */
const index = (x: number, y: number): number => x + 5 * y;

const rotateLeft = (lane: bigint, bits: number): bigint => {
  if (bits === 0) return lane;
  const shift = BigInt(bits);
  return ((lane << shift) | (lane >> (64n - shift))) & MASK_64;
};

/** The permutation keccak-f[1600], twenty-four rounds on twenty-five lanes. */
const permute = (lanes: bigint[]): void => {
  const c: bigint[] = new Array(5);
  const d: bigint[] = new Array(5);
  const b: bigint[] = new Array(25);

  for (let round = 0; round < 24; round += 1) {
    // θ: the parity of each column, mixed into every lane of that column.
    for (let x = 0; x < 5; x += 1) {
      c[x] = lanes[index(x, 0)]! ^ lanes[index(x, 1)]! ^ lanes[index(x, 2)]! ^ lanes[index(x, 3)]! ^ lanes[index(x, 4)]!;
    }
    for (let x = 0; x < 5; x += 1) {
      d[x] = c[(x + 4) % 5]! ^ rotateLeft(c[(x + 1) % 5]!, 1);
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) lanes[index(x, y)] = lanes[index(x, y)]! ^ d[x]!;
    }

    // ρ and π together: every lane moves, and rotates on the way.
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        b[index(y, (2 * x + 3 * y) % 5)] = rotateLeft(lanes[index(x, y)]!, ROTATION[x]![y]!);
      }
    }

    // χ: the non-linear step. It is the only one that is not a permutation of
    // bits, and the reason a hash cannot be inverted by rearranging the input.
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        lanes[index(x, y)] =
          b[index(x, y)]! ^ (~b[index((x + 1) % 5, y)]! & MASK_64 & b[index((x + 2) % 5, y)]!) & MASK_64;
      }
    }

    // ι: the round's constant, breaking the symmetry between rounds.
    lanes[0] = lanes[0]! ^ ROUND_CONSTANTS[round]!;
  }
};

/** The rate of keccak-256 in bytes: 1600 bits of state, 512 of them absorbed. */
const RATE_BYTES = 136;

/**
 * ASCII text as the hex string this module's hash takes.
 *
 * It exists because EIP-55 hashes the forty **characters** of an address, not
 * its twenty bytes: `keccak256("5aaeb6…")` over the text, not over `0x5aae…`.
 * Getting that wrong produces a digest that is a perfectly good hash of
 * something else, and an address that then fails its own valid checksum.
 */
export const asciiHex = (text: string): string =>
  `0x${Array.from(new TextEncoder().encode(text))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;

/**
 * keccak-256 of a hex string, as a `0x` hex string.
 *
 * `0x` prefixed, even length. An odd-length or non-hex input throws instead of
 * being padded into a hash of something the caller did not write.
 */
export const keccak256 = (hex: string): string => {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (body.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(body)) {
    throw new TypeError(`not a hex string: ${hex.slice(0, 40)}`);
  }

  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);

  /*
   * pad10*1 with keccak's domain byte: `0x01` … `0x80`. The last byte of the
   * final block always carries the closing `0x80`, which is why the OR below is
   * not an assignment.
   */
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / RATE_BYTES) * RATE_BYTES);
  padded.set(bytes);
  padded[bytes.length] = 0x01;
  padded[padded.length - 1] = (padded[padded.length - 1] ?? 0) | 0x80;

  const lanes = new Array<bigint>(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += RATE_BYTES) {
    for (let lane = 0; lane < RATE_BYTES / 8; lane += 1) {
      let word = 0n;
      for (let byte = 7; byte >= 0; byte -= 1) {
        word = (word << 8n) | BigInt(padded[offset + lane * 8 + byte] ?? 0);
      }
      lanes[lane] = lanes[lane]! ^ word;
    }
    permute(lanes);
  }

  // 256 bits of output out of the 1600-bit state: lanes 0 to 3, little endian.
  let out = '';
  for (let lane = 0; lane < 4; lane += 1) {
    let word = lanes[lane]!;
    for (let byte = 0; byte < 8; byte += 1) {
      out += (Number(word & 0xffn)).toString(16).padStart(2, '0');
      word >>= 8n;
    }
  }
  return `0x${out}`;
};
