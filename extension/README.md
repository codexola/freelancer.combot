# Freelancer Auto Bid — Octo Browser Extension

Freelancer.com の新規プロジェクトを自動検出し、条件に合う案件へ自動入札する拡張機能です。**Octo Browser のプロファイル内で動作するよう設計されています。**

## 機能

- **プロジェクト監視**: `https://www.freelancer.com/search/projects` をリアルタイム監視
- **自動フィルタ**: 入札者数・価格・地域・カテゴリで絞り込み
- **アーカイブ**: 既出案件と照合し、新規案件のみ入札
- **AI入札文**: Claude / OpenAI（最大1500文字）
- **契約書自動署名**: IP Agreement / NDA
- **ダッシュボード**: CMD風フィルタコンソール、統計、設定

## Octo Browser セットアップ

### ステップ 1: プロファイルの Storages 設定（必須）

Octo でプロファイルを作成または編集し、**Storages** で以下をすべて **ON** にしてください。

| 項目 | 理由 |
|------|------|
| **Extensions** | 拡張機能の読み込み |
| **Local Storage** | 設定・入札履歴・アーカイブの保存 |
| **Service workers** | バックグラウンドでの監視・入札キュー処理 |

これらが無効だと、ダッシュボードに「Bot started」とだけ表示され、**フィルタリング（SCAN）が一切動きません。**

### ステップ 2: 拡張機能のインストール

#### 方法 A — プロファイル設定から（推奨）

1. Octo → プロファイル作成/編集 → **Extensions**
2. **Add a new extension** → **From file or folder**
3. このリポジトリの `extension` フォルダを選択
4. プロファイル設定で拡張機能を有効化して保存

#### 方法 B — 起動中プロファイルの開発者モード

1. プロファイルを **Start** で起動
2. アドレスバーに `chrome://extensions` と入力
3. 右上 **Developer mode** を ON
4. **Load unpacked** → `extension` フォルダを選択
5. 拡張機能のトグルを ON

### ステップ 3: アイコン（初回のみ）

```bash
node scripts/generate-icons.js
```

### ステップ 4: 運用

1. **同じ Octo プロファイル**で Freelancer.com にログイン
2. 拡張機能アイコン → **ダッシュボードを開く**
3. **API** タブ: Claude / OpenAI キー
4. **入札** タブ: 金額・納期・時給・入札時間窓
5. **プロフィール** タブ: 氏名・住所（契約書署名用）
6. **開始** をクリック

フィルタコンソールに次のような行が出れば正常です:

```
[SYSTEM] Bot started — monitoring ...
[SYSTEM] Monitor active — scanning projects
[SCAN] DOM:20 | API:15 | seeded baseline
```

## 使い方（ダッシュボード）

| 操作 | 説明 |
|------|------|
| 開始 | 自動入札を開始（Freelancer 監視タブを開く） |
| 停止 | 自動入札を停止 |
| 保管 | 設定を明示的に保存 |
| 変更 | 変更を適用して保存 |
| 削除 | 設定を初期値にリセット |

設定は入力後 1.5 秒で自動保存されます。

## 入札フロー

```
Freelancer 検索ページ監視（Octo プロファイル内）
  → 新規プロジェクト検出（アーカイブと照合）
  → フィルタ通過
  → /projects/.../details を開く
  → AI 入札文生成
  → フォーム入力 → Place Bid
  → 必要なら IP/NDA 署名
  → 監視を再開
```

## Octo Browser トラブルシューティング

| 症状 | 対処 |
|------|------|
| フィルタコンソールが「Bot started」だけ | Storages で **Service workers** を有効化 → プロファイル再起動 → `chrome://extensions` で拡張を Reload |
| SCAN が出ない | 同じプロファイルで Freelancer にログインしているか確認。拡張の Reload |
| 入札しない | `bidWindowMaxSec` を 30〜120 に延長。API キーとプロフィール氏名・住所を確認 |
| 設定が消える | **Local Storage** が Storages で ON か確認 |
| 別ブラウザで動かしたい | Chromium 系なら同手順で可。本番運用は Octo プロファイル推奨 |

**重要:** ボットは **Octo プロファイルを起動したまま** 使用してください。プロファイルを終了するとサービスワーカーも停止します。

## 注意事項

- Freelancer.com の利用規約を確認してください
- API キーはプロファイルのローカルストレージに保存されます
- DOM 変更時はセレクタの更新が必要になる場合があります

## 参考リンク

- [Octo Browser — Installing Extensions](https://docs.octobrowser.net/en/profiles/extensions/)
