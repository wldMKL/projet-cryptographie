/**
 * app.js — Point d'entrée de index.html (messagerie temps réel)
 *
 * Orchestre les interactions utilisateur :
 *   inscription → génération des clés → envoi de messages chiffrés
 */

import { store, saveKeys }              from './store.js';
import { genPremier, euclideEtendu, clePrivee, chiffrer } from './crypto.js';
import { send, connect, disconnect }    from './ws-client.js';
import { setStatus, fillKeys }          from './ui.js';

const $ = id => document.getElementById(id);

// ── Inscription / Connexion ──────────────────────────────────────────────────

let authMode = 'register'; // 'register' | 'login'

function setAuthMode(mode) {
  authMode = mode;
  const isReg = mode === 'register';

  $('tab-reg-btn').classList.toggle('active', isReg);
  $('tab-login-btn').classList.toggle('active', !isReg);

  $('auth-title').innerHTML = isReg
    ? '<span class="n">0</span>Inscription'
    : '<span class="n">0</span>Connexion';

  $('auth-desc').textContent = isReg
    ? "Choisis un pseudo pour rejoindre l'annuaire"
    : "Entre ton pseudo pour accéder à ta messagerie";

  $('go').textContent = isReg ? "S'inscrire" : "Se connecter";

  $('auth-switch').innerHTML = isReg
    ? '<span>Déjà un compte ? </span><a href="#" id="link-switch">Se connecter</a>'
    : '<span>Pas encore de compte ? </span><a href="#" id="link-switch">S\'inscrire</a>';

  const link = $('link-switch');
  if (link) {
    link.addEventListener('click', e => {
      e.preventDefault();
      setAuthMode(isReg ? 'login' : 'register');
    });
  }

  $('rst').textContent = '';
  $('go').disabled = !$('pseudo').value.trim();
}

$('tab-reg-btn').addEventListener('click', () => setAuthMode('register'));
$('tab-login-btn').addEventListener('click', () => setAuthMode('login'));

const linkInit = $('link-switch');
if (linkInit) {
  linkInit.addEventListener('click', e => {
    e.preventDefault();
    setAuthMode('login');
  });
}

// Redirection automatique si le pseudo existe déjà
window.onAlreadyRegistered = (name, msg) => {
  setAuthMode('login');
  $('pseudo').value = name;
  $('go').disabled = false;
  setStatus('rst', msg);
};

$('pseudo').addEventListener('input', () => {
  $('go').disabled = !$('pseudo').value.trim();
});

$('go').addEventListener('click', () => {
  const name = $('pseudo').value.trim();
  const RE   = /^[\w-]{2,20}$/;
  if (!RE.test(name)) {
    setStatus('rst', 'Pseudo : 2 à 20 caractères (lettres, chiffres, - ou _).');
    return;
  }
  send({ t: authMode, name });
});

// ── Déconnexion ───────────────────────────────────────────────────────────────

$('bye').addEventListener('click', disconnect);

// ── Génération des clés RSA ───────────────────────────────────────────────────

const DIGITS = 500; // nombres premiers de 500 chiffres (objectif du cours)

$('gen').addEventListener('click', async () => {
  const btn = $('gen');
  btn.disabled = true;
  const t0 = performance.now();

  try {
    // Génère p
    setStatus('gst', 'Recherche de p…');
    const p = await genPremier(
      DIGITS,
      t => setStatus('gst', `Recherche de p… (${t} candidats)`)
    );

    // Génère q ≠ p
    let q;
    do {
      setStatus('gst', 'Recherche de q…');
      q = await genPremier(
        DIGITS,
        t => setStatus('gst', `Recherche de q… (${t} candidats)`)
      );
    } while (q === p);

    // Calcule n, φ(n), e, d
    const n   = p * q;
    const phi = (p - 1n) * (q - 1n);
    let   e   = 65537n;
    while (euclideEtendu(e, phi)[0] !== 1n) e += 2n; // pgcd(e, φ) = 1
    const d = clePrivee(e, phi);                       // d·e ≡ 1 (mod φ)

    // Sérialise en string (BigInt → JSON)
    const keysObj = { n: `${n}`, e: `${e}`, d: `${d}`, p: `${p}`, q: `${q}`, phi: `${phi}` };
    store.K = { n, e, d };
    saveKeys(store.me, keysObj);
    fillKeys(keysObj);

    // Publie la clé publique sur le serveur (jamais d ni p ni q)
    send({ t: 'setkey', n: keysObj.n, e: keysObj.e });

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    setStatus('gst', `Clés prêtes en ${elapsed} s. Clé publique publiée.`);

  } catch (err) {
    setStatus('gst', 'Erreur : ' + (err.message || err));
  }

  btn.disabled = false;
});

// ── Envoi d'un message chiffré ────────────────────────────────────────────────

$('snd').addEventListener('click', () => {
  const to        = $('to').value;
  const recipient = store.users.find(u => u.name === to);

  if (!recipient) {
    setStatus('sst', 'Choisis un destinataire.');
    return;
  }

  try {
    // x = mᵉ mod n (chiffrement RSA)
    const blocs = chiffrer($('msg').value, BigInt(recipient.n), BigInt(recipient.e));
    $('cip').value = blocs.join('\n');
    send({ t: 'send', to, blocks: blocs });
  } catch (err) {
    setStatus('sst', 'Erreur : ' + err.message);
  }
});

// ── Démarrage ─────────────────────────────────────────────────────────────────
connect();

