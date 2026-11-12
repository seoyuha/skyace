'use strict';
/* SKY ACE 영어 복습 출격 — 반별 기록 서버 (외부 패키지 없이 동작)
   학생: /            교사: /teacher.html
   교사 비밀번호: 환경 변수 TEACHER_PASSWORD (없으면 아래 기본값) */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const PW = process.env.TEACHER_PASSWORD || 'finel9932!';
const PUB = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'results.json');
const SFILE = path.join(DATA_DIR, 'settings.json');
const CLASSES = ['8', '9', '10'];
fs.mkdirSync(DATA_DIR, { recursive: true });
let results = [];
try { results = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (!Array.isArray(results)) results = []; } catch (e) { results = []; }
let settings = { classes: { 8: { units: [12], diff: 'normal' }, 9: { units: [12], diff: 'normal' }, 10: { units: [12], diff: 'normal' } } };
try { const st = JSON.parse(fs.readFileSync(SFILE, 'utf8')); if (st && st.classes) settings = st; } catch (e) {}
function saveSettings() { fs.writeFile(SFILE, JSON.stringify(settings), () => {}); }
let halt = { paused: false, at: 0 };
try { if (settings.halt) halt = settings.halt; } catch (e) {}
let saveTimer = null;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { fs.writeFile(FILE + '.tmp', JSON.stringify(results), e => { if (!e) fs.rename(FILE + '.tmp', FILE, () => {}); }); }, 400); }
const tokens = new Map();
const presence = { 8: {}, 9: {}, 10: {} };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
function send(res, code, obj, headers = {}) { const b = typeof obj === 'string' ? obj : JSON.stringify(obj); res.writeHead(code, Object.assign({ 'Content-Type': typeof obj === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers)); res.end(b); }
function readBody(req) { return new Promise((ok, no) => { let d = ''; req.on('data', c => { d += c; if (d.length > 200000) { no(new Error('too big')); req.destroy(); } }); req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { no(e); } }); }); }
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const num = (v, lo, hi) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo; };
function authed(req) { const t = (req.headers.authorization || '').replace(/^Bearer /, ''); const exp = tokens.get(t); return exp && exp > Date.now(); }
function ranking(cls, unitKey, diff) {
  const best = new Map();
  for (const r of results) {
    if (r.cls !== cls || r.unitKey !== unitKey || r.diff !== diff || r.review || r.duel) continue;
    const k = r.nick, b = best.get(k);
    if (!b || r.score > b.score) best.set(k, { nick: r.nick, score: r.score, acc: r.acc, stars: r.stars });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || b.acc - a.acc);
}
function csv() {
  const head = ['시간', '반', '별명', '단원', '난이도', '오답복습', '1대1 상대', '결과', '별', '정답률', '정답', '문제수', '점수', '최고콤보', '격추', '틀린 문제'];
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = results.map(r => [new Date(r.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }), r.cls + '반', r.nick, r.unitKey, r.diff, r.review ? 'O' : '', r.duel || '', r.duel ? (r.win ? '승리' : '패배') : (r.win ? '클리어' : '실패'), r.stars, r.acc + '%', r.correct, r.total, r.score, r.maxCombo, r.kills, (r.notes || []).map(n => `${n.unit}단원 ${n.prompt} → ${n.answer}`).join(' / ')].map(q).join(','));
  return '﻿' + head.map(q).join(',') + '\n' + rows.join('\n');
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const p = url.pathname;
  try {
    if (p === '/api/ping') return send(res, 200, { ok: true, app: 'skyace' });
    if (p === '/api/settings') return send(res, 200, { ok: true, classes: settings.classes, paused: halt.paused });
    if (p === '/api/ranking') {
      const cls = clean(url.searchParams.get('cls'), 3), uk = clean(url.searchParams.get('unitKey'), 40), df = clean(url.searchParams.get('diff'), 8);
      if (!CLASSES.includes(cls)) return send(res, 400, { error: '반을 골라 주세요' });
      return send(res, 200, { ok: true, top: ranking(cls, uk, df).slice(0, 10) });
    }
    if (p === '/api/presence') {
      // 학생 대기실 '입장 현황': 같은 반에서 최근 20초 안에 신호를 보낸 학생
      if (req.method === 'POST') { const b = await readBody(req); const cls = clean(b.cls, 3), nick = clean(b.nick, 10); if (CLASSES.includes(cls) && nick) { presence[cls][nick] = { at: Date.now(), st: clean(b.st, 8), pl: clean(b.pl, 16) }; } }
      const cls = clean(url.searchParams.get('cls'), 3); if (!CLASSES.includes(cls)) return send(res, 200, { ok: true, list: [] });
      const now = Date.now(); const list = Object.entries(presence[cls]).filter(([, v]) => now - v.at < 20000).map(([nick, v]) => ({ nick, st: v.st, pl: v.pl })).sort((x, y) => x.nick.localeCompare(y.nick, 'ko'));
      return send(res, 200, { ok: true, list });
    }
    if (p === '/api/state') return send(res, 200, { ok: true, paused: halt.paused, at: halt.at });
    if (p === '/api/result' && req.method === 'POST') {
      const b = await readBody(req);
      const cls = clean(b.cls, 3); if (!CLASSES.includes(cls)) return send(res, 400, { error: '반을 골라 주세요' });
      const nick = clean(b.nick, 10); if (!nick) return send(res, 400, { error: '별명을 써 주세요' });
      const units = (Array.isArray(b.units) ? b.units : []).map(u => num(u, 1, 12)).filter((v, i, a) => a.indexOf(v) === i).sort((x, y) => x - y);
      if (!units.length) return send(res, 400, { error: '단원 정보가 없어요' });
      const r = { at: Date.now(), cls, nick, units, unitKey: units.join(','), diff: ['easy', 'normal', 'hard'].includes(b.diff) ? b.diff : 'normal',
        review: !!b.review, win: !!b.win, stars: num(b.stars, 0, 3), acc: num(b.acc, 0, 100), score: num(b.score, 0, 9999999), correct: num(b.correct, 0, 200), total: num(b.total, 0, 200),
        maxCombo: num(b.maxCombo, 0, 200), kills: num(b.kills, 0, 99999), duel: b.duel ? clean(b.duel, 16) : undefined,
        notes: (Array.isArray(b.notes) ? b.notes : []).slice(0, 30).map(n => ({ unit: num(n.unit, 1, 12), type: clean(n.type, 2), prompt: clean(n.prompt, 120), answer: clean(n.answer, 120), chosen: clean(n.chosen, 80) })) };
      results.push(r); if (results.length > 20000) results.splice(0, results.length - 20000); save();
      const list = ranking(cls, r.unitKey, r.diff), idx = list.findIndex(x => x.nick === r.nick);
      return send(res, 200, { ok: true, top: list.slice(0, 5), me: idx >= 0 ? { rank: idx + 1, score: list[idx].score } : null });
    }
    if (p === '/api/teacher/login' && req.method === 'POST') {
      const b = await readBody(req);
      if (String(b.pw || '') !== PW) return send(res, 401, { error: '비밀번호가 달라요' });
      const t = crypto.randomBytes(24).toString('hex'); tokens.set(t, Date.now() + 12 * 3600 * 1000); return send(res, 200, { ok: true, token: t });
    }
    if (p.startsWith('/api/teacher/')) {
      if (!authed(req)) return send(res, 401, { error: '다시 로그인해 주세요' });
      if (p === '/api/teacher/pause' && req.method === 'POST') {
        const b = await readBody(req); halt = { paused: !!b.paused, at: Date.now() }; settings.halt = halt; saveSettings();
        return send(res, 200, { ok: true, paused: halt.paused });
      }
      if (p === '/api/teacher/settings' && req.method === 'POST') {
        const b = await readBody(req), next = {};
        for (const c of CLASSES) {
          const v = (b.classes || {})[c] || {};
          const units = (Array.isArray(v.units) ? v.units : []).map(u => num(u, 1, 12)).filter((x, i, a) => a.indexOf(x) === i).sort((x, y) => x - y);
          next[c] = { units: units.length ? units : [12], diff: ['easy', 'normal', 'hard'].includes(v.diff) ? v.diff : 'normal', mode: v.mode === 'duel' ? 'duel' : 'solo' };
        }
        settings = { classes: next, at: Date.now(), halt }; saveSettings(); return send(res, 200, { ok: true, classes: next });
      }
      if (p === '/api/teacher/duel' && req.method === 'GET') return send(res, 200, Object.assign({ ok: true }, duelStatus()));
      if (p === '/api/teacher/duel' && req.method === 'POST') { const b = await readBody(req); const cls = clean(b.cls, 3); if (CLASSES.includes(cls)) pairNow(cls, true); return send(res, 200, Object.assign({ ok: true }, duelStatus())); }
      if (p === '/api/teacher/results' && req.method === 'GET') return send(res, 200, { ok: true, results });
      if (p === '/api/teacher/results' && req.method === 'DELETE') { const cls = url.searchParams.get('cls'); results = cls ? results.filter(r => r.cls !== cls) : []; save(); return send(res, 200, { ok: true }); }
      if (p === '/api/teacher/csv') return send(res, 200, csv(), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="skyace-records.csv"' });
      return send(res, 404, { error: 'not found' });
    }
    // 정적 파일
    let f = p === '/' ? '/index.html' : p === '/teacher' ? '/teacher.html' : decodeURIComponent(p);
    const full = path.normalize(path.join(PUB, f));
    if (!full.startsWith(PUB)) return send(res, 403, 'forbidden');
    fs.readFile(full, (e, data) => { if (e) return send(res, 404, 'Not found'); res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data); });
  } catch (e) { send(res, 400, { error: '요청을 처리하지 못했어요' }); }
});
/* ================= 1대1 실시간 대결 (외부 패키지 없는 웹소켓) =================
   학생이 대기실에 들어오면 같은 반끼리 자동으로 짝을 지어요.
   두 명이 모이면 바로 대결, 혼자 20초 넘게 기다리면 AI 파일럿과 대결해요.
   한 학생(호스트)의 화면이 적과 보스를 움직이고, 다른 학생(게스트)은 그 상태를 받아 같은 하늘을 봐요. */
const conns = new Map(); let cid = 0;
const lobby = { 8: [], 9: [], 10: [] };
const matches = new Map(); let mid = 0;
function wsSend(c, obj) { if (!c || c.dead) return; const data = Buffer.from(JSON.stringify(obj)); let head;
  if (data.length < 126) head = Buffer.from([0x81, data.length]);
  else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(data.length, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
  try { c.sock.write(Buffer.concat([head, data])); } catch (e) {} }
function wsClose(c) { if (c.dead) return; c.dead = true; try { c.sock.end(); } catch (e) {} leave(c); conns.delete(c.id); }
function leave(c) {
  for (const k of CLASSES) lobby[k] = lobby[k].filter(x => x !== c);
  const m = c.match && matches.get(c.match);
  if (m && m.state === 'play') { const other = m.a === c ? m.b : m.a; m.state = 'left'; m.endAt = Date.now(); m.left = c.nick; if (other) wsSend(other, { t: 'opp_left', host: m.a === c }); }
}
function startMatch(cls, a, b) {
  const id = ++mid, m = { id, cls, a, b, ai: !b, state: 'play', at: Date.now(), sum: null, winner: null };
  matches.set(id, m); a.match = id; if (b) b.match = id;
  const info = x => ({ nick: x.nick, pl: x.pl, ship: x.ship });
  const aiInfo = { nick: 'AI 파일럿', pl: ['coco_dog', 'leo_cat', 'luca_fox', 'momo_rabbit', 'bruno_bear'][id % 5], ship: 'red_blaze', ai: true };
  wsSend(a, { t: 'match', id, role: 'host', opp: b ? info(b) : aiInfo, seed: id * 7919 });
  if (b) wsSend(b, { t: 'match', id, role: 'guest', opp: info(a), seed: id * 7919 });
}
function pairNow(cls, force) {
  const q = lobby[cls]; if (!q) return;
  while (q.length >= 2) { const i = Math.floor(Math.random() * q.length), a = q.splice(i, 1)[0], j = Math.floor(Math.random() * q.length), b = q.splice(j, 1)[0]; startMatch(cls, a, b); }
  if (q.length === 1 && (force || Date.now() - q[0].waitAt > 20000)) startMatch(cls, q.shift(), null);
}
setInterval(() => {
  for (const k of CLASSES) pairNow(k, false);
  const now = Date.now();
  for (const [id, m] of matches) if (m.state !== 'play' && now - (m.endAt || now) > 10 * 60000) matches.delete(id);
  for (const c of conns.values()) if (now - c.seen > 30000) wsClose(c);
}, 2000);
function duelStatus() {
  const L = {}; for (const k of CLASSES) L[k] = lobby[k].map(c => ({ nick: c.nick, pl: c.pl, wait: Math.round((Date.now() - c.waitAt) / 1000) }));
  const M = [...matches.values()].filter(m => m.state === 'play' || Date.now() - m.endAt < 5 * 60000).sort((x, y) => y.at - x.at).slice(0, 40)
    .map(m => ({ id: m.id, cls: m.cls, a: m.a.nick, b: m.b ? m.b.nick : 'AI 파일럿', apl: m.a.pl, bpl: m.b ? m.b.pl : null, ai: m.ai, state: m.state, sec: Math.round(((m.endAt || Date.now()) - m.at) / 1000), sum: m.sum, winner: m.winner, left: m.left }));
  return { lobby: L, matches: M };
}
function onMsg(c, msg) {
  c.seen = Date.now();
  if (msg.t === 'hello') return;
  if (msg.t === 'join') {
    const cls = clean(msg.cls, 3); if (!CLASSES.includes(cls)) return;
    leave(c); c.match = null;
    Object.assign(c, { cls, nick: clean(msg.nick, 10) || '파일럿', pl: clean(msg.pl, 16), ship: clean(msg.ship, 16), waitAt: Date.now() });
    lobby[cls].push(c); wsSend(c, { t: 'lobby', n: lobby[cls].length }); return;
  }
  if (msg.t === 'leave') { leave(c); c.match = null; return; }
  const m = c.match && matches.get(c.match); if (!m) return;
  const other = m.a === c ? m.b : m.a;
  if (msg.t === 'sum' && m.a === c) { m.sum = { sc: msg.sc, g: msg.g, mode: clean(msg.mode, 10) }; return; }
  if (msg.t === 'end' && m.a === c) { m.state = 'end'; m.endAt = Date.now(); m.winner = msg.w === 1 ? m.a.nick : msg.w === 2 ? (m.b ? m.b.nick : 'AI 파일럿') : '무승부'; m.sum = Object.assign(m.sum || {}, { sc: msg.sc, g: msg.g }); if (other) wsSend(other, msg); return; }
  if (other) wsSend(other, msg);
}
server.on('upgrade', (req, sock) => {
  if (!req.url.startsWith('/ws') || !req.headers['sec-websocket-key']) { sock.destroy(); return; }
  const acc = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  sock.setNoDelay(true);
  const c = { id: ++cid, sock, buf: Buffer.alloc(0), seen: Date.now(), frag: [] }; conns.set(c.id, c);
  sock.on('data', d => {
    c.buf = Buffer.concat([c.buf, d]);
    while (c.buf.length >= 2) {
      const b0 = c.buf[0], b1 = c.buf[1], op = b0 & 15, fin = b0 & 128, masked = b1 & 128; let len = b1 & 127, off = 2;
      if (len === 126) { if (c.buf.length < 4) return; len = c.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (c.buf.length < 10) return; len = Number(c.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1e6) { wsClose(c); return; }
      const mk = masked ? c.buf.slice(off, off + 4) : null; if (masked) off += 4;
      if (c.buf.length < off + len) return;
      let pl = c.buf.slice(off, off + len); c.buf = c.buf.slice(off + len);
      if (mk) { pl = Buffer.from(pl); for (let i = 0; i < pl.length; i++) pl[i] ^= mk[i & 3]; }
      if (op === 8) { wsClose(c); return; }
      if (op === 9) { try { sock.write(Buffer.concat([Buffer.from([0x8a, pl.length]), pl])); } catch (e) {} continue; }
      if (op === 10) continue;
      if (op === 1 || op === 0) { c.frag.push(pl); if (!fin) continue; const txt = Buffer.concat(c.frag).toString('utf8'); c.frag = []; try { onMsg(c, JSON.parse(txt)); } catch (e) {} }
    }
  });
  sock.on('close', () => wsClose(c)); sock.on('error', () => wsClose(c));
});
server.listen(PORT, () => console.log('SKY ACE server on ' + PORT));
