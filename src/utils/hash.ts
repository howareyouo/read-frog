/**
 * Minimal synchronous SHA-256 (FIPS 180-4).
 *
 * Replaces the `js-sha256` dependency: the same hex output keeps every existing
 * cache key valid, and the sync signature avoids fan-out changes at the six
 * call sites (some of which need a synchronous hash).
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const HEX = "0123456789abcdef"

function sha256Bytes(input: Uint8Array): Uint8Array {
  const bitLength = input.length * 8
  // Padded message: input + 0x80 + zeros + 8-byte big-endian bit length.
  const paddedLength = (((input.length + 9 + 63) / 64) | 0) * 64
  const words = new Int32Array(paddedLength / 4)
  for (let i = 0; i < input.length; i++) {
    words[i >> 2]! |= input[i]! << (24 - (i % 4) * 8)
  }
  words[input.length >> 2]! |= 0x80 << (24 - (input.length % 4) * 8)
  words[words.length - 1] = bitLength | 0
  if (bitLength > 0xffffffff) {
    words[words.length - 2] = (bitLength / 0x100000000) | 0
  }

  const hash = new Int32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Int32Array(64)

  for (let offset = 0; offset < words.length; offset += 16) {
    for (let i = 0; i < 16; i++) w[i] = words[offset + i]!
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!
      const y = w[i - 2]!
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0
    }

    let a = hash[0]!
    let b = hash[1]!
    let c = hash[2]!
    let d = hash[3]!
    let e = hash[4]!
    let f = hash[5]!
    let g = hash[6]!
    let h = hash[7]!
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i]! + w[i]!) | 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      h = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    hash[0] = (hash[0]! + a) | 0
    hash[1] = (hash[1]! + b) | 0
    hash[2] = (hash[2]! + c) | 0
    hash[3] = (hash[3]! + d) | 0
    hash[4] = (hash[4]! + e) | 0
    hash[5] = (hash[5]! + f) | 0
    hash[6] = (hash[6]! + g) | 0
    hash[7] = (hash[7]! + h) | 0
  }

  const out = new Uint8Array(32)
  for (let i = 0; i < 8; i++) {
    const word = hash[i]!
    out[i * 4] = word >>> 24
    out[i * 4 + 1] = (word >>> 16) & 0xff
    out[i * 4 + 2] = (word >>> 8) & 0xff
    out[i * 4 + 3] = word & 0xff
  }
  return out
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/**
 * Generate a SHA256 hash of multiple text parameters
 * @param texts Variable number of text parameters
 * @returns SHA256 hexadecimal string
 *
 * @example
 * Sha256Hex('hello') // single parameter
 * Sha256Hex('hello', 'world') // multiple parameters joined with separator
 */
export function Sha256Hex(...texts: string[]): string {
  if (texts.length === 0) {
    throw new Error("At least one text parameter is required")
  }

  // prevent parameter boundary ambiguity, e.g. 'a|bc' and 'ab|c' are different
  const combined = texts.join("|")
  const bytes = sha256Bytes(utf8Bytes(combined))
  let hex = ""
  for (const byte of bytes) {
    hex += HEX[byte >> 4]! + HEX[byte & 0xf]!
  }
  return hex
}
