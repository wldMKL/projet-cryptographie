/**
 * store.js — État centralisé de l'application messagerie
 *
 * Toutes les variables partagées entre les modules passent par ici.
 * localStorage est encapsulé pour éviter les erreurs silencieuses
 * (mode privé, quota dépassé, etc.).
 */

// ── Stockage local (localStorage) ────────────────────────────────────────────

const LS = {
  get : k     => { try { return localStorage.getItem(k);     } catch { return null; } },
  set : (k,v) => { try { localStorage.setItem(k, v);         } catch {}              },
  del : k     => { try { localStorage.removeItem(k);          } catch {}              },
};

// ── État de l'application ────────────────────────────────────────────────────

export const store = {
  /** Pseudo de l'utilisateur connecté (@type {string|null}) */
  me   : null,
  /** Clés BigInt de l'utilisateur (@type {{ n:bigint, e:bigint, d:bigint }|null}) */
  K    : null,
  /** Liste des utilisateurs avec clés (@type {Array<{name:string,n:string,e:string,online:boolean}>}) */
  users: [],
  /** Messages reçus triés du plus récent au plus ancien (@type {any[]}) */
  inbox: [],
  /** Cache des messages déchiffrés { [msgId]: string } */
  plain: {},
};

// ── Session ───────────────────────────────────────────────────────────────────

/** Sauvegarde la session dans localStorage. */
export function saveSession(name, token) {
  LS.set('rsa_session', JSON.stringify({ name, token }));
}

/** Charge la session depuis localStorage, ou null si absente / corrompue. */
export function loadSession() {
  try { return JSON.parse(LS.get('rsa_session')); } catch { return null; }
}

/** Supprime la session (déconnexion). */
export function clearSession() {
  LS.del('rsa_session');
}

// ── Clés ──────────────────────────────────────────────────────────────────────

/** Sauvegarde les clés RSA (en string) de l'utilisateur dans localStorage. */
export function saveKeys(name, keysObj) {
  LS.set('rsa_k_' + name, JSON.stringify(keysObj));
}

/** Charge les clés RSA (en string) depuis localStorage, ou null. */
export function loadKeys(name) {
  try { return JSON.parse(LS.get('rsa_k_' + name)); } catch { return null; }
}

/** Réinitialise tout l'état (après déconnexion). */
export function resetStore() {
  store.me    = null;
  store.K     = null;
  store.users = [];
  store.inbox = [];
  store.plain = {};
}

