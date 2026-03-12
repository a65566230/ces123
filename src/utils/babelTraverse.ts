// @ts-nocheck

export function resolveBabelTraverse(candidate) {
  let current = candidate;
  const seen = new Set();

  while (current && !seen.has(current)) {
    if (typeof current === 'function') {
      return current;
    }

    seen.add(current);
    current = current.default ?? current['module.exports'];
  }

  throw new TypeError('@babel/traverse export is not callable');
}
