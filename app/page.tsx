"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DigitalHumanPanel from "./components/AvatarStudioPanel";
import { PERSONAS, type ChatMessage, type CourseItem, type EmotionType, type PersonaKey, type TodoItem, type VoiceGender } from "./types";

type VoiceTone = "clara" | "ajie";
const TTS_RATE_MULTIPLIER = 1.25;

type GeoLocationContext = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  updatedAt: number;
};

type UserChatProfile = {
  styleSummary: string;
  topTopics: string[];
  shortcuts: string[];
};

type ToastAction = {
  label: string;
  kind: "dismiss" | "todo-complete" | "todo-snooze" | "todo-reschedule" | "notice-confirm" | "notice-dismiss" | "schedule-confirm" | "schedule-dismiss";
  targetId?: string;
  variant?: "primary" | "secondary" | "danger";
};

type ToastState = {
  title: string;
  body: string;
  actions?: ToastAction[];
};

type NoticeDraft = {
  title: string;
  remindAt: number | null;
  location?: string;
  details?: string;
};

type ScheduleDraft = {
  courses: Array<{ weekday: number; date?: string; title: string; classroom: string; startTime: string; endTime?: string }>;
};

const DEFAULT_SHORTCUTS = [
  "今天天气怎么样",
  "可以详细说说吗",
  "我明白了",
];

type SpeechRecognitionResultItem = { transcript: string };
type SpeechRecognitionResult = {
  isFinal: boolean;
  [n: number]: SpeechRecognitionResultItem | undefined;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: { length: number; [n: number]: SpeechRecognitionResult | undefined };
};
type SpeechRecognitionErrorLike = { error: string };
type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function nowId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatDateTime(ts: number) {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${month}-${day} ${formatTime(ts)}`;
}

function getTodayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseClockToTimestamp(value: string, base = new Date()) {
  const [hhRaw, mmRaw] = value.split(":");
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm, 0, 0);
  return dt.getTime();
}

function parseClockToNextTimestamp(value: string, base = new Date()) {
  const ts = parseClockToTimestamp(value, base);
  if (ts === null) return null;
  if (ts > Date.now()) return ts;
  const next = new Date(ts);
  next.setDate(next.getDate() + 1);
  return next.getTime();
}

function getGreetingByHour() {
  const hour = new Date().getHours();
  if (hour < 9) return "早上好";
  if (hour < 12) return "上午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

const LEGACY_WELCOME_TEXT = "您好，我是您的生活助手，现在开始美好的一天吧，吃早饭了么！";

function buildLoginGreetingText() {
  const greeting = getGreetingByHour();
  if (greeting === "早上好") {
    return "早上好，我是您的生活助手。新的一天开始了，我会陪你安排好学习与生活。";
  }
  if (greeting === "上午好") {
    return "上午好，我是您的生活助手。今天的学习计划我会按节奏提醒你。";
  }
  if (greeting === "下午好") {
    return "下午好，我是您的生活助手。下午的课程和待办我会帮你盯好时间点。";
  }
  return "晚上好，我是您的生活助手。辛苦一天了，今晚也让我继续陪你。";
}

function buildLoginWelcomeMessage(): ChatMessage {
  return {
    id: nowId("m"),
    role: "assistant",
    text: buildLoginGreetingText(),
    createdAt: Date.now(),
  };
}

function buildTodoSuggestion(todo: Pick<TodoItem, "title" | "location">) {
  const text = `${todo.title}${todo.location ? ` ${todo.location}` : ""}`;
  if (/(作业|论文|报告|实验)/.test(text)) {
    return "建议先用 10 分钟列一个最小完成清单，再从第一步开始。";
  }
  if (/(答辩|汇报|ppt|展示)/i.test(text)) {
    return "建议先检查材料和演示文件，再预留 5 分钟提前到场。";
  }
  if (/(开会|会议|面试|沟通)/.test(text)) {
    return "建议先确认地点和要点，提前两分钟整理好要说的内容。";
  }
  return "建议先花 2 分钟启动这件事，开始之后会更容易继续。";
}

type WeatherCardData = {
  condition: string;
  temperature: string;
  wind: string;
  clothing: string;
  symbol: string;
};

function pickWeatherSymbol(condition: string) {
  if (/雷|暴/.test(condition)) return "⛈️";
  if (/雪|冰/.test(condition)) return "❄️";
  if (/雨|阵雨|毛毛雨/.test(condition)) return "🌧️";
  if (/雾|霾/.test(condition)) return "🌫️";
  if (/多云|少云|阴/.test(condition)) return "⛅";
  if (/晴/.test(condition)) return "☀️";
  return "🌤️";
}

function parseWeatherBrief(brief: string): WeatherCardData | null {
  if (!brief.trim()) return null;

  const condition = brief.match(/天气[：:]\s*([^，。]+)/)?.[1]?.trim()
    || brief.match(/当前[^，。]*?(晴|多云|少云|阴|有雾|毛毛雨|小到大雨|小到大雪|阵雨|雷雨)/)?.[1]?.trim()
    || "天气多变";

  const temperature = brief.match(/气温约\s*([^，。]+)/)?.[1]?.trim()
    || brief.match(/气温\s*([^，。]+)/)?.[1]?.trim()
    || "未知";

  const wind = brief.match(/风速约\s*([^，。]+)/)?.[1]?.trim()
    || brief.match(/风速\s*([^，。]+)/)?.[1]?.trim()
    || "未知";

  const clothingRaw = brief.split("。").slice(1).join("。").trim();
  const clothing = clothingRaw || "建议按体感分层穿搭，出门前留意温度变化。";

  return {
    condition,
    temperature,
    wind,
    clothing,
    symbol: pickWeatherSymbol(condition),
  };
}

function weatherCodeToTextLocal(code: number) {
  if (code === 0) return "晴";
  if (code === 1 || code === 2) return "少云";
  if (code === 3) return "多云";
  if (code === 45 || code === 48) return "有雾";
  if (code === 51 || code === 53 || code === 55) return "毛毛雨";
  if (code === 61 || code === 63 || code === 65) return "小到大雨";
  if (code === 71 || code === 73 || code === 75) return "小到大雪";
  if (code === 80 || code === 81 || code === 82) return "阵雨";
  if (code === 95 || code === 96 || code === 99) return "雷雨";
  return "天气多变";
}

function buildClothingSuggestionLocal(tempC: number | null, weatherCode: number | null, windSpeed: number | null) {
  if (tempC === null) {
    return "建议按体感分层穿搭，出门前留意温度变化。";
  }
  const rainy = weatherCode !== null && [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(weatherCode);
  const windy = windSpeed !== null && windSpeed >= 25;

  let suggestion = "";
  if (tempC >= 30) suggestion = "天气偏热，建议短袖为主，注意补水和防晒。";
  else if (tempC >= 24) suggestion = "体感偏暖，建议短袖或薄长袖，早晚可加一件轻薄外套。";
  else if (tempC >= 18) suggestion = "体感舒适，建议薄长袖或衬衫，早晚可加针织外套。";
  else if (tempC >= 12) suggestion = "稍有凉意，建议外套 + 长裤，注意颈部和脚踝保暖。";
  else if (tempC >= 5) suggestion = "天气较冷，建议厚外套或大衣，内搭保暖层。";
  else suggestion = "天气寒冷，建议羽绒服/厚棉服，并做好防寒保暖。";

  if (rainy) suggestion += " 可能有降水，建议携带雨具并优先防水鞋面。";
  if (windy) suggestion += " 风较大，外套建议防风材质。";
  return suggestion;
}

type DirectWeatherSnapshot = {
  city: string;
  condition: string;
  temp: string;
  wind: string;
  clothing: string;
};

async function fetchDirectWeatherSnapshot(location: GeoLocationContext | null): Promise<DirectWeatherSnapshot | null> {
  try {
    let latitude: number;
    let longitude: number;
    let city = "北京";

    if (location) {
      latitude = location.latitude;
      longitude = location.longitude;
      city = "你所在位置";
    } else {
      const geoRes = await fetch("https://geocoding-api.open-meteo.com/v1/search?name=北京&count=1&language=zh&format=json");
      if (!geoRes.ok) return null;
      type GeoResp = { results?: Array<{ latitude: number; longitude: number; name?: string }> };
      const geoData = (await geoRes.json().catch(() => null)) as GeoResp | null;
      const top = geoData?.results?.[0];
      if (!top) return null;
      latitude = top.latitude;
      longitude = top.longitude;
      city = top.name || "北京";
    }

    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m&timezone=Asia%2FShanghai`,
    );
    if (!weatherRes.ok) return null;

    type WeatherResp = {
      current?: {
        temperature_2m?: number;
        weather_code?: number;
        wind_speed_10m?: number;
      };
    };
    const weatherData = (await weatherRes.json().catch(() => null)) as WeatherResp | null;
    const current = weatherData?.current;
    if (!current) return null;

    const tempC = typeof current.temperature_2m === "number" ? current.temperature_2m : null;
    const weatherCode = typeof current.weather_code === "number" ? current.weather_code : null;
    const windKmh = typeof current.wind_speed_10m === "number" ? current.wind_speed_10m : null;

    return {
      city,
      condition: weatherCodeToTextLocal(weatherCode ?? -1),
      temp: tempC !== null ? `${tempC}°C` : "未知",
      wind: windKmh !== null ? `${windKmh} km/h` : "未知",
      clothing: buildClothingSuggestionLocal(tempC, weatherCode, windKmh),
    };
  } catch {
    return null;
  }
}

function extractJsonObjectFromText(raw: string) {
  const text = raw.trim();
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlock?.[1]) return codeBlock[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function weekdayToChinese(weekday: number) {
  const names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return names[weekday] || "";
}

function courseCountdownText(startAt: number) {
  const diffMs = startAt - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin <= 0) return "即将开始";
  if (diffMin < 60) return `${diffMin} 分钟后开始`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return `${h} 小时 ${m} 分钟后开始`;
}

function toNextWeekdayTimestamp(weekday: number, clock: string) {
  const [hhRaw, mmRaw] = clock.split(":");
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

  const now = new Date();
  const dayDiff = (weekday - now.getDay() + 7) % 7;
  const target = new Date(now);
  target.setDate(now.getDate() + dayDiff);
  target.setHours(hh, mm, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 7);
  }
  return target.getTime();
}

function toDateClockTimestamp(dateText: string, clock: string) {
  const [hhRaw, mmRaw] = clock.split(":");
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

  const ymd = dateText.trim().replace(/[年.]/g, "-").replace(/[月]/g, "-").replace(/[日]/g, "").replace(/\//g, "-");
  const match = ymd.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const dt = new Date(year, month - 1, day, hh, mm, 0, 0);
  if (!Number.isFinite(dt.getTime())) return null;
  return dt.getTime();
}

function weekdayFromTimestamp(ts: number) {
  const wd = new Date(ts).getDay();
  return wd === 0 ? 7 : wd;
}

function resolveCourseClockAt(
  item: { date?: string; weekday: number },
  clock: string,
  nowMs = Date.now(),
) {
  const byDate = item.date ? toDateClockTimestamp(item.date, clock) : null;
  const byWeekday = item.weekday >= 1 && item.weekday <= 7
    ? toNextWeekdayTimestamp(item.weekday, clock)
    : null;

  if (byDate === null) return byWeekday;
  if (byWeekday === null) return byDate;

  if (weekdayFromTimestamp(byDate) !== item.weekday) {
    return byWeekday;
  }

  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  if (byDate < nowMs && byWeekday > nowMs && byWeekday - nowMs <= threeDaysMs) {
    return byWeekday;
  }

  return byDate;
}

function resolveCourseStartAt(
  item: { date?: string; weekday: number; startTime: string },
  nowMs = Date.now(),
) {
  return resolveCourseClockAt(item, item.startTime, nowMs);
}

function resolveCourseEndAt(
  item: { date?: string; weekday: number; startTime: string; endTime?: string },
  nowMs = Date.now(),
) {
  if (!item.endTime || !/^\d{1,2}:\d{2}$/.test(item.endTime)) return null;
  const endAt = resolveCourseClockAt(item, item.endTime, nowMs);
  if (endAt === null) return null;
  const startAt = resolveCourseStartAt(item, nowMs);
  if (startAt !== null && endAt <= startAt) return null;
  return endAt;
}

function toUpcomingWeeklyTimestamp(startAt: number, nowMs = Date.now()) {
  if (!Number.isFinite(startAt)) return null;
  if (startAt > nowMs) return startAt;
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const diff = nowMs - startAt;
  const weeksToAdd = Math.floor(diff / weekMs) + 1;
  return startAt + weeksToAdd * weekMs;
}

function safeHasWebSpeech() {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
    speechSynthesis?: SpeechSynthesis;
  };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

const FEMALE_PREFERRED_VOICE_HINTS = ["lisa", "ningguang", "丽莎", "凝光"];
const MALE_PREFERRED_VOICE_HINTS = ["li zeyan", "li zheyan", "李泽言", "zeyan"];

function containsAnyHint(source: string, hints: string[]) {
  return hints.some((hint) => source.includes(hint));
}

function scoreVoice(name: string, lang: string, gender: VoiceGender) {
  const lower = name.toLowerCase();
  const langLower = lang.toLowerCase();
  let score = 0;
  if (langLower.includes("zh")) score += 40;
  if (langLower.includes("cn")) score += 10;

  const femaleHints = ["female", "女", "xiaoxiao", "xiaoyi", "xiaomei", "meimei"];
  const maleHints = ["male", "男", "yunxi", "yunjian", "jun", "gang", "xiaogang"];

  if (gender === "female") {
    if (containsAnyHint(lower, FEMALE_PREFERRED_VOICE_HINTS)) score += 120;
    if (containsAnyHint(lower, MALE_PREFERRED_VOICE_HINTS)) score -= 60;
    if (femaleHints.some((hint) => lower.includes(hint))) score += 30;
    if (maleHints.some((hint) => lower.includes(hint))) score -= 10;
  }
  if (gender === "male") {
    if (containsAnyHint(lower, MALE_PREFERRED_VOICE_HINTS)) score += 120;
    if (containsAnyHint(lower, FEMALE_PREFERRED_VOICE_HINTS)) score -= 60;
    if (maleHints.some((hint) => lower.includes(hint))) score += 30;
    if (femaleHints.some((hint) => lower.includes(hint))) score -= 10;
  }

  return score;
}

function pickBestVoice(voices: SpeechSynthesisVoice[], gender: VoiceGender) {
  if (voices.length === 0) return null;
  const ranked = [...voices]
    .map((voice) => ({ voice, score: scoreVoice(voice.name, voice.lang, gender) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.voice || null;
}

function toneLabel(tone: VoiceTone) {
  if (tone === "clara") return "克拉拉（温柔平和）";
  return "阿杰（沉稳清冷）";
}

function toneConfig(tone: VoiceTone, detectedGender: VoiceGender) {
  if (tone === "clara") {
    // 贴近“克拉拉”观感：温柔、平和、没有攻击性。
    return { preferGender: "female" as VoiceGender, pitch: 1.08, rate: 0.92, volume: 1 };
  }

  // 贴近“阿杰”观感：清冷、辨识度高、略带距离感。
  return {
    preferGender: "male" as VoiceGender,
    pitch: detectedGender === "female" ? 0.9 : 0.86,
    rate: 0.94,
    volume: 1,
  };
}

function sanitizeTextForSpeech(raw: string) {
  let text = raw;

  // 常见单位先标准化，避免被逐字母朗读。
  text = text.replace(/(\d+(?:\.\d+)?)\s*(?:°\s*C|℃)/gi, "$1摄氏度");
  text = text.replace(/(\d+(?:\.\d+)?)\s*(?:km\s*\/\s*h|kmh)/gi, "$1公里每小时");
  text = text.replace(/(\d+(?:\.\d+)?)\s*(?:m\s*\/\s*s|mps)/gi, "$1米每秒");
  text = text.replace(/\bkm\b/gi, "公里");

  // 去掉代码块与行内代码，避免读出符号噪音。
  text = text.replace(/```[\s\S]*?```/g, "。");
  text = text.replace(/`[^`]+`/g, " ");

  // 去掉 markdown 图片，链接保留可读文本。
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");

  // 去掉 URL 与简单 HTML 标签。
  text = text.replace(/https?:\/\/\S+/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");

  // 去掉 emoji / 表情图标，仅保留可读字符与常见标点。
  text = text.replace(/\p{Extended_Pictographic}+/gu, " ");
  text = text.replace(/[^\p{Script=Han}\p{L}\p{N}\s，。！？；：、“”‘’（）《》【】,.!?;:'"\-…]/gu, " ");

  // 收敛空白和重复标点，得到更自然的朗读输入。
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{2,}/g, "\n");
  text = text.replace(/([。！？!?；;，,])\1+/g, "$1");

  return text.trim();
}

function splitSpeechSegments(text: string) {
  const normalized = text
    .replace(/[\r\n]+/g, "\n")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .join(" ");

  const bySentence = normalized
    .split(/(?<=[。！？!?；;])/)
    .map((x) => x.trim())
    .filter(Boolean);

  const segments: string[] = [];
  for (const sentence of bySentence) {
    if (sentence.length <= 30) {
      segments.push(sentence);
      continue;
    }
    const byComma = sentence
      .split(/(?<=[，,：:])/)
      .map((x) => x.trim())
      .filter(Boolean);
    segments.push(...byComma);
  }
  return segments.slice(0, 24);
}

function segmentProsody(segment: string, base: { pitch: number; rate: number; volume: number }, index: number, total: number) {
  let pitch = base.pitch;
  let rate = base.rate;

  if (/[?？]$/.test(segment)) {
    pitch += 0.06;
    rate += 0.03;
  }
  if (/[!！]$/.test(segment)) {
    pitch += 0.08;
    rate += 0.04;
  }
  if (/[…]{1,2}$/.test(segment)) {
    rate -= 0.06;
  }

  if (segment.length >= 22) rate -= 0.03;
  if (segment.length <= 8) rate += 0.02;

  // 中段略快，结尾回落，更像自然对话节奏。
  const centerBias = total > 1 ? 1 - Math.abs((index - (total - 1) / 2) / ((total - 1) / 2 || 1)) : 0;
  rate += centerBias * 0.015;
  rate *= TTS_RATE_MULTIPLIER;

  return {
    pitch: Math.min(1.35, Math.max(0.72, pitch)),
    rate: Math.min(1.35, Math.max(0.78, rate)),
    volume: base.volume,
    // 缩短停顿，增强连贯感，接近自然语速。
    pauseMs: /[。！？!?]$/.test(segment)
      ? 70
      : /[，,；;：:]$/.test(segment)
        ? 35
        : 20,
  };
}

function inferUserChatProfile(messages: ChatMessage[]): UserChatProfile {
  const userTexts = messages
    .filter((m) => m.role === "me")
    .map((m) => (m.sticker || m.text || "").trim())
    .filter(Boolean);

  if (userTexts.length < 3) {
    return {
      styleSummary: "聊天画像：样本较少，先使用通用快捷短句。",
      topTopics: ["通用聊天"],
      shortcuts: DEFAULT_SHORTCUTS,
    };
  }

  const topicRules: Array<{ name: string; test: RegExp; shortcut: string }> = [
    {
      name: "天气与出行",
      test: /(天气|温度|气温|下雨|穿衣|出门|降温|几度)/,
      shortcut: "帮我结合当前位置给出今天穿衣建议",
    },
    {
      name: "提醒与待办",
      test: /(提醒|待办|闹钟|日程|定时|计划|安排)/,
      shortcut: "帮我把这件事设置成待办提醒",
    },
    {
      name: "解释与学习",
      test: /(详细|为什么|怎么|步骤|原理|解释|举例)/,
      shortcut: "请分步骤详细解释一下",
    },
    {
      name: "总结归纳",
      test: /(总结|概括|重点|要点|梳理|复盘)/,
      shortcut: "请把刚才内容总结成三条重点",
    },
    {
      name: "建议决策",
      test: /(建议|推荐|怎么选|哪个好|方案|对比)/,
      shortcut: "请给我三个可执行建议",
    },
  ];

  const topicScore = new Map<string, { count: number; shortcut: string }>();
  for (const text of userTexts) {
    for (const rule of topicRules) {
      if (!rule.test.test(text)) continue;
      const prev = topicScore.get(rule.name);
      topicScore.set(rule.name, {
        count: (prev?.count ?? 0) + 1,
        shortcut: rule.shortcut,
      });
    }
  }

  const sortedTopics = [...topicScore.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name]) => name);

  const totalChars = userTexts.reduce((sum, text) => sum + text.length, 0);
  const avgLength = totalChars / userTexts.length;
  const questionRatio = userTexts.filter((text) => /[？?]/.test(text)).length / userTexts.length;
  const politeRatio = userTexts.filter((text) => /(请|麻烦|谢谢|辛苦|劳烦)/.test(text)).length / userTexts.length;

  const styleParts: string[] = [];
  styleParts.push(avgLength <= 10 ? "短句高频" : avgLength <= 22 ? "表达精炼" : "描述详细");
  if (questionRatio >= 0.45) styleParts.push("提问导向");
  else styleParts.push("陈述导向");
  if (politeRatio >= 0.3) styleParts.push("礼貌交流");

  const topTopics = sortedTopics.slice(0, 2);
  const topicText = topTopics.length ? `常聊${topTopics.join("、")}` : "常聊通用话题";
  const styleSummary = `聊天画像：${styleParts.join("、")}，${topicText}。`;

  const dynamicShortcuts: string[] = [];
  if (topTopics.includes("天气与出行")) {
    dynamicShortcuts.push(DEFAULT_SHORTCUTS[0]!);
  }
  for (const [, value] of [...topicScore.entries()].sort((a, b) => b[1].count - a[1].count)) {
    if (dynamicShortcuts.length >= 3) break;
    dynamicShortcuts.push(value.shortcut);
  }
  if (!dynamicShortcuts.includes("可以详细说说吗") && dynamicShortcuts.length < 3) {
    dynamicShortcuts.push("可以详细说说吗");
  }
  if (!dynamicShortcuts.includes("我明白了") && dynamicShortcuts.length < 3) {
    dynamicShortcuts.push("我明白了");
  }
  while (dynamicShortcuts.length < 3) {
    dynamicShortcuts.push(DEFAULT_SHORTCUTS[dynamicShortcuts.length] || "可以换个说法吗");
  }

  return {
    styleSummary,
    topTopics,
    shortcuts: dynamicShortcuts.slice(0, 3),
  };
}

export default function Home() {
  // 首屏使用稳定初始值，避免 SSR 与客户端首帧不一致导致 hydration 报错。
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [draft, setDraft] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isPolishingVoice, setIsPolishingVoice] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [voiceGender, setVoiceGender] = useState<VoiceGender>(null);
  const [speechReady, setSpeechReady] = useState(false);
  const [speechUnlocked, setSpeechUnlocked] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(true);
  const [voiceTone, setVoiceTone] = useState<VoiceTone>("clara");
  const [imageMode, setImageMode] = useState<"schedule" | "noticeSummary">("schedule");
  const [userLocation, setUserLocation] = useState<GeoLocationContext | null>(null);
  const [locationReady, setLocationReady] = useState(false);

  // ─── 情绪状态（驱动数字人表情） ───────────────────────────────────────────────
  const [emotion, setEmotion] = useState<EmotionType>("neutral");

  // ─── 人格设定 ─────────────────────────────────────────────────────────────────
  const [personaKey, setPersonaKey] = useState<PersonaKey>("default");
  const currentPersona = PERSONAS.find((p) => p.key === personaKey) ?? PERSONAS[0]!;

  // ─── 流式回复中间件文本 ────────────────────────────────────────────────────────
  const [streamingText, setStreamingText] = useState<string | null>(null);

  // ─── 待办：挂载后从 localStorage 恢复 ──────────────────────────────────────────
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [todoTitle, setTodoTitle] = useState("");
  const [todoTime, setTodoTime] = useState(""); // "HH:MM"

  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [nextCourseOverride, setNextCourseOverride] = useState<CourseItem | null>(null);

  const [weatherBrief, setWeatherBrief] = useState<string | null>(null);
  const [weatherUpdatedAt, setWeatherUpdatedAt] = useState<number | null>(null);
  const [isRefreshingWeather, setIsRefreshingWeather] = useState(false);
  const [noticeDraft, setNoticeDraft] = useState<NoticeDraft | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null);

  const [toast, setToast] = useState<ToastState | null>(null);
  const [storageReady, setStorageReady] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const voiceBaseDraftRef = useRef("");
  const voiceInterimRef = useRef("");
  const voiceFinalRef = useRef("");
  const polishingAbortRef = useRef<AbortController | null>(null);
  const pendingSpeakRef = useRef<string | null>(null);

  const userChatProfile = useMemo(() => inferUserChatProfile(messages), [messages]);
  const stickers = userChatProfile.shortcuts;
  const pendingTodos = useMemo(
    () => todos.filter((item) => !item.done).sort((a, b) => a.remindAt - b.remindAt),
    [todos],
  );
  const pendingTodoCount = pendingTodos.length;
  const todayTodoPreview = pendingTodos.slice(0, 3);
  const activeCourseCount = courses.filter((item) => !item.done && item.startAt >= Date.now() - 15 * 60 * 1000).length;
  const renderedMessages = useMemo(
    () => messages.filter((m) => !((m.text || "").startsWith("已切换为「") && m.role === "assistant")),
    [messages],
  );
  const nextCourse = useMemo(
    () => {
      const now = Date.now();
      if (nextCourseOverride && !nextCourseOverride.done && nextCourseOverride.startAt > now) {
        return nextCourseOverride;
      }
      return courses
        .filter((item) => !item.done && item.startAt > now)
        .sort((a, b) => a.startAt - b.startAt)[0] ?? null;
    },
    [courses, nextCourseOverride],
  );
  const weatherCard = useMemo(
    () => (weatherBrief ? parseWeatherBrief(weatherBrief) : null),
    [weatherBrief],
  );
  const toastActions: ToastAction[] = toast?.actions && toast.actions.length > 0
    ? toast.actions
    : [{ label: "知道了", kind: "dismiss", variant: "primary" }];

  const latestAssistantText = useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant" && m.text)?.text ?? "",
    [messages],
  );

  useEffect(() => {
    document.title = "伴你左右";
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const savedMessages = localStorage.getItem("bny-messages");
      if (savedMessages) {
        const parsed = JSON.parse(savedMessages) as ChatMessage[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const normalized = parsed.map((msg, index) => {
            if (index === 0 && msg.role === "assistant" && (msg.text || "").trim() === LEGACY_WELCOME_TEXT) {
              return {
                ...msg,
                text: buildLoginGreetingText(),
              };
            }
            return msg;
          });
          setMessages(normalized);
        } else {
          setMessages([buildLoginWelcomeMessage()]);
        }
      } else {
        setMessages([buildLoginWelcomeMessage()]);
      }
    } catch {
      setMessages([buildLoginWelcomeMessage()]);
    }

    try {
      const savedTodos = localStorage.getItem("bny-todos");
      if (savedTodos) {
        const parsed = JSON.parse(savedTodos) as TodoItem[];
        if (Array.isArray(parsed)) setTodos(parsed);
      }
    } catch {
      // ignore
    }

    try {
      const savedCourses = localStorage.getItem("bny-courses");
      if (savedCourses) {
        const parsed = JSON.parse(savedCourses) as CourseItem[];
        if (Array.isArray(parsed)) setCourses(parsed);
      }
    } catch {
      // ignore
    }

    try {
      setVoiceEnabled(localStorage.getItem("bny-voice-enabled") !== "0");
    } catch {
      // ignore
    }

    try {
      const savedTone = localStorage.getItem("bny-voice-tone");
      if (savedTone === "clara" || savedTone === "ajie") {
        setVoiceTone(savedTone);
      }
    } catch {
      // ignore
    }

    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setLocationReady(true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          updatedAt: Date.now(),
        });
        setLocationReady(true);
      },
      () => {
        setLocationReady(true);
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 5 * 60 * 1000,
      },
    );
  }, []);

  // 消息持久化到 localStorage（最多保留 100 条，排除含大 imageDataUrl 的条目以节省空间）
  useEffect(() => {
    if (!storageReady) return;
    try {
      const serializable = messages.slice(-100).map((m) => ({
        ...m,
        imageDataUrl: undefined, // 不持久化 base64 图片数据
      }));
      localStorage.setItem("bny-messages", JSON.stringify(serializable));
    } catch { /* ignore quota errors */ }
  }, [messages]);

  // 待办持久化到 localStorage
  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem("bny-todos", JSON.stringify(todos));
    } catch { /* ignore */ }
  }, [todos, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem("bny-courses", JSON.stringify(courses));
    } catch {
      // ignore
    }
  }, [courses, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    const now = Date.now();
    setCourses((prev) => {
      let changed = false;
      const next = prev.map((course) => {
        if (course.done) return course;
        if (course.startAt > now) return course;
        const rolledStart = toUpcomingWeeklyTimestamp(course.startAt, now);
        if (rolledStart && rolledStart !== course.startAt) {
          changed = true;
          return { ...course, startAt: rolledStart, reminded: false };
        }
        return course;
      });
      return changed ? next : prev;
    });
  }, [storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem("bny-voice-enabled", voiceEnabled ? "1" : "0");
    } catch { /* ignore */ }
  }, [voiceEnabled, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem("bny-voice-tone", voiceTone);
    } catch { /* ignore */ }
  }, [voiceTone, storageReady]);

  useEffect(() => {
    // 自动滚动到底部
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (!storageReady || !locationReady) return;
    let cancelled = false;

    const refresh = async () => {
      const brief = await fetchWeatherBrief();
      if (cancelled) return;
      setWeatherBrief(brief);
      setWeatherUpdatedAt(Date.now());
    };

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 5 * 60 * 1000);

    const onResume = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [storageReady, locationReady, userLocation]);

  useEffect(() => {
    if (!storageReady || !locationReady || !weatherBrief) return;

    const todayKey = getTodayKey();
    if (typeof window === "undefined") return;
    if (localStorage.getItem("bny-morning-greet-date") === todayKey) return;

    const greeting = `${getGreetingByHour()}。${weatherBrief} 今天待完成事项 ${pendingTodoCount} 项，课程安排 ${activeCourseCount} 门，我会在关键时间点提前提醒你。`;
    pushMessage({ role: "assistant", text: greeting });
    speakText(greeting);
    localStorage.setItem("bny-morning-greet-date", todayKey);
  }, [storageReady, locationReady, weatherBrief, pendingTodoCount, activeCourseCount]);

  useEffect(() => {
    // 待办提醒：每秒检查一次，仅对新触发项目弹出可执行提醒。
    const t = window.setInterval(() => {
      const now = Date.now();
      let firedNow: TodoItem | null = null;
      setTodos((prev) => {
        let changed = false;
        const next = prev.map((x) => {
          if (!x.done && !x.fired && x.remindAt <= now) {
            changed = true;
            const updated = { ...x, fired: true };
            firedNow = updated;
            return updated;
          }
          return x;
        });
        return changed ? next : prev;
      });
      if (firedNow) {
        remindTodo(firedNow);
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    // 课表提醒：课前 15 分钟提醒课程名和教室。
    const t = window.setInterval(() => {
      const now = Date.now();
      let firedCourse: CourseItem | null = null;
      setCourses((prev) => {
        let changed = false;
        const next = prev.map((course) => {
          if (course.done) return course;

          let normalized = course;
          if (course.startAt + 5 * 60 * 1000 < now) {
            const rolledStart = toUpcomingWeeklyTimestamp(course.startAt, now);
            if (rolledStart && rolledStart !== course.startAt) {
              normalized = { ...course, startAt: rolledStart, reminded: false };
              changed = true;
            }
          }

          const remindAt = normalized.startAt - 15 * 60 * 1000;
          if (!normalized.reminded && remindAt <= now && now <= normalized.startAt + 5 * 60 * 1000) {
            changed = true;
            const updated = { ...normalized, reminded: true };
            firedCourse = updated;
            return updated;
          }
          return normalized;
        });
        return changed ? next : prev;
      });
      if (firedCourse) {
        remindCourse(firedCourse);
      }
    }, 30 * 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    // 初始化语音识别（Web Speech API）
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "zh-CN";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (ev: SpeechRecognitionEventLike) => {
      let interim = "";
      let finalText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const piece = ev.results[i]?.[0]?.transcript ?? "";
        if (ev.results[i]?.isFinal) finalText += piece;
        else interim += piece;
      }
      if (finalText) voiceFinalRef.current += finalText;
      voiceInterimRef.current = interim;
      setDraft(`${voiceBaseDraftRef.current}${voiceFinalRef.current}${voiceInterimRef.current}`);
    };
    rec.onerror = (e: SpeechRecognitionErrorLike) => {
      setVoiceError(e.error ? `语音识别失败：${e.error}` : "语音识别失败");
      setIsListening(false);
    };
    rec.onend = () => {
      setIsListening(false);
      const raw = `${voiceFinalRef.current}${voiceInterimRef.current}`.trim();
      voiceInterimRef.current = "";
      voiceFinalRef.current = "";
      if (!raw) return;

      // 用已接入的大模型做断句/加标点/纠错（更接近微信输入体验）
      polishingAbortRef.current?.abort();
      const ac = new AbortController();
      polishingAbortRef.current = ac;
      setIsPolishingVoice(true);

      (async () => {
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              purpose: "voice_polish",
              messages: [{ role: "user", text: raw }],
            }),
            signal: ac.signal,
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) {
            setToast({
              title: "语音润色失败",
              body: data?.error ? String(data.error) : `HTTP ${res.status}`,
            });
            return;
          }
          const polished =
            typeof data?.reply === "string" && data.reply.trim() ? data.reply.trim() : raw;
          const base = voiceBaseDraftRef.current;
          setDraft(`${base}${base && !base.endsWith("\n") ? "\n" : ""}${polished}`);
        } catch (e) {
          if (e instanceof Error && e.name === "AbortError") return;
          setToast({
            title: "语音润色失败",
            body: e instanceof Error ? e.message : "网络错误",
          });
        } finally {
          setIsPolishingVoice(false);
        }
      })();
    };
    recognitionRef.current = rec;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    const sync = () => {
      // 语音列表可能异步加载，拿到 voices 后再标记为就绪。
      const voices = synth.getVoices();
      setSpeechReady(voices.length > 0);
    };
    sync();
    synth.addEventListener("voiceschanged", sync);
    return () => synth.removeEventListener("voiceschanged", sync);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const unlock = () => {
      if (speechUnlocked) return;
      setSpeechUnlocked(true);
      setVoiceError(null);
      // 通过一次无声短播报触发浏览器语音通道解锁。
      try {
        const primer = new SpeechSynthesisUtterance(".");
        primer.volume = 0;
        primer.rate = 1;
        primer.pitch = 1;
        window.speechSynthesis.speak(primer);
      } catch {
        // ignore
      }
    };

    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [speechUnlocked]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const replayPending = () => {
      const pending = pendingSpeakRef.current;
      if (!pending || !voiceEnabled) return;
      // 下一次用户交互时自动重播，避免“点击后仍要重发消息”。
      window.setTimeout(() => {
        const text = pendingSpeakRef.current;
        if (!text) return;
        pendingSpeakRef.current = null;
        speakText(text);
      }, 0);
    };

    window.addEventListener("pointerdown", replayPending);
    window.addEventListener("keydown", replayPending);
    return () => {
      window.removeEventListener("pointerdown", replayPending);
      window.removeEventListener("keydown", replayPending);
    };
  }, [voiceEnabled]);

  useEffect(() => {
    const pending = pendingSpeakRef.current;
    if (!pending || !voiceEnabled || !speechUnlocked || !speechReady) return;
    pendingSpeakRef.current = null;
    window.setTimeout(() => speakText(pending), 60);
  }, [voiceEnabled, speechUnlocked, speechReady]);

  function pushMessage(msg: Omit<ChatMessage, "id" | "createdAt">) {
    setMessages((prev) => [
      ...prev,
      { ...msg, id: nowId("m"), createdAt: Date.now() },
    ]);
  }

  function buildConvo(extra?: { role: "user" | "assistant"; text?: string; imageDataUrl?: string }) {
    const mapped = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "me" ? ("user" as const) : ("assistant" as const),
        text: m.sticker ? m.sticker : m.text,
        imageDataUrl: m.imageDataUrl,
      }));
    return extra ? [...mapped, extra] : mapped;
  }

  async function callLLM(convo: Array<{ role: "user" | "assistant"; text?: string; imageDataUrl?: string }>) {
    setIsReplying(true);
    setStreamingText("");
    const hasImage = convo.some((m) => Boolean(m.imageDataUrl));

    try {
      // 有图片时不使用流式（视觉模型目前 stream 支持不稳定）
      if (hasImage) {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: convo,
            personaPrompt: currentPersona.systemPrompt,
            location: userLocation,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          pushMessage({
            role: "assistant",
            text: data?.error ? `连接大模型失败：${data.error}` : `连接大模型失败（HTTP ${res.status}）`,
          });
          return null;
        }
        const reply = typeof data?.reply === "string" && data.reply.trim() ? data.reply : "（大模型未返回内容）";
        if (data?.emotion) setEmotion(data.emotion as EmotionType);
        pushMessage({ role: "assistant", text: reply });
        speakText(reply);
        setStreamingText(null);
        return reply;
      }

      // ─── 流式请求 ───────────────────────────────────────────────────────────
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: convo,
          stream: true,
          personaPrompt: currentPersona.systemPrompt,
          location: userLocation,
        }),
      });

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => null);
        pushMessage({
          role: "assistant",
          text: errData?.error ? `连接大模型失败：${errData.error}` : `连接大模型失败（HTTP ${res.status}）`,
        });
        setStreamingText(null);
        return null;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let detectedEmotion: EmotionType = "neutral";

      // 逐块读取 SSE
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr) as {
              __meta__?: boolean;
              emotion?: string;
              choices?: Array<{ delta?: { content?: string } }>;
            };
            if (parsed.__meta__) {
              detectedEmotion = (parsed.emotion as EmotionType) ?? "neutral";
              continue;
            }
            const delta = parsed.choices?.[0]?.delta?.content ?? "";
            fullText += delta;
            // 流式更新显示，但移除末尾情绪标签
            const displayText = fullText
              .replace(/\n?\[\[EMOTION:(happy|calm|worried|surprised|neutral)\]\]\s*$/, "")
              .trim();
            setStreamingText(displayText);
          } catch { /* ignore */ }
        }
      }

      // 流结束，清理情绪标签，提交最终消息
      const finalReply = fullText
        .replace(/\n?\[\[EMOTION:(happy|calm|worried|surprised|neutral)\]\]\s*$/, "")
        .trim() || "（大模型未返回内容）";

      setEmotion(detectedEmotion);
      setStreamingText(null);
      pushMessage({ role: "assistant", text: finalReply });
      speakText(finalReply);
      return finalReply;
    } catch (e) {
      setStreamingText(null);
      pushMessage({
        role: "assistant",
        text: e instanceof Error ? `连接大模型失败：${e.message}` : "连接大模型失败",
      });
      return null;
    } finally {
      setIsReplying(false);
    }
  }

  async function fetchWeatherBrief() {
    try {
      const direct = await fetchDirectWeatherSnapshot(userLocation);
      if (direct) {
        return `当前${direct.city}天气：${direct.condition}，气温约 ${direct.temp}，风速约 ${direct.wind}。${direct.clothing}`;
      }

      const prompt = userLocation
        ? "请告诉我当前天气、气温、风速和穿搭建议。"
        : "请告诉我北京当前天气、气温、风速和穿搭建议。";
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", text: prompt }],
          location: userLocation,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        return "今天的天气服务暂时不可用，你也可以直接输入城市名让我补查。";
      }
      return typeof data?.reply === "string" && data.reply.trim()
        ? data.reply.trim()
        : "定位已就绪，今天也要按节奏把事情安排好。";
    } catch {
      return "天气服务暂时不可用，但我仍会照常帮你安排今天的学习和待办。";
    }
  }

  async function refreshWeatherNow() {
    setIsRefreshingWeather(true);
    try {
      const brief = await fetchWeatherBrief();
      setWeatherBrief(brief);
      setWeatherUpdatedAt(Date.now());
    } finally {
      setIsRefreshingWeather(false);
    }
  }

  function remindTodo(todo: TodoItem) {
    const locationText = todo.location ? `，地点 ${todo.location}` : "";
    const suggestion = buildTodoSuggestion(todo);
    const speak = `待办提醒：${todo.title}${locationText}。${suggestion}`;
    pushMessage({
      role: "assistant",
      text: `待办提醒：${todo.title}${locationText}，时间 ${formatDateTime(todo.remindAt)}。${suggestion}`,
    });
    speakText(speak);
    setToast({
      title: "待办提醒",
      body: `${todo.title}${locationText} · ${formatDateTime(todo.remindAt)}\n${suggestion}`,
      actions: [
        { label: "一键完成", kind: "todo-complete", targetId: todo.id, variant: "primary" },
        { label: "延后10分钟", kind: "todo-snooze", targetId: todo.id, variant: "secondary" },
        { label: "改时间", kind: "todo-reschedule", targetId: todo.id, variant: "secondary" },
      ],
    });
  }

  function remindCourse(course: CourseItem) {
    const text = `课程提醒：还有 15 分钟开始上课，${course.title}，教室 ${course.classroom}。建议你现在带好资料准备出发。`;
    pushMessage({ role: "assistant", text });
    speakText(text);
    setToast({
      title: "上课提醒",
      body: `${course.title} · ${course.classroom} · ${formatTime(course.startAt)}${course.endAt ? `-${formatTime(course.endAt)}` : ""}。建议现在收拾书包并提前到教室。`,
      actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
    });
  }

  function markTodoDone(id: string) {
    setTodos((prev) => prev.map((item) => (item.id === id ? { ...item, done: true } : item)));
    setToast(null);
  }

  function snoozeTodo(id: string, minutes = 10) {
    const nextTime = Date.now() + minutes * 60 * 1000;
    setTodos((prev) => prev.map((item) => (item.id === id ? { ...item, remindAt: nextTime, fired: false } : item)));
    setToast({
      title: "已延后提醒",
      body: `这项待办会在 ${formatTime(nextTime)} 再次提醒你。`,
      actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
    });
  }

  function rescheduleTodo(id: string) {
    const raw = window.prompt("请输入新的提醒时间，格式如 18:30");
    if (!raw) return;
    const nextTime = parseClockToNextTimestamp(raw.trim());
    if (nextTime === null) {
      setToast({
        title: "时间格式不正确",
        body: "请使用 18:30 这样的 24 小时制时间格式。",
        actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
      });
      return;
    }
    setTodos((prev) => prev.map((item) => (item.id === id ? { ...item, remindAt: nextTime, fired: false } : item)));
    setToast({
      title: "已改提醒时间",
      body: `新的提醒时间是 ${formatDateTime(nextTime)}。`,
      actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
    });
  }

  function handleToastAction(action: ToastAction) {
    if (action.kind === "dismiss") {
      setToast(null);
      return;
    }
    if (action.kind === "todo-complete" && action.targetId) {
      markTodoDone(action.targetId);
      return;
    }
    if (action.kind === "todo-snooze" && action.targetId) {
      snoozeTodo(action.targetId);
      return;
    }
    if (action.kind === "todo-reschedule" && action.targetId) {
      rescheduleTodo(action.targetId);
      return;
    }
    if (action.kind === "notice-confirm") {
      confirmNoticeDraft();
      return;
    }
    if (action.kind === "notice-dismiss") {
      setNoticeDraft(null);
      setToast(null);
      return;
    }
    if (action.kind === "schedule-confirm") {
      confirmScheduleDraft();
      return;
    }
    if (action.kind === "schedule-dismiss") {
      setScheduleDraft(null);
      setToast(null);
    }
  }

  async function extractNoticeDraftFromImage(imageDataUrl: string, fileName: string) {
    setIsReplying(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "notice_extract",
          messages: [{ role: "user", text: `请从这张通知或截图中提取时间、地点、事项并生成待办草稿。原文件名：${fileName}`, imageDataUrl }],
        }),
      });
      const data = await res.json().catch(() => null);
      const raw = typeof data?.reply === "string" ? data.reply : "";
      if (!res.ok || !raw) {
        setToast({
          title: "通知识别失败",
          body: data?.error ? String(data.error) : "暂时没能从截图中提取出可用待办。",
          actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
        });
        return;
      }

      const parsed = JSON.parse(extractJsonObjectFromText(raw)) as {
        title?: string;
        remindAt?: string | null;
        location?: string;
        details?: string;
      };
      const title = parsed.title?.trim() ?? "";
      if (!title) {
        setToast({
          title: "未识别到事项",
          body: "截图里没有提取到明确的时间地点事项，你可以切换到 OCR 模式查看原文。",
          actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
        });
        return;
      }

      const draft: NoticeDraft = {
        title,
        remindAt: parsed.remindAt ? Date.parse(parsed.remindAt) : null,
        location: parsed.location?.trim() || undefined,
        details: parsed.details?.trim() || undefined,
      };
      if (draft.remindAt !== null && !Number.isFinite(draft.remindAt)) {
        draft.remindAt = null;
      }
      setNoticeDraft(draft);
      setToast({
        title: "已生成待办草稿",
        body: `${draft.title}${draft.location ? ` · ${draft.location}` : ""}${draft.remindAt ? ` · ${formatDateTime(draft.remindAt)}` : ""}`,
        actions: [
          { label: "一键确认", kind: "notice-confirm", variant: "primary" },
          { label: "先关闭", kind: "notice-dismiss", variant: "secondary" },
        ],
      });
    } catch (e) {
      setToast({
        title: "通知识别失败",
        body: e instanceof Error ? e.message : "网络错误",
        actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
      });
    } finally {
      setIsReplying(false);
    }
  }

  async function extractWeeklyScheduleFromImage(imageDataUrl: string, fileName: string) {
    setIsReplying(true);
    try {
      const todayLabel = new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
      }).format(new Date());
      const cstDateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
      const [cY, cM, cD] = cstDateStr.split("-").map(Number);
      const cstDate = new Date(cY, cM - 1, cD);
      const dow = cstDate.getDay();
      const daysFromMon = dow === 0 ? 6 : dow - 1;
      const monday = new Date(cY, cM - 1, cD - daysFromMon);
      const sunday = new Date(cY, cM - 1, cD + (6 - daysFromMon));
      const mondayStr = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
      const sundayStr = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, "0")}-${String(sunday.getDate()).padStart(2, "0")}`;
      
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "schedule_extract",
          messages: [{
            role: "user",
            text: `当前现实日期：${todayLabel}；截图对应的可能是本周。\n时空锚点提示：周一为 ${mondayStr}，周日为 ${sundayStr}。请读取课表截图中每列对应的日期和课程，提取出“几月几号、开始时间、结束时间、课程名、教室”，其中课程时间需按课程块上下边界覆盖范围按比例读取，并输出结构化 JSON。如果没发现课程，说明是纯聊天，输出空。文件名：${fileName}`,
            imageDataUrl,
          }],
        }),
      });
      const data = await res.json().catch(() => null);
      const raw = typeof data?.reply === "string" ? data.reply : "";
      if (!res.ok || !raw) {
        setToast({
          title: "课表识别失败",
          body: data?.error ? String(data.error) : "暂时无法从课表截图中提取课程信息。",
          actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
        });
        return;
      }

      const parsed = JSON.parse(extractJsonObjectFromText(raw)) as {
        grid_analysis?: string;
        courses?: Array<{ weekday?: number; date?: string; title?: string; classroom?: string; startTime?: string; endTime?: string }>;
      };
      // 【修改点】对解析出来的数据引入时间轴逻辑校验
      const normalized = (parsed.courses || [])
        .map((item) => ({
          weekday: Number(item.weekday),
          date: (item.date || "").trim(),
          title: (item.title || "").trim(),
          // 正则强化清洗，移除大模型可能带有的多余前缀
          classroom: (item.classroom || "").trim().replace(/^(上课地点：|教室：|地点：)/, ""),
          startTime: (item.startTime || "").trim(),
          endTime: (item.endTime || "").trim(),
        }))
        .filter((item) => {
          const hasDate = /^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(item.date);
          const hasWeekday = item.weekday >= 1 && item.weekday <= 7;
          const hasStart = /^\d{1,2}:\d{2}$/.test(item.startTime);
          const hasValidEnd = !item.endTime || /^\d{1,2}:\d{2}$/.test(item.endTime);
          
          if (!((hasDate || hasWeekday) && item.title && hasStart && hasValidEnd)) {
            return false;
          }

          // 时间时序和长度合并错误校验
          if (item.endTime && hasStart && hasValidEnd) {
            const [sH, sM] = item.startTime.split(':').map(Number);
            const [eH, eM] = item.endTime.split(':').map(Number);
            const sTotal = sH * 60 + sM;
            const eTotal = eH * 60 + eM;
            // 结束时间必须晚于开始时间，且单节课长度不能超过12小时（消除视觉合并错误）
            if (eTotal <= sTotal || (eTotal - sTotal) > 720) {
              return false;
            }
          }

          return true;
        });

      if (normalized.length === 0) {
        setToast({
          title: "未识别到课程",
          body: "课表截图中没有识别到有效课程，请更换清晰截图后重试。",
          actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
        });
        return;
      }

      // 识别成功后立即录入，并以系统当前时间计算“下一门课程提醒”。
      const now = Date.now();
      const parsedCourses: CourseItem[] = normalized
        .map((item) => {
          const startAt = resolveCourseStartAt(item, now);
          if (startAt === null) return null;
          const endAt = resolveCourseEndAt(item, now) ?? undefined;
          return {
            id: nowId("c"),
            title: item.title,
            classroom: item.classroom || "待确认教室",
            startAt,
            endAt,
            reminded: false,
            done: false,
          } as CourseItem;
        })
        .filter((item): item is CourseItem => Boolean(item))
        .sort((a, b) => a.startAt - b.startAt);

      const upcomingCourses = parsedCourses
        .map((item) => {
          const rolledStart = toUpcomingWeeklyTimestamp(item.startAt, now);
          if (rolledStart === null) return null;
          return {
            ...item,
            startAt: rolledStart,
            reminded: false,
          } as CourseItem;
        })
        .filter((item): item is CourseItem => Boolean(item))
        .sort((a, b) => a.startAt - b.startAt);
      const rolledCount = parsedCourses.filter((item) => item.startAt <= now).length;

      if (upcomingCourses.length === 0) {
        setToast({
          title: "录入失败",
          body: rolledCount > 0
            ? "课表中课程时间无法解析，当前没有可用课程。"
            : "课表里没有可用的时间信息，请重新上传截图。",
          actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
        });
        return;
      }

      setCourses(upcomingCourses);
      setScheduleDraft(null);
      const immediateNext = upcomingCourses.find((item) => !item.done && item.startAt > now) ?? null;
      setNextCourseOverride(immediateNext);
      setToast({
        title: "课表已录入",
        body: immediateNext
          ? `已按系统时间 ${formatTime(now)} 更新提醒：下一门课 ${immediateNext.title}（${formatDateTime(immediateNext.startAt)}${immediateNext.endAt ? `-${formatTime(immediateNext.endAt)}` : ""}，${immediateNext.classroom}）。`
          : (rolledCount > 0
            ? `已自动录入 ${upcomingCourses.length} 门课程，下一课程提醒已更新。已将 ${rolledCount} 门已过时间课程顺延到下周。`
            : `已自动录入 ${upcomingCourses.length} 门课程，下一课程提醒已更新。`),
        actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
      });
    } catch (e) {
      setToast({
        title: "课表识别失败",
        body: e instanceof Error ? e.message : "网络错误",
        actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
      });
    } finally {
      setIsReplying(false);
    }
  }

  function confirmScheduleDraft() {
    if (!scheduleDraft) return;
    const now = Date.now();
    const parsedCourses: CourseItem[] = scheduleDraft.courses
      .map((item) => {
        const startAt = resolveCourseStartAt(item, now);
        if (startAt === null) return null;
        const endAt = resolveCourseEndAt(item, now) ?? undefined;
        return {
          id: nowId("c"),
          title: item.title,
          classroom: item.classroom || "待确认教室",
          startAt,
          endAt,
          reminded: false,
          done: false,
        } as CourseItem;
      })
      .filter((item): item is CourseItem => Boolean(item))
      .sort((a, b) => a.startAt - b.startAt);

    const upcomingCourses = parsedCourses
      .map((item) => {
        const rolledStart = toUpcomingWeeklyTimestamp(item.startAt, now);
        if (rolledStart === null) return null;
        return {
          ...item,
          startAt: rolledStart,
          reminded: false,
        } as CourseItem;
      })
      .filter((item): item is CourseItem => Boolean(item))
      .sort((a, b) => a.startAt - b.startAt);
    const rolledCount = parsedCourses.filter((item) => item.startAt <= now).length;

    if (upcomingCourses.length === 0) {
      setToast({
        title: "录入失败",
        body: rolledCount > 0
          ? "课表草稿中的课程时间无法解析，当前没有可用课程。"
          : "课表草稿里没有可用的时间信息，请重新上传截图。",
        actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
      });
      return;
    }

    setCourses(upcomingCourses);
    setNextCourseOverride(null);
    setScheduleDraft(null);
    setToast({
      title: "课表已录入",
      body: rolledCount > 0
        ? `已录入 ${upcomingCourses.length} 门课程，并开启课前 15 分钟提醒。已将 ${rolledCount} 门已过时间课程顺延到下周。`
        : `已录入 ${upcomingCourses.length} 门课程，并开启课前 15 分钟提醒。`,
      actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
    });
  }

  function confirmNoticeDraft() {
    if (!noticeDraft) return;
    let remindAt = noticeDraft.remindAt;
    if (remindAt === null) {
      const raw = window.prompt("通知里未识别出明确时间，请补一个提醒时间，例如 18:30");
      if (!raw) return;
      remindAt = parseClockToNextTimestamp(raw.trim());
      if (remindAt === null) {
        setToast({
          title: "时间格式不正确",
          body: "请使用 18:30 这样的 24 小时制时间格式。",
          actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
        });
        return;
      }
    }

    const item: TodoItem = {
      id: nowId("t"),
      title: noticeDraft.title,
      remindAt,
      done: false,
      fired: false,
      location: noticeDraft.location,
      source: "notice",
    };
    setTodos((prev) => [item, ...prev]);
    setNoticeDraft(null);
    setToast({
      title: "已加入待办",
      body: `${item.title}${item.location ? ` · ${item.location}` : ""}，提醒时间 ${formatDateTime(item.remindAt)}。`,
      actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
    });
  }

  async function tryExtractTodoFromText(text: string) {
    const t = text.trim();
    if (!t) return;
    // 只对明显提醒意图尝试解析，避免每条消息都打一次模型
    const maybeReminder =
      t.includes("提醒") || t.startsWith("提醒我") || t.includes("闹钟") || t.includes("几点") || t.includes("定时");
    if (!maybeReminder) return;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "todo_extract",
          messages: [{ role: "user", text: t }],
        }),
      });
      const data = await res.json().catch(() => null);
      const raw = typeof data?.reply === "string" ? data.reply : "";
      if (!res.ok || !raw) return;
      const parsed = JSON.parse(raw) as { title?: string; remindAt?: string | null };
      const title = (parsed.title || "").trim();
      const iso = parsed.remindAt ?? null;
      if (!title || !iso) return;
      const when = Date.parse(iso);
      if (!Number.isFinite(when)) return;
      const item: TodoItem = {
        id: nowId("t"),
        title,
        remindAt: when,
        done: false,
        fired: false,
        source: "chat",
      };
      setTodos((prev) => [item, ...prev]);
      setToast({ title: "已识别待办提醒", body: `${title}（${formatTime(when)}）` });
    } catch {
      // ignore
    }
  }

  function sendText() {
    const text = draft.trim();
    if (!text) return;
    pushMessage({ role: "me", text });
    setDraft("");
    const convo = buildConvo({ role: "user", text });
    void callLLM(convo);
    void tryExtractTodoFromText(text);
  }

  function sendSticker(s: string) {
    pushMessage({ role: "me", sticker: s });
    const convo = buildConvo({ role: "user", text: s });
    void callLLM(convo);
  }

  function speakText(text: string) {
    const w = window as unknown as { speechSynthesis?: SpeechSynthesis };
    const synth = w.speechSynthesis;
    if (!voiceEnabled || !text.trim()) return;
    if (!synth) {
      setVoiceError("当前浏览器不支持语音朗读（SpeechSynthesis）。");
      return;
    }

    if (!speechUnlocked) {
      pendingSpeakRef.current = text;
      setVoiceError("请先点击页面任意位置以启用浏览器语音播报。点击后会自动朗读最新回复。");
      return;
    }

    const speakOnce = () => {
      try {
        const cleanedText = sanitizeTextForSpeech(text);
        if (!cleanedText) return;
        const segments = splitSpeechSegments(cleanedText);
        if (segments.length === 0) return;

        synth.cancel();
        synth.resume();
        const config = toneConfig(voiceTone, voiceGender);
        const pickedVoice = pickBestVoice(synth.getVoices(), config.preferGender);

        let segIndex = 0;
        let started = false;
        const timer = window.setTimeout(() => {
          if (!started) {
            pendingSpeakRef.current = text;
            setVoiceError("语音播放被浏览器拦截。请点击页面任意位置，系统将自动重试朗读。");
          }
        }, 1200);

        const speakSegment = () => {
          if (segIndex >= segments.length) {
            window.clearTimeout(timer);
            return;
          }

          const segment = segments[segIndex] || "";
          const prosody = segmentProsody(segment, config, segIndex, segments.length);
          const u = new SpeechSynthesisUtterance(segment);
          u.lang = "zh-CN";
          if (pickedVoice) {
            u.voice = pickedVoice;
            u.lang = pickedVoice.lang || "zh-CN";
          }
          u.pitch = prosody.pitch;
          u.rate = prosody.rate;
          u.volume = prosody.volume;

          u.onstart = () => {
            started = true;
            window.clearTimeout(timer);
            setVoiceError(null);
          };
          u.onend = () => {
            segIndex += 1;
            if (segIndex < segments.length) {
              window.setTimeout(speakSegment, prosody.pauseMs);
            }
          };
          u.onerror = () => {
            window.clearTimeout(timer);
            pendingSpeakRef.current = text;
            setVoiceError("朗读失败：系统语音引擎异常。请点击页面任意位置，系统将自动重试。");
          };

          synth.speak(u);
        };

        speakSegment();
      } catch (e) {
        setVoiceError(e instanceof Error ? `朗读失败：${e.message}` : "朗读失败");
      }
    };

    // 某些浏览器首次调用时 voices 列表为空，延迟一次以提升首播成功率。
    if (!speechReady || synth.getVoices().length === 0) {
      pendingSpeakRef.current = text;
      setVoiceError("语音引擎正在初始化，请稍候 1 秒再试。");
      window.setTimeout(speakOnce, 400);
      return;
    }

    speakOnce();
  }

  function toggleListen() {
    setVoiceError(null);
    const rec = recognitionRef.current;
    if (!rec) {
      setVoiceError("当前浏览器不支持语音识别（Web Speech API）。");
      return;
    }
    if (isListening) {
      try {
        rec.stop();
      } catch {
        // ignore
      }
      setIsListening(false);
      return;
    }
    try {
      polishingAbortRef.current?.abort();
      setIsPolishingVoice(false);
      voiceBaseDraftRef.current = draft ? `${draft.trimEnd()}${draft.endsWith("\n") ? "" : "\n"}` : "";
      voiceInterimRef.current = "";
      voiceFinalRef.current = "";
      setDraft(voiceBaseDraftRef.current);
      rec.start();
      setIsListening(true);
    } catch (e) {
      setVoiceError(e instanceof Error ? `语音识别启动失败：${e.message}` : "语音识别启动失败");
      setIsListening(false);
    }
  }

  // 语音模式：点击开始识别，再次点击停止识别（停止后会走 onend -> 大模型润色）

  function MicrophoneIcon({ active }: { active: boolean }) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M12 14.5c1.93 0 3.5-1.57 3.5-3.5V6.5C15.5 4.57 13.93 3 12 3S8.5 4.57 8.5 6.5V11c0 1.93 1.57 3.5 3.5 3.5Z"
          stroke={active ? "var(--brand)" : "currentColor"}
          strokeWidth="1.8"
        />
        <path
          d="M6.5 10.8v.5c0 3.03 2.47 5.5 5.5 5.5s5.5-2.47 5.5-5.5v-.5"
          stroke={active ? "var(--brand)" : "currentColor"}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M12 16.8V21"
          stroke={active ? "var(--brand)" : "currentColor"}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M9 21h6"
          stroke={active ? "var(--brand)" : "currentColor"}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  function onPickImage(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setToast({
        title: "文件格式不支持",
        body: "请上传图片文件后再试。",
        actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
      });
      return;
    }
    const url = URL.createObjectURL(file);
    const reader = new FileReader();
    reader.onerror = () => {
      URL.revokeObjectURL(url);
      setToast({
        title: "图片读取失败",
        body: "上传图片失败，请重新选择或更换图片后再试。",
        actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
      });
    };
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : undefined;
      if (!dataUrl) {
        URL.revokeObjectURL(url);
        setToast({
          title: "图片读取失败",
          body: "未读取到有效图片数据，请重试。",
          actions: [{ label: "知道了", kind: "dismiss", variant: "primary" }],
        });
        return;
      }
      pushMessage({
        role: "me",
        imageUrl: url,
        imageDataUrl: dataUrl,
        text: file.name,
      });
      if (imageMode === "schedule") {
        void extractWeeklyScheduleFromImage(dataUrl, file.name);
        return;
      }
      const prompt = "请对这张通知图片做简洁总结，输出 3 条要点，并给出一条行动建议。";
      const convo = buildConvo({ role: "user", text: `${file.name}\n${prompt}`, imageDataUrl: dataUrl });
      void callLLM(convo);
    };
    reader.readAsDataURL(file);
  }

  function addTodo() {
    const title = todoTitle.trim();
    if (!title) return;
    const base = new Date();
    let remindAt = Date.now() + 10 * 60 * 1000; // 默认 10 分钟后
    if (todoTime) {
      const [hh, mm] = todoTime.split(":").map((x) => Number(x));
      if (Number.isFinite(hh) && Number.isFinite(mm)) {
        const dt = new Date(
          base.getFullYear(),
          base.getMonth(),
          base.getDate(),
          hh,
          mm,
          0,
          0,
        );
        if (dt.getTime() <= Date.now()) dt.setDate(dt.getDate() + 1);
        remindAt = dt.getTime();
      }
    }
    const item: TodoItem = {
      id: nowId("t"),
      title,
      remindAt,
      done: false,
      fired: false,
      source: "manual",
    };
    setTodos((prev) => [item, ...prev]);
    setTodoTitle("");
    setTodoTime("");
    setToast({ title: "已添加待办", body: `${title}（${formatTime(remindAt)}）` });
  }

  function toggleCourseDone(id: string) {
    setCourses((prev) => prev.map((item) => (item.id === id ? { ...item, done: !item.done } : item)));
  }

  function removeCourse(id: string) {
    setCourses((prev) => prev.filter((item) => item.id !== id));
  }

  function toggleTodo(id: string) {
    setTodos((prev) => prev.map((x) => (x.id === id ? { ...x, done: !x.done } : x)));
  }

  function removeTodo(id: string) {
    setTodos((prev) => prev.filter((x) => x.id !== id));
  }

  // ─── 清空对话 ─────────────────────────────────────────────────────────────────
  function clearChat() {
    if (!window.confirm("确定清空全部对话记录？")) return;
    setMessages([]);
    setEmotion("neutral");
  }

  return (
    <div className="dash">
      <div className="shell">
        {/* 左侧：数字人区域（占 1/4） */}
        <section className="card panelCard">
          <div className="cardBody panelCardBody">
            <DigitalHumanPanel
              latestAssistantText={latestAssistantText}
              isReplying={isReplying}
              emotion={emotion}
              onGenderDetected={(gender) => setVoiceGender(gender)}
            />
          </div>
        </section>

        {/* 右侧：聊天区域（占 3/4） */}
        <section className="card chatWrap">
          <div className="cardHeader">
            <div>
              <div className="title">伴你左右生活区</div>
              <div className="subtitle" style={{ whiteSpace: "nowrap" }}>大学生的一天：早安天气 / 课表提醒 / 待办执行 / 截图转待办</div>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "nowrap", whiteSpace: "nowrap", overflowX: "auto" }}>
              {/* 人格选择 */}
              <select
                className="select"
                value={personaKey}
                onChange={(e) => {
                  setPersonaKey(e.target.value as PersonaKey);
                }}
                aria-label="助手人格"
                style={{ width: "auto", minWidth: 140 }}
                title="切换助手人格风格"
              >
                {PERSONAS.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
              <button
                className={`btn ${voiceEnabled ? "btnPrimary" : ""}`}
                onClick={() => {
                  setVoiceEnabled((prev) => {
                    const next = !prev;
                    if (!next && typeof window !== "undefined" && window.speechSynthesis) {
                      window.speechSynthesis.cancel();
                    }
                    return next;
                  });
                }}
                type="button"
                title="切换语音朗读开关"
              >
                {voiceEnabled ? "朗读已开启" : "朗读已关闭"}
              </button>
              <select
                className="select"
                value={voiceTone}
                onChange={(e) => setVoiceTone(e.target.value as VoiceTone)}
                aria-label="朗读音色"
                style={{ width: "auto", minWidth: 136 }}
                title="选择朗读音色"
              >
                <option value="clara">克拉拉（温柔平和）</option>
                <option value="ajie">阿杰（沉稳清冷）</option>
              </select>
              <button className="btn btnDanger" onClick={clearChat} type="button" title="清空全部对话">
                清空
              </button>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "8px",
              padding: "8px 12px 0",
            }}
          >
            <div className="cardInset" style={{ padding: "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div className="msgMeta" style={{ marginTop: 0 }}>天气情况</div>
                <button
                  className="btn"
                  type="button"
                  onClick={() => void refreshWeatherNow()}
                  style={{ padding: "6px 10px", fontSize: 12, lineHeight: "16px" }}
                  title="立即刷新天气"
                >
                  {isRefreshingWeather ? "刷新中..." : "刷新"}
                </button>
              </div>
              {weatherCard ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                    <div style={{ fontSize: 24, lineHeight: "26px" }}>{weatherCard.symbol}</div>
                    <div style={{ fontWeight: 700, lineHeight: "22px" }}>{weatherCard.condition}</div>
                  </div>
                  <div style={{ marginTop: 6, lineHeight: "20px", color: "var(--muted)", display: "flex", gap: "14px", flexWrap: "wrap" }}>
                    <span>温度：{weatherCard.temperature}</span>
                    <span>风速：{weatherCard.wind}</span>
                  </div>
                  <div style={{ marginTop: 4, lineHeight: "20px", color: "var(--muted)" }}>
                    穿衣建议：{weatherCard.clothing}
                  </div>
                  <div className="msgMeta" style={{ marginTop: 4 }}>
                    {weatherUpdatedAt ? `最近更新：${formatTime(weatherUpdatedAt)}` : "最近更新：--:--"}
                  </div>
                </>
              ) : (
                <div style={{ marginTop: 6, lineHeight: "20px", color: "var(--muted)" }}>
                  {weatherBrief || (locationReady ? "正在整理天气、风速和穿衣建议..." : "等待定位后生成天气信息。")}
                </div>
              )}
            </div>

            <div className="cardInset" style={{ padding: "12px 14px" }}>
              <div className="msgMeta" style={{ marginTop: 0 }}>今日安排</div>
              <div style={{ fontWeight: 700, lineHeight: "22px", marginTop: 4 }}>待办 {pendingTodoCount} 项</div>
              {todayTodoPreview.length > 0 ? (
                <div style={{ marginTop: 4, display: "grid", gap: "2px" }}>
                  {todayTodoPreview.map((item) => (
                    <div key={item.id} style={{ marginTop: 0, lineHeight: "20px", color: "var(--muted)" }}>
                      {formatTime(item.remindAt)} · {item.title}
                    </div>
                  ))}
                  {pendingTodoCount > todayTodoPreview.length ? (
                    <div style={{ marginTop: 0, lineHeight: "20px", color: "var(--muted)" }}>
                      还有 {pendingTodoCount - todayTodoPreview.length} 项待办...
                    </div>
                  ) : null}
                </div>
              ) : (
                <div style={{ marginTop: 4, lineHeight: "20px", color: "var(--muted)" }}>
                  暂无待办，请在下方添加提醒事项。
                </div>
              )}
            </div>

            <div className="cardInset" style={{ padding: "12px 14px" }}>
              <div className="msgMeta" style={{ marginTop: 0 }}>下一门课程提醒</div>
              <div style={{ fontWeight: 700, lineHeight: "22px", marginTop: 4 }}>
                {nextCourse ? `${nextCourse.title} · ${nextCourse.classroom}` : "暂无即将开始的课程"}
              </div>
              <div style={{ marginTop: 2, lineHeight: "20px", color: "var(--muted)" }}>
                {nextCourse
                  ? (() => {
                      const d = new Date(nextCourse.startAt);
                      return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdayToChinese(d.getDay())} ${formatTime(nextCourse.startAt)}${nextCourse.endAt ? `-${formatTime(nextCourse.endAt)}` : ""}`;
                    })()
                  : ""}
              </div>
            </div>
          </div>

          <div className="messages" ref={listRef}>
            {renderedMessages.map((m) => (
              <div
                key={m.id}
                className={`msgRow ${m.role === "me" ? "me" : ""}`}
              >
                <div className={`bubble ${m.role === "me" ? "me" : ""}`}>
                  {m.sticker ? (
                    <div style={{ fontSize: "22px", lineHeight: "30px" }}>
                      {m.sticker}
                    </div>
                  ) : null}
                  {m.text ? (
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: "24px" }}>
                      {m.text}
                    </div>
                  ) : null}
                  {m.imageUrl ? (
                    <div style={{ marginTop: "10px" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.imageUrl}
                        alt={m.text || "uploaded"}
                        style={{
                          width: "100%",
                          maxWidth: "420px",
                          borderRadius: "14px",
                          border: "1px solid var(--border)",
                          display: "block",
                        }}
                      />
                    </div>
                  ) : null}
                  <div className="msgMeta">
                    {m.role === "me" ? "你" : "助手"} · {formatTime(m.createdAt)}
                  </div>
                </div>
              </div>
            ))}

            {/* 流式打字气泡：显示正在流式输出中的内容 */}
            {streamingText !== null && (
              <div className="msgRow">
                <div className="bubble streamingBubble">
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: "24px" }}>
                    {streamingText || "▌"}
                  </div>
                  <div className="msgMeta">助手 · 正在输入…</div>
                </div>
              </div>
            )}
          </div>

          <div className="composer">
            <div className="toolbar">
              <div className="toolbarLeft">
                <label className="btn" style={{ display: "inline-flex", gap: 8 }}>
                  上传图片
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.currentTarget.files?.[0] ?? null;
                      onPickImage(file);
                      // 清空 value，允许用户连续选择同一张图片时也能再次触发 onChange。
                      e.currentTarget.value = "";
                    }}
                  />
                </label>

                <select
                  className="select"
                  value={imageMode}
                  onChange={(e) =>
                    setImageMode(e.target.value as "schedule" | "noticeSummary")
                  }
                  aria-label="图片处理模式"
                  style={{ width: 180 }}
                >
                  <option value="schedule">课表识别</option>
                  <option value="noticeSummary">通知总结</option>
                </select>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {stickers.map((s) => (
                    <button
                      key={s}
                      className="btn"
                      type="button"
                      onClick={() => sendSticker(s)}
                      title="发送快捷短句"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

            </div>

            {noticeDraft ? (
              <div
                style={{
                  marginTop: "12px",
                  border: "1px solid color-mix(in srgb, var(--brand) 26%, var(--border))",
                  borderRadius: "18px",
                  padding: "14px",
                  background: "linear-gradient(180deg, rgba(180, 83, 9, 0.10), rgba(255, 248, 240, 0.92))",
                  display: "grid",
                  gap: "8px",
                }}
              >
                <div style={{ fontWeight: 700 }}>通知待办草稿</div>
                <div style={{ lineHeight: "22px" }}>{noticeDraft.title}</div>
                <div className="msgMeta" style={{ marginTop: 0 }}>
                  {noticeDraft.location ? `地点：${noticeDraft.location} · ` : ""}
                  {noticeDraft.remindAt ? `提醒时间：${formatDateTime(noticeDraft.remindAt)}` : "提醒时间待补充"}
                </div>
                {noticeDraft.details ? (
                  <div style={{ color: "var(--muted)", lineHeight: "22px" }}>{noticeDraft.details}</div>
                ) : null}
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button className="btn btnPrimary" type="button" onClick={confirmNoticeDraft}>一键确认</button>
                  <button className="btn" type="button" onClick={() => setNoticeDraft(null)}>先放这里</button>
                </div>
              </div>
            ) : null}

            <div className="composerRow">
              <textarea
                className="textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  isListening
                    ? "正在聆听…再次点击麦克风结束"
                    : isPolishingVoice
                      ? "正在用大模型优化语音文本…"
                      : isReplying
                        ? "助手正在回复…"
                      : "输入消息…（Enter 发送，Shift+Enter 换行）"
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendText();
                  }
                }}
              />
              <button
                className={`btn ${isListening ? "btnPrimary" : ""}`}
                onClick={toggleListen}
                type="button"
                aria-pressed={isListening}
                aria-label={isListening ? "停止语音识别" : "开始语音识别"}
                title={
                  safeHasWebSpeech()
                    ? isListening
                      ? "点击停止"
                      : "点击开始"
                    : "浏览器不支持语音识别"
                }
                disabled={!safeHasWebSpeech() || isPolishingVoice}
                style={{
                  width: "48px",
                  height: "48px",
                  display: "grid",
                  placeItems: "center",
                  borderRadius: "999px",
                  opacity: !safeHasWebSpeech() ? 0.6 : 1,
                }}
              >
                <MicrophoneIcon active={isListening} />
              </button>
              <button className="btn btnPrimary" onClick={sendText} type="button">
                发送
              </button>
            </div>

            {/* 待办事项与提醒 */}
            <div
              style={{
                marginTop: "8px",
                borderTop: "1px solid var(--border)",
                paddingTop: "16px",
                display: "grid",
                gap: "12px",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gap: "12px",
                  padding: "14px",
                  borderRadius: "18px",
                  border: "1px solid var(--border)",
                  background: "color-mix(in srgb, var(--panel) 90%, transparent)",
                }}
              >
                <div style={{ fontWeight: 700 }}>今日课表</div>
                <div className="muted" style={{ lineHeight: "22px" }}>
                  请上传一周课表截图，系统会自动读取课程名称、教室和时间并录入。
                </div>
                {scheduleDraft ? (
                  <div
                    style={{
                      borderRadius: "14px",
                      border: "1px solid color-mix(in srgb, var(--brand) 26%, var(--border))",
                      padding: "10px 12px",
                      background: "color-mix(in srgb, var(--panel) 96%, rgba(180, 83, 9, 0.08))",
                    }}
                  >
                    <div style={{ fontWeight: 700, lineHeight: "22px" }}>课表草稿（待确认）</div>
                    <div className="msgMeta" style={{ marginTop: 4 }}>
                      已识别 {scheduleDraft.courses.length} 门课程，点击右下角提醒卡中的“一键录入”可完成导入。
                    </div>
                  </div>
                ) : null}

                <div style={{ display: "grid", gap: "8px" }}>
                  {courses.length === 0 ? (
                    <div className="muted">暂无课程安排。录入后会在课前 15 分钟自动提醒课程名称和教室。</div>
                  ) : (
                    courses
                      .slice()
                      .sort((a, b) => a.startAt - b.startAt)
                      .map((course) => (
                        <div
                          key={course.id}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "auto 1fr auto",
                            gap: "12px",
                            alignItems: "center",
                            padding: "12px 14px",
                            borderRadius: "16px",
                            border: "1px solid var(--border)",
                            background: "color-mix(in srgb, var(--panel) 96%, transparent)",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={course.done}
                            onChange={() => toggleCourseDone(course.id)}
                            aria-label="完成课程"
                          />
                          <div>
                            <div style={{ fontWeight: 700, lineHeight: "22px", textDecoration: course.done ? "line-through" : "none" }}>
                              {course.title}
                            </div>
                            <div className="msgMeta">
                              {course.classroom} · {formatDateTime(course.startAt)}{course.endAt ? `-${formatTime(course.endAt)}` : ""}
                              {course.reminded && !course.done ? " · 已提醒" : ""}
                            </div>
                          </div>
                          <button className="btn btnDanger" type="button" onClick={() => removeCourse(course.id)}>
                            删除
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <input
                  className="input"
                  value={todoTitle}
                  onChange={(e) => setTodoTitle(e.target.value)}
                  placeholder="添加今日任务（例如：提交作业 / 复盘实验 / 18:30 开组会）"
                />
                <input
                  className="input"
                  style={{ maxWidth: "160px" }}
                  type="time"
                  value={todoTime}
                  onChange={(e) => setTodoTime(e.target.value)}
                  aria-label="提醒时间"
                />
                <button className="btn" type="button" onClick={addTodo}>
                  添加提醒
                </button>
              </div>

              <div style={{ display: "grid", gap: "8px" }}>
                {todos.length === 0 ? (
                  <div className="muted">暂无待办。添加后会定时弹出提醒。</div>
                ) : (
                  todos.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr auto",
                        gap: "12px",
                        alignItems: "center",
                        padding: "12px 14px",
                        borderRadius: "16px",
                        border: "1px solid var(--border)",
                        background: "color-mix(in srgb, var(--panel) 90%, transparent)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={t.done}
                        onChange={() => toggleTodo(t.id)}
                        aria-label="完成待办"
                      />
                      <div>
                        <div
                          style={{
                            fontWeight: 700,
                            textDecoration: t.done ? "line-through" : "none",
                            opacity: t.done ? 0.7 : 1,
                            lineHeight: "22px",
                          }}
                        >
                          {t.title}
                        </div>
                        <div className="msgMeta">
                          提醒时间：{formatTime(t.remindAt)}
                          {t.location ? ` · ${t.location}` : ""}
                          {t.source === "notice" ? " · 来自截图" : t.source === "chat" ? " · 来自聊天识别" : ""}
                          {t.fired && !t.done ? " · 已提醒" : ""}
                        </div>
                      </div>
                      <button
                        className="btn btnDanger"
                        type="button"
                        onClick={() => removeTodo(t.id)}
                      >
                        删除
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          <div className="toastTitle">{toast.title}</div>
          <div className="toastBody" style={{ whiteSpace: "pre-wrap" }}>{toast.body}</div>
          <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {toastActions.map((action, index) => (
              <button
                key={`${action.kind}-${action.targetId ?? index}`}
                className={`btn ${action.variant === "primary" ? "btnPrimary" : action.variant === "danger" ? "btnDanger" : ""}`}
                onClick={() => handleToastAction(action)}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
