// Exact port of Go's slices.SortStableFunc (src/slices/zsortanyfunc.go:
// stableCmpFunc, insertionSortCmpFunc, symMergeCmpFunc, rotateCmpFunc,
// swapRangeCmpFunc). The swap sequence is reproduced exactly so comparators
// that are not strict weak orders (as in loops.edgesInOrder) produce the same
// permutation as Go.

function insertionSort(data, a, b, cmp) {
  for (let i = a + 1; i < b; i++) {
    for (let j = i; j > a && cmp(data[j], data[j - 1]) < 0; j--) {
      const tmp = data[j];
      data[j] = data[j - 1];
      data[j - 1] = tmp;
    }
  }
}

function swapRange(data, a, b, n) {
  for (let i = 0; i < n; i++) {
    const tmp = data[a + i];
    data[a + i] = data[b + i];
    data[b + i] = tmp;
  }
}

function rotate(data, a, m, b) {
  let i = m - a;
  let j = b - m;
  while (i !== j) {
    if (i > j) {
      swapRange(data, m - i, m, j);
      i -= j;
    } else {
      swapRange(data, m - i, m + j - i, i);
      j -= i;
    }
  }
  swapRange(data, m - i, m, i);
}

function symMerge(data, a, m, b, cmp) {
  if (m - a === 1) {
    let i = m;
    let j = b;
    while (i < j) {
      const h = (i + j) >>> 1;
      if (cmp(data[h], data[a]) < 0) {
        i = h + 1;
      } else {
        j = h;
      }
    }
    for (let k = a; k < i - 1; k++) {
      const tmp = data[k];
      data[k] = data[k + 1];
      data[k + 1] = tmp;
    }
    return;
  }

  if (b - m === 1) {
    let i = a;
    let j = m;
    while (i < j) {
      const h = (i + j) >>> 1;
      if (!(cmp(data[m], data[h]) < 0)) {
        i = h + 1;
      } else {
        j = h;
      }
    }
    for (let k = m; k > i; k--) {
      const tmp = data[k];
      data[k] = data[k - 1];
      data[k - 1] = tmp;
    }
    return;
  }

  const mid = (a + b) >>> 1;
  const n = mid + m;
  let start;
  let r;
  if (m > mid) {
    start = n - b;
    r = mid;
  } else {
    start = a;
    r = m;
  }
  const p = n - 1;

  while (start < r) {
    const c = (start + r) >>> 1;
    if (!(cmp(data[p - c], data[c]) < 0)) {
      start = c + 1;
    } else {
      r = c;
    }
  }

  const end = n - start;
  if (start < m && m < end) {
    rotate(data, start, m, end);
  }
  if (a < start && start < mid) {
    symMerge(data, a, start, mid, cmp);
  }
  if (mid < end && end < b) {
    symMerge(data, mid, end, b, cmp);
  }
}

/**
 * goSortStableFunc sorts data in place exactly like Go slices.SortStableFunc.
 */
export function goSortStableFunc(data, cmp) {
  const n = data.length;
  let blockSize = 20;
  let a = 0;
  let b = blockSize;
  while (b <= n) {
    insertionSort(data, a, b, cmp);
    a = b;
    b += blockSize;
  }
  insertionSort(data, a, n, cmp);

  while (blockSize < n) {
    a = 0;
    b = 2 * blockSize;
    while (b <= n) {
      symMerge(data, a, a + blockSize, b, cmp);
      a = b;
      b += 2 * blockSize;
    }
    const m = a + blockSize;
    if (m < n) {
      symMerge(data, a, m, n, cmp);
    }
    blockSize *= 2;
  }
  return data;
}
