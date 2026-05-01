import { CONFIG, FLIGHT_MODES } from './Config.js';
import { touchInput } from './TouchInput.js';

export class InputController {
    constructor() {
        // 預設值由 joystickType 決定：置中型搖桿 → ALT_HOLD + 油門 50%；RC 飛手桿 → ANGLE + 油門 0
        const isCentering = CONFIG.joystickType === 'centering';
        this.state = {
            t: isCentering ? 0.5 : 0, r: 0, p: 0, y: 0,
            armed: false,
            flightMode: isCentering ? FLIGHT_MODES.ALT_HOLD : FLIGHT_MODES.ANGLE
        };
        this.gamepadIndex = null;
        this.useKeyboard = false; // 鍵盤模式開關
        this.useTouch = false;    // 觸控模式開關
        this.useHybrid = false;   // 混合模式（左手把+鍵盤）
        this._hybridPitch = 0;    // 混合模式俯仰平滑值
        this._hybridRoll = 0;     // 混合模式橫滾平滑值

        // Link touch input to our state for arm/mode buttons
        touchInput.linkState(this.state);

        // --- 鍵盤狀態 ---
        this.keys = {};
        this.keyThrottle = 0; // 油門需要累加，不是瞬間的

        const onKey = (e) => {
            if (e.repeat) return;
            this.keys[e.code] = true;

            // Space 切換解鎖
            if (e.code === 'Space') {
                this.state.armed = !this.state.armed;
                e.preventDefault();
            }
            // 1/2/3 切換飛行模式
            if (e.code === 'Digit1') this.state.flightMode = FLIGHT_MODES.ANGLE;
            if (e.code === 'Digit2') this.state.flightMode = FLIGHT_MODES.HORIZON;
            if (e.code === 'Digit3') this.state.flightMode = FLIGHT_MODES.ACRO;
            if (e.code === 'Digit4') this.state.flightMode = FLIGHT_MODES.ALT_HOLD;
            // K 切換鍵盤/搖桿模式
            if (e.code === 'KeyK') {
                this.useKeyboard = !this.useKeyboard;
                const msg = this.useKeyboard ? '⌨️ 鍵盤模式' : '🎮 搖桿模式';
                window.dispatchEvent(new CustomEvent('input-mode-change', { detail: msg }));
            }
            // R 重置無人機
            if (e.code === 'KeyR') {
                window.dispatchEvent(new Event('reset-drone'));
            }
        };
        window.addEventListener('keydown', onKey);
        window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

        // --- 搖桿連接 ---
        window.addEventListener("gamepadconnected", (e) => {
            this.gamepadIndex = e.gamepad.index;
            window.dispatchEvent(new CustomEvent('gamepad-ready', { detail: { gamepad: e.gamepad } }));
        });
        window.addEventListener("gamepaddisconnected", (e) => {
            if (this.gamepadIndex === e.gamepad.index) {
                this.gamepadIndex = null;
            }
        });
    }

    updateConfig(newAxes, newInverts) {
        if(newAxes) CONFIG.axes = newAxes;
        if(newInverts) CONFIG.invert = newInverts;
    }

    calibrateCenter() {
        const gp = navigator.getGamepads()[this.gamepadIndex];
        if(!gp) return;
        CONFIG.calibration.roll = gp.axes[CONFIG.axes.roll] || 0;
        CONFIG.calibration.pitch = gp.axes[CONFIG.axes.pitch] || 0;
        CONFIG.calibration.yaw = gp.axes[CONFIG.axes.yaw] || 0;
        alert("校正完成！請確認搖桿回中後再試。");
    }

    calibrateMin(channel) {
        const gp = navigator.getGamepads()[this.gamepadIndex];
        if(!gp) return;
        const axisIdx = CONFIG.axes[channel];
        if(axisIdx === undefined) return;
        CONFIG.endpoints[channel].min = gp.axes[axisIdx] || 0;
    }

    calibrateMax(channel) {
        const gp = navigator.getGamepads()[this.gamepadIndex];
        if(!gp) return;
        const axisIdx = CONFIG.axes[channel];
        if(axisIdx === undefined) return;
        CONFIG.endpoints[channel].max = gp.axes[axisIdx] || 0;
    }

    mapToRange(val, min, max) {
        if(max === min) return 0;
        return ((val - min) / (max - min)) * 2 - 1;
    }

    // --- 鍵盤輸入更新 ---
    updateKeyboard() {
        const now = performance.now();
        const dt = this._lastKeyboardTime ? (now - this._lastKeyboardTime) / 1000 : 1 / 60;
        this._lastKeyboardTime = now;

        const k = this.keys;

        // Alt Hold 模式：固定油門值（鍵盤無法精確控制連續油門）
        if (this.state.flightMode === FLIGHT_MODES.ALT_HOLD) {
            if (k['KeyW']) {
                this.keyThrottle = 0.8;
            } else if (k['KeyS']) {
                this.keyThrottle = 0.2;
            } else {
                this.keyThrottle = 0.5;
            }
        } else {
            // W 按住就飛，放開油門快速歸零（模擬真實：鬆油門 = 斷電墜落）
            if (k['KeyW']) {
                this.keyThrottle = Math.min(1, this.keyThrottle + 2.4 * dt);
            } else {
                this.keyThrottle *= Math.pow(0.85, dt * 60);
                if (this.keyThrottle < 0.01) this.keyThrottle = 0;
            }
            // S 直接油門歸零
            if (k['KeyS']) this.keyThrottle = 0;
        }
        this.state.t = this.keyThrottle;

        // 方向鍵：俯仰/橫滾（按住有值，放開回零）
        // ANGLE/ALT_HOLD use smaller deflection for gentler control
        const fm = this.state.flightMode;
        const stickVal = (fm === FLIGHT_MODES.ANGLE || fm === FLIGHT_MODES.ALT_HOLD) ? 0.35 : 0.6;
        let pitch = 0, roll = 0, yaw = 0;
        if (k['ArrowUp'])    pitch = -stickVal;
        if (k['ArrowDown'])  pitch =  stickVal;
        if (k['ArrowLeft'])  roll  = -stickVal;
        if (k['ArrowRight']) roll  =  stickVal;

        // A/D 轉向
        if (k['KeyA']) yaw = -0.6;
        if (k['KeyD']) yaw =  0.6;

        // Shift 精密模式（按住縮小操控量）
        if (k['ShiftLeft'] || k['ShiftRight']) {
            pitch *= 0.4;
            roll *= 0.4;
            yaw *= 0.4;
        }

        // 限制範圍
        this.state.p = Math.max(-1, Math.min(1, pitch));
        this.state.r = Math.max(-1, Math.min(1, roll));
        this.state.y = Math.max(-1, Math.min(1, yaw));

        return this.state;
    }

    // --- 搖桿輸入更新 ---
    updateGamepad() {
        const gamepads = navigator.getGamepads();
        if (this.gamepadIndex === null || !gamepads[this.gamepadIndex]) return this.state;

        const gp = gamepads[this.gamepadIndex];
        const ax = CONFIG.axes;
        const inv = CONFIG.invert;
        const cal = CONFIG.calibration;
        const ep = CONFIG.endpoints;

        const readAxis = (idx, invert, offset = 0, channel = null) => {
            if (idx === undefined || idx === null) return 0;
            let val = gp.axes[idx] || 0;
            if (channel && ep[channel]) {
                val = this.mapToRange(val, ep[channel].min, ep[channel].max);
            }
            val = val - offset;
            val = Math.max(-1, Math.min(1, val));
            if (Math.abs(val) < 0.12) val = 0;
            return invert ? -val : val;
        };

        // 油門：依搖桿類型 + 飛行模式選擇 position mode（DJI 風格）或 rate mode（FPV 風格）
        let rawThr = gp.axes[ax.thrust] || 0;
        if (Math.abs(rawThr) < 0.12) rawThr = 0; // 中心死區
        if (inv.t) rawThr = -rawThr;

        const isCentering = CONFIG.joystickType === 'centering';
        const isAltHold = this.state.flightMode === FLIGHT_MODES.ALT_HOLD;

        if (!isCentering || isAltHold) {
            // position mode：桿位直接 = 油門
            //   - 不置中 RC 桿：桿底=0%、桿頂=100%（真實 RC 行為）
            //   - 置中桿 + ALT_HOLD：鬆桿回中 = 50% = PID 懸停（DJI 風格）
            this.state.t = Math.max(0, Math.min(1, 0.5 - rawThr * 0.5));
        } else {
            // rate mode：置中桿 + ACRO/ANGLE/HORIZON — 推上加、推下減、鬆桿油門保持
            const now_t = performance.now();
            const dt_t = this._lastGamepadTime ? (now_t - this._lastGamepadTime) / 1000 : 1/60;
            this._lastGamepadTime = now_t;
            if (this.state.t === undefined) this.state.t = 0.5;
            const thrRate = 1.5;
            this.state.t = Math.max(0, Math.min(1, this.state.t - rawThr * thrRate * dt_t));
        }

        // 姿態
        this.state.r = readAxis(ax.roll, inv.a, cal.roll, 'roll');
        this.state.p = readAxis(ax.pitch, inv.e, cal.pitch, 'pitch');
        this.state.y = readAxis(ax.yaw, inv.r, cal.yaw, 'yaw');

        // 解鎖：RC 真實遙控器方式
        // 解鎖：左搖桿推到左下角（油門最低 + 偏航最左）hold 2 秒 → armed
        // 上鎖：左搖桿推到右下角（油門最低 + 偏航最右）hold 2 秒 → disarmed
        if (ax.arm === -1 || ax.arm === undefined) {
            // 初始化時預設解鎖
            if (this.state.armed === undefined) this.state.armed = true;
            
            const thrRaw = gp.axes[ax.thrust] || 0;
            const yawRaw = gp.axes[ax.yaw] || 0;
            const pitchRaw = gp.axes[ax.pitch] || 0;
            const rollRaw = gp.axes[ax.roll] || 0;

            // 內八解鎖：左搖桿右下 + 右搖桿左下 hold 2s
            const thrDown  = thrRaw > 0.7;      // 左搖桿往下
            const yawRight = yawRaw > 0.7;       // 左搖桿往右
            const pitchDown = pitchRaw > 0.7;    // 右搖桿往下
            const rollLeft  = rollRaw < -0.7;    // 右搖桿往左
            const isInnerCross = thrDown && yawRight && pitchDown && rollLeft;

            // 外八上鎖：左搖桿左下 + 右搖桿右下 hold 2s
            const yawLeft  = yawRaw < -0.7;
            const rollRight = rollRaw > 0.7;
            const isOuterCross = thrDown && yawLeft && pitchDown && rollRight;

            if (!this.state.armed && isInnerCross) {
                if (!this._armHoldStart) this._armHoldStart = now_t;
                if (now_t - this._armHoldStart > 2000) {
                    this.state.armed = true;
                    this._armHoldStart = null;
                    window.dispatchEvent(new CustomEvent('input-mode-change', { detail: '🔓 已解鎖' }));
                }
            } else if (this.state.armed && isOuterCross) {
                if (!this._disarmHoldStart) this._disarmHoldStart = now_t;
                if (now_t - this._disarmHoldStart > 2000) {
                    this.state.armed = false;
                    this.state.t = 0;
                    this._disarmHoldStart = null;
                    window.dispatchEvent(new CustomEvent('input-mode-change', { detail: '🔒 已上鎖' }));
                }
            } else {
                this._armHoldStart = null;
                this._disarmHoldStart = null;
            }
        } else {
            const armVal = gp.axes[ax.arm] || -1;
            this.state.armed = armVal > 0.5;
        }

        // 模式切換（四段開關，mode 軸未設定時維持現有模式）
        if (ax.mode !== -1 && ax.mode !== undefined) {
            const modeVal = gp.axes[ax.mode] || -1;
            if (modeVal < -0.5) this.state.flightMode = FLIGHT_MODES.ANGLE;
            else if (modeVal < 0) this.state.flightMode = FLIGHT_MODES.HORIZON;
            else if (modeVal < 0.5) this.state.flightMode = FLIGHT_MODES.ACRO;
            else this.state.flightMode = FLIGHT_MODES.ALT_HOLD;
        }

        return this.state;
    }

    updateTouch() {
        const v = touchInput.update();
        this.state.t = v.t;
        this.state.y = v.y;
        this.state.p = v.p;
        this.state.r = v.r;
        // armed and flightMode are set directly by touch buttons via linkState
        return this.state;
    }

    // --- 混合模式：左搖桿油門+偏航，鍵盤俯仰+橫滾 ---
    updateHybrid() {
        const gamepads = navigator.getGamepads();
        const gp = (this.gamepadIndex !== null) ? gamepads[this.gamepadIndex] : null;

        // --- 油門：左搖桿 AXIS 1 ---
        const thrAxis = (window._gpAxisConfig && window._gpAxisConfig.thrust !== undefined)
            ? window._gpAxisConfig.thrust : 1;
        if (gp && gp.axes[thrAxis] !== undefined) {
            const axisVal = gp.axes[thrAxis];
            // 往上推 axis 變負，往下拉變正 → thrust = (1 - axisVal) / 2
            let thrust = (1 - axisVal) / 2;
            // deadzone around center (~0.5)
            if (Math.abs(thrust - 0.5) < 0.12) thrust = 0.5;
            // 低通濾波：平滑雜訊
            this._thrSmooth = this._thrSmooth !== undefined ? this._thrSmooth : thrust;
            this._thrSmooth += (thrust - this._thrSmooth) * 0.15;
            this.state.t = Math.max(0, Math.min(1, this._thrSmooth));
        }

        // W/S 鍵盤油門也保留（可以同時用鍵盤控油門）
        const now = performance.now();
        const dt = this._lastHybridTime ? (now - this._lastHybridTime) / 1000 : 1 / 60;
        this._lastHybridTime = now;
        const k = this.keys;
        if (k['KeyW']) {
            this.state.t = Math.min(1, this.state.t + 2.4 * dt);
        }
        if (k['KeyS']) {
            this.state.t = Math.max(0, this.state.t - 2.4 * dt);
        }

        // --- 偏航：左搖桿 AXIS 0 ---
        const yawAxis = (window._gpAxisConfig && window._gpAxisConfig.yaw !== undefined)
            ? window._gpAxisConfig.yaw : 0;
        if (gp && gp.axes[yawAxis] !== undefined) {
            let yaw = gp.axes[yawAxis];
            if (Math.abs(yaw) < 0.12) yaw = 0;
            this.state.y = Math.max(-1, Math.min(1, yaw));
        }

        // --- 俯仰/橫滾：鍵盤方向鍵優先，否則用手把數位按鈕 ---
        const fm = this.state.flightMode;
        const kbStickVal = (fm === FLIGHT_MODES.ANGLE || fm === FLIGHT_MODES.ALT_HOLD) ? 0.35 : 0.6;
        let pitch = 0, roll = 0;
        const kbPitch = k['ArrowUp'] || k['ArrowDown'];
        const kbRoll  = k['ArrowLeft'] || k['ArrowRight'];

        if (k['ArrowUp'])    pitch = -kbStickVal;
        if (k['ArrowDown'])  pitch =  kbStickVal;
        if (k['ArrowLeft'])  roll  = -kbStickVal;
        if (k['ArrowRight']) roll  =  kbStickVal;

        // 手把數位按鈕（B0~B3 / B12~B15），鍵盤沒按時才用
        const gpStickVal = 0.5;
        if (gp) {
            const btn = (i) => gp.buttons[i] && gp.buttons[i].pressed;
            // 取 B0~B3 和 B12~B15 的最大值
            const btnUp    = btn(0) || btn(12);
            const btnDown  = btn(1) || btn(13);
            const btnLeft  = btn(2) || btn(14);
            const btnRight = btn(3) || btn(15);

            if (!kbPitch) {
                if (btnUp)   pitch = -gpStickVal;
                if (btnDown) pitch =  gpStickVal;
            }
            if (!kbRoll) {
                if (btnLeft)  roll = -gpStickVal;
                if (btnRight) roll =  gpStickVal;
            }
        }

        // Shift 精密模式
        if (k['ShiftLeft'] || k['ShiftRight']) {
            pitch *= 0.4;
            roll *= 0.4;
        }

        // 平滑插值
        const targetPitch = pitch;
        const targetRoll = roll;
        const smoothing = 8;
        this._hybridPitch += (targetPitch - this._hybridPitch) * Math.min(1, smoothing * dt);
        this._hybridRoll += (targetRoll - this._hybridRoll) * Math.min(1, smoothing * dt);
        this.state.p = Math.max(-1, Math.min(1, this._hybridPitch));
        this.state.r = Math.max(-1, Math.min(1, this._hybridRoll));

        return this.state;
    }

    update() {
        if (this.useHybrid) {
            return this.updateHybrid();
        } else if (this.useTouch) {
            return this.updateTouch();
        } else if (this.useKeyboard) {
            return this.updateKeyboard();
        } else {
            return this.updateGamepad();
        }
    }
}
