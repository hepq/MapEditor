/**
 * Sparebeat譜面の「1小節分の文字列」をトークン列に変換するパーサー。
 *
 * バインドゾーン（[ ]）と24分区間（( )）は小節をまたいで開閉されうるため、
 * この関数は呼び出しごとに MapParserState を受け取り／返すことで、
 * map配列全体を1パスで処理する際に状態を引き継げるように設計されている。
 *
 * tick計算は小節文字列の区切りに依存せず、mapエントリを跨いで連続的に加算する
 * （小節番号・拍位置はtickから別途計算で導出するため、ここでは意識しない）。
 */

export interface MapParserState {
  /** map配列の先頭からの絶対tick位置（次に配置されるトークンの位置） */
  tick: number;
  /** 現在バインドゾーン中かどうか */
  inBindZone: boolean;
  /** バインドゾーンが開いている場合、その開始tick */
  bindZoneStartTick: number | null;
  /** 現在24分区間中かどうか（false=16分区間） */
  in24: boolean;
}

export function createInitialMapParserState(): MapParserState {
  return { tick: 0, inBindZone: false, bindZoneStartTick: null, in24: false };
}

export type MapToken =
  | { type: 'note'; tick: number; char: string }
  | { type: 'bindZone'; startTick: number; endTick: number };

export interface ParseMapStringResult {
  tokens: MapToken[];
  state: MapParserState;
}

const NOTE_CHAR_PATTERN = /^[1-8a-h]$/;
const BRACKET_CHARS = new Set(['[', ']', '(', ')']);

export function parseMapString(measureStr: string, state: MapParserState): ParseMapStringResult {
  let tick = state.tick;
  let inBindZone = state.inBindZone;
  let bindZoneStartTick = state.bindZoneStartTick;
  let in24 = state.in24;

  const tokens: MapToken[] = [];
  const rawTokens = measureStr.split(',');

  for (const rawToken of rawTokens) {
    let i = 0;
    while (i < rawToken.length && BRACKET_CHARS.has(rawToken[i])) {
      const bracket = rawToken[i];
      switch (bracket) {
        case '[':
          if (inBindZone) {
            throw new Error(`Unexpected '[' at tick ${tick}: already inside a bind zone`);
          }
          inBindZone = true;
          bindZoneStartTick = tick;
          break;
        case ']':
          if (!inBindZone || bindZoneStartTick === null) {
            throw new Error(`Unexpected ']' at tick ${tick}: not inside a bind zone`);
          }
          tokens.push({ type: 'bindZone', startTick: bindZoneStartTick, endTick: tick });
          inBindZone = false;
          bindZoneStartTick = null;
          break;
        case '(':
          if (in24) {
            throw new Error(`Unexpected '(' at tick ${tick}: already inside a 24-division zone`);
          }
          in24 = true;
          break;
        case ')':
          if (!in24) {
            throw new Error(`Unexpected ')' at tick ${tick}: not inside a 24-division zone`);
          }
          in24 = false;
          break;
      }
      i++;
    }

    const noteChars = rawToken.slice(i);
    for (const char of noteChars) {
      if (!NOTE_CHAR_PATTERN.test(char)) {
        throw new Error(`Invalid note character '${char}' at tick ${tick}`);
      }
      tokens.push({ type: 'note', tick, char });
    }

    tick += in24 ? 2 : 3;
  }

  return {
    tokens,
    state: { tick, inBindZone, bindZoneStartTick, in24 },
  };
}
