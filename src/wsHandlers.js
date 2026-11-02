/**
 * wsHandlers.js — Logique métier WebSocket
 *
 * Protocole (messages JSON) :
 *   Client → Serveur : register | login | logout | setkey | send
 *   Serveur → Client : registered | logged | users | inbox | msg | sent | error
 *
 * Le serveur ne reçoit jamais de clé privée ni de texte en clair.
 */
'use strict';

const crypto       = require('crypto');
const { db, save } = require('./db');

// Validation
const RE_NAME = /^[\w-]{2,20}$/;
const RE_NUM  = /^\d{1,2000}$/;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Envoie un objet JSON à un client WebSocket si la connexion est ouverte. */
const send = (ws, obj) =>
  ws.readyState === 1 && ws.send(JSON.stringify(obj));

/** Envoie une erreur structurée au client. */
const sendError = (ws, where, msg) =>
  send(ws, { t: 'error', where, msg });

/** Retourne tous les sockets associés à un pseudo. */
const socketsOf = (wss, name) =>
  [...wss.clients].filter(c => c.user === name);

/** Construit la liste des utilisateurs ayant publié leurs clés. */
function buildUserList(wss) {
  return Object.entries(db.users)
    .filter(([, u]) => u.n)
    .map(([name, u]) => ({
      name,
      n     : u.n,
      e     : u.e,
      online: socketsOf(wss, name).length > 0,
    }));
}

/** Diffuse la liste des utilisateurs à tous les clients connectés. */
function pushUsers(wss) {
  const list = buildUserList(wss);
  wss.clients.forEach(c => c.user && send(c, { t: 'users', list }));
}

/**
 * Finalise la connexion d'un utilisateur :
 * envoie le message de bienvenue, sa boîte de réception et met à jour
 * l'annuaire de tout le monde.
 */
function enter(ws, wss, name, welcomeMsg) {
  ws.user = name;
  send(ws, welcomeMsg);
  send(ws, {
    t   : 'inbox',
    msgs: db.messages.filter(m => m.to === name),
  });
  pushUsers(wss);
}

// ── Gestionnaire principal ────────────────────────────────────────────────────

/**
 * Traite un message brut reçu d'un client WebSocket.
 * @param {import('ws').WebSocket} ws
 * @param {import('ws').WebSocketServer} wss
 * @param {Buffer | string} raw
 */
function handleMessage(ws, wss, raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }

  // ── Inscription ────────────────────────────────────────────────────────────
  if (m.t === 'register') {
    if (typeof m.name !== 'string' || !RE_NAME.test(m.name))
      return sendError(ws, 'register', 'Pseudo invalide.');
    if (db.users[m.name]) {
      return send(ws, {
        t    : 'error',
        where: 'already_registered',
        name : m.name,
        msg  : 'Ce pseudo est déjà inscrit. Vous avez été redirigé vers l’onglet Connexion.'
      });
    }

    const token = crypto.randomBytes(16).toString('hex');
    db.users[m.name] = { token, createdAt: Date.now() };
    save();
    return enter(ws, wss, m.name, { t: 'registered', name: m.name, token });
  }

  // ── Connexion ─────────────────────────────────────────────────────────────
  if (m.t === 'login') {
    if (typeof m.name !== 'string' || !RE_NAME.test(m.name))
      return sendError(ws, 'login', 'Pseudo invalide.');
    const u = db.users[m.name];
    if (!u) {
      return sendError(ws, 'login', "Ce compte n'existe pas. Veuillez d'abord vous inscrire.");
    }
    return enter(ws, wss, m.name, { t: 'logged', name: m.name, token: u.token });
  }

  // ── Actions authentifiées uniquement ──────────────────────────────────────
  if (!ws.user) return;

  if (m.t === 'logout') {
    ws.user = null;
    pushUsers(wss);
    return;
  }

  // ── Publication de la clé publique ─────────────────────────────────────────
  if (m.t === 'setkey') {
    if (!RE_NUM.test(m.n) || !RE_NUM.test(m.e)) return;
    Object.assign(db.users[ws.user], { n: m.n, e: m.e });
    save();
    pushUsers(wss);
    return;
  }

  // ── Envoi d'un message chiffré ─────────────────────────────────────────────
  if (m.t === 'send') {
    const valid =
      typeof m.to === 'string'        &&
      db.users[m.to]                  &&
      m.to !== ws.user                &&
      Array.isArray(m.blocks)         &&
      m.blocks.length > 0             &&
      m.blocks.length <= 50           &&
      m.blocks.every(b => typeof b === 'string' && RE_NUM.test(b));

    if (!valid)
      return sendError(ws, 'send', 'Message refusé (destinataire ou format invalide).');

    const msg = {
      id    : crypto.randomUUID(),
      from  : ws.user,
      to    : m.to,
      t     : Date.now(),
      blocks: m.blocks,
    };

    db.messages.push(msg);
    if (db.messages.length > 5000) db.messages.shift(); // limite mémoire
    save();

    socketsOf(wss, m.to).forEach(c => send(c, { t: 'msg', m: msg }));
    send(ws, { t: 'sent', to: m.to, count: m.blocks.length });
  }
}

module.exports = { handleMessage, pushUsers };

