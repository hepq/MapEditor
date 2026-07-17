import { describe, it, expect } from 'vitest';
import { serializeDifficultyMap } from './serializeDifficultyMap';
import { parseSparebeatChart } from '../parser/parseSparebeatChart';
import type { BindZone, Difficulty, Note, TimelineEvent } from '../types/chartProject';
import type { SparebeatMapEntry } from '../types/sparebeat';

let idCounter = 0;

function tap(lane: Note['lane'], tick: number, attack = false): Note {
  return { id: `note-${idCounter++}`, lane, tick, kind: 'tap', attack };
}

function long(lane: Note['lane'], tick: number, endTick: number): Note {
  return { id: `note-${idCounter++}`, lane, tick, kind: 'long', endTick };
}

function bind(startTick: number, endTick: number): BindZone {
  return { id: `bind-${idCounter++}`, startTick, endTick };
}

function event(tick: number, props: Omit<TimelineEvent, 'id' | 'tick'>): TimelineEvent {
  return { id: `event-${idCounter++}`, tick, ...props };
}

function makeDifficulty(partial: Partial<Difficulty> = {}): Difficulty {
  return { level: 1, notes: [], bindZones: [], timelineEvents: [], ...partial };
}

/** シリアライズ結果をパーサーに通して同じ内部モデルへ戻ることを検証するヘルパー */
function reparse(entries: SparebeatMapEntry[]): Difficulty {
  return parseSparebeatChart({
    title: 'round-trip',
    bpm: 120,
    startTime: 0,
    level: { easy: 1, normal: 1, hard: 1 },
    map: { easy: entries, normal: [], hard: [] },
  }).difficulties.easy;
}

function stripIds(difficulty: Difficulty) {
  return {
    notes: difficulty.notes
      .map(({ id: _id, ...rest }) => rest)
      .sort((a, b) => a.tick - b.tick || a.lane - b.lane || a.kind.localeCompare(b.kind)),
    bindZones: difficulty.bindZones
      .map(({ id: _id, ...rest }) => rest)
      .sort((a, b) => a.startTick - b.startTick),
    timelineEvents: difficulty.timelineEvents.map(({ id: _id, tick: _tick, ...rest }) => rest),
  };
}

describe('serializeDifficultyMap', () => {
  it('通常ノーツ・アタックノーツ・同時押しをレーン昇順の16分小節文字列にする', () => {
    const difficulty = makeDifficulty({
      notes: [tap(1, 0), tap(0, 0), tap(1, 6, true), tap(0, 6, true), tap(3, 12), tap(2, 12), tap(1, 12), tap(0, 12)],
    });
    expect(serializeDifficultyMap(difficulty)).toEqual(['12,,56,,1234,,,,,,,,,,,']);
  });

  it('ロングノーツを始点・終点文字に変換する（同一小節内）', () => {
    const difficulty = makeDifficulty({ notes: [long(0, 0, 12)] });
    expect(serializeDifficultyMap(difficulty)).toEqual(['a,,,,e,,,,,,,,,,,']);
  });

  it('ロングノーツが小節をまたぐ場合、終点は次の小節に置かれる', () => {
    const difficulty = makeDifficulty({ notes: [long(0, 0, 48)] });
    expect(serializeDifficultyMap(difficulty)).toEqual(['a,,,,,,,,,,,,,,,', 'e,,,,,,,,,,,,,,,']);
  });

  it('同一レーンで終点と次の始点が同じtickの場合、終点→始点の順に出力する', () => {
    const difficulty = makeDifficulty({ notes: [long(0, 0, 12), long(0, 12, 24)] });
    const entries = serializeDifficultyMap(difficulty);
    expect(entries).toEqual(['a,,,,ea,,,,e,,,,,,,']);
    expect(stripIds(reparse(entries))).toEqual(stripIds(difficulty));
  });

  it('バインドゾーンが小節をまたぎ、終端が小節境界の場合は次小節の先頭に ] が付く', () => {
    const difficulty = makeDifficulty({ bindZones: [bind(0, 48)] });
    expect(serializeDifficultyMap(difficulty)).toEqual(['[,,,,,,,,,,,,,,,', '],,,,,,,,,,,,,,,']);
  });

  it('隣接するバインドゾーンは ] の後に [ を出力する', () => {
    const difficulty = makeDifficulty({ bindZones: [bind(0, 24), bind(24, 48)] });
    const entries = serializeDifficultyMap(difficulty);
    expect(entries).toEqual(['[,,,,,,,,][,,,,,,,', '],,,,,,,,,,,,,,,']);
    expect(stripIds(reparse(entries))).toEqual(stripIds(difficulty));
  });

  it('16分で表現できないtickは24分区間（括弧）で出力する', () => {
    const difficulty = makeDifficulty({ notes: [tap(0, 0), tap(1, 2)] });
    expect(serializeDifficultyMap(difficulty)).toEqual(['(1,2,,,,,,,,,,,,,,,,,,,,,,']);
  });

  it('24分区間が小節をまたぐケースをラウンドトリップできる', () => {
    const difficulty = makeDifficulty({
      notes: [
        tap(1, 0),
        tap(0, 20),
        tap(3, 36),
        long(0, 48, 72),
        long(3, 48, 72),
        tap(1, 72, true),
        tap(2, 72, true),
      ],
    });
    const entries = serializeDifficultyMap(difficulty);
    // 2小節ぶんの文字列になること
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => typeof e === 'string')).toBe(true);
    expect(stripIds(reparse(entries))).toEqual(stripIds(difficulty));
  });

  it('16分と24分が混在する小節をラウンドトリップできる', () => {
    const difficulty = makeDifficulty({
      notes: [tap(0, 0), tap(1, 3), tap(2, 6), tap(3, 8), tap(0, 10), tap(1, 12), tap(2, 45)],
    });
    const entries = serializeDifficultyMap(difficulty);
    expect(entries).toHaveLength(1);
    expect(stripIds(reparse(entries))).toEqual(stripIds(difficulty));
  });

  it('timelineEventを該当小節の直前に挿入する', () => {
    const difficulty = makeDifficulty({
      notes: [tap(0, 0)],
      timelineEvents: [
        event(0, { bpm: 180 }),
        event(48, { speed: 0.8, barLine: false }),
        event(48, { bpm: 200 }),
      ],
    });
    expect(serializeDifficultyMap(difficulty)).toEqual([
      { bpm: 180 },
      '1,,,,,,,,,,,,,,,',
      { speed: 0.8, barLine: false },
      { bpm: 200 },
    ]);
  });

  it('timelineEventのみでノーツがない場合はイベントオブジェクトだけを出力する', () => {
    const difficulty = makeDifficulty({ timelineEvents: [event(0, { bpm: 180 })] });
    expect(serializeDifficultyMap(difficulty)).toEqual([{ bpm: 180 }]);
  });

  it('timelineEventのtickが小節境界でない場合はエラーを投げる', () => {
    const difficulty = makeDifficulty({ notes: [tap(0, 0)], timelineEvents: [event(30, { bpm: 100 })] });
    expect(() => serializeDifficultyMap(difficulty)).toThrow(/measure boundary/);
  });

  it('空のDifficultyは空配列になる', () => {
    expect(serializeDifficultyMap(makeDifficulty())).toEqual([]);
  });

  it('16分/24分グリッドに乗らないtickはエラーを投げる', () => {
    const difficulty = makeDifficulty({ notes: [tap(0, 0), tap(1, 1)] });
    expect(() => serializeDifficultyMap(difficulty)).toThrow(/grid/);
  });

  it('同一レーンで重なるロングノーツはエラーを投げる', () => {
    const difficulty = makeDifficulty({ notes: [long(0, 0, 24), long(0, 12, 36)] });
    expect(() => serializeDifficultyMap(difficulty)).toThrow(/Overlapping long notes/);
  });

  it('終点が始点以前のロングノーツはエラーを投げる', () => {
    const difficulty = makeDifficulty({ notes: [long(0, 12, 12)] });
    expect(() => serializeDifficultyMap(difficulty)).toThrow(/must end after it starts/);
  });

  it('重なるバインドゾーンはエラーを投げる', () => {
    const difficulty = makeDifficulty({ bindZones: [bind(0, 48), bind(24, 96)] });
    expect(() => serializeDifficultyMap(difficulty)).toThrow(/Overlapping bind zones/);
  });
});
