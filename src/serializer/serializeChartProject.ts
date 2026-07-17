/**
 * 内部データモデル（ChartProject）をSparebeat譜面JSONへ逆変換するシリアライザー。
 * parseSparebeatChartの逆変換にあたる。
 */

import type { ChartProject } from '../types/chartProject';
import type { SparebeatChartJSON } from '../types/sparebeat';
import { serializeDifficultyMap } from './serializeDifficultyMap';

export function serializeChartProject(project: ChartProject): SparebeatChartJSON {
  const { meta, difficulties } = project;

  return {
    title: meta.title,
    ...(meta.artist !== undefined ? { artist: meta.artist } : {}),
    ...(meta.url !== undefined ? { url: meta.url } : {}),
    ...(meta.bgColor !== undefined ? { bgColor: meta.bgColor } : {}),
    bpm: meta.initialBpm,
    startTime: meta.startTime,
    level: {
      easy: difficulties.easy.level,
      normal: difficulties.normal.level,
      hard: difficulties.hard.level,
    },
    map: {
      easy: serializeDifficultyMap(difficulties.easy),
      normal: serializeDifficultyMap(difficulties.normal),
      hard: serializeDifficultyMap(difficulties.hard),
    },
  };
}
