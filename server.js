const express = require('express');
const cors = require('cors');
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// Sert index.html, style.css, crypto.js et app.js
app.use(express.static(__dirname));

const pubkeys = {};   // n -> { name, ip, e, n }
const inbox = {};     // n -> { id, blocks, at }
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
app.post('/send', (req, res) => {
  const { n, blocks } = req.body || {};
  if (!n || !Array.isArray(blocks) || !blocks.length) return res.status(400).json({ success: false });
  inbox[n] = { id: ++seq, blocks, at: Date.now() };
  res.json({ success: true, id: seq });
});

// Lecture de la boîte de la cible : /receive?n=...
app.get('/receive', (req, res) => {
  res.json(inbox[req.query.n] || { blocks: [] });
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Serveur de transmission actif sur le port 3000');
});