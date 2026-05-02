# Changelog

## v2.9（2026-05-02）— 風力陣風（致敬 tamago797）
- 新增環境風力，**預設關閉**，1-9 級可調（致謝 tamago797 並改寫為 dt-based 幀率獨立）
- 8 方向隨機陣風，每 1-2 秒換向；陣風強度線性對應級數（每級 0.6 m/s 水平 + 0.18 m/s 垂直擾動）
- 平滑過渡（exponential decay k=1-0.97^(dt*60)），不會突然抽插
- 飛行中才受風（高度 > 2× hardDeck），地面停機不會被吹走
- 風向袋同步擺動：`windLevel > 0` 時袋子依實際風向倒；關閉時用基本搖擺
- 配色面板新增風力滑桿，偏好存於 localStorage（`flightSimWindLevel`）
- cache buster 更新為 `v=20260502-wind`

## v2.8（2026-05-02）— 雙圓考場 + 智慧 H 點亮（致敬 tamago797）
- 經 tamago797 2026-04-22 [Facebook 公開授權](https://www.facebook.com/groups/617255772136182/posts/2279968069198269/) 後重新採用：
  - **雙圓考場標線**：對應 CAA AC107-005A 多旋翼基本級術科考場（圓心 ±6，內 4m / 中 6m 虛線 / 外 8m），加中央 4m × 28m 測驗區方框
  - **智慧 H 停機坪**：drone < 1m + 低高度 → H 字動態亮螢光綠，協助降落判定精準度
- README 加致謝段（@tamago797）+ 引用 Facebook 授權連結
- README 加「相關工具」段，導流到 [tamago797/Drone-Exam](https://github.com/tamago797/Drone-Exam) 學科筆試模擬
- 風力 / 雷達兩項功能仍未引入（前者新手不友善、後者跟現有紅圓環+lookAt 重複）
- cache buster 更新為 `v=20260502-examfield`

## v2.7.6（2026-05-02）
- 遊戲畫面右下角的 ARMED/DISARMED 狀態加上手勢 hold 進度顯示
  （🤘 ARMING XX% / 🤙 DISARMING XX%），方便在遊戲中知道內八/外八手勢有沒有被偵測到
- cache buster 更新為 `v=20260502-armhud`

## v2.7.5（2026-05-02）
- 草地預設色改為「森林」（外 `0x14541a` / 內 `0x2a7a2e`）
- 原本的中綠預設值保留為「中綠」preset
- 配色面板「預設」按鈕改為「森林」標籤，新增「中綠」preset 補位
- cache buster 更新為 `v=20260502-forestdef`

## v2.7.4（2026-05-02）
- 修正內八/外八手勢觸發時 `ReferenceError: now_t is not defined` bug
- 原因：`now_t` 只在 rate mode 油門分支內 declare，但置中桿 + ALT_HOLD 走 position mode，那邊不會 declare，gesture 邏輯讀不到
- 修法：把 `now_t = performance.now()` 提到油門 if/else 之前，整個 updateGamepad 共用
- cache buster 更新為 `v=20260502-nowfix`

## v2.7.3（2026-05-02）
- 移除最底部多餘的「🎮 搖桿模式」按鈕（之前只是 shortcut 跳到關卡選擇，與搖桿配置區內的開始按鈕功能重複）
- 連帶移除無用的 `window.startGameApp` 函式
- cache buster 更新為 `v=20260502-cleanbtn`

## v2.7.2（2026-05-02）— 天空可調 + 曝光預設最低
- 配色面板新增「天空」區塊：高 / 中 / 地平線 三色獨立 picker + 6 個 preset（預設 / 晴朗白天 / 陰天 / 黃昏 / 夜晚 / 清晨）
- 曝光預設值從 0.88 改為 **0.40**（範圍最低、最深、最高對比）
- Scene 加 `setSkyColors({ top, mid, horizon })` 方法操作 sky shader uniforms
- 天空偏好存於 localStorage：`flightSimSkyTop / flightSimSkyMid / flightSimSkyHorizon`
- cache buster 更新為 `v=20260502-sky`

## v2.7.1（2026-05-02）— 配色面板可即時預覽
- GameScene 改 eager init（模組載入時就建立），原本 lazy init 導致使用者在 setup 階段拉色票時 gameScene 還不存在，動作沒生效
- 設定畫面背景透明度 `0.95 → 0.78`，色票拖動時可即時看到背景場景變色
- animate loop 在 SETUP / LEVEL_SELECT 狀態也呼叫 `gameScene.render()`，讓背景持續更新
- 載入時自動套用 localStorage 偏好（之前只在進關卡時才套）
- cache buster 更新為 `v=20260502-eager`

## v2.7（2026-05-02）— 場景配色面板
- 左上角新增 🎨 場景配色 浮動面板（點開合），即時調 + 偏好存 localStorage
- **草地**：外圈 / 內圈 各自 color picker + 5 個 preset（預設 / 鮮 / 深 / 高爾夫 / 森林）
- **霧色**：color picker + 5 個 preset（預設灰藍 / 晴朗 / 陰天 / 黃昏 / 深夜）
- **曝光對比**：滑桿 0.4 ~ 1.5（值越低 = 陰影越深、對比越強）
- Scene 加 `setGrassColors / setFogColor / setExposure` 三個 setter
- 載入時自動套用 localStorage 偏好
- cache buster 更新為 `v=20260502-tuner`

## v2.6.1（2026-05-02）
- 草地綠色再加飽和度（保持 v2.6 的深調，但讓綠更綠）：
  - 外圈：`0x2a6e2a`（偏暗黃綠）→ `0x2a8a2a`（更純的深草綠）
  - 內圈：`0x3d8a3d`（中綠）→ `0x4cb04c`（亮一階草地綠）
- cache buster 更新為 `v=20260502-greener`

## v2.6（2026-05-02）— 視覺深化
- 整體調色「深一點 + 對比高一點」，去除偏白霧感：
  - **霧**：色 `0xbbd8f0`（淺藍）→ `0x5a7a8c`（深藍灰），密度 0.0038 → 0.0018
  - **toneMappingExposure**：1.1 → **0.88**（<1 加深陰影、提升對比）
  - **HemisphereLight 強度**：0.75 → **0.38**（少 fill = 陰影深）
  - **Fill 副光強度**：0.28 → 0.18，色降飽和
  - **主日光強度**：1.4 → 1.7（讓主光更突出）
  - **天空 top/mid/horizon**：全部加深一階（去 pastel 感）
  - **草地外圈**：螢光綠 `0x3de651` → 深天然綠 `0x2a6e2a`
  - **草地內圈**：薄荷 `0x66f59a` → 中綠 `0x3d8a3d`
- cache buster 更新為 `v=20260502-darker`

## v2.5.3（2026-05-02）
- 內八/外八手勢門檻從 0.7 放寬到 **0.55**，較容易達成
- 設定畫面解鎖文字加 hold 進度顯示（🤘 解鎖中 XX% / 🤙 上鎖中 XX%）
- 右下角新增 build tag（`build: 20260502-armprog`），方便驗證瀏覽器有抓到新版（看不到舊版號就是抓到了）
- InputController 補初始化 `_prevBtn0` / `_armHoldStart` / `_disarmHoldStart`，避免首幀殘值
- cache buster 更新為 `v=20260502-armprog`

## v2.5.2（2026-05-02）
- 新增搖桿按鈕解鎖：按鈕 0（Xbox A / PS X / 多數手把主按鈕）按一下切換解鎖 / 上鎖
- 設定畫面新增解鎖方式說明卡（按鈕 / 內八手勢 / 外八手勢 / Space）
- 上鎖後油門依搖桿類型重置（置中型 0.5、不置中 0）
- 既有 2 秒內八/外八手勢保留，三種解鎖方式並存任選
- cache buster 更新為 `v=20260502-btnarm`

## v2.5.1（2026-05-02）
- 修正 yaw 旋轉方向相反的 bug：左推搖桿 / 按 A 鍵應該左轉，但實際是右轉
- 原因：Three.js 正 Y 軸旋轉是逆時針（=左轉），但 Physics 直接套 input.y 等於把符號反掉
- 修法：在 Physics input gate 一次性 flip yaw 符號（`aIn.y = -input.y`），ACRO/ANGLE/HORIZON/ALT_HOLD 全部模式一起對齊
- 設定畫面的 state.y 顯示不變（仍維持搖桿原始符號）
- cache buster 更新為 `v=20260502-yawfix`

## v2.5（2026-05-02）
- 新增飛行難度選項（新手 / 一般 / 專家），預設 **新手** 最低靈敏度
- 各難度預設值：
  - 🌱 新手：rates 0.30 / superRate 0.0 / 最大傾角 20° / thrustExpo 0.6
  - ⚡ 一般：rates 0.80 / superRate 0.3 / 最大傾角 40° / thrustExpo 0.4
  - 🔥 專家：rates 1.20 / superRate 0.7 / 最大傾角 55° / thrustExpo 0.3（原本預設值）
- 設定畫面頂部新增 radio 即時切換，存於 localStorage
- cache buster 更新為 `v=20260502-difficulty`

## v2.4.5（2026-05-02）
- 翻轉前後配色為「前綠 / 後紅」
- 影響：臂尖+中段 LED 與 halo、馬達鐘罩、螺旋槳模糊碟全部一起切色
- 前綠 LED 維持閃爍（搶眼），後紅 LED 改為常亮（穩定參考點）
- `isRed` 旗標重新命名為 `isFront`（避免語義誤導）
- cache buster 更新為 `v=20260502-greenred`

## v2.4.4（2026-05-02）
- 強化無人機 LED 可見度（解決 LOS 飛遠時看不出前後）：
  - 臂尖 LED 球體 0.006 → 0.015（2.5×），顏色加亮（紅 0xff3333 / 藍 0x3366ff）
  - 每顆 LED 加環繞光暈（halo，加色混合 + 0.045 半徑）
  - 每根臂中段加第二顆同色 LED + 小 halo（4 顆 → 8 顆主 LED）
  - 後方狀態 LED 加大（0.013 → 0.020）+ 同步色 halo
  - 新增機腹下投光（白色 0.025 + halo 0.080），LOS 飛遠時鎖位
- cache buster 更新為 `v=20260502-brightled`

## v2.4.3（2026-05-02）
- 達標目標從綠/橙色實心球改為紅色薄圓環（thin torus），active 圓環每幀 lookAt(drone) 永遠面向飛機
- 解決原本實心球體在飛機接近時遮住視線的問題（圓環中央透空）
- 影響關卡：L3/L4/L5（前後/左右/矩形）、L7（8 字飛行）的達標標記
- cache buster 更新為 `v=20260502-redring`

## v2.4.2（2026-05-02）
- 修正未解鎖（disarmed）時搖桿仍可控制姿態的 bug：
  推 pitch/roll/yaw 時飛機在地上/空中還會旋轉。現改為未解鎖時姿態指令歸零，
  既有角速度也透過原本的 lerp/damping 自然收斂為 0
- cache buster 更新為 `v=20260502-armgate`

## v2.4.1（2026-05-02）
- 修正置中桿 ALT_HOLD 油門邏輯：從 rate mode 改為 position mode（DJI 風格），鬆桿回中 = 50% = PID 懸停
- 不置中 RC 飛手桿全模式統一 position mode（真實 RC 行為）
- 置中桿 + ACRO/ANGLE/HORIZON 維持 rate mode（FPV 飛手習慣，鬆桿油門保持）
- cache buster 更新為 `v=20260502-pos`

## v2.4（2026-05-02）
- 新增搖桿類型選項（置中型 / 不置中型 RC），存於 localStorage
- 置中型搖桿（遊戲手把）油門初值改為 50%、預設飛行模式 ALT_HOLD（鬆桿即懸停）
- 不置中型 RC 飛手桿維持油門 0%、預設 ANGLE（手動推油門起飛）
- 設定畫面在搖桿配置區塊新增 radio 選擇器，含對應油門/模式說明文字
- cache buster 更新為 `v=20260502-jtype`

## v2.3.1（2026-05-01）
- 清空 v2.4 借鑒功能實驗（雙圓考場 / 風力 / H 點亮燈 / 雷達），授權狀態未確認前不採用
- cache buster 強制更新為 `v=20260502-clean`，確保使用者瀏覽器讀新檔
- 清掉 v2.4 revert 後 main.js 多餘的空行

## v2.3（2026-04-06）
- 修復記憶體洩漏：切換關卡時正確 dispose 舊的 geometry/material/texture，防止 GPU 記憶體累積
- 修復 AudioContext 自動播放政策：新增 ctx.resume()，Chrome/Safari 馬達音效正常播放
- 修復物理參數面板無法顯示：toggle 時切換 display:flex/none
- 修復羅盤方位反轉：Three.js Y 軸旋轉取反，右轉時方位角正確遞增
- 修復幀率依賴問題：螺旋槳轉速、雲朵移動、攝影機跟隨改為基於 dt，不同幀率行為一致
- 修復搖桿校準預設值：從特定搖桿偏移值 0.00392 改為通用零點 0
- 新增水平邊界軟限制：超過 80m 後逐漸減速回拉，防止飛機飛出場地外消失
- 修復術科考降落判定：加入速度檢查（< 1.5 m/s），高速撞地不算降落過關
- 重構 ANGLE/ALT_HOLD 姿態控制：抽出共用 _applyAngleAttitude()，消除重複程式碼

## v2.2.3（2026-04-03）
- 草地顏色大幅調綠（外圈 #2ecc71、內圈 #55e088），對比更明顯

## v2.2.2（2026-04-02）
- 草地顏色調亮調綠（外圈 #4ca83a、內圈 #5cbf45），視覺更鮮明
- pixelRatio 上限提升至 3，高解析螢幕更清晰
- 陰影貼圖從 2048×2048 提升至 4096×4096，陰影邊緣更細緻

## v2.2.1（2026-04-02）
- 修復高度警告 ⚠️ 每幀累加的顯示 bug
- localStorage 讀取加 try-catch，防止損壞資料導致 crash
- modeNames 提取為模組級常數，減少每幀物件分配與 GC 壓力
- 新增 gamepaddisconnected 監聽器，搖桿斷線時清除過期引用

## v2.2（2026-03-01）
- L8 術科模擬考試：第 8 關改為台灣 CAA 無人機基本級術科模擬考試（20 步驟），涵蓋定點起降、四面停懸、矩形航線順逆時針
- 飛行模式中文名稱修正：ANGLE=自穩、HORIZON=半自穩、ACRO=手動、ALT_HOLD=定高
- 手機觸控模式：新增雙虛擬搖桿觸控操控，支援 ARM/MODE 按鈕
- Alt Hold 鍵盤操控修正：改為固定油門值（放開=50% 定高、W=80% 爬升、S=20% 下降）

## v2.1（2026-03-01）
- Shift 精準模式修正：Shift 鍵改為降低靈敏度（操控量 ×0.4），精細操控而非加速
- Alt Hold PD 控制器：定高模式改用 PD 高度控制器（kP=8, kD=5×mass），精確鎖定高度不飄移
- 第 1 關寬容度提升：離開目標高度時計時器倒扣速度由 ×2 降為 ×0.5，更容易過關
- ESC 返回設定畫面：在關卡選擇畫面按 ESC 可返回設定畫面
- Space 防連發：Space 鍵不再自動重複觸發，防止誤操作
- 幀率獨立油門：油門增減與衰減改為時間制（基於 deltaTime），不同幀率下行為一致
- 撞地特效衰減修正：crashIntensity 衰減改為幀率獨立

## v2.0（2026-03-01）
- 場景升級：精緻 3D 環境（25 棵樹木、3 棟建築、圍欄、H 型降落場、風向袋）
- 陰影系統：PCFSoft 柔邊陰影（2048×2048 shadow map）
- 無人機模型：四軸放大 3 倍，紅藍馬達、旋轉螺旋槳、LED 指示燈
- LOS 視角：固定觀察點第三人稱視角，攝影機平滑跟隨
- 8 關卡系統：從起飛定高到模擬考試的完整訓練路徑
- 關卡選擇畫面：顯示解鎖狀態與最佳成績
- Alt Hold 定高模式：油門中位自動維持高度，初學者友善
- 撞地回饋：紅色閃光 + 攝影機抖動

## v1.1.0
- 搖桿端點校正：支援 Min/Max 端點自動校正

## v1.0
- 基礎 LOS 飛行模擬
- Acro / Angle / Horizon 三種飛行模式
- 搖桿 + 鍵盤雙輸入支援
- 2 個基礎訓練關卡
- 真實 FPV 無人機造型
- 鍵盤油門（按住飛行、放開下降）
