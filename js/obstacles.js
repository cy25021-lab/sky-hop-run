// =====================================================
//  obstacles.js ― 障害物（動くもの）をまとめたファイル
//
//   1. Hammer         … 回転する巨大ハンマー
//   2. Pusher         … 左右に動く壁
//   3. MovingPlatform … 動く足場
//   4. FallingTile    … 乗ると落ちる床
//   （5. 滑る坂道は world.js の addRamp で作る）
//
//  どの障害物も update(dt, player) を持っていて、毎フレーム呼ばれる
// =====================================================

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// -----------------------------------------------------
//  1. 回転する巨大ハンマー
//     中心の柱のまわりを、ハンマーの頭がぐるぐる回る
// -----------------------------------------------------
class Hammer {
  constructor(scene, world, center, radius, speed, headLength) {
    this.center = center.clone(); // 柱の根元（足場の上の面）
    this.radius = radius;         // 柱からハンマーの頭までの距離
    this.speed = speed;           // 回る速さ（ラジアン/秒）
    this.angle = 0;
    this.headRadius = 0.8;        // 頭の太さ
    this.headLength = headLength || 2.2; // 頭の長さ
    this.headHeight = 0.95;       // 頭の高さ（足場からの高さ）

    // 柱（ぶつかる）― 当たり判定は今までと同じ
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 3.6, 16), Mats.steel());
    // 柱を囲む鉄骨やぐら（参考イメージの、機械を支えるトラス）
    if (world.addTrussRun && Quality.preset.trussDetail > 0) {
      [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]].forEach(([dx, dz]) => {
        world.addTrussRun(center.x + dx, center.y + 1.8, center.z + dz, 3.6, "y");
      });
    }
    pole.position.set(center.x, center.y + 1.8, center.z);
    pole.castShadow = true;
    scene.add(pole);
    world.colliders.push({
      box: new THREE.Box3(V3(center.x - 0.5, center.y, center.z - 0.5), V3(center.x + 0.5, center.y + 3.6, center.z + 0.5)),
      mesh: pole,
    });

    // 根もとのゴムのクッションと、注意のしま模様の帯
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.15, 0.6, 16), Mats.rubber());
    base.position.set(center.x, center.y + 0.3, center.z);
    base.receiveShadow = true;
    scene.add(base);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.64, 0.8, 16), Mats.hazard());
    band.position.set(center.x, center.y + 1.0, center.z);
    scene.add(band);

    // 回る部分（Group ごと回転させる）
    this.group = new THREE.Group();
    this.group.position.copy(center);
    scene.add(this.group);

    // ハンマーは group ごと回るので、中身は素材ごとに1メッシュへ合体できる。
    // 当たり判定は数式（hitTest）で出しているので、見た目の合体では一切変わらない。
    const byMat = new Map();
    const put = (mat, part) => {
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat).push(part);
    };

    // 柱の上の回転ハウジングと、回っていることを知らせるランプ
    put(Mats.steel(), {
      geo: new THREE.CylinderGeometry(0.9, 0.75, 1.1, 16), x: 0, y: 3.45, z: 0,
    });
    put(Mats.warnLight(), {
      geo: new THREE.SphereGeometry(0.42, 16, 12), x: 0, y: 4.15, z: 0,
    });

    // 左右に2本のうでとハンマー
    const armGeo = new THREE.BoxGeometry(radius, 0.46, 0.46);
    const braceGeo = new THREE.BoxGeometry(radius * 0.92, 0.16, 0.16);
    const handleGeo = new THREE.CylinderGeometry(0.17, 0.17, 2.4, 10);
    const headGeo = new THREE.CylinderGeometry(
      this.headRadius, this.headRadius, this.headLength * 0.76, 20
    );
    const ringGeo = new THREE.CylinderGeometry(
      this.headRadius + 0.09, this.headRadius + 0.09, 0.34, 20
    );
    const capGeo = new THREE.CylinderGeometry(
      this.headRadius * 0.82, this.headRadius * 0.64, 0.5, 20
    );
    [1, -1].forEach(side => {
      // 横に伸びる桁
      put(Mats.steel(), { geo: armGeo, x: side * radius / 2, y: 3.4, z: 0 });
      // 斜めの補強材
      put(Mats.steel(), {
        geo: braceGeo, x: side * radius / 2, y: 2.95, z: 0, rz: side * -0.2,
      });
      // 下に伸びる柄
      put(Mats.steel(), { geo: handleGeo, x: side * radius, y: 2.2, z: 0 });
      // ハンマーの頭（横向きの太い赤いドラム。参考イメージの機械的な造形）
      put(Mats.drum(), {
        geo: headGeo, x: side * radius, y: this.headHeight, z: 0, rx: Math.PI / 2,
      });
      // 頭の両はしの帯とふた（ぶつかる面）
      [-1, 1].forEach(end => {
        put(Mats.rubber(), {
          geo: ringGeo, x: side * radius, y: this.headHeight,
          z: end * (this.headLength * 0.38), rx: Math.PI / 2,
        });
        put(Mats.steel(), {
          geo: capGeo, x: side * radius, y: this.headHeight,
          z: end * (this.headLength / 2 - 0.1), rx: Math.PI / 2,
        });
      });
    });

    // 素材ごとに1枚のメッシュにする（18個 → 4個）
    byMat.forEach((parts, mat) => {
      const mesh = new THREE.Mesh(Mats.mergeGeos(parts), mat);
      mesh.castShadow = true;
      this.group.add(mesh);
    });
  }

  // CPU用：ハンマーの頭が、点 (px, pz) に来るまであと何秒か（今そこにあれば 0）
  timeUntilHit(px, pz) {
    const phi = Math.atan2(-(pz - this.center.z), px - this.center.x); // 点の角度
    const halfWidth = (this.headLength / 2 + PLAYER_CONFIG.radius + 0.3) / this.radius; // 頭の幅（角度）
    let soonest = Infinity;
    [0, Math.PI].forEach(offset => {
      const head = this.angle + offset;
      let delta = (phi - head) % (Math.PI * 2);
      if (delta < 0) delta += Math.PI * 2;
      if (delta < halfWidth || delta > Math.PI * 2 - halfWidth) soonest = 0; // 今まさに通過中
      else soonest = Math.min(soonest, (delta - halfWidth) / Math.abs(this.speed));
    });
    return soonest;
  }

  // raceTime：レース開始からの時間（オンラインでは全員同じ。あれば、それで角度を決める）
  update(dt, racers, raceTime) {
    if (raceTime !== undefined) this.angle = this.speed * raceTime;
    else this.angle += this.speed * dt;
    this.group.rotation.y = this.angle;
    for (const racer of racers) this.hitTest(racer);
  }

  // --- ハンマーの頭とキャラがぶつかったか調べる ---
  hitTest(player) {
    const playerCenter = V3(player.position.x, player.position.y + 0.75, player.position.z);
    [1, -1].forEach(side => {
      // 頭の中心（回転を計算して求める）
      const cos = Math.cos(this.angle);
      const sin = Math.sin(this.angle);
      const head = V3(
        this.center.x + side * this.radius * cos,
        this.center.y + this.headHeight,
        this.center.z - side * this.radius * sin
      );
      // 頭が動いている向き（回転の接線方向）
      const tangent = V3(-side * sin, 0, -side * cos).multiplyScalar(Math.sign(this.speed));

      // 頭（円柱）のいちばん近い点との距離
      const diff = playerCenter.clone().sub(head);
      const along = Math.max(-this.headLength / 2, Math.min(this.headLength / 2, diff.dot(tangent)));
      const closest = head.clone().addScaledVector(tangent, along);
      const dist = playerCenter.distanceTo(closest);

      if (dist < this.headRadius + PLAYER_CONFIG.radius + 0.1) {
        // ハンマーが動く向き＋外側へ、大きくはじき飛ばす
        const outward = V3(head.x - this.center.x, 0, head.z - this.center.z).normalize();
        const push = tangent.clone().multiplyScalar(13).addScaledVector(outward, 4);
        player.knockback(push.x, 7, push.z);
      }
    });
  }
}

// -----------------------------------------------------
//  2. 左右に動く壁（ぶつかるとはじき飛ばされる）
// -----------------------------------------------------
class Pusher {
  constructor(scene, world, x, topY, z, range, speed, phase, width) {
    this.baseX = x;
    this.range = range;  // 左右に動く幅（片側）
    this.speed = speed;
    this.phase = phase;  // 動き出すタイミングをずらす
    this.time = phase;
    this.w = width || 2.2;
    this.h = 1.8;
    this.d = 1.2;
    this.y = topY;
    this.z = z;

    this.mesh = new THREE.Group();
    //  機械仕掛けに見せる：鋼材の筐体／ゴムの当たり面／油圧ロッド／警告の帯。
    //  動く向き（z）と大きさは変えていないので、当たり判定はこれまでと同じ。
    //  部品は素材ごとに1メッシュへ合体するので、描画命令は3つだけ。
    const byMat = new Map();
    const put = (mat, part) => {
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat).push(part);
    };
    // 筐体（鋼材）
    put(Mats.steel(), { geo: new THREE.BoxGeometry(this.w, this.h, this.d), x: 0, y: 0, z: 0 });
    // 上下のふち（明るいシルバー）＝角に光の線が出る
    [1, -1].forEach(v => {
      put(Mats.gateBright(), {
        geo: new THREE.BoxGeometry(this.w + 0.1, 0.14, this.d + 0.1),
        x: 0, y: v * (this.h / 2 - 0.07), z: 0,
      });
    });
    // 側面のボルト（4本ずつ）
    const boltGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.14, 8);
    [-1, 1].forEach(sx => {
      [-1, 1].forEach(sy => {
        put(Mats.gateBright(), {
          geo: boltGeo, rz: Math.PI / 2,
          x: sx * (this.w / 2 - 0.05), y: sy * this.h * 0.3, z: 0,
        });
      });
    });
    // 前後の当たり面（ゴム）と、その上の警告の帯
    [-1, 1].forEach(side => {
      put(Mats.rubber(), {
        geo: new THREE.BoxGeometry(this.w + 0.12, this.h * 0.62, 0.26),
        x: 0, y: 0, z: side * (this.d / 2 + 0.08),
      });
      put(Mats.hazard(), {
        geo: new THREE.BoxGeometry(this.w + 0.14, 0.26, 0.1),
        x: 0, y: this.h * 0.24, z: side * (this.d / 2 + 0.17),
      });
      // 押し出す油圧ロッド（奥へ伸びる）
      put(Mats.gateBright(), {
        geo: new THREE.CylinderGeometry(0.13, 0.13, 1.5, 10), rx: Math.PI / 2,
        x: 0, y: -this.h * 0.1, z: side * (this.d / 2 + 0.8),
      });
    });
    // 上をすべる金属のレール
    put(Mats.metal(), {
      geo: new THREE.BoxGeometry(this.w + 0.3, 0.18, this.d + 0.3),
      x: 0, y: this.h / 2 + 0.09, z: 0,
    });
    byMat.forEach((mat_parts, mat) => {
      const m = new THREE.Mesh(Mats.mergeGeos(mat_parts), mat);
      m.castShadow = (mat === Mats.steel());
      this.mesh.add(m);
    });
    scene.add(this.mesh);

    this.collider = {
      box: new THREE.Box3(),
      mesh: this.mesh,
      pusher: true,                    // 「押す壁」の印
      velocity: new THREE.Vector3(),   // 動いている速さ（はじき飛ばす向きに使う）
      delta: new THREE.Vector3(),      // 1フレームで動いた量（上に乗ったとき用）
    };
    world.colliders.push(this.collider);
    this.place(0);
  }

  // 現在の位置に見た目と当たり判定を合わせる
  place(dt) {
    const oldX = this.mesh.position.x;
    const x = this.baseX + Math.sin(this.time * this.speed) * this.range;
    this.mesh.position.set(x, this.y + this.h / 2, this.z);
    this.collider.box.set(
      V3(x - this.w / 2, this.y, this.z - this.d / 2),
      V3(x + this.w / 2, this.y + this.h, this.z + this.d / 2)
    );
    this.collider.delta.set(dt > 0 ? x - oldX : 0, 0, 0);
    this.collider.velocity.set(dt > 0 ? (x - oldX) / dt : 0, 0, 0);
  }

  update(dt, racers, raceTime) {
    this.time = raceTime !== undefined ? this.phase + raceTime : this.time + dt;
    this.place(dt);
  }

  // CPU用：t 秒後の壁の横位置
  xAt(t) {
    return this.baseX + Math.sin((this.time + t) * this.speed) * this.range;
  }
}

// -----------------------------------------------------
//  3. 動く足場（2つの地点の間を行ったり来たり）
// -----------------------------------------------------
class MovingPlatform {
  constructor(scene, world, from, to, size, speed, color) {
    this.from = from.clone();
    this.to = to.clone();
    this.size = size;
    this.speed = speed;
    this.time = 0;
    this.thick = 0.8;

    // 見た目は、止まっている足場と同じ作り（本体・ふち・天面・下の受け）
    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(
      Mats.boxUV(size, this.thick, size, size / 3, this.thick / 3), Mats.body(color)
    );
    body.position.y = -this.thick / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    // ふちの上面は天面（上面 +0.03）より下に置く。
    //  上に出ると、平らな箱が天面を覆い隠してしまう（ver14〜16 の不具合）
    const rim = new THREE.Mesh(new THREE.BoxGeometry(size + 0.18, 0.26, size + 0.18), Mats.edge());
    rim.position.y = -0.13;
    // 動く足場は機械仕掛けなので、天面を金属グレーチングにする（段階B）
    const deck = new THREE.Mesh(
      Mats.boxUV(size - 0.5, 0.18, size - 0.5, size / 2, size / 2), Mats.grating()
    );
    deck.position.y = -0.06;
    deck.receiveShadow = true;
    // エリア色の帯（どの足場かを横から見分ける）
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(size + 0.22, 0.14, size + 0.22), Mats.accent(color)
    );
    band.position.y = -0.38;
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(size * 0.45, 0.45, size * 0.45), Mats.support()
    );
    frame.position.y = -this.thick - 0.22;
    this.mesh.add(body, rim, deck, band, frame);
    scene.add(this.mesh);

    this.collider = { box: new THREE.Box3(), mesh: this.mesh, delta: new THREE.Vector3() };
    world.colliders.push(this.collider);
    this.mesh.position.copy(from);
    this.place();
  }

  place() {
    const p = this.mesh.position;
    const s = this.size / 2;
    this.collider.box.set(V3(p.x - s, p.y - this.thick, p.z - s), V3(p.x + s, p.y, p.z + s));
  }

  // t 秒後の位置（0 → 1 → 0 となめらかに往復する。端でゆっくりになる）
  positionAt(t) {
    const k = 0.5 - 0.5 * Math.cos((this.time + t) * this.speed);
    return this.from.clone().lerp(this.to, k);
  }

  update(dt, racers, raceTime) {
    this.time = raceTime !== undefined ? raceTime : this.time + dt;
    const newPos = this.positionAt(0);
    this.collider.delta.copy(newPos).sub(this.mesh.position); // 動いた量
    this.mesh.position.copy(newPos);
    this.place();
  }
}

// -----------------------------------------------------
//  4. 乗ると落ちる床
//     乗る → ガタガタ揺れる → 落ちる → しばらくすると元に戻る
// -----------------------------------------------------
class FallingTile {
  //  fallDelay：乗ってから落ち始めるまでの秒数（省略すると 0.6 秒）
  constructor(scene, world, x, topY, z, size, fallDelay) {
    this.id = Obstacles.tiles.length; // オンラインで「どの床か」を伝えるための番号
    Obstacles.tiles.push(this);
    this.home = V3(x, topY, z);
    this.size = size;
    this.thick = 0.6;
    this.fallDelay = fallDelay || 0.6;
    this.state = "idle"; // idle（ふつう）/ shaking（揺れ中）/ falling（落下中）
    this.timer = 0;
    this.fallSpeed = 0;

    //  ふだんは塗装された金属プレート。落ちる直前はオレンジに光らせる。
    //  合図は弱めず、色だけ競技場の配色（鋼＋オレンジ）にそろえる
    this.color = Mats.C(0x6f7a8a);
    this.warnColor = Mats.C(0xff6a1e);
    // 色は落ちるときに変えるので、この床だけの material を持つ
    this.material = new THREE.MeshStandardMaterial({
      color: this.color.clone(), map: Mats.tilePlate(),
      roughness: 0.5, metalness: Mats.metalness(0.45, 0.1),
      emissive: Mats.C(0x000000), emissiveIntensity: 1,
    });
    this.mesh = new THREE.Mesh(Mats.boxUV(size, this.thick, size, 1, 1), this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    this.collider = {
      box: new THREE.Box3(),
      mesh: this.mesh,
      onStand: racer => this.trigger(racer), // キャラが乗ったら呼ばれる
    };
    world.colliders.push(this.collider);
    this.reset();
  }

  reset() {
    this.state = "idle";
    this.timer = 0;
    this.fallSpeed = 0;
    this.mesh.position.set(this.home.x, this.home.y - this.thick / 2, this.home.z);
    this.mesh.visible = true;
    this.material.color.copy(this.color);
    this.material.emissive.setRGB(0, 0, 0);   // 光りっぱなしにならないよう戻す
    this.collider.disabled = false;
    const s = this.size / 2;
    this.collider.box.set(
      V3(this.home.x - s, this.home.y - this.thick, this.home.z - s),
      V3(this.home.x + s, this.home.y, this.home.z + s)
    );
  }

  trigger(racer) {
    if (this.state !== "idle") return;
    this.state = "shaking";
    this.timer = this.fallDelay; // この秒数のあとに落ちる
    this.heardByHuman = racer.isHuman;
    if (this.heardByHuman) Sound.shake();
    // 自分が乗って落ち始めたら、オンラインのほかの人にも知らせる
    if (racer.isHuman && racer.isLocal !== false && Obstacles.onTileTrigger) Obstacles.onTileTrigger(this.id);
  }

  update(dt) {
    if (this.state === "shaking") {
      this.timer -= dt;
      // ガタガタ揺らして、だんだん赤くする
      const shake = 0.06;
      this.mesh.position.x = this.home.x + (Math.random() - 0.5) * shake;
      this.mesh.position.z = this.home.z + (Math.random() - 0.5) * shake;
      const t = 1 - this.timer / this.fallDelay;
      this.material.color.copy(this.color).lerp(this.warnColor, t);
      // 落ちる直前ほど強く光らせる（暗いスタジアムでも合図がはっきり見える）
      this.material.emissive.copy(this.warnColor).multiplyScalar(t * 0.55);
      if (this.timer <= 0) {
        this.state = "falling";
        this.timer = 3; // 3秒後に元に戻る
        this.collider.disabled = true; // もう乗れない
        if (this.heardByHuman) Sound.crumble();
      }
    } else if (this.state === "falling") {
      this.timer -= dt;
      this.fallSpeed += 20 * dt;
      this.mesh.position.y -= this.fallSpeed * dt;
      if (this.timer <= 0) this.reset();
    }
  }
}

// -----------------------------------------------------
//  障害物をまとめて動かす
//  （どこに置くかは course.js で決める）
// -----------------------------------------------------
const Obstacles = {
  items: [],
  tiles: [],            // 落ちる床（番号順）
  onTileTrigger: null,  // 自分が床を落としたときに呼ぶ関数（オンライン用）

  add(item) {
    this.items.push(item);
    return item;
  },

  // racers：自分とCPUのリスト（ハンマーの当たり判定に使う）
  //  raceTime：オンラインでは、レース開始からの時間を渡すと全員の障害物の動きがそろう
  update(dt, racers, raceTime) {
    for (const item of this.items) item.update(dt, racers, raceTime);
  },
};
