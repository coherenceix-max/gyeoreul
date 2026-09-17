/* 겨를 — 오프라인 캐시. 버전은 index.html의 APP_V를 따라갑니다. */
const VERSION = "gyeoreul-v15";
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
// 알림: 서버가 보낸 내용 없는 알림을 띄우고, 누르면 해당 화면으로 엽니다.
self.addEventListener("push", (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (_) {}
  const d = p.data || p;
  e.waitUntil(self.registration.showNotification(d.title || "겨를", {
    body: d.body || "새 소식이 있어요",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: d.kind || "gyeoreul",
    data: { url: d.url || "./" }
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) {
        await c.focus();
        if ("navigate" in c) { try { await c.navigate(url); } catch (_) {} }
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(url);
  })());
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) {
    // 폰트와 Firebase 라이브러리만 캐시합니다. 한 번 받으면 오프라인에서도 열립니다.
    const cacheable =
      url.hostname === "fonts.googleapis.com" ||
      url.hostname === "fonts.gstatic.com" ||
      (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"));
    // 나머지(동기화 통신 등)는 건드리지 않고 그대로 통과시킵니다.
    if (!cacheable) return;
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
  // cache:"reload"로 브라우저 HTTP 캐시를 건너뛰어야 진짜 최신을 받아옵니다.
  e.respondWith(
    fetch(e.request.url, { cache: "reload" }).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("index.html")))
  );
});
