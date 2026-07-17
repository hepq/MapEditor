/**
 * 内部データモデル（CLAUDE.md記載の変換先仕様）の型定義。
 */

export interface ChartProject {
  meta: {
    title: string;
    artist?: string;
    url?: string;
    bgColor?: [string] | [string, string];
    initialBpm: number | string;
    startTime: number; // ms
  };
  difficulties: {
    easy: Difficulty;
    normal: Difficulty;
    hard: Difficulty;
  };
}

export interface Difficulty {
  level: number | string;
  notes: Note[];
  bindZones: BindZone[];
  timelineEvents: TimelineEvent[];
}

export interface Note {
  id: string;
  lane: 0 | 1 | 2 | 3; // D, F, J, K
  tick: number;
  kind: 'tap' | 'long';
  attack?: boolean; // kind: 'tap' のときのみ意味を持つ
  endTick?: number; // kind: 'long' のときのみ
}

export interface BindZone {
  id: string;
  startTick: number;
  endTick: number;
}

export interface TimelineEvent {
  id: string;
  tick: number;
  bpm?: number;
  speed?: number;
  barLine?: boolean;
}
