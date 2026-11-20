// =====================================================
//  world.js ― 3D空間（光・浮島・足場・雲）を作る
// =====================================================

// =====================================================
//  見た目の明るさの調整つまみ（まぶしい・暗いと感じたらここだけ触る）
//   exposure  … 全体の明るさ。大きいほど明るい（白飛びする）
//   sun / hemi / flood … 光の強さ
// =====================================================
const LOOK = {
  // ---- 色の流れ（段階A） ----
  //  linear:true … 書いた色(sRGB) → リニアに変換 → 照明計算 → トーンマッピング
  //                → sRGB で出力。これが物理的に正しい順番。
  //  linear:false … 変換なし（ver15 まで）。白飛びする代わりに原色が鮮やか。
  //  ※ ver12 で「色が褪せた」のは、出力だけ sRGB にして入口の変換を入れな
  //    かったため。入口（Mats.C とテクスチャの encoding）が今回の追加分。
  linear: true,

  // ---- トーンマッピング（★初期候補。画面を見ながら決める）----
  //  "aces"     … 暗部が締まり、明るい所が粘る。目標画像の暗い競技場に合う
  //  "reinhard" … 白飛びしにくいが、全体が灰色に寄りやすい
  //  "none"     … 圧縮なし（＝ver15。白飛びする）
  //  ゲーム中に / キーで切りかえて見比べられる
  tone: "aces",

  // ★初期候補。ゲーム中に , と . で変えられる（localStorage に保存される）
  //  画面で確認して 0.90 に決定（2026-11-20）
  exposure: 0.9,

  // ---- 照明（影を落とす光源は sun の1つだけ。ここは増やさない）----
  sun: 0.75,
  hemi: 0.45,
  flood: 0.1,
  env: 0.75,   // 環境マップの強さ（映りこみと間接光）
};


const World = {
  colliders: [],  // ぶつかる物のリスト（プレイヤーが乗ったり、ぶつかったりする）
  ramps: [],      // 坂道のリスト
  clouds: [],     // 動かす雲
  spinners: [],   // 回る飾り（風車など）
  floaters: [],   // ふわふわ動く飾り（気球・飛行船）
  sun: null,      // 太陽の光（影をつくる）
  spawnPoint: new THREE.Vector3(0, 0, 5), // スタート地点
  time: 0,

  create(scene, renderer) {
    this.scene = scene;
    this._posts = [];   // 柵の支柱（あとでまとめて描く）
    this._truss = [];   // 鉄骨トラス
    this._static = new Map();  // 動かない箱（あとで素材ごと・区間ごとに合体）
    this._lamps = [];   // 灯具
    this.createLights(scene);
    this.createEnvironment(scene, renderer); // 金属を光らせる（素材を作る前に用意する）
    this.createDecorations(scene);
    // コース（足場と障害物）は course.js で作る
    return this;
  },

  // ----- 光 -----
  //  明るさの調整はここだけを触ればよい
  createLights(scene) {
    // 空と競技場の床からのやわらかい光
    //  環境マップが全体の明るさを受け持つので、以前（0.75）より弱くする
    const Q = Quality.preset;
    // 影を切ったぶん暗くならないよう、空からの光を少しだけ足す
    const hemi = new THREE.HemisphereLight(
      Mats.C(0xeaf4ff), Mats.C(0x6b7a63), LOOK.hemi + (Q.shadows ? 0 : 0.12));
    scene.add(hemi);

    // 太陽の光（影をつける唯一の光源。影を作る光は1つだけに保つ）
    const sun = new THREE.DirectionalLight(Mats.C(0xfff2dd), LOOK.sun);
    sun.castShadow = Q.shadows;
    sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
    // 影を映す範囲をせまくすると、同じ解像度でも影がくっきりする
    //  ±45 → ±30（きめ細かさが 2.25 倍）
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02; // 面と光が平行なときの影のちらつきを防ぐ
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    // 照明塔からの光（4すみから弱く照らす。影は落とさないので軽い）
    //  光源が1つ増えるごとに画素ごとの計算が増えるので、画質に応じて数を減らす
    [[-1, 1], [1, 1], [-1, -1], [1, -1]].slice(0, Q.floods).forEach(([sx, sz]) => {
      const flood = new THREE.DirectionalLight(Mats.C(0xfff4e0), LOOK.flood);
      flood.position.set(sx * 120, 70, -116 + sz * 150);
      flood.target.position.set(0, 0, -116);
      scene.add(flood);
      scene.add(flood.target);
    });

    // 遠くをかすませて奥行きを出す（スタンドの奥まで見える距離に置く）
    //  かすみ始めを近くするほど、奥のスタンドを描く量が減る
    scene.fog = new THREE.Fog(0xbcd6ef, Q.fogFar * 0.26, Q.fogFar);
  },

  // ----- 環境マップ（金属に映りこむ景色）-----
  //  r128 では、これが無いと metalness を上げても黒くなるだけで光らない。
  //  6面の絵を自分で描いて、映りこみ用のぼかした画像を作る。
  createEnvironment(scene, renderer) {
    Mats.hasEnv = false;
    if (!Quality.preset.env) return; // LOW では映りこみを使わない
    if (!renderer || typeof THREE.PMREMGenerator !== "function") return;
    try {
      const face = (top, middle, bottom, lamps) => {
        const c = document.createElement("canvas");
        c.width = 128;
        c.height = 128;
        const g = c.getContext("2d");
        const grad = g.createLinearGradient(0, 0, 0, 128);
        grad.addColorStop(0, top);
        grad.addColorStop(0.5, middle);
        grad.addColorStop(1, bottom);
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
        // 環境マップ全体の強さ。1枚の絵を暗くするだけなので、
        // 材質を1つずつ触らずに映りこみと間接光をまとめて調整できる
        if (LOOK.env < 1) {
          g.globalCompositeOperation = "multiply";
          const v = Math.round(LOOK.env * 255);
          g.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
          g.fillRect(0, 0, 128, 128);
          g.globalCompositeOperation = "source-over";
        }
        if (lamps) { // 照明塔の明るい点（金属にきらっと映る）
          g.fillStyle = "#ffffff";
          [24, 64, 104].forEach(x => g.fillRect(x - 7, 16, 14, 9));
        }
        return c;
      };
      // 順番は +X, -X, +Y(上), -Y(下), +Z, -Z
      //  ここを明るくしすぎると、全部の素材が白っぽく持ち上がって色が消える
      const side = () => face("#cfe2f2", "#8396ab", "#333b4a", true);
      const images = [side(), side(),
                      face("#d6e6f5", "#bcd4ea", "#9db8d2", false), // 上＝屋根のすき間の空
                      face("#243026", "#1e3a26", "#15281c", false), // 下＝競技場の芝
                      side(), side()];
      const cube = new THREE.CubeTexture(images);
      // 環境マップの絵も sRGB の色。ここを忘れると映りこみだけ明るさがずれる
      cube.encoding = LOOK.linear ? THREE.sRGBEncoding : THREE.LinearEncoding;
      cube.needsUpdate = true;

      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileCubemapShader();
      scene.environment = pmrem.fromCubemap(cube).texture;
      pmrem.dispose();
      Mats.hasEnv = true;
    } catch (err) {
      // 作れなくてもゲームは動く（金属が少し暗くなるだけ）
      Mats.hasEnv = false;
    }
  },

  // ----- 箱の足場を置く（topY は上の面の高さ） -----
  //  見た目は4つの部品でできている（ぶつかり判定の箱は今までどおり1つだけ）
  //    本体（プラスチック）／下の骨組み（金属）／ふちのゴム／天面の滑り止め
  addBlock(scene, x, topY, z, w, h, d, color, grate) {
    const bodyMat = Mats.body(color);
    const bodyPart = { w: w, h: h, d: d, x: x, y: topY - h / 2, z: z, ur: w / 3, vr: h / 3 };
    let body = null;
    if (!this.addStaticBox(bodyMat, bodyPart, true)) {
      body = new THREE.Mesh(Mats.boxUV(w, h, d, w / 3, h / 3), bodyMat);
      body.position.set(x, topY - h / 2, z);
      body.castShadow = true;
      body.receiveShadow = true;
      scene.add(body);
    }

    // 足場の下の骨組み。大きい足場は鉄骨トラスで支える（参考イメージの構造）
    if (this._truss && w >= 8 && d >= 6) {
      [-1, 1].forEach(side => {
        this.addTrussRun(x + side * (w / 2 - 1.2), topY - h - 0.8, z, d - 1.5, "z");
      });
      this.addTrussRun(x, topY - h - 0.8, z - d / 2 + 1.2, w - 2.4, "x");
      this.addTrussRun(x, topY - h - 0.8, z + d / 2 - 1.2, w - 2.4, "x");
    } else {
      const fp = { w: w * 0.84, h: 0.55, d: d * 0.84, x: x, y: topY - h - 0.22, z: z,
                   ur: w / 3, vr: 0.5 };
      if (!this.addStaticBox(Mats.support(), fp, false)) {
        const frame = new THREE.Mesh(
          Mats.boxUV(w * 0.84, 0.55, d * 0.84, w / 3, 0.5), Mats.support()
        );
        frame.position.set(x, topY - h - 0.22, z);
        scene.add(frame);
      }
    }

    // ふちのゴム（少しだけ天面より高くして、へりに見せる）
    //  ふちの上面は、天面（上面 topY+0.03）より下に置くこと。
    //  上に出ると、1枚の平らな箱が天面を覆い隠してしまう（ver14〜16 の不具合）
    const rp = { w: w + 0.2, h: 0.3, d: d + 0.2, x: x, y: topY - 0.14, z: z };
    if (!this.addStaticBox(Mats.edge(), rp, false)) {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.3, d + 0.2), Mats.edge());
      rim.position.set(x, topY - 0.14, z);
      rim.receiveShadow = true;
      scene.add(rim);
    }

    // 天面の滑り止め（内側に一回り小さく）
    const inset = Math.min(0.5, Math.min(w, d) * 0.12);
    //  歩く面はエリア共通のダークグレー（段階B）。
    //  grate を指定した足場だけ金属グレーチングにする
    const deckMat = grate ? Mats.grating() : Mats.deck();
    const dp = { w: w - inset * 2, h: 0.2, d: d - inset * 2, x: x, y: topY - 0.07, z: z,
                 ur: w / 2, vr: d / 2 };
    if (!this.addStaticBox(deckMat, dp, false)) {
      const deck = new THREE.Mesh(
        Mats.boxUV(w - inset * 2, 0.2, d - inset * 2, w / 2, d / 2), deckMat
      );
      deck.position.set(x, topY - 0.07, z);
      deck.receiveShadow = true;
      scene.add(deck);
    }

    //  エリア色の帯。天面が共通色になったぶん、ここで足場を見分ける。
    //  横から見える位置（安全縁のすぐ下）に細く回す
    const ap = { w: w + 0.24, h: 0.16, d: d + 0.24, x: x, y: topY - 0.40, z: z };
    if (!this.addStaticBox(Mats.accent(color), ap, false)) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(ap.w, ap.h, ap.d), Mats.accent(color));
      band.position.set(x, ap.y, z);
      scene.add(band);
    }

    // ぶつかり判定用の箱（最小の角と最大の角）― ここは今までと同じ
    this.colliders.push({
      box: new THREE.Box3(
        new THREE.Vector3(x - w / 2, topY - h, z - d / 2),
        new THREE.Vector3(x + w / 2, topY, z + d / 2)
      ),
      mesh: body,
    });
    return body;
  },

  // ----- 坂道（奥＝z が小さい方へ向かって上る・下る） -----
  //   zNear・yNear：手前のはしの位置と高さ
  //   zFar・yFar  ：奥のはしの位置と高さ
  //   slide       ：坂の下へ引っぱられる強さ（大きいほどよく滑る）
  addRamp(scene, x, width, zNear, yNear, zFar, yFar, slide, color) {
    const dz = zNear - zFar;
    const dy = yNear - yFar;
    const length = Math.hypot(dz, dy);
    const thick = 0.6;
    const angle = -Math.asin(dy / length);

    // すべり台の面（矢印模様つき。つるつるのプラスチック）
    const mesh = new THREE.Mesh(
      // 矢印が坂を下る向き（奥）を指すように、縦のUVを反転させる
      Mats.boxUV(width, thick, length, width / 4, -length / 4), Mats.slide(color)
    );
    mesh.rotation.x = angle;
    // 上の面がちょうど坂の高さに来るように、厚みの半分だけ下げる
    const normalY = Math.cos(angle);
    const normalZ = Math.sin(angle);
    mesh.position.set(
      x,
      (yNear + yFar) / 2 - normalY * thick / 2,
      (zNear + zFar) / 2 - normalZ * thick / 2
    );
    mesh.receiveShadow = true;
    scene.add(mesh);

    // 両わきの立ち上がり（すべり台のふち。ぶつかり判定は付けない）
    [-1, 1].forEach(side => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, length), Mats.rubber());
      wall.position.set(side * (width / 2 - 0.25), thick / 2 + 0.4, 0);
      mesh.add(wall);
    });
    // 裏の骨組み
    const under = new THREE.Mesh(new THREE.BoxGeometry(width * 0.7, 0.45, length), Mats.support());
    under.position.set(0, -thick / 2 - 0.22, 0);
    mesh.add(under);

    const ramp = {
      minX: x - width / 2,
      maxX: x + width / 2,
      minZ: zFar,
      maxZ: zNear,
      slide: slide,
      downhillZ: yFar < yNear ? -1 : 1, // 坂の下はどっち向きか
      heightAt(z) {
        const t = (zNear - z) / (zNear - zFar);
        return yNear + (yFar - yNear) * t;
      },
    };
    this.ramps.push(ramp);
    return ramp;
  },

  // ----- 足場のふちの柵（落ちにくくする＋競技場らしく見せる） -----
  //  mode："sides" … 左右だけ / "start" … 前以外の3辺 / "goal" … 手前以外の3辺
  //  支柱は数が多いので、あとで InstancedMesh にまとめる（_posts にためておく）
  addRails(scene, x, topY, z, w, d, mode) {
    const colors = [0xff5fa2, 0xffffff];
    const h = 0.7;
    const rail = (cx, cz, len, alongX) => {
      // 手すり本体（金属）
      const rp = alongX ? { w: len, h: 0.25, d: 0.3 } : { w: 0.3, h: 0.25, d: len };
      rp.x = cx; rp.y = topY + h; rp.z = cz;
      if (!this.addStaticBox(Mats.metal(), rp, true)) {
        const m = new THREE.Mesh(
          alongX ? new THREE.BoxGeometry(len, 0.25, 0.3) : new THREE.BoxGeometry(0.3, 0.25, len),
          Mats.metal());
        m.position.set(cx, topY + h, cz);
        m.castShadow = true;
        scene.add(m);
      }
      // 足もとの蹴り板（ゴム）
      const kp = alongX ? { w: len, h: 0.3, d: 0.16 } : { w: 0.16, h: 0.3, d: len };
      kp.x = cx; kp.y = topY + 0.15; kp.z = cz;
      if (!this.addStaticBox(Mats.rubber(), kp, false)) {
        const kick = new THREE.Mesh(
          alongX ? new THREE.BoxGeometry(len, 0.3, 0.16) : new THREE.BoxGeometry(0.16, 0.3, len),
          Mats.rubber());
        kick.position.set(cx, topY + 0.15, cz);
        scene.add(kick);
      }
      // ぶつかり判定（柵の高さまで）― ここは今までと同じ
      const hx = alongX ? len / 2 : 0.2;
      const hz = alongX ? 0.2 : len / 2;
      this.colliders.push({
        box: new THREE.Box3(new THREE.Vector3(cx - hx, topY, cz - hz), new THREE.Vector3(cx + hx, topY + h + 0.1, cz + hz)),
        mesh: null,
      });
      const n = Math.max(2, Math.round(len / 2.5));
      for (let i = 0; i <= n; i++) {
        const t = -len / 2 + (len * i) / n;
        this._posts.push({
          x: alongX ? cx + t : cx,
          y: topY + h / 2,
          z: alongX ? cz : cz + t,
          color: colors[i % 2],
        });
      }
    };
    const hw = w / 2 - 0.2;
    const hd = d / 2 - 0.2;
    rail(x - hw, z, d - 0.4, false); // 左
    rail(x + hw, z, d - 0.4, false); // 右
    if (mode === "start") rail(x, z + hd, w - 0.4, true); // スタート島の後ろ
    if (mode === "goal") rail(x, z - hd, w - 0.4, true);  // ゴール島の奥
  },

  // ----- 大きな足場（上が競技用デッキ ＋ 下に支柱のポッド） -----
  addIsland(scene, x, topY, z, w, d, color, grate) {
    this.addBlock(scene, x, topY, z, w, 1.2, d, color, grate);

    // 下にぶら下がる支持ポッド（金属）
    const podH = Math.max(w, d) * 0.55;
    const pod = new THREE.Mesh(
      new THREE.ConeGeometry(w / Math.SQRT2, podH, 8),
      Mats.support()
    );
    pod.rotation.y = Math.PI / 4; // 八角すいの向きを箱にそろえる
    pod.rotation.x = Math.PI;     // 下向きにする
    pod.scale.z = d / w;
    pod.position.set(x, topY - 1.95 - podH / 2, z);
    scene.add(pod);

    // 根もとの補強リング
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(Math.min(w, d) * 0.44, 0.22, 6, 18),
      Mats.metal()
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, topY - 2.3, z);
    scene.add(ring);
  },

  // ----- 進む方向を示す矢印（床に貼る。光の影響を受けないので必ず見える）-----
  addArrow(scene, x, topY, z, size) {
    const w = size || 4;
    if (!this._arrowMat) {
      this._arrowMat = new THREE.MeshBasicMaterial({
        map: Mats.arrow(), transparent: true, opacity: 0.9, depthWrite: false,
      });
    }
    const geo = new THREE.PlaneGeometry(w, w * 1.6);
    if (this.addStaticGeo(this._arrowMat,
          { geo: geo, x: x, y: topY + 0.06, z: z, rx: -Math.PI / 2 }, false)) {
      return;
    }
    const mesh = new THREE.Mesh(geo, this._arrowMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, topY + 0.06, z);
    scene.add(mesh);
    return mesh;
  },

  // ----- 動かない箱を1つ、合体待ちのリストに入れる -----
  //   同じ素材・同じ区間（z 方向 40m ごと）の箱は1つのメッシュにまとまる。
  //   区間で分けておくと、画面外の区間はカリングで描かれずに済む。
  addStaticGeo(mat, part, cast) {
    if (!this._static) return false;   // もう合体し終わっている
    const key = mat.uuid + "|" + Math.floor(part.z / 40) + "|" + (cast ? 1 : 0);
    let e = this._static.get(key);
    if (!e) {
      e = { mat: mat, cast: !!cast, parts: [] };
      this._static.set(key, e);
    }
    e.parts.push(part);
    return true;
  },

  // 箱の場合の簡単版（寸法を渡せば箱を作って合体待ちに入れる）
  addStaticBox(mat, part, cast) {
    if (!this._static) return false;
    const q = Object.assign({}, part);
    q.geo = new THREE.BoxGeometry(part.w, part.h, part.d);
    return this.addStaticGeo(mat, q, cast);
  },

  // ----- ためた箱を、素材ごと・区間ごとに1メッシュへ合体する -----
  flushStatic() {
    const map = this._static;
    this._static = null;
    map.forEach(e => {
      const mesh = new THREE.Mesh(Mats.mergeGeos(e.parts), e.mat);
      mesh.castShadow = e.cast;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    });
  },

  // ----- 鉄骨トラスを1区間ぶん置く（向きは axis で決める）-----
  //   axis "x" 横向き / "y" 縦向き / "z" 奥行き向き
  addTrussRun(x, y, z, length, axis) {
    const unit = 4;
    const n = Math.max(1, Math.round(length / unit));
    for (let i = 0; i < n; i++) {
      const t = -length / 2 + unit * (i + 0.5);
      if (axis === "x") this._truss.push({ x: x + t, y: y, z: z, ry: Math.PI / 2, rx: 0 });
      else if (axis === "y") this._truss.push({ x: x, y: y + t, z: z, ry: 0, rx: Math.PI / 2 });
      else this._truss.push({ x: x, y: y, z: z + t, ry: 0, rx: 0 });
    }
  },

  // ----- 灯具（光って見えるだけの板。光源は増えない）-----
  addLamp(x, y, z, size) {
    this._lamps.push({ x: x, y: y, z: z, s: size || 1 });
  },

  // ----- ためたトラスと灯具を、それぞれ描画命令1回にまとめる -----
  flushStructures() {
    const truss = this._truss;
    const lamps = this._lamps;
    this._truss = null;
    this._lamps = null;
    const d = new THREE.Object3D();

    if (truss && truss.length) {
      const mesh = new THREE.InstancedMesh(Mats.trussUnit(), Mats.steel(), truss.length);
      truss.forEach((t, i) => {
        d.position.set(t.x, t.y, t.z);
        d.rotation.set(t.rx, t.ry, 0);
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
    }

    // 照明器具は「暗い筐体」＋「光るレンズ」の2つ重ねにすると、
    //  ただの光る玉ではなく器具に見える。どちらも描画命令は1回ずつ
    if (lamps && lamps.length) {
      const bodyMesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1.0, 0.55, 1.0), Mats.lampBody(), lamps.length
      );
      const lensMesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.8, 0.14, 0.8), Mats.lampGlow(), lamps.length
      );
      lamps.forEach((l, i) => {
        d.rotation.set(0, 0, 0);
        d.scale.set(l.s, l.s, l.s);
        d.position.set(l.x, l.y, l.z);
        d.updateMatrix();
        bodyMesh.setMatrixAt(i, d.matrix);
        d.position.set(l.x, l.y - 0.33 * l.s, l.z);   // レンズは筐体の下面
        d.updateMatrix();
        lensMesh.setMatrixAt(i, d.matrix);
      });
      bodyMesh.instanceMatrix.needsUpdate = true;
      lensMesh.instanceMatrix.needsUpdate = true;
      this.scene.add(bodyMesh, lensMesh);
    }
  },

  // ----- 光の柱（遠くからでも目的地が分かる目印）-----
  addBeacon(scene, x, topY, z, color, height) {
    if (!Quality.preset.glass) return null; // LOW では半透明を描かない
    const h = height || 34;
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.9, h, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: Mats.C(color), transparent: true, opacity: 0.22,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    mesh.position.set(x, topY + h / 2, z);
    scene.add(mesh);
    return mesh;
  },

  // ----- コースぞいの飾りポール（ぶつかり判定は今までの木と同じ大きさ） -----
  addTree(scene, x, groundY, z) {
    // 旗の材質は本数ぶん作らずに1つ共用する（合体できるようになる）
    if (!this._flagMat) {
      this._flagMat = new THREE.MeshStandardMaterial({
        color: Mats.C(0xffd23f), roughness: 0.6, side: THREE.DoubleSide,
      });
    }
    const poleGeo = new THREE.CylinderGeometry(0.16, 0.2, 2.6, 10);
    const padGeo = new THREE.CylinderGeometry(0.34, 0.4, 1.3, 10);
    const flagGeo = new THREE.ConeGeometry(0.42, 1.0, 3);
    const parts = [
      [Mats.metal(), { geo: poleGeo, x: x, y: groundY + 1.3, z: z }, true],
      [Mats.rubber(), { geo: padGeo, x: x, y: groundY + 0.65, z: z }, true],
      [this._flagMat, { geo: flagGeo, x: x + 0.42, y: groundY + 2.5, z: z, rz: -Math.PI / 2 }, false],
    ];
    parts.forEach(([mat, part, cast]) => {
      if (!this.addStaticGeo(mat, part, cast)) {
        const m = new THREE.Mesh(part.geo, mat);
        m.rotation.z = part.rz || 0;
        m.position.set(part.x, part.y, part.z);
        m.castShadow = cast;
        scene.add(m);
      }
    });

    // ぶつかり判定 ― ここは今までと同じ
    this.colliders.push({
      box: new THREE.Box3(
        new THREE.Vector3(x - 0.3, groundY, z - 0.3),
        new THREE.Vector3(x + 0.3, groundY + 1.4, z + 0.3)
      ),
      mesh: null,
    });
  },

  // ----- ためておいた柵の支柱を、1回の描画にまとめる -----
  //  （コースが全部できてから、最初のフレームで1度だけ呼ばれる）
  flushPosts() {
    const data = this._posts;
    this._posts = null;
    if (!data || !data.length) return;

    const geo = new THREE.CylinderGeometry(0.18, 0.18, 0.7, 10);
    const mat = new THREE.MeshStandardMaterial({ color: Mats.C(0xffffff), roughness: 0.42, metalness: 0.25 });
    const mesh = new THREE.InstancedMesh(geo, mat, data.length);
    const d = new THREE.Object3D();
    const color = new THREE.Color();
    data.forEach((p, i) => {
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(0, 0, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      color.copy(Mats.C(p.color));
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.scene.add(mesh);
  },

  // ----- 飾り（スタジアムと、屋根の上に見える雲。ぶつからない） -----
  createDecorations(scene) {
    // 毎回同じ配置になるように、決まった順番の乱数を使う
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };

    // 屋根は中央が空いているので、その上に空と雲が見える
    const cloudMat = new THREE.MeshStandardMaterial({
      color: Mats.C(0xffffff), emissive: Mats.C(0x333344), roughness: 1, flatShading: true,
    });
    const cloudGeo = [1.6, 2.2, 2.9].map(r => new THREE.IcosahedronGeometry(r, 0));
    for (let i = 0; i < Quality.preset.clouds; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(rand() * 3);
      // 1つの雲のかたまりは一体で動くので、合体して1メッシュにする
      const parts = [];
      for (let j = 0; j < puffs; j++) {
        parts.push({
          geo: cloudGeo[Math.floor(rand() * 3)],
          x: j * 2.4 - puffs, y: rand() * 1.2, z: rand() * 1.5,
        });
      }
      cloud.add(new THREE.Mesh(Mats.mergeGeos(parts), cloudMat));
      cloud.scale.setScalar(2.2 + rand() * 1.8);
      const side = rand() < 0.5 ? -1 : 1;
      cloud.position.set(side * rand() * 90, 95 + rand() * 60, 30 - rand() * 320);
      cloud.userData.baseY = cloud.position.y;
      cloud.userData.offset = rand() * 10;
      scene.add(cloud);
      this.clouds.push(cloud);
    }

    // 競技場そのもの（観客席・屋根・照明塔・大型ビジョン）は stadium.js が作る
    Stadium.build(scene, rand, this);
  },

  // ----- (x, z) の真下にある足場の高さ（maxY より上の足場は無視）。なければ null -----
  // CPU が「この先に足場があるか」を調べるのに使う
  groundHeightAt(x, z, maxY) {
    let best = null;
    for (const c of this.colliders) {
      if (c.disabled) continue;
      const b = c.box;
      if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && b.max.y <= maxY) {
        if (best === null || b.max.y > best) best = b.max.y;
      }
    }
    for (const r of this.ramps) {
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
        const y = r.heightAt(z);
        if (y <= maxY && (best === null || y > best)) best = y;
      }
    }
    return best;
  },

  // ----- 毎フレームの更新（雲をゆらゆら動かす） -----
  update(dt) {
    if (this._posts) this.flushPosts();       // コースができた次のフレームで1度だけ
    if (this._truss) this.flushStructures();  // 鉄骨と灯具も同じタイミングで
    if (this._static) this.flushStatic();     // 動かない足場をまとめる
    this.time += dt;
    Stadium.update(dt); // 観客の動き
    for (const sp of this.spinners) sp.obj.rotation.z += sp.speed * dt;
    for (const f of this.floaters) {
      f.obj.position.y = f.baseY + Math.sin(this.time * 0.4 + f.offset) * 1.5;
      if (f.drift) {
        f.obj.position.x += f.drift * dt;
        if (f.obj.position.x > 160) f.obj.position.x = -160;
      }
    }
    for (const cloud of this.clouds) {
      cloud.position.y = cloud.userData.baseY + Math.sin(this.time * 0.5 + cloud.userData.offset) * 0.6;
    }
  },
};
