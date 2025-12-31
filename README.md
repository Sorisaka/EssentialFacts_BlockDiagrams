# Essential Facts Block Diagrams

ローカル環境で動作する「要件事実ブロックダイアグラム」編集アプリの最小構成です。FastAPI + React (Vite) を採用し、JSONファイルへの永続化とダイアグラム描画を再現したPDF出力を備えています。

## ディレクトリ構成
```
backend/          FastAPI アプリケーション
  app/
    main.py       API エントリポイント
    models.py     図・列・ノード・テンプレのデータモデル
    storage.py    JSON ファイル永続化ユーティリティ
  requirements.txt
frontend/         Vite + React SPA
  src/
    App.jsx       画面レイアウトと簡易編集UI
    components/   UI部品（マーク選択、テンプレ一覧、プロパティパネル、配線描画）
    hooks/useApi.jsx API クライアント
    styles.css    共通スタイル
  package.json
```

## セットアップ
1. Python 仮想環境の準備
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r backend/requirements.txt
   ```

2. フロントエンド依存のインストール
   ```bash
   cd frontend
   npm install
   ```

## 開発サーバー起動
別ターミナルでそれぞれ起動します。

- バックエンド (FastAPI / Uvicorn)
  ```bash
  uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000 --reload
  ```

- フロントエンド (Vite)
  ```bash
  cd frontend
  npm run dev -- --host --port 5173
  ```

ブラウザで http://localhost:5173 を開くとSPAが表示されます。初期状態ではローカルのJSONファイルに空リストが作成されます。

## データ保存場所
- ダイアグラム: `backend/data/diagrams/{id}.json`
- テンプレート: `backend/data/templates/{id}.json`
- 一覧キャッシュ: `backend/data/index.json`

保存時は一時ファイルへの書き出し→リネームで原子的に更新します。

## API 概要（抜粋）
- `GET /api/diagrams` 一覧（createdAt/updatedAt含むサマリ）
- `POST /api/diagrams` 新規作成（name, columns, nodes, edges, rowCount）
- `GET /api/diagrams/{id}` 取得
- `PUT /api/diagrams/{id}` 保存（payload全体を上書き、updatedAtを更新）
- `DELETE /api/diagrams/{id}` 削除
- `POST /api/diagrams/{id}/duplicate` 複製（name任意）
- `POST /api/diagrams/{id}/export/pdf` PDF生成
- `GET /api/templates?query=` テンプレ検索/一覧
- `POST /api/templates` 登録
- `GET /api/templates/{id}` 取得
- `DELETE /api/templates/{id}` 削除

## 機能スケッチ（現状）
- 図の作成・選択・保存（ローカルJSONに永続化、デバウンス自動保存 + 明示保存ボタン）
- 列追加/削除、ノード追加/削除、項目追加/削除、マーク(〇△×顕・空白)切替
- 行ガイド付きキャンバスで行ごとに配置、列ヘッダやノードタイトルのインライン編集、整列ボタンで行詰め
- テンプレ検索・適用（現在列/行にノードを挿入）、選択ノードからのテンプレ登録・削除
- ダイアグラム一覧の複製/削除/作成
- 接続モードによるノード間のエッジ追加・削除、列境界と行中央の格子点のみを使った直交配線・合流（SVG描画）
- 行/列レイアウトを共通定数で使ったPDF出力（ReportLab）。A4横向きに自動スケールし、列ヘッダ・ノード・項目・マーク・配線を描画します。

## PDF出力
- トップバーの「PDF出力」ボタンを押すと、未保存の変更を保存したうえでPDFをダウンロードします。同時に `backend/data/pdf/` にもファイルが保存されます。
- レイアウトは列幅320px・列余白14px・行高140pxなどフロントと共通の定数で計算され、A4横向きページに自動スケールされます。
- 生成物には列ヘッダ、ノード枠、タイトル、項目行、マーク文字(〇/△/×/顕)、直交エッジ（合流点丸・交差ジャンパ・矢印ヘッド）が含まれます。
- reportlab が利用できない環境では 503 を返します。

API から直接呼びたい場合は以下を参照してください。
```
POST http://localhost:8000/api/diagrams/{diagram_id}/export/pdf
```

## 今後の拡張のメモ
- 交差回避の高度化（ノード矩形を障害物とした経路探索）
- Makefile 等でのワンコマンド起動

## 開発メモ（目視確認用）
- 同一終点に複数エッジを引き、終点直前で1本にまとまることを確認する（例: 列1の3ノード→列2の1ノード）。
- 奇数列/偶数列それぞれで項目のラベル欄に平仮名/カタカナ連番が自動付与されること、手動編集しても上書きされないことを確認する。
- 項目右端のドロップダウンがテキストと干渉しないこと、列幅が内容に合わせて広がることを確認する。
