import { CONFIG } from './Config.js';

export class GameScene {
    constructor() {
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0xc8e6ff, 0.005);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 500);
        this.camera.position.set(0, 2.5, 10);
        this.cameraTarget = new THREE.Vector3(0, 1, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        this.droneGroup = new THREE.Group();
        this.propellers = [];
        this.levelGroup = new THREE.Group();
        this.ledMesh = null;
        this.clouds = [];
        this.windSock = null;

        this._createSkyDome();
        this._initLights();
        this._initEnvironment();
        this._createClouds();
        this._createDrone();
        this.scene.add(this.levelGroup);
    }

    _createSkyDome() {
        const skyGeo = new THREE.SphereGeometry(400, 32, 32);
        const skyMat = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0x3a8fd6) },
                bottomColor: { value: new THREE.Color(0xf5c28a) }
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
                uniform vec3 bottomColor;
                varying vec3 vWorldPos;
                void main() {
                    float h = normalize(vWorldPos).y;
                    gl_FragColor = vec4(mix(bottomColor, topColor, max(h, 0.0)), 1.0);
                }
            `,
            side: THREE.BackSide
        });
        this.scene.add(new THREE.Mesh(skyGeo, skyMat));
    }

    _createClouds() {
        const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
        for (let i = 0; i < 8; i++) {
            const group = new THREE.Group();
            const count = 3 + Math.floor(Math.random() * 3);
            for (let j = 0; j < count; j++) {
                const s = 1.5 + Math.random() * 2.5;
                const sphere = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 8), cloudMat);
                sphere.position.set(j * 2.2 - count, (Math.random() - 0.5) * 1.0, (Math.random() - 0.5) * 1.5);
                sphere.scale.y = 0.5;
                group.add(sphere);
            }
            const angle = Math.random() * Math.PI * 2;
            const dist = 40 + Math.random() * 80;
            group.position.set(Math.cos(angle) * dist, 40 + Math.random() * 20, Math.sin(angle) * dist);
            this.scene.add(group);
            this.clouds.push(group);
        }
    }

    _initLights() {
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa55, 0.6));
        const dir = new THREE.DirectionalLight(0xffffff, 1.0);
        dir.position.set(30, 60, 40);
        dir.castShadow = true;
        dir.shadow.mapSize.set(2048, 2048);
        const sc = dir.shadow.camera;
        sc.near=0.5; sc.far=200; sc.left=-60; sc.right=60; sc.top=60; sc.bottom=-60;
        this.scene.add(dir);
        this.scene.add(new THREE.AmbientLight(0x404060, 0.3));
    }

    _initEnvironment() {
        // 草地
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(300, 300),
            new THREE.MeshStandardMaterial({ color: 0x3a7d2a, roughness: 0.9 })
        );
        ground.rotation.x = -Math.PI/2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // 淡格線
        const grid = new THREE.GridHelper(300, 30, 0x2a6a1a, 0x2a6a1a);
        grid.position.y = 0.01;
        grid.material.opacity = 0.12;
        grid.material.transparent = true;
        this.scene.add(grid);

        this._createLandingPad();
        this._createTrees();
        this._createBuildings();
        this._createFence();
        this._createWindSock();
    }

    _createLandingPad() {
        const pad = new THREE.Mesh(new THREE.CircleGeometry(2, 32),
            new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.8 }));
        pad.rotation.x = -Math.PI/2; pad.position.y = 0.02; pad.receiveShadow = true;
        this.scene.add(pad);

        const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.8, 32),
            new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI/2; ring.position.y = 0.03;
        this.scene.add(ring);

        const hMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const bars = [
            { w:0.15, h:1.2, x:-0.3, z:0 }, { w:0.15, h:1.2, x:0.3, z:0 },
            { w:0.75, h:0.15, x:0, z:0 }
        ];
        bars.forEach(b => {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), hMat);
            m.rotation.x = -Math.PI/2; m.position.set(b.x, 0.04, b.z);
            this.scene.add(m);
        });
    }

    _createTrees() {
        const tGeo = new THREE.CylinderGeometry(0.15, 0.2, 2, 6);
        const tMat = new THREE.MeshStandardMaterial({ color: 0x6b4226 });
        const lMats = [0x2d8a2d, 0x3a9a3a, 0x228822].map(c =>
            new THREE.MeshStandardMaterial({ color: c }));
        const layers = [
            { geo: new THREE.ConeGeometry(1.4, 2.5, 8), yOff: 0 },
            { geo: new THREE.ConeGeometry(1.0, 2.0, 8), yOff: 1.5 },
            { geo: new THREE.ConeGeometry(0.6, 1.5, 8), yOff: 2.7 }
        ];
        for (let i = 0; i < 25; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = 30 + Math.random() * 60;
            const x = Math.cos(a)*d, z = Math.sin(a)*d;
            const s = 0.8 + Math.random() * 0.8;
            const trunk = new THREE.Mesh(tGeo, tMat);
            trunk.position.set(x, s, z); trunk.scale.setScalar(s); trunk.castShadow = true;
            this.scene.add(trunk);
            const mat = lMats[i % 3];
            const baseY = s * 2 + 1.0;
            layers.forEach(l => {
                const leaf = new THREE.Mesh(l.geo, mat);
                leaf.position.set(x, baseY + l.yOff * s, z); leaf.scale.setScalar(s); leaf.castShadow = true;
                this.scene.add(leaf);
            });
        }
    }

    _createBuildings() {
        const winMat = new THREE.MeshBasicMaterial({ color: 0xffffee, side: THREE.DoubleSide });
        const roofMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 });
        [{x:-40,z:-30,w:8,h:6,d:10,c:0x888888},{x:35,z:-25,w:6,h:4,d:8,c:0x999988},{x:-30,z:40,w:10,h:3,d:6,c:0x887766}]
        .forEach(b => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(b.w,b.h,b.d),
                new THREE.MeshStandardMaterial({color:b.c,roughness:0.7}));
            m.position.set(b.x,b.h/2,b.z); m.castShadow=true; m.receiveShadow=true;
            this.scene.add(m);
            // Roof
            const roof = new THREE.Mesh(new THREE.BoxGeometry(b.w+0.4, 0.2, b.d+0.4), roofMat);
            roof.position.set(b.x, b.h+0.1, b.z); roof.castShadow=true;
            this.scene.add(roof);
            // Windows (4 on front face)
            for (let wi = 0; wi < 2; wi++) {
                for (let wj = 0; wj < 2; wj++) {
                    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), winMat);
                    win.position.set(b.x - b.w*0.25 + wi*b.w*0.5, b.h*0.35 + wj*b.h*0.35, b.z + b.d/2 + 0.01);
                    this.scene.add(win);
                }
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
        // Horizontal bars between adjacent posts
        const barH = new THREE.BoxGeometry(4, 0.06, 0.06);
        const barV = new THREE.BoxGeometry(0.06, 0.06, 4);
        for (let i = -20; i < 20; i += 4) {
            const cx = i + 2;
            // top side (z = -20)
            const bt = new THREE.Mesh(barV, barMat); bt.position.set(-20, 1.0, cx); this.scene.add(bt);
            // bottom side (z = 20)
            const bb = new THREE.Mesh(barV, barMat); bb.position.set(20, 1.0, cx); this.scene.add(bb);
            // left side (x = -20)
            const bl = new THREE.Mesh(barH, barMat); bl.position.set(cx, 1.0, -20); this.scene.add(bl);
            // right side (x = 20)
            const br = new THREE.Mesh(barH, barMat); br.position.set(cx, 1.0, 20); this.scene.add(br);
        }
    }

    _createWindSock() {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.06,4,6),
            new THREE.MeshStandardMaterial({color:0xcccccc}));
        pole.position.set(15,2,0); pole.castShadow=true;
        this.scene.add(pole);
        const sock = new THREE.Mesh(new THREE.ConeGeometry(0.3,1.5,8),
            new THREE.MeshStandardMaterial({color:0xff6600}));
        sock.position.set(15.5,3.8,0); sock.rotation.z=-Math.PI/2;
        this.scene.add(sock);
        this.windSock = sock;
    }

    _createDrone() {
        const mat = new THREE.MeshStandardMaterial({color:0x1a1a1a, roughness:0.4});
        const redMat = new THREE.MeshStandardMaterial({color:0xff2200});
        const blueMat = new THREE.MeshStandardMaterial({color:0x0066ff});
        this.droneGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.18,0.04,0.22), mat));

        const aps = [{x:0.18,z:-0.18,a:-Math.PI/4},{x:-0.18,z:-0.18,a:Math.PI/4},
                     {x:0.18,z:0.18,a:Math.PI/4},{x:-0.18,z:0.18,a:-Math.PI/4}];
        const armG = new THREE.BoxGeometry(0.32,0.015,0.03);
        const motG = new THREE.CylinderGeometry(0.025,0.03,0.03,8);
        const propG = new THREE.BoxGeometry(0.24,0.003,0.02);
        const discG = new THREE.CircleGeometry(0.12,12);

        aps.forEach((ap,i) => {
            const arm = new THREE.Mesh(armG, mat);
            arm.position.set(ap.x/2,0.01,ap.z/2); arm.rotation.y=ap.a;
            this.droneGroup.add(arm);
            const motor = new THREE.Mesh(motG, i<2?redMat:blueMat);
            motor.position.set(ap.x,0.03,ap.z);
            this.droneGroup.add(motor);

            const pg = new THREE.Group();
            pg.position.set(ap.x,0.05,ap.z);
            const disc = new THREE.Mesh(discG, new THREE.MeshBasicMaterial({
                color:i<2?0xff4444:0x4444ff, transparent:true, opacity:0, side:THREE.DoubleSide}));
            disc.rotation.x=-Math.PI/2; disc.userData={isDisc:true}; pg.add(disc);
            for(let b=0;b<2;b++){
                const blade = new THREE.Mesh(propG, new THREE.MeshBasicMaterial({color:0x333333,side:THREE.DoubleSide}));
                blade.rotation.y=b*Math.PI/2; blade.userData={isBlade:true}; pg.add(blade);
            }
            pg.userData={dir:(i%2===0)?1:-1};
            this.propellers.push(pg);
            this.droneGroup.add(pg);
        });

        // cam + battery + LED
        const cam = new THREE.Mesh(new THREE.BoxGeometry(0.04,0.04,0.03), new THREE.MeshBasicMaterial({color:0x111111}));
        cam.position.set(0,0.02,-0.13); cam.rotation.x=-0.5; this.droneGroup.add(cam);
        const batt = new THREE.Mesh(new THREE.BoxGeometry(0.08,0.025,0.12), new THREE.MeshStandardMaterial({color:0x444444}));
        batt.position.set(0,-0.02,0); this.droneGroup.add(batt);
        this.ledMesh = new THREE.Mesh(new THREE.SphereGeometry(0.015,4,4), new THREE.MeshBasicMaterial({color:0x00ff00}));
        this.ledMesh.position.set(0,0,0.15); this.droneGroup.add(this.ledMesh);

        const s = CONFIG.droneScale;
        this.droneGroup.scale.set(s,s,s);
        this.droneGroup.traverse(o => { if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
        this.scene.add(this.droneGroup);
    }

    updateDrone(pos, quat, throttle, crashIntensity = 0, armed = false) {
        this.droneGroup.position.copy(pos);
        this.droneGroup.quaternion.copy(quat);
        for(const pg of this.propellers){
            if (armed) {
                // 解鎖時：最低轉速 idle（視覺上略轉），油門越高轉越快
                pg.rotation.y += (0.15 + throttle * 2.5) * pg.userData.dir;
            }
            // 上鎖時螺旋槳完全靜止（rotation 不更新）
            for(const c of pg.children){
                if(c.userData.isDisc) c.material.opacity = armed ? Math.min(0.35, throttle * 0.5) : 0;
                else if(c.userData.isBlade){
                    c.material.opacity = armed ? Math.max(0.1, 1 - throttle * 1.5) : 1;
                    c.material.transparent = true;
                }
            }
        }
        if(this.ledMesh) this.ledMesh.material.color.setHex((Date.now()&256)?0x00ff00:0x002200);

        // Cloud drift
        for (const cloud of this.clouds) {
            cloud.position.x += 0.002;
            if (cloud.position.x > 150) cloud.position.x = -150;
        }

        // Wind sock animation
        if (this.windSock) this.windSock.rotation.z = -Math.PI/2 + Math.sin(Date.now()*0.002)*0.3;

        // LOS 第三人稱 — 飛手站在地面定點看飛機
        this.cameraTarget.lerp(pos, 0.08);
        let camX = 0, camY = 2.5, camZ = 10;

        // Crash shake
        if (crashIntensity > 0.01) {
            camX += (Math.random() - 0.5) * crashIntensity * 0.3;
            camY += (Math.random() - 0.5) * crashIntensity * 0.3;
            camZ += (Math.random() - 0.5) * crashIntensity * 0.3;
        }

        this.camera.position.set(camX, camY, camZ);
        this.camera.lookAt(this.cameraTarget);

        // Crash overlay
        const overlay = document.getElementById('crash-overlay');
        if (overlay) overlay.style.opacity = crashIntensity > 0.01 ? crashIntensity * 0.5 : 0;
    }

    render() { this.renderer.render(this.scene, this.camera); }
}

// Reset camera target (call when switching levels)
GameScene.prototype.resetCamera = function() {
    this.cameraTarget.set(0, 1, 0);
};
