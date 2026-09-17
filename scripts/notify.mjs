// 겨를 알림 — GitHub Actions가 매시 30분에 실행합니다.
//
// 서버는 날짜만 압니다. 각 기기가 올려 둔 것:
//   users/{uid}/devices/{deviceId}  { token, hour, kinds:{memory,letter,checkup,book}, enabled, lastSent }
//   users/{uid}/meta/schedule       { days: { "2026-09-15": ["memory-year"], "2026-10-01": ["letter"], ... } }
// 일기 내용은 여기 없습니다. 알림 문구도 늘 내용 없이 갑니다 — 누르면 폰 안에서 풀려서 보입니다.

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  // 아직 열쇠를 안 넣었을 때. 실패로 처리하면 매시간 실패 알림이 가므로 조용히 끝냅니다.
  console.log("FIREBASE_SERVICE_ACCOUNT 비밀 값이 아직 없습니다. 넣으면 그때부터 보냅니다.");
  process.exit(0);
}
initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();
const fcm = getMessaging();

const APP_URL = "https://coherenceix-max.github.io/gyeoreul/";

// 한 기기에 하루 한 번, 가장 중요한 것 하나만 보냅니다.
const PRIORITY = ["test", "checkup-last", "checkup-open", "letter", "book", "memory-year", "memory-month"];
const TEXT = {
  "test": "알림이 잘 오는지 보는 중이에요",
  "checkup-last": "검진 기간이 이번 달까지예요",
  "checkup-open": "검진 기간이 시작됐어요",
  "letter": "이번 달 편지가 도착했어요",
  "book": "올해 책이 준비됐어요",
  "memory-year": "1년 전 오늘의 기록이 있어요",
  "memory-month": "한 달 전 오늘의 기록이 있어요"
};
const group = (k) => (k.startsWith("checkup") ? "checkup" : k.startsWith("memory") ? "memory" : k);

function kstNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

const { date, hour } = kstNow();
console.log(`한국 시각 ${date} ${hour}시 30분 실행`);

const devices = await db.collectionGroup("devices").get();
const schedules = new Map();
let sent = 0, skipped = 0, removed = 0;

for (const d of devices.docs) {
  const v = d.data();
  const userRef = d.ref.parent.parent; // users/{uid}
  if (!userRef || userRef.parent.id !== "users") continue;
  if (!v.token || v.enabled === false) { skipped++; continue; }

  if (!schedules.has(userRef.id)) {
    const s = await userRef.collection("meta").doc("schedule").get();
    schedules.set(userRef.id, s.exists ? s.data() : null);
  }
  const sch = schedules.get(userRef.id);
  const todays = (sch && sch.days && sch.days[date]) || [];
  const isTest = todays.includes("test"); // 시험 알림은 시각·하루한번 규칙을 건너뜁니다
  if (!isTest && (v.hour ?? 20) !== hour) continue;
  if (!isTest && v.lastSent === date) { skipped++; continue; }
  const kinds = v.kinds || {};
  const pick = PRIORITY.find((k) => todays.includes(k) && kinds[group(k)] !== false);
  if (!pick) continue;

  try {
    await fcm.send({
      token: v.token,
      webpush: {
        headers: { TTL: "43200", Urgency: "normal" },
        data: { title: "겨를", body: TEXT[pick], kind: pick, url: `${APP_URL}#${pick}` }
      }
    });
    if (pick === "test") {
      const left = todays.filter((k) => k !== "test");
      await userRef.collection("meta").doc("schedule").set({ days: Object.assign({}, sch.days, { [date]: left }) }, { merge: true });
      sch.days[date] = left;
    } else {
      await d.ref.update({ lastSent: date });
    }
    sent++;
  } catch (e) {
    const code = (e && e.errorInfo && e.errorInfo.code) || (e && e.code) || "";
    if (code.includes("registration-token-not-registered") || code.includes("invalid-registration-token")) {
      await d.ref.delete(); // 앱을 지웠거나 알림을 끈 기기
      removed++;
    } else {
      // 사용자 식별을 피하려고 앞 여섯 글자만 남깁니다
      console.error(`보내기 실패 (${userRef.id.slice(0, 6)}…): ${code || e.message}`);
    }
  }
}

console.log(`보냄 ${sent} · 건너뜀 ${skipped} · 만료된 기기 정리 ${removed}`);
