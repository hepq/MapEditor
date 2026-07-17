/**
 * 内部データモデルの各要素（ノーツ・バインドゾーン・タイムラインイベント）の
 * id発行ユーティリティ。
 *
 * idは順序情報を持たない不変の識別子であり、並び順は常にtickから導出する。
 * UUIDベースのため採番状態を持ち運ぶ必要がなく、将来の編集操作
 * （ノーツの挿入・削除・コピー&ペースト）でも衝突しない。
 * prefixはデバッグ時に要素種別を判別しやすくするためのもの。
 */
export function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
