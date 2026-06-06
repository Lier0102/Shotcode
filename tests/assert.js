// Minimal assertion helpers for the regression-test harness.
// Each failure throws an AssertionError carrying actual/expected so the
// runner can render a useful diff.

export class AssertionError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'AssertionError';
    this.isAssertion = true;
    this.detail = detail;
  }
}

function fail(message, detail) {
  throw new AssertionError(message, detail);
}

export function eq(actual, expected, msg) {
  if (actual !== expected) {
    fail(msg || 'values are not strictly equal', { actual, expected });
  }
}

export function notEq(actual, expected, msg) {
  if (actual === expected) {
    fail(msg || 'values are unexpectedly equal', { actual, expected });
  }
}

export function deepEq(actual, expected, msg) {
  const a = JSON.stringify(actual, null, 2);
  const b = JSON.stringify(expected, null, 2);
  if (a !== b) {
    fail(msg || 'deep equality failed', { actual, expected });
  }
}

export function ok(value, msg) {
  if (!value) {
    fail(msg || 'expected truthy value', { actual: value });
  }
}

export function notOk(value, msg) {
  if (value) {
    fail(msg || 'expected falsy value', { actual: value });
  }
}

export function some(arr, predicate, msg) {
  if (!Array.isArray(arr) || !arr.some(predicate)) {
    fail(msg || 'no element matched predicate', { actual: arr });
  }
}

export function none(arr, predicate, msg) {
  if (Array.isArray(arr) && arr.some(predicate)) {
    const matched = arr.filter(predicate);
    fail(msg || 'unexpected element matched predicate', { actual: matched });
  }
}

export function countOf(arr, predicate, expected, msg) {
  const n = Array.isArray(arr) ? arr.filter(predicate).length : -1;
  if (n !== expected) {
    fail(msg || `expected ${expected} matches, got ${n}`, { actual: arr });
  }
}
