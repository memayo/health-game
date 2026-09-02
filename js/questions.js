// .xlsx question import (SheetJS) + deck management.
//
// Two layouts are auto-detected:
//
// 1. Blooket Import Template
//    Question # | Question Text | Answer 1..4 | Time Limit (sec) | Correct Answer(s)
//    "Correct Answer(s)" holds ANSWER NUMBERS (1-4), not letters, and may list
//    several ("1, 3"). Header names may contain line breaks and notes such as
//    "(Optional)" or "(Max: 300 seconds)", and the header row is often not row 1.
//
// 2. Simple layout
//    question | A | B | C | D | correct        (correct = A/B/C/D)
//
// Loaded as a plain browser ES module - SheetJS comes from a CDN, no bundler.

const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
const LETTERS = ['A', 'B', 'C', 'D'];
const HEADER_SCAN_ROWS = 25;   // how far down to look for the header row

let xlsxLib = null;

async function lib() {
  if (xlsxLib) return xlsxLib;
  try {
    xlsxLib = await import(XLSX_URL);
  } catch (e) {
    console.error('[questions] SheetJS failed to load from ' + XLSX_URL, e);
    throw new Error('SheetJS could not be loaded (offline or blocked).');
  }
  return xlsxLib;
}

/* ---------------- header handling ---------------- */

// Collapses line breaks and repeated spaces so "Answer 3\n(Optional)" -> "answer 3 (optional)".
function norm(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function cell(row, idx) {
  if (idx === undefined || idx === null || idx < 0) return '';
  const v = row[idx];
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

/**
 * Reads one header row and works out which layout it is.
 * @returns {?{format:'blooket'|'simple', text:number, slots:Object, correct:number,
 *             timeLimit:number, number:number}}
 */
function mapHeader(cells) {
  const slots = {};
  let text = -1, correct = -1, timeLimit = -1, number = -1;
  const simple = {};

  cells.forEach((raw, i) => {
    const h = norm(raw);
    if (!h) return;

    // --- Blooket ---
    if (h.includes('question text')) { if (text < 0) text = i; return; }
    const answerMatch = h.match(/^answer\s*(\d+)/);
    if (answerMatch) {
      const slot = parseInt(answerMatch[1], 10);
      if (slot >= 1 && slot <= 4 && slots[slot] === undefined) slots[slot] = i;
      return;
    }
    if (h.includes('correct answer')) { if (correct < 0) correct = i; return; }
    if (h.includes('time limit')) { if (timeLimit < 0) timeLimit = i; return; }
    if (h === 'question #' || h.startsWith('question #')) { if (number < 0) number = i; return; }

    // --- simple ---
    if (h === 'question' || h === 'q' || h === 'questions') { if (simple.q === undefined) simple.q = i; return; }
    if (h === 'correct' || h === 'answer' || h === 'ans') { if (correct < 0) correct = i; return; }
    const letterMatch = h.match(/^(?:choice |option )?([a-d])\)?$/);
    if (letterMatch) {
      const slot = letterMatch[1].toUpperCase().charCodeAt(0) - 64;
      if (slots[slot] === undefined) slots[slot] = i;
    }
  });

  const answerCount = Object.keys(slots).length;

  if (text >= 0 && answerCount >= 2) {
    return { format: 'blooket', text, slots, correct, timeLimit, number };
  }
  if (simple.q !== undefined && answerCount >= 2 && correct >= 0) {
    return { format: 'simple', text: simple.q, slots, correct, timeLimit: -1, number: -1 };
  }
  return null;
}

/** The header is often not row 1 (a title such as "Blooket Import Template" sits above it). */
function findHeaderRow(rows) {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i++) {
    const map = mapHeader(rows[i] || []);
    if (map) return { index: i, map };
  }
  return null;
}

/* ---------------- correct-answer parsing ---------------- */

/** "4" / 4 / "4.0" / "1, 3" / "1,3" / "B" -> [4] / [4] / [4] / [1,3] / [1,3] / [2] */
function parseCorrectSlots(raw) {
  const s = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!s) return [];

  // Excel hands back numbers, and "4.0" must not split into 4 and 0.
  const single = Number(s);
  if (Number.isFinite(single)) return [Math.round(single)];

  return s.split(/[\s,;/|]+/)
    .map(tok => {
      const t = tok.trim();
      if (!t) return NaN;
      const n = Number(t);
      if (Number.isFinite(n)) return Math.round(n);
      const up = t.toUpperCase();
      return /^[A-D]$/.test(up) ? up.charCodeAt(0) - 64 : NaN;
    })
    .filter(n => Number.isFinite(n));
}

/* ---------------- row parsing ---------------- */

/**
 * @returns {{status:'ok',question:Object} | {status:'ignore'} | {status:'error',reason:string}}
 */
function parseRow(row, map, excelRow) {
  const text = cell(row, map.text);

  // Answer slots keep their original 1-4 numbering; blanks are dropped from the
  // rendered list but the correct-answer number still refers to the original slot.
  const slotValues = {};
  const choices = [];
  const slotToChoice = {};
  for (let slot = 1; slot <= 4; slot++) {
    const v = cell(row, map.slots[slot]);
    slotValues[slot] = v;
    if (v) { slotToChoice[slot] = choices.length; choices.push(v); }
  }

  // Template filler: no text and no answers. Not an error, just not a question.
  if (!text && choices.length === 0) return { status: 'ignore' };

  if (!text) return { status: 'error', reason: 'row ' + excelRow + ': no question text' };
  if (choices.length < 2) return { status: 'error', reason: 'row ' + excelRow + ': fewer than 2 answers' };

  const rawCorrect = cell(row, map.correct);
  if (!rawCorrect) return { status: 'error', reason: 'row ' + excelRow + ': no correct answer' };

  const slots = parseCorrectSlots(rawCorrect);
  const letters = [];
  for (const slot of slots) {
    if (slot < 1 || slot > 4) continue;
    if (!slotValues[slot]) continue;                 // points at a blank answer
    const letter = LETTERS[slotToChoice[slot]];
    if (letter && !letters.includes(letter)) letters.push(letter);
  }
  if (!letters.length) {
    return { status: 'error', reason: 'row ' + excelRow + ': correct answer "' + rawCorrect + '" is not a filled answer' };
  }

  const question = { id: 'r' + excelRow, text, choices, correct: letters };

  // Optional metadata; kept out of the public question and unused by the game for now.
  const num = cell(row, map.number);
  if (num) question.number = num;
  const time = Number(cell(row, map.timeLimit));
  if (Number.isFinite(time) && time > 0) question.timeLimit = Math.round(time);

  return { status: 'ok', question };
}

/* ---------------- public API ---------------- */

/**
 * @returns {{questions:Array, errors:Array<string>, ignored:number, format:string}}
 * Each question: {id, text, choices:[2-4], correct:['A'..], number?, timeLimit?}
 */
export async function parseWorkbook(arrayBuffer) {
  const XLSX = await lib();

  let wb;
  try {
    wb = XLSX.read(arrayBuffer, { type: 'array' });
  } catch (e) {
    console.error('[questions] workbook failed to parse', e);
    throw new Error('That file could not be read as .xlsx.');
  }

  const sheetName = wb.SheetNames && wb.SheetNames[0];
  if (!sheetName) {
    console.error('[questions] workbook has no worksheets');
    throw new Error('The workbook has no worksheets.');
  }

  // header:1 gives raw rows, so the header row can be located rather than assumed.
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1, defval: '', blankrows: false
  });

  const header = findHeaderRow(rows);
  if (!header) {
    console.error(
      '[questions] header row not found in the first ' + HEADER_SCAN_ROWS + ' rows of "' + sheetName + '". ' +
      'Expected "Question Text" + "Answer 1"/"Answer 2", or "question" + "A"/"B"/"correct". ' +
      'First rows seen:',
      rows.slice(0, 5)
    );
    throw new Error('Could not find a header row (need "Question Text" and "Answer 1"/"Answer 2").');
  }

  const questions = [];
  const errors = [];
  let ignored = 0;

  for (let i = header.index + 1; i < rows.length; i++) {
    const result = parseRow(rows[i] || [], header.map, i + 1); // i+1 = Excel row number
    if (result.status === 'ok') questions.push(result.question);
    else if (result.status === 'ignore') ignored++;
    else errors.push(result.reason);
  }

  if (!questions.length) {
    console.error(
      '[questions] no valid questions found. format=' + header.map.format +
      ' headerRow=' + (header.index + 1) + ' ignoredBlankRows=' + ignored,
      errors
    );
  } else {
    console.log(
      '[questions] imported ' + questions.length + ' questions (' + header.map.format +
      ' format, header row ' + (header.index + 1) + ', ' + errors.length + ' skipped, ' +
      ignored + ' blank rows ignored)'
    );
    if (errors.length) console.warn('[questions] skipped rows:', errors);
  }

  return { questions, errors, ignored, format: header.map.format };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Shuffled deck; no repeats until exhausted, then reshuffles. */
export class QuestionDeck {
  constructor(questions) {
    this.all = questions;
    this.pending = shuffle(questions);
  }
  get size() { return this.all.length; }
  draw() {
    if (!this.all.length) return null;
    if (!this.pending.length) this.pending = shuffle(this.all);
    return this.pending.pop();
  }
  /** Public form: never contains the correct answer or any metadata. */
  static toPublic(q) {
    return { id: q.id, text: q.text, choices: q.choices };
  }
}
