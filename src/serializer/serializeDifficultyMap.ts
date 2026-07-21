/**
 * 内部データモデルのDifficultyをSparebeat形式のmap配列へ逆変換するシリアライザー。
 *
 * tick列からカンマ区切りの小節文字列を復元する。セルの刻みは16分（3tick）と
 * 24分（2tick）の2種類で、全ノーツtick・バインドゾーン境界・小節境界（48tickの
 * 倍数）がセル開始位置に一致するようなステップ列をDPで求める。コストはモード
 * 切替回数（= 出力される `(` `)` の数）とし、これを最小化する。
 *
 * 出力文字列は入力元のSparebeat JSONと一致するとは限らないが、
 * parseSparebeatChartで再パースすると同一の内部モデルに戻ることを保証する。
 */

import type { BindZone, Difficulty, Note, TimelineEvent } from '../types/chartProject';
import type { SparebeatMapEntry, SparebeatTimelineEventJSON } from '../types/sparebeat';

const NORMAL_CHARS = '1234';
const ATTACK_CHARS = '5678';
const LONG_START_CHARS = 'abcd';
const LONG_END_CHARS = 'efgh';

// 同一セル内の文字順。同一レーンでは終点→タップ→始点の順でないと
// パーサーが「前のロングノーツが開いたまま」としてエラーになる
const RANK_LONG_END = 0;
const RANK_TAP = 1;
const RANK_LONG_START = 2;

interface CellChar {
  lane: number;
  rank: number;
  char: string;
}

type GridMode = 0 | 1; // 0 = 16分（3tick）, 1 = 24分（2tick）

const STEP_TICKS: Record<GridMode, number> = { 0: 3, 1: 2 };

interface Cell {
  startTick: number;
  mode: GridMode;
}

function assertValidTick(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}: ${value} (must be a non-negative integer)`);
  }
}

function toTimelineEventJSON(event: TimelineEvent): SparebeatTimelineEventJSON {
  const json: SparebeatTimelineEventJSON = {};
  if (event.bpm !== undefined) json.bpm = event.bpm;
  if (event.speed !== undefined) json.speed = event.speed;
  if (event.barLine !== undefined) json.barLine = event.barLine;
  return json;
}

/**
 * 全境界tickがセル開始位置に一致するような2/3tickステップ列をDPで求める。
 * モード切替回数を最小化し、同コストなら16分を優先する。
 */
function computeCells(boundarySet: Set<number>, totalTicks: number): Cell[] {
  const size = totalTicks + 1;
  // cost[mode][t] = tickゼロからtまで到達し、直前セルがmodeであるときの最小切替回数
  const cost: [number[], number[]] = [new Array(size).fill(Infinity), new Array(size).fill(Infinity)];
  const parentMode: [Int8Array, Int8Array] = [new Int8Array(size).fill(-1), new Int8Array(size).fill(-1)];
  cost[0][0] = 0; // 譜面先頭は16分モード

  for (let t = 0; t < totalTicks; t++) {
    for (const mode of [0, 1] as const) {
      const currentCost = cost[mode][t];
      if (!Number.isFinite(currentCost)) continue;
      for (const nextMode of [0, 1] as const) {
        const t2 = t + STEP_TICKS[nextMode];
        if (t2 > totalTicks) continue;
        // セルの途中に境界tickが来る遷移は不可（境界は必ずセル開始位置に置く）
        let crossesBoundary = false;
        for (let tt = t + 1; tt < t2; tt++) {
          if (boundarySet.has(tt)) {
            crossesBoundary = true;
            break;
          }
        }
        if (crossesBoundary) continue;
        const nextCost = currentCost + (nextMode === mode ? 0 : 1);
        if (nextCost < cost[nextMode][t2]) {
          cost[nextMode][t2] = nextCost;
          parentMode[nextMode][t2] = mode;
        }
      }
    }
  }

  const endMode: GridMode = cost[0][totalTicks] <= cost[1][totalTicks] ? 0 : 1;
  if (!Number.isFinite(cost[endMode][totalTicks])) {
    const sortedBoundaries = [...boundarySet].sort((a, b) => a - b);
    const firstUnreachable = sortedBoundaries.find(
      (b) => !Number.isFinite(cost[0][b]) && !Number.isFinite(cost[1][b]),
    );
    throw new Error(
      `Cannot lay out tick ${firstUnreachable ?? totalTicks} on the 16th/24th note grid`,
    );
  }

  const cells: Cell[] = [];
  let t = totalTicks;
  let mode = endMode;
  while (t > 0) {
    const startTick = t - STEP_TICKS[mode];
    cells.push({ startTick, mode });
    const prev = parentMode[mode][t] as GridMode;
    t = startTick;
    mode = prev;
  }
  return cells.reverse();
}

/**
 * timelineEventの`beats`変更列から可変長の小節境界tick列を求める。
 * 各`beats`変更は、それまでの拍子で計算した小節境界に一致していなければならない。
 */
function computeMeasureBoundaries(
  beatsChangesByTick: Map<number, number>, // 必ずtick=0のエントリを含む
  maxBoundaryTick: number, // ノーツ/括弧から決まる最大tick。無ければ-1
  maxEventTick: number, // 全timelineEventのうち最大tick。無ければ-1
): { boundaries: number[]; measureCount: number } {
  const changeTicks = [...beatsChangesByTick.keys()].sort((a, b) => a - b);
  const overallTarget = Math.max(maxBoundaryTick, maxEventTick);

  const boundaries: number[] = [0];
  let currentBeats = beatsChangesByTick.get(0)!;
  let changeIdx = 1;
  let tick = 0;

  while (tick <= overallTarget) {
    const step = currentBeats * 12;
    const next = tick + step;
    if (changeIdx < changeTicks.length && changeTicks[changeIdx] < next) {
      throw new Error(
        `Timeline event must be on a measure boundary ` +
          `(beats change at tick ${changeTicks[changeIdx]} does not align with the ` +
          `current ${currentBeats}-beat (${step}-tick) measure grid starting at tick ${tick})`,
      );
    }
    tick = next;
    boundaries.push(tick);
    if (changeIdx < changeTicks.length && changeTicks[changeIdx] === tick) {
      currentBeats = beatsChangesByTick.get(tick)!;
      changeIdx++;
    }
  }

  const measureCount = maxBoundaryTick < 0 ? 0 : boundaries.findIndex((b) => b > maxBoundaryTick);
  return { boundaries, measureCount };
}

function collectCellChars(notes: Note[]): Map<number, CellChar[]> {
  const cellCharsByTick = new Map<number, CellChar[]>();
  const addCellChar = (tick: number, lane: number, rank: number, char: string) => {
    let chars = cellCharsByTick.get(tick);
    if (!chars) {
      chars = [];
      cellCharsByTick.set(tick, chars);
    }
    chars.push({ lane, rank, char });
  };

  const longIntervalsByLane: { startTick: number; endTick: number }[][] = [[], [], [], []];

  for (const note of notes) {
    assertValidTick(note.tick, `tick of note '${note.id}'`);
    if (note.kind === 'tap') {
      addCellChar(note.tick, note.lane, RANK_TAP, (note.attack ? ATTACK_CHARS : NORMAL_CHARS)[note.lane]);
    } else {
      if (note.endTick === undefined) {
        throw new Error(`Long note '${note.id}' is missing endTick`);
      }
      assertValidTick(note.endTick, `endTick of note '${note.id}'`);
      if (note.endTick <= note.tick) {
        throw new Error(
          `Long note '${note.id}' must end after it starts (tick ${note.tick}, endTick ${note.endTick})`,
        );
      }
      addCellChar(note.tick, note.lane, RANK_LONG_START, LONG_START_CHARS[note.lane]);
      addCellChar(note.endTick, note.lane, RANK_LONG_END, LONG_END_CHARS[note.lane]);
      longIntervalsByLane[note.lane].push({ startTick: note.tick, endTick: note.endTick });
    }
  }

  for (const [lane, intervals] of longIntervalsByLane.entries()) {
    intervals.sort((a, b) => a.startTick - b.startTick);
    for (let i = 1; i < intervals.length; i++) {
      if (intervals[i].startTick < intervals[i - 1].endTick) {
        throw new Error(
          `Overlapping long notes on lane ${lane} ` +
            `(ticks ${intervals[i - 1].startTick}-${intervals[i - 1].endTick} and ` +
            `${intervals[i].startTick}-${intervals[i].endTick})`,
        );
      }
    }
  }

  return cellCharsByTick;
}

function collectBindTicks(bindZones: BindZone[]): { openTicks: Set<number>; closeTicks: Set<number> } {
  const sorted = [...bindZones].sort((a, b) => a.startTick - b.startTick);
  const openTicks = new Set<number>();
  const closeTicks = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    const zone = sorted[i];
    assertValidTick(zone.startTick, `startTick of bind zone '${zone.id}'`);
    assertValidTick(zone.endTick, `endTick of bind zone '${zone.id}'`);
    if (zone.endTick <= zone.startTick) {
      throw new Error(
        `Bind zone '${zone.id}' must end after it starts (startTick ${zone.startTick}, endTick ${zone.endTick})`,
      );
    }
    if (i > 0 && zone.startTick < sorted[i - 1].endTick) {
      throw new Error(
        `Overlapping bind zones '${sorted[i - 1].id}' and '${zone.id}' ` +
          `(ticks ${sorted[i - 1].startTick}-${sorted[i - 1].endTick} and ${zone.startTick}-${zone.endTick})`,
      );
    }
    openTicks.add(zone.startTick);
    closeTicks.add(zone.endTick);
  }

  return { openTicks, closeTicks };
}

export function serializeDifficultyMap(difficulty: Difficulty): SparebeatMapEntry[] {
  const cellCharsByTick = collectCellChars(difficulty.notes);
  const { openTicks, closeTicks } = collectBindTicks(difficulty.bindZones);

  // beats変更イベントから可変長の小節境界を求める
  const beatsChangesByTick = new Map<number, number>();
  for (const event of difficulty.timelineEvents) {
    assertValidTick(event.tick, `tick of timeline event '${event.id}'`);
    if (event.beats !== undefined) {
      if (!Number.isInteger(event.beats) || event.beats <= 0) {
        throw new Error(
          `Invalid beats value for timeline event '${event.id}': ${event.beats} (must be a positive integer)`,
        );
      }
      if (beatsChangesByTick.has(event.tick) && beatsChangesByTick.get(event.tick) !== event.beats) {
        throw new Error(
          `Conflicting beats values at tick ${event.tick}: ` +
            `${beatsChangesByTick.get(event.tick)} vs ${event.beats} (timeline event '${event.id}')`,
        );
      }
      beatsChangesByTick.set(event.tick, event.beats);
    }
  }
  if (!beatsChangesByTick.has(0)) beatsChangesByTick.set(0, 4); // 手組みモデル向けの防御的デフォルト

  // 小節数: 最後のセルを要するtick（ノーツ・括弧）を含むところまで。
  // 終端がちょうど小節境界の場合、次の小節の先頭セルに ] や終点文字が付く
  let maxBoundaryTick = -1;
  for (const tick of cellCharsByTick.keys()) maxBoundaryTick = Math.max(maxBoundaryTick, tick);
  for (const tick of openTicks) maxBoundaryTick = Math.max(maxBoundaryTick, tick);
  for (const tick of closeTicks) maxBoundaryTick = Math.max(maxBoundaryTick, tick);

  let maxEventTick = -1;
  for (const event of difficulty.timelineEvents) maxEventTick = Math.max(maxEventTick, event.tick);

  const { boundaries, measureCount } = computeMeasureBoundaries(beatsChangesByTick, maxBoundaryTick, maxEventTick);
  const boundaryIndex = new Map(boundaries.map((t, i) => [t, i]));
  const totalTicks = boundaries[measureCount];

  // timelineEventオブジェクトは小節と小節の間にしか置けないため、小節境界のtickのみ許可
  const eventsByMeasure = new Map<number, SparebeatTimelineEventJSON[]>();
  for (const event of difficulty.timelineEvents) {
    const idx = boundaryIndex.get(event.tick);
    if (idx === undefined) {
      throw new Error(
        `Timeline event '${event.id}' must be on a measure boundary ` +
          `(tick ${event.tick} does not align with the configured beats/measure grid)`,
      );
    }
    const json = toTimelineEventJSON(event);
    if (Object.keys(json).length === 0) continue; // beatsのみの内部マーカーは出力しない
    let events = eventsByMeasure.get(idx);
    if (!events) {
      events = [];
      eventsByMeasure.set(idx, events);
    }
    events.push(json);
  }

  const boundarySet = new Set<number>([...cellCharsByTick.keys(), ...openTicks, ...closeTicks]);
  for (let i = 0; i <= measureCount; i++) boundarySet.add(boundaries[i]);
  const cells = measureCount > 0 ? computeCells(boundarySet, totalTicks) : [];

  const cellsByMeasure: string[][] = Array.from({ length: measureCount }, () => []);
  let measureCursor = 0;
  let prevMode: GridMode = 0;
  for (const cell of cells) {
    while (measureCursor + 1 < measureCount && boundaries[measureCursor + 1] <= cell.startTick) {
      measureCursor++;
    }
    let text = '';
    if (prevMode === 1 && cell.mode === 0) text += ')';
    if (closeTicks.has(cell.startTick)) text += ']';
    if (openTicks.has(cell.startTick)) text += '[';
    if (prevMode === 0 && cell.mode === 1) text += '(';
    const chars = cellCharsByTick.get(cell.startTick);
    if (chars) {
      chars.sort((a, b) => a.lane - b.lane || a.rank - b.rank);
      text += chars.map((c) => c.char).join('');
    }
    cellsByMeasure[measureCursor].push(text);
    prevMode = cell.mode;
  }

  const entries: SparebeatMapEntry[] = [];
  for (let i = 0; i < measureCount; i++) {
    const events = eventsByMeasure.get(i);
    if (events) entries.push(...events);
    entries.push(cellsByMeasure[i].join(','));
  }
  // 最終小節より後ろに置かれたイベント
  const trailingMeasureIndices = [...eventsByMeasure.keys()]
    .filter((i) => i >= measureCount)
    .sort((a, b) => a - b);
  for (const i of trailingMeasureIndices) {
    entries.push(...eventsByMeasure.get(i)!);
  }
  return entries;
}
