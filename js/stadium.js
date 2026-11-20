// =====================================================
//  stadium.js ― 大型スポーツ競技場をまるごと作る
//
//  コースは「空に浮かぶ障害物コース」のまま。
//  そのまわりを、巨大なスタジアムが囲んでいる。
//
//    屋根・照明塔          y = +52 〜 +78
//    3階スタンド           y = +16 〜 +38
//    2階スタンド           y = -12 〜 +10
//    ★ コース（ここを走る） y =  -5 〜  +4
//    1階スタンド           y = -40 〜 -18
//    競技場の床            y = -48
//
//  ぶつかり判定は一つも作らない（飾りなので、ゲームの動きは変わらない）。
//  観客と座席は InstancedMesh でまとめて描くので、何千人いても
//  描画の命令は数回で済む。
// =====================================================

const STADIUM_CONFIG = {
  // コースを囲む範囲（z は奥がマイナス）
  //  コースは +5 〜 -315（ゴール島の奥まで）。
  //  ここが足りないと、スタジアムの奥の壁がコースの先を隠してしまう
  zFront: 44,
  zBack: -348,
  innerHalfX: 56,   // スタンドの内側のふち（ここから外が観客席）
  floorY: -48,      // 競技場の床の高さ（落下の復活は -30 なので、ここには届かない）

  // 観客席の密度（重いときは seatStep を大きく、crowdFill を小さくする）
  seatStep: 2.0,    // 座席の間かく（m）
  rowsPerTier: 12,  // 1つのスタンドの段数
  crowdFill: 0.55,  // 座席のうち、人が座っている割合

  // スタンド（内側のふちの位置・高さ・1段ごとの奥行きと高さ）
  tiers: [
    { innerX: 56,  baseY: -40, rowDepth: 2.0, rowRise: 1.8, ends: true  },
    { innerX: 83,  baseY: -12, rowDepth: 2.0, rowRise: 1.8, ends: true  },
    { innerX: 110, baseY: 16,  rowDepth: 2.0, rowRise: 1.8, ends: false },
  ],

  // 観客の服の色（段階C）。実際の客席は暗い服が大半なので、
  //  グレー・ネイビーを主にして、明るい色はごく少数の差し色にとどめる。
  //  ここを原色にすると、遠くで1画素未満になったときに紙吹雪に見える
  teamColors: [0x495468, 0x5a6478, 0x6b7486, 0x404a5e, 0x7d8696, 0xb6bcc6],
  // 座席はグレーとネイビーの濃淡だけ
  seatColors: [0x3a455a, 0x424d63, 0x333d4f, 0x4c5870],
  // スタンド前面の壁（コンクリート）
  tierColors: [0x565d68, 0x4f5660, 0x485058],
  // 段のコンクリート
  concrete: 0x6e757e,
  // 手すり
  railColor: 0xa9b1bd,
  // 客席前面の LED リボン
  ledColor: 0x2f7dff,
};

const Stadium = {
  screens: [],   // 大型ビジョン（Phase 7 で中身を書きかえられるように覚えておく）
  banners: [],
  _dummy: null,

  // =====================================================
  //  入口：World から呼ばれる
  // =====================================================
  build(scene, rand, world) {
    this._dummy = new THREE.Object3D();
    // 画質に合わせて、観客の数とスタンドの段数を決める
    const Q = Quality.preset;
    STADIUM_CONFIG.crowdFill = Q.crowdFill;
    STADIUM_CONFIG.seatStep = Q.seatStep;
    this.activeTiers = STADIUM_CONFIG.tiers.slice(0, Q.tiers);

    this.buildFloor(scene);
    this.buildStands(scene, rand);
    this.buildFacade(scene);
    this.buildRoof(scene);
    this.buildLightTowers(scene);
    this.buildScreens(scene);
    this.buildBanners(scene);
    this.buildSafetyFence(scene);
    this.buildCourseGantries(scene, world);
    return this;
  },

  // -----------------------------------------------------
  //  絵を描いたテクスチャを作る小道具
  // -----------------------------------------------------
  canvasTexture(width, height, draw, repeatX) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext("2d"), width, height);
    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = LOOK.linear ? THREE.sRGBEncoding : THREE.LinearEncoding;
    if (repeatX) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, 1);
    }
    return tex;
  },

  // =====================================================
  //  1. 競技場の床（はるか下に見える）
  // =====================================================
  buildFloor(scene) {
    const C = STADIUM_CONFIG;
    const width = C.innerHalfX * 2 + 40;
    const depth = C.zFront - C.zBack + 40;

    // トラックとフィールドの模様を描く
    // 競技場は横 152m × 奥行き 360m。絵も同じ縦横比にしないと引き伸ばされる
    // 近未来アリーナの床：濃紺グレーの樹脂床に、細い区画線・青のレーン線・橙の外周。
    //  緑の芝とトラックだと、暗い鉄骨のスタジアムの中で屋外競技場に見えてしまう
    const tex = this.canvasTexture(448, 1024, (g, w, h) => {
      g.fillStyle = "#151a23";            // 樹脂床
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(120,140,170,0.10)"; // 床パネルの区画
      g.lineWidth = 2;
      for (let x = 0; x <= w; x += 28) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let y = 0; y <= h; y += 28) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.strokeStyle = "#ff8a24";          // 外周の橙ライン
      g.lineWidth = 10;
      g.strokeRect(22, 22, w - 44, h - 44);
      g.strokeStyle = "rgba(47,125,255,0.85)"; // 青のレーン線
      g.lineWidth = 4;
      [0.32, 0.5, 0.68].forEach(t => {
        g.beginPath(); g.moveTo(w * t, 40); g.lineTo(w * t, h - 40); g.stroke();
      });
      g.beginPath();                       // センターマーク
      g.arc(w / 2, h / 2, 54, 0, Math.PI * 2);
      g.stroke();
    });

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      // 樹脂床なので少しだけつやを出す（照明が淡く映る）
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: Mats.metalness(0.15, 0) })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, C.floorY, (C.zFront + C.zBack) / 2);
    scene.add(floor);
  },

  // =====================================================
  //  2. 観客席（構造・座席・観客）
  //     座席と観客は、それぞれ1つの InstancedMesh にまとめる
  // =====================================================
  buildStands(scene, rand) {
    const C = STADIUM_CONFIG;
    const seats = [];     // 近い階：立体の座席を置く  { x, y, z, rotY, section }
    const far = [];       // 遠い階：板の観客にする（三角形を10分の1にできる）
    this._steps = [];     // 段のコンクリート（あとで1つに合体する）
    this._rails = [];     // 手すりの支柱
    this._walls = [];     // 前面の壁
    this._leds = [];      // LEDリボン
    this._railBars = [];  // 手すりの横棒
    this._nosing = [];    // 段鼻（踏み面の前のふち。横のラインが出る）
    this._stairs = [];    // 通路の階段
    this._aisleRails = [];// 通路ぞいの斜めの手すり
    this._ledGlow = [];   // LEDのにじみ
    this._seatBars = [];  // 遠い階の座席（1列ぶんつながった暗い帯）
    this._piers = [];     // 前面の壁の柱（下部のコンクリート構造）

    this.activeTiers.forEach((tier, tierIndex) => {
      tier.index = tierIndex;
      // 1階だけ立体の座席。2階から上は遠いので板にする（LOD）
      const near = tierIndex === 0;
      const step = near ? C.seatStep : C.seatStep * 1.5; // 遠い階は間引いてちらつきを減らす
      const bucket = near ? seats : far;

      // ---- 左右のスタンド ----
      [-1, 1].forEach(side => {
        const count = Math.floor((C.zFront - C.zBack) / step);
        for (let row = 0; row < C.rowsPerTier; row++) {
          const x = side * (tier.innerX + row * tier.rowDepth);
          const y = tier.baseY + row * tier.rowRise;
          for (let i = 0; i < count; i++) {
            const z = C.zBack + 10 + i * step;
            if (z > C.zFront - 10) continue;
            if (this.isAisle(z, C.zBack + 10)) continue; // 通路はあけておく
            bucket.push({ x, y, z, rotY: side > 0 ? -Math.PI / 2 : Math.PI / 2,
                          // 色のまとまりを大きくする＝近くで見たときのノイズが減る
                          section: Math.floor(z / 40) + tierIndex });
          }
        }
        this.buildTierStructure(scene, tier, side, null, near);
      });

      // ---- 前後（スタート裏・ゴール裏）のスタンド ----
      if (!tier.ends) return;
      [1, -1].forEach(end => {
        const zEdge = end > 0 ? C.zFront : C.zBack;
        const count = Math.floor((C.innerHalfX * 2) / step);
        for (let row = 0; row < C.rowsPerTier; row++) {
          const z = zEdge + end * (row * tier.rowDepth + (tier.innerX - C.innerHalfX) * 0.2);
          const y = tier.baseY + row * tier.rowRise;
          for (let i = 0; i < count; i++) {
            const x = -C.innerHalfX + i * step;
            if (this.isAisle(x, -C.innerHalfX)) continue;
            bucket.push({ x, y, z, rotY: end > 0 ? Math.PI : 0,
                          section: Math.floor(x / 40) + tierIndex + 3 });
          }
        }
        this.buildTierStructure(scene, tier, null, end, near);
      });
    });

    this.flushSteps(scene);
    this.placeSeats(scene, seats);
    this.placeCrowd(scene, seats, rand, false);
    this.placeCrowd(scene, far, rand, true);
  },

  // 通路は 32m おき・幅 4m。席の番号ではなく実際の位置で決めるので、
  //  階が違っても（席の間隔が違っても）通路がまっすぐ縦にそろう
  // 配列から色を選ぶ（番号が負でも正しく回る）
  pick(n, len) { return ((Math.round(n) % len) + len) % len; },

  AISLE_SPAN: 32,
  AISLE_HALF: 2,
  isAisle(pos, origin) {
    const t = (((pos - origin) % this.AISLE_SPAN) + this.AISLE_SPAN) % this.AISLE_SPAN;
    return Math.min(t, this.AISLE_SPAN - t) < this.AISLE_HALF;
  },
  // その面にある通路の中心位置を並べる
  aisleCenters(origin, length) {
    const list = [];
    for (let p = origin; p <= origin + length; p += this.AISLE_SPAN) list.push(p);
    return list;
  },

  // =====================================================
  //  スタンド1面ぶんの構造（段・前面の壁・LEDリボン・手すり）
  //   side を渡せば左右、end を渡せば前後
  // =====================================================
  buildTierStructure(scene, tier, side, end, near) {
    const C = STADIUM_CONFIG;
    const zMid = (C.zFront + C.zBack) / 2;
    const zLen = C.zFront - C.zBack;
    const width = C.innerHalfX * 2 + 4;
    const horiz = side !== null;          // 左右のスタンドか
    const zEdge = end > 0 ? C.zFront : C.zBack;
    const sign = horiz ? side : end;
    // その面に沿った「長さ」と、段が伸びる向き
    const runLen = horiz ? zLen : width;

    // ---- 段（踏み面と蹴上げ）を実際の形で作る。平らな斜面より段差が読める ----
    for (let row = 0; row < C.rowsPerTier; row++) {
      const off = row * tier.rowDepth;
      const y = tier.baseY + row * tier.rowRise;
      if (horiz) {
        // 踏み面
        this._steps.push({ w: tier.rowDepth, h: 0.3, d: runLen,
                           x: side * (tier.innerX + off + tier.rowDepth / 2), y: y - 0.15, z: zMid });
        // 蹴上げ
        this._steps.push({ w: 0.3, h: tier.rowRise, d: runLen,
                           x: side * (tier.innerX + off), y: y - tier.rowRise / 2, z: zMid });
        // 段鼻：踏み面の手前のふちだけ明るいコンクリートにする。
        //  段ごとに横のラインが通るので、遠くからでも段差が読める
        this._nosing.push({ w: 0.34, h: 0.36, d: runLen,
                            x: side * (tier.innerX + off + 0.17), y: y - 0.12, z: zMid });
      } else {
        const zBase = zEdge + end * ((tier.innerX - C.innerHalfX) * 0.2);
        this._steps.push({ w: runLen, h: 0.3, d: tier.rowDepth,
                           x: 0, y: y - 0.15, z: zBase + end * (off + tier.rowDepth / 2) });
        this._steps.push({ w: runLen, h: tier.rowRise, d: 0.3,
                           x: 0, y: y - tier.rowRise / 2, z: zBase + end * off });
        this._nosing.push({ w: runLen, h: 0.36, d: 0.34,
                            x: 0, y: y - 0.12, z: zBase + end * (off + 0.17) });
      }
    }

    // ---- 通路（階段と、そのわきの斜めの手すり）----
    //  スタンドを縦に区切る線になるので、建物としての骨格が見えるようになる
    const origin = horiz ? C.zBack + 10 : -C.innerHalfX;
    const zBaseEnd = zEdge + (end || 0) * ((tier.innerX - C.innerHalfX) * 0.2);
    this.aisleCenters(origin, runLen).forEach(p => {
      for (let row = 0; row < C.rowsPerTier; row++) {
        const off = row * tier.rowDepth;
        const y = tier.baseY + row * tier.rowRise;
        // 階段（席の無い帯を段々に埋める）
        if (horiz) {
          this._stairs.push({ w: tier.rowDepth, h: 0.34, d: this.AISLE_HALF * 2,
                              x: side * (tier.innerX + off + tier.rowDepth / 2), y: y - 0.12, z: p });
        } else {
          this._stairs.push({ w: this.AISLE_HALF * 2, h: 0.34, d: tier.rowDepth,
                              x: p, y: y - 0.12, z: zBaseEnd + end * (off + tier.rowDepth / 2) });
        }
      }
      // 斜めの手すり（斜面に沿って1本）。白い斜線が入るのが競技場らしさ
      const depth = C.rowsPerTier * tier.rowDepth;
      const rise = C.rowsPerTier * tier.rowRise;
      const len = Math.hypot(depth, rise);
      const tilt = Math.atan2(rise, depth);
      const cy = tier.baseY + rise / 2 + 0.95;
      if (horiz) {
        this._aisleRails.push({ w: len, h: 0.12, d: 0.12,
                                x: side * (tier.innerX + depth / 2), y: cy, z: p + this.AISLE_HALF,
                                rz: side > 0 ? tilt : -tilt });
      } else {
        this._aisleRails.push({ w: 0.12, h: 0.12, d: len,
                                x: p + this.AISLE_HALF, y: cy,
                                z: zBaseEnd + end * (depth / 2),
                                rx: end > 0 ? -tilt : tilt });
      }
    });

    // ---- 遠い階の座席（段ごとに1本の暗い帯）----
    //  遠い階は1席ずつ置いていないので、そのままだとコンクリートがむき出しになり
    //  「灰色の壁」に見える。実際の客席は座席で埋まっているので、
    //  1列をつながった暗い帯にして埋める。1画素未満の粒が無いのでちらつかない
    if (!near) {
      const segs = [];
      const runStart = horiz ? C.zBack + 10 : -C.innerHalfX;
      const runEnd = runStart + runLen;
      for (let k = -1; ; k++) {
        const a = runStart + k * this.AISLE_SPAN + this.AISLE_HALF;
        const b = runStart + (k + 1) * this.AISLE_SPAN - this.AISLE_HALF;
        if (a > runEnd) break;
        const s0 = Math.max(a, runStart), s1 = Math.min(b, runEnd);
        if (s1 - s0 > 1) segs.push([(s0 + s1) / 2, s1 - s0]);
      }
      for (let row = 0; row < C.rowsPerTier; row++) {
        const off = row * tier.rowDepth;
        const y = tier.baseY + row * tier.rowRise + 0.25;
        segs.forEach(([mid, len]) => {
          if (horiz) {
            this._seatBars.push({ w: tier.rowDepth * 0.72, h: 0.5, d: len,
                                  x: side * (tier.innerX + off + tier.rowDepth * 0.58), y: y, z: mid });
          } else {
            this._seatBars.push({ w: len, h: 0.5, d: tier.rowDepth * 0.72,
                                  x: mid, y: y,
                                  z: zBaseEnd + end * (off + tier.rowDepth * 0.58) });
          }
        });
      }
    }

    // ---- コースから見える前面の壁（コンクリート）----
    //  面ごとにメッシュを作らず、あとで素材ごとに1つへ合体する
    this._walls.push(horiz
      ? { w: 1.2, h: 9, d: zLen, x: side * tier.innerX, y: tier.baseY - 4, z: zMid }
      : { w: width, h: 9, d: 1.2, x: 0, y: tier.baseY - 4, z: zEdge });

    // ---- LEDリボン（前面を走る青い光のライン）。光源は増やさず、発光して見せるだけ ----
    const ledY = tier.baseY - 0.9;
    const ledX = side * (tier.innerX - 0.7);
    const ledZ = zEdge - (end || 0) * 0.7;
    this._leds.push(horiz
      ? { w: 0.25, h: 1.0, d: zLen * 0.98, x: ledX, y: ledY, z: zMid }
      : { w: width * 0.98, h: 1.0, d: 0.25, x: 0, y: ledY, z: ledZ });
    // にじみ（ひとまわり大きい板を加算で重ねる）
    if (Quality.preset.glass) {
      this._ledGlow.push(horiz
        // 高さを 2.6m→1.5m に。加算合成は重なった画素ぶん負荷になるので面積を抑える
        ? { w: 0.1, h: 1.5, d: zLen * 0.98, x: ledX - side * 0.12, y: ledY, z: zMid }
        : { w: width * 0.98, h: 1.5, d: 0.1, x: 0, y: ledY, z: ledZ - (end || 0) * 0.12 });
    }

    // ---- 前面の壁の柱（下部のコンクリート構造）----
    //  8mおきに縦のリブを立てると、ただの板が「建物の壁」に見える
    const pierRun = horiz ? zLen : width;
    const pierN = Math.floor(pierRun / 8);
    for (let i = 0; i <= pierN; i++) {
      const t = -pierRun / 2 + (pierRun * i) / pierN;
      this._piers.push(horiz
        ? { w: 0.5, h: 8.4, d: 1.1, x: side * (tier.innerX - 0.45), y: tier.baseY - 4.2, z: zMid + t }
        : { w: 1.1, h: 8.4, d: 0.5, x: t, y: tier.baseY - 4.2, z: zEdge - (end || 0) * 0.45 });
    }

    // ---- 手すり（前面のふち）----
    const railY = tier.baseY + 0.55;
    //  遠くでも線として見えるよう少し太くし、上下2本にする
    [0.5, 0.18].forEach(dy => {
      this._railBars.push(horiz
        ? { w: 0.16, h: 0.16, d: zLen, x: side * (tier.innerX + 0.1), y: railY + dy, z: zMid }
        : { w: width, h: 0.16, d: 0.16, x: 0, y: railY + dy, z: zEdge + end * 0.1 });
    });
    // 支柱はあとでまとめて1回で描く
    const n = Math.floor(runLen / 4);
    for (let i = 0; i <= n; i++) {
      const t = -runLen / 2 + (runLen * i) / n;
      this._rails.push({
        x: horiz ? side * (tier.innerX + 0.1) : t,
        y: railY + 0.2,
        z: horiz ? zMid + t : zEdge + end * 0.1,
      });
    }
  },

  // LEDリボンの材質（全部で1つを共用）
  ledMaterial() {
    if (!this._ledMat) {
      this._ledMat = new THREE.MeshBasicMaterial({ map: this.ledTexture() });
    }
    return this._ledMat;
  },
  // LEDリボンは広告ではなく「演出照明のライン」にする。
  //  上下が暗く中央が明るい帯にすると、文字を入れなくても光源に見える。
  //  明るさは中央でも #8fc0ff 程度に抑える（白にすると強すぎる）
  ledTexture() {
    if (!this._ledTex) {
      this._ledTex = this.canvasTexture(64, 64, (g, w, h) => {
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0.00, "#071630");
        grad.addColorStop(0.30, "#1c4e9e");
        grad.addColorStop(0.50, "#8fc0ff");   // 中央のいちばん明るい芯
        grad.addColorStop(0.70, "#1c4e9e");
        grad.addColorStop(1.00, "#071630");
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
        // LEDモジュールの切れ目（縦の細い影）
        g.fillStyle = "rgba(0,0,0,0.35)";
        for (let i = 0; i < 8; i++) g.fillRect(i * w / 8, 0, 1.5, h);
      }, 120);
    }
    return this._ledTex;
  },

  // 光のにじみ。加算合成の薄い板を1枚重ねるだけで、器具が光って見える。
  //  重ねるぶん塗る画素が増えるので、LOW では使わない
  ledGlowMaterial() {
    if (!this._ledGlowMat) {
      this._ledGlowMat = new THREE.MeshBasicMaterial({
        color: Mats.C(0x2f7dff), transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
    }
    return this._ledGlowMat;
  },
  railMaterial() {
    if (!this._railMat) {
      this._railMat = new THREE.MeshStandardMaterial({
        color: Mats.C(STADIUM_CONFIG.railColor), roughness: 0.4,
        metalness: Mats.metalness(0.7, 0.25),
      });
    }
    return this._railMat;
  },

  // ---- 段・壁・LED・手すりを、それぞれ1回の描画にまとめる ----
  flushSteps(scene) {
    const C = STADIUM_CONFIG;
    const merge = (parts, mat, shadow) => {
      if (!parts || !parts.length) return;
      const mesh = new THREE.Mesh(Mats.mergeBoxes(parts), mat);
      mesh.receiveShadow = !!shadow;
      scene.add(mesh);
    };
    merge(this._steps, new THREE.MeshStandardMaterial({
      color: Mats.C(C.concrete), roughness: 0.92 }), true);
    merge(this._walls, new THREE.MeshStandardMaterial({
      color: Mats.C(C.tierColors[0]), roughness: 0.88 }), true);
    merge(this._leds, this.ledMaterial(), false);
    merge(this._railBars, this.railMaterial(), false);
    // 段鼻と階段は、段より明るいコンクリート（1つの材質を共用）
    const brightConcrete = new THREE.MeshStandardMaterial({
      color: Mats.C(0x9aa2ac), roughness: 0.9,
    });
    merge(this._nosing, brightConcrete, false);
    merge(this._stairs, brightConcrete, true);
    merge(this._aisleRails, this.railMaterial(), false);
    // 柱は壁より少し暗いコンクリート
    merge(this._piers, new THREE.MeshStandardMaterial({
      color: Mats.C(0x454b55), roughness: 0.9 }), true);
    merge(this._ledGlow, this.ledGlowMaterial(), false);
    // 遠い階の座席。近い階の座席と同じ濃紺にそろえる
    merge(this._seatBars, new THREE.MeshStandardMaterial({
      color: Mats.C(C.seatColors[0]), roughness: 0.68 }), false);
    if (this._rails && this._rails.length) {
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.07, 0.9, 0.07), this.railMaterial(), this._rails.length
      );
      const d = this._dummy;
      this._rails.forEach((p, i) => {
        d.position.set(p.x, p.y, p.z);
        d.rotation.set(0, 0, 0);
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
    }
    this._steps = null;
    this._rails = null;
    this._walls = null;
    this._leds = null;
    this._railBars = null;
    this._nosing = null;
    this._stairs = null;
    this._aisleRails = null;
    this._ledGlow = null;
    this._piers = null;
    this._seatBars = null;
  },

  // --- z の位置でいくつかの固まりに分ける ---
  //  まとめ描画は「全部描く」か「全部描かない」かのどちらかなので、
  //  固まりに分けておくと、画面に入っていない範囲を描かずに済む
  chunk(seats, size) {
    const groups = new Map();
    for (const s of seats) {
      const key = Math.round(s.z / size);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    return [...groups.values()];
  },

  // --- 座席（固まりごとに1回で描く） ---
  placeSeats(scene, seats) {
    const C = STADIUM_CONFIG;
    const geo = new THREE.BoxGeometry(0.85, 0.5, 0.85);
    const mat = new THREE.MeshStandardMaterial({ color: Mats.C(0xffffff), roughness: 0.65 });
    const d = this._dummy;
    const color = new THREE.Color();

    this.chunk(seats, Quality.preset.chunk).forEach(group => {
      const mesh = new THREE.InstancedMesh(geo, mat, group.length);
      group.forEach((s, i) => {
        d.position.set(s.x, s.y + 0.25, s.z);
        d.rotation.set(0, s.rotY, 0);
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
        color.copy(Mats.C(C.seatColors[this.pick(s.section, C.seatColors.length)]));
        mesh.setColorAt(i, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
    });
  },

  // --- 観客（席のうち crowdFill の割合だけ座らせる） ---
  //  あとで上下に動かせるよう、固まりごとに情報を覚えておく
  //  flat:true … 遠い階。立体（20三角形）ではなく板（2三角形）にする。
  //              遠くでは見分けがつかないのに、三角形が10分の1で済む
  placeCrowd(scene, seats, rand, flat) {
    const C = STADIUM_CONFIG;
    if (!seats.length) return;
    const chosen = seats.filter(() => rand() < C.crowdFill);
    const geo = flat
      ? new THREE.PlaneGeometry(0.8, 1.15)
      : new THREE.IcosahedronGeometry(0.42, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: Mats.C(0xffffff), roughness: 0.85, flatShading: !flat,
      side: flat ? THREE.DoubleSide : THREE.FrontSide,
    });
    const d = this._dummy;
    const color = new THREE.Color();
    if (!this.crowdChunks) this.crowdChunks = [];

    this.chunk(chosen, Quality.preset.chunk).forEach(group => {
      const mesh = new THREE.InstancedMesh(geo, mat, group.length);
      const baseY = new Float32Array(group.length);
      const phase = new Float32Array(group.length);
      group.forEach((s, i) => {
        d.position.set(s.x, s.y + (flat ? 0.75 : 0.95), s.z);
        d.rotation.set(0, s.rotY, 0);
        // 立体のときだけ縦に伸ばして人の形に近づける（板はもう縦長）
        d.scale.set(1, flat ? 1 : 1.45, 1);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
        baseY[i] = s.y + (flat ? 0.75 : 0.95);
        // 席の位置で波の位相をずらす → 波がスタンドを流れていくように見える
        phase[i] = s.z * 0.11 + s.y * 0.3 + rand() * 1.2;
        // 区画ごとに色をそろえる。1人ずつ色を散らすと、遠くで紙吹雪に見える。
        //  混ざる割合を 18%→6%、明るさのゆらぎを ±0.18→±0.05 に抑えた
        const base = C.teamColors[this.pick(s.section, C.teamColors.length)];
        color.set(rand() < 0.06 ? C.teamColors[Math.floor(rand() * C.teamColors.length)] : base);
        color.offsetHSL(0, 0, (rand() - 0.5) * 0.05); // 明るさのばらつきは sRGB のうちに付ける
        if (LOOK.linear) color.convertSRGBToLinear();
        mesh.setColorAt(i, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
      this.crowdChunks.push({ mesh: mesh, baseY: baseY, phase: phase });
    });
  },

  // --- 観客を上下に動かす（応援の波） ---
  //  行列をまるごと作り直すと重いので、行列の中の「縦の位置」だけを書きかえる。
  //  さらに、1フレームにつき固まりを1つだけ更新する（4つあるので各15回/秒）。
  _crowdTime: 0,
  _chunkCursor: 0,
  update(dt) {
    this._t = (this._t || 0) + dt;
    this.animateLights();                  // 光の演出（どの画質でも動かす。負荷はほぼゼロ）
    if (!Quality.preset.crowdWave) return; // LOW では観客を動かさない
    if (!this.crowdChunks || !this.crowdChunks.length) return;
    this._crowdTime += dt;
    const chunk = this.crowdChunks[this._chunkCursor % this.crowdChunks.length];
    this._chunkCursor++;
    const arr = chunk.mesh.instanceMatrix.array;
    const t = this._crowdTime * 2.2;
    for (let i = 0; i < chunk.baseY.length; i++) {
      const wave = Math.sin(t - chunk.phase[i]);
      // 波の山のところだけ立ち上がる（ふだんはほぼ動かない）
      arr[i * 16 + 13] = chunk.baseY[i] + (wave > 0.6 ? (wave - 0.6) * 1.1 : 0);
    }
    chunk.mesh.instanceMatrix.needsUpdate = true;
  },

  // =====================================================
  //  3. 外側の外観（建物らしく見せる外壁と柱）
  // =====================================================
  buildFacade(scene) {
    const C = STADIUM_CONFIG;
    const outerX = C.tiers[2].innerX + C.rowsPerTier * C.tiers[2].rowDepth + 6;
    const zLen = C.zFront - C.zBack + 30;
    const zMid = (C.zFront + C.zBack) / 2;
    //  外壁は明るすぎると「灰色の壁」として目立つ。暗いコンクリートにする
    const mat = new THREE.MeshStandardMaterial({ color: Mats.C(0x3f4651), roughness: 0.85 });

    // 外壁（左右・前後）
    [-1, 1].forEach(side => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 96, zLen), mat);
      wall.position.set(side * outerX, C.floorY + 48, zMid);
      scene.add(wall);
    });
    [1, -1].forEach(end => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(outerX * 2 + 3, 96, 3), mat);
      wall.position.set(0, C.floorY + 48, (end > 0 ? C.zFront : C.zBack) + end * 34);
      scene.add(wall);
    });

    // 外壁をささえる柱（まとめて1回で描く）
    const pillarGeo = new THREE.BoxGeometry(2.4, 96, 2.4);
    const pillarMat = new THREE.MeshStandardMaterial({ color: Mats.C(0xaab3c6), roughness: 0.8 });
    const spots = [];
    for (let z = C.zBack - 30; z <= C.zFront + 30; z += 16) {
      spots.push([-outerX, z], [outerX, z]);
    }
    const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, spots.length);
    const d = this._dummy;
    spots.forEach(([x, z], i) => {
      d.position.set(x, C.floorY + 48, z);
      d.rotation.set(0, 0, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      pillars.setMatrixAt(i, d.matrix);
    });
    pillars.instanceMatrix.needsUpdate = true;
    scene.add(pillars);
  },

  // =====================================================
  //  4. 屋根（鉄骨の梁と、半透明の屋根板）
  // =====================================================
  buildRoof(scene) {
    const C = STADIUM_CONFIG;
    const outerX = C.tiers[2].innerX + C.rowsPerTier * C.tiers[2].rowDepth + 6;
    const innerX = 70;           // ここから内側は空いている（空が見える）
    const roofY = 52;
    const zMid = (C.zFront + C.zBack) / 2;
    const zLen = C.zFront - C.zBack + 30;
    const span = outerX - innerX;

    // 半透明の屋根板。LOW では描かない（重なると塗る画素が増えるため）
    if (Quality.preset.glass) {
      const panelMat = new THREE.MeshStandardMaterial({
        color: Mats.C(0xcfe0f5), roughness: 0.3, metalness: Mats.metalness(0.4, 0.1),
        // 箱なので裏面は見えない。DoubleSide だと塗る画素が倍になるのでやめる
        transparent: true, opacity: 0.55, side: THREE.FrontSide,
      });
      [-1, 1].forEach(side => {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(span, 0.5, zLen), panelMat);
        panel.position.set(side * (innerX + span / 2), roofY, zMid);
        scene.add(panel);
      });
      [1, -1].forEach(end => {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(innerX * 2, 0.5, span), panelMat);
        panel.position.set(0, roofY, (end > 0 ? C.zFront : C.zBack) + end * (span / 2 + 2));
        scene.add(panel);
      });
    }

    // 鉄骨の梁（まとめて1回で描く）
    const beamGeo = new THREE.BoxGeometry(span, 1.2, 1.2);
    const beamMat = new THREE.MeshStandardMaterial({ color: Mats.C(0x9fb0c8), roughness: 0.3, metalness: Mats.metalness(0.9, 0.5) });
    const beams = [];
    for (let z = C.zBack - 10; z <= C.zFront + 10; z += 11) {
      beams.push({ x: -(innerX + span / 2), z, rot: 0 });
      beams.push({ x: innerX + span / 2, z, rot: 0 });
    }
    const mesh = new THREE.InstancedMesh(beamGeo, beamMat, beams.length);
    const d = this._dummy;
    beams.forEach((b, i) => {
      d.position.set(b.x, roofY + 1.4, b.z);
      d.rotation.set(0, b.rot, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);

    // 屋根のふちを一周する太い梁
    [-1, 1].forEach(side => {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, zLen), beamMat);
      edge.position.set(side * innerX, roofY + 1, zMid);
      scene.add(edge);
    });
  },

  // =====================================================
  //  5. 照明塔（4すみ）
  // =====================================================
  buildLightTowers(scene) {
    const C = STADIUM_CONFIG;
    const x = C.tiers[2].innerX + 20;
    const mastMat = new THREE.MeshStandardMaterial({ color: Mats.C(0xb9c4d6), roughness: 0.3, metalness: Mats.metalness(0.85, 0.45) });
    const lampGeo = new THREE.BoxGeometry(2.2, 2.2, 0.6);
    const lampMat = new THREE.MeshStandardMaterial({
      color: Mats.C(0xffffff), emissive: Mats.C(0xfff6d8), emissiveIntensity: 1, roughness: 0.3,
    });

    const corners = [[-x, C.zFront - 10], [x, C.zFront - 10], [-x, C.zBack + 10], [x, C.zBack + 10]];
    const lamps = [];

    corners.forEach(([cx, cz]) => {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, 110, 10), mastMat);
      mast.position.set(cx, C.floorY + 55, cz);
      scene.add(mast);

      const head = new THREE.Mesh(new THREE.BoxGeometry(18, 11, 1.6), mastMat);
      head.position.set(cx, 70, cz);
      head.lookAt(0, 0, cz * 0.5);
      scene.add(head);

      // ライトの粒（4×6）
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 6; col++) {
          lamps.push({
            x: cx + (cx > 0 ? -1 : 1) * 1.2,
            y: 70 + (row - 1.5) * 2.6,
            z: cz + (col - 2.5) * 2.8,
            rotY: cx > 0 ? Math.PI / 2 : -Math.PI / 2,
          });
        }
      }
    });

    const mesh = new THREE.InstancedMesh(lampGeo, lampMat, lamps.length);
    const d = this._dummy;
    lamps.forEach((l, i) => {
      d.position.set(l.x, l.y, l.z);
      d.rotation.set(0, l.rotY, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  },

  // =====================================================
  //  6. 大型ビジョンとスコアボード
  //     中身はあとから書きかえられるようにしておく（Stadium.setLive）
  // =====================================================

  // 書きかえられる画面を1枚作る
  liveScreen(w, h, draw) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = LOOK.linear ? THREE.sRGBEncoding : THREE.LinearEncoding;
    const screen = { canvas: canvas, ctx: canvas.getContext("2d"), tex: tex, draw: draw };
    draw(screen.ctx, w, h, null);
    return screen;
  },

  // 画面の下地（黒地＋走査線）
  // 大型ビジョンの下地（放送グラフィック風）：暗い地、上に見出し帯、橙の下線
  screenBase(g, w, h, title) {
    g.fillStyle = "#070a10";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,0.025)";         // 走査線
    for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 2);
    g.fillStyle = "#111826";                          // 見出し帯
    g.fillRect(0, 0, w, 120);
    g.fillStyle = "#ff8a24";                          // 橙の下線
    g.fillRect(0, 120, w, 8);
    g.fillStyle = "#2f7dff";                          // 左端の青いタブ
    g.fillRect(0, 0, 18, 120);
    g.fillStyle = "#ffffff";
    g.font = "bold 72px sans-serif";
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(title, 48, 62);
  },

  // ---- 競技演出：大型ビジョンのイベント表示（3・2・1・GO!・CHECKPOINT・FINISH）----
  //  ゲームの進行は main.js のまま。ここは「見せ方」だけを受け持つ
  flash(text, sub, color, seconds) {
    this._event = { text: text, sub: sub || "", color: color || "#ffffff",
                    until: (this._t || 0) + (seconds || 1.5) };
    this.redraw();
  },
  drawEvent(g, w, h) {
    const e = this._event;
    g.fillStyle = "#05070c";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#ff8a24";                          // 上下の橙の帯
    g.fillRect(0, 0, w, 14);
    g.fillRect(0, h - 14, w, 14);
    g.fillStyle = "#2f7dff";                          // 青の細線
    g.fillRect(0, 22, w, 4);
    g.fillRect(0, h - 26, w, 4);
    g.fillStyle = e.color;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const big = e.text.length <= 4 ? 300 : e.text.length <= 8 ? 180 : 128;
    g.font = "bold " + big + "px sans-serif";
    g.fillText(e.text, w / 2, e.sub ? h * 0.44 : h * 0.52);
    if (e.sub) {
      g.fillStyle = "#c7d2e2";
      g.font = "bold 56px sans-serif";
      g.fillText(e.sub, w / 2, h * 0.8);
    }
  },
  eventActive() {
    return !!(this._event && (this._t || 0) < this._event.until);
  },
  redraw() {
    if (!this.screens) return;
    for (const s of this.screens) {
      if (this.eventActive()) this.drawEvent(s.ctx, s.canvas.width, s.canvas.height);
      else s.draw(s.ctx, s.canvas.width, s.canvas.height, this._lastInfo || null);
      s.tex.needsUpdate = true;
    }
  },

  // ---- 光の演出：LEDリボン・天井照明の明るさを一時的に脈打たせる ----
  //  光源は増やさず、発光材質の明るさだけを変えるので負荷はほぼゼロ
  pulse(strength, seconds, rate) {
    this._pulse = { s: strength, until: (this._t || 0) + seconds, len: seconds, rate: rate || 10 };
  },
  animateLights() {
    const p = this._pulse;
    let k = 1;
    if (p && this._t < p.until) {
      const env = (p.until - this._t) / p.len;          // だんだん弱まる
      k = 1 + p.s * env * (0.55 + 0.45 * Math.sin(this._t * p.rate));
    }
    if (k === this._lastK) return;                       // 変化が無ければ何もしない
    this._lastK = k;
    if (this._ledMat) this._ledMat.color.setScalar(k);
    if (this._ledGlowMat) this._ledGlowMat.opacity = 0.16 * k;
    if (Mats._shared && Mats._shared.lampGlow) Mats._shared.lampGlow.color.copy(Mats.C(0xfff6e0)).multiplyScalar(k);
    if (Mats._shared && Mats._shared.ledOrange) Mats._shared.ledOrange.color.copy(Mats.C(0xff8a24)).multiplyScalar(k);
  },


  buildScreens(scene) {
    const C = STADIUM_CONFIG;
    this.screens = [];

    // 順位表（スタート裏・ゴール裏の大画面）：帯を交互に敷き、自分の行を橙で強調
    const drawRanking = (g, w, h, info) => {
      this.screenBase(g, w, h, "SKY HOP RUN  ·  STANDINGS");
      const rows = (info && info.ranking) || ["1  YOU", "2  ポポ", "3  ルル", "4  ミント"];
      const me = info ? info.rank - 1 : 0;
      rows.slice(0, 4).forEach((r, i) => {
        const y = 150 + i * 88;
        g.fillStyle = i === me ? "rgba(255,138,36,0.92)" : (i % 2 ? "#0d131d" : "#111826");
        g.fillRect(36, y, w - 72, 78);
        g.fillStyle = i === me ? "#0b0d11" : "#ffffff";
        g.font = "bold 54px sans-serif";
        g.textAlign = "left";
        g.textBaseline = "middle";
        g.fillText(r, 70, y + 40);
      });
    };

    // 走行中の情報（左右のサイドビジョン）：タイムを主役に大きく
    const drawLive = (g, w, h, info) => {
      this.screenBase(g, w, h, "LIVE");
      const time = info ? info.time : "00:00.00";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "#ffffff";
      g.font = "bold 150px sans-serif";
      g.fillText(time, w / 2, 250);
      // 下段：順位・チェックポイント・落下を3つの枠に
      const cells = info ? [
        ["RANK", info.rank + " / " + info.total, "#ffe45c"],
        ["CP", info.cp + " / " + info.cpTotal, "#ff8a24"],
        ["FALLS", String(info.falls), "#8fc0ff"],
      ] : [["RANK", "1 / 6", "#ffe45c"], ["CP", "0 / 4", "#ff8a24"], ["FALLS", "0", "#8fc0ff"]];
      const cw = (w - 96) / 3;
      cells.forEach(([label, value, col], i) => {
        const x = 36 + i * (cw + 12);
        g.fillStyle = "#111826";
        g.fillRect(x, 352, cw, 132);
        g.fillStyle = col;
        g.fillRect(x, 352, cw, 6);
        g.fillStyle = "#8a97ab";
        g.font = "bold 34px sans-serif";
        g.fillText(label, x + cw / 2, 392);
        g.fillStyle = "#ffffff";
        g.font = "bold 56px sans-serif";
        g.fillText(value, x + cw / 2, 446);
      });
    };

    const make = (x, y, z, rotY, w, h, screen) => {
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(w + 3, h + 3, 1.4),
        Mats.gateDark()
      );
      frame.position.set(x, y, z);
      frame.rotation.y = rotY;
      scene.add(frame);

      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: screen.tex })
      );
      panel.position.set(x, y, z);
      panel.rotation.y = rotY;
      panel.translateZ(0.9);
      scene.add(panel);
      this.screens.push(screen);
    };

    make(0, 30, C.zBack + 24, 0, 54, 27, this.liveScreen(1024, 512, drawRanking));
    make(0, 30, C.zFront - 24, Math.PI, 54, 27, this.liveScreen(1024, 512, drawRanking));
    [-1, 1].forEach(side => {
      make(side * 60, 24, -150, side > 0 ? -Math.PI / 2 : Math.PI / 2, 40, 20,
        this.liveScreen(1024, 512, drawLive));
    });
  },

  // レース中の情報を全画面に映す（main.js から 1秒に数回だけ呼ぶ）
  setLive(info) {
    this._lastInfo = info;
    this.redraw();
  },

  // =====================================================
  //  7. スポンサー看板（コースに近い、2階スタンドの前）
  // =====================================================
  buildBanners(scene) {
    const C = STADIUM_CONFIG;
    const names = ["HOP CO.", "SKY WORKS", "AIR GEAR", "NIMBUS", "PIXEL LAB", "RUN+"];
    // 実際の競技場の広告板は暗い地に白文字が基本。原色で塗り分けると
    //  暗いスタジアムの中でここだけ浮いて、おもちゃっぽく見える。
    //  地は濃紺とチャコールの2色だけ、差し色はブルーとオレンジに統一する
    const bases = ["#121722", "#1a2130"];
    const accents = ["#2f7dff", "#ff8a24"];

    const tex = this.canvasTexture(2048, 256, (g, w, h) => {
      const each = w / names.length;
      names.forEach((name, i) => {
        g.fillStyle = bases[i % 2];
        g.fillRect(i * each, 0, each, h);
        // 板の下に細いアクセントのライン
        g.fillStyle = accents[i % 2];
        g.fillRect(i * each + 10, h - 16, each - 20, 7);
        // 板と板のすき間
        g.fillStyle = "#05070b";
        g.fillRect(i * each, 0, 5, h);
        g.fillStyle = "#e8edf5";
        g.font = "bold 86px sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(name, i * each + each / 2, h / 2 - 6);
      });
    }, 6);

    const zLen = C.zFront - C.zBack;
    const zMid = (C.zFront + C.zBack) / 2;
    const mat = new THREE.MeshBasicMaterial({ map: tex });

    [-1, 1].forEach(side => {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(zLen, 5), mat);
      board.position.set(side * (C.tiers[1].innerX - 0.8), C.tiers[1].baseY - 3, zMid);
      board.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      scene.add(board);
      this.banners.push(board);
    });
  },

  // =====================================================
  //  8. 安全フェンス（コース側のふち。網の模様）
  // =====================================================
  buildSafetyFence(scene) {
    if (!Quality.preset.glass) return; // LOW では半透明の網を描かない
    const C = STADIUM_CONFIG;
    const tex = this.canvasTexture(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = "rgba(230,240,255,0.85)";
      g.lineWidth = 7;
      for (let i = -h; i < w; i += 26) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
        g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke();
      }
    }, 60);
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(60, 2);

    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false,
    });
    const zLen = C.zFront - C.zBack;
    const zMid = (C.zFront + C.zBack) / 2;

    [-1, 1].forEach(side => {
      const fence = new THREE.Mesh(new THREE.PlaneGeometry(zLen, 10), mat);
      fence.position.set(side * C.innerHalfX, C.tiers[0].baseY + 4, zMid);
      fence.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      scene.add(fence);
    });
  },

  // =====================================================
  //  9. コースの上を通る鉄骨の格子と、たくさんの灯具
  //     （参考イメージの、天井いっぱいのトラスと照明）
  // =====================================================
  buildCourseGantries(scene, world) {
    const C = STADIUM_CONFIG;
    const Q = Quality.preset;
    const y = 30;            // カメラの最高到達点より十分高い
    const halfX = 38;
    const zHead = 40;        // スタート地点の手前まで延ばす（上部の空白を埋める）
    const zTail = C.zBack + 60;

    // ---- コースをまたぐ梁 ----
    const spots = [];
    for (let z = zHead; z > zTail; z -= Q.gantryGap) spots.push(z);
    spots.forEach(z => {
      world.addTrussRun(0, y, z, halfX * 2, "x");
      // 照明は2灯ずつの「バンク」にして、実際の吊り照明らしく並べる
      const xs = Q.lampScale < 1 ? [-24, 0, 24] : [-30, -15, 0, 15, 30];
      xs.forEach(x => {
        world.addLamp(x - 0.7, y - 1.7, z, 1);
        world.addLamp(x + 0.7, y - 1.7, z, 1);
      });
    });

    // ---- 奥行き方向に通す梁。本数を増やして格子に見せる ----
    const zMid = (zHead + zTail) / 2;
    const zLen = zHead - zTail;
    //  本数は負荷と見た目の兼ね合い。実測で HIGH が 35→30fps に落ちたので、
    //  4本＋縦材から 3本に戻した（縦材はほとんど見えないわりに三角形が多い）
    const lines = Q.trussDetail >= 2 ? [-halfX, 0, halfX] : [-halfX, halfX];
    lines.forEach(x => world.addTrussRun(x, y, zMid, zLen, "z"));

    // ---- 観客席の上のリングにも照明を並べる ----
    for (let z = C.zFront - 20; z > C.zBack + 20; z -= 30) {
      [-64, 64].forEach(x => {
        world.addLamp(x, 44, z, 1.4);
        if (Q.lampScale >= 1) world.addLamp(x, 44, z - 12, 1.4);
      });
    }
  },
};
