/* CRYPTO-500 : logique de l'interface */
(function () {
  const C = window.Crypto500;
  const $ = id => document.getElementById(id);
  const icons = () => { try { window.lucide && lucide.createIcons(); } catch (e) {} };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const short = (s, n = 220) => (s.length > n ? s.slice(0, n) + '… (' + s.length + ' chiffres)' : s);

  const IP_RE = /^(\d{1,3}\.){3}\d{1,3}(:\d{1,5})?$/;
  const ID_RE = /^[A-Za-z0-9._-]{2,20}$/;   // identifiant : lettres, chiffres, . _ -
  const recipients = [];    // { id, name, ip, keys, initial }
  let cur = null;           // destinataire sélectionné
  let keys = null;          // trousseau du destinataire courant
  let revealD = false;      // clé privée affichée dans l'onglet Clés
  let cipher = null;        // blocs chiffrés
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

  // ---------- Cibles (nom + identifiant réseau) ----------
  const label = r => r.name + ' (' + r.ip + ')';
  const NO_KEYS = 'Enregistre d\'abord une cible (nom + identifiant réseau).';

  function renderRecipient() {
    const sel = $('recipient-select');
    sel.replaceChildren(...recipients.map((r, i) => {
      const o = document.createElement('option'); o.value = i; o.textContent = label(r); return o;
    }));
    sel.value = recipients.indexOf(cur);
    $('target-summary').textContent = 'Destinataire : ' + label(cur);
    $('pubkey-owner').textContent = 'Clé publique de ' + cur.name + ' (e, n)';
    $('keys-owner').textContent = label(cur);
    $('btn-encrypt-and-transmit').disabled = false;
  }

  function selectRecipient(i) {
    cur = recipients[i]; keys = cur.keys; revealD = false;
    renderRecipient(); showKeys(); resetTransmission();
  }

  $('recipient-select').onchange = e => selectRecipient(+e.target.value);

  // Badge de validation de l'identifiant réseau, en direct
  $('recipient-ip').addEventListener('input', e => {
    const v = e.target.value.trim(), b = $('target-ip-badge');
    if (!v) { b.className = 'badge'; b.textContent = 'IP à saisir'; return; }
    const ok = IP_RE.test(v);
    b.className = 'badge ' + (ok ? 'badge-green' : 'badge-rose');
    b.textContent = ok ? 'IP valide' : 'IP invalide';
  });

  $('btn-create-recipient').onclick = async () => {
    const name = $('recipient-name').value.trim(), ip = $('recipient-ip').value.trim(), err = $('recipient-error');
    err.textContent = '';
    if (!name) { err.textContent = 'Saisis le nom de la cible.'; return; }
    if (!ip) { err.textContent = 'Saisis l\'identifiant réseau de la cible.'; return; }
    if (!IP_RE.test(ip)) { err.textContent = 'Identifiant réseau invalide (ex. 192.168.1.50:8080).'; return; }
    if (recipients.some(r => r.ip === ip)) { err.textContent = 'Cet identifiant réseau est déjà enregistré.'; return; }
    const btn = $('btn-create-recipient'); btn.disabled = true;
    try {
      const k = await genWithModal(parseInt($('recipient-digits').value, 10));
      recipients.push({ name, ip, keys: k, initial: { ...k } });
      $('recipient-name').value = ''; $('recipient-ip').value = '';
      $('target-ip-badge').className = 'badge'; $('target-ip-badge').textContent = 'IP à saisir';
      selectRecipient(recipients.length - 1);
    } finally { btn.disabled = false; }
  };

  $('btn-generate-keys').onclick = async () => {
    if (!cur) { alert(NO_KEYS); return; }
    const b = $('btn-generate-keys'); b.disabled = true;
    await generate(parseInt($('select-prime-digits').value, 10));
    b.disabled = false;
  };

  $('btn-restore-preset-keys').onclick = () => { if (cur) setKeys({ ...cur.initial }); };

  $('btn-export-keys').onclick = () => {
    if (!keys) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, name: cur.name, ip: cur.ip, ...keys }, null, 2)], { type: 'application/json' }));
    a.download = 'trousseau-rsa-' + cur.name.replace(/\W+/g, '_') + '.json'; a.click(); URL.revokeObjectURL(a.href);
  };

  $('btn-import-keys').onclick = () => { if (!cur) { alert(NO_KEYS); return; } $('file-import-keys').click(); };
  $('file-import-keys').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const k = JSON.parse(await f.text());
      if (!C.validateKeys(k)) throw new Error('Trousseau incohérent');
      setKeys({ p: String(k.p), q: String(k.q), n: String(k.n), e: String(k.e), d: String(k.d) });
    } catch (err) { alert('Import impossible : ' + err.message); }
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

  // ---------- Message ----------
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

  // ---------- Chiffrement + envoi vers la cible active ----------
  function addHistory(time, target, text, size, ip, status, ok) {
    const tr = document.createElement('tr');
    [time, target, text, size, ip, status].forEach((c, i) => {
      const td = document.createElement('td');
      if (i === 2) { const code = document.createElement('code'); code.textContent = c; td.append(code); }
      else if (i >= 4) { const s = document.createElement('span'); s.className = 'badge ' + (i === 4 ? 'badge-purple' : (ok ? 'badge-green' : 'badge-rose')); s.textContent = c; td.append(s); }
      else td.textContent = c;
      tr.append(td);
    });
    $('history-table-body').prepend(tr);
  }

  async function sendMessage() {
    const text = $('alice-message-input').value;
    if (!keys || !cur) { $('alice-dispatch-status').classList.remove('hidden'); $('alice-dispatch-text').textContent = NO_KEYS; return; }
    if (!text.trim()) return;
    const btn = $('btn-encrypt-and-transmit'); btn.disabled = true;
    const target = cur, k = keys;
    const dispatch = $('alice-dispatch-status');
    await wait(30);
    const blocks = C.encrypt(text, k);
    const box = $('alice-ciphertext-preview');
    box.classList.remove('hidden');
    box.textContent = 'C = Mᵉ mod n (' + blocks.length + ' bloc' + (blocks.length > 1 ? 's' : '') + ')\n' + short(blocks[0], 300);
    dispatch.classList.remove('hidden');
    $('alice-dispatch-text').textContent = 'Envoi du paquet chiffré vers ' + target.name + ' (' + target.ip + ')...';
    await wait(1200);

    // Contrôle d'intégrité : déchiffrement avec la clé privée de la cible
    let ok = false;
    try { ok = C.decrypt(blocks, k) === text; } catch (_) {}
    $('alice-dispatch-text').textContent = ok
      ? 'Livré à ' + target.name + ' (' + target.ip + ') : déchiffré sans altération'
      : 'Échec du contrôle d\'intégrité';
    addHistory(new Date().toLocaleTimeString('fr-FR'), target.name, text.slice(0, 40) + (text.length > 40 ? '…' : ''),
      blocks.reduce((s, b) => s + b.length, 0) + ' chiffres', target.ip, ok ? 'Livré' : 'Erreur', ok);
    btn.disabled = false;
  }
  $('btn-encrypt-and-transmit').onclick = sendMessage;

  function resetTransmission() {
    $('alice-ciphertext-preview').classList.add('hidden');
    $('alice-dispatch-status').classList.add('hidden');
  }

  // ---------- Atelier libre ----------
  $('btn-direct-encrypt').onclick = async () => {
    const t = $('direct-plaintext-input').value;
    if (!t) return;
    if (!keys) { $('direct-ciphertext-output').value = NO_KEYS; return; }
    const out = $('direct-ciphertext-output');
    out.value = 'Chiffrement...'; await wait(30);
    out.value = C.formatBlocks(C.encrypt(t, keys), $('select-cipher-format').value);
  };

  $('btn-direct-decrypt').onclick = async () => {
    const out = $('direct-decrypted-output');
    if (!keys) { out.value = NO_KEYS; return; }
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
  updateCounts();
  resetTransmission();
  icons();
})();