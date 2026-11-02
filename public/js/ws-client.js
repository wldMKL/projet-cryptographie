/**
 * ws-client.js — Connexion WebSocket et dispatch des messages serveur
 *
 * Ce module gère :
 *   - La connexion / reconnexion automatique
 *   - L'envoi de messages au serveur
 *   - Le routage des messages reçus vers les bons handlers UI
 */

import { store, saveSession, loadSession, clearSession, loadKeys, resetStore } from './store.js';
import { showWarn, setStatus, showApp, showLogin, fillKeys, drawUsers, drawInbox } from './ui.js';

/** @type {WebSocket|null} */
let _ws = null;

// ── Envoi ─────────────────────────────────────────────────────────────────────

/**
 * Envoie un objet JSON au serveur si la connexion est ouverte.
 * @param {object} obj
 */
export function send(obj) {
  if (_ws && _ws.readyState === WebSocket.OPEN)
    _ws.send(JSON.stringify(obj));
}

// ── Réception ─────────────────────────────────────────────────────────────────

/** Dispatch les messages reçus du serveur. */
function _handleServerMessage(msg) {
  switch (msg.t) {

    case 'registered':
      saveSession(msg.name, msg.token);
      _loginUser(msg.name);
      break;

    case 'logged':
      if (msg.token) saveSession(msg.name, msg.token);
      _loginUser(msg.name);
      break;

    case 'users':
      store.users = msg.list;
      drawUsers();
      break;

    case 'inbox':
      store.inbox = msg.msgs.sort((a, b) => b.t - a.t);
      drawInbox();
      break;

    case 'msg':
      store.inbox.unshift(msg.m);
      drawInbox();
      break;

    case 'sent':
      setStatus('sst', `Envoyé à ${msg.to} (${msg.count} bloc(s)).`);
      break;

    case 'error':
      if (msg.where === 'login') clearSession();
      if (msg.where === 'already_registered' && window.onAlreadyRegistered) {
        window.onAlreadyRegistered(msg.name, msg.msg);
        return;
      }
      setStatus(msg.where === 'send' ? 'sst' : 'rst', msg.msg);
      break;
  }
}

// ── Login local ───────────────────────────────────────────────────────────────

/** Met à jour l'état local et l'UI après authentification. */
function _loginUser(name) {
  if (store.me === name) return;
  store.me = name;
  showApp(name);

  const raw = loadKeys(name);
  store.K   = raw ? { n: BigInt(raw.n), e: BigInt(raw.e), d: BigInt(raw.d) } : null;
  fillKeys(raw);

  setStatus('gst', raw
    ? 'Clés prêtes.'
    : "Pas encore de clés : clique sur « Générer mes clés »."
  );

  if (raw) send({ t: 'setkey', n: raw.n, e: raw.e });
}

// ── Connexion / Reconnexion ───────────────────────────────────────────────────

/** Ouvre la connexion WebSocket et configure les callbacks. */
export function connect() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  _ws = new WebSocket(proto + location.host);

  _ws.onopen = () => {
    showWarn('');
    // Active le bouton seulement si un pseudo est déjà saisi
    const pseudoEl = document.getElementById('pseudo');
    document.getElementById('go').disabled = !pseudoEl.value.trim();
    document.getElementById('rst').textContent = '';
    const session = loadSession();
    if (session) send({ t: 'login', name: session.name, token: session.token });
  };

  _ws.onclose = () => {
    document.getElementById('go').disabled = true;
    showWarn('Connexion au serveur perdue. Nouvelle tentative…');
    setTimeout(connect, 2000);
  };

  _ws.onmessage = ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    _handleServerMessage(msg);
  };
}

// ── Déconnexion ───────────────────────────────────────────────────────────────

/** Déconnecte l'utilisateur côté client et serveur. */
export function disconnect() {
  clearSession();
  send({ t: 'logout' });
  resetStore();
  showLogin();
}

