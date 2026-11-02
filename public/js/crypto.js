/**
 * crypto.js — Primitives RSA en BigInt pur
 *
 * Cours chapitres 5 et 6 :
 *   5.2  Algorithme d'Euclide étendu
 *   5.4  Exponentiation rapide (square-and-multiply)
 *   6.6  Calcul de la clé privée
 *
 * Test de primalité : Miller-Rabin déterministe sur 8 témoins
 * (suffisant pour des nombres jusqu'à ~3×10²⁴, et probabiliste au-delà).
 */

// ── Arithmétique modulaire ────────────────────────────────────────────────────

/**
 * Exponentiation rapide (cours 5.4) : calcule x^k mod n.
 * @param {bigint} x
 * @param {bigint} k
 * @param {bigint} n
 * @returns {bigint}
 */
export function puissance(x, k, n) {
  let r = 1n;
  x %= n;
  while (k > 0n) {
    if (k & 1n) r = (r * x) % n;
    x = (x * x) % n;
    k >>= 1n;
  }
  return r;
}

/**
 * Algorithme d'Euclide étendu (cours 5.2).
 * @param {bigint} a
 * @param {bigint} b
 * @returns {[bigint, bigint, bigint]} [pgcd(a,b), u, v] tels que a·u + b·v = pgcd
 */
export function euclideEtendu(a, b) {
  let x = 1n, xx = 0n, y = 0n, yy = 1n;
  while (b !== 0n) {
    const q = a / b;
    [a, b]   = [b, a % b];
    [xx, x]  = [x - q * xx, xx];
    [yy, y]  = [y - q * yy, yy];
  }
  return [a, x, y];
}

/**
 * Calcule la clé privée d = e⁻¹ mod φ(n) (cours 6.6).
 * @param {bigint} e
 * @param {bigint} phi
 * @returns {bigint}
 */
export function clePrivee(e, phi) {
  const [, d] = euclideEtendu(e, phi);
  return ((d % phi) + phi) % phi;
}

// ── Génération de nombres premiers ───────────────────────────────────────────

/** Petits nombres premiers précalculés pour le crible rapide. */
const _SMALL_PRIMES = [];
for (let i = 2; i < 2000; i++)
  if (_SMALL_PRIMES.every(p => i % p)) _SMALL_PRIMES.push(i);
const _SMALL_PRIMES_BIG = _SMALL_PRIMES.map(BigInt);

/** Témoins de Miller-Rabin (déterministe jusqu'à ~3×10²⁴). */
const _MR_WITNESSES = [3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n];

/**
 * Génère un BigInt aléatoire impair de `bits` bits avec le bit haut à 1.
 * @param {number} bits
 * @returns {bigint}
 */
function _randomOddBigInt(bits) {
  const bytes = new Uint8Array(Math.ceil(bits / 8));
  crypto.getRandomValues(bytes);
  let x = 0n;
  for (const v of bytes) x = (x << 8n) | BigInt(v);
  x &= (1n << BigInt(bits)) - 1n;   // tronque aux bons bits
  return x | (1n << BigInt(bits - 1)) | 1n; // bit haut + impair
}

/**
 * Test de Miller-Rabin pour le témoin `a`.
 * @param {bigint} n  Nombre à tester
 * @param {bigint} a  Témoin
 * @returns {boolean} true = probablement premier
 */
function _millerRabin(n, a) {
  let d = n - 1n, s = 0;
  while (!(d & 1n)) { d >>= 1n; s++; }
  let x = puissance(a, d, n);
  if (x === 1n || x === n - 1n) return true;
  for (let i = 1; i < s; i++) {
    x = (x * x) % n;
    if (x === n - 1n) return true;
  }
  return false;
}

/**
 * Génère un nombre premier aléatoire de `digits` chiffres décimaux.
 * Cède le thread toutes les 3 tentatives pour ne pas bloquer l'UI.
 *
 * @param {number} digits - Nombre de chiffres décimaux voulu (ex : 500)
 * @param {(attempts: number) => void} onProgress - Callback de progression
 * @returns {Promise<bigint>}
 */
export async function genPremier(digits, onProgress) {
  const bits = Math.floor(digits * Math.log2(10));
  let attempts = 0;

  for (;;) {
    const candidate = _randomOddBigInt(bits);
    attempts++;

    // Yield au thread UI toutes les 3 tentatives
    if (attempts % 3 === 0) {
      onProgress(attempts);
      await new Promise(r => setTimeout(r));
    }

    // 1. Crible par les petits premiers (rapide)
    if (_SMALL_PRIMES_BIG.some(s => candidate % s === 0n)) continue;

    // 2. Petit théorème de Fermat (pré-filtre)
    if (puissance(2n, candidate - 1n, candidate) !== 1n) continue;

    // 3. Miller-Rabin sur 8 témoins
    if (_MR_WITNESSES.every(a => _millerRabin(candidate, a))) return candidate;
  }
}

// ── Chiffrement / Déchiffrement RSA ──────────────────────────────────────────

/**
 * Taille maximale d'un bloc en octets pour que m < n.
 * @param {bigint} n
 * @returns {number}
 */
export function blocSize(n) {
  return Math.floor((n.toString(2).length - 1) / 8) - 1;
}

/**
 * Chiffre un texte UTF-8 avec la clé publique (N, E).
 * Chaque bloc est préfixé par 0x01 pour préserver les octets nuls.
 *
 * x ≡ mᵉ (mod n)
 *
 * @param {string}  text
 * @param {bigint}  N
 * @param {bigint}  E
 * @returns {string[]} Blocs chiffrés en base 10
 */
export function chiffrer(text, N, E) {
  const bytes = new TextEncoder().encode(text);
  const B     = blocSize(N);
  const blocs = [];

  for (let i = 0; i < bytes.length; i += B) {
    const hex = Array.from(
      bytes.slice(i, i + B),
      v => v.toString(16).padStart(2, '0')
    ).join('');
    blocs.push(puissance(BigInt('0x01' + hex), E, N).toString());
  }
  return blocs;
}

/**
 * Déchiffre un tableau de blocs avec la clé privée `key`.
 *
 * m ≡ xᵈ (mod n)
 *
 * @param {string[]}              blocs
 * @param {{ n: bigint, d: bigint }} key
 * @returns {string}
 */
export function dechiffrer(blocs, key) {
  const bytes = [];
  for (const bloc of blocs) {
    let hex = puissance(BigInt(bloc), key.d, key.n).toString(16);
    if (hex.length % 2) hex = '0' + hex;
    // On retire le préfixe 0x01 (les 2 premiers caractères hex)
    for (let i = 2; i < hex.length; i += 2)
      bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

