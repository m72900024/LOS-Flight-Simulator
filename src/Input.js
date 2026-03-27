import { CONFIG, FLIGHT_MODES } from './Config.js';
import { touchInput } from './TouchInput.js';

export class InputController {
    constructor() {
        this.state = {
            t: 0, r: 0, p: 0, y: 0,
            armed: false,
            flightMode: FLIGHT_MODES.ANGLE
        };
        this.gamepadIndex = null;
        this.useKeyboard = false; // 鍵盤模式開關
        this.useTouch = false;    // 觸控模式開關
        this.useHybrid = false;   // 混合模式（左手把+鍵盤）

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
            if (Math.abs(val) < 0.05) val = 0;
            return invert ? -val : val;
        };

        // 油門
        let rawThr = gp.axes[ax.thrust] || 0;
        let mappedThr = this.mapToRange(rawThr, ep.thrust.min, ep.thrust.max);
        if (inv.t) mappedThr = -mappedThr;
        this.state.t = Math.max(0, Math.min(1, (mappedThr + 1) / 2));

        // 姿態
        this.state.r = readAxis(ax.roll, inv.a, cal.roll, 'roll');
        this.state.p = readAxis(ax.pitch, inv.e, cal.pitch, 'pitch');
        this.state.y = readAxis(ax.yaw, inv.r, cal.yaw, 'yaw');

        // 解鎖
        const armVal = gp.axes[ax.arm] || -1;
        this.state.armed = armVal > 0.5;

        // 模式切換（四段開關）
        const modeVal = gp.axes[ax.mode] || -1;
        if (modeVal < -0.5) this.state.flightMode = FLIGHT_MODES.ANGLE;
        else if (modeVal < 0) this.state.flightMode = FLIGHT_MODES.HORIZON;
        else if (modeVal < 0.5) this.state.flightMode = FLIGHT_MODES.ACRO;
        else this.state.flightMode = FLIGHT_MODES.ALT_HOLD;

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
            if (Math.abs(thrust - 0.5) < 0.05) thrust = 0.5;
            this.state.t = Math.max(0, Math.min(1, thrust));
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
            if (Math.abs(yaw) < 0.05) yaw = 0;
            this.state.y = Math.max(-1, Math.min(1, yaw));
        }

        // --- 俯仰/橫滾：鍵盤方向鍵 ---
        const fm = this.state.flightMode;
        const stickVal = (fm === FLIGHT_MODES.ANGLE || fm === FLIGHT_MODES.ALT_HOLD) ? 0.35 : 0.6;
        let pitch = 0, roll = 0;
        if (k['ArrowUp'])    pitch = -stickVal;
        if (k['ArrowDown'])  pitch =  stickVal;
        if (k['ArrowLeft'])  roll  = -stickVal;
        if (k['ArrowRight']) roll  =  stickVal;

        // Shift 精密模式
        if (k['ShiftLeft'] || k['ShiftRight']) {
            pitch *= 0.4;
            roll *= 0.4;
        }

        this.state.p = Math.max(-1, Math.min(1, pitch));
        this.state.r = Math.max(-1, Math.min(1, roll));

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
