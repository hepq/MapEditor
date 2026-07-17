# CLAUDE.md

## プロジェクト概要

Sparebeat（ブラウザ音楽ゲーム https://sparebeat.com）向けの創作譜面エディターWebアプリを開発する。最終目標はpixi.js製の譜面編集UI（ノーツ配置・タイムライン表示・音声同期プレビュー）だが、**現フェーズでは以下に限定する**。

1. Sparebeatの公開譜面JSON（既存データ）を読み込む
2. 扱いやすい内部データモデルに変換する
3. 変換結果のJSONを画面表示・ダウンロードできるようにする

譜面のビジュアル編集（pixi.jsでのノーツ配置UI）や音声再生は次フェーズ以降のスコープであり、今回は着手しない。

## 技術スタック

- TypeScript（strict mode）
- Vite
- React（最小限のUI: ファイルアップロード、変換結果のJSON表示、ダウンロードボタン）
- テスト: Vitest

バックエンドは不要。すべてブラウザ上で完結させる（ファイル読み込みはFile API、出力はBlobダウンロード）。

## Sparebeat譜面フォーマット（入力データの仕様）

公式の創作譜面はJSONで、以下の構造を持つ。

```json
{
  "title": "曲のタイトル",
  "artist": "作曲者",
  "url": "作曲者のサイトURL",
  "bgColor": ["#色1", "#色2"],
  "bpm": 140,
  "startTime": 0,
  "level": { "easy": 3, "normal": 7, "hard": 12 },
  "map": {
    "easy": [],
    "normal": [],
    "hard": []
  }
}
```

`artist` / `url` / `bgColor` は省略される場合がある。`bpm`は数値または文字列（文字列の場合は必ず譜面冒頭でBPM変化オブジェクトによって実際のBPMを指定する）。難易度が存在しない場合、その`map`は空配列`[]`になる。

### mapの中身（各難易度の譜面データ）

配列で、要素は「小節を表す文字列」または「BPM/speed/barLine変更を表すオブジェクト」。

```json
"easy": [
  "2,,,,5,,,,2,,,,34,,,",
  "123,,,,234,,,,134,,,,234,,,",
  "34,,12,,34,,12,,34,,12,,34,,12,,78,,56,,78,,56,,78,,,,(4,3,2,)1,",
  "123,,124,,134,,234,,134,,234,,123,,1234,",
  "[2,,,,,,,,13,,,,,,,",
  "(2,,,,,,,,,,1,,,,,,,,4,,,,,",
  ")ad,,,,,,,,e67h,,,,,,,",
  "]ad,,,,ebch,,,,1fg4,,,,,,,",
  { "speed": 1.1, "bpm": 250, "barLine": false },
  "1,2,3,4,1,2,3,4,1,2,3,4,1,2,3,4"
]
```

- 1つの文字列 = 1小節（4/4拍子固定）
- 文字列内はカンマ区切りで、通常1カンマ=16分音符分の時間経過。`()`で囲んだ区間内は1カンマ=24分音符分の時間経過になる。`(` `)` は小節をまたいで開閉してよい
- ノーツ文字コード:
  - `1`-`4`: ノーマルノーツ（D/F/J/Kキー）
  - `5`-`8`: アタックノーツ（D/F/J/Kキー）
  - `a`-`d`: ロングノーツ始点（D/F/J/Kキー）
  - `e`-`h`: ロングノーツ終点（D/F/J/Kキー）
  - 同時押しは同じマスに複数文字を並べる（例: `34`）
- `[` `]`: バインドゾーン（区間中は空打りがMISS判定になる）。小節をまたいで開閉してよい
- `{ speed, bpm, barLine }`: 途中でのBPM変化・スクロール速度変化・小節線表示切替。3プロパティは任意の組み合わせで省略可能

## 内部データモデル（変換先の仕様）

```typescript
interface ChartProject {
  meta: {
    title: string;
    artist?: string;
    url?: string;
    bgColor?: [string] | [string, string];
    initialBpm: number | string;
    startTime: number; // ms
  };
  difficulties: {
    easy: Difficulty;
    normal: Difficulty;
    hard: Difficulty;
  };
}

interface Difficulty {
  level: number | string;
  notes: Note[];
  bindZones: BindZone[];
  timelineEvents: TimelineEvent[];
}

interface Note {
  id: string;
  lane: 0 | 1 | 2 | 3;   // D, F, J, K
  tick: number;
  kind: 'tap' | 'long';
  attack?: boolean;       // kind: 'tap' のときのみ意味を持つ
  endTick?: number;       // kind: 'long' のときのみ
}

interface BindZone {
  id: string;
  startTick: number;
  endTick: number;
}

interface TimelineEvent {
  id: string;
  tick: number;
  bpm?: number;
  speed?: number;
  barLine?: boolean;
}
```

### tick仕様

- 1拍 = 12tick（16分音符=3tick、24分音符=2tickの最小公倍数）を基準とする
- 小節は常に4拍固定（4/4拍子）。小節番号・拍位置はtickから計算で導出し、別途保持しない
- `tick`は各難易度の`map`配列の先頭（曲頭ではなく譜面データの先頭）からの絶対位置とする。実際の再生時刻（ms）への変換は`meta.startTime`と`timelineEvents`のBPM推移から別途計算する（今回のスコープでは変換関数の実装までは不要、tickを正しく算出できていればよい）

## 今回のタスクスコープ

1. `parseSparebeatChart(json: SparebeatChartJSON): ChartProject` — 入力JSONを内部モデルへ変換するパーサーを実装する
2. パーサーの単体テスト（Vitest）。以下のケースを最低限カバーする
   - 通常ノーツ・アタックノーツ・同時押し
   - ロングノーツ（始点・終点の対応付け）
   - バインドゾーンが小節をまたぐケース
   - 24分区間が小節をまたぐケース
   - BPM/speed/barLine変更オブジェクト
   - easy譜面が空配列`[]`のケース
   - `artist` / `url` / `bgColor` が省略されているケース
3. 最小限のUI（`App.tsx`）: JSONファイルをドラッグ&ドロップ/選択でアップロード → パース実行 → 結果の内部モデルJSONを画面にpretty-print表示 → 「ダウンロード」ボタンでファイル保存
4. パースエラー時（フォーマット不正）はエラーメッセージを画面に表示する

## 今回やらないこと（次フェーズ）

- 内部モデル→Sparebeat形式への逆変換（シリアライザ）
- pixi.jsによる譜面のビジュアル表示・編集
- 音声ファイルの読み込み・再生
- Undo/Redo、プロジェクトの保存/読み込み（localStorage等）
- tick→ms変換関数の実装

## ディレクトリ構成（想定）

```
src/
  types/
    sparebeat.ts       # 入力フォーマットの型定義
    chartProject.ts    # 内部データモデルの型定義
  parser/
    parseSparebeatChart.ts
    parseSparebeatChart.test.ts
    parseMapString.ts   # 小節文字列のトークナイズ処理
    parseMapString.test.ts
  components/
    FileUploader.tsx
    JsonOutputViewer.tsx
  App.tsx
  main.tsx
```

## コマンド

```
npm run dev       # 開発サーバー起動
npm run build     # ビルド
npm run test      # ユニットテスト
```