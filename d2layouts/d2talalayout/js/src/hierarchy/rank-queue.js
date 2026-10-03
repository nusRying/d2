// Pinned reference: internal/hierarchy/rank_queue.go
//
// NodeMinHeap is a small priority queue of node indexes for stable Kahn
// traversal. Node indexes already follow entity-ID order.

export class NodeMinHeap {
  constructor() {
    this.items = [];
  }

  get length() {
    return this.items.length;
  }

  push(node) {
    const h = this.items;
    h.push(node);
    for (let child = h.length - 1; child > 0;) {
      const parent = Math.trunc((child - 1) / 2);
      if (h[parent] <= h[child]) {
        break;
      }
      const tmp = h[parent];
      h[parent] = h[child];
      h[child] = tmp;
      child = parent;
    }
  }

  pop() {
    const old = this.items;
    const root = old[0];
    const last = old[old.length - 1];
    old.length -= 1;
    if (old.length > 0) {
      old[0] = last;
      for (let parent = 0; ;) {
        const left = parent * 2 + 1;
        if (left >= old.length) {
          break;
        }
        let child = left;
        const right = left + 1;
        if (right < old.length && old[right] < old[left]) {
          child = right;
        }
        if (old[parent] <= old[child]) {
          break;
        }
        const tmp = old[parent];
        old[parent] = old[child];
        old[child] = tmp;
        parent = child;
      }
    }
    return root;
  }
}
