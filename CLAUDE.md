## 推送規則

- 每次 push 前，更新 CHANGELOG.md，新增對應版本條目
- 版本號遞增規則：小改動 patch（v2.2.1），新功能 minor（v2.3），大改版 major（v3.0）
- CHANGELOG 格式：## vX.X（YYYY-MM-DD）+ 條列式說明
- Commit message 使用中文，簡潔描述改動內容

## Cache buster 規則（v2.14 起）

- **所有** ES module import（src/*.js 互相 import + index.html 的 main.js）都帶同一個 `?v=<tag>` 版號
- ⚠️ 版號必須**全部一致**：若 `Config.js?v=A` 與 `Config.js?v=B` 並存，瀏覽器視為兩個模組 → CONFIG 狀態分裂
- 每次更新 JS/CSS，用 sed 一次全打（並同步 index.html 右下角 build tag）：
  ```bash
  NEW=20260701-xxx; OLD=$(grep -o 'v=[a-z0-9.-]*' index.html | head -1 | cut -c3-)
  sed -i '' "s/?v=$OLD/?v=$NEW/g; s/build: $OLD/build: $NEW/" index.html src/*.js
  ```
- three.js 已 vendor 在 `lib/three.min.js`（r128），不走 CDN
