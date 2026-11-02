/**
 * ui.js — Toutes les mises à jour du DOM
 *
 * Ce module ne contient aucune logique métier.
 * Il lit `store` en lecture seule et expose des fonctions de rendu.
 */

import { store }        from './store.js';
import { dechiffrer }   from './crypto.js';

// ── Sélecteur raccourci ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Bandeau d'avertissement global ────────────────────────────────────────────

/** Affiche ou masque le bandeau d'alerte en haut de page. */
export function showWarn(text) {
  const el = $('warn');
  el.hidden  = !text;
  el.textContent = text || '';
}

// ── Textes de statut ──────────────────────────────────────────────────────────

/** Met à jour le texte d'un élément de statut. */
export function setStatus(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

// ── Vues principales ──────────────────────────────────────────────────────────

/** Passe à la vue "application" (masque le formulaire d'inscription). */
export function showApp(name) {
  // Nom complet
  $('me').textContent = name;
  // Initiale dans l'avatar circulaire
  $('avatar').textContent = name.charAt(0).toUpperCase();
  $('reg').hidden = true;
  $('app').hidden = false;
}

/** Passe à la vue "inscription" (masque l'application). */
export function showLogin() {
  $('app').hidden = true;
  $('reg').hidden = false;
  $('rst').textContent = '';
}

// ── Panneau des clés ──────────────────────────────────────────────────────────

/**
 * Remplit les textareas des clés RSA.
 * @param {object|null} o  Objet { n, e, d, p, q, phi } en string, ou null pour vider.
 */
export function fillKeys(o) {
  const set = (id, val) => { $(id).value = val || ''; };
  set('kn', o?.n);
  set('ke', o?.e);
  set('kd', o?.d);
  set('kp', o?.p);
  set('kq', o?.q);
  set('kf', o?.phi);
  $('cn').textContent = o ? `(${o.n.length} chiffres)` : '';
  $('cd').textContent = o ? `(${o.d.length} chiffres)` : '';
}

// ── Liste des destinataires ───────────────────────────────────────────────────

/** Met à jour le <select> des destinataires à partir de store.users. */
export function drawUsers() {
  const sel = $('to');
  const cur = sel.value;
  sel.textContent = '';

  const others = store.users
    .filter(u => u.name !== store.me)
    .sort((a, b) => a.name.localeCompare(b.name));

  others.forEach(u =>
    sel.add(new Option(`${u.name}${u.online ? ' (en ligne)' : ''}`, u.name))
  );

  if (cur) sel.value = cur;

  const hasRecipient = others.length > 0;
  $('snd').disabled = !hasRecipient;

  if (!hasRecipient)
    sel.add(new Option("Aucun autre utilisateur avec clés pour l'instant", ''));
}

// ── Boîte de réception ────────────────────────────────────────────────────────

/** Reconstruit l'affichage de la boîte de réception à partir de store.inbox. */
export function drawInbox() {
  const box = $('inbox');
  box.textContent = '';

  if (!store.inbox.length) {
    const empty = document.createElement('span');
    empty.className   = 'st';
    empty.textContent = 'Aucun message reçu.';
    box.append(empty);
    return;
  }

  for (const m of store.inbox) {
    const wrap   = document.createElement('div');
    wrap.className = 'mi';

    // En-tête : expéditeur + date + bouton déchiffrer
    const header = document.createElement('div');
    header.className = 'h';

    const info = document.createElement('span');
    info.textContent = `De ${m.from} · ${new Date(m.t).toLocaleString('fr-FR')} · ${m.blocks.length} bloc(s)`;

    const btn = document.createElement('button');
    btn.className = 's';
    btn.textContent = 'Déchiffrer';
    btn.addEventListener('click', () => _decryptMessage(m));

    header.append(info, btn);
    wrap.append(header);

    // Corps déchiffré (si disponible)
    if (m.id in store.plain) {
      const body = document.createElement('div');
      body.className   = 'p';
      body.textContent = store.plain[m.id];
      wrap.append(body);
    }

    box.append(wrap);
  }
}

/** Déchiffre un message et met à jour l'affichage. */
function _decryptMessage(m) {
  try {
    if (!store.K) throw new Error("Génère d'abord tes clés (carte 1).");
    store.plain[m.id] = dechiffrer(m.blocks, store.K);
  } catch (err) {
    store.plain[m.id] = 'Déchiffrement impossible : ' + err.message;
  }
  drawInbox();
}

