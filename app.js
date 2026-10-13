/* CRYPTO-500 : logique de l'interface */
(function () {
  const C = window.Crypto500;
  const $ = id => document.getElementById(id);
  const icons = () => { try { window.lucide && lucide.createIcons(); } catch (e) {} };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const short = (s, n = 220) => (s.length > n ? s.slice(0, n) + '… (' + s.length + ' chiffres)' : s);

  const IP_RE = /^(\d{1,3}\.){3}\d{1,3}(:\d{1,5})?$/;
  const recipients = [];    // { name, ip, keys, initial }
  let cur = null;           // destinataire sélectionné
  let keys = null;          // trousseau du destinataire courant
  let revealD = false;      // clé privée affichée dans l'onglet Clés
  let cipher = null;        // blocs chiffrés par Alice
  let sentText = '';        // message en clair envoyé (vérification)
  let delivered = false;

  // ---------- Outils ----------
  function setBtn(btn, icon, text) { btn.innerHTML = '<i data-lucide="' + icon + '"></i> ' + text; icons(); }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = t; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      ta.remove();
    }
  }

  function flash(btn) {
    btn.style.color = 'var(--green)';
    setTimeout(() => (btn.style.color = ''), 900);
  }

  function logEve(text, cls) {
    const d = document.createElement('div');
    d.className = 'terminal-line ' + (cls || 'info');
    d.textContent = text;
    $('eve-terminal-log').append(d);
    $('eve-terminal-log').scrollTop = 1e9;
  }

  // ---------- Fond animé ----------
  (function bg() {
    const cv = $('bg-canvas'), ctx = cv.getContext('2d');
    let pts = [];
    const size = () => { cv.width = innerWidth; cv.height = innerHeight; };
    size(); addEventListener('resize', size);
    for (let i = 0; i < 60; i++) pts.push({ x: Math.random() * cv.width, y: Math.random() * cv.height, vx: (Math.random() - .5) * .4, vy: (Math.random() - .5) * .4 });
    (function draw() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of pts) {
        p.x = (p.x + p.vx + cv.width) % cv.width; p.y = (p.y + p.vy + cv.height) % cv.height;
        ctx.fillStyle = 'rgba(56,189,248,.8)'; ctx.fillRect(p.x, p.y, 2, 2);
      }
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d = dx * dx + dy * dy;
        if (d < 14000) { ctx.strokeStyle = 'rgba(56,189,248,' + (0.25 * (1 - d / 14000)) + ')'; ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke(); }
      }
      requestAnimationFrame(draw);
    })();
  })();

  // ---------- Onglets ----------
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === b.dataset.tab));
  }));

  // ---------- Affichage des clés ----------
  function showKeys() {
    $('display-p-val').textContent = keys.p;
    $('display-q-val').textContent = keys.q;
    $('display-n-val').textContent = keys.n;
    $('display-e-val').textContent = keys.e;
    $('trans-bob-pubkey-e').textContent = keys.e;
    $('trans-bob-pubkey-n').textContent = keys.n;
    $('badge-p-digits').textContent = keys.p.length + ' chiffres';
    $('badge-q-digits').textContent = keys.q.length + ' chiffres';
    $('badge-n-digits').textContent = keys.n.length + ' chiffres (~' + BigInt(keys.n).toString(2).length + ' bits)';
    $('badge-d-digits').textContent = '~' + keys.d.length + ' chiffres';
    renderD();
    updateCounts();
  }

  function renderD() {
    const el = $('display-d-val');
    el.textContent = revealD ? keys.d : '••••••••••••••••••••••••••••••••';
    el.classList.toggle('masked-secret', !revealD);
    setBtn($('btn-toggle-key-d-vis'), revealD ? 'eye-off' : 'eye', revealD ? 'Masquer' : 'Démasquer');
  }

  $('btn-toggle-key-d-vis').onclick = () => { if (keys) { revealD = !revealD; renderD(); } };

  document.querySelectorAll('[data-copy-target]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.copyTarget, el = $(id);
    const txt = id === 'display-d-val' ? keys.d : ('value' in el && el.tagName === 'TEXTAREA' ? el.value : el.textContent);
    if (txt) { await copyText(txt); flash(btn); }
  }));

  $('btn-copy-trans-pubkey').onclick = async e => {
    await copyText('e=' + keys.e + '\nn=' + keys.n); flash(e.currentTarget);
  };

  // ---------- Génération (modale) ----------
  async function genWithModal(digits) {
    const modal = $('gen-modal'), fill = $('gen-modal-progress');
    modal.classList.add('active');
    $('gen-modal-status').textContent = 'Recherche de p (' + digits + ' chiffres)...';
    fill.style.width = '2%';
    try {
      const k = await C.genKeys(digits, (phase, count, cand) => {
        const done = 1 - Math.exp(-count / (1.15 * digits));
        fill.style.width = ((phase === 'p' ? 0 : 50) + 48 * done) + '%';
        $('gen-modal-status').textContent = 'Recherche de ' + phase + ' : ' + count + ' candidats testés...';
        $('gen-modal-current-candidate').textContent = short(cand.toString(), 160);
      });
      fill.style.width = '100%';
      await wait(250);
      return k;
    } finally { modal.classList.remove('active'); }
  }

  function setKeys(k) { keys = k; cur.keys = k; revealD = false; showKeys(); resetTransmission(); }
  async function generate(digits) { setKeys(await genWithModal(digits)); }

  // ---------- Destinataires ----------
  function renderRecipient() {
    const sel = $('recipient-select');
    sel.replaceChildren(...recipients.map((r, i) => {
      const o = document.createElement('option'); o.value = i; o.textContent = r.name + ' (' + r.ip + ')'; return o;
    }));
    sel.value = recipients.indexOf(cur);
    $('bob-name').textContent = cur.name;
    $('pubkey-owner').textContent = 'Clé publique de ' + cur.name + ' (e, n)';
    $('keys-owner').textContent = cur.name;
    setIp(cur.ip);
  }

  function selectRecipient(i) {
    cur = recipients[i]; keys = cur.keys; revealD = false;
    renderRecipient(); showKeys(); resetTransmission();
  }

  $('recipient-select').onchange = e => selectRecipient(+e.target.value);
  $('btn-new-recipient').onclick = () => { $('recipient-form').classList.toggle('hidden'); $('recipient-name').focus(); };
  $('btn-cancel-recipient').onclick = () => { $('recipient-form').classList.add('hidden'); $('recipient-error').textContent = ''; };

  $('btn-create-recipient').onclick = async () => {
    const name = $('recipient-name').value.trim(), ip = $('recipient-ip').value.trim(), err = $('recipient-error');
    err.textContent = '';
    if (!name) { err.textContent = 'Donne un nom au destinataire.'; return; }
    if (recipients.some(r => r.name.toLowerCase() === name.toLowerCase())) { err.textContent = 'Ce nom existe déjà.'; return; }
    if (!IP_RE.test(ip)) { err.textContent = 'Adresse IP invalide (ex. 192.168.1.50:8080).'; return; }
    const btn = $('btn-create-recipient'); btn.disabled = true;
    const k = await genWithModal(parseInt($('recipient-digits').value, 10));
    recipients.push({ name, ip, keys: k, initial: { ...k } });
    $('recipient-name').value = '';
    $('recipient-form').classList.add('hidden');
    btn.disabled = false;
    selectRecipient(recipients.length - 1);
  };

  $('btn-generate-keys').onclick = async () => {
    const b = $('btn-generate-keys'); b.disabled = true;
    await generate(parseInt($('select-prime-digits').value, 10));
    b.disabled = false;
  };

  $('btn-restore-preset-keys').onclick = () => {
    if (!cur) return;
    setKeys({ ...cur.initial });
  };

  $('btn-export-keys').onclick = () => {
    if (!keys) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, ...keys }, null, 2)], { type: 'application/json' }));
    a.download = 'trousseau-rsa.json'; a.click(); URL.revokeObjectURL(a.href);
  };

  $('btn-import-keys').onclick = () => $('file-import-keys').click();
  $('file-import-keys').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const k = JSON.parse(await f.text());
      if (!C.validateKeys(k)) throw new Error('Trousseau incohérent');
      setKeys({ p: String(k.p), q: String(k.q), n: String(k.n), e: String(k.e), d: String(k.d) });
    } catch (err) { alert('Import impossible : ' + err.message); }
  };

  // ---------- Adresse IP ----------
  function setIp(v) {
    $('target-ip-input').value = v;
    const ok = IP_RE.test(v.trim());
    const b = $('target-ip-badge');
    b.className = 'badge ' + (ok ? 'badge-green' : 'badge-rose');
    b.textContent = ok ? 'IP prête' : 'IP invalide';
    ['channel-dest-ip', 'eve-dest-ip-tag', 'bob-listen-ip-badge'].forEach(id => ($(id).textContent = v.trim() || '—'));
    document.querySelectorAll('.chip[data-ip]').forEach(c => c.classList.toggle('active', c.dataset.ip === v.trim()));
  }
  $('target-ip-input').addEventListener('input', e => setIp(e.target.value));
  document.querySelectorAll('.chip[data-ip]').forEach(c => c.addEventListener('click', () => setIp(c.dataset.ip)));

  // ---------- Clé publique : afficher / masquer ----------
  document.querySelectorAll('[data-choice]').forEach(b => b.addEventListener('click', () => {
    const yes = b.dataset.choice === 'yes';
    $('btn-pubkey-opt-yes').classList.toggle('active', yes);
    $('btn-pubkey-opt-no').classList.toggle('active', !yes);
    $('pubkey-visible-panel').classList.toggle('visible', yes);
    $('pubkey-visible-panel').classList.toggle('hidden', !yes);
    $('pubkey-hidden-panel').classList.toggle('hidden', yes);
    $('pubkey-hidden-panel').classList.toggle('visible', !yes);
  }));

  // ---------- Message d'Alice ----------
  function updateCounts() {
    const t = $('alice-message-input').value, bytes = new TextEncoder().encode(t).length;
    $('alice-char-count').textContent = t.length + ' caractère' + (t.length > 1 ? 's' : '');
    if (keys) {
      const k = C.blockSize(BigInt(keys.n)), nb = Math.max(1, Math.ceil(bytes / k));
      $('alice-block-count').textContent = nb + ' bloc' + (nb > 1 ? 's' : '') + ' RSA de ' + keys.n.length + ' chiffres';
    }
  }
  $('alice-message-input').addEventListener('input', updateCounts);
  document.querySelectorAll('.preset-chip').forEach(c => c.addEventListener('click', () => {
    $('alice-message-input').value = c.dataset.text; updateCounts();
  }));

  // ---------- Transmission Alice -> Ève -> Bob ----------
  async function encryptAlice() {
    const text = $('alice-message-input').value;
    if (!text.trim() || !keys) return false;
    $('btn-encrypt-alice').disabled = true;
    await wait(30);
    sentText = text;
    cipher = C.encrypt(text, keys);
    const box = $('alice-ciphertext-preview');
    box.classList.remove('hidden');
    box.textContent = 'C = Mᵉ mod n (' + cipher.length + ' bloc' + (cipher.length > 1 ? 's' : '') + ')\n' + short(cipher[0], 300);
    $('btn-transmit').disabled = false;
    $('btn-encrypt-alice').disabled = false;
    return true;
  }

  async function transmit() {
    if (!cipher) return;
    $('btn-transmit').disabled = true;
    const ip = $('target-ip-input').value.trim();
    const dispatch = $('alice-dispatch-status');
    dispatch.classList.remove('hidden');
    $('alice-dispatch-text').textContent = 'Envoi du paquet chiffré vers ' + ip + '...';
    $('channel-status-label').textContent = 'Transmission en cours';
    const pk = $('wire-packet'); pk.classList.add('active');
    await wait(1500);
    pk.classList.remove('active');
    $('channel-status-label').textContent = 'Paquet livré';
    $('alice-dispatch-text').textContent = 'Paquet chiffré livré à ' + ip;

    const preview = cipher.length + ' bloc(s)\n' + short(cipher[0], 300);
    $('eve-captured-data').textContent = preview;
    $('eve-status-badge').textContent = 'Paquet intercepté';
    $('btn-eve-attack').disabled = false;
    logEve('[ÈVE] Paquet intercepté (' + cipher.length + ' bloc(s)). Illisible sans la clé privée d.', 'warn');

    $('bob-received-cipher').textContent = preview;
    $('btn-decrypt-bob').disabled = false;
    delivered = true;

    const tb = $('history-table-body'), tr = document.createElement('tr');
    const cells = [new Date().toLocaleTimeString('fr-FR'), sentText.slice(0, 40) + (sentText.length > 40 ? '…' : ''),
      cipher.reduce((s, b) => s + b.length, 0) + ' chiffres', ip, 'Livré'];
    cells.forEach((c, i) => {
      const td = document.createElement('td');
      if (i === 1) { const code = document.createElement('code'); code.textContent = c; td.append(code); }
      else if (i >= 3) { const s = document.createElement('span'); s.className = 'badge ' + (i === 3 ? 'badge-purple' : 'badge-green'); s.textContent = c; td.append(s); }
      else td.textContent = c;
      tr.append(td);
    });
    tb.prepend(tr);
  }

  $('btn-encrypt-alice').onclick = encryptAlice;
  $('btn-transmit').onclick = transmit;
  $('btn-encrypt-and-transmit').onclick = async () => {
    const b = $('btn-encrypt-and-transmit'); b.disabled = true;
    if (await encryptAlice()) await transmit();
    b.disabled = false;
  };

  // Attaque d'Ève (simulation pédagogique)
  $('btn-eve-attack').onclick = async () => {
    const btn = $('btn-eve-attack'); btn.disabled = true;
    const digits = keys.n.length, lnN = digits * Math.LN10;
    const log10ops = 1.923 * Math.cbrt(lnN) * Math.pow(Math.log(lnN), 2 / 3) / Math.LN10;
    const years = Math.pow(10, log10ops - 18) / 3.15e7;
    logEve('[ÈVE] Objectif : factoriser n (' + digits + ' chiffres) pour retrouver p, q puis d.');
    await wait(700);
    logEve('[ÈVE] Divisions d\'essai jusqu\'à 10⁶ ... aucun facteur trouvé.', 'warn');
    await wait(900);
    logEve('[ÈVE] Lancement du crible GNFS. Estimation : ≈ 10^' + log10ops.toFixed(0) + ' opérations.');
    await wait(900);
    logEve('[ÈVE] À 10¹⁸ opérations/s : ≈ 10^' + Math.log10(years).toFixed(1) + ' ans de calcul.', 'warn');
    await wait(700);
    logEve('[ÈVE] ÉCHEC : impossible de retrouver la clé privée en un temps réaliste.', 'error');
    $('eve-status-badge').textContent = 'Attaque échouée';
  };

  // Déchiffrement de Bob
  $('btn-decrypt-bob').onclick = async () => {
    if (!delivered) return;
    const out = $('bob-decrypted-output');
    out.textContent = 'Déchiffrement en cours...';
    await wait(40);
    try {
      const text = C.decrypt(cipher, keys);
      out.textContent = text;
      $('bob-verified-badge').classList.toggle('hidden', text !== sentText);
      icons();
    } catch (err) { out.textContent = 'Erreur : ' + err.message; }
  };

  function resetTransmission() {
    cipher = null; sentText = ''; delivered = false;
    $('alice-ciphertext-preview').classList.add('hidden');
    $('alice-dispatch-status').classList.add('hidden');
    $('btn-transmit').disabled = true; $('btn-eve-attack').disabled = true; $('btn-decrypt-bob').disabled = true;
    $('channel-status-label').textContent = 'En attente';
    $('eve-captured-data').textContent = 'En attente d\'une transmission...';
    $('eve-status-badge').textContent = 'Aucun paquet';
    $('bob-received-cipher').textContent = 'En attente de réception...';
    $('bob-decrypted-output').textContent = 'En attente du déchiffrement...';
    $('bob-verified-badge').classList.add('hidden');
    $('eve-terminal-log').replaceChildren();
    logEve('[ÈVE] En écoute sur le réseau...');
  }
  $('btn-reset-trans').onclick = resetTransmission;

  // ---------- Atelier libre ----------
  $('btn-direct-encrypt').onclick = async () => {
    const t = $('direct-plaintext-input').value;
    if (!t) return;
    const out = $('direct-ciphertext-output');
    out.value = 'Chiffrement...'; await wait(30);
    out.value = C.formatBlocks(C.encrypt(t, keys), $('select-cipher-format').value);
  };

  $('btn-direct-decrypt').onclick = async () => {
    const out = $('direct-decrypted-output');
    out.value = 'Déchiffrement...'; await wait(30);
    try { out.value = C.decrypt(C.parseBlocks($('direct-ciphertext-input').value), keys); }
    catch (err) { out.value = 'Erreur : ' + err.message; }
  };

  // ---------- Démonstrateur de factorisation ----------
  $('btn-benchmark-factor').onclick = async () => {
    const v = $('benchmark-number-input').value.trim(), res = $('benchmark-result');
    if (!/^\d+$/.test(v) || BigInt(v) < 2n) { res.textContent = 'Entre un entier ≥ 2.'; return; }
    const btn = $('btn-benchmark-factor'); btn.disabled = true;
    res.textContent = 'Calcul en cours (5 s maximum)...';
    const r = await C.factorTrial(v, 5000);
    const t = r.ms.toFixed(0) + ' ms';
    if (!r.done) res.textContent = 'Abandon après ' + t + ' : trop long par divisions d\'essai (' + v.length + ' chiffres).';
    else if (r.factors.length === 1) res.textContent = v + ' est premier (' + t + ').';
    else res.textContent = v + ' = ' + r.factors.join(' × ') + ' (' + t + ')';
    btn.disabled = false;
  };

  // ---------- Démarrage ----------
  setIp($('target-ip-input').value);
  updateCounts();
  resetTransmission();
  icons();
  genWithModal(500).then(k => {
    recipients.push({ name: 'Bob', ip: '192.168.1.45:8080', keys: k, initial: { ...k } });
    selectRecipient(0);
  });
})();