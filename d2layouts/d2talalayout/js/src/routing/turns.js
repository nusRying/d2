// Slice 47 — ideal turn axes between two nodes.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/turns.go

/** idealTurnAxes → [{isX, val}] in pinned case order. */
export function idealTurnAxes(nodeA, nodeB) {
  const x1 = nodeA.TopLeft.X;
  const y1 = nodeA.TopLeft.Y;
  const x1b = nodeA.TopLeft.X + nodeA.Width;
  const y1b = nodeA.TopLeft.Y + nodeA.Height;
  const x2 = nodeB.TopLeft.X;
  const y2 = nodeB.TopLeft.Y;
  const x2b = nodeB.TopLeft.X + nodeB.Width;
  const y2b = nodeB.TopLeft.Y + nodeB.Height;

  const left = x2b < x1;
  const right = x1b < x2;
  const top = y2b < y1;
  const bottom = y1b < y2;

  const axes = [];
  if (top && left) {
    axes.push({ isX: true, val: (x1 + x2b) / 2 }, { isX: false, val: (y1 + y2b) / 2 });
  } else if (left && bottom) {
    axes.push({ isX: true, val: (x1 + x2b) / 2 }, { isX: false, val: (y2 + y1b) / 2 });
  } else if (bottom && right) {
    axes.push({ isX: true, val: (x2 + x1b) / 2 }, { isX: false, val: (y2 + y1b) / 2 });
  } else if (right && top) {
    axes.push({ isX: true, val: (x2 + x1b) / 2 }, { isX: false, val: (y1 + y2b) / 2 });
  } else if (left) {
    axes.push({ isX: true, val: (x1 + x2b) / 2 });
  } else if (right) {
    axes.push({ isX: true, val: (x2 + x1b) / 2 });
  } else if (bottom) {
    axes.push({ isX: false, val: (y2 + y1b) / 2 });
  } else if (top) {
    axes.push({ isX: false, val: (y1 + y2b) / 2 });
  }
  return axes;
}
