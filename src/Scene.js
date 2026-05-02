import { CONFIG } from './Config.js';

export class GameScene {
    constructor() {
        this.scene = new THREE.Scene();
        // 霧改深一點 + 密度降低，避免遠處被洗白
        this.scene.fog = new THREE.FogExp2(0x5a7a8c, 0.0018);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 500);
        this.camera.position.set(0, 2.5, 10);
        this.cameraTarget = new THREE.Vector3(0, 1, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.88;  // <1 拉高對比、加深陰影
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        document.body.appendChild(this.renderer.domElement);

        this.droneGroup = new THREE.Group();
        this.propellers = [];
        this.levelGroup = new THREE.Group();
        this.ledMesh = null;
        this.clouds = [];
        this.windSock = null;
        this._navLights = [];

        this._createSkyDome();
        this._initLights();
        this._initEnvironment();
        this._createClouds();
        this._createDrone();
        this.scene.add(this.levelGroup);
    }

    setGrassColors(outerHex, innerHex) {
        if (outerHex != null && this.outerGround) this.outerGround.material.color.setHex(outerHex);
        if (innerHex != null && this.innerGround) this.innerGround.material.color.setHex(innerHex);
    }

    setFogColor(hex) {
        if (this.scene.fog) this.scene.fog.color.setHex(hex);
    }

    setExposure(v) {
        this.renderer.toneMappingExposure = v;
    }

    _createSkyDome() {
        const skyGeo = new THREE.SphereGeometry(400, 32, 16);
        const skyMat = new THREE.ShaderMaterial({
            uniforms: {
                topColor:     { value: new THREE.Color(0x0a3a78) },
                midColor:     { value: new THREE.Color(0x3a7ab0) },
                horizonColor: { value: new THREE.Color(0xc78050) },
            },
            vertexShader: `
                varying vec3 vWorldPos;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPos = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 midColor;
                uniform vec3 horizonColor;
                varying vec3 vWorldPos;
                void main() {
                    float h = normalize(vWorldPos).y;
                    vec3 col;
                    if (h > 0.15) {
                        col = mix(midColor, topColor, (h - 0.15) / 0.85);
                    } else {
                        col = mix(horizonColor, midColor, max(h, 0.0) / 0.15);
                    }
                    gl_FragColor = vec4(col, 1.0);
                }
            `,
            side: THREE.BackSide
        });
        this.scene.add(new THREE.Mesh(skyGeo, skyMat));

        // 太陽
        const sunDir = new THREE.Vector3(150, 180, -250).normalize();
        const sunPos = sunDir.clone().multiplyScalar(380);
        const sun = new THREE.Mesh(
            new THREE.SphereGeometry(11, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0xfffde7 })
        );
        sun.position.copy(sunPos);
        this.scene.add(sun);

        // 太陽光暈
        [22, 35].forEach((r, i) => {
            const corona = new THREE.Mesh(
                new THREE.SphereGeometry(r, 16, 16),
                new THREE.MeshBasicMaterial({ color: 0xfff9c4, transparent: true, opacity: 0.10 - i * 0.03 })
            );
            corona.position.copy(sunPos);
            this.scene.add(corona);
        });
    }

    _createClouds() {
        const cloudMat = new THREE.MeshStandardMaterial({
            color: 0xf5f5f5, transparent: true, opacity: 0.92, roughness: 1, metalness: 0
        });
        for (let i = 0; i < 12; i++) {
            const group = new THREE.Group();
            const count = 4 + Math.floor(Math.random() * 5);
            for (let j = 0; j < count; j++) {
                const s = 2.0 + Math.random() * 3.5;
                const sphere = new THREE.Mesh(new THREE.SphereGeometry(s, 7, 7), cloudMat);
                sphere.position.set(
                    j * 2.8 - count * 1.3,
                    (Math.random() - 0.5) * 1.8,
                    (Math.random() - 0.5) * 2.2
                );
                sphere.scale.y = 0.42;
                group.add(sphere);
            }
            const angle = Math.random() * Math.PI * 2;
            const dist = 60 + Math.random() * 110;
            group.position.set(Math.cos(angle) * dist, 45 + Math.random() * 30, Math.sin(angle) * dist);
            this.scene.add(group);
            this.clouds.push(group);
        }
    }

    _initLights() {
        // 主日光（暖色）— 強度提升，主光更鮮明
        const dir = new THREE.DirectionalLight(0xfff0d8, 1.7);
        dir.position.set(30, 60, 40);
        dir.castShadow = true;
        dir.shadow.mapSize.set(4096, 4096);
        dir.shadow.bias = -0.001;
        const sc = dir.shadow.camera;
        sc.near = 0.5; sc.far = 200; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60;
        this.scene.add(dir);

        // 天空半球光（深一階藍 + 深一階綠）— 強度大幅降低讓陰影回到該有的暗
        this.scene.add(new THREE.HemisphereLight(0x4a78a8, 0x2d4a25, 0.38));

        // 補光（對側，輕微藍色）— 強度降低
        const fill = new THREE.DirectionalLight(0x6a96b8, 0.18);
        fill.position.set(-20, 30, -30);
        this.scene.add(fill);
    }

    _initEnvironment() {
        // 主地面
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(300, 300),
            new THREE.MeshStandardMaterial({ color: 0x2a8a2a, roughness: 0.85 })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);
        this.outerGround = ground;

        // 飛行區內圈（略淺）
        const innerGround = new THREE.Mesh(
            new THREE.PlaneGeometry(44, 44),
            new THREE.MeshStandardMaterial({ color: 0x4cb04c, roughness: 0.78 })
        );
        innerGround.rotation.x = -Math.PI / 2;
        innerGround.position.y = 0.005;
        innerGround.receiveShadow = true;
        this.scene.add(innerGround);
        this.innerGround = innerGround;

        // 網格
        const grid = new THREE.GridHelper(300, 30, 0x2a6a1a, 0x2a6a1a);
        grid.position.y = 0.01;
        grid.material.opacity = 0.10;
        grid.material.transparent = true;
        this.scene.add(grid);

        this._createLandingPad();
        this._createRunwayLines();
        this._createTrees();
        this._createBuildings();
        this._createFence();
        this._createWindSock();
    }

    _createRunwayLines() {
        const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        for (let i = 1; i <= 7; i++) {
            const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 1.4), lineMat);
            dash.rotation.x = -Math.PI / 2;
            dash.position.set(0, 0.015, -3 * i);
            this.scene.add(dash);
        }
    }

    _createLandingPad() {
        // 深色圓形停機坪
        const pad = new THREE.Mesh(
            new THREE.CircleGeometry(2.2, 32),
            new THREE.MeshStandardMaterial({ color: 0x252525, roughness: 0.9 })
        );
        pad.rotation.x = -Math.PI / 2; pad.position.y = 0.02; pad.receiveShadow = true;
        this.scene.add(pad);

        // 黃色外圈
        const ringOuter = new THREE.Mesh(
            new THREE.RingGeometry(1.75, 2.05, 32),
            new THREE.MeshBasicMaterial({ color: 0xffdd00, side: THREE.DoubleSide })
        );
        ringOuter.rotation.x = -Math.PI / 2; ringOuter.position.y = 0.03;
        this.scene.add(ringOuter);

        // 白色內圈
        const ringInner = new THREE.Mesh(
            new THREE.RingGeometry(0.58, 0.72, 32),
            new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
        );
        ringInner.rotation.x = -Math.PI / 2; ringInner.position.y = 0.03;
        this.scene.add(ringInner);

        // H 字
        const hMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        [
            { w: 0.14, h: 1.30, x: -0.36, z: 0 },
            { w: 0.14, h: 1.30, x:  0.36, z: 0 },
            { w: 0.82, h: 0.14, x:     0, z: 0 }
        ].forEach(b => {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), hMat);
            m.rotation.x = -Math.PI / 2; m.position.set(b.x, 0.04, b.z);
            this.scene.add(m);
        });

        // 角落琥珀燈
        [[-2.1,-2.1],[2.1,-2.1],[2.1,2.1],[-2.1,2.1]].forEach(([x, z]) => {
            const l = new THREE.Mesh(
                new THREE.SphereGeometry(0.07, 6, 6),
                new THREE.MeshBasicMaterial({ color: 0xff8800 })
            );
            l.position.set(x, 0.08, z);
            this.scene.add(l);
        });
    }

    _createTrees() {
        for (let i = 0; i < 32; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = 25 + Math.random() * 68;
            const x = Math.cos(a) * d, z = Math.sin(a) * d;
            const s = 0.65 + Math.random() * 1.05;
            const type = i % 3;
            if (type === 0) this._addPineTree(x, z, s);
            else if (type === 1) this._addRoundTree(x, z, s);
            else this._addTallTree(x, z, s);
        }
    }

    _addPineTree(x, z, s) {
        const tMat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.9 });
        const colors = [0x2d8a2d, 0x1a6b1a, 0x3a9a3a];
        const lMat = new THREE.MeshStandardMaterial({ color: colors[Math.floor(Math.random()*3)], roughness: 0.85 });
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 2, 6), tMat);
        trunk.position.set(x, s, z); trunk.scale.setScalar(s); trunk.castShadow = true;
        this.scene.add(trunk);
        [[1.5,0],[1.1,1.4],[0.7,2.6]].forEach(([r, yo]) => {
            const cone = new THREE.Mesh(new THREE.ConeGeometry(r*s, 2.2*s, 7), lMat);
            cone.position.set(x, s*2+yo*s, z); cone.castShadow = true;
            this.scene.add(cone);
        });
    }

    _addRoundTree(x, z, s) {
        const tMat = new THREE.MeshStandardMaterial({ color: 0x8b6348, roughness: 0.9 });
        const colors = [0x5dab3a, 0x4d9c30, 0x66bb44];
        const lMat = new THREE.MeshStandardMaterial({ color: colors[Math.floor(Math.random()*3)], roughness: 0.85 });
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.16, 2.5, 6), tMat);
        trunk.position.set(x, s*1.25, z); trunk.scale.setScalar(s); trunk.castShadow = true;
        this.scene.add(trunk);
        const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.4*s, 8, 6), lMat);
        canopy.position.set(x, s*3.2, z); canopy.scale.y = 0.88; canopy.castShadow = true;
        this.scene.add(canopy);
        const side = new THREE.Mesh(new THREE.SphereGeometry(0.95*s, 7, 5), lMat);
        side.position.set(x+0.8*s, s*2.9, z+0.4*s); side.castShadow = true;
        this.scene.add(side);
    }

    _addTallTree(x, z, s) {
        const tMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.9 });
        const lMat = new THREE.MeshStandardMaterial({ color: 0x388e3c, roughness: 0.85 });
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 4, 6), tMat);
        trunk.position.set(x, s*2, z); trunk.castShadow = true;
        this.scene.add(trunk);
        const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.9*s, 5*s, 6), lMat);
        canopy.position.set(x, s*5.5, z); canopy.castShadow = true;
        this.scene.add(canopy);
    }

    _createBuildings() {
        [{x:-40,z:-30,w:8,h:6,d:10,c:0x9e9e9e},{x:35,z:-25,w:6,h:4,d:8,c:0xbcaaa4},{x:-30,z:40,w:10,h:3,d:6,c:0xa5d6a7}]
        .forEach(b => {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w,b.h,b.d),
                new THREE.MeshStandardMaterial({color:b.c,roughness:0.8}));
            mesh.position.set(b.x,b.h/2,b.z); mesh.castShadow=true; mesh.receiveShadow=true;
            this.scene.add(mesh);
            const roof = new THREE.Mesh(new THREE.BoxGeometry(b.w+0.5,0.3,b.d+0.5),
                new THREE.MeshStandardMaterial({color:0x37474f,roughness:0.9}));
            roof.position.set(b.x,b.h+0.15,b.z); roof.castShadow=true;
            this.scene.add(roof);
            const winMat = new THREE.MeshBasicMaterial({color:0xffffee,side:THREE.DoubleSide});
            for(let wi=0;wi<2;wi++) for(let wj=0;wj<2;wj++) {
                const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8,0.8),winMat);
                win.position.set(b.x-b.w*0.25+wi*b.w*0.5,b.h*0.35+wj*b.h*0.35,b.z+b.d/2+0.01);
                this.scene.add(win);
            }
        });
    }

    _createFence() {
        const geo = new THREE.CylinderGeometry(0.05, 0.05, 1.2, 4);
        const mat = new THREE.MeshStandardMaterial({ color: 0x886644 });
        const barMat = new THREE.MeshStandardMaterial({ color: 0x886644 });
        for (let i = -20; i <= 20; i += 4) {
            [[-20,i],[20,i],[i,-20],[i,20]].forEach(([x,z]) => {
                const p = new THREE.Mesh(geo, mat);
                p.position.set(x, 0.6, z); p.castShadow = true;
                this.scene.add(p);
            });
        }
        const barH = new THREE.BoxGeometry(4, 0.06, 0.06);
        const barV = new THREE.BoxGeometry(0.06, 0.06, 4);
        for (let i = -20; i < 20; i += 4) {
            const cx = i + 2;
            const bt = new THREE.Mesh(barV, barMat); bt.position.set(-20, 1.0, cx); this.scene.add(bt);
            const bb = new THREE.Mesh(barV, barMat); bb.position.set(20, 1.0, cx); this.scene.add(bb);
            const bl = new THREE.Mesh(barH, barMat); bl.position.set(cx, 1.0, -20); this.scene.add(bl);
            const br = new THREE.Mesh(barH, barMat); br.position.set(cx, 1.0, 20); this.scene.add(br);
        }
    }

    _createWindSock() {
        // 旗桿（金屬感）
        const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.06, 4, 8),
            new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.3, metalness: 0.85 })
        );
        pole.position.set(15, 2, 0); pole.castShadow = true;
        this.scene.add(pole);

        // 風向袋（橙白相間）
        const sockGroup = new THREE.Group();
        sockGroup.position.set(15, 4, 0);
        [0xff6600, 0xffffff, 0xff6600, 0xffffff].forEach((c, i) => {
            const band = new THREE.Mesh(
                new THREE.CylinderGeometry(0.27 - i * 0.02, 0.31 - i * 0.02, 0.34, 8, 1, true),
                new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, side: THREE.DoubleSide })
            );
            band.position.y = -i * 0.31;
            sockGroup.add(band);
        });
        this.scene.add(sockGroup);
        this.windSock = sockGroup;
    }

    _createDrone() {
        // === 材質 ===
        const cfMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.28, metalness: 0.68 });
        const motorBellMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.12, metalness: 0.96 });
        // 機殼/馬達鐘罩配色：前綠後紅（DJI 風）
        const frontBellMat = new THREE.MeshStandardMaterial({ color: 0x118833, roughness: 0.3, metalness: 0.55 });
        const rearBellMat = new THREE.MeshStandardMaterial({ color: 0xcc2200, roughness: 0.3, metalness: 0.55 });
        const fcMat = new THREE.MeshStandardMaterial({ color: 0x0a2a0a, roughness: 0.8, metalness: 0.2 });
        const goldMat = new THREE.MeshStandardMaterial({ color: 0xc89010, roughness: 0.18, metalness: 0.96 });

        // === 機架上下板 ===
        const topPlate = new THREE.Mesh(new THREE.BoxGeometry(0.195, 0.007, 0.235), cfMat);
        topPlate.position.y = 0.027;
        this.droneGroup.add(topPlate);

        const botPlate = new THREE.Mesh(new THREE.BoxGeometry(0.175, 0.007, 0.200), cfMat);
        botPlate.position.y = -0.019;
        this.droneGroup.add(botPlate);

        // FC/ESC 疊層
        const fc = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.014, 0.068), fcMat);
        fc.position.y = 0.017;
        this.droneGroup.add(fc);

        // 電容（豎立小圓柱）
        const cap = new THREE.Mesh(
            new THREE.CylinderGeometry(0.007, 0.007, 0.020, 8),
            new THREE.MeshStandardMaterial({ color: 0x333399, roughness: 0.4 })
        );
        cap.position.set(0.020, 0.031, 0.020);
        this.droneGroup.add(cap);

        // VTX 天線
        const ant = new THREE.Mesh(
            new THREE.CylinderGeometry(0.003, 0.003, 0.055, 4),
            new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 })
        );
        ant.position.set(0.040, 0.055, 0);
        this.droneGroup.add(ant);

        // === 四臂 + 馬達 + 螺旋槳 ===
        const armDefs = [
            { x:  0.19, z: -0.19, a: -Math.PI/4, isFront: true  }, // FR
            { x: -0.19, z: -0.19, a:  Math.PI/4, isFront: true  }, // FL
            { x:  0.19, z:  0.19, a:  Math.PI/4, isFront: false }, // RR
            { x: -0.19, z:  0.19, a: -Math.PI/4, isFront: false }, // RL
        ];

        armDefs.forEach((ap, i) => {
            // 機臂（方形截面碳纖管）
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.013, 0.013), cfMat);
            arm.position.set(ap.x / 2, 0.004, ap.z / 2);
            arm.rotation.y = ap.a;
            this.droneGroup.add(arm);

            // 馬達底板
            const mBase = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.005, 8), cfMat);
            mBase.position.set(ap.x, -0.008, ap.z);
            this.droneGroup.add(mBase);

            // 馬達定子（下半，深色金屬）
            const stator = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.017, 12), motorBellMat);
            stator.position.set(ap.x, 0.001, ap.z);
            this.droneGroup.add(stator);

            // 馬達鐘罩（上半，紅/藍色）
            const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.017, 0.018, 12), ap.isFront ? frontBellMat : rearBellMat);
            bell.position.set(ap.x, 0.018, ap.z);
            this.droneGroup.add(bell);

            // 臂尖航行燈（前綠 / 後紅）— 加大球體 + 環繞光暈
            const navColor = ap.isFront ? 0x33ff66 : 0xff3333;
            const navLightMat = new THREE.MeshBasicMaterial({ color: navColor });
            const navLight = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), navLightMat);
            navLight.position.set(ap.x * 0.82, 0.014, ap.z * 0.82);
            this.droneGroup.add(navLight);
            this._navLights.push({ mat: navLightMat, isFront: ap.isFront });

            // 臂尖光暈（加色混合，遠距可見的發光感）
            const haloMat = new THREE.MeshBasicMaterial({
                color: navColor, transparent: true, opacity: 0.5,
                blending: THREE.AdditiveBlending, depthWrite: false
            });
            const halo = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), haloMat);
            halo.position.copy(navLight.position);
            this.droneGroup.add(halo);

            // 臂中段第二顆 LED + halo（雙點亮提升前後辨識）
            const midLight = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), navLightMat.clone());
            midLight.position.set(ap.x * 0.45, 0.014, ap.z * 0.45);
            this.droneGroup.add(midLight);
            this._navLights.push({ mat: midLight.material, isFront: ap.isFront });
            const midHalo = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), haloMat.clone());
            midHalo.position.copy(midLight.position);
            this.droneGroup.add(midHalo);

            // === 螺旋槳組 ===
            const pg = new THREE.Group();
            pg.position.set(ap.x, 0.033, ap.z);

            // 螺帽
            const spinner = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.011, 0.011, 6), goldMat);
            spinner.position.y = 0.006;
            pg.add(spinner);

            // 模糊碟（高油門時浮現）
            const disc = new THREE.Mesh(
                new THREE.CircleGeometry(0.112, 14),
                new THREE.MeshBasicMaterial({
                    color: ap.isFront ? 0x33ff77 : 0xff4433,
                    transparent: true, opacity: 0, side: THREE.DoubleSide
                })
            );
            disc.rotation.x = -Math.PI / 2;
            disc.userData = { isDisc: true };
            pg.add(disc);

            // 槳葉（兩片，較寬）
            for (let b = 0; b < 2; b++) {
                const blade = new THREE.Mesh(
                    new THREE.BoxGeometry(0.210, 0.004, 0.025),
                    new THREE.MeshBasicMaterial({ color: 0x1a1a1a, side: THREE.DoubleSide })
                );
                blade.rotation.y = b * Math.PI / 2;
                blade.userData = { isBlade: true };
                pg.add(blade);
            }

            pg.userData = { dir: (i % 2 === 0) ? 1 : -1 };
            this.propellers.push(pg);
            this.droneGroup.add(pg);
        });

        // === FPV 鏡頭（帶俯仰角）===
        const camTilt = new THREE.Group();
        camTilt.position.set(0, 0.010, -0.116);
        camTilt.rotation.x = -0.38;

        const camBody = new THREE.Mesh(
            new THREE.BoxGeometry(0.023, 0.023, 0.022),
            new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.7 })
        );
        camTilt.add(camBody);

        const lens = new THREE.Mesh(
            new THREE.CylinderGeometry(0.009, 0.009, 0.005, 12),
            new THREE.MeshStandardMaterial({ color: 0x010114, roughness: 0.05, metalness: 0.95 })
        );
        lens.rotation.x = Math.PI / 2; lens.position.z = -0.013;
        camTilt.add(lens);

        const lensRim = new THREE.Mesh(
            new THREE.TorusGeometry(0.009, 0.0025, 6, 12),
            new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.2, metalness: 0.9 })
        );
        lensRim.rotation.x = Math.PI / 2; lensRim.position.z = -0.013;
        camTilt.add(lensRim);

        this.droneGroup.add(camTilt);

        // === 電池（帶綁帶）===
        const batt = new THREE.Mesh(
            new THREE.BoxGeometry(0.080, 0.021, 0.110),
            new THREE.MeshStandardMaterial({ color: 0x1a237e, roughness: 0.6 })
        );
        batt.position.set(0, -0.026, 0.010);
        this.droneGroup.add(batt);

        const strap = new THREE.Mesh(
            new THREE.BoxGeometry(0.090, 0.006, 0.115),
            new THREE.MeshStandardMaterial({ color: 0xff4400, roughness: 0.7 })
        );
        strap.position.set(0, -0.015, 0.010);
        this.droneGroup.add(strap);

        // === 起落架（四腳 + 橫桿）===
        const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7 });
        [[-0.055,-0.085],[0.055,-0.085],[-0.055,0.085],[0.055,0.085]].forEach(([lx, lz]) => {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.038, 5), legMat);
            leg.position.set(lx, -0.038, lz);
            this.droneGroup.add(leg);
        });
        [-0.090, 0.090].forEach(lz => {
            const skid = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.005, 0.010), legMat);
            skid.position.set(0, -0.057, lz);
            this.droneGroup.add(skid);
        });

        // === 後方狀態 LED ===（加大 + halo）
        this.ledMesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.020, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0x00ff00 })
        );
        this.ledMesh.position.set(0, 0.022, 0.112);
        this.droneGroup.add(this.ledMesh);

        const rearHalo = new THREE.Mesh(
            new THREE.SphereGeometry(0.050, 10, 10),
            new THREE.MeshBasicMaterial({
                color: 0x00ff00, transparent: true, opacity: 0.45,
                blending: THREE.AdditiveBlending, depthWrite: false
            })
        );
        rearHalo.position.copy(this.ledMesh.position);
        this.droneGroup.add(rearHalo);
        this._rearHalo = rearHalo;

        // === 機腹下投光（白色，幫助 LOS 飛遠時鎖位） ===
        const bellyMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
        const belly = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 10), bellyMat);
        belly.position.set(0, -0.025, 0);
        this.droneGroup.add(belly);
        const bellyHalo = new THREE.Mesh(
            new THREE.SphereGeometry(0.080, 12, 12),
            new THREE.MeshBasicMaterial({
                color: 0xffffee, transparent: true, opacity: 0.55,
                blending: THREE.AdditiveBlending, depthWrite: false
            })
        );
        bellyHalo.position.copy(belly.position);
        this.droneGroup.add(bellyHalo);
        this._bellyLight = belly;
        this._bellyHalo = bellyHalo;

        const s = CONFIG.droneScale;
        this.droneGroup.scale.set(s, s, s);
        this.droneGroup.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.scene.add(this.droneGroup);
    }

    updateDrone(pos, quat, throttle, crashIntensity = 0, armed = false, dt = 1/60) {
        this.droneGroup.position.copy(pos);
        this.droneGroup.quaternion.copy(quat);

        for (const pg of this.propellers) {
            if (armed) {
                pg.rotation.y += (0.15 + throttle * 2.5) * pg.userData.dir * dt * 60;
            }
            for (const c of pg.children) {
                if (c.userData.isDisc) {
                    c.material.opacity = armed ? Math.min(0.40, throttle * 0.60) : 0;
                } else if (c.userData.isBlade) {
                    c.material.opacity = armed ? Math.max(0.08, 1 - throttle * 1.8) : 1;
                    c.material.transparent = true;
                }
            }
        }

        // 後方 LED 閃爍：armed = 綠色閃，disarmed = 紅色慢閃（halo 跟著切色）
        if (this.ledMesh) {
            const t = Date.now();
            const armedOn = (t & 512) > 0;
            const disarmedOn = (Math.floor(t / 600) % 2 === 0);
            if (armed) {
                this.ledMesh.material.color.setHex(armedOn ? 0x00ff00 : 0x003300);
                if (this._rearHalo) this._rearHalo.material.color.setHex(0x00ff00);
            } else {
                this.ledMesh.material.color.setHex(disarmedOn ? 0xff0000 : 0x330000);
                if (this._rearHalo) this._rearHalo.material.color.setHex(0xff0000);
            }
        }

        // 航行燈：前臂紅色快閃，後臂藍色常亮
        const navT = Date.now();
        this._navLights.forEach(nl => {
            // 前綠閃爍（搶眼），後紅常亮
            const on = nl.isFront ? ((navT & 768) > 256) : true;
            nl.mat.color.setHex(on ? (nl.isFront ? 0x33ff66 : 0xff3333) : 0x050505);
        });

        // 雲飄移
        for (const cloud of this.clouds) {
            cloud.position.x += 0.0018 * dt * 60;
            if (cloud.position.x > 150) cloud.position.x = -150;
        }

        // 風向袋搖擺
        if (this.windSock) {
            this.windSock.rotation.z = Math.sin(Date.now() * 0.0014) * 0.22;
            this.windSock.rotation.x = Math.sin(Date.now() * 0.0009) * 0.10;
        }

        // LOS 第三人稱鏡頭
        this.cameraTarget.lerp(pos, 1 - Math.pow(1 - 0.08, dt * 60));
        let camX = 0, camY = 2.5, camZ = 10;

        if (crashIntensity > 0.01) {
            camX += (Math.random() - 0.5) * crashIntensity * 0.3;
            camY += (Math.random() - 0.5) * crashIntensity * 0.3;
            camZ += (Math.random() - 0.5) * crashIntensity * 0.3;
        }

        this.camera.position.set(camX, camY, camZ);
        this.camera.lookAt(this.cameraTarget);

        const overlay = document.getElementById('crash-overlay');
        if (overlay) overlay.style.opacity = crashIntensity > 0.01 ? crashIntensity * 0.5 : 0;
    }

    render() { this.renderer.render(this.scene, this.camera); }
}

GameScene.prototype.resetCamera = function() {
    this.cameraTarget.set(0, 1, 0);
};
