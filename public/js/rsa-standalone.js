/**
 * rsa-standalone.js — Point d'entrée de rsa.html (démo locale, sans serveur)
 *
 * Permet à Alice (PC 1) et Bruno (PC 2) de :
 *   1. Générer les clés RSA (Alice)
 *   2. Copier la clé publique (Alice → Bruno)
 *   3. Chiffrer un message avec la clé publique d'Alice (Bruno)
 *   4. Copier le message chiffré (Bruno → Alice)
 *   5. Déchiffrer avec la clé privée (Alice)
 */

import {
  euclideEtendu, clePrivee, genPremier,
  chiffrer, dechiffrer, blocSize,
} from './crypto.js';

const $ = id => document.getElementById(id);

/** Clés de la session courante. Reste dans ce navigateur, ne part jamais. */
let K = null;

// ── Génération des clés ───────────────────────────────────────────────────────

$('gen').addEventListener('click', async () => {
  const digits = +$('dig').value;
  const btn    = $('gen');
  btn.disabled = true;
  ['cpk', 'cpc', 'snd'].forEach(id => ($(id).disabled = true));
  $('ok').hidden = true;

  const t0 = performance.now();

  try {
    // Génère p
    $('gst').textContent = 'Recherche de p…';
    const p = await genPremier(digits, t => ($('gst').textContent = `Recherche de p… (${t} candidats)`));

    // Génère q ≠ p
    let q;
    do {
      $('gst').textContent = 'Recherche de q…';
      q = await genPremier(digits, t => ($('gst').textContent = `Recherche de q… (${t} candidats)`));
    } while (q === p);

    // n, φ(n), e, d
    const n   = p * q;
    const phi = (p - 1n) * (q - 1n);
    let   e   = 65537n;
    while (euclideEtendu(e, phi)[0] !== 1n) e += 2n;
    const d = clePrivee(e, phi);
    K = { n, e, d };

    // Affichage
    $('kp').value = `${p}`;
    $('kq').value = `${q}`;
    $('kn').value = `${n}`;
    $('kf').value = `${phi}`;
    $('ke').value = `${e}`;
    $('kd').value = `${d}`;
    $('cn').textContent = `(${(`${n}`).length} chiffres)`;
    $('cd').textContent = `(${(`${d}`).length} chiffres)`;

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    $('gst').textContent = `Clés prêtes en ${elapsed} s. p et q ont ${(`${p}`).length} chiffres.`;

    $('cpk').disabled = false;
    $('pk').value     = `${n}:${e}`;

  } catch (err) {
    $('gst').textContent = 'Erreur : ' + err.message;
  }

  btn.disabled = false;
});

// ── Chiffrement ───────────────────────────────────────────────────────────────

$('enc').addEventListener('click', () => {
  let N, E;
  try {
    [N, E] = $('pk').value.trim().split(':').map(s => BigInt(s.trim()));
    if (!N || !E) throw new Error('format invalide');
  } catch {
    $('est').textContent = 'Clé publique invalide (format n:e).';
    return;
  }

  const blocs = chiffrer($('msg').value, N, E);
  $('cip').value = blocs.join('\n');

  const B = blocSize(N);
  $('est').textContent = `${blocs.length} bloc(s) de ${B} octets max`;
  $('snd').disabled = $('cpc').disabled = !blocs.length;
});

// ── Transfert local (même PC) ─────────────────────────────────────────────────

$('snd').addEventListener('click', () => {
  $('rec').value  = $('cip').value;
  $('dec').disabled = false;
  $('out').value  = '';
  $('ok').hidden  = true;
  $('rec').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// ── Presse-papiers ────────────────────────────────────────────────────────────

async function copyToClipboard(sourceEl, btn, successMsg) {
  try {
    await navigator.clipboard.writeText(sourceEl.value);
    btn.textContent = successMsg;
  } catch {
    sourceEl.select(); // fallback
  }
}

$('cpk').addEventListener('click', ev => copyToClipboard($('pk'),  ev.target, 'Clé copiée ✓'));
$('cpc').addEventListener('click', ev => copyToClipboard($('cip'), ev.target, 'Message copié ✓'));

// ── Déchiffrement ─────────────────────────────────────────────────────────────

$('dec').addEventListener('click', () => {
  if (!K) {
    $('out').value = "Génère d'abord tes clés (carte 1) sur ce PC : la clé privée d est nécessaire.";
    return;
  }
  try {
    const blocs = $('rec').value.split('\n').filter(Boolean).map(l => l.trim());
    const text  = dechiffrer(blocs, K);
    $('out').value  = text;
    $('ok').hidden  = (text !== $('msg').value);
  } catch (err) {
    $('out').value = 'Déchiffrement impossible : ' + err.message;
  }
});

