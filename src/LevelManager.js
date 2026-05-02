import { CONFIG } from './Config.js';

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

        // Orange cone markers at P1-P4 with labels
        [{ pos: P1, label: 'P1' }, { pos: P2, label: 'P2' },
         { pos: P3, label: 'P3' }, { pos: P4, label: 'P4' }].forEach(c => {
            grp.add(this._makeCone(c.pos));
            grp.add(this._makeTextLabel(c.label, [c.pos[0], 2.5, c.pos[2]]));
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

        // 20-step exam sequence
        this._examSteps = [
            // Phase 1: 定點起降與四面停懸
            { type: 'takeoff',  pos: [0, ALT, 0], label: '從 H 起飛至 1.5m 停懸' },
            { type: 'hover_at', pos: [0, ALT, 0], label: '順時針轉 90° 停懸（面向右）' },
            { type: 'hover_at', pos: [0, ALT, 0], label: '順時針轉 90° 停懸（面向後）' },
            { type: 'hover_at', pos: [0, ALT, 0], label: '順時針轉 90° 停懸（面向左）' },
            { type: 'hover_at', pos: [0, ALT, 0], label: '順時針轉 90° 停懸（面向前）' },
            { type: 'land',     pos: [0, 0, 0],   label: '降落於 H' },
            // Phase 2: 矩形航線（順時針）
            { type: 'takeoff',  pos: [0, ALT, 0],         label: '從 H 起飛至 1.5m' },
            { type: 'hover_at', pos: [0, ALT, 0],         label: '逆時針轉 90°（面向 P1）' },
            { type: 'hover_at', pos: [P1[0], ALT, P1[2]], label: '飛往 P1 停懸，順時針轉 90°' },
            { type: 'hover_at', pos: [P2[0], ALT, P2[2]], label: '飛往 P2 停懸，順時針轉 90°' },
            { type: 'hover_at', pos: [P3[0], ALT, P3[2]], label: '飛往 P3 停懸，順時針轉 90°' },
            { type: 'hover_at', pos: [P4[0], ALT, P4[2]], label: '飛往 P4 停懸，順時針轉 90°' },
            { type: 'hover_at', pos: [0, ALT, 0],         label: '飛回 H 停懸' },
            // Phase 2b: 矩形航線（逆時針）
            { type: 'hover_at', pos: [0, ALT, 0],         label: '轉 180°（面向 P4）' },
            { type: 'hover_at', pos: [P4[0], ALT, P4[2]], label: '飛往 P4 停懸，逆時針轉 90°' },
            { type: 'hover_at', pos: [P3[0], ALT, P3[2]], label: '飛往 P3 停懸，逆時針轉 90°' },
            { type: 'hover_at', pos: [P2[0], ALT, P2[2]], label: '飛往 P2 停懸，逆時針轉 90°' },
            { type: 'hover_at', pos: [P1[0], ALT, P1[2]], label: '飛往 P1 停懸，逆時針轉 90°' },
            { type: 'hover_at', pos: [0, ALT, 0],         label: '飛回 H，逆時針轉 90°（面向前）' },
            { type: 'land',     pos: [0, 0, 0],           label: '降落於 H' },
        ];
        this._examStepIndex = 0;
        this._examHoverTimer = 0;

        // 當前 exam step 的虛擬目標環（紅色薄圓環，每幀跟著當前 step.pos + lookAt(drone)）
        this._examMarker = this._makeWpSphere([0, ALT, 0], 0xff3333);
        this._examMarker.scale.setScalar(1.1); // 稍微放大一點更醒目
        grp.add(this._examMarker);

        document.getElementById('instruction').innerText =
            `步驟 1/${this._examSteps.length}: ${this._examSteps[0].label}`;
    }

    _checkExam(dronePos, dt, pFill, droneVel) {
        const step = this._examSteps[this._examStepIndex];
        if (!step) return;
        const dx = dronePos.x - step.pos[0];
        const dz = dronePos.z - step.pos[2];
        const hDist = Math.sqrt(dx * dx + dz * dz);

        if (step.type === 'land') {
            // Require low speed to prevent crash-landing from passing
            const speed = droneVel ? droneVel.length() : 0;
            if (dronePos.y < 0.3 && hDist < 2 && speed < 1.5) this._advanceExamStep();
        } else {
            const vDist = Math.abs(dronePos.y - step.pos[1]);
            if (hDist < 2 && vDist < 1) {
                this._examHoverTimer += dt;
                if (this._examHoverTimer >= 3) this._advanceExamStep();
            } else {
                this._examHoverTimer = Math.max(0, this._examHoverTimer - dt * 0.5);
            }
        }
        pFill.style.width = (this._examStepIndex / this._examSteps.length * 100) + '%';
    }

    _advanceExamStep() {
        this._examStepIndex++;
        this._examHoverTimer = 0;
        if (this._examStepIndex >= this._examSteps.length) {
            this._complete();
        } else {
            const step = this._examSteps[this._examStepIndex];
            document.getElementById('instruction').innerText =
                `步驟 ${this._examStepIndex + 1}/${this._examSteps.length}: ${step.label}`;
        }
    }

    checkWinCondition(dronePos, dt, droneVel) {
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
            }
            this._checkExam(dronePos, dt, pFill, droneVel);
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

        document.getElementById('btn-next').onclick = () => {
            document.getElementById('msg-overlay').style.display = 'none';
            const next = this.currentLevel < 8 ? this.currentLevel + 1 : 1;
            this.loadLevel(next);
            window.dispatchEvent(new Event('reset-drone'));
        };
    }
}
