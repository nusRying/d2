import { describe, it, expect } from 'bun:test';
import { Graph } from '../../src/graph/graph.js';
import { Node } from '../../src/graph/node.js';
import { Point } from '../../src/geometry/point.js';
import {
  Transaction,
  TransactionOptions,
  InvalidCandidateError,
  NonImprovingCandidateError,
  ErrInvalidCandidate,
  ErrNonImprovingCandidate,
  isCandidateRejection,
} from '../../src/graph/transaction.js';

describe('Slice 44 — Transaction Substrate', () => {
  function createGraph(cellSize = 10) {
    const g = new Graph();
    g.CellSize = cellSize;
    return g;
  }

  function addNode(g, id, x, y, width = 20, height = 20) {
    const n = new Node(BigInt(id), width, height);
    n.TopLeft = new Point(x, y);
    n.Graph = g;
    g.addNode(n);
    return n;
  }

  describe('Candidate Rejection Errors', () => {
    it('implements instance-based candidate rejection checks', () => {
      const invErr = new InvalidCandidateError('test invalid');
      const nonImpErr = new NonImprovingCandidateError('test non improving');
      const genericErr = new Error('generic error');

      expect(isCandidateRejection(invErr)).toBe(true);
      expect(isCandidateRejection(nonImpErr)).toBe(true);
      expect(isCandidateRejection(ErrInvalidCandidate)).toBe(true);
      expect(isCandidateRejection(ErrNonImprovingCandidate)).toBe(true);
      expect(isCandidateRejection(genericErr)).toBe(false);
      expect(isCandidateRejection(null)).toBe(false);
      expect(isCandidateRejection(undefined)).toBe(false);
    });
  });

  describe('Transaction Lifecycle', () => {
    it('commits valid moves and updates state', () => {
      const g = createGraph();
      const n1 = addNode(g, 1, 0, 0, 10, 10);
      const n2 = addNode(g, 2, 50, 50, 10, 10);

      const [txn, err] = g.newRequestTransaction({}, { affectContainers: false });
      expect(err).toBeNull();
      expect(txn).toBeInstanceOf(Transaction);

      txn.addOp(() => {
        n1.moveAbsWithChildren(20, 20);
      });

      const commitErr = txn.commit({});
      expect(commitErr).toBeNull();
      expect(n1.TopLeft.X).toBe(20);
      expect(n1.TopLeft.Y).toBe(20);

      const updateErr = txn.updateState();
      expect(updateErr).toBeNull();

      // Original dimensions should reflect initial snapshot
      const [origW, origH] = txn.originalDimensions(n1);
      expect(origW).toBe(10);
      expect(origH).toBe(10);
    });

    it('rolls back rejected moves restoring original geometry', () => {
      const g = createGraph();
      const n1 = addNode(g, 1, 0, 0, 10, 10);

      const [txn] = g.newRequestTransaction({}, {});
      txn.addOp(() => {
        n1.moveAbsWithChildren(100, 100);
      });

      // Rollback without commit
      txn.rollback();
      expect(n1.TopLeft.X).toBe(0);
      expect(n1.TopLeft.Y).toBe(0);
    });

    it('rejects candidate move that creates an overlap', () => {
      const g = createGraph();
      const n1 = addNode(g, 1, 0, 0, 20, 20);
      const n2 = addNode(g, 2, 50, 50, 20, 20);

      const [txn] = g.newRequestTransaction({}, {});
      txn.addOp(() => {
        // Move n1 directly on top of n2
        n1.moveAbsWithChildren(50, 50);
      });

      const commitErr = txn.commit({});
      expect(commitErr).not.toBeNull();
      expect(isCandidateRejection(commitErr)).toBe(true);

      // State is rolled back on rejection
      expect(n1.TopLeft.X).toBe(0);
      expect(n1.TopLeft.Y).toBe(0);
    });

    it('clones geometry context independently', () => {
      const g = createGraph();
      const n1 = addNode(g, 1, 0, 0, 10, 10);

      const [txn] = g.newRequestTransaction({}, {});
      const [clonedTxn, cloneErr] = txn.cloneGeometryContext();
      expect(cloneErr).toBeNull();
      expect(clonedTxn).toBeInstanceOf(Transaction);
      expect(clonedTxn).not.toBe(txn);

      clonedTxn.addOp(() => {
        n1.moveAbsWithChildren(30, 30);
      });
      const commitErr = clonedTxn.commit({});
      expect(commitErr).toBeNull();
      expect(n1.TopLeft.X).toBe(30);

      // Rolling back cloned transaction restores to snapshot
      clonedTxn.rollback();
      expect(n1.TopLeft.X).toBe(0);
    });

    it('preserves prior graph state across transactions', () => {
      const g = createGraph();
      const n1 = addNode(g, 1, 0, 0, 10, 10);

      const [txn1] = g.newRequestTransaction({}, {});
      const priorState = txn1.PriorGraphState;
      expect(priorState).not.toBeNull();

      const [txn2] = g.newRequestTransaction({}, {});
      txn2.preservePriorGraphState(priorState);
      expect(txn2.PriorGraphState).toBe(priorState);
    });
  });

  describe('Graph Overlap & Bad State Validation', () => {
    it('isBadStateContext detects exact and bad overlaps', () => {
      const g = createGraph();
      const n1 = addNode(g, 1, 0, 0, 20, 20);
      const n2 = addNode(g, 2, 10, 10, 20, 20); // overlaps with n1

      const [isBad] = g.isBadStateContext(n2, null, false);
      expect(isBad).toBe(true);
    });

    it('isStructurallyBadStateWithFixedOriginContext enforces fixed origin positions', () => {
      const g = createGraph();
      const n1 = addNode(g, 1, 0, 0, 20, 20);
      n1.FixedTopLeft = new Point(0, 0);

      // Valid: at fixed origin
      const [badValid] = g.isStructurallyBadStateWithFixedOriginContext(n1, null, false);
      expect(badValid).toBe(false);
    });
  });
});
