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

/**
 * beatsから機械的に挿入されるbarLine: trueは、元のDifficultyが明示的に持っていなくても
 * 疑似小節境界を横切る箇所で新たに追加されるため、1回のparse→serializeでは元のDifficulty
 * と一致しなくなることがある。そのため、reparse結果がそれ以上変化しない安定点に
 * 達していることを確認する。
 */
function expectStableRoundTrip(entries: SparebeatMapEntry[]): void {
  const once = reparse(entries);
  const twice = reparse(serializeDifficultyMap(once));
  expect(stripIds(twice)).toEqual(stripIds(once));
}

function stripIds(difficulty: Difficulty) {
  return {
    notes: difficulty.notes
      .map(({ id: _id, ...rest }) => rest)
      .sort((a, b) => a.tick - b.tick || a.lane - b.lane || a.kind.localeCompare(b.kind)),
    bindZones: difficulty.bindZones
      .map(({ id: _id, ...rest }) => rest)
      .sort((a, b) => a.startTick - b.startTick),
    // beatsは実際のSparebeat形式に存在せず再インポート時に既定値へリセットされるため、
    // ラウンドトリップの同一性比較からは除外する
    timelineEvents: difficulty.timelineEvents
      .map(({ id: _id, tick: _tick, beats: _beats, ...rest }) => rest)
      .filter((e) => Object.keys(e).length > 0),
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

  it('ロングノーツが小節をまたぐ場合、終点は次の小節に置かれ、疑似小節境界にbarLine: trueが挿入される', () => {
    const difficulty = makeDifficulty({ notes: [long(0, 0, 48)] });
    expect(serializeDifficultyMap(difficulty)).toEqual([
      'a,,,,,,,,,,,,,,,',
      { barLine: true },
      'e,,,,,,,,,,,,,,,',
    ]);
  });

  it('同一レーンで終点と次の始点が同じtickの場合、終点→始点の順に出力する', () => {
    const difficulty = makeDifficulty({ notes: [long(0, 0, 12), long(0, 12, 24)] });
    const entries = serializeDifficultyMap(difficulty);
    expect(entries).toEqual(['a,,,,ea,,,,e,,,,,,,']);
    expect(stripIds(reparse(entries))).toEqual(stripIds(difficulty));
  });

  it('バインドゾーンが小節をまたぎ、終端が小節境界の場合は次小節の先頭に ] が付く', () => {
    const difficulty = makeDifficulty({ bindZones: [bind(0, 48)] });
    expect(serializeDifficultyMap(difficulty)).toEqual([
      '[,,,,,,,,,,,,,,,',
      { barLine: true },
      '],,,,,,,,,,,,,,,',
    ]);
  });

  it('隣接するバインドゾーンは ] の後に [ を出力する', () => {
    const difficulty = makeDifficulty({ bindZones: [bind(0, 24), bind(24, 48)] });
    const entries = serializeDifficultyMap(difficulty);
    expect(entries).toEqual(['[,,,,,,,,][,,,,,,,', { barLine: true }, '],,,,,,,,,,,,,,,']);
    expectStableRoundTrip(entries);
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
    // 2小節ぶんの文字列と、その間に挿入される疑似小節境界のbarLine: trueイベント
    expect(entries).toEqual([
      '2,,,,,,(,1,,,,,,,,4,,,,,',
      { barLine: true },
      'ad,,,,,,,,,,,,e67h,,,,,,,,,,,',
    ]);
    expectStableRoundTrip(entries);
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

  it('TimelineEventは疑似小節境界でない任意のtickに挿入でき、その位置で文字列が区切られる（自動barLineは付かない）', () => {
    const difficulty = makeDifficulty({ notes: [tap(0, 0)], timelineEvents: [event(30, { bpm: 100 })] });
    const entries = serializeDifficultyMap(difficulty);
    expect(entries).toEqual(['1,,,,,,,,,', { bpm: 100 }]);
    expectStableRoundTrip(entries);
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

  it('beats変更により小節の長さが変わる', () => {
    const difficulty = makeDifficulty({
      notes: [tap(0, 0), tap(1, 48)],
      timelineEvents: [event(0, { beats: 4 }), event(48, { beats: 5 })],
    });
    const entries = serializeDifficultyMap(difficulty);
    expect(entries).toEqual([
      '1,,,,,,,,,,,,,,,',
      { barLine: true },
      '2,,,,,,,,,,,,,,,,,,,', // 5拍(60tick)分 = 20セル
    ]);
    expectStableRoundTrip(entries);
  });

  it('beats変更とbpm変更が同一tickで起きる場合、beatsは出力に含まれず、barLine: trueが別イベントとして追加される', () => {
    const difficulty = makeDifficulty({
      notes: [tap(0, 0), tap(1, 48)],
      timelineEvents: [event(0, { beats: 4 }), event(48, { beats: 5, bpm: 200 })],
    });
    const entries = serializeDifficultyMap(difficulty);
    expect(entries).toEqual([
      '1,,,,,,,,,,,,,,,',
      { bpm: 200 },
      { barLine: true },
      '2,,,,,,,,,,,,,,,,,,,',
    ]);
  });

  it('beats変更イベントが既存の小節グリッドに乗っていなくてもエラーにならず、そのtickから新しい拍数が適用される', () => {
    const difficulty = makeDifficulty({
      notes: [tap(0, 0)],
      timelineEvents: [event(0, { beats: 4 }), event(30, { beats: 5 })],
    });
    const entries = serializeDifficultyMap(difficulty);
    // tick30で区切られ、そこが新たな疑似小節境界になるためbarLine: trueが挿入される
    expect(entries).toEqual(['1,,,,,,,,,', { barLine: true }]);
    expectStableRoundTrip(entries);
  });

  it('同一tickで矛盾するbeats値を持つイベントがある場合はエラーを投げる', () => {
    const difficulty = makeDifficulty({
      notes: [tap(0, 0)],
      timelineEvents: [event(48, { beats: 5 }), event(48, { beats: 6 })],
    });
    expect(() => serializeDifficultyMap(difficulty)).toThrow(/[Cc]onflicting beats/);
  });

  it('疑似小節境界と実イベントが同一tickで重なり、実イベントがbarLine: falseを明示する場合は自動追加されない', () => {
    const difficulty = makeDifficulty({
      notes: [tap(0, 0), tap(1, 48)],
      timelineEvents: [event(48, { barLine: false })],
    });
    const entries = serializeDifficultyMap(difficulty);
    expect(entries).toEqual([
      '1,,,,,,,,,,,,,,,',
      { barLine: false },
      '2,,,,,,,,,,,,,,,',
    ]);
  });

  it('疑似小節境界と実イベントが同一tickで重なり、実イベントがbarLineを指定しない場合は追加でbarLine: trueが挿入される', () => {
    const difficulty = makeDifficulty({
      notes: [tap(0, 0), tap(1, 48)],
      timelineEvents: [event(48, { speed: 1.2 })],
    });
    const entries = serializeDifficultyMap(difficulty);
    expect(entries).toEqual([
      '1,,,,,,,,,,,,,,,',
      { speed: 1.2 },
      { barLine: true },
      '2,,,,,,,,,,,,,,,',
    ]);
  });

  it('不正なbeats値はエラーを投げる', () => {
    expect(() => serializeDifficultyMap(makeDifficulty({ timelineEvents: [event(0, { beats: 0 })] }))).toThrow(
      /beats/,
    );
    expect(() => serializeDifficultyMap(makeDifficulty({ timelineEvents: [event(0, { beats: 3.5 })] }))).toThrow(
      /beats/,
    );
  });
});
