// =====================================================
//  camera.js ― キャラクターを後ろから追いかけるカメラ
//
//  操作（マウスで回す・ホイールでズーム）の感じは今までと同じ。
//  変えたのは「どこを・どれくらいの広さで見せるか」だけ。
// =====================================================

const CameraController = {
  yaw: 0,            // 横の回転（0 = キャラの後ろ）
  pitch: 0.34,       // 縦の角度（少し上から見下ろして、足場の高さを分かりやすく）
  distance: 8.5,     // キャラからの距離（競技場の大きさが伝わるよう、少し引いた）
  sensitivity: 0.0025, // マウス感度（今までと同じ）
  lookTarget: new THREE.Vector3(),
  ready: false,

  baseFov: 72,       // ふだんの視野角
  fov: 72,           // 今の視野角（速いほど広がる）
  extra: 0,          // 空中で少しだけ引く量

  update(camera, playerPos, dt, player) {
    // --- マウスでカメラを回す（ここは変更なし） ---
    const mouse = Input.consumeMouse();
    this.yaw -= mouse.x * this.sensitivity;
    this.pitch += mouse.y * this.sensitivity;
    this.pitch = Math.max(-0.2, Math.min(1.2, this.pitch)); // 真上・真下まで回らないように
    // 引ける限界を 14 → 20 に。スタジアム全体を見渡せる
    this.distance = Math.max(4, Math.min(20, this.distance + mouse.wheel * 0.01));

    // --- 見る場所：キャラの少し上＋進む先を少し先取り ---
    //  カメラが向いている方向へ 1.6m ずらすことで、コースの奥が多く見える
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const target = new THREE.Vector3(
      playerPos.x + forwardX * 1.6,
      playerPos.y + 1.3,
      playerPos.z + forwardZ * 1.6
    );
    if (!this.ready) {
      this.lookTarget.copy(target);
      this.ready = true;
    }
    this.lookTarget.lerp(target, 1 - Math.exp(-12 * dt));

    // --- 速さに応じて視野角を広げる（走っている感じを出す） ---
    const speed = player ? Math.hypot(player.velocity.x, player.velocity.z) : 0;
    const targetFov = this.baseFov + Math.min(speed / PLAYER_CONFIG.dashSpeed, 1.1) * 6;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-4 * dt));
    if (Math.abs(camera.fov - this.fov) > 0.05) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }

    // --- 落ちている間は少し引いて、着地点を見やすくする ---
    const wantExtra = player && !player.grounded && player.velocity.y < -6 ? 1.6 : 0;
    this.extra += (wantExtra - this.extra) * (1 - Math.exp(-5 * dt));
    const dist = this.distance + this.extra;

    // --- 球の表面の上にカメラを置くイメージ ---
    const horizontal = Math.cos(this.pitch) * dist;
    camera.position.set(
      this.lookTarget.x + Math.sin(this.yaw) * horizontal,
      this.lookTarget.y + Math.sin(this.pitch) * dist,
      this.lookTarget.z + Math.cos(this.yaw) * horizontal
    );
    camera.lookAt(this.lookTarget);
  },
};
