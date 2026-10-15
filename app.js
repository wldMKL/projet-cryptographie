/* CRYPTO-500 : logique de l'interface + transmission réseau */
(function () {
  const C = window.Crypto500;
  const $ = id => document.getElementById(id);
  const icons = () => { try { window.lucide && lucide.createIcons(); } catch (e) {} };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const short = (s, n = 220) => (s.length > n ? s.slice(0, n) + '… (' + s.length + ' chiffres)' : s);
  const IP_RE = /^(\d{1,3}\.){3}\d{1,3}(:\d{1,5})?$/;
  const LS = 'crypto500-local';

  const recipients = [];   // { name, ip, keys }  (keys.d présent = cible locale)
  let cur = null;
  let sentText = '';
  const seen = {};         // n -> dernier id de message affiché

  // ---------- Réseau ----------
  async function api(path, body) {
    const r = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : undefined);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  const publish = r => api('/pubkey', { name: r.name, ip: r.ip, e: r.keys.e, n: r.keys.n }).catch(() => {});

  function persist() {
    try {
      localStorage.setItem(LS, JSON.stringify(recipients.filter(r => r.keys.d).map(r => ({ name: r.name, ip: r.ip, keys: r.keys }))));
    } catch (e) {}
  }

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = t; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      ta.remove();
    }
  }
  const flash = btn => { btn.style.color = 'var(--green)'; setTimeout(() => (btn.style.color = ''), 900); };

  // ---------- Fond animé ----------
  (function bg() {
    const cv = $('bg-canvas'), ctx = cv.getContext('2d'), pts = [];
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

  // ---------- Adresse IP ----------
  function checkIp() {
    const v = $('recipient-ip').value.trim(), b = $('target-ip-badge');
    if (!v) { b.className = 'badge'; b.textContent = 'IP à saisir'; return; }
    const ok = IP_RE.test(v);
    b.className = 'badge ' + (ok ? 'badge-green' : 'badge-rose');
    b.textContent = ok ? 'IP prête' : 'IP invalide';
  }
  $('recipient-ip').addEventListener('input', checkIp);

  // ---------- Modale de génération ----------
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

  // ---------- Cibles ----------
  function renderRecipients() {
    const sel = $('recipient-select');
    sel.replaceChildren(...recipients.map((r, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = r.name + ' (' + r.ip + ')' + (r.keys.d ? ' · local' : ' · distant');
      return o;
    }));
    sel.value = recipients.indexOf(cur);
  }

  function resetReception() {
    sentText = '';
    $('alice-ciphertext-preview').classList.add('hidden');
    $('alice-dispatch-status').classList.add('hidden');
    $('target-received-ciphertext').value = '';
    $('target-decrypted-output').value = '';
    $('btn-target-decrypt').disabled = true;
  }

  function showCurrent() {
    if (!cur) return;
    const k = cur.keys;
    $('target-summary').textContent = cur.name + ' · ' + cur.ip;
    $('target-inbox-owner').textContent = k.d ? 'Boîte de réception de ' + cur.name : cur.name + ' : cible distante (clé privée sur son PC)';
    $('pubkey-owner').textContent = 'Clé publique de ' + cur.name + ' (e, n)';
    $('trans-bob-pubkey-e').textContent = k.e;
    $('trans-bob-pubkey-n').textContent = k.n;
    $('btn-encrypt-and-transmit').disabled = false;
    updateCounts();
    resetReception();
  }

  function selectRecipient(i) { cur = recipients[i]; renderRecipients(); showCurrent(); }
  $('recipient-select').onchange = e => selectRecipient(+e.target.value);

  $('btn-create-recipient').onclick = async () => {
    const name = $('recipient-name').value.trim(), ip = $('recipient-ip').value.trim(), err = $('recipient-error');
    err.textContent = '';
    if (!name) { err.textContent = 'Donne un nom à la cible.'; return; }
    if (recipients.some(r => r.name.toLowerCase() === name.toLowerCase())) { err.textContent = 'Ce nom existe déjà.'; return; }
    if (!IP_RE.test(ip)) { err.textContent = 'Adresse IP invalide (ex. 192.168.1.50:8080).'; return; }
    const btn = $('btn-create-recipient'); btn.disabled = true;
    try {
      const keys = await genWithModal(parseInt($('recipient-digits').value, 10));
      const r = { name, ip, keys };
      recipients.push(r);
      persist();
      publish(r);   // la clé publique devient visible sur les autres PC
      $('recipient-name').value = '';
      selectRecipient(recipients.length - 1);
    } finally { btn.disabled = false; }
  };

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

  $('btn-copy-trans-pubkey').onclick = async e => {
    if (!cur) return;
    await copyText('e=' + cur.keys.e + '\nn=' + cur.keys.n);
    flash(e.currentTarget);
  };

  // ---------- Message ----------
  function updateCounts() {
    const t = $('alice-message-input').value, bytes = new TextEncoder().encode(t).length;
    $('alice-char-count').textContent = t.length + ' caractère' + (t.length > 1 ? 's' : '');
    if (cur) {
      const k = C.blockSize(BigInt(cur.keys.n)), nb = Math.max(1, Math.ceil(bytes / k));
      $('alice-block-count').textContent = nb + ' bloc' + (nb > 1 ? 's' : '') + ' RSA de ' + cur.keys.n.length + ' chiffres';
    }
  }
  $('alice-message-input').addEventListener('input', updateCounts);
  document.querySelectorAll('.preset-chip').forEach(c => c.addEventListener('click', () => {
    $('alice-message-input').value = c.dataset.text; updateCounts();
  }));

  // ---------- Chiffrement + envoi réseau ----------
  function addHistory(target, text, size, ip, status, ok) {
    const tr = document.createElement('tr');
    [new Date().toLocaleTimeString('fr-FR'), target, text, size, ip, status].forEach((c, i) => {
      const td = document.createElement('td');
      if (i === 2) { const code = document.createElement('code'); code.textContent = c; td.append(code); }
      else if (i >= 4) { const s = document.createElement('span'); s.className = 'badge ' + (i === 4 ? 'badge-purple' : ok ? 'badge-green' : 'badge-rose'); s.textContent = c; td.append(s); }
      else td.textContent = c;
      tr.append(td);
    });
    $('history-table-body').prepend(tr);
  }

  $('btn-encrypt-and-transmit').onclick = async () => {
    const text = $('alice-message-input').value;
    if (!cur || !text.trim()) return;
    const btn = $('btn-encrypt-and-transmit'); btn.disabled = true;
    const target = cur, status = $('alice-dispatch-text');
    try {
      await wait(30);
      sentText = text;
      const cipher = C.encrypt(text, target.keys);
      const box = $('alice-ciphertext-preview');
      box.classList.remove('hidden');
      box.textContent = 'C = Mᵉ mod n (' + cipher.length + ' bloc' + (cipher.length > 1 ? 's' : '') + ')\n' + short(cipher[0], 300);

      $('alice-dispatch-status').classList.remove('hidden');
      status.textContent = 'Envoi du paquet chiffré vers ' + target.ip + '...';

      let ok = true;
      try { await api('/send', { n: target.keys.n, blocks: cipher }); }
      catch (e) { ok = false; status.textContent = 'Échec de l\'envoi : serveur injoignable (' + e.message + ')'; }
      if (ok) status.textContent = 'Paquet chiffré livré à ' + target.ip;

      addHistory(target.name, text.slice(0, 40) + (text.length > 40 ? '…' : ''),
        cipher.reduce((s, b) => s + b.length, 0) + ' chiffres', target.ip, ok ? 'Livré' : 'Échec', ok);
      icons();
    } finally { btn.disabled = false; }
  };

  // ---------- Réception : interrogation du serveur ----------
  async function poll() {
    try {
      // 1. Nouvelles cibles publiées par d'autres PC (clé publique seulement)
      let added = false;
      for (const k of await api('/pubkeys')) {
        if (!recipients.some(r => r.keys.n === k.n)) {
          recipients.push({ name: k.name || 'Distant', ip: k.ip || '', keys: { n: k.n, e: k.e } });
          added = true;
        }
      }
      if (added) { if (cur) renderRecipients(); else selectRecipient(0); }

      // 2. Messages destinés aux cibles locales (celles dont ce PC détient d)
      for (const r of recipients.filter(x => x.keys.d)) {
        const m = await api('/receive?n=' + r.keys.n);
        if (m.id && m.id !== seen[r.keys.n]) {
          seen[r.keys.n] = m.id;
          selectRecipient(recipients.indexOf(r));
          $('target-received-ciphertext').value = C.formatBlocks(m.blocks.map(String), 'json');
          $('target-decrypted-output').value = '';
          $('target-inbox-owner').textContent = 'Nouveau message reçu pour ' + r.name;
          $('btn-target-decrypt').disabled = false;
        }
      }
    } catch (e) { /* serveur injoignable : on réessaiera */ }
  }

  // ---------- Déchiffrement (cible) ----------
  $('btn-target-decrypt').onclick = async () => {
    const out = $('target-decrypted-output');
    if (!cur || !cur.keys.d) { out.value = 'Clé privée absente sur ce PC.'; return; }
    out.value = 'Déchiffrement en cours...';
    await wait(40);
    try { out.value = C.decrypt(C.parseBlocks($('target-received-ciphertext').value), cur.keys); }
    catch (err) { out.value = 'Erreur : ' + err.message; }
  };

  // ---------- Démarrage ----------
  try {
    for (const r of JSON.parse(localStorage.getItem(LS) || '[]')) { recipients.push(r); publish(r); }
  } catch (e) {}
  if (recipients.length) selectRecipient(0);
  updateCounts();
  checkIp();
  icons();
  poll();
  setInterval(poll, 2500);
})();