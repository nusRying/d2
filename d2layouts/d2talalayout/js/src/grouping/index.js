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
