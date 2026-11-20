// =====================================================
//  materials.js ― 素材（マテリアル）とテクスチャの置き場
//
//  同じ見た目の物は、同じマテリアル・同じテクスチャを使い回す。
//  これをしないと、足場が増えるほど描画が重くなる。
//
//  素材の種類は4つだけに整理する：
//    プラスチック（足場の本体）
//    ゴム      （ふち・クッション・滑り止め）
//    金属      （手すり・骨組み・支柱）
//    塗装パネル（滑り止めの天面）
// =====================================================

const Mats = {
  // world.js が環境マップを作れたら true になる。
  // 環境マップが無いまま metalness を上げると、金属は光らずに黒くなるだけ。
  hasEnv: false,
  metalness(withEnv, withoutEnv) {
    return this.hasEnv ? withEnv : withoutEnv;
  },

  _tex: {},
  _body: new Map(),
  _deck: new Map(),
  _shared: {},

  // -----------------------------------------------------
  //  絵を描いたテクスチャ（名前ごとに1枚だけ作って使い回す）
  // -----------------------------------------------------
  // -----------------------------------------------------
  //  色の扱い（ここが段階Aの中核）
  //
  //  Three.js r128 には色空間の自動変換が無い。
  //  コードに書く 0xRRGGBB は「画面で見える色」＝ sRGB の値だが、
  //  照明の計算は「光の量に比例する値」＝ リニアでないと正しくない。
  //  そこで材質を作るときに一度だけ sRGB → リニアへ直す。
  //
  //  この変換を入れると：
  //    ・トーンマッピングが正しく効く（白飛びが消える）
  //    ・出力を sRGB にしても色が褪せない（ver12 の失敗の原因がこれ）
  //  変換を入れずに出力だけ sRGB にすると全体が白っぽくなる。
  // -----------------------------------------------------
  C(hex) {
    const c = new THREE.Color(hex);
    return LOOK.linear ? c.convertSRGBToLinear() : c;
  },

  // 床板の模様：継ぎ目・滑り止めの粒・四すみのボルト・うっすらした傷
  //  1タイル＝約2m。deck の UV は w/2, d/2 なので、どの大きさでも同じ密度になる
  _deckPattern(g, s, mode) {
    const grip = mode === "height" ? "#c8c8c8" : "rgba(255,255,255,0.10)";
    const seam = mode === "height" ? "#4a4a4a" : "rgba(0,0,0,0.42)";
    const bolt = mode === "height" ? "#e0e0e0" : "rgba(255,255,255,0.22)";
    if (mode !== "height") {
      g.fillStyle = "#ffffff";          // 色は材質側で付けるので、ここは白地
      g.fillRect(0, 0, s, s);
      g.fillStyle = "rgba(0,0,0,0.06)"; // 使用感のムラ
      for (let i = 0; i < 26; i++) {
        const x = (i * 53) % s, y = (i * 97) % s;
        g.fillRect(x, y, 10 + (i % 5) * 6, 2);
      }
    }
    // 床板の継ぎ目（タイルの外周）
    g.strokeStyle = seam;
    g.lineWidth = s / 32;
    g.strokeRect(0, 0, s, s);
    // 滑り止めの粒（互い違いに並べる）
    g.fillStyle = grip;
    const step = s / 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const ox = (y % 2) * step * 0.5;
        g.beginPath();
        g.ellipse(step * 0.5 + x * step + ox, step * 0.5 + y * step,
                  step * 0.22, step * 0.16, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    // 四すみのボルト
    g.fillStyle = bolt;
    [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92]].forEach(([u, v]) => {
      g.beginPath();
      g.arc(u * s, v * s, s / 28, 0, Math.PI * 2);
      g.fill();
    });
  },

  deckPlate() { return this.texture("deckPlate", 128, (g, s) => this._deckPattern(g, s, "color")); },
  deckNormal() { return this.normalMap("deckNormal", 128, (g, s) => this._deckPattern(g, s, "height"), 2.2); },

  // 金属グレーチング（格子の足場）。穴は開けず描き込みにする＝塗る画素が増えない
  _gratingPattern(g, s, mode) {
    const bar = mode === "height" ? "#dcdcdc" : "rgba(255,255,255,0.30)";
    const hole = mode === "height" ? "#303030" : "rgba(0,0,0,0.55)";
    g.fillStyle = hole;
    g.fillRect(0, 0, s, s);
    g.fillStyle = bar;
    const n = 8, t = s / n * 0.34;
    for (let i = 0; i < n; i++) {
      g.fillRect(i * s / n, 0, t, s);                 // 縦のバー
      if (i % 2 === 0) g.fillRect(0, i * s / n, s, t * 0.55); // 横のつなぎ
    }
  },

  gratingTex() { return this.texture("grating", 128, (g, s) => this._gratingPattern(g, s, "color")); },
  gratingNormal() { return this.normalMap("gratingNormal", 128, (g, s) => this._gratingPattern(g, s, "height"), 3); },

  // 色として見せるテクスチャ（模様・文字・看板）。sRGB として読む
  texture(name, size, draw) {
    return this._makeTexture(name, size, draw, true);
  },

  // 数値データのテクスチャ（Normal Map・粗さ・金属度）。リニアのまま読む。
  //  ここを sRGB にすると凹凸の向きや粗さの値が狂う。段階Bで使う
  dataTexture(name, size, draw) {
    return this._makeTexture(name, size, draw, false);
  },

  // 高さの絵（白＝高い／黒＝低い）から Normal Map を作る。
  //  形を増やさずに凹凸の陰影だけを足せるので、内蔵GPUでも軽い。
  //  中身は数値データなので、色空間は必ずリニアのまま扱う。
  normalMap(name, size, drawHeight, strength) {
    if (this._tex[name]) return this._tex[name];
    const hc = document.createElement("canvas");
    hc.width = hc.height = size;
    const hg = hc.getContext("2d");
    hg.fillStyle = "#808080";          // 平らな面＝中間の高さ
    hg.fillRect(0, 0, size, size);
    drawHeight(hg, size);
    const src = hg.getImageData(0, 0, size, size).data;

    const oc = document.createElement("canvas");
    oc.width = oc.height = size;
    const og = oc.getContext("2d");
    const img = og.createImageData(size, size);
    const k = strength === undefined ? 2.5 : strength;
    // 端でも模様が切れないように、はみ出した座標は反対側へ回す
    const at = (x, y) =>
      src[((((y % size) + size) % size) * size + (((x % size) + size) % size)) * 4] / 255;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // 左右・上下の高さの差が、面の傾きになる
        const dx = (at(x + 1, y) - at(x - 1, y)) * k;
        const dy = (at(x, y + 1) - at(x, y - 1)) * k;
        // canvas は下へ y が増えるが、テクスチャは上へ v が増えるので dy の符号はこのまま
        let nx = -dx, ny = dy, nz = 1;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= len; ny /= len; nz /= len;
        const i = (y * size + x) * 4;
        img.data[i] = (nx * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    og.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(oc);
    tex.encoding = THREE.LinearEncoding;   // 数値データなので必ずリニア
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    this._tex[name] = tex;
    return tex;
  },

  // Normal Map を使ってよいか（画質設定が既定。N キーで切りかえられる）
  useNormal() {
    return this.normalOn === undefined ? !!Quality.preset.normalMap : this.normalOn;
  },

  // Normal Map を付け外しする（N キー）。負荷を実測で比べるための切りかえ。
  //  すでに作った材質に足し引きするので、作り直しは起きない
  setNormal(on) {
    this.normalOn = on;
    const apply = (map, makeNormal, scale) => {
      if (!map) return;
      map.forEach(m => {
        m.normalMap = on ? makeNormal() : null;
        if (on) m.normalScale = new THREE.Vector2(scale, scale);
        m.needsUpdate = true;   // シェーダを作り直す必要がある
      });
    };
    apply(this._deck, () => this.deckNormal(), 0.9);
    apply(this._grating, () => this.gratingNormal(), 1);
  },

  _makeTexture(name, size, draw, isColor) {
    if (this._tex[name]) return this._tex[name];
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    draw(canvas.getContext("2d"), size);
    const tex = new THREE.CanvasTexture(canvas);
    // 色用だけ sRGB。数値データは必ずリニア
    tex.encoding = (isColor && LOOK.linear) ? THREE.sRGBEncoding : THREE.LinearEncoding;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    this._tex[name] = tex;
    return tex;
  },

  // 滑り止め（丸い突起のならび）。白地なので、色をかけるとその色の床になる
  antiSlip() {
    return this.texture("antiSlip", 128, (g, s) => {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, s, s);
      g.fillStyle = "rgba(0,0,0,0.26)";
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const ox = (y % 2) * 16;
          g.beginPath();
          g.arc(16 + x * 32 + ox, 16 + y * 32, 7, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.strokeStyle = "rgba(0,0,0,0.10)";
      g.lineWidth = 3;
      g.strokeRect(0, 0, s, s);
    });
  },

  // 側面のパネル（つなぎ目のある金属板）
  panel() {
    return this.texture("panel", 128, (g, s) => {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, s, s);
      g.strokeStyle = "rgba(0,0,0,0.32)";
      g.lineWidth = 4;
      g.strokeRect(0, 0, s, s);
      g.strokeStyle = "rgba(0,0,0,0.10)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, s / 2); g.lineTo(s, s / 2);
      g.stroke();
      // 四すみのボルト
      g.fillStyle = "rgba(0,0,0,0.20)";
      [[14, 14], [s - 14, 14], [14, s - 14], [s - 14, s - 14]].forEach(([x, y]) => {
        g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
      });
    });
  },

  // 坂道の矢印模様（進む向きが分かる）
  chevron() {
    return this.texture("chevron", 128, (g, s) => {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, s, s);
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.lineWidth = 12;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(18, 86); g.lineTo(s / 2, 36); g.lineTo(s - 18, 86);
      g.stroke();
      g.strokeStyle = "rgba(0,0,0,0.18)";
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(0, s - 4); g.lineTo(s, s - 4);
      g.stroke();
    });
  },

  // 注意のしま模様（斜めの帯）。危ない物に貼る
  stripes(a, b) {
    return this.texture("stripes" + a + b, 128, (g, s) => {
      g.fillStyle = a;
      g.fillRect(0, 0, s, s);
      g.strokeStyle = b;
      g.lineWidth = 26;
      for (let i = -s; i < s * 2; i += 52) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s, s); g.stroke();
      }
    });
  },

  // 進む方向の矢印（奥＝画面の上向きを指す）
  arrow() {
    return this.texture("arrow", 128, (g, s) => {
      g.clearRect(0, 0, s, s);
      g.strokeStyle = "rgba(240, 244, 250, 0.92)"; // 白い山形（競技場の床表示）
      g.lineWidth = 15;
      g.lineCap = "round";
      g.lineJoin = "round";
      [0, 40].forEach(dy => {
        g.beginPath();
        g.moveTo(22, 74 + dy); g.lineTo(s / 2, 26 + dy); g.lineTo(s - 22, 74 + dy);
        g.stroke();
      });
    });
  },

  // 落ちる床の板（ふちの枠と、滑り止めの粒）
  tilePlate() {
    return this.texture("tilePlate", 128, (g, s) => {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, s, s);
      g.strokeStyle = "rgba(0,0,0,0.28)";
      g.lineWidth = 10;
      g.strokeRect(5, 5, s - 10, s - 10);
      g.fillStyle = "rgba(0,0,0,0.14)";
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          g.beginPath(); g.arc(32 + x * 32, 32 + y * 32, 6, 0, Math.PI * 2); g.fill();
        }
      }
      g.fillStyle = "rgba(0,0,0,0.3)"; // 四すみのリベット
      [[16, 16], [s - 16, 16], [16, s - 16], [s - 16, s - 16]].forEach(([x, y]) => {
        g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
      });
    });
  },

  // -----------------------------------------------------
  //  素材（色ごとに1つだけ作って使い回す）
  // -----------------------------------------------------

  // 足場の本体：色のついたプラスチック
  body(color) {
    if (!this._body.has(color)) {
      // 参考イメージに合わせて、側面は濃い鋼材寄りの色にする。
      // 歩く面（deck）は元の色を残すので、エリアごとの見分けはつく
      const dark = this.C(color).lerp(this.C(0x2a3142), 0.62);
      this._body.set(color, new THREE.MeshStandardMaterial({
        color: dark, map: this.panel(), roughness: 0.46, metalness: this.metalness(0.45, 0.1),
      }));
    }
    return this._body.get(color);
  },

  // 足場の天面：滑り止めの塗装。本体より少し明るくする
  // 歩く面（段階B）。参考イメージに合わせてダークグレーのゴム＋金属床板に統一する。
  //  色はエリアごとに変えず1種類だけ作る＝まとめ描画の数も減る。
  //  エリアごとの色は accent() の帯と、橙の安全縁で見分ける。
  deck() {
    const key = "deck";
    if (!this._deck.has(key)) {
      const m = new THREE.MeshStandardMaterial({
        color: this.C(0x3d434c), map: this.deckPlate(),
        roughness: 0.52, metalness: this.metalness(0.35, 0.08),
      });
      if (this.useNormal()) {
        m.normalMap = this.deckNormal();
        m.normalScale = new THREE.Vector2(0.9, 0.9);
      }
      this._deck.set(key, m);
    }
    return this._deck.get(key);
  },

  // 足場の横にまわすエリア色の帯（どのエリアにいるか分かるようにする）
  accent(color) {
    if (!this._accent) this._accent = new Map();
    if (!this._accent.has(color)) {
      this._accent.set(color, new THREE.MeshStandardMaterial({
        color: this.C(color), roughness: 0.5, metalness: this.metalness(0.2, 0.05),
      }));
    }
    return this._accent.get(color);
  },

  // 金属グレーチングの足場
  grating() {
    const key = "grating";
    if (!this._grating) this._grating = new Map();
    if (!this._grating.has(key)) {
      const m = new THREE.MeshStandardMaterial({
        color: this.C(0x6a7180), map: this.gratingTex(),
        roughness: 0.44, metalness: this.metalness(0.8, 0.3),
      });
      if (this.useNormal()) {
        m.normalMap = this.gratingNormal();
        m.normalScale = new THREE.Vector2(1, 1);
      }
      this._grating.set(key, m);
    }
    return this._grating.get(key);
  },

  // ゴム：ふちの黒い縁取り、クッション。光らない
  rubber() {
    if (!this._shared.rubber) {
      this._shared.rubber = new THREE.MeshStandardMaterial({
        color: this.C(0x2b2f42), roughness: 0.95, metalness: 0,
      });
    }
    return this._shared.rubber;
  },

  // 金属：手すり・リング。環境マップがあれば、きちんと映りこんで光る
  metal() {
    if (!this._shared.metal) {
      this._shared.metal = new THREE.MeshStandardMaterial({
        color: this.C(0xc3cad4), roughness: 0.26, metalness: this.metalness(0.72, 0.3),
      });
    }
    return this._shared.metal;
  },

  // 骨組み：足場の下の構造。暗い金属
  support() {
    if (!this._shared.support) {
      this._shared.support = new THREE.MeshStandardMaterial({
        color: this.C(0x6b7382), map: this.panel(), roughness: 0.48,
        metalness: this.metalness(0.55, 0.2),
      });
    }
    return this._shared.support;
  },

  // 注意のしま模様の素材（黄×黒：危険、赤×白：動く壁）
  hazard() {
    if (!this._shared.hazard) {
      this._shared.hazard = new THREE.MeshStandardMaterial({
        map: this.stripes("#ffd23f", "#22223a"), roughness: 0.55, metalness: this.metalness(0.2, 0.08),
      });
    }
    return this._shared.hazard;
  },

  hazardSoft() {
    if (!this._shared.hazardSoft) {
      this._shared.hazardSoft = new THREE.MeshStandardMaterial({
        map: this.stripes("#ff5f6d", "#ffffff"), roughness: 0.75, metalness: 0,
      });
    }
    return this._shared.hazardSoft;
  },

  // 光って知らせるランプ
  warnLight() {
    if (!this._shared.warnLight) {
      this._shared.warnLight = new THREE.MeshStandardMaterial({
        color: this.C(0xffe45c), emissive: this.C(0xffc83d), emissiveIntensity: 0.8, roughness: 0.35,
      });
    }
    return this._shared.warnLight;
  },

  // 坂道の表面：つるつるのプラスチック
  slide(color) {
    const key = "slide" + color;
    if (!this._shared[key]) {
      this._shared[key] = new THREE.MeshStandardMaterial({
        color: this.C(color), map: this.chevron(), roughness: 0.1, metalness: this.metalness(0.35, 0.12),
      });
    }
    return this._shared[key];
  },

  // -----------------------------------------------------
  //  鉄骨トラス（参考イメージの骨組み）
  //   いくつもの箱を1つのジオメトリにまとめておき、
  //   InstancedMesh で何百本でも「描画命令1回」で描く。
  // -----------------------------------------------------

  // 複数のジオメトリを1つに合体させる（r128 には合体関数が無いので自前）
  //   parts: [{ geo, x, y, z, rx, ry, rz, ur, vr }]
  //   ur / vr はテクスチャのくり返し数。省略すると 1
  mergeGeos(parts) {
    const pos = [], nor = [], uv = [], idx = [];
    let offset = 0;
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    parts.forEach(p => {
      // 元のジオメトリを壊さないように複製してから動かす
      const g = p.geo.clone();
      e.set(p.rx || 0, p.ry || 0, p.rz || 0);
      m.makeRotationFromEuler(e);
      m.setPosition(p.x || 0, p.y || 0, p.z || 0);
      g.applyMatrix4(m);
      const gp = g.attributes.position.array;
      const gn = g.attributes.normal ? g.attributes.normal.array : null;
      const gu = g.attributes.uv ? g.attributes.uv.array : null;
      const count = g.attributes.position.count;
      for (let i = 0; i < gp.length; i++) pos.push(gp[i]);
      for (let i = 0; i < count * 3; i++) nor.push(gn ? gn[i] : 0);
      // 箱ごとにテクスチャのくり返し数が違うので、ここで焼きこむ。
      // 1回未満だと模様が途中で切れるので boxUV と同じ下限をかける
      const fix = r => Math.sign(r || 1) * Math.max(1, Math.abs(r));
      const ur = p.ur === undefined ? 1 : fix(p.ur);
      const vr = p.vr === undefined ? 1 : fix(p.vr);
      for (let i = 0; i < count; i++) {
        uv.push(gu ? gu[i * 2] * ur : 0, gu ? gu[i * 2 + 1] * vr : 0);
      }
      if (g.index) {
        const gi = g.index.array;
        for (let i = 0; i < gi.length; i++) idx.push(gi[i] + offset);
      } else {
        for (let i = 0; i < count; i++) idx.push(i + offset);
      }
      offset += count;
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    out.setIndex(idx);
    return out;
  },

  // 箱だけを合体させる場合の簡単版（寸法から箱を作って mergeGeos に渡す）
  mergeBoxes(parts) {
    return this.mergeGeos(parts.map(p => {
      const q = Object.assign({}, p);
      q.geo = new THREE.BoxGeometry(p.w, p.h, p.d);
      return q;
    }));
  },

  // トラス1区間（長さ4m・断面1.5m角）。Z方向に伸びる。
  //  参考イメージに寄せて部材を太くし、端に接合プレート（ガセット）を足した。
  //  InstancedMesh で何百本でも描画命令1回なので、太くしても負荷は変わらない
  trussUnit() {
    if (this._truss) return this._truss;
    const L = 4, R = 0.75, t = 0.18;
    const parts = [];
    // 4本の主材（角パイプ）
    [[-R, -R], [R, -R], [-R, R], [R, R]].forEach(([x, y]) => {
      parts.push({ w: t, h: t, d: L, x: x, y: y, z: 0 });
    });
    // 横つなぎは片側だけ（区間を並べれば 4m ごとに入る）
    const zEnd = L / 2 - t;
    parts.push({ w: R * 2, h: t * 0.85, d: t * 0.85, x: 0, y: -R, z: zEnd });
    parts.push({ w: R * 2, h: t * 0.85, d: t * 0.85, x: 0, y: R, z: zEnd });
    parts.push({ w: t * 0.85, h: R * 2, d: t * 0.85, x: -R, y: 0, z: zEnd });
    parts.push({ w: t * 0.85, h: R * 2, d: t * 0.85, x: R, y: 0, z: zEnd });
    // 接合プレート：主材と横つなぎが交わる4すみに、平たい板を当てる
    [[-R, -R], [R, -R], [-R, R], [R, R]].forEach(([x, y]) => {
      parts.push({ w: t * 2.6, h: t * 2.6, d: t * 0.5, x: x, y: y, z: zEnd });
    });
    // ななめの筋交い（上下左右の面に1本ずつ）
    const diag = Math.hypot(L, R * 2);
    const ang = Math.atan2(R * 2, L);
    parts.push({ w: t * 0.8, h: t * 0.8, d: diag, x: 0, y: -R, z: 0, rx: ang });
    parts.push({ w: t * 0.8, h: t * 0.8, d: diag, x: 0, y: R, z: 0, rx: -ang });
    parts.push({ w: t * 0.8, h: t * 0.8, d: diag, x: -R, y: 0, z: 0, ry: ang });
    parts.push({ w: t * 0.8, h: t * 0.8, d: diag, x: R, y: 0, z: 0, ry: -ang });
    this._truss = this.mergeBoxes(parts);
    this._truss.userData.length = L;
    return this._truss;
  },

  // ---- 競技用ゲートの金属（段階D改）----
  //  steel() は金属度0.85。金属は拡散反射をほとんど持たないので、
  //  環境マップが暗い今の設定だと黒くつぶれる。
  //  ゲートは近くでよく見えるので、金属度を下げて基本色を明るい銀にし、
  //  「塗装された灰色」ではなく「光を受ける鉄」に見えるようにする。
  //  観客席の手すり（#a9b1bd・金属度0.7）が画面で銀色に出ているのが根拠。

  // 主な柱と横桁：鉄のようなシルバー
  gateSteel() {
    if (!this._shared.gateSteel) {
      this._shared.gateSteel = new THREE.MeshStandardMaterial({
        color: this.C(0xa8b0bb), roughness: 0.33,
        metalness: this.metalness(0.6, 0.22),
        envMapIntensity: 1.15,   // 映りこみを少し強めてエッジに光を乗せる
      });
    }
    return this._shared.gateSteel;
  },

  // 接合部・補強材：濃いスチールグレー
  gateDark() {
    if (!this._shared.gateDark) {
      this._shared.gateDark = new THREE.MeshStandardMaterial({
        color: this.C(0x596069), roughness: 0.52,
        metalness: this.metalness(0.5, 0.18),
      });
    }
    return this._shared.gateDark;
  },

  // ボルト・エッジ：明るいシルバー（小さいので粗さを下げて強く光らせる）
  gateBright() {
    if (!this._shared.gateBright) {
      this._shared.gateBright = new THREE.MeshStandardMaterial({
        color: this.C(0xd2d8df), roughness: 0.18,
        metalness: this.metalness(0.78, 0.3),
        envMapIntensity: 1.3,
      });
    }
    return this._shared.gateBright;
  },

  // 表示板の地：マットブラック（映りこませない）
  matteBlack() {
    if (!this._shared.matteBlack) {
      this._shared.matteBlack = new THREE.MeshStandardMaterial({
        color: this.C(0x111317), roughness: 0.95, metalness: 0,
      });
    }
    return this._shared.matteBlack;
  },

  // LED：オレンジ（主）と青（補助）。光源は増やさず発光して見せるだけ
  ledOrange() {
    if (!this._shared.ledOrange) {
      this._shared.ledOrange = new THREE.MeshBasicMaterial({ color: this.C(0xff8a24) });
    }
    return this._shared.ledOrange;
  },
  ledBlue() {
    if (!this._shared.ledBlue) {
      this._shared.ledBlue = new THREE.MeshBasicMaterial({ color: this.C(0x2f7dff) });
    }
    return this._shared.ledBlue;
  },

  // 照明器具の筐体（暗い金属の箱）
  lampBody() {
    if (!this._shared.lampBody) {
      this._shared.lampBody = new THREE.MeshStandardMaterial({
        color: this.C(0x2a2e36), roughness: 0.5, metalness: this.metalness(0.7, 0.25),
      });
    }
    return this._shared.lampBody;
  },

  // 鋼材（参考イメージの濃い鉄骨）
  steel() {
    if (!this._shared.steel) {
      this._shared.steel = new THREE.MeshStandardMaterial({
        // 構造用のシルバー鋼。金属度を 0.85→0.62 に下げ、基本色を明るくした。
        //  金属度が高すぎると暗い環境マップしか映らず黒くつぶれる（ver22 のゲートと同じ）
        color: this.C(0x9ea7b2), roughness: 0.38, metalness: this.metalness(0.62, 0.22),
      });
    }
    return this._shared.steel;
  },

  // 安全縁（橙色）。参考イメージの足場のふち
  edge() {
    if (!this._shared.edge) {
      this._shared.edge = new THREE.MeshStandardMaterial({
        color: this.C(0xff8a2b), roughness: 0.6, metalness: 0.05,
      });
    }
    return this._shared.edge;
  },

  // ハンマーの頭のドラム（参考イメージの赤い円筒）
  drum() {
    if (!this._shared.drum) {
      this._shared.drum = new THREE.MeshStandardMaterial({
        color: this.C(0xc8322c), roughness: 0.38, metalness: this.metalness(0.5, 0.15),
      });
    }
    return this._shared.drum;
  },

  // 照明の灯具（光って見えるだけ。光源は増やさないので負荷ゼロ）
  lampGlow() {
    if (!this._shared.lampGlow) {
      this._shared.lampGlow = new THREE.MeshBasicMaterial({ color: this.C(0xfff6e0) });
    }
    return this._shared.lampGlow;
  },

  // -----------------------------------------------------
  //  箱を作って、テクスチャの細かさをその大きさに合わせる
  //   （1枚のテクスチャを何回くり返すかを、頂点のUVで決める）
  // -----------------------------------------------------
  boxUV(w, h, d, repeatX, repeatY) {
    const geo = new THREE.BoxGeometry(w, h, d);
    // 1回未満だと模様が途中で切れるので、最低1回はくり返す
    const fix = r => Math.sign(r || 1) * Math.max(1, Math.abs(r));
    repeatX = fix(repeatX);
    repeatY = fix(repeatY);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * repeatX, uv.getY(i) * repeatY);
    }
    uv.needsUpdate = true;
    return geo;
  },
};
