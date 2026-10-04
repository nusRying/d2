// Slice 47 — focused priority-queue tests ported from
// internal/routing/priority_queue_test.go.
import { describe, it, expect } from 'bun:test';

import {
  PriorityQueue, priorityQueueEntryChunkSize, priorityQueueEntryLess, reservePriorityQueueWork,
} from '../../src/routing/priority-queue.js';
import { goFormatFloat } from '../../src/routing/layoutgraph-route-support.js';

function rejecting(err) {
  return {
    step() { throw err; },
    add() { throw err; },
    check() { throw err; },
  };
}

function recording() {
  return {
    charges: [],
    step() { this.charges.push(1); },
    add(units) { this.charges.push(units); },
    check() {},
  };
}

describe('PriorityQueue', () => {
  it('pops in priority order', () => {
    const queue = new PriorityQueue();
    const large = queue.push(3, null, false, null);
    const medium = queue.push(2, null, false, null);
    const small = queue.push(1, null, false, null);
    for (const want of [small, medium, large]) {
      expect(queue.pop(null)).toBe(want);
    }
    expect(queue.empty()).toBe(true);
  });

  it('decrease moves an entry forward and rejects popped entries', () => {
    const queue = new PriorityQueue();
    const entry = queue.push(3, null, false, null);
    queue.push(2, null, false, null);
    queue.decrease(entry, 1, null);
    expect(queue.pop(null)).toBe(entry);
    expect(() => queue.decrease(entry, 0, null)).toThrow('cannot decrease priority: entry is not in the priority queue');
  });

  it('decrease preserves insertion order on ties', () => {
    const queue = new PriorityQueue();
    const first = queue.push(1, null, false, null);
    const second = queue.push(2, null, false, null);
    queue.decrease(second, 1, null);
    expect(queue.pop(null)).toBe(first);
    expect(queue.pop(null)).toBe(second);
  });

  it('a guard failure does not mutate the queue', () => {
    const errRejected = new Error('reject priority queue work');
    const guard = rejecting(errRejected);

    const pushQueue = new PriorityQueue();
    expect(() => pushQueue.push(1, null, false, guard)).toThrow(errRejected);
    expect(pushQueue.items.length).toBe(0);
    expect(pushQueue.entryCursor).toBe(0);
    expect(pushQueue.nextOrder).toBe(0);
    expect(pushQueue.entryChunks.length).toBe(0);

    const popQueue = new PriorityQueue();
    const first = popQueue.push(1, null, false, null);
    const second = popQueue.push(2, null, false, null);
    let caught = null;
    try {
      popQueue.pop(guard);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(errRejected);
    expect(popQueue.items).toEqual([first, second]);
    expect(popQueue.items[0]).toBe(first);
    expect(first.index).toBe(0);
    expect(second.index).toBe(1);

    const decQueue = new PriorityQueue();
    const entry = decQueue.push(2, null, false, null);
    expect(() => decQueue.decrease(entry, 1, guard)).toThrow(errRejected);
    expect(entry.priority).toBe(2);
    expect(entry.index).toBe(0);
    expect(decQueue.items[0]).toBe(entry);
  });

  it('equal priorities pop in insertion order regardless of axis', () => {
    const queue = new PriorityQueue();
    const want = [
      queue.push(1, null, true, null),
      queue.push(1, null, false, null),
      queue.push(1, null, true, null),
      queue.push(1, null, false, null),
    ];
    for (const entry of want) expect(queue.pop(null)).toBe(entry);
  });

  it('reset reuses entry storage', () => {
    const queue = new PriorityQueue();
    const first = queue.push(1, null, false, null);
    queue.reset();
    const second = queue.push(2, null, false, null);
    expect(second).toBe(first);
    expect(second.priority).toBe(2);
    expect(second.order).toBe(0);
  });

  it('works across entry chunks with decreases', () => {
    const size = priorityQueueEntryChunkSize * 2 + 1;
    const queue = new PriorityQueue();
    const model = [];
    for (let i = 0; i < size; i++) {
      const priority = (i * 37) % 100;
      model.push({ entry: queue.push(priority, null, i % 2 === 0, null), priority, order: i });
    }
    for (let i = 0; i < model.length; i += 17) {
      const priority = -(i + 1);
      queue.decrease(model[i].entry, priority, null);
      model[i].priority = priority;
    }
    model.sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : a.order - b.order));
    for (const want of model) expect(queue.pop(null)).toBe(want.entry);
    expect(queue.entryChunks.length).toBe(3);
  });

  it('reserves bits.Len(bound) work per level before mutating', () => {
    const guard = recording();
    const queue = new PriorityQueue();
    for (let i = 0; i < 5; i++) queue.push(5 - i, null, false, guard);
    queue.decrease(queue.items[4], -1, guard);
    queue.pop(guard);
    // push: bits.Len(1..5) = 1,2,2,3,3; decrease index 4 -> bits.Len(5) = 3; pop len 5 -> 3*2.
    expect(guard.charges).toEqual([1, 2, 2, 3, 3, 3, 6]);
    expect(() => reservePriorityQueueWork(null, 10, 2)).not.toThrow();
  });

  it('reports Go error messages', () => {
    const queue = new PriorityQueue();
    expect(() => queue.pop(null)).toThrow('cannot dequeue minimum of empty priority queue');
    expect(() => queue.decrease(null, 1, null)).toThrow('cannot decrease priority in an empty priority queue');
    const entry = queue.push(1e6, null, false, null);
    expect(() => queue.decrease(null, 1, null)).toThrow('cannot decrease priority: entry is nil');
    expect(() => queue.decrease(entry, 1e21, null)).toThrow('new priority 1e+21 is not less than old priority 1e+06');
  });

  it('orders NaN like Go comparisons', () => {
    const a = { priority: NaN, order: 1 };
    const b = { priority: 1, order: 0 };
    expect(priorityQueueEntryLess(a, b)).toBe(false);
    expect(priorityQueueEntryLess(b, a)).toBe(false);
  });
});

describe('goFormatFloat (%v)', () => {
  it('matches strconv shortest g formatting', () => {
    const cases = [
      [0, '0'], [-0, '-0'], [1, '1'], [-2.5, '-2.5'], [123456, '123456'], [1e6, '1e+06'],
      [1234567, '1.234567e+06'], [0.0001, '0.0001'], [1e-5, '1e-05'], [1.5e-300, '1.5e-300'],
      [1e21, '1e+21'], [NaN, 'NaN'], [Infinity, '+Inf'], [-Infinity, '-Inf'], [0.1, '0.1'],
    ];
    for (const [value, want] of cases) expect(goFormatFloat(value)).toBe(want);
  });
});
