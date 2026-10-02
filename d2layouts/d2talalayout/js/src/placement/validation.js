/**
 * Formats numeric values to match Go's fmt.Sprintf("%v", val).
 *
 * @param {number} v
 * @returns {string}
 */
function formatGoFloat(v) {
  if (Number.isNaN(v)) return "NaN";
  if (v === Infinity) return "+Inf";
  if (v === -Infinity) return "-Inf";
  return String(v);
}

/**
 * validateCellSize validates that the graph CellSize is a positive integer.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/placement/node_placement.go
 *
 * @param {import("../graph/graph.js").Graph} g
 */
export function validateCellSize(g) {
  const cs = g.CellSize;
  if (
    cs < 1 ||
    Number.isNaN(cs) ||
    !Number.isFinite(cs) ||
    Math.trunc(cs) !== cs
  ) {
    throw new Error(`layout invariant violated: invalid cell size ${formatGoFloat(cs)}`);
  }
}

export const ValidateCellSize = validateCellSize;

/**
 * validateGridAlignment verifies that all non-fixed nodes in the graph are aligned
 * to the graph CellSize. Fixed nodes are exempt from position and alignment checks.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/placement/node_placement.go
 *
 * @param {import("../graph/graph.js").Graph} g
 */
export function validateGridAlignment(g) {
  validateCellSize(g);

  for (const node of g.Nodes) {
    if (node.FixedTopLeft != null) {
      continue;
    }

    if (node.TopLeft == null) {
      throw new Error(`layout invariant violated: node ${node.ID} has no position`);
    }

    const xMod = node.TopLeft.X % g.CellSize;
    const yMod = node.TopLeft.Y % g.CellSize;

    if (xMod !== 0 || yMod !== 0) {
      throw new Error(
        `layout invariant violated: node ${node.ID} at (${formatGoFloat(node.TopLeft.X)}, ${formatGoFloat(node.TopLeft.Y)}) is not aligned to cell size ${formatGoFloat(g.CellSize)}`
      );
    }
  }
}

export const ValidateGridAlignment = validateGridAlignment;

/**
 * validatePlacedNodes checks that all nodes in the given slice have a TopLeft coordinate.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/placement/node_placement.go
 *
 * @param {import("../graph/node.js").Node | null} root
 * @param {Array<import("../graph/node.js").Node>} nodes
 */
export function validatePlacedNodes(root, nodes) {
  if (!nodes) {
    return;
  }

  for (const node of nodes) {
    // A null node naturally fails with TypeError upon accessing node.TopLeft
    if (node.TopLeft == null) {
      const rootID =
        root != null
          ? typeof root.IDValue === "function"
            ? root.IDValue()
            : (root.ID ?? 0)
          : 0;
      throw new Error(
        `layout invariant violated: node ${node.ID} was not placed under container ${rootID}`
      );
    }
  }
}

export const ValidatePlacedNodes = validatePlacedNodes;
