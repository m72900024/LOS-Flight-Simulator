import { FLIGHT_MODES } from './Config.js?v=20260613-uiplus';

/**
 * Dual virtual joystick system for mobile touch controls.
 * LEFT: Thrust (Y) + Yaw (X) — Mode 2 layout, thrust does NOT spring back
 * RIGHT: Pitch (Y) + Roll (X) — springs back to center on release
 */
class TouchInput {
    constructor() {
        this.active = false;       // true when any joystick is being touched
        this.values = { t: 0, y: 0, p: 0, r: 0 };

        // Joystick touch tracking
        this._left = { id: null, cx: 0, cy: 0, dx: 0, dy: 0 };
        this._right = { id: null, cx: 0, cy: 0, dx: 0, dy: 0 };

        // Throttle persists (doesn't spring back)
        this._throttle = 0;

        // State references (set externally by Input.js)
        this._state = null;

        // UI elements
        this._container = null;
        this._leftJoy = null;
        this._rightJoy = null;
        this._leftThumb = null;
        this._rightThumb = null;
        this._armBtn = null;
        this._modeBtn = null;

        this._isTouchDevice = ('ontouchstart' in window);
        if (this._isTouchDevice) {
            this._createUI();
            this._bindEvents();
        }
    }

    /** Link to InputController state for arm/mode buttons */
    linkState(state) {
        this._state = state;
    }

    _createUI() {
        // Main container
        const c = document.createElement('div');
        c.id = 'touch-controls';
        c.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:900;pointer-events:none;display:none;';
        document.body.appendChild(c);
        this._container = c;

        // Left joystick
        this._leftJoy = this._createJoystick(c, 'left', '油門/轉向');
        this._leftThumb = this._leftJoy.querySelector('.touch-thumb');

        // Right joystick
        this._rightJoy = this._createJoystick(c, 'right', '俯仰/橫滾');
        this._rightThumb = this._rightJoy.querySelector('.touch-thumb');

        // Arm button (right side, top:112 避開右上 HUD 文字列；底端貼齒輪 top:180)
        this._armBtn = document.createElement('div');
        this._armBtn.style.cssText = 'position:fixed;top:112px;right:15px;width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:#fff;pointer-events:auto;cursor:pointer;z-index:910;border:2px solid;user-select:none;-webkit-user-select:none;';
        this._updateArmBtn(false);
        c.appendChild(this._armBtn);

        // Mode button (left side, top:112 避開左上 HUD 文字列)
        this._modeBtn = document.createElement('div');
        this._modeBtn.style.cssText = 'position:fixed;top:112px;left:15px;width:60px;height:60px;border-radius:50%;background:rgba(0,100,200,0.5);border:2px solid rgba(100,180,255,0.5);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:#fff;pointer-events:auto;cursor:pointer;z-index:910;text-align:center;line-height:1.2;user-select:none;-webkit-user-select:none;';
        this._modeBtn.innerText = '自穩';
        c.appendChild(this._modeBtn);

        // Reset button (center, top:112 避開中央關卡標題/任務說明)
        const resetBtn = document.createElement('div');
        resetBtn.style.cssText = 'position:fixed;top:112px;left:50%;transform:translateX(-50%);width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,0.1);border:2px solid rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;font-size:18px;pointer-events:auto;cursor:pointer;z-index:910;user-select:none;-webkit-user-select:none;';
        resetBtn.innerText = '↺';
        resetBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            window.dispatchEvent(new Event('reset-drone'));
        });
        c.appendChild(resetBtn);
    }

    _createJoystick(parent, side, label) {
        const outerR = 60;
        const wrapper = document.createElement('div');
        const isLeft = side === 'left';
        wrapper.style.cssText = `position:fixed;bottom:30px;${isLeft ? 'left:40px' : 'right:40px'};pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;`;

        // Label
        const lbl = document.createElement('div');
        lbl.style.cssText = 'text-align:center;color:rgba(255,255,255,0.6);font-size:11px;margin-bottom:6px;pointer-events:none;';
        lbl.innerText = label;
        wrapper.appendChild(lbl);

        // Outer circle
        const outer = document.createElement('div');
        outer.className = 'touch-outer';
        outer.style.cssText = `width:${outerR * 2}px;height:${outerR * 2}px;border-radius:50%;background:rgba(255,255,255,0.15);border:2px solid rgba(255,255,255,0.3);position:relative;`;

        // Inner thumb
        const thumb = document.createElement('div');
        thumb.className = 'touch-thumb';
        thumb.style.cssText = `width:50px;height:50px;border-radius:50%;background:rgba(0,255,200,0.5);position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;transition:none;`;
        outer.appendChild(thumb);
        wrapper.appendChild(outer);
        parent.appendChild(wrapper);

        return wrapper;
    }

    _updateArmBtn(armed) {
        if (!this._armBtn) return;
        if (armed) {
            this._armBtn.style.background = 'rgba(0,180,0,0.5)';
            this._armBtn.style.borderColor = 'rgba(0,255,0,0.6)';
            this._armBtn.innerText = 'ARM';
        } else {
            this._armBtn.style.background = 'rgba(180,0,0,0.5)';
            this._armBtn.style.borderColor = 'rgba(255,0,0,0.6)';
            this._armBtn.innerText = 'DISARM';
        }
    }

    _cycleMode() {
        if (!this._state) return;
        const modes = [FLIGHT_MODES.ANGLE, FLIGHT_MODES.HORIZON, FLIGHT_MODES.ACRO, FLIGHT_MODES.ALT_HOLD];
        const names = ['自穩', '半自穩', '手動', '定高'];
        const idx = modes.indexOf(this._state.flightMode);
        const next = (idx + 1) % modes.length;
        this._state.flightMode = modes[next];
        this._modeBtn.innerText = names[next];
    }

    _bindEvents() {
        // Arm button
        this._armBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (!this._state) return;
            this._state.armed = !this._state.armed;
            this._updateArmBtn(this._state.armed);
        });

        // Mode button
        this._modeBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this._cycleMode();
        });

        // Joystick touch events on the whole screen (so dragging outside circle works)
        const zone = this._container;
        zone.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
        zone.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
        zone.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
        zone.addEventListener('touchcancel', (e) => this._onTouchEnd(e), { passive: false });
    }

    _getJoystickCenter(wrapper) {
        const outer = wrapper.querySelector('.touch-outer');
        const rect = outer.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    _isInJoystickZone(touch, wrapper) {
        const center = this._getJoystickCenter(wrapper);
        const dx = touch.clientX - center.x;
        const dy = touch.clientY - center.y;
        return Math.sqrt(dx * dx + dy * dy) < 120; // generous hit area
    }

    _onTouchStart(e) {
        for (const touch of e.changedTouches) {
            // Skip if touch is on a button
            const el = document.elementFromPoint(touch.clientX, touch.clientY);
            if (el && (el === this._armBtn || el === this._modeBtn || el.closest('#touch-controls > div:not(:nth-child(1)):not(:nth-child(2))'))) continue;

            // Check which joystick zone
            if (this._left.id === null && this._isInJoystickZone(touch, this._leftJoy)) {
                this._left.id = touch.identifier;
                const center = this._getJoystickCenter(this._leftJoy);
                this._left.cx = center.x;
                this._left.cy = center.y;
                this._left.dx = touch.clientX - center.x;
                this._left.dy = touch.clientY - center.y;
                e.preventDefault();
            } else if (this._right.id === null && this._isInJoystickZone(touch, this._rightJoy)) {
                this._right.id = touch.identifier;
                const center = this._getJoystickCenter(this._rightJoy);
                this._right.cx = center.x;
                this._right.cy = center.y;
                this._right.dx = touch.clientX - center.x;
                this._right.dy = touch.clientY - center.y;
                e.preventDefault();
            } else {
                // If touch is on the left half of screen, assign to left joystick
                // If on right half, assign to right joystick
                const midX = window.innerWidth / 2;
                if (this._left.id === null && touch.clientX < midX) {
                    this._left.id = touch.identifier;
                    const center = this._getJoystickCenter(this._leftJoy);
                    this._left.cx = center.x;
                    this._left.cy = center.y;
                    this._left.dx = touch.clientX - center.x;
                    this._left.dy = touch.clientY - center.y;
                    e.preventDefault();
                } else if (this._right.id === null && touch.clientX >= midX) {
                    this._right.id = touch.identifier;
                    const center = this._getJoystickCenter(this._rightJoy);
                    this._right.cx = center.x;
                    this._right.cy = center.y;
                    this._right.dx = touch.clientX - center.x;
                    this._right.dy = touch.clientY - center.y;
                    e.preventDefault();
                }
            }
        }
    }

    _onTouchMove(e) {
        for (const touch of e.changedTouches) {
            if (touch.identifier === this._left.id) {
                this._left.dx = touch.clientX - this._left.cx;
                this._left.dy = touch.clientY - this._left.cy;
                e.preventDefault();
            }
            if (touch.identifier === this._right.id) {
                this._right.dx = touch.clientX - this._right.cx;
                this._right.dy = touch.clientY - this._right.cy;
                e.preventDefault();
            }
        }
    }

    _onTouchEnd(e) {
        for (const touch of e.changedTouches) {
            if (touch.identifier === this._left.id) {
                this._left.id = null;
                // Yaw springs back, throttle does NOT
                this._left.dx = 0;
                // Keep _left.dy as-is (throttle persists)
                e.preventDefault();
            }
            if (touch.identifier === this._right.id) {
                this._right.id = null;
                // Both axes spring back to center
                this._right.dx = 0;
                this._right.dy = 0;
                e.preventDefault();
            }
        }
    }

    /** Call each frame. Returns { t, y, p, r } */
    update() {
        const R = 60; // joystick radius for normalization
        this.active = (this._left.id !== null || this._right.id !== null);

        // Left joystick: X = yaw, Y = thrust
        const lx = Math.max(-1, Math.min(1, this._left.dx / R));
        const ly = Math.max(-1, Math.min(1, this._left.dy / R));

        // Thrust: up = more thrust. Map Y: top=-1 -> t=1, bottom=1 -> t=0
        // Only update throttle while touching
        if (this._left.id !== null) {
            this._throttle = Math.max(0, Math.min(1, (-ly + 1) / 2));
        }
        this.values.t = this._throttle;
        this.values.y = lx; // yaw: left negative, right positive

        // Right joystick: X = roll, Y = pitch
        const rx = Math.max(-1, Math.min(1, this._right.dx / R));
        const ry = Math.max(-1, Math.min(1, this._right.dy / R));
        this.values.p = ry; // pitch: push forward (up on screen) = negative
        this.values.r = rx; // roll: right = positive

        // Update thumb positions visually
        this._updateThumbPos(this._leftThumb, this._left.dx, this._left.dy, R);
        this._updateThumbPos(this._rightThumb, this._right.dx, this._right.dy, R);

        // Keep arm button in sync
        if (this._state) {
            this._updateArmBtn(this._state.armed);
            // Update mode button text
            const names = { [FLIGHT_MODES.ANGLE]: '自穩', [FLIGHT_MODES.HORIZON]: '半自穩', [FLIGHT_MODES.ACRO]: '手動', [FLIGHT_MODES.ALT_HOLD]: '定高' };
            this._modeBtn.innerText = names[this._state.flightMode] || '?';
        }

        return this.values;
    }

    _updateThumbPos(thumb, dx, dy, maxR) {
        // Clamp within circle
        const dist = Math.sqrt(dx * dx + dy * dy);
        let cx = dx, cy = dy;
        if (dist > maxR) {
            cx = (dx / dist) * maxR;
            cy = (dy / dist) * maxR;
        }
        thumb.style.transform = `translate(calc(-50% + ${cx}px), calc(-50% + ${cy}px))`;
    }

    show() {
        if (this._container) this._container.style.display = 'block';
    }

    hide() {
        if (this._container) this._container.style.display = 'none';
    }

    get isTouchDevice() {
        return this._isTouchDevice;
    }
}

export const touchInput = new TouchInput();
