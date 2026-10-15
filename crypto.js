/* CRYPTO-500 : moteur RSA (BigInt). Exposé via window.Crypto500 */
(function () {
  const tick = () => new Promise(r => setTimeout(r));
  const PRIME_DIGITS = 500;   // taille imposée de p et q

  // ---------- Outils mathématiques ----------
  function rnd(bits) {
    const b = new Uint8Array(Math.ceil(bits / 8));
    crypto.getRandomValues(b);
    let x = 0n;
    for (const v of b) x = (x << 8n) | BigInt(v);
    return x >> BigInt(b.length * 8 - bits);
  }

  function modpow(b, e, m) {
    let r = 1n; b %= m;
    while (e > 0n) { if (e & 1n) r = r * b % m; e >>= 1n; b = b * b % m; }
    return r;
  }

  function modinv(a, m) {
    let [r0, r1, s0, s1] = [a, m, 1n, 0n];
    while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
    return r0 === 1n ? ((s0 % m) + m) % m : null;
  }

  const gcd = (a, b) => (b ? gcd(b, a % b) : a);

  // ---------- Primalité : crible + Miller-Rabin ----------
  const SMALL = [2];
  for (let i = 3; i < 3000; i += 2) if (SMALL.every(p => i % p)) SMALL.push(i);

  function millerRabin(n, rounds) {
    let d = n - 1n, s = 0;
    while (!(d & 1n)) { d >>= 1n; s++; }
    for (let i = 0; i < rounds; i++) {
      const a = 2n + rnd(64) % (n - 4n);
      let x = modpow(a, d, n);
      if (x === 1n || x === n - 1n) continue;
      let ok = false;
      for (let j = 1; j < s; j++) {
        x = x * x % n;
        if (x === n - 1n) { ok = true; break; }
      }
      if (!ok) return false;
    }
    return true;
  }

  function isPrime(n, rounds = 20) {
    if (n < 2n) return false;
    for (const p of SMALL) {
      const bp = BigInt(p);
      if (n === bp) return true;
      if (n % bp === 0n) return false;
    }
    return millerRabin(n, rounds);
  }

  // Nombre premier d'exactement `digits` chiffres décimaux
  async function genPrime(digits, onTick) {
    const lo = 10n ** BigInt(digits - 1), hi = 10n ** BigInt(digits);
    const bits = Math.ceil(digits * 3.33) + 64;
    for (let count = 1; ; count++) {
      const c = (lo + rnd(bits) % (hi - lo)) | 1n;
      if (count % 25 === 0) { if (onTick) onTick(count, c); await tick(); }
      if (SMALL.some(p => c % BigInt(p) === 0n)) continue;
      if (millerRabin(c, 20)) return c;
    }
  }

  // Paire de clés RSA. onStatus(phase, count, candidat)
  // Seuls des premiers de 500 chiffres sont autorisés.
  async function genKeys(digits, onStatus) {
    if (digits !== PRIME_DIGITS) {
      throw new Error('Seuls les nombres premiers de ' + PRIME_DIGITS + ' chiffres sont autorisés');
    }
    const e = 65537n;
    let p, q, phi;
    do {
      p = await genPrime(digits, (n, c) => onStatus && onStatus('p', n, c));
      q = await genPrime(digits, (n, c) => onStatus && onStatus('q', n, c));
      phi = (p - 1n) * (q - 1n);
    } while (p === q || gcd(e, phi) !== 1n);
    return { p: p.toString(), q: q.toString(), n: (p * q).toString(), e: e.toString(), d: modinv(e, phi).toString() };
  }

  // ---------- Chiffrement par blocs ----------
  const blockSize = n => Math.floor((n.toString(2).length - 1) / 8) - 1;

  function encrypt(text, key) {
    const n = BigInt(key.n), e = BigInt(key.e), k = blockSize(n);
    const bytes = new TextEncoder().encode(text), out = [];
    for (let i = 0; i < bytes.length || i === 0; i += k) {
      let m = 1n; // préfixe 0x01 : conserve les octets nuls de tête
      for (const v of bytes.slice(i, i + k)) m = (m << 8n) | BigInt(v);
      out.push(modpow(m, e, n).toString());
    }
    return out;
  }

  function decrypt(blocks, key) {
    const n = BigInt(key.n), d = BigInt(key.d), res = [];
    for (const b of blocks) {
      let h = modpow(BigInt(b), d, n).toString(16);
      if (h.length % 2) h = '0' + h;
      const bytes = h.match(/../g) || [];
      if (bytes[0] !== '01') throw new Error('Bloc invalide ou mauvaise clé privée');
      res.push(...bytes.slice(1).map(v => parseInt(v, 16)));
    }
    return new TextDecoder().decode(new Uint8Array(res));
  }

  // ---------- Formats de sortie ----------
  function formatBlocks(blocks, fmt) {
    if (fmt === 'decimal') return blocks.join('\n');
    if (fmt === 'hex') return blocks.map(b => '0x' + BigInt(b).toString(16)).join('\n');
    return JSON.stringify({ version: 1, algo: 'RSA', blocks }, null, 2);
  }

  function parseBlocks(input) {
    const s = input.trim();
    if (!s) throw new Error('Aucun texte chiffré fourni');
    if (s[0] === '{' || s[0] === '[') {
      const j = JSON.parse(s), arr = Array.isArray(j) ? j : j.blocks;
      if (!Array.isArray(arr) || !arr.length) throw new Error('JSON sans blocs');
      return arr.map(String);
    }
    return s.split(/\s+/).map(t => {
      if (/^0x[0-9a-f]+$/i.test(t)) return BigInt(t).toString();
      if (/^\d+$/.test(t)) return t;
      throw new Error('Bloc non reconnu : ' + t.slice(0, 20));
    });
  }

  // ---------- Vérification d'un trousseau ----------
  function validateKeys(k) {
    const p = BigInt(k.p), q = BigInt(k.q), n = BigInt(k.n), e = BigInt(k.e), d = BigInt(k.d);
    return p * q === n && e * d % ((p - 1n) * (q - 1n)) === 1n;
  }

  // ---------- Factorisation par divisions d'essai (démonstration) ----------
  async function factorTrial(nStr, maxMs) {
    const n = BigInt(nStr), t0 = performance.now();
    if (n < 2n) return { factors: [], ms: 0, done: true };
    let m = n; const factors = [];
    let i = 2n, steps = 0;
    while (i * i <= m) {
      if (m % i === 0n) { factors.push(i); m /= i; } else i += i === 2n ? 1n : 2n;
      if (++steps % 200000 === 0) {
        await tick();
        if (performance.now() - t0 > maxMs) return { factors, rest: m, ms: performance.now() - t0, done: false };
      }
    }
    if (m > 1n) factors.push(m);
    return { factors, ms: performance.now() - t0, done: true };
  }

  window.Crypto500 = { genKeys, genPrime, isPrime, encrypt, decrypt, formatBlocks, parseBlocks, validateKeys, factorTrial, blockSize };
})();