// Quiz mode: "Find your scaphoid!" Asks for bones you can see and tap in the picture.
// You score a point for finding a bone on the first tap. After a wrong tap you
// get a clue, and after three wrong taps the app shows you where it is.

import { BONE_INFO } from './facts.js';

const QUESTIONS = 10;
const MAX_FINGER_QUESTIONS = 3; // finger bones look alike, so don't let them take over
const GREEN = '#6fe28a', RED = '#ff6b6b', AMBER = '#ffe066';

const $ = (id) => document.getElementById(id);

const quiz = {
  active: false,
  view: null,
  order: [],
  index: 0,
  score: 0,
  tries: 0,
  answered: false,
  finished: false,
  missed: [],
  marks: [],
  tag: null,
  onEnd: null,
};

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickQuestions(pool) {
  let fingers = 0;
  const picked = [];
  for (const id of shuffle([...pool])) {
    if (BONE_INFO[id].group === 'phalanx' && ++fingers > MAX_FINGER_QUESTIONS) continue;
    picked.push(id);
    if (picked.length === QUESTIONS) break;
  }
  return picked;
}

// localStorage can be blocked (private windows), so failures are ignored
function bestKey(view) { return `xray-best-${view}`; }
function readBest(view) {
  try { return Number(localStorage.getItem(bestKey(view))) || 0; } catch { return 0; }
}
function saveBest(view, score) {
  try { localStorage.setItem(bestKey(view), String(score)); } catch { /* best score just isn't kept */ }
}

export function startQuiz(view, pool, onEnd) {
  Object.assign(quiz, {
    active: true, view, order: pickQuestions(pool), index: 0, score: 0, missed: [], finished: false, onEnd,
  });
  $('quiz').hidden = false;
  ask();
}

export function endQuiz() {
  if (!quiz.active) return;
  quiz.active = false;
  quiz.marks = [];
  quiz.tag = null;
  $('quiz').hidden = true;
  if (quiz.onEnd) quiz.onEnd();
}

function target() {
  return BONE_INFO[quiz.order[quiz.index]];
}

function ask() {
  quiz.tries = 0;
  quiz.answered = false;
  quiz.marks = [];
  quiz.tag = null;
  $('quizProgress').textContent = `Question ${quiz.index + 1} of ${quiz.order.length}`;
  $('quizScore').textContent = `Score ${quiz.score}`;
  $('quizQuestion').textContent = `Find your ${lowerName(target().name)}!`;
  setFeedback('Tap the bone on the picture.', '');
  $('quizHint').hidden = false;
  $('quizSkip').hidden = false;
  $('quizNext').hidden = true;
  $('quizAgain').hidden = true;
}

// "True ribs" reads better as "true ribs", but keep names like "1st metacarpal" as they are
function lowerName(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function setFeedback(text, kind) {
  const el = $('quizFeedback');
  el.textContent = text;
  el.className = 'quiz-feedback ' + kind;
}

function reveal(prefix) {
  const id = quiz.order[quiz.index];
  const correct = prefix.startsWith('Correct');
  quiz.answered = true;
  quiz.marks = [{ id, color: correct ? GREEN : AMBER }];
  quiz.tag = { id, color: correct ? GREEN : AMBER };
  if (!correct) quiz.missed.push(id);
  setFeedback(`${prefix} ${target().text}`, correct ? 'good' : 'info');
  $('quizHint').hidden = true;
  $('quizSkip').hidden = true;
  $('quizNext').hidden = false;
  $('quizNext').textContent = quiz.index + 1 < quiz.order.length ? 'Next bone' : 'See my score';
  $('quizScore').textContent = `Score ${quiz.score}`;
}

// hit is what the tap landed on, or null if it missed every bone
export function quizTap(hit) {
  if (!quiz.active || quiz.answered || quiz.finished) return;
  if (!hit) {
    setFeedback('That was not on a bone. Try tapping right on one.', 'info');
    return;
  }
  if (hit.id === quiz.order[quiz.index]) {
    if (quiz.tries === 0) quiz.score++;
    reveal(quiz.tries === 0 ? 'Correct!' : 'Correct, you got there!');
    return;
  }
  quiz.tries++;
  quiz.marks = [{ fig: hit.fig, id: hit.id, part: hit.part, color: RED }];
  const tapped = BONE_INFO[hit.id].name;
  if (quiz.tries >= 3) {
    reveal(`That was your ${lowerName(tapped)}. Here is the right one.`);
    return;
  }
  setFeedback(`That is your ${lowerName(tapped)}. Clue: ${target().clue}`, 'bad');
}

function finish() {
  quiz.finished = true;
  quiz.marks = [];
  quiz.tag = null;
  const total = quiz.order.length;
  const best = readBest(quiz.view);
  if (quiz.score > best) saveBest(quiz.view, quiz.score);
  $('quizProgress').textContent = 'Quiz complete';
  $('quizScore').textContent = quiz.score > best ? 'New best!' : `Best ${best}`;
  $('quizQuestion').textContent = `You found ${quiz.score} of ${total} bones first time!`;
  const review = [...new Set(quiz.missed)].map((id) => BONE_INFO[id].name);
  setFeedback(review.length ? `Worth another look: ${review.join(', ')}.` : 'A perfect round. Nothing to review!', 'info');
  $('quizHint').hidden = true;
  $('quizSkip').hidden = true;
  $('quizNext').hidden = true;
  $('quizAgain').hidden = false;
}

$('quizHint').addEventListener('click', () => setFeedback(`Clue: ${target().clue}`, 'info'));
$('quizSkip').addEventListener('click', () => reveal('Skipped. Here it is.'));
$('quizNext').addEventListener('click', () => {
  quiz.index++;
  if (quiz.index < quiz.order.length) ask(); else finish();
});
$('quizEnd').addEventListener('click', endQuiz);

// Play again with the same picture; the caller supplies the bones in view
export function onPlayAgain(getPool) {
  $('quizAgain').addEventListener('click', () => startQuiz(quiz.view, getPool(), quiz.onEnd));
}

export { quiz };
