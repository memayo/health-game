// Game-over screen: winner banner + leaderboard. Presentation only.

import { ROLE } from './gameConfig.js';
import { showGameOverFx } from './pixelDecor.js';

const $ = (id) => document.getElementById(id);
const MEDALS = ['gold', 'silver', 'bronze'];

export function fmtSeconds(ms) {
  const s = Math.max(0, (ms || 0) / 1000);
  return s < 60 ? s.toFixed(1) + ' วิ' : Math.floor(s / 60) + ' นาที ' + Math.round(s % 60) + ' วิ';
}

/**
 * go = { winner, hunterName, survivors[], leaderboard[], reason }
 * leaderboard entries: { uid, name, role, alive, correct, answered, timeMs, rank }
 */
export function renderGameOverView(go, meUid = null) {
  const hunterWon = go.winner === ROLE.HUNTER;
  $('go-title').textContent = hunterWon ? 'HUNTER WINS' : 'PLAYERS WIN';
  showGameOverFx($('go-fx'), hunterWon);
  const parts = [];
  if (go.reason === 'time') parts.push('หมดเวลา!');
  if (go.hunterName) parts.push('Hunter คือ ' + go.hunterName);
  $('go-reveal').textContent = parts.join(' · ');

  const ul = $('go-survivors');
  ul.innerHTML = '';
  for (const name of go.survivors || []) {
    const li = document.createElement('li');
    li.textContent = name;
    ul.appendChild(li);
  }
  $('go-survivors-head').classList.toggle('hidden', !(go.survivors || []).length);

  const board = $('go-board');
  board.innerHTML = '';
  const rows = go.leaderboard || [];
  $('go-board-wrap').classList.toggle('hidden', !rows.length);
  rows.forEach((e, i) => {
    const li = document.createElement('li');
    li.className = 'lb-row' + (i < 3 ? ' lb-' + MEDALS[i] : '') + (e.uid === meUid ? ' lb-me' : '')
      + (e.alive ? '' : ' lb-out');
    li.style.animationDelay = (200 + i * 90) + 'ms';
    const rank = document.createElement('span');
    rank.className = 'lb-rank';
    rank.textContent = String(e.rank);
    const name = document.createElement('span');
    name.className = 'lb-name';
    name.textContent = e.name + (e.role === ROLE.HUNTER ? ' ☠' : '');
    const score = document.createElement('span');
    score.className = 'lb-score';
    score.textContent = e.correct + ' ข้อ';
    const time = document.createElement('span');
    time.className = 'lb-time';
    time.textContent = fmtSeconds(e.timeMs);
    li.append(rank, name, score, time);
    board.appendChild(li);
  });
  const top = rows[0];
  $('go-mvp').textContent = top && top.correct > 0
    ? 'ตอบถูกมากที่สุด: ' + top.name + ' (' + top.correct + ' ข้อ, ' + fmtSeconds(top.timeMs) + ')'
    : '';
}
