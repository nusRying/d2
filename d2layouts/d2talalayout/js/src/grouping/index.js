export {
  SequenceDefiningEdges,
  // Internal migration / parity testing helpers
  identifySequences,
  isValidRememberedSequence,
  hasNodeID,
  nextAvailableNodeID,
} from "./sequences-analysis.js";

export {
  clearRememberedSequenceMembership,
  buildSequence,
  addSequence,
  abductSequenceEdges,
  addSequences,
  AddSequences,
} from "./sequences-mutation.js";

export {
  // Slice 13 – cluster discovery
  ClusterEdgeSignature,
  ClusterDiscoveryInfo,
  ClusterDiscoveryIndex,
  buildClusterDiscoveryIndex,
  clusterIsDescendantOfGuarded,
  clusterHasLeakyEdgeGuarded,
  clusterIncidentEdges,
} from "./cluster-discovery.js";
