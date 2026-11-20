// =====================================================
//  main.js ― 全体をまとめて動かす（ゲームのスタート地点）
// =====================================================

// ----- 1. 描画の準備 -----
const container = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // alpha: 背景を透明にしてCSSの空を見せる
// 画質の設定を読み込む（LOW / MEDIUM / HIGH）
const QP = Quality.init();
// 内蔵GPUでは「塗る画素の数」がいちばん効くので、ここが最大の調整点
renderer.setPixelRatio(Math.min(window.devicePixelRatio, QP.pixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = QP.shadows;
// PCFSoft はきれいだが重い。MEDIUM 以下はふつうの PCF にする
renderer.shadowMap.type = QP.softShadow ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
// ----- 色の出し方（段階A）-----
//  入口（Mats.C とテクスチャの encoding）で sRGB → リニアに直してあるので、
//  出口は sRGB に戻す。その手前でトーンマッピングが明るい所を圧縮するため、
//  白飛びが起きない。
const TONE = {
  aces: THREE.ACESFilmicToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  none: THREE.NoToneMapping,
};
// 前回いじった明るさを覚えておく（調整のたびに入れ直さずに済む）
try {
  const saved = localStorage.getItem("skyhop_exposure");
  if (saved) LOOK.exposure = parseFloat(saved);
  const savedTone = localStorage.getItem("skyhop_tone");
  if (savedTone && TONE[savedTone]) LOOK.tone = savedTone;
} catch (e) { /* localStorage が使えなくても動く */ }

function applyLook() {
  if (LOOK.linear) {
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = TONE[LOOK.tone] || THREE.ACESFilmicToneMapping;
  } else {
    renderer.outputEncoding = THREE.LinearEncoding;
    renderer.toneMapping = THREE.NoToneMapping;
  }
  renderer.toneMappingExposure = LOOK.exposure;
}
applyLook();
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 1200); // 広い視野で、コースを大きく見せる

// ----- 2. 世界・コース・キャラクター・演出を作る -----
const world = World.create(scene, renderer); // renderer は環境マップを作るのに使う
Course.build(scene, world);
const player = new Player(scene, world.spawnPoint, { name: "YOU", isHuman: true });
player.startOffset = new THREE.Vector3(0, 0, 0);

// CPU を5人作る（スタート位置を横と後ろにずらして並べる）
const botOffsets = [
  new THREE.Vector3(-5, 0, 0), new THREE.Vector3(5, 0, 0),
  new THREE.Vector3(-2.5, 0, 2), new THREE.Vector3(2.5, 0, 2), new THREE.Vector3(0, 0, 2.5),
];
const bots = BOT_PROFILES.map((profile, i) => {
  const racer = new Player(scene, world.spawnPoint, Object.assign({ isHuman: false }, profile));
  racer.startOffset = botOffsets[i];
  racer.spawnPoint.add(racer.startOffset);
  racer.respawn(false);
  return new Bot(racer, profile.skill);
});
const racers = [player].concat(bots.map(b => b.racer)); // 自分＋CPU

// モード：solo（ひとりで、CPUと）/ online（みんなでオンライン）
let mode = "solo";
let raceStartAt = 0; // オンラインのスタート時刻（サーバーの時計）

// 今のモードで、この画面の中で動かすキャラ（オンラインでは自分だけ。ほかの人は online.js が表示）
function activeRacers() {
  return mode === "online" ? [player] : racers;
}
Effects.init(scene);
Input.init(renderer.domElement);
UI.init(Course.startPoint.z, Course.goal.z, Course.checkpoints.map(cp => cp.z));

// ----- 3. ゲームの状態 -----
//   title     … スタート画面
//   countdown … 3・2・1・GO!
//   playing   … プレイ中（タイマーが進む）
//   finished  … ゴールした
const game = {
  state: "title",
  time: 0,           // クリアタイム（秒）
  falls: 0,          // 落ちた回数
  countdown: 0,
  lastCount: 0,
  celebrateTimer: 0, // ゴール後の演出用
  resultTimer: 0,
  best: loadBest(),
};

// ベストタイムをブラウザに保存・読み込み（使えない環境ではスキップ）
function loadBest() {
  try {
    const value = parseFloat(localStorage.getItem("skyHopBest"));
    return isNaN(value) ? null : value;
  } catch (err) {
    return null;
  }
}

function saveBest(time) {
  try {
    localStorage.setItem("skyHopBest", String(time));
  } catch (err) {
    // 保存できなくてもゲームは続ける
  }
}

UI.setTitleBest(game.best);
UI.setCheckpoint(0, Course.checkpoints.length);

// ----- 4. スタート・リスタート -----
function startRun() {
  if (mode === "online") return; // オンラインでは、スタートはホストが決める
  bots.forEach(bot => bot.racer.setVisible(true));
  player.startOffset = new THREE.Vector3(0, 0, 0);
  Course.restart(racers);
  bots.forEach(bot => bot.reset());
  game.state = "countdown";
  game.time = 0;
  game.falls = 0;
  Perf.reset(); // 走るたびに FPS の計測をやり直す
  game.countdown = 3;
  game.lastCount = 4;
  game.resultTimer = 0;
  racers.forEach(r => { r.frozen = true; });
  UI.hideResults();
  UI.setTime(0);
  UI.setFalls(0);
  UI.setCheckpoint(0, Course.checkpoints.length);
}

document.getElementById("startBtn").addEventListener("click", e => {
  Sound.init();
  Sound.startMusic();
  Input.requestLock(renderer.domElement);
  UI.hideStart();
  e.target.blur();
  startRun();
});

document.getElementById("retryBtn").addEventListener("click", e => {
  e.target.blur();
  if (mode === "online") {
    if (Online.isHost()) Online.backToLobby(); // ホスト：みんなで待合室へ
    return;
  }
  Input.requestLock(renderer.domElement);
  startRun();
});

// ----- オンライン対戦の準備 -----
// サーバーが決めたスタート時刻に合わせて、カウントダウンを始める
function startOnlineRace(slot, startAt) {
  mode = "online";
  raceStartAt = startAt;
  Sound.init();
  Sound.startMusic();
  bots.forEach(bot => bot.racer.setVisible(false));
  player.startOffset = slotOffset(slot);
  Course.restart([player]);
  game.state = "countdown";
  game.time = 0;
  game.falls = 0;
  Perf.reset();
  game.lastCount = 4;
  game.resultTimer = 0;
  player.frozen = true;
  UI.hideStart();
  UI.hideResults();
  UI.setTime(0);
  UI.setFalls(0);
  UI.setCheckpoint(0, Course.checkpoints.length);
  Input.requestLock(renderer.domElement);
}

Online.init(scene, {
  onRaceStart: startOnlineRace,
  onRanking: list => {
    if (game.state === "finished") UI.setRanking(list);
  },
  onResults: list => {
    UI.setRanking(list);
    document.getElementById("retryBtn").textContent = Online.isHost() ? "待合室に戻る（みんな）" : "ホストを待っています";
    document.getElementById("retryBtn").disabled = !Online.isHost();
  },
  onLobby: () => {
    game.state = "title";
    UI.hideResults();
  },
  onLeave: () => {
    mode = "solo";
    game.state = "title";
    UI.hideResults();
    document.getElementById("startScreen").classList.remove("hidden");
  },
});
Obstacles.onTileTrigger = id => {
  if (mode === "online" && Online.inRace && Online.connected) Online.socket.emit("race:tile", { id: id });
};

// ----- 5. コースからの知らせ -----
// 大型ビジョンと光の演出（見せ方だけ。ゲームの判定には関わらない）
const Show = {
  flash(text, sub, color, sec) { if (typeof Stadium !== "undefined" && Stadium.flash) Stadium.flash(text, sub, color, sec); },
  pulse(str, sec, rate) { if (typeof Stadium !== "undefined" && Stadium.pulse) Stadium.pulse(str, sec, rate); },
};

Course.onCheckpoint = cp => {
  Show.flash("CHECKPOINT " + cp.number, "CHECKPOINT PASSED", "#ff8a24", 2.2);
  Show.pulse(0.7, 1.0, 14);
  const passed = Course.checkpoints.filter(c => c.active).length;
  UI.setCheckpoint(passed, Course.checkpoints.length);
  UI.toast("CHECKPOINT " + cp.number + "!", "#3ddc84");
  Effects.burst(new THREE.Vector3(cp.x, cp.y + 4.5, cp.z), 50, 6);
};

Course.onGoal = racer => {
  racer.finishTime = game.time;
  if (!racer.isHuman) return; // CPU のゴールは記録だけ
  if (mode === "online") {
    // タイムはサーバーの時計で決まる（届いたらそのタイムにそろえる）
    Online.finish().then(res => {
      if (res && res.ok) {
        game.time = res.ms / 1000;
        UI.setTime(game.time);
      }
    });
  }
  game.state = "finished";
  player.frozen = true;
  game.celebrateTimer = 0;
  game.resultTimer = 1.8; // 少し喜んでから結果を出す
  UI.toast("GOAL!!", "#ffe45c");
  const g = Course.goal;
  Effects.burst(new THREE.Vector3(g.x - 3, g.y + 5, g.z), 60, 8);
  Effects.burst(new THREE.Vector3(g.x + 3, g.y + 5, g.z), 60, 8);
  Effects.shower(new THREE.Vector3(g.x, g.y, g.z - 4), 100, 10, 14); // 上から降る紙吹雪
  if (Course.goalArch) Course.goalArch.setLamp(0xffe45c, 2.2);
  Show.flash("FINISH", "TIME  " + formatTime(game.time), "#ffd04a", 7);
  Show.pulse(1.1, 4.5, 9);       // ゴール：スタジアムの照明とLEDが脈打つ
};

player.onFall = () => {
  if (game.state === "playing") {
    game.falls++;
    UI.setFalls(game.falls);
  }
};

// ウィンドウの大きさが変わったら画面を合わせる
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ----- 6. 状態ごとの処理 -----
function updateGame(dt) {
  if (mode === "online" && (game.state === "countdown" || game.state === "playing")) {
    // オンライン：残り時間とタイムは、サーバーのスタート時刻から計算する（全員そろう）
    const elapsed = (Online.serverNow() - raceStartAt) / 1000;
    if (game.state === "countdown") game.countdown = -elapsed;
    else game.time = elapsed;
  }
  if (game.state === "countdown") {
    if (mode !== "online") game.countdown -= dt;
    const n = Math.ceil(game.countdown);
    if (n !== game.lastCount && n > 0) {
      game.lastCount = n;
      UI.showCount(String(n));
      Sound.count();
      // スタート門のランプ：3=赤 → 2=黄 → 1=だいだい
      const lampColors = { 3: 0xff4d4d, 2: 0xffd23f, 1: 0xffa94d };
      if (Course.startArch && lampColors[n]) Course.startArch.setLamp(lampColors[n], 1.6);
      Show.flash(String(n), "GET READY", "#ffffff", 1.05);
      Show.pulse(0.5, 0.45, 20);     // カウントに合わせて照明が一拍光る
    }
    if (game.countdown <= 0) {
      game.state = "playing";
      racers.forEach(r => { r.frozen = false; });
      UI.showCount("GO!");
      Sound.go();
      if (Course.startArch) Course.startArch.setLamp(0x3ddc84, 2.0); // GO! は緑
      Show.flash("GO!", "", "#3ddc84", 1.4);
      Show.pulse(1.3, 1.3, 16);      // スタートの瞬間に会場全体の照明が強く光る
    }
  } else if (game.state === "playing") {
    if (mode !== "online") game.time += dt;
    UI.setTime(game.time);
  } else if (game.state === "finished") {
    // その場でピョンピョン跳ねて喜ぶ
    game.celebrateTimer -= dt;
    if (player.grounded && game.celebrateTimer <= 0) {
      player.velocity.y = 7;
      player.squash = 1.3;
      game.celebrateTimer = 0.7;
      Effects.burst(new THREE.Vector3(player.position.x, player.position.y + 2, player.position.z), 15, 4);
    }
    // 結果画面を出す
    if (game.resultTimer > 0) {
      game.resultTimer -= dt;
      if (game.resultTimer <= 0) showResults();
    }
  }
}

function showResults() {
  const isNewRecord = game.best === null || game.time < game.best;
  if (isNewRecord) {
    game.best = game.time;
    saveBest(game.time);
  }
  if (document.exitPointerLock) document.exitPointerLock(); // ボタンを押せるようにマウスの固定を外す
  UI.showResults(game.time, game.falls, game.best, isNewRecord);
  if (mode === "online") {
    UI.setRanking(Online.ranking(player));
    const btn = document.getElementById("retryBtn");
    btn.textContent = "みんなのゴールを待っています…";
    btn.disabled = true;
  } else {
    UI.setRanking(getRanking());
    document.getElementById("retryBtn").textContent = "もう一度あそぶ";
    document.getElementById("retryBtn").disabled = false;
  }
  UI.setTitleBest(game.best);
}

// ----- 順位 -----
// ゴールした人はタイム順、まだの人はコースの先にいる順（z が小さいほど先）
function getRanking() {
  return racers.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return a.position.z - b.position.z;
  });
}

// キャラ同士が重ならないように押し合う
function separateRacers() {
  const minDist = PLAYER_CONFIG.radius * 2;
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i].position;
      const b = racers[j].position;
      if (Math.abs(a.y - b.y) > 1.4) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.0001 && dist < minDist) {
        const push = (minDist - dist) / 2;
        a.x -= (dx / dist) * push;
        a.z -= (dz / dist) * push;
        b.x += (dx / dist) * push;
        b.z += (dz / dist) * push;
      }
    }
  }
}

// ----- 7. ゲームループ（1秒間に約60回くり返す） -----
const clock = new THREE.Clock();
const sunOffset = new THREE.Vector3(15, 30, 10);

function gameLoop() {
  requestAnimationFrame(gameLoop);
  // 前のフレームからの経過時間（重いときに大きくなりすぎないように上限をつける）
  const dt = Math.min(clock.getDelta(), 1 / 30);
  const active = game.state !== "title";

  if (active && Input.wasPressed("KeyR")) {
    if (mode === "online") player.respawn(true); // オンライン：最後のチェックポイントに戻る
    else startRun();                             // ひとりで：最初からやり直し
  }
  if (Input.wasPressed("KeyM")) {
    const muted = Sound.toggleMute();
    UI.toast(muted ? "SOUND OFF" : "SOUND ON", "#ffffff");
  }
  // I キー（ノートPCでは F3 が音量キーになっていることがあるため）
  // ----- 明るさ（, .）と階調（/）をその場で調整する。段階Aの詰め用 -----
  if (Input.wasPressed("Comma") || Input.wasPressed("Period")) {
    const step = Input.wasPressed("Period") ? 0.05 : -0.05;
    LOOK.exposure = Math.max(0.3, Math.min(3, Math.round((LOOK.exposure + step) * 100) / 100));
    renderer.toneMappingExposure = LOOK.exposure;
    try { localStorage.setItem("skyhop_exposure", String(LOOK.exposure)); } catch (e) {}
    statsOn = true;
    statsEl.classList.remove("hidden");   // 調整中は数値が見えるようにする
  }
  if (Input.wasPressed("Slash")) {
    const order = ["aces", "reinhard", "none"];
    LOOK.tone = order[(order.indexOf(LOOK.tone) + 1) % order.length];
    applyLook();
    // トーンマッピングを変えると影の描き方（シェーダ）を作り直す必要がある
    scene.traverse(o => {
      if (!o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; });
    });
    try { localStorage.setItem("skyhop_tone", LOOK.tone); } catch (e) {}
    statsOn = true;
    statsEl.classList.remove("hidden");
  }

  // ----- H キー：操作説明の開閉（ふだんは閉じて画面を広く使う）-----
  if (Input.wasPressed("KeyH")) {
    const box = document.getElementById("controls");
    if (box) box.classList.toggle("collapsed");
  }

  // ----- N キー：凹凸の陰影(Normal Map)を付け外しして負荷を実測する -----
  if (Input.wasPressed("KeyN")) {
    Mats.setNormal(!Mats.useNormal());
    Perf.reset();                      // 切りかえた直後から測り直す
    statsOn = true;
    statsEl.classList.remove("hidden");
  }

  if (Input.wasPressed("KeyI") || Input.wasPressed("F3")) {
    statsOn = !statsOn;
    statsEl.classList.toggle("hidden", !statsOn);
  }

  // 障害物を動かす（プレイヤーより先に動かすと、動く足場に乗ったときズレない）
  // オンラインでは、障害物の動きをサーバーのスタート時刻からの時間でそろえる
  const raceTime = mode === "online" && Online.inRace ? (Online.serverNow() - raceStartAt) / 1000 : undefined;
  Obstacles.update(dt, active ? activeRacers() : [], raceTime);
  if (active) {
    player.update(dt, getHumanControls(CameraController.yaw), world.colliders, world.ramps);
    if (mode === "solo") {
      for (const bot of bots) {
        bot.racer.update(dt, bot.think(dt, Course.waypoints, world), world.colliders, world.ramps);
      }
      separateRacers();
    } else {
      Online.separate(player);
    }
  }
  if (mode === "online") Online.update(dt, player, world.colliders, world.ramps);
  Course.update(dt, game.state === "playing" || game.state === "finished" ? activeRacers() : []);
  updateGame(dt);

  // 順位の表示
  if (active) {
    if (mode === "online") {
      const ranking = Online.ranking(player);
      UI.setRank(ranking.findIndex(r => r.isHuman) + 1, ranking.length);
    } else {
      const ranking = getRanking();
      UI.setRank(ranking.indexOf(player) + 1, racers.length);
      if (game.state === "finished") UI.setRanking(ranking); // 結果画面の順位表も更新し続ける
    }
  }

  world.update(dt);
  Effects.update(dt);
  CameraController.update(camera, player.position, dt, player);
  UI.setProgress(player.position.z);
  UI.setMouseHint(active && game.state !== "finished" && !Input.locked);

  // 太陽をキャラについて行かせる（どこにいても影がつくように）
  world.sun.position.copy(player.position).add(sunOffset);
  world.sun.target.position.copy(player.position);

  renderer.render(scene, camera);
  Perf.sample(dt, player.position.z, game.state === "playing");
  updatePanels(dt);
  Input.endFrame();
}

// ----- 画質の切りかえボタン -----
document.querySelectorAll(".qbtn").forEach(btn => {
  if (btn.dataset.q === Quality.level) btn.classList.add("on");
  btn.addEventListener("click", () => Quality.set(btn.dataset.q));
});
document.getElementById("qualityNote").textContent =
  QP.label + "（" + QP.note + "）― 解像度 " + QP.pixelRatio +
  " / 影 " + (QP.shadows ? "あり" : "なし") +
  " / 観客 " + Math.round(QP.crowdFill * 100) + "%";

// ----- 8. 大型ビジョンと、描画の情報（どちらも1秒に4回だけ更新する） -----
const statsEl = document.getElementById("stats");
let statsOn = false;
let panelTimer = 0;
let frames = 0;
let fps = 0;

function updatePanels(dt) {
  frames++;
  panelTimer += dt;
  if (panelTimer < 0.25) return;
  fps = Math.round(frames / panelTimer);
  frames = 0;
  panelTimer = 0;

  // スタジアムの大型ビジョン
  if (typeof Stadium !== "undefined" && Stadium.setLive) {
    const list = mode === "online" ? Online.ranking(player) : getRanking();
    Stadium.setLive({
      rank: Math.max(1, list.findIndex(r => r.isHuman === true) + 1),
      total: list.length,
      time: formatTime(game.time),
      cp: player.cpIndex,
      cpTotal: Course.checkpoints.length,
      falls: game.falls,
      ranking: list.slice(0, 4).map((r, i) => (i + 1) + "  " + r.name),
    });
  }

  // I キーの計測表示
  if (statsOn) {
    const info = renderer.info;
    const worstArea = Perf.worstArea();
    statsEl.textContent =
      "画質       " + QP.label + "\n" +
      "FPS 今     " + fps + "\n" +
      "FPS 平均   " + Math.round(Perf.average()) + "\n" +
      "FPS 最低   " + Math.round(Perf.worst) + "\n" +
      "30fps未満  " + Perf.slowFrames + " フレーム\n" +
      "ドローコール " + info.render.calls + "\n" +
      "三角形      " + info.render.triangles.toLocaleString() + "\n" +
      "ジオメトリ   " + info.memory.geometries + "\n" +
      "テクスチャ   " + info.memory.textures + "\n" +
      "画素密度    " + renderer.getPixelRatio().toFixed(2) + "\n" +
      "エリア別FPS " + (Perf.areaReport() || "-") + "\n" +
      "いちばん重い " + (worstArea ? worstArea.name + " " + Math.round(worstArea.fps) + "fps" : "-") + "\n" +
      "凹凸 N     " + (Mats.useNormal() ? "ON" : "OFF") + "\n" +
      "明るさ ,/.  " + LOOK.exposure.toFixed(2) + "\n" +
      "階調 /     " + LOOK.tone + "\n" +
      "ver        26";
  }
}

gameLoop();
