// Matches Go's layoutgraph.Hierarchy
export class Hierarchy {
  constructor() {
    this.levels = new Map();
    this.LevelCount = 0;
  }

  levelsMap() {
    if (this.levels == null) {
      this.levels = new Map();
    }
    return this.levels;
  }

  Levels() {
    return this.levelsMap();
  }

  replaceLevels(levels) {
    this.levels = levels;
  }

  ReplaceLevels(levels) {
    this.replaceLevels(levels);
  }
}

export function newHierarchy() {
  return new Hierarchy();
}

export const NewHierarchy = newHierarchy;
