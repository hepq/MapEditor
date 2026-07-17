/**
 * Sparebeat公開譜面JSONの型定義。
 * https://sparebeat.com の創作譜面フォーマット。
 */

export interface SparebeatTimelineEventJSON {
  speed?: number;
  bpm?: number;
  barLine?: boolean;
}

/** map配列の各要素。1小節分の文字列、またはBPM/speed/barLine変更オブジェクト */
export type SparebeatMapEntry = string | SparebeatTimelineEventJSON;

export interface SparebeatLevelJSON {
  easy: number | string;
  normal: number | string;
  hard: number | string;
}

export interface SparebeatMapJSON {
  easy: SparebeatMapEntry[];
  normal: SparebeatMapEntry[];
  hard: SparebeatMapEntry[];
}

export interface SparebeatChartJSON {
  title: string;
  artist?: string;
  url?: string;
  bgColor?: [string] | [string, string];
  bpm: number | string;
  startTime: number;
  level: SparebeatLevelJSON;
  map: SparebeatMapJSON;
}

export type SparebeatDifficultyKey = 'easy' | 'normal' | 'hard';
