import { InputController } from './Input.js';
import { PhysicsEngine } from './Physics.js';
import { GameScene } from './Scene.js';
import { LevelManager } from './LevelManager.js';
import { CONFIG, FLIGHT_MODES } from './Config.js';
import { touchInput } from './TouchInput.js';

try {
    const savedJT = localStorage.getItem('flightSimJoystickType');
    if (savedJT === 'centering' || savedJT === 'rc') CONFIG.joystickType = savedJT;
} catch (e) {}

const input = new InputController();
let physics, gameScene, levelManager, audioEngine;
const clock = new THREE.Clock();
const MODE_NAMES = {
    [FLIGHT_MODES.ANGLE]: '自穩',
    [FLIGHT_MODES.HORIZON]: '半自穩',
    [FLIGHT_MODES.ACRO]: '手動',
    [FLIGHT_MODES.ALT_HOLD]: '定高'
};
let appState = 'SETUP';
let isGamepadInit = false;
let selectedLevel = 1;

class AudioEngine {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        // Resume AudioContext to comply with browser autoplay policy
        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.osc = null;
        this.gain = null;
        this._initMotor();
        window.addEventListener('level-complete', () => this._playComplete());
    }

    _initMotor() {
        this.osc = this.ctx.createOscillator();
        this.gain = this.ctx.createGain();
        this.osc.type = 'sawtooth';
        this.osc.frequency.value = 80;
        this.gain.gain.value = 0;
        this.osc.connect(this.gain);
        this.gain.connect(this.ctx.destination);
        this.osc.start();
    }

    updateMotor(throttle, armed) {
        if (!armed || throttle < 0.01) {
            this.gain.gain.value = 0;
            return;
        }
        this.osc.frequency.value = 80 + throttle * 320;
        this.gain.gain.value = Math.min(throttle * 0.15, 0.12);
    }

    _playComplete() {
        const now = this.ctx.currentTime;
        const notes = [261.6, 329.6, 392.0]; // C4, E4, G4
        notes.forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            g.gain.value = 0.2;
            g.gain.setValueAtTime(0.2, now + i * 0.15);
            g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.14);
            osc.connect(g);
            g.connect(this.ctx.destination);
            osc.start(now + i * 0.15);
            osc.stop(now + i * 0.15 + 0.15);
        });
    }
}

// DOM Cache for game loop
let domCache = {};
const _gameLoopEuler = new THREE.Euler(); // reused every frame, avoids GC

// --- 選單初始化 ---
function initSelects(gamepad) {
    if (isGamepadInit) return;
    isGamepadInit = true;
    document.getElementById('status-msg').innerText = `已連接: ${gamepad.id}`;
    document.getElementById('status-msg').style.color = '#00ffcc';

    const monitor = document.getElementById('raw-monitor');
    monitor.innerHTML = '';
    for (let i = 0; i < gamepad.axes.length; i++) {
        const div = document.createElement('div');
        div.className = 'raw-item';
        div.innerHTML = `Axis ${i} <div class="raw-bar-bg"><div id="raw-bar-${i}" class="raw-bar-fill"></div></div>`;
        monitor.appendChild(div);
    }

    const ids = ['map-t','map-r','map-e','map-a','map-arm','map-mode'];
    ids.forEach(id => {
        const sel = document.getElementById(id);
        sel.innerHTML = '';
        for (let i = 0; i < gamepad.axes.length; i++) {
            const opt = document.createElement('option');
            opt.value = i; opt.innerText = `Axis ${i}`;
            sel.appendChild(opt);
        }
    });
    document.getElementById('map-t').value = CONFIG.axes.thrust;
    document.getElementById('map-r').value = CONFIG.axes.yaw;
    document.getElementById('map-e').value = CONFIG.axes.pitch;
    document.getElementById('map-a').value = CONFIG.axes.roll;
    document.getElementById('map-arm').value = CONFIG.axes.arm;
    document.getElementById('map-mode').value = CONFIG.axes.mode;
}

window.addEventListener('gamepad-ready', (e) => initSelects(e.detail.gamepad));

window.updateMapping = function () {
    input.updateConfig({
        thrust: parseInt(document.getElementById('map-t').value),
        yaw: parseInt(document.getElementById('map-r').value),
        pitch: parseInt(document.getElementById('map-e').value),
        roll: parseInt(document.getElementById('map-a').value),
        arm: parseInt(document.getElementById('map-arm').value),
        mode: parseInt(document.getElementById('map-mode').value)
    }, {
        t: document.getElementById('inv-t').checked,
        r: document.getElementById('inv-r').checked,
        e: document.getElementById('inv-e').checked,
        a: document.getElementById('inv-a').checked
    });
};

window.doCalibration = function () { input.calibrateCenter(); };
window.calibrateEndpoint = function (ch, type) {
    if (type === 'min') input.calibrateMin(ch); else input.calibrateMax(ch);
    const btnMap = { thrust:'cal-t', yaw:'cal-y', pitch:'cal-p', roll:'cal-r' };
    if (btnMap[ch]) document.getElementById(`${btnMap[ch]}-${type}`).classList.add('set');
};

// --- 關卡選擇 ---
const LEVEL_META = [
    { icon:'🛫', stars:1, ac1:'#00ffcc', ac2:'#00cc99' },
    { icon:'🎯', stars:1, ac1:'#00ffcc', ac2:'#00cc99' },
    { icon:'↔️',  stars:2, ac1:'#00ffcc', ac2:'#00cc99' },
    { icon:'↕️',  stars:2, ac1:'#00ffcc', ac2:'#00cc99' },
    { icon:'🔷', stars:3, ac1:'#00ffcc', ac2:'#00cc99' },
    { icon:'🚪', stars:3, ac1:'#00ffcc', ac2:'#00cc99' },
    { icon:'∞',  stars:4, ac1:'#00ffcc', ac2:'#00cc99' },
    { icon:'🏆', stars:5, ac1:'#00ffcc', ac2:'#00cc99', isExam:true },
];

function showLevelSelect() {
    appState = 'LEVEL_SELECT';
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('level-select').style.display = 'flex';

    const grid = document.getElementById('level-grid');
    grid.innerHTML = '';
    let bestTimes;
    try {
        bestTimes = JSON.parse(localStorage.getItem('flightSimBest') || '{}');
    } catch (e) {
        bestTimes = {};
    }
    const unlockedLevel = LevelManager.getUnlockedLevel();

    let doneCount = 0;

    CONFIG.levels.forEach((lv, i) => {
        const meta  = LEVEL_META[i] || { icon:'🚁', stars:1, ac1:'#00ffcc', ac2:'#0099ff' };
        const best  = bestTimes['L' + lv.id];
        const locked = lv.id > unlockedLevel;
        const done   = !!best;
        if (done) doneCount++;

        const stars = '★'.repeat(meta.stars) + '☆'.repeat(5 - meta.stars);

        const div = document.createElement('div');
        div.className = 'level-card' + (locked ? ' locked' : '') + (done ? ' completed' : '') + (meta.isExam ? ' exam-card' : '');
        div.style.setProperty('--ac1', meta.ac1);
        div.style.setProperty('--ac2', meta.ac2);

        div.innerHTML = `
            <div class="lc-accent"></div>
            <div class="lc-body">
                <div class="lc-num">LV.${lv.id}</div>
                <div class="lc-icon">${meta.icon}</div>
                <div class="lc-name">${lv.name}</div>
                <div class="lc-desc">${lv.desc}</div>
                <div class="lc-stars" style="color:${meta.ac1}">${stars}</div>
                <div class="lc-best ${done ? '' : 'empty'}">${done ? '✅ ' + best + 's' : '— 尚未完成'}</div>
            </div>
            ${done ? '<div class="lc-banner">DONE</div>' : ''}
            <div class="lc-lock">🔒</div>
        `;

        if (!locked) {
            div.onclick = () => { selectedLevel = lv.id; startGame(); };
        }
        grid.appendChild(div);
    });

    // 更新統計列
    const doneEl = document.getElementById('ls-done');
    if (doneEl) doneEl.textContent = doneCount;
    const scoreEl = document.getElementById('ls-score');
    if (scoreEl) {
        const total = Object.values(bestTimes).reduce((s, v) => s + parseFloat(v || 0), 0);
        scoreEl.textContent = total > 0 ? total.toFixed(1) + 's' : '--';
    }
}

window.startKeyboard = function () {
    input.useKeyboard = true;
    input.state.armed = true;
    showLevelSelect();
};

window.startTouch = function () {
    input.useTouch = true;
    input.state.armed = true;
    touchInput.hide(); // hide during level select, show when game starts
    showLevelSelect();
};

window.startGameApp = function () { showLevelSelect(); };

window.startGamepad = function () {
    showLevelSelect();
};

window.updateJoystickType = function (type) {
    if (type !== 'centering' && type !== 'rc') return;
    CONFIG.joystickType = type;
    try { localStorage.setItem('flightSimJoystickType', type); } catch (e) {}
    // 同步給尚未進關卡的 input 預設值，已進關卡後再切只影響下次進場
    const isCentering = type === 'centering';
    input.state.t = isCentering ? 0.5 : 0;
    input.state.flightMode = isCentering ? FLIGHT_MODES.ALT_HOLD : FLIGHT_MODES.ANGLE;
};

window.startHybrid = function () {
    input.useHybrid = true;
    input.state.armed = true;
    showLevelSelect();
};

// --- 手把連接 UI 更新 ---
window.addEventListener("gamepadconnected", (e) => {
    const statusEl = document.getElementById("gp-status");
    const detectEl = document.getElementById("gp-detect-area");
    const setupEl = document.getElementById("gp-axis-setup");
    if (statusEl) {
        statusEl.innerText = "✅ 已連接";
        statusEl.style.color = "#00ffcc";
    }
    if (detectEl) detectEl.innerText = e.gamepad.id.substring(0, 40);
    if (setupEl) setupEl.style.display = "block";
});

// --- 軸位自動偵測 ---
window.detectAxis = function (channel) {
    const btn = document.getElementById("detect-btn-" + channel);
    const label = document.getElementById("axis-label-" + channel);
    if (!btn || !label) return;
    btn.innerText = "搖動搖桿...";
    btn.style.background = "#aa8800";

    const gp = navigator.getGamepads()[0];
    if (!gp) return;
    const baseline = {};
    gp.axes.forEach((v, i) => { baseline[i] = v; });

    let best = { axis: -1, delta: 0 };
    const interval = setInterval(() => {
        const g = navigator.getGamepads()[0];
        if (!g) return;
        g.axes.forEach((v, i) => {
            const d = Math.abs(v - (baseline[i] || 0));
            if (d > best.delta) { best.delta = d; best.axis = i; }
        });
    }, 50);

    setTimeout(() => {
        clearInterval(interval);
        btn.innerText = "重新偵測";
        btn.style.background = "#444";
        if (best.axis >= 0 && best.delta > 0.1) {
            label.innerText = "AXIS " + best.axis;
            label.style.color = "#00ffcc";
            // 更新下拉選單（若存在）
            const axisMap = { thrust: "map-t", yaw: "map-r", pitch: "map-e", roll: "map-a" };
            const sel = document.getElementById(axisMap[channel]);
            if (sel) { sel.value = best.axis; window.updateMapping && window.updateMapping(); }
            // 存到全域軸位設定
            window._gpAxisConfig = window._gpAxisConfig || {};
            window._gpAxisConfig[channel] = best.axis;
        } else {
            label.innerText = "未偵測到";
            label.style.color = "#ff6666";
        }
    }, 1500);
};

window.autoDetectAll = async function() {
    const btn = document.getElementById("auto-detect-btn");
    btn.innerText = "🔄 偵測中...請搖動左搖桿 3 秒";
    btn.style.background = "#aa8800";
    btn.disabled = true;

    const gp = navigator.getGamepads()[0];
    if (!gp) {
        btn.innerText = "❌ 未偵測到手把";
        btn.disabled = false;
        return;
    }

    // 記錄基準值
    const baseline = Array.from(gp.axes);
    const maxDelta = new Array(gp.axes.length).fill(0);

    // 監聽 3 秒
    const interval = setInterval(() => {
        const g = navigator.getGamepads()[0];
        if (!g) return;
        g.axes.forEach((v, i) => {
            const d = Math.abs(v - baseline[i]);
            if (d > maxDelta[i]) maxDelta[i] = d;
        });
    }, 50);

    await new Promise(r => setTimeout(r, 3000));
    clearInterval(interval);

    // 找出位移最大的兩個軸
    const sorted = maxDelta
        .map((d, i) => ({ i, d }))
        .sort((a, b) => b.d - a.d);

    const active = sorted.filter(x => x.d > 0.1);

    if (active.length < 2) {
        btn.innerText = "⚠️ 偵測到的軸不夠，請重試";
        btn.disabled = false;
        return;
    }

    // 判斷哪個軸是油門（上下），哪個是偏航（左右）
    const axis1 = active[0].i;
    const axis2 = active[1].i;

    let thrAxis, yawAxis;
    if (axis1 < axis2) {
        yawAxis = axis1;
        thrAxis = axis2;
    } else {
        yawAxis = axis2;
        thrAxis = axis1;
    }

    // 更新 select 的值
    const mapT = document.getElementById("map-t");
    const mapR = document.getElementById("map-r");
    if (mapT) { mapT.value = thrAxis; }
    if (mapR) { mapR.value = yawAxis; }
    window.updateMapping && window.updateMapping();

    // 更新軸位標籤
    document.getElementById("axis-label-thrust").innerText = "AXIS " + thrAxis;
    document.getElementById("axis-label-thrust").style.color = "#00ffcc";
    document.getElementById("axis-label-yaw").innerText = "AXIS " + yawAxis;
    document.getElementById("axis-label-yaw").style.color = "#00ffcc";

    // 右搖桿沒有類比軸 → 自動勾選混合模式
    if (active.length < 4) {
        const hybridCheck = document.getElementById("hybrid-mode-check");
        if (hybridCheck) hybridCheck.checked = true;
        document.getElementById("axis-label-pitch").innerText = "← 方向鍵";
        document.getElementById("axis-label-pitch").style.color = "#ffaa00";
        document.getElementById("axis-label-roll").innerText = "← 方向鍵";
        document.getElementById("axis-label-roll").style.color = "#ffaa00";
    }

    // 儲存設定
    window._gpAxisConfig = { thrust: thrAxis, yaw: yawAxis };

    btn.innerText = "✅ 配置完成！可以開始飛行";
    btn.style.background = "#2a5a2a";
    btn.disabled = false;
};

window.goBackToSetup = function () {
    document.getElementById('level-select').style.display = 'none';
    document.getElementById('setup-screen').style.display = 'flex';
    touchInput.hide();
    input.useTouch = false;
    input.useHybrid = false;
    appState = 'SETUP';
};

function startGame() {
    document.getElementById('level-select').style.display = 'none';
    document.getElementById('ui-layer').style.display = 'flex';
    
    // Cache DOM elements for game loop
    domCache = {
        statThr: document.getElementById('stat-thr'),
        statAlt: document.getElementById('stat-alt'),
        statMode: document.getElementById('stat-mode'),
        statArmed: document.getElementById('stat-armed'),
        statInput: document.getElementById('stat-input'),
        statDist: document.getElementById('stat-dist'),
        statHeading: document.getElementById('stat-heading'),
        levelTitle: document.getElementById('level-title')
    };
    
    if (input.useTouch) {
        touchInput.show();
        input.state.armed = true; // auto-arm in touch mode
    }

    if (!physics) {
        physics = new PhysicsEngine();
        gameScene = new GameScene();
        levelManager = new LevelManager(gameScene);
        audioEngine = new AudioEngine();
    }
    physics.reset();
    if (gameScene) gameScene.resetCamera();
    levelManager.loadLevel(selectedLevel);
    appState = 'GAME';
    showPhysPanel(true);
    clock.start();
}

// --- Setup UI 更新 ---
function updateSetupUI() {
    const gamepads = navigator.getGamepads();
    let gp = null;
    for (let g of gamepads) { if (g && g.connected) { gp = g; break; } }
    if (gp) {
        if (!isGamepadInit) initSelects(gp);
        gp.axes.forEach((val, i) => {
            const bar = document.getElementById(`raw-bar-${i}`);
            if (bar) {
                bar.style.width = ((val+1)/2)*100 + '%';
                bar.style.backgroundColor = Math.abs(val) > 0.1 ? '#00ff00' : '#ffff00';
            }
        });
    }
    const state = input.update();
    document.getElementById('bar-thr').style.width = state.t*100+'%';
    document.getElementById('txt-thr').innerText = Math.round(state.t*100)+'%';
    document.getElementById('bar-yaw').style.width = ((state.y+1)/2)*100+'%';
    document.getElementById('txt-yaw').innerText = state.y.toFixed(2);
    document.getElementById('bar-pit').style.width = ((state.p+1)/2)*100+'%';
    document.getElementById('txt-pit').innerText = state.p.toFixed(2);
    document.getElementById('bar-rol').style.width = ((state.r+1)/2)*100+'%';
    document.getElementById('txt-rol').innerText = state.r.toFixed(2);

    const armTxt = document.getElementById('txt-arm');
    armTxt.innerText = state.armed ? '已解鎖' : '未解鎖';
    armTxt.style.color = state.armed ? '#00ffcc' : '#ff3333';

    const mStr = MODE_NAMES[state.flightMode] || '?';
    document.getElementById('mode-display').innerText = mStr;
    document.getElementById('txt-mode').innerText = mStr;
}

// --- ESC 返回 ---
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (appState === 'GAME') {
            appState = 'SETUP';
            document.getElementById('ui-layer').style.display = 'none';
            document.getElementById('msg-overlay').style.display = 'none';
            if (physics) physics.reset();
            if (gameScene) gameScene.resetCamera();
            input.keyThrottle = 0;
            touchInput.hide();
            showPhysPanel(false);
            showLevelSelect();
        } else if (appState === 'LEVEL_SELECT') {
            document.getElementById('level-select').style.display = 'none';
            document.getElementById('setup-screen').style.display = 'flex';
            touchInput.hide();
            input.useTouch = false;
            appState = 'SETUP';
        }
    }
});
window.addEventListener('resize', () => {
    if (gameScene) {
        gameScene.camera.aspect = window.innerWidth / window.innerHeight;
        gameScene.camera.updateProjectionMatrix();
        gameScene.renderer.setSize(window.innerWidth, window.innerHeight);
    }
});
window.addEventListener('reset-drone', () => { if (physics) physics.reset();
            if (gameScene) gameScene.resetCamera(); });

// --- 物理參數面板 ---
const PHYS_DEFAULTS = {
    thrustPower: 24, thrustExpo: 0.3, maxThrust: 28,
    mass: 0.6, dragCoeff: 0.015, angularDrag: 15,
    rates: 1.2, superRate: 0.7, maxTiltAngle: 55
};
const PHYS_PRESETS = {
    beginner: { thrustPower:18, thrustExpo:0.15, maxThrust:22, mass:0.5, dragCoeff:0.04, angularDrag:25, rates:0.6, superRate:0.3, maxTiltAngle:30 },
    default:  { ...PHYS_DEFAULTS },
    race:     { thrustPower:38, thrustExpo:0.5, maxThrust:50, mass:0.4, dragCoeff:0.008, angularDrag:8, rates:2.2, superRate:0.85, maxTiltAngle:75 },
    exam:     { thrustPower:20, thrustExpo:0.2, maxThrust:24, mass:0.7, dragCoeff:0.025, angularDrag:20, rates:0.8, superRate:0.4, maxTiltAngle:35 }
};

const PP_PARAMS = [
    { id:'thrustPower', key:'thrustPower', fmt: v => v.toFixed(0) },
    { id:'thrustExpo',  key:'thrustExpo',  fmt: v => v.toFixed(2) },
    { id:'maxThrust',   key:'maxThrust',   fmt: v => v.toFixed(0) },
    { id:'mass',        key:'mass',        fmt: v => v.toFixed(2) },
    { id:'dragCoeff',   key:'dragCoeff',   fmt: v => v.toFixed(3) },
    { id:'angularDrag', key:'angularDrag', fmt: v => v.toFixed(1) },
    { id:'rates',       key:'rates',       fmt: v => v.toFixed(2) },
    { id:'superRate',   key:'superRate',   fmt: v => v.toFixed(2) },
    { id:'maxTiltAngle',key:'maxTiltAngle',fmt: v => v.toFixed(0) + '°' },
];

function ppUpdateSliderBg(slider) {
    const min = parseFloat(slider.min), max = parseFloat(slider.max), val = parseFloat(slider.value);
    const pct = ((val - min) / (max - min) * 100).toFixed(1) + '%';
    slider.style.setProperty('--pct', pct);
}

function ppApplyToConfig(values) {
    for (const k of Object.keys(values)) CONFIG[k] = values[k];
}

function ppRefreshUI(values) {
    for (const p of PP_PARAMS) {
        const slider = document.getElementById('pp-' + p.id);
        const valEl  = document.getElementById('ppv-' + p.id);
        if (!slider || !valEl) continue;
        slider.value = values[p.key];
        valEl.textContent = p.fmt(parseFloat(values[p.key]));
        ppUpdateSliderBg(slider);
    }
}

function ppSetPreset(name) {
    const preset = PHYS_PRESETS[name];
    if (!preset) return;
    ppApplyToConfig(preset);
    ppRefreshUI(preset);
    document.querySelectorAll('.pp-preset').forEach(b => b.classList.toggle('active', b.dataset.preset === name));
}

(function initPhysPanel() {
    const toggle = document.getElementById('phys-toggle');
    const panel  = document.getElementById('phys-panel');
    if (!toggle || !panel) return;

    // 齒輪開關
    toggle.addEventListener('click', () => {
        const open = panel.classList.toggle('open');
        toggle.classList.toggle('active', open);
        panel.style.display = open ? 'flex' : 'none';
    });

    // 滑桿即時更新
    for (const p of PP_PARAMS) {
        const slider = document.getElementById('pp-' + p.id);
        const valEl  = document.getElementById('ppv-' + p.id);
        if (!slider || !valEl) continue;
        ppUpdateSliderBg(slider);
        slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            CONFIG[p.key] = v;
            valEl.textContent = p.fmt(v);
            ppUpdateSliderBg(slider);
            // 清除 active preset（手動調整）
            document.querySelectorAll('.pp-preset').forEach(b => b.classList.remove('active'));
        });
    }

    // 預設按鈕
    document.querySelectorAll('.pp-preset').forEach(btn => {
        btn.addEventListener('click', () => ppSetPreset(btn.dataset.preset));
    });

    // 重置
    document.getElementById('pp-reset')?.addEventListener('click', () => ppSetPreset('default'));
})();

// 進入遊戲時顯示齒輪，離開時隱藏
function showPhysPanel(show) {
    const toggle = document.getElementById('phys-toggle');
    const panel  = document.getElementById('phys-panel');
    if (!toggle || !panel) return;
    toggle.style.display = show ? 'flex' : 'none';
    if (!show) { panel.classList.remove('open'); toggle.classList.remove('active'); }
}

// --- 主迴圈 ---
function animate() {
    requestAnimationFrame(animate);
    if (appState === 'SETUP') {
        updateSetupUI();
    } else if (appState === 'GAME') {
      try {
        const dt = Math.min(clock.getDelta(), 0.1);
        const inp = input.update();
        physics.update(dt, inp);
        gameScene.updateDrone(physics.pos, physics.quat, inp.t, physics.crashIntensity, inp.armed, dt);
        if (audioEngine) audioEngine.updateMotor(inp.t, inp.armed);
        levelManager.checkWinCondition(physics.pos, dt, physics.vel);

        domCache.statThr.innerText = `THR: ${Math.round(inp.t*100)}%`;
        domCache.statAlt.innerText = `ALT: ${physics.pos.y.toFixed(1)}m`;

        domCache.statMode.innerText = 'MODE: '+(MODE_NAMES[inp.flightMode]||'?');
        domCache.statArmed.innerText = inp.armed ? 'ARMED' : 'DISARMED';
        domCache.statArmed.style.color = inp.armed ? '#00ff00' : '#ff3333';
        domCache.statInput.innerText = input.useTouch ? '📱 觸控' : input.useHybrid ? '🎮+⌨️ 混合' : input.useKeyboard ? '⌨️ 鍵盤' : '🎮 搖桿';

        // 高度警告
        if (physics.pos.y > CONFIG.maxHeight*0.8) { domCache.statAlt.style.color='#ff3333'; domCache.statAlt.innerText = `ALT: ${physics.pos.y.toFixed(1)}m ⚠️`; }
        else if (physics.pos.y > CONFIG.maxHeight*0.5) domCache.statAlt.style.color='#ffaa00';
        else domCache.statAlt.style.color='#aaa';

        // Distance to active waypoint
        if (levelManager.activeTarget) {
            const d = physics.pos.distanceTo(levelManager.activeTarget);
            domCache.statDist.innerText = `距離: ${d.toFixed(1)}m`;
        } else {
            domCache.statDist.innerText = '距離: --';
        }

        // Compass heading from drone quaternion
        _gameLoopEuler.setFromQuaternion(physics.quat, 'YXZ');
        const euler = _gameLoopEuler;
        let yawDeg = -THREE.MathUtils.radToDeg(euler.y); // negate: Three.js Y rotation is CCW-positive
        yawDeg = ((yawDeg % 360) + 360) % 360; // normalize to 0-360
        const dirs = ['N','NE','E','SE','S','SW','W','NW'];
        const dirIdx = Math.round(yawDeg / 45) % 8;
        domCache.statHeading.innerText = `方向: ${dirs[dirIdx]}`;

        gameScene.render();
      } catch(e) {
        if (domCache.levelTitle) domCache.levelTitle.innerText = 'ERROR: ' + e.message;
        console.error('Game loop error:', e);
      }
    }
}
animate();

// 頁面載入後把 radio 按鈕同步到 CONFIG.joystickType（已從 localStorage 讀取）
(function syncJoystickTypeRadio() {
    const apply = () => {
        const id = CONFIG.joystickType === 'rc' ? 'jt-rc' : 'jt-centering';
        const el = document.getElementById(id);
        if (el) el.checked = true;
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', apply);
    } else {
        apply();
    }
})();
