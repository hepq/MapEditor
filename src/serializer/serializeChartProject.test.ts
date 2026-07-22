import { describe, it, expect } from 'vitest';
import { serializeChartProject } from './serializeChartProject';
import { parseSparebeatChart } from '../parser/parseSparebeatChart';
import type { ChartProject, Difficulty } from '../types/chartProject';
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

/**
 * ラウンドトリップ比較用の正規化。
 * idは再生成され、同一tick内のノーツ順もセルの文字順に依存するため、
 * id除去＋決定的なソートで比較する。
 */
function normalizeDifficulty(difficulty: Difficulty) {
  return {
    level: difficulty.level,
    notes: difficulty.notes
      .map(({ id: _id, ...rest }) => rest)
      .sort((a, b) => a.tick - b.tick || a.lane - b.lane || a.kind.localeCompare(b.kind)),
    bindZones: difficulty.bindZones
      .map(({ id: _id, ...rest }) => rest)
      .sort((a, b) => a.startTick - b.startTick),
    timelineEvents: difficulty.timelineEvents.map(({ id: _id, ...rest }) => rest),
  };
}

function normalizeProject(project: ChartProject) {
  return {
    meta: project.meta,
    difficulties: {
      easy: normalizeDifficulty(project.difficulties.easy),
      normal: normalizeDifficulty(project.difficulties.normal),
      hard: normalizeDifficulty(project.difficulties.hard),
    },
  };
}

/**
 * parse → serialize → parse を2周し、安定点（2周目以降の結果同士）が一致することを検証する。
 * beatsから機械的に挿入されるbarLine: trueイベントは、手書きの譜面JSONが暗黙的に
 * 区切っているだけでbarLineイベントを持たない場合、1周目のparse結果には無く
 * 2周目以降で追加されるため、最初のparse結果と単純比較することはできない。
 */
function expectRoundTrip(chart: SparebeatChartJSON) {
  const project = parseSparebeatChart(chart);
  const onceReparsed = parseSparebeatChart(serializeChartProject(project));
  const twiceReparsed = parseSparebeatChart(serializeChartProject(onceReparsed));
  expect(normalizeProject(twiceReparsed)).toEqual(normalizeProject(onceReparsed));
}

describe('serializeChartProject', () => {
  it('メタ情報と難易度レベルをSparebeat形式に変換する', () => {
    const project = parseSparebeatChart(makeChart({}, ['1,,,,,,,,,,,,,,,']));
    const serialized = serializeChartProject(project);

    expect(serialized.title).toBe('テスト曲');
    expect(serialized.artist).toBe('テスト作者');
    expect(serialized.url).toBe('https://example.com');
    expect(serialized.bgColor).toEqual(['#111111', '#222222']);
    expect(serialized.bpm).toBe(140);
    expect(serialized.startTime).toBe(0);
    expect(serialized.level).toEqual({ easy: 3, normal: 7, hard: 12 });
    expect(serialized.map.easy).toEqual(['1,,,,,,,,,,,,,,,']);
    expect(serialized.map.normal).toEqual([]);
    expect(serialized.map.hard).toEqual([]);
  });

  it('artist / url / bgColor が無い場合は出力にキー自体が含まれない', () => {
    const project: ChartProject = {
      meta: { title: 'ミニマル', initialBpm: 'variable', startTime: 500 },
      difficulties: {
        easy: { level: 1, notes: [], bindZones: [], timelineEvents: [] },
        normal: { level: 2, notes: [], bindZones: [], timelineEvents: [] },
        hard: { level: 3, notes: [], bindZones: [], timelineEvents: [] },
      },
    };
    const serialized = serializeChartProject(project);

    expect(serialized).toEqual({
      title: 'ミニマル',
      bpm: 'variable',
      startTime: 500,
      level: { easy: 1, normal: 2, hard: 3 },
      map: { easy: [], normal: [], hard: [] },
    });
    expect(serialized).not.toHaveProperty('artist');
    expect(serialized).not.toHaveProperty('url');
    expect(serialized).not.toHaveProperty('bgColor');
  });

  it('CLAUDE.mdのサンプル譜面をラウンドトリップできる', () => {
    expectRoundTrip(makeChart({}, CLAUDE_MD_SAMPLE_EASY));
  });

  it('バインドゾーン境界・小節またぎロング・BPM変化を含む譜面をラウンドトリップできる', () => {
    expectRoundTrip(
      makeChart({ bpm: '140' }, [
        { bpm: 140 },
        '[a,,,,,,,,,,,,,,,',
        ']e12,,,,(5,6,7,8,,,)1234,,,,,,,',
        { speed: 1.25, barLine: false },
        '(1,2,3,4,1,2,3,4,1,2,3,4,1,2,3,4,1,2,3,4,1,2,3,4',
        ')1,,,,,,,,,,,,,,,',
      ]),
    );
  });

  it('メタ情報省略の譜面をラウンドトリップできる', () => {
    expectRoundTrip({
      title: 'テスト曲2',
      bpm: 120,
      startTime: 100,
      level: { easy: 1, normal: 1, hard: 1 },
      map: { easy: [], normal: ['1,,,,,,,,,,,,,,,'], hard: [] },
    });
  });
});
