/**
 * 内部データモデルのDifficultyをSparebeat形式のmap配列へ逆変換するシリアライザー。
 *
 * tick列からカンマ区切りの区切り文字列を復元する。セルの刻みは16分（3tick）と
 * 24分（2tick）の2種類で、全ノーツtick・バインドゾーン境界・区切りtick（TimelineEvent
 * のtick、およびbeatsから機械的に計算される疑似小節境界）がセル開始位置に一致する
 * ようなステップ列をDPで求める。コストはモード切替回数（= 出力される `(` `)` の数）
 * とし、これを最小化する。
 *
 * 実際のSparebeat形式では「1つの文字列 = 1区切り」であり、文字列間には常に線が
 * 挿入されるだけで小節という概念は無い。4/4拍子の小節線はbeatsに従って16分×beats個
 * ごとに文字列を区切り、barLine: trueのTimelineEventを挿入することで疑似的に再現する
 * （その位置に既にbarLineを明示するTimelineEventがある場合はそちらを優先する）。
 * TimelineEvent自体は任意のtickに挿入できる。
 *
 * 出力文字列は入力元のSparebeat JSONと一致するとは限らないが、
 * parseSparebeatChartで再パースすると同一の内部モデルに戻ることを保証する
 * （ただし、beatsから機械的に挿入されたbarLine: trueイベントは一度エクスポートを
 * 経ると内部モデル上も明示的なTimelineEventとして現れるようになる）。
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
 * timelineEventの`beats`変更列から、機械的に挿入すべき疑似小節境界のtick列を求める。
 * 各`beats`変更は、それ以前の拍数で計算した次の境界に届く前に来た場合、そこで区切りを
 * 打ち切って新しい拍数でのステップを再開する（TimelineEventは任意のtickに置けるため、
 * ここでエラーにはしない）。
 * 戻り値にtick=0は含まない（疑似境界は区切りをまたぐ位置だけを表すため）。
 */
function computePseudoBoundaryTicks(
  beatsChangesByTick: Map<number, number>, // 必ずtick=0のエントリを含む
  maxBoundaryTick: number, // ノーツ/括弧から決まる最大tick。無ければ疑似境界は生成しない
): number[] {
  const changeTicks = [...beatsChangesByTick.keys()].sort((a, b) => a - b);
  const boundaries: number[] = [];
  let currentBeats = beatsChangesByTick.get(0)!;
  let changeIdx = 1;
  let tick = 0;

  while (tick <= maxBoundaryTick) {
    const step = currentBeats * 12;
    let next = tick + step;
    if (changeIdx < changeTicks.length && changeTicks[changeIdx] < next) {
      next = changeTicks[changeIdx];
    }
    tick = next;
    boundaries.push(tick);
    if (changeIdx < changeTicks.length && changeTicks[changeIdx] === tick) {
      currentBeats = beatsChangesByTick.get(tick)!;
      changeIdx++;
    }
  }

  return boundaries;
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

  // beats変更イベントから、機械的に挿入する疑似小節境界の位置を求める
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

  // 区切りが必要な範囲: 最後のセルを要するtick（ノーツ・括弧）を含むところまで。
  // 終端がちょうど疑似境界の場合、次の区切りの先頭セルに ] や終点文字が付く
  let maxBoundaryTick = -1;
  for (const tick of cellCharsByTick.keys()) maxBoundaryTick = Math.max(maxBoundaryTick, tick);
  for (const tick of openTicks) maxBoundaryTick = Math.max(maxBoundaryTick, tick);
  for (const tick of closeTicks) maxBoundaryTick = Math.max(maxBoundaryTick, tick);

  const pseudoBoundaryTicks = computePseudoBoundaryTicks(beatsChangesByTick, maxBoundaryTick);
  const pseudoBoundarySet = new Set(pseudoBoundaryTicks);

  // TimelineEventは任意のtickに置けるため、tickごとにグループ化するだけでよい
  const realEventsByTick = new Map<number, TimelineEvent[]>();
  for (const event of difficulty.timelineEvents) {
    let events = realEventsByTick.get(event.tick);
    if (!events) {
      events = [];
      realEventsByTick.set(event.tick, events);
    }
    events.push(event);
  }

  // 区切り点 = 疑似境界tick ∪ 全TimelineEventのtick ∪ {0}
  const boundaries = [...new Set<number>([0, ...pseudoBoundaryTicks, ...realEventsByTick.keys()])].sort(
    (a, b) => a - b,
  );
  const segmentCount = maxBoundaryTick < 0 ? 0 : boundaries.findIndex((b) => b > maxBoundaryTick);
  const totalTicks = boundaries[segmentCount];

  // その区切りで出力すべきイベント列を求める。疑似境界であり、かつ実イベント側で
  // barLineが明示されていなければ、barLine: trueを機械的に追加する
  function eventsJsonAtTick(tick: number): SparebeatTimelineEventJSON[] {
    const reals = realEventsByTick.get(tick) ?? [];
    const jsonList = reals.map(toTimelineEventJSON).filter((json) => Object.keys(json).length > 0);
    if (pseudoBoundarySet.has(tick) && !reals.some((event) => event.barLine !== undefined)) {
      jsonList.push({ barLine: true });
    }
    return jsonList;
  }

  const boundarySet = new Set<number>([...cellCharsByTick.keys(), ...openTicks, ...closeTicks]);
  for (let i = 0; i <= segmentCount; i++) boundarySet.add(boundaries[i]);
  const cells = segmentCount > 0 ? computeCells(boundarySet, totalTicks) : [];

  const cellsBySegment: string[][] = Array.from({ length: segmentCount }, () => []);
  let segmentCursor = 0;
  let prevMode: GridMode = 0;
  for (const cell of cells) {
    while (segmentCursor + 1 < segmentCount && boundaries[segmentCursor + 1] <= cell.startTick) {
      segmentCursor++;
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
    cellsBySegment[segmentCursor].push(text);
    prevMode = cell.mode;
  }

  const entries: SparebeatMapEntry[] = [];
  for (let i = 0; i < segmentCount; i++) {
    entries.push(...eventsJsonAtTick(boundaries[i]));
    entries.push(cellsBySegment[i].join(','));
  }
  // 最後の区切りより後ろに置かれた実イベント（疑似境界だけの通過点は無視する）
  for (let i = segmentCount; i < boundaries.length; i++) {
    const tick = boundaries[i];
    if (!realEventsByTick.has(tick)) continue;
    entries.push(...eventsJsonAtTick(tick));
  }
  return entries;
}
