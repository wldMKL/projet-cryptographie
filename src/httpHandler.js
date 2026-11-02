/**
 * httpHandler.js — Serveur de fichiers statiques (dossier public/)
 * Gère HTML, CSS et JS avec protection anti path-traversal.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css',
  '.js'  : 'application/javascript',
  '.ico' : 'image/x-icon',
};

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 */
function httpHandler(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end();
    return;
  }

  // Ignore la query-string et résout le chemin
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const ext  = path.extname(urlPath).toLowerCase();
  const mime = MIME[ext];
  if (!mime) {
    res.writeHead(404);
    res.end('404 Not Found');
    return;
  }

  // Sécurité : interdit la remontée hors de public/
  const filePath = path.resolve(PUBLIC, '.' + urlPath);
  if (!filePath.startsWith(PUBLIC + path.sep) && filePath !== PUBLIC) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? '404 Not Found' : 'Erreur serveur');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(buf);
  });
}

module.exports = httpHandler;

