 
 
export function runs<T>(rows: T[], key: (row: T) => string | number) {
  const result: Array<{ key: string | number; rows: T[]; start: number }> = [];
  rows.forEach((row, index) => {
    const value = key(row), last = result[result.length - 1];
    if (last && last.key === value) last.rows.push(row);
    else result.push({ key: value, rows: [row], start: index });
  });
  return result;
}

export function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : 0;
}

 
 
export function sustainedKdaChange(before: number[], after: number[]) {
  if (before.length < 3 || after.length < 3) return false;
  const baseline = median(before), current = median(after);
  const noise = median(before.map((value) => Math.abs(value - baseline))) * 1.4826;
  const required = Math.max(1, Math.max(1, baseline) * 0.5, noise * 2);
  const direction = Math.sign(current - baseline), half = Math.ceil(after.length / 2);
  return direction !== 0 && [after, after.slice(0, half), after.slice(half)].every((part) =>
    part.length > 0 && direction * (median(part) - baseline) >= required);
}

export function fisherProbability(winsBefore: number, nBefore: number, winsAfter: number, nAfter: number) {
  const logChoose = (n: number, k: number) => {
    let value = 0;
    for (let i = 1; i <= Math.min(k, n - k); i++) value += Math.log(n - i + 1) - Math.log(i);
    return value;
  };
  const wins = winsBefore + winsAfter;
  const probability = (a: number) => Math.exp(logChoose(nBefore, a) + logChoose(nAfter, wins - a) - logChoose(nBefore + nAfter, wins));
  const observed = probability(winsBefore);
  let total = 0;
  for (let a = Math.max(0, wins - nAfter); a <= Math.min(nBefore, wins); a++) {
    const p = probability(a);
    if (p <= observed + 1e-12) total += p;
  }
  return Math.min(1, total);
}

export function sustainedWinChange(before: boolean[], after: boolean[], comparisons: number) {
  const rate = (rows: boolean[]) => rows.filter(Boolean).length / rows.length;
  const delta = rate(after) - rate(before), direction = Math.sign(delta);
  const half = Math.floor(after.length / 2);
  if (!half || Math.abs(delta) < 0.25) return false;
  if ([after.slice(0, half), after.slice(half)].some((part) => direction * (rate(part) - rate(before)) < 0.2)) return false;
   
  return fisherProbability(before.filter(Boolean).length, before.length, after.filter(Boolean).length, after.length) <= 0.05 / Math.max(1, comparisons);
}
