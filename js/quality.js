// =====================================================
//  quality.js ― 画質の3段階と、動きの速さの計測
//
//  Intel Iris Xe のような内蔵GPUでは、
//  「三角形の数」より「塗る画素の数」と「描画命令の数」が効く。
//  そのため LOW ほど画素数・影・半透明を減らす。
//
//  ゲームの中身（当たり判定・コース・CPU・オンライン）は
//  どの画質でもまったく同じ。見た目の細かさだけが変わる。
// =====================================================

const QUALITY_PRESETS = {
  low: {
    label: "LOW",
    note: "軽さ優先",
    pixelRatio: 0.8,    // 塗る画素が 1.0 のときの 64%
    shadows: false,     // 影の描画をやめる（影用に全部もう一度描くのを省ける）
    shadowSize: 1024,
    softShadow: false,
    env: false,         // 映りこみをやめる（画素ごとの計算が軽くなる）
    floods: 0,          // 照明塔の光（光源が増えるほど画素の計算が増える）
    crowdFill: 0.22,    // 観客の数
    seatStep: 3.2,      // 座席の間かく（広いほど数が減る）
    tiers: 2,           // スタンドの段数（3階席を省く）
    crowdWave: false,   // 観客の動き
    clouds: 6,
    fogFar: 650,        // 遠くを早めにかすませて、奥の描画を減らす
    glass: false,       // 半透明（屋根・フェンス・光の柱）をやめる
    chunk: 60,          // まとめ描画を細かく分ける＝画面外を描かずに済む
    trussDetail: 0,     // 足場の下の鉄骨を省く
    normalMap: false,   // 凹凸の陰影（画素ごとの負荷が増えるので LOW では切る）
    gantryGap: 40,      // 天井の鉄骨の間かく（広いほど軽い）
    lampScale: 0.5,
  },
  medium: {
    label: "MEDIUM",
    note: "標準",
    pixelRatio: 1.0,
    shadows: true,
    shadowSize: 1024,
    softShadow: false,  // ふつうの PCF（PCFSoft より軽い）
    env: true,
    floods: 2,
    crowdFill: 0.42,
    seatStep: 2.4,
    tiers: 3,
    crowdWave: true,
    clouds: 12,
    fogFar: 900,
    glass: true,
    chunk: 70,
    trussDetail: 1,
    normalMap: true,
    gantryGap: 28,
    lampScale: 1,
  },
  high: {
    label: "HIGH",
    note: "高画質",
    pixelRatio: 1.15,   // 1.25 は内蔵GPUには重かった（実測30fps）。画素を15%減らす
    shadows: true,
    //  影は「シーンをもう一度描く」処理。解像度を下げると負荷がそのまま下がる。
    //  PCFSoft は画素ごとの計算が PCF の数倍かかるので、内蔵GPUでは PCF にする
    shadowSize: 1536,
    softShadow: false,
    env: true,
    floods: 4,
    crowdFill: 0.5,     // 遠い階は座席の帯で埋まったので、観客は減らしてよい
    seatStep: 2.0,
    tiers: 3,
    crowdWave: true,
    clouds: 18,
    fogFar: 1000,
    glass: true,
    chunk: 80,
    trussDetail: 2,
    normalMap: true,
    gantryGap: 22,
    lampScale: 1,
  },
};

const Quality = {
  level: "medium",
  preset: QUALITY_PRESETS.medium,

  init() {
    let saved = null;
    try {
      saved = localStorage.getItem("skyhop_quality");
    } catch (err) {
      // ファイルを直接開いた場合など、保存できない環境でも動くようにする
    }
    if (saved && QUALITY_PRESETS[saved]) this.level = saved;
    this.preset = QUALITY_PRESETS[this.level];
    return this.preset;
  },

  // 画質を変えたらページを読み込み直す（途中で作り直すより確実で安全）
  set(level) {
    if (!QUALITY_PRESETS[level]) return;
    try {
      localStorage.setItem("skyhop_quality", level);
    } catch (err) {
      // 保存できない環境では、今回だけの変更になる
    }
    location.reload();
  },
};

// =====================================================
//  Perf ― 動きの速さ（FPS）を測る
//   平均・最低のほか、コースのエリアごとの平均も出す。
//   「どこが重いか」を場所つきで知るため。
// =====================================================
const Perf = {
  // エリアの区切り（z がこの値より手前なら、そのエリア）
  bounds: [-50, -110, -184, -234, -999],
  names: ["エリア1", "エリア2", "エリア3", "エリア4", "エリア5"],

  reset() {
    this.frames = 0;
    this.elapsed = 0;
    this.worst = 999;
    this.slowFrames = 0;      // 30fps を下回ったフレーム数
    this.area = this.names.map(() => ({ frames: 0, time: 0, worst: 999 }));
    this.started = false;
  },

  // 毎フレーム呼ぶ。z はプレイヤーの位置
  sample(dt, z, playing) {
    if (dt <= 0 || dt > 0.5) return; // タブを切りかえた直後などは捨てる
    const fps = 1 / dt;
    this.frames++;
    this.elapsed += dt;
    if (fps < this.worst) this.worst = fps;
    if (fps < 30) this.slowFrames++;
    if (!playing) return;
    this.started = true;
    let i = 0;
    while (i < this.bounds.length - 1 && z < this.bounds[i]) i++;
    const a = this.area[i];
    a.frames++;
    a.time += dt;
    if (fps < a.worst) a.worst = fps;
  },

  average() {
    return this.elapsed > 0 ? this.frames / this.elapsed : 0;
  },

  // エリアごとの平均を「1:58 2:55 …」の形にする
  areaReport() {
    return this.area
      .map((a, i) => (a.time > 0.5 ? (i + 1) + ":" + Math.round(a.frames / a.time) : null))
      .filter(Boolean)
      .join("  ");
  },

  // いちばん重かったエリア
  worstArea() {
    let worst = null;
    this.area.forEach((a, i) => {
      if (a.time < 1) return;
      const fps = a.frames / a.time;
      if (!worst || fps < worst.fps) worst = { name: this.names[i], fps: fps, min: a.worst };
    });
    return worst;
  },
};
Perf.reset();
