/*
 * 겨를 — 자체 호스팅용 빌드
 *
 *   node build.js
 *
 * index.html(아티팩트용 조각)을 읽어서 docs/ 에 완전한 PWA 한 벌을 만듭니다.
 *   docs/index.html          제대로 된 <head>가 붙은 완성 문서
 *   docs/manifest.webmanifest 앱 이름 · 아이콘 · 전체화면 설정
 *   docs/sw.js               오프라인용 서비스워커
 *   docs/icon-*.png          홈 화면 아이콘
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SRC = path.join(__dirname, "index.html");
const OUT = path.join(__dirname, "docs");

/* ---------- PNG 인코더 (의존성 없이) ---------- */
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- 아이콘: 나와 아이, 두 개의 기둥 ---------- */
function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = size / 512; // 512 기준으로 설계
  const bg = [0x14, 0x18, 0x1a];
  // [x, y, w, h, r, g, b] — 왼쪽 기둥이 "나", 오른쪽 더 긴 기둥이 아이
  const bars = [
    [148, 196, 68, 208, 0xa4, 0x9b, 0xe0],
    [296, 108, 68, 296, 0x85, 0xb8, 0x92],
  ];
  function inRounded(x, y, bx, by, bw, bh) {
    const r = bw / 2;
    if (x < bx || x > bx + bw || y < by || y > by + bh) return false;
    if (y >= by + r && y <= by + bh - r) return true;
    const cy = y < by + r ? by + r : by + bh - r;
    const cx = bx + r;
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let col = bg;
      // 4x 슈퍼샘플링으로 가장자리를 부드럽게
      let acc = null, hits = 0;
      for (const b of bars) {
        let sub = 0;
        for (let sy = 0; sy < 2; sy++)
          for (let sx = 0; sx < 2; sx++) {
            const ux = (x + (sx + 0.5) / 2) / S, uy = (y + (sy + 0.5) / 2) / S;
            if (inRounded(ux, uy, b[0], b[1], b[2], b[3])) sub++;
          }
        if (sub) { acc = b; hits = sub / 4; }
      }
      if (acc) {
        px[i]     = Math.round(bg[0] + (acc[4] - bg[0]) * hits);
        px[i + 1] = Math.round(bg[1] + (acc[5] - bg[1]) * hits);
        px[i + 2] = Math.round(bg[2] + (acc[6] - bg[2]) * hits);
      } else {
        px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2];
      }
      px[i + 3] = 255;
    }
  }
  return encodePng(size, size, px);
}

/* ---------- 빌드 ---------- */
fs.mkdirSync(OUT, { recursive: true });

const body = fs.readFileSync(SRC, "utf8");

// 아티팩트 조각에서 <title>과 폰트 <link>를 뽑아내 정식 <head>로 옮깁니다.
const title = (body.match(/<title>([^<]*)<\/title>/) || [, "겨를"])[1];
const fontLinks = (body.match(/<link[^>]*fonts\.(googleapis|gstatic)[^>]*>/g) || []).join("\n  ");
const rest = body
  .replace(/<title>[^<]*<\/title>\s*/, "")
  .replace(/<link[^>]*fonts\.(googleapis|gstatic)[^>]*>\s*/g, "");

const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${title}</title>
  <meta name="description" content="나와 아이의 하루를 나란히 쌓는 일기.">
  <link rel="manifest" href="manifest.webmanifest">
  <meta name="theme-color" content="#F3F5F2" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#121614" media="(prefers-color-scheme: dark)">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="겨를">
  <link rel="apple-touch-icon" href="icon-180.png">
  <link rel="icon" href="icon-192.png">
  ${fontLinks}
  <style>
    :root{color-scheme:light dark}
    body{margin:0;font:14px system-ui,sans-serif}
    img{max-width:100%}
    [hidden]{display:none!important}
  </style>
</head>
<body>
${rest}
<script>
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
}
</script>
</body>
</html>
`;

const manifest = {
  name: "겨를",
  short_name: "겨를",
  description: "나와 아이의 하루를 나란히 쌓는 일기.",
  start_url: "./",
  scope: "./",
  display: "standalone",
  orientation: "portrait",
  background_color: "#F3F5F2",
  theme_color: "#F3F5F2",
  lang: "ko",
  icons: [
    { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

const sw = `/* 겨를 — 오프라인 캐시. 앱을 고칠 때마다 VERSION을 올리세요. */
const VERSION = "gyeoreul-v2";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-180.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // 폰트는 받아오면 캐시에 넣어 두고, 다음부터는 오프라인에서도 씁니다.
  if (url.origin !== location.origin) {
    e.respondWith(
      caches.match(e.request).then((hit) =>
        hit || fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
          return res;
        }).catch(() => hit)
      )
    );
    return;
  }
  // 앱 파일은 네트워크를 먼저 보고, 안 되면 캐시로 — 새 버전을 놓치지 않게.
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("index.html")))
  );
});
`;

fs.writeFileSync(path.join(OUT, "index.html"), html, "utf8");
fs.writeFileSync(path.join(OUT, "manifest.webmanifest"), JSON.stringify(manifest, null, 2), "utf8");
fs.writeFileSync(path.join(OUT, "sw.js"), sw, "utf8");
for (const s of [180, 192, 512]) fs.writeFileSync(path.join(OUT, `icon-${s}.png`), drawIcon(s));

console.log("docs/ 생성 완료");
for (const f of fs.readdirSync(OUT)) {
  console.log("  " + f + "  " + (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1) + " KB");
}
