import { describe, it, expect } from 'vitest';
import { parseSparebeatChart } from './parseSparebeatChart';
import type { SparebeatChartJSON, SparebeatMapEntry } from '../types/sparebeat';

function makeChart(overrides: Partial<SparebeatChartJSON> = {}, easy: SparebeatMapEntry[] = []): SparebeatChartJSON {
  return {
    title: 'テスト曲',
    artist: 'テスト作者',
    url: 'https://example.com',
    bgColor: ['#111111', '#222222'],
    bpm: 140,
    startTime: 0,
    level: { easy: 3, normal: 7, hard: 12 },
    map: { easy, normal: [], hard: [] },
    ...overrides,
  };
}

// CLAUDE.md記載のサンプル easy 譜面データ
const CLAUDE_MD_SAMPLE_EASY: SparebeatMapEntry[] = [
  '2,,,,5,,,,2,,,,34,,,',
  '123,,,,234,,,,134,,,,234,,,',
  '34,,12,,34,,12,,34,,12,,34,,12,,78,,56,,78,,56,,78,,,,(4,3,2,)1,',
  '123,,124,,134,,234,,134,,234,,123,,1234,',
  '[2,,,,,,,,13,,,,,,,',
  '(2,,,,,,,,,,1,,,,,,,,4,,,,,',
  ')ad,,,,,,,,e67h,,,,,,,',
  ']ad,,,,ebch,,,,1fg4,,,,,,,',
  { speed: 1.1, bpm: 250, barLine: false },
  '1,2,3,4,1,2,3,4,1,2,3,4,1,2,3,4',
];

describe('parseSparebeatChart', () => {
  it('通常ノーツ・アタックノーツ・同時押しを変換する', () => {
    const chart = makeChart({}, ['12,,56,,1234,,,,,,,,,,,']);
    const result = parseSparebeatChart(chart);
    const { notes } = result.difficulties.easy;

    expect(notes).toEqual([
      expect.objectContaining({ lane: 0, tick: 0, kind: 'tap', attack: false }),
      expect.objectContaining({ lane: 1, tick: 0, kind: 'tap', attack: false }),
      expect.objectContaining({ lane: 0, tick: 6, kind: 'tap', attack: true }),
      expect.objectContaining({ lane: 1, tick: 6, kind: 'tap', attack: true }),
      expect.objectContaining({ lane: 0, tick: 12, kind: 'tap', attack: false }),
      expect.objectContaining({ lane: 1, tick: 12, kind: 'tap', attack: false }),
      expect.objectContaining({ lane: 2, tick: 12, kind: 'tap', attack: false }),
      expect.objectContaining({ lane: 3, tick: 12, kind: 'tap', attack: false }),
    ]);
    // idはユニークであること
    expect(new Set(notes.map((n) => n.id)).size).toBe(notes.length);
  });

  it('ロングノーツの始点・終点を対応付ける（小節をまたぐケース）', () => {
    const chart = makeChart({}, ['a,,,,,,,,,,,,,,,', 'e,,,,,,,,,,,,,,,']);
    const result = parseSparebeatChart(chart);

    expect(result.difficulties.easy.notes).toEqual([
      expect.objectContaining({ lane: 0, tick: 0, kind: 'long', endTick: 48 }),
    ]);
  });

  it('ロングノーツの始点・終点を対応付ける（同一レーンで連続する複数ペア）', () => {
    const chart = makeChart({}, ['a,,,,e,,,,a,,,,e,,,']);
    const result = parseSparebeatChart(chart);

    expect(result.difficulties.easy.notes).toEqual([
      expect.objectContaining({ lane: 0, tick: 0, kind: 'long', endTick: 12 }),
      expect.objectContaining({ lane: 0, tick: 24, kind: 'long', endTick: 36 }),
    ]);
  });

  it('バインドゾーンが小節をまたぐケース', () => {
    const chart = makeChart({}, ['[2,,,,,,,,13,,,,,,,', ']ad,,,,ebch,,,,1fg4,,,,,,,']);
    const result = parseSparebeatChart(chart);

    expect(result.difficulties.easy.bindZones).toEqual([expect.objectContaining({ startTick: 0, endTick: 48 })]);
  });

  it('24分区間が小節をまたぐケース', () => {
    const chart = makeChart({}, ['(2,,,,,,,,,,1,,,,,,,,4,,,,,', ')ad,,,,,,,,e67h,,,,,,,']);
    const result = parseSparebeatChart(chart);
    const { notes } = result.difficulties.easy;

    expect(notes).toEqual([
      expect.objectContaining({ lane: 1, tick: 0, kind: 'tap' }),
      expect.objectContaining({ lane: 0, tick: 20, kind: 'tap' }),
      expect.objectContaining({ lane: 3, tick: 36, kind: 'tap' }),
      expect.objectContaining({ lane: 0, tick: 48, kind: 'long', endTick: 72 }),
      expect.objectContaining({ lane: 3, tick: 48, kind: 'long', endTick: 72 }),
      expect.objectContaining({ lane: 1, tick: 72, kind: 'tap', attack: true }),
      expect.objectContaining({ lane: 2, tick: 72, kind: 'tap', attack: true }),
    ]);
  });

  it('BPM/speed/barLine変更オブジェクトをTimelineEventに変換する', () => {
    const chart = makeChart(
      {},
      [
        '1,,,,,,,,,,,,,,,',
        { bpm: 180 },
        { speed: 0.8 },
        { barLine: false },
        { bpm: 200, speed: 1.5, barLine: true },
        '2,,,,,,,,,,,,,,,',
      ],
    );
    const result = parseSparebeatChart(chart);
    const { timelineEvents, notes } = result.difficulties.easy;

    expect(timelineEvents).toEqual([
      expect.objectContaining({ tick: 0, beats: 4 }),
      expect.objectContaining({ tick: 48, bpm: 180 }),
      expect.objectContaining({ tick: 48, speed: 0.8 }),
      expect.objectContaining({ tick: 48, barLine: false }),
      expect.objectContaining({ tick: 48, bpm: 200, speed: 1.5, barLine: true }),
    ]);
    expect(notes).toEqual([
      expect.objectContaining({ lane: 0, tick: 0 }),
      expect.objectContaining({ lane: 1, tick: 48 }),
    ]);
    // speed/barLineが未指定のイベントには当該キーが存在しないこと
    expect(timelineEvents[1]).not.toHaveProperty('speed');
    expect(timelineEvents[1]).not.toHaveProperty('barLine');
  });

  it('easy譜面が空配列[]の場合、notes/bindZonesが空になり、timelineEventsには既定の4拍子のみ含まれる', () => {
    const chart = makeChart({}, []);
    const result = parseSparebeatChart(chart);

    expect(result.difficulties.easy).toEqual({
      level: 3,
      notes: [],
      bindZones: [],
      timelineEvents: [expect.objectContaining({ tick: 0, beats: 4 })],
    });
  });

  it('artist / url / bgColor が省略されている場合、metaに該当キーが含まれない', () => {
    const chart: SparebeatChartJSON = {
      title: 'テスト曲2',
      bpm: 120,
      startTime: 0,
      level: { easy: 1, normal: 1, hard: 1 },
      map: { easy: [], normal: [], hard: [] },
    };
    const result = parseSparebeatChart(chart);

    expect(result.meta).toEqual({ title: 'テスト曲2', initialBpm: 120, startTime: 0 });
    expect(result.meta).not.toHaveProperty('artist');
    expect(result.meta).not.toHaveProperty('url');
    expect(result.meta).not.toHaveProperty('bgColor');
  });

  it('bpmが文字列の場合もそのままinitialBpmに保持する', () => {
    const chart = makeChart({ bpm: 'variable' }, []);
    const result = parseSparebeatChart(chart);

    expect(result.meta.initialBpm).toBe('variable');
  });

  it('CLAUDE.mdのサンプルeasy譜面を通しで変換できる', () => {
    const chart = makeChart({}, CLAUDE_MD_SAMPLE_EASY);
    const result = parseSparebeatChart(chart);
    const { notes, bindZones, timelineEvents } = result.difficulties.easy;

    expect(notes).toHaveLength(104);
    expect(bindZones).toEqual([expect.objectContaining({ startTick: 240, endTick: 384 })]);
    expect(timelineEvents).toEqual([
      expect.objectContaining({ tick: 0, beats: 4 }),
      expect.objectContaining({ tick: 432, bpm: 250, speed: 1.1, barLine: false }),
    ]);

    // 冒頭の通常ノーツ
    expect(notes).toContainEqual(expect.objectContaining({ lane: 1, tick: 0, kind: 'tap', attack: false }));
    expect(notes).toContainEqual(expect.objectContaining({ lane: 0, tick: 12, kind: 'tap', attack: true }));

    // 24分区間(6〜7小節目)由来のロングノーツ、バインドゾーン境界のロングノーツ
    expect(notes).toContainEqual(expect.objectContaining({ lane: 0, tick: 336, kind: 'long', endTick: 360 }));
    expect(notes).toContainEqual(expect.objectContaining({ lane: 3, tick: 336, kind: 'long', endTick: 360 }));
    expect(notes).toContainEqual(expect.objectContaining({ lane: 0, tick: 384, kind: 'long', endTick: 396 }));
    expect(notes).toContainEqual(expect.objectContaining({ lane: 3, tick: 384, kind: 'long', endTick: 396 }));
    expect(notes).toContainEqual(expect.objectContaining({ lane: 1, tick: 396, kind: 'long', endTick: 408 }));
    expect(notes).toContainEqual(expect.objectContaining({ lane: 2, tick: 396, kind: 'long', endTick: 408 }));

    // 末尾の通常ノーツ
    expect(notes).toContainEqual(expect.objectContaining({ lane: 3, tick: 477, kind: 'tap', attack: false }));

    // 難易度未使用(normal/hard)はnotes/bindZonesが空、timelineEventsは既定の4拍子のみ
    expect(result.difficulties.normal).toEqual({
      level: 7,
      notes: [],
      bindZones: [],
      timelineEvents: [expect.objectContaining({ tick: 0, beats: 4 })],
    });
    expect(result.difficulties.hard).toEqual({
      level: 12,
      notes: [],
      bindZones: [],
      timelineEvents: [expect.objectContaining({ tick: 0, beats: 4 })],
    });
  });

  it('不正な文字が含まれる場合はエラーを投げる', () => {
    const chart = makeChart({}, ['x,,,,,,,,,,,,,,,,']);
    expect(() => parseSparebeatChart(chart)).toThrow();
  });

  it('対応する始点のないロングノーツ終点はエラーを投げる', () => {
    const chart = makeChart({}, ['e,,,,,,,,,,,,,,,,']);
    expect(() => parseSparebeatChart(chart)).toThrow(/without a matching start/);
  });

  it('同一レーンで始点が閉じる前に再度始点が来た場合はエラーを投げる', () => {
    const chart = makeChart({}, ['aa,,,,,,,,,,,,,,,']);
    expect(() => parseSparebeatChart(chart)).toThrow(/still open/);
  });

  it('必須フィールドが欠けている場合はエラーを投げる', () => {
    const invalid = { bpm: 140, startTime: 0, level: { easy: 1, normal: 1, hard: 1 }, map: { easy: [], normal: [], hard: [] } };
    expect(() => parseSparebeatChart(invalid as unknown as SparebeatChartJSON)).toThrow(/title/);
  });
});
