import { describe, it, expect } from 'vitest';
import { createInitialMapParserState, parseMapString } from './parseMapString';
import type { MapParserState } from './parseMapString';

describe('parseMapString', () => {
  it('16分区間の通常小節をトークン化し、tickを3ずつ進める', () => {
    const { tokens, state } = parseMapString('2,,,,5,,,,2,,,,34,,,', createInitialMapParserState());

    expect(tokens).toEqual([
      { type: 'note', tick: 0, char: '2' },
      { type: 'note', tick: 12, char: '5' },
      { type: 'note', tick: 24, char: '2' },
      { type: 'note', tick: 36, char: '3' },
      { type: 'note', tick: 36, char: '4' },
    ]);
    expect(state).toEqual<MapParserState>({
      tick: 48,
      inBindZone: false,
      bindZoneStartTick: null,
      in24: false,
    });
  });

  it('バインドゾーンが小節（呼び出し）をまたいで開閉できる', () => {
    const state0 = createInitialMapParserState();
    const call1 = parseMapString('[1,,,,,,,,,,,,,,,', state0);

    // 1小節目ではまだ閉じていないので bindZone トークンは出ない
    expect(call1.tokens).toEqual([{ type: 'note', tick: 0, char: '1' }]);
    expect(call1.state.inBindZone).toBe(true);
    expect(call1.state.bindZoneStartTick).toBe(0);
    expect(call1.state.tick).toBe(48);

    const call2 = parseMapString(']2,,,,,,,,,,,,,,,', call1.state);

    expect(call2.tokens).toEqual([
      { type: 'bindZone', startTick: 0, endTick: 48 },
      { type: 'note', tick: 48, char: '2' },
    ]);
    expect(call2.state.inBindZone).toBe(false);
    expect(call2.state.bindZoneStartTick).toBeNull();
  });

  it('24分区間が小節（呼び出し）をまたいで開閉でき、tickを2ずつ進める', () => {
    const state0 = createInitialMapParserState();
    // CLAUDE.mdサンプルの該当2小節分
    const call1 = parseMapString('(2,,,,,,,,,,1,,,,,,,,4,,,,,', state0);

    expect(call1.tokens).toEqual([
      { type: 'note', tick: 0, char: '2' },
      { type: 'note', tick: 20, char: '1' },
      { type: 'note', tick: 36, char: '4' },
    ]);
    expect(call1.state.in24).toBe(true);
    expect(call1.state.tick).toBe(48); // 24トークン x 2tick = 48

    const call2 = parseMapString(')ad,,,,,,,,e67h,,,,,,,', call1.state);

    expect(call2.tokens).toEqual([
      { type: 'note', tick: 48, char: 'a' },
      { type: 'note', tick: 48, char: 'd' },
      { type: 'note', tick: 72, char: 'e' },
      { type: 'note', tick: 72, char: '6' },
      { type: 'note', tick: 72, char: '7' },
      { type: 'note', tick: 72, char: 'h' },
    ]);
    expect(call2.state.in24).toBe(false);
    expect(call2.state.tick).toBe(96); // 48 + 16トークン x 3tick
  });

  it('不正な文字はエラーになる', () => {
    expect(() => parseMapString('x,,,,', createInitialMapParserState())).toThrow(/Invalid note character/);
  });

  it('対応のない閉じ括弧はエラーになる', () => {
    expect(() => parseMapString(']1,,,,', createInitialMapParserState())).toThrow(/not inside a bind zone/);
    expect(() => parseMapString(')1,,,,', createInitialMapParserState())).toThrow(/not inside a 24-division zone/);
  });
});
