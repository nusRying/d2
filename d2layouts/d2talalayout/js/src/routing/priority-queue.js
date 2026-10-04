// Slice 47 — indexed binary min-heap used by the OVG Dijkstra search.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/priority_queue.go
//
// Entries keep their heap index so a queued distance can be lowered without
// a lookup. Equal priorities pop in insertion order. Entries are allocated
// from fixed-size chunks and reused after reset, exactly like Go: an entry
// returned before reset is the same object handed out again afterwards.
//
// A Go `workBudget` is any object with step()/add(n)/check() that throws the
// error Go would return. A null guard charges nothing.

import { goFormatFloat } from './layoutgraph-route-support.js';

export const priorityQueueEntryChunkSize = 256;

/** priorityQueueEntry. */
export class PriorityQueueEntry {
  constructor() {
    this.node = null;
    this.isHorizontal = false;
    this.priority = 0;
    this.index = 0;
    this.order = 0;
  }
}

// bits.Len(uint(n)) for a non-negative int.
function bitsLen(n) {
  let length = 0;
  for (let remaining = n; remaining > 0; remaining = Math.floor(remaining / 2)) {
    length++;
  }
  return length;
}

/** reservePriorityQueueWork charges bits.Len(upperBound) * unitsPerLevel. */
export function reservePriorityQueueWork(guard, upperBound, unitsPerLevel) {
  if (guard == null) {
    return;
  }
  guard.add(bitsLen(upperBound) * unitsPerLevel);
}

/** priorityQueueEntryLess: priority, then insertion order. */
export function priorityQueueEntryLess(a, b) {
  if (a.priority !== b.priority) {
    return a.priority < b.priority;
  }
  // Preserve insertion order for equal-cost states.
  return a.order < b.order;
}

/** priorityQueue. The zero value (new PriorityQueue()) is ready to use. */
export class PriorityQueue {
  constructor() {
    this.items = [];
    this.entryChunks = [];
    this.entryCursor = 0;
    this.nextOrder = 0;
  }

  /** reset empties the queue while retaining entry storage. */
  reset() {
    this.items.length = 0;
    this.entryCursor = 0;
    this.nextOrder = 0;
  }

  empty() {
    return this.items.length === 0;
  }

  push(priority, node, isHorizontal, guard) {
    reservePriorityQueueWork(guard, this.items.length + 1, 1);

    const entry = this.allocateEntry(priority);
    entry.node = node;
    entry.isHorizontal = isHorizontal;
    entry.index = this.items.length;
    entry.order = this.nextOrder;
    this.nextOrder++;
    this.items.push(entry);
    this.siftUp(entry.index);
    return entry;
  }

  pop(guard) {
    if (this.empty()) {
      throw new Error('cannot dequeue minimum of empty priority queue');
    }
    reservePriorityQueueWork(guard, this.items.length, 2);

    const min = this.items[0];
    const lastIndex = this.items.length - 1;
    const last = this.items[lastIndex];
    this.items.length = lastIndex;
    min.index = -1;

    if (lastIndex !== 0) {
      this.items[0] = last;
      last.index = 0;
      this.siftDown(0);
    }
    return min;
  }

  decrease(entry, priority, guard) {
    if (this.empty()) {
      throw new Error('cannot decrease priority in an empty priority queue');
    }
    if (entry == null) {
      throw new Error('cannot decrease priority: entry is nil');
    }
    if (entry.index < 0 || entry.index >= this.items.length || this.items[entry.index] !== entry) {
      throw new Error('cannot decrease priority: entry is not in the priority queue');
    }
    if (priority >= entry.priority) {
      throw new Error(`new priority ${goFormatFloat(priority)} is not less than old priority ${goFormatFloat(entry.priority)}`);
    }
    reservePriorityQueueWork(guard, entry.index + 1, 1);

    entry.priority = priority;
    this.siftUp(entry.index);
  }

  allocateEntry(priority) {
    const chunkIndex = Math.floor(this.entryCursor / priorityQueueEntryChunkSize);
    const offset = this.entryCursor % priorityQueueEntryChunkSize;
    if (chunkIndex === this.entryChunks.length) {
      const chunk = new Array(priorityQueueEntryChunkSize);
      for (let i = 0; i < priorityQueueEntryChunkSize; i++) {
        chunk[i] = new PriorityQueueEntry();
      }
      this.entryChunks.push(chunk);
    }
    this.entryCursor++;

    const entry = this.entryChunks[chunkIndex][offset];
    // *entry = priorityQueueEntry{priority: priority, index: -1}
    entry.node = null;
    entry.isHorizontal = false;
    entry.priority = priority;
    entry.index = -1;
    entry.order = 0;
    return entry;
  }

  siftUp(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.less(index, parent)) {
        return;
      }
      this.swap(index, parent);
      index = parent;
    }
  }

  siftDown(index) {
    for (;;) {
      const left = index * 2 + 1;
      if (left >= this.items.length) {
        return;
      }
      let smallest = left;
      const right = left + 1;
      if (right < this.items.length && this.less(right, left)) {
        smallest = right;
      }
      if (!this.less(smallest, index)) {
        return;
      }
      this.swap(index, smallest);
      index = smallest;
    }
  }

  less(left, right) {
    return priorityQueueEntryLess(this.items[left], this.items[right]);
  }

  swap(left, right) {
    const items = this.items;
    const tmp = items[left];
    items[left] = items[right];
    items[right] = tmp;
    items[left].index = left;
    items[right].index = right;
  }
}
