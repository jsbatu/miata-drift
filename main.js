import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- POST-PROCESSING ---
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';

// --- AYARLAR ---
const MAP_SCALE = 0.01;      
const CAR_SCALE = 2.5;       
const CAMERA_LAG = 0.08;     
const PIXEL_SIZE = 6; 

// --- FİZİK ---
const CAR_SPEED = 0.008;     
const MAX_SPEED = 0.8;       
const FRICTION = 0.98;       
const BRAKE_POWER = 0.04;    
const STEER_SPEED = 0.05;    
const DRIFT_TRACTION = 0.02; 
const GRIP_TRACTION = 0.90;  

const COLLISION_DISTANCE = 1.8; 
const BOUNCE_FACTOR = -0.5;     

const PERMANENT_TIME_SCALE = 0.5; 

// --- SAHNE (AYDINLIK MOD) ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdddddd); 
scene.fog = new THREE.Fog(0xdddddd, 20, 120);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
renderer.domElement.style.imageRendering = 'pixelated'; 
document.body.appendChild(renderer.domElement);

// --- POST-PROCESSING ---
let composer, pixelPass;
function initPostProcessing() {
    composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    pixelPass = new RenderPixelatedPass(PIXEL_SIZE, scene, camera);
    pixelPass.normalEdgeStrength = 0; 
    pixelPass.depthEdgeStrength = 0;
    composer.addPass(pixelPass);
}
initPostProcessing();


// --- IŞIKLAR ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); 
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 1.0); 
sunLight.position.set(50, 100, 50); 
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048; 
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 500;
scene.add(sunLight);

// --- GEZEGEN (AÇIK GRİ) ---
const planetGroup = new THREE.Group();
const planetGeo = new THREE.IcosahedronGeometry(200, 1); 
const planetMat = new THREE.MeshStandardMaterial({ 
    color: 0xcccccc,    
    flatShading: true,  
    roughness: 0.8,
    fog: false          
});
const planetMesh = new THREE.Mesh(planetGeo, planetMat);
planetGroup.add(planetMesh);

const ringGeo = new THREE.RingGeometry(240, 300, 32);
const ringMat = new THREE.MeshBasicMaterial({ 
    color: 0xffffff, 
    side: THREE.DoubleSide, 
    transparent: true, 
    opacity: 0.6,
    fog: false 
});
const ringMesh = new THREE.Mesh(ringGeo, ringMat);
ringMesh.rotation.x = Math.PI / 2; 
ringMesh.rotation.y = -Math.PI / 6;
planetGroup.add(ringMesh);

planetGroup.position.set(0, 100, -600); 
scene.add(planetGroup);


// --- OYUNCU VE PUAN SİSTEMİ ---
let carModel = null;
let collidableObjects = []; 

const player = {
    x: 0, z: 0, speed: 0, angle: 0,
    velocity: new THREE.Vector3(0, 0, 0), steering: 0 
};

let driftScore = 0;
let isDrifting = false;
const uiContainer = document.getElementById('score-container');
const uiCombo = document.getElementById('combo-text');
const uiScore = document.getElementById('score-value');

let timeScale = PERMANENT_TIME_SCALE; 
const keys = { w: false, a: false, s: false, d: false, space: false };
const raycaster = new THREE.Raycaster();

// --- DUMAN SİSTEMİ (BEYAZ) ---
const smokeParticles = []; 
const smokeMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); 

function spawnSmoke(x, z) {
    const size = 0.3 + Math.random() * 0.5; 
    const geometry = new THREE.IcosahedronGeometry(size, 0);
    const mesh = new THREE.Mesh(geometry, smokeMat);
    const jitterX = (Math.random() - 0.5) * 0.7; 
    const jitterY = (Math.random()) * 0.4;       
    const jitterZ = (Math.random() - 0.5) * 0.7; 
    mesh.position.set(x + jitterX, 0.3 + jitterY, z + jitterZ);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    mesh.userData = { life: 1.0 + Math.random() * 0.5 };
    scene.add(mesh);
    smokeParticles.push(mesh);
}

function updateSmoke() {
    for (let i = smokeParticles.length - 1; i >= 0; i--) {
        const p = smokeParticles[i];
        p.position.y += 0.02 * timeScale; 
        p.scale.multiplyScalar(1.01); 
        p.userData.life -= 0.015 * timeScale; 
        if (p.userData.life <= 0) {
            scene.remove(p);
            p.geometry.dispose(); 
            smokeParticles.splice(i, 1);
        }
    }
}

// --- HIZ ÇİZGİLERİ ---
const speedLines = [];
const lineGeo = new THREE.BoxGeometry(0.7, 0.7, 15); 
const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });

function spawnSpeedLine() {
    const mesh = new THREE.Mesh(lineGeo, lineMat);
    const distanceAhead = 80; 
    const spreadX = (Math.random() - 0.5) * 60; 
    const spreadY = (Math.random() - 0.5) * 30; 
    const spawnPos = new THREE.Vector3(spreadX, spreadY, -distanceAhead);
    spawnPos.applyQuaternion(camera.quaternion); 
    spawnPos.add(camera.position); 
    mesh.position.copy(spawnPos);
    mesh.rotation.copy(camera.rotation);
    scene.add(mesh);
    speedLines.push(mesh);
}

function updateSpeedLines() {
    const speedRatio = Math.abs(player.speed) / MAX_SPEED;
    if (speedRatio > 0.3) {
        if (Math.random() < speedRatio * 0.4) {
            spawnSpeedLine();
        }
    }
    for (let i = speedLines.length - 1; i >= 0; i--) {
        const line = speedLines[i];
        const moveSpeed = (1.5 + speedRatio * 3.0) * timeScale;
        line.translateZ(moveSpeed); 
        if (line.position.distanceTo(camera.position) < 5) {
            scene.remove(line);
            line.geometry.dispose();
            speedLines.splice(i, 1);
        }
    }
}

// --- MODEL ---
const loader = new GLTFLoader();

loader.load('assets/map.glb', (gltf) => {
    const map = gltf.scene;
    map.scale.set(MAP_SCALE, MAP_SCALE, MAP_SCALE);
    map.traverse((c) => { 
        if(c.isMesh) { 
            c.receiveShadow = true; 
            collidableObjects.push(c); 
            // HARİTA RENGİ: AÇIK GRİ
            if (c.material) c.material.color.set(0xaaaaaa);
        } 
    });
    scene.add(map);
});

loader.load('assets/miata.glb', (gltf) => {
    carModel = gltf.scene;
    carModel.scale.set(CAR_SCALE, CAR_SCALE, CAR_SCALE); 
    carModel.position.set(0, 0.5, 0);
    
    carModel.traverse((c) => { 
        if (c.isMesh) {
            c.castShadow = true;
            if (c.material) {
                const matName = c.material.name.toLowerCase();
                
                if (matName.includes('tail') || matName.includes('brake') || matName.includes('rear_light')) {
                    // STOP LAMBASI: KIRMIZI
                    c.material.color.set(0xff0000);
                    c.material.emissive = new THREE.Color(0xff0000);
                    c.material.emissiveIntensity = 2; 
                } else if (matName.includes('headlight') || matName.includes('front_light')) {
                    // FARLAR: BEYAZ
                    c.material.color.set(0xffffff);
                    c.material.emissive = new THREE.Color(0xffffff);
                } else {
                    // GÖVDE: AÇIK GRİ / GÜMÜŞ
                    c.material.color.set(0xcccccc);
                }
            }
        } 
    });

    // FAR IŞIKLARI
    const hLeft = new THREE.SpotLight(0xffffff, 5000); 
    hLeft.position.set(0.6, 0.8, 2.0);
    hLeft.target.position.set(0.6, 0, 30); 
    hLeft.distance = 120;
    hLeft.angle = 0.6; 
    hLeft.penumbra = 0.1;
    hLeft.castShadow = true; 
    carModel.add(hLeft); 
    carModel.add(hLeft.target);

    const hRight = new THREE.SpotLight(0xffffff, 5000);
    hRight.position.set(-0.6, 0.8, 2.0);
    hRight.target.position.set(-0.6, 0, 30);
    hRight.distance = 120;
    hRight.angle = 0.6;
    hRight.penumbra = 0.1;
    hRight.castShadow = true;
    carModel.add(hRight); 
    carModel.add(hRight.target);

    // STOP IŞIĞI
    const tailLight = new THREE.PointLight(0xff0000, 20, 10);
    tailLight.position.set(0, 0.8, -2.2);
    carModel.add(tailLight);

    scene.add(carModel);
    document.getElementById('loading').style.display = 'none';
});

// --- KONTROLLER VE AKILLI GİZLEME ---
let gameInteractionStarted = false;
const guideBoss = document.getElementById('boss-key-guide');
const guideControls = document.getElementById('controls-guide');

window.addEventListener('keydown', (e) => {
    // PATRON TUŞU
    if (e.code === 'Escape') {
        window.location.href = 'https://mku.edu.tr/';
        return; 
    }

    const k = e.key.toLowerCase();
    
    // Tuşa basıldığı an öğreticileri gizle
    if (!gameInteractionStarted) {
        if (['w', 'a', 's', 'd', ' ', 'space'].includes(k)) {
            gameInteractionStarted = true;
            if(guideBoss) guideBoss.classList.add('fade-out-now');
            if(guideControls) guideControls.classList.add('fade-out-now');
        }
    }

    if (keys.hasOwnProperty(k)) keys[k] = true;
    if (e.code === 'Space') keys.space = true;
});

window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = false;
    if (e.code === 'Space') keys.space = false;
});

// Alt-Tab koruması
window.addEventListener('blur', () => {
    keys.w = false;
    keys.a = false;
    keys.s = false;
    keys.d = false;
    keys.space = false;
});

// --- ÇARPIŞMA ---
function checkCollisions() {
    if (!carModel || collidableObjects.length === 0) return;
    const directions = [
        new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1), 
        new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(1, 0, 1).normalize(), new THREE.Vector3(-1, 0, 1).normalize(),
        new THREE.Vector3(1, 0, -1).normalize(), new THREE.Vector3(-1, 0, -1).normalize()
    ];
    const carPosition = new THREE.Vector3(player.x, 0.5, player.z); 

    for (let i = 0; i < directions.length; i++) {
        const dir = directions[i].clone();
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.angle);
        raycaster.set(carPosition, dir);
        const intersects = raycaster.intersectObjects(collidableObjects, true);
        if (intersects.length > 0 && intersects[0].distance < COLLISION_DISTANCE) {
            player.speed *= BOUNCE_FACTOR;
            const pushBack = dir.negate().multiplyScalar(0.2);
            player.x += pushBack.x;
            player.z += pushBack.z;
            
            driftScore = 0;
            updateUI(false); 
            
            break; 
        }
    }
}

// --- UI GÜNCELLEME ---
function updateUI(active) {
    if (active) {
        uiContainer.classList.remove('hidden');
        uiContainer.classList.add('visible');
        uiScore.innerText = Math.floor(driftScore);

        if (driftScore < 500) {
            uiCombo.innerText = "DRIFT!";
            uiCombo.className = ""; 
        } else if (driftScore < 1500) {
            uiCombo.innerText = "NICE!";
            uiCombo.className = "shake";
        } else if (driftScore < 3000) {
            uiCombo.innerText = "AWESOME!!";
            uiCombo.className = "shake";
        } else if (driftScore < 5000) {
            uiCombo.innerText = "INSANE!!!";
            uiCombo.className = "madness"; 
        } else {
            uiCombo.innerText = "GODLIKE!!!!";
            uiCombo.className = "madness";
        }

        const scale = 1 + (driftScore / 25000); 
        const rotation = -15 + (player.steering * -15); 
        
        uiContainer.style.transform = `translate(-50%, -50%) scale(${Math.min(scale, 1.5)}) rotate(${rotation}deg)`;

    } else {
        uiContainer.classList.remove('visible');
        uiContainer.classList.add('hidden');
        setTimeout(() => { if (!isDrifting) driftScore = 0; }, 200);
    }
}

// --- FİZİK (SHAKE KALDIRILDI) ---
function updatePhysics() {
    if (!carModel) return;

    timeScale = PERMANENT_TIME_SCALE;

    let targetSteer = 0;
    if (keys.a) targetSteer = 0.04; 
    if (keys.d) targetSteer = -0.04;
    
    player.steering += (targetSteer - player.steering) * STEER_SPEED * timeScale;

    if (keys.w) player.speed += CAR_SPEED * timeScale; 
    else if (keys.s) {
        if (player.speed > 0) player.speed -= BRAKE_POWER * timeScale;
        else player.speed -= CAR_SPEED * timeScale;
    }

    const frictionFactor = 1 - ((1 - FRICTION) * timeScale);
    player.speed *= frictionFactor;
    player.speed = Math.max(Math.min(player.speed, MAX_SPEED), -MAX_SPEED / 2);

    if (Math.abs(player.speed) > 0.01) {
        player.angle += (player.steering * (player.speed * 2.5)) * timeScale; 
    }

    if (keys.space && Math.abs(player.speed) > 0.2 && Math.abs(player.steering) > 0.01) {
        isDrifting = true;
        driftScore += (Math.abs(player.speed) * 10);
        updateUI(true);

        const offsetX = 0.9;  
        const offsetZ = 3.8; 
        const leftSmokePos = new THREE.Vector3(offsetX, 0, offsetZ);
        leftSmokePos.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.angle); 
        leftSmokePos.add(carModel.position); 
        const rightSmokePos = new THREE.Vector3(-offsetX, 0, offsetZ);
        rightSmokePos.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.angle);
        rightSmokePos.add(carModel.position);
        spawnSmoke(leftSmokePos.x, leftSmokePos.z);
        spawnSmoke(rightSmokePos.x, rightSmokePos.z);

    } else {
        isDrifting = false;
        updateUI(false);
    }

    const forwardX = -Math.sin(player.angle);
    const forwardZ = -Math.cos(player.angle);
    const traction = keys.space ? DRIFT_TRACTION : GRIP_TRACTION; 

    const targetVelocityX = forwardX * player.speed;
    const targetVelocityZ = forwardZ * player.speed;

    player.velocity.x += ((targetVelocityX - player.velocity.x) * traction) * timeScale;
    player.velocity.z += ((targetVelocityZ - player.velocity.z) * traction) * timeScale;

    checkCollisions();

    player.x += player.velocity.x * timeScale;
    player.z += player.velocity.z * timeScale;

    carModel.position.x = player.x;
    carModel.position.z = player.z;
    carModel.rotation.y = player.angle + Math.PI;
    carModel.rotation.z = (player.steering * player.speed) * -5; 
    carModel.rotation.x = -player.speed * 0.1;

    // GEZEGEN DÖNSÜN
    if(planetGroup) {
        planetGroup.rotation.y += 0.001 * timeScale;
    }

    const currentCameraLag = CAMERA_LAG * timeScale;
    const idealOffset = new THREE.Vector3(0, 4.0, 8.0); 
    idealOffset.applyMatrix4(new THREE.Matrix4().makeRotationY(player.angle));
    
    const idealPosition = new THREE.Vector3(
        carModel.position.x + idealOffset.x,
        carModel.position.y + idealOffset.y,
        carModel.position.z + idealOffset.z
    );

    // KAMERA TİTREME KODLARI TAMAMEN SİLİNDİ
    // Sadece yumuşak takip var
    camera.position.x += (idealPosition.x - camera.position.x) * currentCameraLag;
    camera.position.z += (idealPosition.z - camera.position.z) * currentCameraLag;
    camera.position.y += (idealPosition.y - camera.position.y) * currentCameraLag;

    camera.lookAt(carModel.position.x, carModel.position.y + 1, carModel.position.z);
}

function animate() {
    requestAnimationFrame(animate);
    updatePhysics();
    updateSmoke();
    updateSpeedLines();
    composer.render(); 
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

animate();