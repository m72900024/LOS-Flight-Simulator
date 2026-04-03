import { CONFIG } from './Config.js';

export class GameScene {
    constructor() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.FogExp2(0xc8e6ff, 0.005);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 500);
        this.camera.position.set(0, 2.5, 10);
        this.cameraTarget = new THREE.Vector3(0, 1, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        this.droneGroup = new THREE.Group();
        this.propellers = [];
        this.levelGroup = new THREE.Group();
        this.ledMesh = null;

        this._initLights();
        this._initEnvironment();
        this._createDrone();
        this.scene.add(this.levelGroup);
    }

    _initLights() {
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa55, 0.6));
        const dir = new THREE.DirectionalLight(0xffffff, 1.0);
        dir.position.set(30, 60, 40);
        dir.castShadow = true;
        dir.shadow.mapSize.set(4096, 4096);
        const sc = dir.shadow.camera;
        sc.near=0.5; sc.far=200; sc.left=-60; sc.right=60; sc.top=60; sc.bottom=-60;
        this.scene.add(dir);
        this.scene.add(new THREE.AmbientLight(0x404060, 0.3));
    }

    _initEnvironment() {
        // 草地
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(300, 300),
            new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: 0.8 })
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
        this._createPilot();
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

    _createPilot() {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.3),
            new THREE.MeshStandardMaterial({ color: 0x2266cc }));
        body.position.set(0, 0.7, 8); body.castShadow = true;
        this.scene.add(body);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8),
            new THREE.MeshStandardMaterial({ color: 0xffcc99 }));
        head.position.set(0, 1.6, 8); head.castShadow = true;
        this.scene.add(head);
    }

    _createTrees() {
        const tGeo = new THREE.CylinderGeometry(0.15, 0.2, 2, 6);
        const tMat = new THREE.MeshStandardMaterial({ color: 0x6b4226 });
        const lGeo = new THREE.ConeGeometry(1.2, 3, 8);
        const lMats = [0x2d8a2d, 0x3a9a3a, 0x228822].map(c =>
            new THREE.MeshStandardMaterial({ color: c }));
        for (let i = 0; i < 25; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = 30 + Math.random() * 60;
            const x = Math.cos(a)*d, z = Math.sin(a)*d;
            const s = 0.8 + Math.random() * 0.8;
            const trunk = new THREE.Mesh(tGeo, tMat);
            trunk.position.set(x, s, z); trunk.scale.setScalar(s); trunk.castShadow = true;
            this.scene.add(trunk);
            const leaf = new THREE.Mesh(lGeo, lMats[i%3]);
            leaf.position.set(x, s*2+1.5, z); leaf.scale.setScalar(s); leaf.castShadow = true;
            this.scene.add(leaf);
        }
    }

    _createBuildings() {
        [{x:-40,z:-30,w:8,h:6,d:10,c:0x888888},{x:35,z:-25,w:6,h:4,d:8,c:0x999988},{x:-30,z:40,w:10,h:3,d:6,c:0x887766}]
        .forEach(b => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(b.w,b.h,b.d),
                new THREE.MeshStandardMaterial({color:b.c,roughness:0.7}));
            m.position.set(b.x,b.h/2,b.z); m.castShadow=true; m.receiveShadow=true;
            this.scene.add(m);
        });
    }

    _createFence() {
        const geo = new THREE.CylinderGeometry(0.05, 0.05, 1.2, 4);
        const mat = new THREE.MeshStandardMaterial({ color: 0x886644 });
        for (let i = -20; i <= 20; i += 4) {
            [[-20,i],[20,i],[i,-20],[i,20]].forEach(([x,z]) => {
                const p = new THREE.Mesh(geo, mat);
                p.position.set(x, 0.6, z); p.castShadow = true;
                this.scene.add(p);
            });
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

    updateDrone(pos, quat, throttle) {
        this.droneGroup.position.copy(pos);
        this.droneGroup.quaternion.copy(quat);
        for(const pg of this.propellers){
            pg.rotation.y += (0.5+throttle*2.0)*pg.userData.dir;
            for(const c of pg.children){
                if(c.userData.isDisc) c.material.opacity=Math.min(0.35,throttle*0.5);
                else if(c.userData.isBlade){c.material.opacity=Math.max(0.1,1-throttle*1.5);c.material.transparent=true;}
            }
        }
        if(this.ledMesh) this.ledMesh.material.color.setHex((Date.now()&256)?0x00ff00:0x002200);

        // LOS 第三人稱 — 飛手站在 z=8 看飛機
        this.cameraTarget.lerp(pos, 0.08);
        this.camera.position.set(0, 2.5, 10);
        this.camera.lookAt(this.cameraTarget);
    }

    render() { this.renderer.render(this.scene, this.camera); }
}
