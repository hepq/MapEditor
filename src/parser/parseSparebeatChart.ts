/**
 * Sparebeat譜面JSON全体を内部データモデル（ChartProject）に変換するパーサー。
 */

import type { SparebeatChartJSON, SparebeatDifficultyKey, SparebeatMapEntry } from '../types/sparebeat';
import type { ChartProject, Difficulty, BindZone, TimelineEvent, Note } from '../types/chartProject';
import { createInitialMapParserState, parseMapString } from './parseMapString';
import { createId } from '../utils/createId';

const DIFFICULTY_KEYS: SparebeatDifficultyKey[] = ['easy', 'normal', 'hard'];

type LaneIndex = 0 | 1 | 2 | 3;

type NoteRole = 'tapNormal' | 'tapAttack' | 'longStart' | 'longEnd';

const NORMAL_CHARS = '1234';
const ATTACK_CHARS = '5678';
const LONG_START_CHARS = 'abcd';
const LONG_END_CHARS = 'efgh';

function classifyChar(char: string): { lane: LaneIndex; role: NoteRole } {
  let index = NORMAL_CHARS.indexOf(char);
  if (index !== -1) return { lane: index as LaneIndex, role: 'tapNormal' };
  index = ATTACK_CHARS.indexOf(char);
  if (index !== -1) return { lane: index as LaneIndex, role: 'tapAttack' };
  index = LONG_START_CHARS.indexOf(char);
  if (index !== -1) return { lane: index as LaneIndex, role: 'longStart' };
  index = LONG_END_CHARS.indexOf(char);
  if (index !== -1) return { lane: index as LaneIndex, role: 'longEnd' };
  throw new Error(`Unknown note character: '${char}'`);
}

function parseDifficulty(
  difficultyKey: SparebeatDifficultyKey,
  level: number | string,
  mapEntries: SparebeatMapEntry[],
): Difficulty {
  let state = createInitialMapParserState();
  const noteTokens: { tick: number; char: string }[] = [];
  const bindZones: BindZone[] = [];
  const timelineEvents: TimelineEvent[] = [];

  for (const entry of mapEntries) {
    if (typeof entry === 'string') {
      const result = parseMapString(entry, state);
      state = result.state;
      for (const token of result.tokens) {
        if (token.type === 'note') {
          noteTokens.push({ tick: token.tick, char: token.char });
        } else {
          bindZones.push({
            id: createId('bindzone'),
            startTick: token.startTick,
            endTick: token.endTick,
          });
        }
      }
    } else if (typeof entry === 'object' && entry !== null) {
      const event: TimelineEvent = {
        id: createId('event'),
        tick: state.tick,
      };
      if (entry.bpm !== undefined) event.bpm = entry.bpm;
      if (entry.speed !== undefined) event.speed = entry.speed;
      if (entry.barLine !== undefined) event.barLine = entry.barLine;
      timelineEvents.push(event);
    } else {
      throw new Error(`Invalid map entry in difficulty '${difficultyKey}': ${JSON.stringify(entry)}`);
    }
  }

  const notes: Note[] = [];
  const pendingLongStart: (number | null)[] = [null, null, null, null];

  for (const { tick, char } of noteTokens) {
    const { lane, role } = classifyChar(char);
    switch (role) {
      case 'tapNormal':
        notes.push({ id: createId('note'), lane, tick, kind: 'tap', attack: false });
        break;
      case 'tapAttack':
        notes.push({ id: createId('note'), lane, tick, kind: 'tap', attack: true });
        break;
      case 'longStart':
        if (pendingLongStart[lane] !== null) {
          throw new Error(
            `Long note start on lane ${lane} at tick ${tick} while a previous long note ` +
              `(started at tick ${pendingLongStart[lane]}) on the same lane is still open`,
          );
        }
        pendingLongStart[lane] = tick;
        break;
      case 'longEnd': {
        const startTick = pendingLongStart[lane];
        if (startTick === null) {
          throw new Error(`Long note end on lane ${lane} at tick ${tick} without a matching start`);
        }
        notes.push({
          id: createId('note'),
          lane,
          tick: startTick,
          kind: 'long',
          endTick: tick,
        });
        pendingLongStart[lane] = null;
        break;
      }
    }
  }

  notes.sort((a, b) => a.tick - b.tick);

  return { level, notes, bindZones, timelineEvents };
}

export function parseSparebeatChart(json: SparebeatChartJSON): ChartProject {
  // 呼び出し元はJSON.parse直後のパース前データを渡しうる（実質 unknown）ため、
  // 検証フェーズでは型を信用せず unknown として扱う。
  const data = json as unknown as Partial<Record<string, unknown>>;

  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid Sparebeat chart: root must be an object');
  }
  if (typeof data.title !== 'string') {
    throw new Error('Invalid Sparebeat chart: "title" is required and must be a string');
  }
  if (typeof data.bpm !== 'number' && typeof data.bpm !== 'string') {
    throw new Error('Invalid Sparebeat chart: "bpm" is required and must be a number or string');
  }
  if (typeof data.startTime !== 'number') {
    throw new Error('Invalid Sparebeat chart: "startTime" is required and must be a number');
  }
  const level = data.level as Partial<Record<SparebeatDifficultyKey, unknown>> | undefined;
  if (typeof level !== 'object' || level === null) {
    throw new Error('Invalid Sparebeat chart: "level" is required and must be an object');
  }
  const map = data.map as Partial<Record<SparebeatDifficultyKey, unknown>> | undefined;
  if (typeof map !== 'object' || map === null) {
    throw new Error('Invalid Sparebeat chart: "map" is required and must be an object');
  }
  for (const key of DIFFICULTY_KEYS) {
    const levelValue = level[key];
    if (typeof levelValue !== 'number' && typeof levelValue !== 'string') {
      throw new Error(`Invalid Sparebeat chart: "level.${key}" is required and must be a number or string`);
    }
    if (!Array.isArray(map[key])) {
      throw new Error(`Invalid Sparebeat chart: "map.${key}" must be an array`);
    }
  }

  const chart = json;
  const difficulties = {} as ChartProject['difficulties'];
  for (const key of DIFFICULTY_KEYS) {
    difficulties[key] = parseDifficulty(key, chart.level[key], chart.map[key]);
  }

  const meta: ChartProject['meta'] = {
    title: chart.title,
    initialBpm: chart.bpm,
    startTime: chart.startTime,
  };
  if (chart.artist !== undefined) meta.artist = chart.artist;
  if (chart.url !== undefined) meta.url = chart.url;
  if (chart.bgColor !== undefined) meta.bgColor = chart.bgColor;

  return { meta, difficulties };
}
