// =====================================================
//  course.js ― スタートからゴールまでのコースを作る
//
//  コースは奥（z がマイナスの方向）へ進んでいく。
//  チェックポイントを通るたびに、後半ほど難しくなる。
//
//   スタート
//    ├ ① 準備運動の足場ジャンプ
//    ├ ② ゆっくり回るハンマー
//   CP1
//    ├ ③ 動く足場
//    ├ ④ 動く壁の橋
//   CP2
//    ├ ⑤ 落ちる床
//    ├ ⑥ 滑る坂道 → 速いハンマー
//   CP3
//    ├ ⑦ 小さな動く足場・落ちる床の一本道・エレベーター
//   ゴール
// =====================================================

// 文字を書いた板を作る（看板・旗に使う）
// 競技場の表示板。暗い地に白の太字、両側にアクセント色の山形（シェブロン）。
//  accent は START／CHECKPOINT／GOAL ごとの色。文字は常に白で視認性を優先する
function makeLabel(text, accent, textColor, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const g = canvas.getContext("2d");
  // 地：マットブラック
  g.fillStyle = "#0b0d11";
  g.fillRect(0, 0, 1024, 256);
  // 両側の山形（進む向きを示す）
  g.fillStyle = accent;
  for (let i = 0; i < 3; i++) {
    [1, -1].forEach(dir => {
      const cx = dir > 0 ? 84 + i * 44 : 940 - i * 44;
      g.beginPath();
      g.moveTo(cx - dir * 22, 68);
      g.lineTo(cx, 128);
      g.lineTo(cx - dir * 22, 188);
      g.lineTo(cx - dir * 6, 188);
      g.lineTo(cx + dir * 16, 128);
      g.lineTo(cx - dir * 6, 68);
      g.closePath();
      g.fill();
    });
  }
  // 文字：明るい白。遠くからでも読めるよう大きく、わずかに字間をあける
  g.fillStyle = textColor || "#ffffff";
  g.font = 'bold 150px "Arial Black", "Arial", sans-serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 512, 134);
  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = LOOK.linear ? THREE.sRGBEncoding : THREE.LinearEncoding;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture })
  );
}


// -----------------------------------------------------
//  アーチ（スタート・チェックポイント・ゴールの門）
// -----------------------------------------------------
class Arch {
  constructor(scene, world, x, groundY, z, width, color, label) {
    this.group = new THREE.Group();
    this.group.position.set(x, groundY, z);
    scene.add(this.group);

    const postH = 4.4;
    // 金属製の競技用ゲート。
    //  シルバーの鉄骨＋濃いスチールの接合部＋明るいボルト＋オレンジ/青のLED。
    //  当たり判定（±0.4m・高さ4.4m）は今までと同じで、通り抜けは変わらない。
    //  部品はすべて素材ごとに1メッシュへ合体するので、描画命令は素材の数だけ。
    const byMat = new Map();
    const put = (mat, part) => {
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat).push(part);
    };
    const STEEL = Mats.gateSteel();
    const DARK = Mats.gateDark();
    const BRIGHT = Mats.gateBright();
    const ORANGE = Mats.ledOrange();
    const BLUE = Mats.ledBlue();
    //  この門だけの色（START/CHECKPOINT/GOAL の区別）。通過すると色が変わる
    const accent = new THREE.MeshBasicMaterial({ color: Mats.C(color) });
    this.material = accent;

    // ---- 柱まわり ----
    const plateGeo = new THREE.BoxGeometry(1.8, 0.22, 1.8);     // ベースプレート
    const shoeGeo = new THREE.BoxGeometry(1.2, 0.55, 1.2);      // 根もとの金具
    const colGeo = new THREE.BoxGeometry(0.8, postH * 0.6, 0.8);
    const colTopGeo = new THREE.BoxGeometry(0.64, postH * 0.44, 0.64);
    const flangeGeo = new THREE.BoxGeometry(1.02, 0.14, 1.02);  // 柱の継ぎ目のつば
    const capGeo = new THREE.BoxGeometry(1.05, 0.26, 1.05);
    const boltGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.18, 8);
    const edgeGeo = new THREE.BoxGeometry(0.86, 0.07, 0.86);    // 柱のエッジ光り
    [-1, 1].forEach(side => {
      const sx = side * width / 2;
      put(BRIGHT, { geo: plateGeo, x: sx, y: 0.11, z: 0 });
      put(DARK, { geo: shoeGeo, x: sx, y: 0.46, z: 0 });
      put(STEEL, { geo: colGeo, x: sx, y: postH * 0.3 + 0.4, z: 0 });
      put(BRIGHT, { geo: flangeGeo, x: sx, y: postH * 0.6 + 0.4, z: 0 });
      put(STEEL, { geo: colTopGeo, x: sx, y: postH * 0.78 + 0.1, z: 0 });
      put(BRIGHT, { geo: capGeo, x: sx, y: postH + 0.13, z: 0 });
      put(BRIGHT, { geo: edgeGeo, x: sx, y: 0.78, z: 0 });
      // ベースプレートのボルト8本
      [[-0.68, -0.68], [0, -0.68], [0.68, -0.68], [-0.68, 0], [0.68, 0],
       [-0.68, 0.68], [0, 0.68], [0.68, 0.68]].forEach(([bx, bz]) => {
        put(BRIGHT, { geo: boltGeo, x: sx + bx, y: 0.29, z: bz });
      });
      // 柱の縦LED：手前と奥の両面にオレンジ、側面に青の補助
      [-1, 1].forEach(f => {
        put(ORANGE, { geo: new THREE.BoxGeometry(0.5, postH * 0.52, 0.06),
                      x: sx, y: postH * 0.46, z: f * 0.43 });
      });
      put(BLUE, { geo: new THREE.BoxGeometry(0.06, postH * 0.3, 0.5),
                  x: sx - side * 0.43, y: postH * 0.3, z: 0 });
      // 根もとの保護材
      put(DARK, { geo: new THREE.BoxGeometry(1.4, 0.64, 1.4), x: sx, y: 0.32, z: 0 });
      // 柱はぶつかる（当たり判定は今までと同じ大きさ）
      const px = x + sx;
      world.colliders.push({
        box: new THREE.Box3(
          new THREE.Vector3(px - 0.4, groundY, z - 0.4),
          new THREE.Vector3(px + 0.4, groundY + postH, z + 0.4)
        ),
        mesh: null,
      });
    });

    // ---- 上を渡す鉄骨トラス ----
    //  スタジアムと同じ部材だが、ゲートはシルバーなので門の合体メッシュに入れる
    const span = width - 1.6;
    const unit = Mats.trussUnit().userData.length;
    const n = Math.max(1, Math.round(span / unit));
    for (let i = 0; i < n; i++) {
      put(STEEL, { geo: Mats.trussUnit(), ry: Math.PI / 2,
                   x: -span / 2 + unit * (i + 0.5), y: postH - 0.5, z: 0 });
    }
    // 桁を柱につなぐ接合金具
    [-1, 1].forEach(side => {
      put(DARK, { geo: new THREE.BoxGeometry(1.1, 1.5, 1.5),
                  x: side * (width / 2 - 0.5), y: postH - 0.5, z: 0 });
    });
    // 桁の前後に横一文字のオレンジLED
    [-1, 1].forEach(f => {
      put(ORANGE, { geo: new THREE.BoxGeometry(span, 0.17, 0.07),
                    x: 0, y: postH - 1.42, z: f * 0.8 });
    });
    // 桁の下に青の補助ライン
    put(BLUE, { geo: new THREE.BoxGeometry(span, 0.07, 0.5),
                x: 0, y: postH - 1.3, z: 0 });

    // ---- 表示板（横桁から独立した1枚のパネル）----
    //  柱とトラスの上に乗せるので、文字に構造物が重ならない。
    //  地はマットブラック、外周はオレンジのLED。
    const panelW = width * 0.55;
    const panelH = 2.2;
    this.panelY = postH + 1.35;        // 下辺がちょうどトラスの上に乗る高さ
    put(Mats.matteBlack(), {
      geo: new THREE.BoxGeometry(panelW, panelH, 0.3), x: 0, y: this.panelY, z: 0,
    });
    // 外周のオレンジLED（上下・左右。両面から見えるよう前後に出す）
    [1, -1].forEach(v => {
      put(ORANGE, { geo: new THREE.BoxGeometry(panelW + 0.34, 0.17, 0.44),
                    x: 0, y: this.panelY + v * (panelH / 2 + 0.08), z: 0 });
    });
    [1, -1].forEach(h => {
      put(ORANGE, { geo: new THREE.BoxGeometry(0.17, panelH + 0.34, 0.44),
                    x: h * (panelW / 2 + 0.08), y: this.panelY, z: 0 });
    });
    // パネルを支える金具
    [-1, 1].forEach(h => {
      put(DARK, { geo: new THREE.BoxGeometry(0.5, 0.5, 0.7),
                  x: h * panelW * 0.3, y: this.panelY - panelH / 2 - 0.1, z: 0 });
    });

    // ---- 横一列のランプ（カウントダウンやゴールで色が変わる）----
    this.lampMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0x222222, emissiveIntensity: 1, roughness: 0.3,
    });
    const lampGeo = new THREE.BoxGeometry(0.5, 0.22, 0.34);
    for (let i = -2; i <= 2; i++) {
      put(this.lampMaterial, {
        geo: lampGeo, x: i * (panelW / 5), y: this.panelY + panelH / 2 + 0.33, z: 0,
      });
    }
    // 柱の上部にこの門の色のLED（通過すると変わる）
    [-1, 1].forEach(side => {
      put(accent, { geo: new THREE.BoxGeometry(0.2, postH * 0.5, 0.2),
                    x: side * (width / 2 - 0.52), y: postH * 0.5, z: 0 });
    });

    // ---- 素材ごとに1枚のメッシュへ合体する ----
    //  影を落とすのは主要な構造だけ（小さな装飾やLEDに影を作らせない）
    byMat.forEach((parts, mat) => {
      const mesh = new THREE.Mesh(Mats.mergeGeos(parts), mat);
      mesh.castShadow = (mat === STEEL || mat === DARK);
      mesh.receiveShadow = (mat === STEEL || mat === DARK);
      this.group.add(mesh);
    });

    // 看板（表と裏の2枚）
    if (label) this.setLabel(label);
  }

  // ランプの色を変える（例：3-2-1 の赤→黄→緑、ゴールの金色）
  setLamp(color, strength) {
    this.lampMaterial.emissive.set(color);
    this.lampMaterial.emissiveIntensity = strength === undefined ? 1 : strength;
  }

  setLabel(label) {
    if (this.labels) this.labels.forEach(l => this.group.remove(l));
    this.labels = [0, Math.PI].map(rot => {
      const l = label();
      l.position.set(0, this.panelY, 0);
      l.rotation.y = rot;
      l.translateZ(0.17);   // マットブラックのパネル面のすぐ前
      this.group.add(l);
      return l;
    });
  }
}

// -----------------------------------------------------
//  チェックポイント
// -----------------------------------------------------
class Checkpoint {
  constructor(scene, world, number, x, groundY, z, width) {
    this.number = number;
    this.spawn = new THREE.Vector3(x, groundY, z - 1.5); // 復活する場所
    this.active = false;
    this.x = x;
    this.y = groundY;
    this.z = z;
    this.width = width;

    this.arch = new Arch(scene, world, x, groundY, z, width, 0xc8c8d8,
      () => makeLabel("CHECKPOINT " + number, "#ff8a24", "#ffffff", 8.0, 1.8));

    // 地面の光る輪
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 1.6, 32),
      new THREE.MeshBasicMaterial({ color: Mats.C(0xffffff), transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(x, groundY + 0.03, z - 1.5);
    scene.add(this.ring);
  }

  // プレイヤーが門をくぐったか
  isPassedBy(player) {
    const p = player.position;
    return Math.abs(p.x - this.x) < this.width / 2 + 1 &&
           p.z < this.z && p.z > this.z - 3 &&
           p.y > this.y - 1 && p.y < this.y + 5;
  }

  activate() {
    this.active = true;
    this.arch.setLamp(0x3ddc84, 1.4); // 門のランプを緑に
    if (this.beacon) this.beacon.material.color.set(0x3ddc84); // 光の柱も緑に
    this.arch.material.color.copy(Mats.C(0x3ddc84)); // 通過＝緑に光る
    this.arch.setLabel(() => makeLabel("CHECKPOINT " + this.number, "#3ddc84", "#ffffff", 8.0, 1.8));
    this.ring.material.color.set(0x3ddc84);
  }

  reset() {
    this.active = false;
    this.arch.setLamp(0x222222, 1);
    if (this.beacon) this.beacon.material.color.set(0xffe45c);
    this.arch.material.color.copy(Mats.C(0xc8c8d8)); // 未通過＝白
    this.arch.setLabel(() => makeLabel("CHECKPOINT " + this.number, "#ff8a24", "#ffffff", 8.0, 1.8));
    this.ring.material.color.set(0xffffff);
  }

  update(dt) {
    this.ring.rotation.z += dt * (this.active ? 2 : 0.5);
  }
}

// -----------------------------------------------------
//  コース全体
// -----------------------------------------------------
const Course = {
  startPoint: new THREE.Vector3(0, 0, 5),
  checkpoints: [],
  goal: null,
  onCheckpoint: null, // チェックポイントを通ったときに呼ぶ関数（main.js で設定）
  onGoal: null,       // ゴールしたときに呼ぶ関数

  build(scene, world) {
    const W = world;
    const O = Obstacles;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);

    // ===== スタート =====
    W.addIsland(scene, 0, 0, 0, 30, 20, 0x7ed957);
    W.addRails(scene, 0, 0, 0, 30, 20, "start");
    this.startArch = new Arch(scene, W, 0, 0, -8, 18, 0xff8a24, () => makeLabel("START", "#ff8a24", "#ffffff", 9.0, 2.0));
    W.addTree(scene, -11, 0, 5);
    W.addTree(scene, 11, 0, 3);
    W.addTree(scene, -12, 0, -4);
    W.addTree(scene, 12, 0, -5);

    // ===== エリア1（難易度B）：だんだん小さくなる足場 → 回るハンマー =====
    //  すき間はすべてダッシュが要る（歩きの限界は平ら 4.40m、+0.8m上りで 4.00m）
    //    スタート島 → A   4.75m 平ら
    //    A → B           4.50m ＋0.8m上り・横1.5m（実距離 4.74m）
    //    B → C           3.75m ＋0.8m上り・横2.5m（実距離 4.51m）
    //    C → ハンマー台   1.50m ＋0.8m上り（ハンマーのタイミング待ちが要る）
    W.addBlock(scene, 0,    0,   -16.5,  10,  1.2, 3.5, 0xff7aa8); // A
    W.addBlock(scene, -1.5, 0.8, -24.25,  8,  1.2, 3,   0xffd23f); // B
    W.addBlock(scene, 1.0,  1.6, -31,     5.5, 1.2, 3,  0x5ccfe6); // C（ここが一番小さい）

    // 回るハンマー（速さ 1.0 → 1.35、うでも長く）
    W.addBlock(scene, 0, 2.4, -39, 16, 1.2, 10, 0xffd23f);
    const hammer1 = O.add(new Hammer(scene, W, V(0, 2.4, -39), 4.8, 1.35, 3.4));

    // ===== CP1 =====
    W.addIsland(scene, 0, 2.4, -50, 24, 10, 0x7ed957);
    W.addRails(scene, 0, 2.4, -50, 24, 10, "sides");
    this.addCheckpoint(scene, W, 1, 0, 2.4, -47, 14);

    // ===== エリア2（難易度B〜C）：小さく速い動く足場4枚 → 幅のせまい動く壁の橋 =====
    //  足場は 4.2 → 3.6m と小さくなり、速さは 1.25 → 1.7 と上がる。
    //  横に動く幅も ±3.5 → ±4.5m に広げたので、ねらう時間が短い。
    const plat1 = O.add(new MovingPlatform(scene, W, V(-4.5, 2.4, -59.5), V(4.5, 2.4, -59.5), 4.2, 1.25, 0x5ccfe6));
    const plat2 = O.add(new MovingPlatform(scene, W, V(4.5, 2.4, -65.5), V(-4.5, 2.4, -65.5), 4.0, 1.4, 0xb48cff));
    const plat3 = O.add(new MovingPlatform(scene, W, V(-4.5, 2.4, -71.5), V(4.5, 2.4, -71.5), 3.8, 1.55, 0xff7aa8));
    const plat4 = O.add(new MovingPlatform(scene, W, V(4.5, 2.4, -77.5), V(-4.5, 2.4, -77.5), 3.6, 1.7, 0xffa94d));

    // 動く壁の橋（幅 14 → 11m、壁の速さ 1.6 → 1.8）
    //  よけられる通路は 9.2m → 6.5m にせまくなる
    W.addBlock(scene, 0, 2.4, -92, 11, 1.2, 22, 0xffd23f);
    W.addRails(scene, 0, 2.4, -92, 11, 22, "sides");
    //  壁は細く（4.0 → 3.0m）・速く（1.6 → 1.8）・振り幅は 3.8m。
    //  細い壁を速く振ることで、よけられる時間だけを短くしている
    const pusher1 = O.add(new Pusher(scene, W, 0, 2.4, -87, 3.8, 1.8, 0, 3));
    const pusher2 = O.add(new Pusher(scene, W, 0, 2.4, -93, 3.8, 1.8, 1.05, 3));
    const pusher3 = O.add(new Pusher(scene, W, 0, 2.4, -99, 3.8, 1.8, 2.1, 3));

    // ===== CP2 =====
    W.addIsland(scene, 0, 2.4, -110, 24, 12, 0x7ed957);
    W.addRails(scene, 0, 2.4, -110, 24, 12, "sides");
    this.addCheckpoint(scene, W, 2, 0, 2.4, -106, 14);
    W.addTree(scene, -9, 2.4, -113);
    W.addTree(scene, 9, 2.4, -112);

    // ===== エリア3（難易度C）：落ちる床の細道 → 速い滑り坂 → 高速ハンマー =====
    //  床は 7列 → 3列（幅 17m → 7.6m）、落ちるまで 0.6 → 0.45 秒。
    //  前半3行と後半2行の間に 2.3m のすき間があり、崩れる足場から跳ぶ必要がある。
    const tileX = [-2.6, 0, 2.6];
    [-119, -121.5, -124].forEach(z => tileX.forEach(x =>
      O.add(new FallingTile(scene, W, x, 2.4, z, 2.4, 0.45))));
    [-128.7, -131.2].forEach(z => tileX.forEach(x =>
      O.add(new FallingTile(scene, W, x, 2.4, z, 2.4, 0.45))));

    // 中継の足場（18×8 → 14×6）
    W.addBlock(scene, 0, 2.4, -137.4, 14, 1.2, 6, 0xffa94d);

    // 滑る坂（幅 16 → 10m、滑りやすさ 16 → 20）。止まれないまま下へ落ちていく
    W.addRamp(scene, 0, 10, -142.4, 2.4, -162.4, -4, 20, 0x9be7ff);

    // 坂の着地点に高速ハンマー（速さ 1.8 → 2.1、うで 5 → 5.5m）
    W.addBlock(scene, 0, -4, -170.4, 16, 1.2, 14, 0xff7aa8);
    //  うでは 5.0m のまま（5.5 にすると危険帯が CP3 島まで届いてしまう）。
    //  難しさは速さ 1.8→2.1 と、頭の長さ 3.6→3.8m で出す
    const hammer2 = O.add(new Hammer(scene, W, V(0, -4, -171), 5.0, 2.1, 3.8));

    // ===== CP3 =====
    W.addIsland(scene, 0, -4, -184, 24, 12, 0x7ed957);
    W.addRails(scene, 0, -4, -184, 24, 12, "sides");
    this.addCheckpoint(scene, W, 3, 0, -4, -180, 14);

    // ===== エリア4（難易度C〜D）：細い桁の動く壁 → 落ちる床の一本道 → 動く足場 =====
    //  幅 10m の桁の上で、逆位相の壁2基をジグザグによける
    W.addBlock(scene, 0, -4, -200, 10, 1.2, 16, 0xff8a3d);
    W.addRails(scene, 0, -4, -200, 10, 16, "sides");
    const pusher4 = O.add(new Pusher(scene, W, 0, -4, -196, 3.2, 1.9, 0, 3));
    const pusher5 = O.add(new Pusher(scene, W, 0, -4, -204, 3.2, 1.9, Math.PI, 3));

    // 落ちる床の一本道（幅 3m・1列だけ）。横によける余地がない
    [-212, -215.2, -218.4, -221.6].forEach(z =>
      O.add(new FallingTile(scene, W, 0, -4, z, 3.0, 0.4)));

    // 動く足場でチェックポイントへ渡る
    const plat5 = O.add(new MovingPlatform(scene, W, V(-4.5, -4, -225.5), V(4.5, -4, -225.5), 3.6, 1.65, 0x5ccfe6));

    // ===== CP4 =====
    W.addIsland(scene, 0, -4, -234, 24, 12, 0x7ed957);
    W.addRails(scene, 0, -4, -234, 24, 12, "sides");
    this.addCheckpoint(scene, W, 4, 0, -4, -230, 14);

    // ===== エリア5（難易度D・競技レベル）=====
    //  小さく速い足場3枚 → ハンマー2基の連続 → 落ちる床 → 最後の大ジャンプ
    //  横に動く速さ＝0.5×移動幅×speed。±5m だと 8.8m/s になり、走る速さより速くて
    //  着地点を読めなくなるので、移動幅を ±3.5m に抑えて速さで難しくする
    const plat6 = O.add(new MovingPlatform(scene, W, V(-3.5, -4, -244), V(3.5, -4, -244), 3.4, 1.75, 0xff7aa8));
    const plat7 = O.add(new MovingPlatform(scene, W, V(3.5, -4, -250), V(-3.5, -4, -250), 3.2, 1.95, 0xb48cff));
    // 上下に動くエレベーター（低いときに乗り、高くなってから降りる）
    const plat8 = O.add(new MovingPlatform(scene, W, V(0, -4, -255.5), V(0, -0.5, -255.5), 3.6, 1.0, 0xffd23f));

    // ハンマー2基が連続する台。間の安全地帯は 3.3m しかない
    W.addBlock(scene, 0, -0.5, -271.5, 13, 1.2, 27, 0xff7aa8);
    const hammer3 = O.add(new Hammer(scene, W, V(0, -0.5, -263), 4.6, 2.3, 3.4));
    const hammer4 = O.add(new Hammer(scene, W, V(0, -0.5, -278), 4.6, 2.0, 3.4));

    // 最後の落ちる床（1列）
    [-288, -291.2].forEach(z =>
      O.add(new FallingTile(scene, W, 0, -0.5, z, 3.0, 0.4)));

    // ===== ゴール（最後は 6.3m の大ジャンプ。2m 下へ跳び下りる）=====
    W.addIsland(scene, 0, -2.5, -308, 32, 18, 0xffd23f);
    W.addRails(scene, 0, -2.5, -308, 32, 18, "goal");
    this.goalArch = new Arch(scene, W, 0, -2.5, -306, 18, 0xffb020, () => makeLabel("GOAL", "#ffb020", "#ffffff", 9.0, 2.0));
    this.goal = { x: 0, y: -2.5, z: -306, width: 18 };
    // ゴールの光の柱は高くする（最後の大ジャンプの着地点が遠くから見える）
    W.addBeacon(scene, -9, -2.5, -306, 0xffe45c, 52);
    W.addBeacon(scene, 9, -2.5, -306, 0xffe45c, 52);
    W.addTree(scene, -12, -2.5, -313);
    W.addTree(scene, 12, -2.5, -313);
    W.addTree(scene, -13, -2.5, -304);
    W.addTree(scene, 13, -2.5, -304);

    // ===== 進む方向の矢印 =====
    //  広い足場の出口に置く。次にどこへ向かうのか迷わないようにするため
    [
      [0, 2.4, -43],      // エリア1 ハンマー台の出口
      [0, 2.4, -53],      // CP1 島の出口（動く足場へ）
      [0, 2.4, -101],     // エリア2 橋の出口
      [0, 2.4, -113],     // CP2 島の出口（落ちる床へ）
      [0, 2.4, -139],     // エリア3 中継台（滑り坂へ）
      [0, -4, -176],      // エリア3 ハンマー台の出口
      [0, -4, -188],      // CP3 島の出口
      [0, -4, -206],      // エリア4 桁の出口（落ちる床の一本道へ）
      [0, -4, -238],      // CP4 島の出口
      [0, -0.5, -283],    // エリア5 ハンマー台の出口
    ].forEach(([x, y, z]) => W.addArrow(scene, x, y, z, 3.4));

    // ===== CPU用の道しるべ =====
    this.buildWaypoints({ hammer1, hammer2, hammer3, hammer4, plat1, plat2, plat3, plat4, plat5, plat6, plat7, plat8, pusher1, pusher2, pusher3, pusher4, pusher5 });
  },

  // -----------------------------------------------------
  //  CPU が順番にめざす「道しるべ」
  //   x, z      … めざす場所
  //   lane      … true ならCPUごとに少し横にずれて走る
  //   careful   … true ならダッシュしない（小さな足場に跳び乗るとき）
  //   follow    … 動く足場の上の点（足場と一緒に動く）
  //   waitUntil … ここで止まって、この条件が true になるまで待つ
  //   radius    … どれくらい近づいたら「着いた」とみなすか
  //   margin    … 少し通り過ぎても、まだこの道しるべを使う距離
  // -----------------------------------------------------
  buildWaypoints(o) {
    const wp = (x, z, opts) => Object.assign({ x: x, z: z, radius: 0.8, margin: 0.6 }, opts || {});
    const onPlatform = (plat, opts) => Object.assign(wp(0, plat.from.z), { follow: plat }, opts || {});
    //  壁が「これから 0.6 秒ずっと safe の位置にいる」ことを確かめる。
    //  しきい値は (π − 2·asin(しきい値/振り幅)) > 速さ×0.6 を満たす必要がある
    const pusherClear = (p, threshold) => () =>
      [0, 0.2, 0.4, 0.6].every(t => Math.abs(p.xAt(t)) > (threshold || 2.9));

    this.waypoints = [
      // エリア1：足場をわたる
      wp(0, -9, { lane: true }),
      wp(0, -16.5),
      wp(-1.5, -24.25),
      // ハンマー①：手前の足場 C で待つ → 柱の近く（安全地帯）→ 出口で待つ → 抜ける
      //   すき間をはさむぶん、入る前の待ち時間は長めにとる
      wp(1.0, -31, { waitUntil: () => o.hammer1.timeUntilHit(0.6, -34.6) > 1.3, radius: 1.0 }),
      wp(1.3, -36.4),
      wp(1.3, -41.6, { waitUntil: () => o.hammer1.timeUntilHit(0.6, -43.6) > 0.9, radius: 0.6 }),
      wp(0, -45.5),
      // エリア2：動く足場4枚（足場が来るタイミングを予想して跳ぶ）
      wp(0, -48, { lane: true }),
      wp(0, -52.5, { waitUntil: () => Math.abs(o.plat1.positionAt(1.1).x) < 0.7 }),
      onPlatform(o.plat1, { careful: true, radius: 1.2,
        waitUntil: () => Math.abs(o.plat2.positionAt(0.9).x - o.plat1.positionAt(0.9).x) < 0.7 }),
      onPlatform(o.plat2, { careful: true, radius: 1.2,
        waitUntil: () => Math.abs(o.plat3.positionAt(0.9).x - o.plat2.positionAt(0.9).x) < 0.7 }),
      onPlatform(o.plat3, { careful: true, radius: 1.2,
        waitUntil: () => Math.abs(o.plat4.positionAt(0.9).x - o.plat3.positionAt(0.9).x) < 0.7 }),
      onPlatform(o.plat4, { careful: true, margin: -0.3 }),
      // 動く壁：壁が離れているときに通る
      wp(0, -84.5, { waitUntil: pusherClear(o.pusher1) }),
      wp(0, -90.5, { waitUntil: pusherClear(o.pusher2) }),
      wp(0, -96.5, { waitUntil: pusherClear(o.pusher3) }),
      wp(0, -102),
      // エリア3：落ちる床の細道（止まらず走り抜ける）
      wp(0, -110, { lane: true }),
      wp(0, -121.5),
      wp(0, -131.2),
      wp(0, -137.4),
      // 滑る坂 → ハンマー②：坂を下りきった所で止まり、回転を見てから入る
      wp(0, -163.5, { radius: 3, margin: 3, waitUntil: () => o.hammer2.timeUntilHit(0.6, -166.0) > 0.8 }),
      wp(1.3, -168.5),
      wp(1.3, -173.5, { waitUntil: () => o.hammer2.timeUntilHit(0.6, -176.0) > 0.8, radius: 0.6 }),
      wp(0, -178.5),
      // エリア4：細い桁の動く壁（逆位相なのでジグザグに抜ける）
      wp(0, -188, { lane: true }),
      wp(0, -194, { waitUntil: pusherClear(o.pusher4, 2.6) }),
      wp(0, -201, { waitUntil: pusherClear(o.pusher5, 2.6) }),
      wp(0, -207),
      // 落ちる床の一本道（幅3m。横にそれると落ちるので careful で中心をねらう）
      wp(0, -212, { careful: true, margin: -0.3 }),
      wp(0, -215.2, { careful: true, margin: -0.3 }),
      wp(0, -218.4, { careful: true, margin: -0.3 }),
      wp(0, -221.6, { careful: true, margin: -0.3,
        waitUntil: () => Math.abs(o.plat5.positionAt(0.8).x) < 0.6 }),
      onPlatform(o.plat5, { careful: true, margin: -0.3 }),
      wp(0, -232, { lane: true }),

      // エリア5：小さく速い足場3枚 → エレベーター
      wp(0, -238, { waitUntil: () => Math.abs(o.plat6.positionAt(1.0).x) < 0.6 }),
      onPlatform(o.plat6, { careful: true, radius: 1.2,
        waitUntil: () => Math.abs(o.plat7.positionAt(0.9).x - o.plat6.positionAt(0.9).x) < 0.7 }),
      onPlatform(o.plat7, { careful: true, radius: 1.2,
        waitUntil: () => Math.abs(o.plat8.positionAt(0.9).x - o.plat7.positionAt(0.9).x) < 0.7
          && o.plat8.positionAt(0.9).y < -3.0 }),
      // 上がりきってから、ハンマー③の手前の帯が空くのを待って降りる
      onPlatform(o.plat8, { careful: true, radius: 1.2,
        waitUntil: () => o.plat8.positionAt(0).y > -1.0 && o.hammer3.timeUntilHit(0.6, -259.5) > 0.7 }),
      // ハンマー③の柱の横（安全地帯）
      wp(1.3, -263, { radius: 1.0,
        waitUntil: () => o.hammer3.timeUntilHit(0.6, -267.5) > 0.75 }),
      // 2基の間の安全地帯（3.3m しかない）
      wp(1.3, -270.5, { radius: 0.8,
        waitUntil: () => o.hammer4.timeUntilHit(0.6, -273.5) > 0.8 }),
      // ハンマー④の柱の横
      wp(1.3, -278, { radius: 1.0,
        waitUntil: () => o.hammer4.timeUntilHit(0.6, -282.5) > 0.8 }),
      wp(0, -284),
      // 最後の落ちる床 → 2m 下へ 6.3m の大ジャンプ
      wp(0, -288, { careful: true, margin: -0.3 }),
      wp(0, -291.2, { careful: true, margin: -0.3 }),
      wp(0, -301),
      wp(0, -311, { lane: true }),
    ];
  },

  addCheckpoint(scene, world, number, x, y, z, width) {
    const cp = new Checkpoint(scene, world, number, x, y, z, width);
    // 門の両わきに光の柱を立てる（通過すると緑に変わる）
    cp.beacon = world.addBeacon(scene, x - width / 2, y, z, 0xffe45c, 30);
    cp.beacon2 = world.addBeacon(scene, x + width / 2, y, z, 0xffe45c, 30);
    if (cp.beacon && cp.beacon2) cp.beacon2.material = cp.beacon.material; // 色を一度に変えるため共有
    this.checkpoints.push(cp);
  },

  // 毎フレーム：みんながチェックポイントとゴールを通ったか調べる
  //   racers … 自分とCPUのリスト（スタート前は空）
  update(dt, racers) {
    for (const cp of this.checkpoints) cp.update(dt);

    for (const racer of racers) {
      for (const cp of this.checkpoints) {
        if (racer.cpIndex >= cp.number || !cp.isPassedBy(racer)) continue;
        racer.cpIndex = cp.number;
        racer.spawnPoint.copy(cp.spawn);             // 落ちたらここから再開
        racer.spawnPoint.x += racer.startOffset.x * 0.6; // 重ならないように少しずらす
        if (racer.isHuman) {
          cp.activate(); // 門の色が変わるのは自分が通ったときだけ
          Sound.checkpoint();
          if (this.onCheckpoint) this.onCheckpoint(cp);
        }
      }

      const p = racer.position;
      const g = this.goal;
      if (!racer.finished && Math.abs(p.x - g.x) < g.width / 2 + 1 && p.z < g.z && p.y > g.y - 1) {
        racer.finished = true;
        if (racer.isHuman) Sound.goal();
        if (this.onGoal) this.onGoal(racer);
      }
    }
  },

  // R キー：最初からやり直す
  restart(racers) {
    this.checkpoints.forEach(cp => cp.reset());
    Obstacles.items.forEach(item => { if (item.reset) item.reset(); });
    for (const racer of racers) {
      racer.cpIndex = 0;
      racer.finished = false;
      racer.finishTime = 0;
      racer.spawnPoint.copy(this.startPoint).add(racer.startOffset); // スタート位置は横に並べる
      racer.respawn(racer.isHuman);
    }
  },
};
