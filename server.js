const express = require('express');
const cors = require('cors');
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// Sert index.html, style.css, crypto.js et app.js
app.use(express.static(__dirname));

const pubkeys = {};   // n -> { name, ip, e, n }
const inbox = {};     // n -> { id, blocks, at }
const journal = [];   // journal partagé, plus récent en premier
let seq = 0;

// Une cible publie sa clé publique (e, n)
app.post('/pubkey', (req, res) => {
  const { name, ip, e, n } = req.body || {};
  if (!n || !e) return res.status(400).json({ success: false });
  pubkeys[n] = { name, ip, e, n };
  res.json({ success: true });
});

// Liste des clés publiques connues
app.get('/pubkeys', (req, res) => res.json(Object.values(pubkeys)));

// Dépôt d'un message chiffré dans la boîte de la cible (identifiée par n)
// + écriture d'une ligne dans le journal commun
app.post('/send', (req, res) => {
  const { n, blocks, name, ip } = req.body || {};
  if (!n || !Array.isArray(blocks) || !blocks.length) return res.status(400).json({ success: false });
  const id = Date.now() + '-' + (++seq);
  inbox[n] = { id, blocks, at: Date.now() };

  journal.unshift({
    id,
    at: Date.now(),
    target: name || 'Inconnu',
    ip: ip || '',
    preview: String(blocks[0]).slice(0, 24) + '…',   // début du chiffré, jamais le clair
    size: blocks.reduce((s, b) => s + String(b).length, 0) + ' chiffres',
    status: 'Livré'
  });
  if (journal.length > 200) journal.pop();

  res.json({ success: true, id });
});

// Lecture de la boîte de la cible : /receive?n=...
app.get('/receive', (req, res) => {
  res.json(inbox[req.query.n] || { blocks: [] });
});

// Journal partagé : lu par tous les PC
app.get('/journal', (req, res) => res.json(journal));

// La cible a déchiffré : le statut change pour tout le monde
app.post('/ack', (req, res) => {
  const e = journal.find(x => x.id === (req.body || {}).id);
  if (e) e.status = 'Déchiffré';
  res.json({ success: !!e });
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Serveur de transmission actif sur le port 3000');
});