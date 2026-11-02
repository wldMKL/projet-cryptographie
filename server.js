/**
 * server.js — Point d'entrée du serveur
 *
 * Responsabilités :
 *   - Créer le serveur HTTP (fichiers statiques via httpHandler)
 *   - Créer le serveur WebSocket (logique via wsHandlers)
 *   - Afficher les adresses réseau au démarrage
 */
'use strict';

const http = require('http');
const os   = require('os');
const { WebSocketServer } = require('ws');

const httpHandler              = require('./src/httpHandler');
const { handleMessage, pushUsers } = require('./src/wsHandlers');

const PORT = process.env.PORT || 3000;

// ── Serveur HTTP ──────────────────────────────────────────────────────────────
const server = http.createServer(httpHandler);

// ── Serveur WebSocket ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, maxPayload: 2 * 1024 * 1024 });

wss.on('connection', ws => {
  ws.on('message', raw => handleMessage(ws, wss, raw));
  ws.on('close',   ()  => pushUsers(wss));
});

// ── Démarrage ─────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🔐 Serveur RSA lancé : http://localhost:${PORT}`);
  for (const ifaces of Object.values(os.networkInterfaces()))
    for (const iface of ifaces)
      if (iface.family === 'IPv4' && !iface.internal)
        console.log(`   Réseau local      : http://${iface.address}:${PORT}`);
  console.log('');
});
