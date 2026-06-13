import { CONFIG } from './Config.js?v=20260613-uiplus';

export class LevelManager {
    constructor(scene) {
        this.scene = scene;
        this.currentLevel = 1;
        this.isComplete = false;
        this.timer = 0;
        this.elapsed = 0;
        this.waypoints = [];
        this.wpIndex = 0;
        this.wpMeshes = [];
        this.checkpoints = [];
        this.cpIndex = 0;

        // Exam state (level 8)
        this._examSteps = [];
        this._examStepIndex = 0;
        this._examHoverTimer = 0;

        // Guide line (drone → active waypoint)
        this._guideLine = null;
        // Base Y positions for floating animation
        this._wpBaseY = [];
        // Active target position (for HUD distance display)
        this.activeTarget = null;

        // localStorage best times
        try {
            this.bestTimes = JSON.parse(localStorage.getItem('flightSimBest') || '{}');
        } catch (e) {
            this.bestTimes = {};
        }
    }

    saveBest(level, time) {
        const key = 'L' + level;
        if (!this.bestTimes[key] || time < this.bestTimes[key]) {
            this.bestTimes[key] = Math.round(time * 10) / 10;
            localStorage.setItem('flightSimBest', JSON.stringify(this.bestTimes));
        }
    }

    getBest(level) {
        return this.bestTimes['L' + level] || null;
    }

    loadLevel(levelIndex) {
        this.currentLevel = levelIndex;
        this.isComplete = false;
        this.timer = 0;
        this.elapsed = 0;
        this.wpIndex = 0;
        this.cpIndex = 0;
        this.waypoints = [];
        this.wpMeshes = [];
        this.checkpoints = [];
        this._examSteps = [];
        this._examStepIndex = 0;
        this._examHoverTimer = 0;

        this._wpBaseY = [];
        this.activeTarget = null;
        this._gates = [];
        this._gateIndex = 0;
        this._reusableTarget = new THREE.Vector3(); // reused in checkWinCondition

        const grp = this.scene.levelGroup;
        // Dispose all geometries, materials, and textures to prevent GPU memory leak
        grp.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => {
                        if (m.map) m.map.dispose();
                        m.dispose();
                    });
                } else {
                    if (obj.material.map) obj.material.map.dispose();
                    obj.material.dispose();
                }
            }
        });
        while (grp.children.length > 0) grp.remove(grp.children[0]);

        // Create guide line (drone → active waypoint)
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,0,0], 3));
        const lineMat = new THREE.LineDashedMaterial({
            color: 0xffff00, dashSize: 0.5, gapSize: 0.3, transparent: true, opacity: 1.0
        });
        this._guideLine = new THREE.Line(lineGeo, lineMat);
        this._guideLine.visible = false;
        grp.add(this._guideLine);

        const lvl = CONFIG.levels[levelIndex - 1];
        document.getElementById('level-title').innerText = `第 ${levelIndex} 關：${lvl.name}`;
        document.getElementById('instruction').innerText = lvl.desc;
        document.getElementById('progress-fill').style.width = '0%';
        // 考試專用 HUD 預設隱藏（L8 的 _setupExam 會再開啟）
        ['exam-status', 'exam-next'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        this._examMarker = null;
        this._examArrow = null;

        const best = this.getBest(levelIndex);
        document.getElementById('stat-best').innerText = best ? `最佳: ${best}s` : '最佳: --';

        switch (levelIndex) {
            case 1: this._setupAltitudeHold(grp); break;
            case 2: this._setupHoverBox(grp); break;
            case 3: this._setupWaypoints(grp, [[0,3,-10],[0,3,0]]); break;
            case 4: this._setupWaypoints(grp, [[-8,3,0],[8,3,0]]); break;
            case 5: this._setupWaypoints(grp, [[5,3,-5],[5,3,5],[-5,3,5],[-5,3,-5]]); break;
            case 6: this._setupGate(grp); break;
            case 7: this._setupFigure8(grp); break;
            case 8: this._setupExam(grp); break;
        }
    }

    _makeWpSphere(pos, color = 0xff3333) {
        // 薄圓環取代球體，避免遮擋玩家視線；update loop 會持續 lookAt(drone) 永遠面向玩家
        const m = new THREE.Mesh(
            new THREE.TorusGeometry(1.2, 0.08, 8, 28),
            new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, transparent: true, opacity: 0.9 })
        );
        m.position.set(...pos);
        return m;
    }

    _makeGate(pos, lookAt) {
        const g = new THREE.Mesh(
            new THREE.TorusGeometry(2, 0.25, 8, 30),
            new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xff4400, emissiveIntensity: 0.4 })
        );
        g.position.set(...pos);
        if (lookAt) g.lookAt(...lookAt);
        g.castShadow = true;
        return g;
    }

    _setupAltitudeHold(grp) {
        // 4 vertical reference poles at corners (±3, 0, ±3), 3m tall
        const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 3, 8);
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
        const corners = [[-3, 0, -3], [3, 0, -3], [3, 0, 3], [-3, 0, 3]];

        corners.forEach(([cx, , cz]) => {
            const pole = new THREE.Mesh(poleGeo, poleMat);
            pole.position.set(cx, 1.5, cz);
            grp.add(pole);

            // Bright green bands at 2m and 3m height (target zone boundaries)
            [2, 3].forEach(h => {
                const ring = new THREE.Mesh(
                    new THREE.TorusGeometry(0.15, 0.03, 8, 16),
                    new THREE.MeshStandardMaterial({ color: 0x00ff44, emissive: 0x00ff44, emissiveIntensity: 0.5 })
                );
                ring.rotation.x = Math.PI / 2;
                ring.position.set(cx, h, cz);
                grp.add(ring);
            });
        });

        // Small transparent green plane at 2.5m (4×4)
        const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(4, 4),
            new THREE.MeshBasicMaterial({ color: 0x00ff44, transparent: true, opacity: 0.25, side: THREE.DoubleSide })
        );
        plane.rotation.x = -Math.PI / 2;
        plane.position.y = 2.5;
        grp.add(plane);

        // Grid overlay at 2.5m for spatial reference
        const grid = new THREE.GridHelper(4, 8, 0x00ff44, 0x00ff44);
        grid.position.y = 2.5;
        if (Array.isArray(grid.material)) {
            grid.material.forEach(m => { m.transparent = true; m.opacity = 0.3; });
        } else {
            grid.material.transparent = true;
            grid.material.opacity = 0.3;
        }
        grp.add(grid);

        this._altPlane = plane;
    }

    _setupHoverBox(grp) {
        // Landing-target concentric rings on the ground
        const ringConfigs = [
            { inner: 0.6, outer: 0.8, color: 0xff0000 },
            { inner: 1.0, outer: 1.2, color: 0xffffff },
            { inner: 1.4, outer: 1.6, color: 0xff0000 },
        ];
        ringConfigs.forEach(({ inner, outer, color }) => {
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(inner, outer, 32),
                new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.set(0, 0.02, 0);
            grp.add(ring);
        });

        // 4 vertical boundary poles at (±1.25, 0, ±1.25), 4m tall
        const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 4, 8);
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
        const poleCorners = [[-1.25, 0, -1.25], [1.25, 0, -1.25], [1.25, 0, 1.25], [-1.25, 0, 1.25]];

        poleCorners.forEach(([cx, , cz]) => {
            const pole = new THREE.Mesh(poleGeo, poleMat);
            pole.position.set(cx, 2, cz);
            grp.add(pole);

            // Green bands at 2m and 4m (hover height zone boundaries)
            [2, 4].forEach(h => {
                const ring = new THREE.Mesh(
                    new THREE.TorusGeometry(0.15, 0.03, 8, 16),
                    new THREE.MeshStandardMaterial({ color: 0x00ff44, emissive: 0x00ff44, emissiveIntensity: 0.5 })
                );
                ring.rotation.x = Math.PI / 2;
                ring.position.set(cx, h, cz);
                grp.add(ring);
            });
        });

        // Semi-transparent solid green box (no wireframe) for zone visibility
        const box = new THREE.Mesh(
            new THREE.BoxGeometry(2.5, 2.5, 2.5),
            new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.08 })
        );
        box.position.set(0, 3, 0);
        grp.add(box);
        this._hoverBox = box;
    }

    _setupWaypoints(grp, points) {
        this.waypoints = points;
        this.wpMeshes = [];
        this._wpBaseY = points.map(p => p[1]);
        this.wpIndex = 0;
        points.forEach((p, i) => {
            const m = this._makeWpSphere(p, i === 0 ? 0x00ff88 : 0x444488);
            grp.add(m);
            this.wpMeshes.push(m);
        });
        this._highlightWp(0);
    }

    _highlightWp(idx) {
        this.wpMeshes.forEach((m, i) => {
            if (i === idx) {
                m.material.color.setHex(0xff3333);
                m.material.emissive.setHex(0xff3333);
                m.material.opacity = 0.9;
            } else if (i < idx) {
                m.material.opacity = 0.15;
            } else {
                m.material.color.setHex(0x444488);
                m.material.emissive.setHex(0x222244);
                m.material.opacity = 0.4;
            }
        });
    }

    _setupGate(grp) {
        const gate1 = this._makeGate([0, 3, -12], [0, 3, 0]);
        grp.add(gate1);
        const gate2Geo = new THREE.TorusGeometry(1.5, 0.2, 8, 30);
        const gate2 = new THREE.Mesh(gate2Geo,
            new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xff4400, emissiveIntensity: 0.4 }));
        gate2.position.set(0, 3, -22);
        gate2.lookAt(0, 3, 0);
        gate2.castShadow = true;
        grp.add(gate2);
        this._gates = [gate1, gate2];
        this._gateIndex = 0;
    }

    _setupFigure8(grp) {
        // 兩根柱子置於雙圓考場圓心（v2.8 雙圓考場 ±6, 0），讓 8 字飛行繞著真實考場走
        const poleGeo = new THREE.CylinderGeometry(0.2, 0.2, 6, 8);
        const poleMat = new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0x441100 });
        const p1 = new THREE.Mesh(poleGeo, poleMat);
        p1.position.set(-6, 3, 0); p1.castShadow = true; grp.add(p1);
        const p2 = new THREE.Mesh(poleGeo, poleMat);
        p2.position.set(6, 3, 0); p2.castShadow = true; grp.add(p2);

        // 6 個檢查點：繞雙圓內圓（4m）做 8 字
        // 關鍵：cp[2]→cp[3]→cp[4] 必須共線（slope = 4/6），讓中央成為平滑 X 對角穿越
        // 順序：center → 左圓遠 → 左圓近 → center → 右圓近 → 右圓遠
        // ↓ 這樣 (-6,+4)→(0,0)→(6,-4) 為一條 NE 對角直線，drone 不會在中央硬 V 彎
        const cps = [
            [0, 3, 0],      // 中央交叉起點
            [-6, 3, -4],    // 左圓遠側（NW）
            [-6, 3, 4],     // 左圓近側（SW）
            [0, 3, 0],      // 中央交叉（X 對角穿越）
            [6, 3, -4],     // 右圓遠側（NE）— 與前 cp 連線過 (0,0) 是同一直線
            [6, 3, 4]       // 右圓近側（SE）
        ];
        this.checkpoints = cps;
        this._wpBaseY = cps.map(cp => cp[1]);
        this.cpIndex = 0;
        cps.forEach((cp, i) => {
            const m = this._makeWpSphere(cp, i === 0 ? 0xffaa00 : 0x664400);
            m.scale.setScalar(0.6);
            grp.add(m);
            this.wpMeshes.push(m);
        });
        this._highlightCp(0);
    }

    _highlightCp(idx) {
        this.wpMeshes.forEach((m, i) => {
            if (i === idx) {
                m.material.color.setHex(0xff3333);
                m.material.emissive.setHex(0xff3333);
                m.material.opacity = 0.9;
            } else if (i < idx) {
                m.material.opacity = 0.1;
            } else {
                m.material.color.setHex(0x664400);
                m.material.emissive.setHex(0x332200);
                m.material.opacity = 0.35;
            }
        });
    }

    _makeCone(pos) {
        const cone = new THREE.Mesh(
            new THREE.ConeGeometry(0.4, 1, 8),
            new THREE.MeshStandardMaterial({ color: 0xff8800, emissive: 0x662200 })
        );
        cone.position.set(pos[0], 0.5, pos[2]);
        cone.castShadow = true;
        return cone;
    }

    _makeTextLabel(text, pos) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ff8800';
        ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 64, 32);
        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex });
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(...pos);
        sprite.scale.set(2, 1, 1);
        return sprite;
    }

    _setupExam(grp) {
        // P1-P4 放在「雙圓內圓 4m 邊緣」（圓心 ±6, 邊緣 z=±4），與 L7 八字檢查點同位置
        // 矩形 12m × 8m，繞兩圓內圓走完整一圈，符合 CAA「四角點 + 矩形航線」
        const P1 = [ 6, 0,  4], P2 = [ 6, 0, -4], P3 = [-6, 0, -4], P4 = [-6, 0,  4];
        const ALT = 1.5;
        // 羅盤方位（與 main.js compass 一致：N=0=前/-z, E=90=右/+x, S=180=後/+z, W=270=左/-x）
        const N = 0, E = 90, S = 180, W = 270;
        // 對角朝向（機頭朝某角錐）— 由 θ=atan2(dx,-dz) 算出，孩子靠地面箭頭+紅環對齊即可
        const toP1 = 124, toH_fromP4 = 56, toP4_fromH = 236, toH_fromP1 = 304;

        // Orange cone markers at P1-P4 with labels（放大、標籤上移更好讀）
        [{ pos: P1, label: 'P1' }, { pos: P2, label: 'P2' },
         { pos: P3, label: 'P3' }, { pos: P4, label: 'P4' }].forEach(c => {
            const cone = this._makeCone(c.pos);
            cone.scale.set(1.6, 1.6, 1.6);   // 放大角錐
            cone.position.y = 0.8;
            grp.add(cone);
            const lbl = this._makeTextLabel(c.label, [c.pos[0], 3.0, c.pos[2]]);
            lbl.scale.set(3, 1.5, 1);         // 放大標籤
            grp.add(lbl);
        });

        // Rectangle path lines: H -> P1 -> P2 -> P3 -> P4 -> H
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([
            0, 0.1, 0, P1[0], 0.1, P1[2], P2[0], 0.1, P2[2],
            P3[0], 0.1, P3[2], P4[0], 0.1, P4[2], 0, 0.1, 0
        ], 3));
        grp.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({
            color: 0xff8800, transparent: true, opacity: 0.5
        })));

        // 20-step exam sequence（heading = 機頭該朝的羅盤角度；null = 不檢查朝向，如降落）
        // 國小白話標籤：箭頭 emoji + 方位詞，搭配地面綠箭頭指示
        this._examSteps = [
            // Phase 1: 定點起降與四面停懸（這關核心：原地轉四個方向）
            { type: 'takeoff',  pos: [0, ALT, 0], heading: N, label: '🛫 從 H 點起飛，升到約 1.5 公尺，機頭朝前 ⬆️' },
            { type: 'hover_at', pos: [0, ALT, 0], heading: E, label: '↻ 原地右轉，機頭朝「右」➡️，停穩' },
            { type: 'hover_at', pos: [0, ALT, 0], heading: S, label: '↻ 再右轉，機頭朝「後」⬇️（朝自己），停穩' },
            { type: 'hover_at', pos: [0, ALT, 0], heading: W, label: '↻ 再右轉，機頭朝「左」⬅️，停穩' },
            { type: 'hover_at', pos: [0, ALT, 0], heading: N, label: '↻ 轉回機頭朝「前」⬆️，停穩' },
            { type: 'land',     pos: [0, 0, 0],   heading: null, label: '🛬 降落回 H 點' },
            // Phase 2: 矩形航線（順時針）— 機頭朝你要飛去的方向
            { type: 'takeoff',  pos: [0, ALT, 0],         heading: N,         label: '🛫 再次起飛到 1.5 公尺，準備走矩形' },
            { type: 'hover_at', pos: [0, ALT, 0],         heading: toP1,      label: '機頭轉向 P1（對準綠箭頭）' },
            { type: 'hover_at', pos: [P1[0], ALT, P1[2]], heading: N,         label: '➡️ 飛到 P1 停穩，機頭轉向 P2' },
            { type: 'hover_at', pos: [P2[0], ALT, P2[2]], heading: W,         label: '➡️ 飛到 P2 停穩，機頭轉向 P3' },
            { type: 'hover_at', pos: [P3[0], ALT, P3[2]], heading: S,         label: '➡️ 飛到 P3 停穩，機頭轉向 P4' },
            { type: 'hover_at', pos: [P4[0], ALT, P4[2]], heading: toH_fromP4, label: '➡️ 飛到 P4 停穩，機頭轉回 H' },
            { type: 'hover_at', pos: [0, ALT, 0],         heading: N,         label: '飛回 H 停穩，機頭朝前 ⬆️' },
            // Phase 2b: 矩形航線（逆時針）
            { type: 'hover_at', pos: [0, ALT, 0],         heading: toP4_fromH, label: '機頭轉向 P4（換反方向繞，對準綠箭頭）' },
            { type: 'hover_at', pos: [P4[0], ALT, P4[2]], heading: N,         label: '⬅️ 飛到 P4 停穩，機頭轉向 P3' },
            { type: 'hover_at', pos: [P3[0], ALT, P3[2]], heading: E,         label: '⬅️ 飛到 P3 停穩，機頭轉向 P2' },
            { type: 'hover_at', pos: [P2[0], ALT, P2[2]], heading: S,         label: '⬅️ 飛到 P2 停穩，機頭轉向 P1' },
            { type: 'hover_at', pos: [P1[0], ALT, P1[2]], heading: toH_fromP1, label: '⬅️ 飛到 P1 停穩，機頭轉回 H' },
            { type: 'hover_at', pos: [0, ALT, 0],         heading: N,         label: '飛回 H 停穩，機頭朝前 ⬆️' },
            { type: 'land',     pos: [0, 0, 0],           heading: null,      label: '🛬 降落回 H 點，完成！🎉' },
        ];
        this._examStepIndex = 0;
        this._examHoverTimer = 0;

        // 當前 exam step 的虛擬目標環（紅色薄圓環，每幀跟著當前 step.pos + lookAt(drone)）
        this._examMarker = this._makeWpSphere([0, ALT, 0], 0xff3333);
        this._examMarker.scale.setScalar(1.3); // 放大更醒目
        grp.add(this._examMarker);

        // 機頭朝向地面箭頭（指示這一步機頭該朝哪；達標變綠）
        this._examArrow = this._makeHeadingArrow();
        grp.add(this._examArrow);

        // 顯示考試專用 HUD（倒數 + 下一步預告）
        this._setExamHud(0);
    }

    // 地面方向箭頭（group 內箭頭朝 -z = 機頭預設方向；rotation.y = -heading 對應 compass）
    _makeHeadingArrow() {
        const g = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({
            color: 0xffcc00, emissive: 0xffaa00, emissiveIntensity: 0.6,
            transparent: true, opacity: 0.9
        });
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 4), mat);
        head.rotation.x = -Math.PI / 2;   // 圓錐 +y → 指向 -z
        head.position.z = -1.9;
        g.add(head);
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 1.4), mat);
        shaft.position.z = -0.9;
        g.add(shaft);
        g.userData.mat = mat;
        g.position.y = 0.12;
        return g;
    }

    // 考試 HUD：步驟說明 + 下一步預告（exam-next）
    _setExamHud(idx) {
        const steps = this._examSteps;
        document.getElementById('instruction').innerText =
            `步驟 ${idx + 1}/${steps.length}：${steps[idx].label}`;
        const nextEl = document.getElementById('exam-next');
        const statEl = document.getElementById('exam-status');
        if (nextEl) {
            const nx = steps[idx + 1];
            nextEl.style.display = 'block';
            nextEl.innerText = nx ? `接下來：${nx.label}` : '接下來：完成考試！';
        }
        if (statEl) { statEl.style.display = 'block'; statEl.innerText = ''; }
    }

    _yawDegFromQuat(quat) {
        if (!quat) return null;
        this._euler = this._euler || new THREE.Euler();
        this._euler.setFromQuaternion(quat, 'YXZ');
        let y = -THREE.MathUtils.radToDeg(this._euler.y);
        return ((y % 360) + 360) % 360;
    }

    _checkExam(dronePos, dt, pFill, droneVel, droneYaw) {
        const HOLD = 3;            // 停懸需穩定秒數
        const HEADING_TOL = 35;    // 機頭朝向容許誤差（度）— 對國小放寬
        const step = this._examSteps[this._examStepIndex];
        const statEl = document.getElementById('exam-status');
        if (!step) return;
        const dx = dronePos.x - step.pos[0];
        const dz = dronePos.z - step.pos[2];
        const hDist = Math.sqrt(dx * dx + dz * dz);

        // 機頭朝向是否達標
        let headingOK = true, headingDiff = 0;
        if (step.heading != null && droneYaw != null) {
            headingDiff = Math.abs(((droneYaw - step.heading + 540) % 360) - 180);
            headingOK = headingDiff < HEADING_TOL;
        }

        if (step.type === 'land') {
            const speed = droneVel ? droneVel.length() : 0;
            const ok = dronePos.y < 0.3 && hDist < 2 && speed < 1.5;
            if (statEl) statEl.innerText = ok ? '✅ 降落成功！' : '🛬 慢慢降到 H 點上…';
            if (ok) this._advanceExamStep();
        } else {
            const vDist = Math.abs(dronePos.y - step.pos[1]);
            const inZone = hDist < 2 && vDist < 1;
            if (inZone && headingOK) {
                this._examHoverTimer += dt;
                const left = Math.max(0, HOLD - this._examHoverTimer);
                if (statEl) statEl.innerText = `✅ 停穩中… 再 ${left.toFixed(1)} 秒`;
                if (this._examHoverTimer >= HOLD) this._advanceExamStep();
            } else {
                this._examHoverTimer = Math.max(0, this._examHoverTimer - dt * 0.5);
                if (statEl) {
                    if (!inZone) statEl.innerText = '➡️ 先飛到紅色圓環裡';
                    else statEl.innerText = '↻ 位置對了！再把機頭轉到綠箭頭方向';
                }
            }
        }
        // 目標環 / 箭頭 顏色回饋
        this._examFeedbackColor(hDist < 2 && Math.abs(dronePos.y - step.pos[1]) < 1, headingOK, step);
        pFill.style.width = (this._examStepIndex / this._examSteps.length * 100) + '%';
    }

    // 圓環：在區內變黃、達標(含朝向)變綠、未到位紅；箭頭：朝向對變綠
    _examFeedbackColor(inZone, headingOK, step) {
        const needHeading = step.heading != null;
        const done = inZone && (!needHeading || headingOK);
        if (this._examMarker) {
            const c = done ? 0x00ff66 : (inZone ? 0xffcc00 : 0xff3333);
            this._examMarker.material.color.setHex(c);
            this._examMarker.material.emissive.setHex(c);
        }
        if (this._examArrow && this._examArrow.userData.mat) {
            const am = this._examArrow.userData.mat;
            const ac = headingOK ? 0x00ff66 : 0xffcc00;
            am.color.setHex(ac);
            am.emissive.setHex(ac);
            this._examArrow.visible = needHeading;
        }
    }

    _advanceExamStep() {
        this._examStepIndex++;
        this._examHoverTimer = 0;
        if (this._examStepIndex >= this._examSteps.length) {
            this._complete();
        } else {
            this._setExamHud(this._examStepIndex);
        }
    }

    checkWinCondition(dronePos, dt, droneVel, droneQuat) {
        if (this.isComplete) return true;
        this.elapsed += dt;
        document.getElementById('stat-time').innerText = this.elapsed.toFixed(1) + 's';

        const pFill = document.getElementById('progress-fill');
        const L = this.currentLevel;

        // Floating animation + lookAt(drone) for active waypoint meshes
        const bobY = Math.sin(Date.now() * 0.003) * 0.3;
        if ((L >= 3 && L <= 5) || L === 7) {
            const activeIdx = L === 7 ? this.cpIndex : this.wpIndex;
            this.wpMeshes.forEach((mesh, i) => {
                if (i === activeIdx && i < this._wpBaseY.length) {
                    mesh.position.y = this._wpBaseY[i] + bobY;
                    mesh.lookAt(dronePos); // 圓環面向飛機，玩家視角看得到正圓
                }
            });
        }

        // Hide guide line by default; level branches below will show it
        if (this._guideLine) this._guideLine.visible = false;
        this.activeTarget = null;

        if (L === 1) {
            // 高度 2~3m
            if (dronePos.y >= 2 && dronePos.y <= 3) {
                this.timer += dt;
                if (this._altPlane) this._altPlane.material.color.setHex(0xffff00);
            } else {
                this.timer = Math.max(0, this.timer - dt * 0.5);
                if (this._altPlane) this._altPlane.material.color.setHex(0x00ff44);
            }
            pFill.style.width = Math.min(100, this.timer / 3 * 100) + '%';
            if (this.timer >= 3) this._complete();

        } else if (L === 2) {
            const b = this._hoverBox.position;
            if (Math.abs(dronePos.x-b.x)<1.25 && Math.abs(dronePos.y-b.y)<1.25 && Math.abs(dronePos.z-b.z)<1.25) {
                this.timer += dt;
                this._hoverBox.material.color.setHex(0xffff00);
            } else {
                this.timer = Math.max(0, this.timer - dt * 2);
                this._hoverBox.material.color.setHex(0x00ff00);
            }
            pFill.style.width = Math.min(100, this.timer / 3 * 100) + '%';
            if (this.timer >= 3) this._complete();

        } else if (L >= 3 && L <= 5) {
            const wp = this.waypoints[this.wpIndex];
            const target = this._reusableTarget.set(wp[0], wp[1], wp[2]);
            this.activeTarget = target;
            this._updateGuideLine(dronePos, target);
            const dist = dronePos.distanceTo(target);
            if (dist < 1.8) {
                this.wpIndex++;
                if (this.wpIndex >= this.waypoints.length) {
                    this._complete();
                } else {
                    this._highlightWp(this.wpIndex);
                }
            }
            pFill.style.width = (this.wpIndex / this.waypoints.length * 100) + '%';

        } else if (L === 6) {
            const gate = this._gates[this._gateIndex];
            const target = gate.position;
            this.activeTarget = target;
            this._updateGuideLine(dronePos, target);
            const dist = dronePos.distanceTo(target);
            if (dist < 2) {
                this._gateIndex++;
                if (this._gateIndex >= this._gates.length) {
                    this._complete();
                } else {
                    gate.material.emissiveIntensity = 0.1;
                    gate.material.opacity = 0.4;
                    gate.material.transparent = true;
                }
            }
            pFill.style.width = (this._gateIndex / this._gates.length * 100) + '%';

        } else if (L === 7) {
            const cp = this.checkpoints[this.cpIndex];
            const target = this._reusableTarget.set(cp[0], cp[1], cp[2]);
            this.activeTarget = target;
            this._updateGuideLine(dronePos, target);
            const dist = dronePos.distanceTo(target);
            if (dist < 2.5) {
                this.cpIndex++;
                if (this.cpIndex >= this.checkpoints.length) {
                    this._complete();
                } else {
                    this._highlightCp(this.cpIndex);
                }
            }
            pFill.style.width = (this.cpIndex / this.checkpoints.length * 100) + '%';

        } else if (L === 8) {
            // Guide line + 虛擬目標環跟著當前 exam step 走
            const step = this._examSteps[this._examStepIndex];
            const droneYaw = this._yawDegFromQuat(droneQuat);
            if (step) {
                const target = this._reusableTarget.set(step.pos[0], step.pos[1], step.pos[2]);
                this.activeTarget = target;
                this._updateGuideLine(dronePos, target);
                if (this._examMarker) {
                    // 升空步驟用 ALT 高度，降落步驟用較低高度（避免馬上撞到地）
                    const markerY = step.type === 'land' ? 0.3 : step.pos[1];
                    this._examMarker.position.set(step.pos[0], markerY + bobY, step.pos[2]);
                    this._examMarker.lookAt(dronePos);
                }
                // 機頭方向箭頭：擺在目標點地面、轉到該步要求的 compass 朝向
                if (this._examArrow) {
                    if (step.heading != null) {
                        this._examArrow.visible = true;
                        this._examArrow.position.set(step.pos[0], 0.12, step.pos[2]);
                        this._examArrow.rotation.y = -step.heading * Math.PI / 180;
                    } else {
                        this._examArrow.visible = false;
                    }
                }
            }
            this._checkExam(dronePos, dt, pFill, droneVel, droneYaw);
        }
    }

    static getUnlockedLevel() {
        return parseInt(localStorage.getItem('flightSimUnlocked')) || 1;
    }

    static setUnlockedLevel(level) {
        const current = LevelManager.getUnlockedLevel();
        if (level > current) localStorage.setItem('flightSimUnlocked', String(level));
    }

    _updateGuideLine(from, to) {
        if (!this._guideLine) return;
        const positions = this._guideLine.geometry.attributes.position;
        positions.setXYZ(0, from.x, from.y, from.z);
        positions.setXYZ(1, to.x, to.y, to.z);
        positions.needsUpdate = true;
        this._guideLine.computeLineDistances();
        this._guideLine.visible = true;
    }

    _complete() {
        this.isComplete = true;
        this.saveBest(this.currentLevel, this.elapsed);
        // Unlock next level
        LevelManager.setUnlockedLevel(this.currentLevel + 1);
        window.dispatchEvent(new Event('level-complete'));

        document.getElementById('msg-overlay').style.display = 'block';
        document.getElementById('msg-time').innerText = `用時: ${this.elapsed.toFixed(1)}s`;
        const best = this.getBest(this.currentLevel);
        document.getElementById('msg-best').innerText = best ? `最佳: ${best}s` : '';

        const goLevel = (lv) => {
            document.getElementById('msg-overlay').style.display = 'none';
            this.loadLevel(lv);
            window.dispatchEvent(new Event('reset-drone'));
            // 進新關卡必須重置 arm 狀態（跟 startGame 一樣）
            window.dispatchEvent(new Event('level-changed'));
        };
        document.getElementById('btn-next').onclick = () =>
            goLevel(this.currentLevel < 8 ? this.currentLevel + 1 : 1);
        // 再飛一次：刷最佳成績用，不必繞回選關頁
        document.getElementById('btn-retry').onclick = () => goLevel(this.currentLevel);
    }
}
