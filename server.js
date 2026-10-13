const express = require('express');
const cors = require('cors');
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// C' cette ligne qui permet de charger index.html, style.css et app.js
app.use(express.static(__dirname));

let latestMessage = null;

app.post('/send', (req, res) => {
  latestMessage = req.body;
  res.json({ success: true });
});

app.get('/receive', (req, res) => {
  res.json(latestMessage || { blocks: [] });
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Serveur de transmission actif sur le port 3000');
});