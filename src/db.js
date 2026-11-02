/**
 * db.js — Persistance JSON (lecture / écriture asynchrone différée)
 * Le serveur ne stocke jamais les clés privées ni les messages en clair.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data.json');

/** @type {{ users: Record<string, any>, messages: any[] }} */
let db = { users: {}, messages: [] };

try {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch {
  // Pas de fichier existant — on part d'une base vide.
}

let _timer;

/** Persiste la base sur disque avec un délai de grâce de 300 ms. */
function save() {
  clearTimeout(_timer);
  _timer = setTimeout(() => {
    fs.writeFile(FILE, JSON.stringify(db), err => {
      if (err) console.error('[db] Erreur écriture :', err.message);
    });
  }, 300);
}

module.exports = { db, save };

