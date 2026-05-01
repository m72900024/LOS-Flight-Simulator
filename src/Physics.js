import { CONFIG, FLIGHT_MODES } from './Config.js';

export class PhysicsEngine {
    constructor() {
        this.pos = new THREE.Vector3(0, 0.2, 0);
        this.vel = new THREE.Vector3(0, 0, 0);
        this.quat = new THREE.Quaternion();
        this.rotVel = new THREE.Vector3(0, 0, 0); // 角速度
        this.crashIntensity = 0;
        this.altHoldTarget = null;

        // Pre-allocated temporary objects to reduce GC pressure
        this._tmpVec1 = new THREE.Vector3();
        this._tmpVec2 = new THREE.Vector3();
        this._tmpVec3 = new THREE.Vector3();
        this._tmpQuat = new THREE.Quaternion();
        this._tmpEuler = new THREE.Euler();
    }

    _applyAngleAttitude(input, maxRate, dt) {
        const maxTilt = THREE.MathUtils.degToRad(CONFIG.maxTiltAngle);
        const targetPitch = input.p * maxTilt;
        const targetRoll = -input.r * maxTilt;

        this._tmpEuler.setFromQuaternion(this.quat, 'YXZ');

        const kP = 12.0, kD = 0.6;
        this.rotVel.x = kP * (targetPitch - this._tmpEuler.x) - kD * this.rotVel.x;
        this.rotVel.z = kP * (targetRoll  - this._tmpEuler.z) - kD * this.rotVel.z;
        this.rotVel.y = input.y * maxRate * 0.7;

        const theta = this.rotVel.length() * dt;
        if (theta > 0.0001) {
            this._tmpVec2.copy(this.rotVel).normalize();
            this._tmpQuat.setFromAxisAngle(this._tmpVec2, theta);
            this.quat.multiply(this._tmpQuat);
        }
    }

    reset() {
        this.pos.set(0, 0.2, 0);
        this.vel.set(0, 0, 0);
        this.rotVel.set(0, 0, 0);
        this.quat.identity();
        this.crashIntensity = 0;
        this.altHoldTarget = null;
    }

    update(dt, input) {
        // --- 1. 推力與重力 ---
        // 油門指數曲線：低油門更細膩，高油門更猛
        const expo = CONFIG.thrustExpo || 0;
        const tLin = input.t;
        const tExp = Math.pow(input.t, 3);
        const tCurve = tLin * (1 - expo) + tExp * expo;

        let thrustMag = input.armed ? (tCurve * CONFIG.thrustPower) : 0;

        // ALT_HOLD: override thrust to maintain altitude when throttle is centered
        if (input.flightMode === FLIGHT_MODES.ALT_HOLD && input.armed) {
            const hoverThrust = CONFIG.mass * CONFIG.gravity;
            if (input.t >= 0.4 && input.t <= 0.6) {
                // Deadzone: PID-like altitude hold
                if (this.altHoldTarget === null) {
                    this.altHoldTarget = this.pos.y;
                }
                const kP = 8;
                const kD = 5 * CONFIG.mass;
                thrustMag = hoverThrust + kP * (this.altHoldTarget - this.pos.y) - kD * this.vel.y;
            } else if (input.t > 0.6) {
                this.altHoldTarget = null;
                // Climb: hover thrust + extra proportional to stick above deadzone
                const climbInput = (input.t - 0.6) / 0.4; // 0..1
                thrustMag = hoverThrust + climbInput * CONFIG.thrustPower * 0.5;
            } else {
                this.altHoldTarget = null;
                // Descend: hover thrust - reduction proportional to stick below deadzone
                const descendInput = (0.4 - input.t) / 0.4; // 0..1
                thrustMag = hoverThrust * (1 - descendInput * 0.8);
            }
        }

        // Reuse tmpVec1 for thrust direction
        this._tmpVec1.set(0, 1, 0).applyQuaternion(this.quat);
        const force = this._tmpVec1.multiplyScalar(thrustMag);

        // 重力
        force.y -= CONFIG.mass * CONFIG.gravity;
        
        // 空氣阻力 (二次方阻力，速度越快阻力越大)
        const speed = this.vel.length();
        if (speed > 0.01) {
            // Reuse tmpVec2 for drag calculation
            this._tmpVec2.copy(this.vel).normalize().multiplyScalar(-CONFIG.dragCoeff * speed * speed);
            force.add(this._tmpVec2);
        }
        
        // Reuse tmpVec3 for acceleration
        const accel = this._tmpVec3.copy(force).divideScalar(CONFIG.mass);
        this.vel.add(accel.multiplyScalar(dt));
        this.pos.add(this._tmpVec3.copy(this.vel).multiplyScalar(dt));

        // Decay crash intensity (frame-rate independent)
        this.crashIntensity *= Math.pow(0.92, dt * 60);

        // 地板碰撞 (更真實的彈跳)
        if (this.pos.y < CONFIG.hardDeck) {
            this.pos.y = CONFIG.hardDeck;
            if (this.vel.y < -2) {
                // 高速撞地 → 彈跳 + 大幅減速（模擬炸機）
                const impactSpeed = Math.abs(this.vel.y);
                this.crashIntensity = Math.min(1.0, impactSpeed * 0.15);
                this.vel.y *= -0.3;
                this.vel.x *= 0.3; this.vel.z *= 0.3;
                // 撞擊造成隨機旋轉
                this.rotVel.x += (Math.random() - 0.5) * 5;
                this.rotVel.z += (Math.random() - 0.5) * 5;
            } else {
                this.vel.y = 0;
                this.vel.x *= 0.7; this.vel.z *= 0.7;
            }
        }

        // --- 2. 姿態控制 ---
        // 未解鎖時搖桿不應作用：把姿態指令歸零，靠現有 lerp/damping 自然把 rotVel 收斂到 0
        const aIn = input.armed
            ? input
            : { ...input, p: 0, r: 0, y: 0 };

        // Betaflight 風格的 rates：末端加速
        const baseRate = THREE.MathUtils.degToRad(600 * CONFIG.rates);
        const superRate = CONFIG.superRate || 0;
        const calcRate = (stick) => {
            const absStick = Math.abs(stick);
            // 基礎 rate + SuperRate 在末端疊加
            return baseRate * absStick + baseRate * superRate * absStick * absStick * absStick;
        };
        const maxRate = baseRate; // 用於自穩模式

        if (input.flightMode === FLIGHT_MODES.ACRO) {
            // [手動模式] Betaflight 風格角速度控制
            this._tmpVec1.set(
                Math.sign(aIn.p) * calcRate(aIn.p),
                Math.sign(aIn.y) * calcRate(aIn.y),
                -Math.sign(aIn.r) * calcRate(aIn.r)
            );
            const angDrag = CONFIG.angularDrag || 5;
            this.rotVel.lerp(this._tmpVec1, angDrag * dt);

        } else if (input.flightMode === FLIGHT_MODES.ANGLE || input.flightMode === FLIGHT_MODES.ALT_HOLD) {
            // [自穩/定高模式] Spring-damper attitude control
            this._applyAngleAttitude(aIn, maxRate, dt);

        } else if (input.flightMode === FLIGHT_MODES.HORIZON) {
            // [半自穩模式] Betaflight-style HORIZON blend
            const maxTilt = THREE.MathUtils.degToRad(CONFIG.maxTiltAngle);

            // 1. Acro target rates (with SuperRate) - reuse tmpVec1
            this._tmpVec1.set(
                Math.sign(aIn.p) * calcRate(aIn.p),
                Math.sign(aIn.y) * calcRate(aIn.y),
                -Math.sign(aIn.r) * calcRate(aIn.r)
            );

            // 2. Angle correction targets stick-commanded angle (not zero!) - reuse tmpEuler
            const targetPitch = aIn.p * maxTilt;
            const targetRoll  = -aIn.r * maxTilt;
            this._tmpEuler.setFromQuaternion(this.quat, 'YXZ'); // fix: read current attitude
            const angleCorrectP = (targetPitch - this._tmpEuler.x) * 8.0;
            const angleCorrectR = (targetRoll  - this._tmpEuler.z) * 8.0;

            // 3. Per-axis Betaflight-style threshold + ramp
            const horizonTransition = 0.75;
            const calcLevelStrength = (deflection) => {
                if (deflection <= horizonTransition) return 1.0;
                return 1.0 - (deflection - horizonTransition) / (1.0 - horizonTransition);
            };
            const levelP = calcLevelStrength(Math.abs(aIn.p));
            const levelR = calcLevelStrength(Math.abs(aIn.r));

            // 4. Blend per-axis
            this.rotVel.x = THREE.MathUtils.lerp(this._tmpVec1.x, angleCorrectP, levelP);
            this.rotVel.z = THREE.MathUtils.lerp(this._tmpVec1.z, angleCorrectR, levelR);
            this.rotVel.y = this._tmpVec1.y; // Yaw always manual

            // Apply rotation
            const theta = this.rotVel.length() * dt;
            if (theta > 0.0001) {
                this._tmpVec2.copy(this.rotVel).normalize();
                this._tmpQuat.setFromAxisAngle(this._tmpVec2, theta);
                this.quat.multiply(this._tmpQuat);
            }
        }

        // ACRO 模式：套用旋轉（只在這裡做一次）
        if (input.flightMode === FLIGHT_MODES.ACRO) {
            const theta = this.rotVel.length() * dt;
            if (theta > 0.0001) {
                this._tmpVec2.copy(this.rotVel).normalize();
                this._tmpQuat.setFromAxisAngle(this._tmpVec2, theta);
                this.quat.multiply(this._tmpQuat);
            }
        }

        // 高度軟限制（超過最大高度後推力遞減）
        if (this.pos.y > CONFIG.maxHeight) {
            this.vel.y *= 0.95; // 逐漸減速
        }

        // 水平邊界軟限制（超過 80m 後逐漸減速回拉）
        const maxHorizontal = 80;
        const hDist = Math.sqrt(this.pos.x * this.pos.x + this.pos.z * this.pos.z);
        if (hDist > maxHorizontal) {
            const overRatio = (hDist - maxHorizontal) / 20; // 20m 緩衝區
            const pullback = Math.min(overRatio * 2.0, 5.0);
            this.vel.x -= (this.pos.x / hDist) * pullback * dt;
            this.vel.z -= (this.pos.z / hDist) * pullback * dt;
        }
        
        this.quat.normalize();
    }
}
