import { getDashScopeKey, getEndpoint, toOpenAIMessage } from "../../utils/dashscope";
import type { InMessage } from "../../types";

export const runtime = "nodejs";

type BuiltinAnswer = {
  reply: string;
  emotion: "happy" | "calm" | "worried" | "surprised" | "neutral";
};

type LocationContext = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  updatedAt?: number;
};

function formatBeijingNow() {
  const now = new Date();
  const date = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).format(now);
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  return `${date} ${time}`;
}

function weatherCodeToText(code: number) {
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

function pickCityFromText(text: string) {
  const presetCities = [
    "北京", "上海", "广州", "深圳", "杭州", "南京", "武汉", "成都", "重庆", "西安", "苏州", "天津", "长沙", "郑州", "青岛",
  ];
  const genericPlaceholders = new Set(["今天", "今日", "现在", "当前", "当地", "本地", "这里", "那里", "这边", "那边"]);
  for (const city of presetCities) {
    if (text.includes(city)) return city;
  }

  const m = text.match(/([\u4e00-\u9fa5]{2,12})(?:市|区|县)?(?:的)?(?:天气|温度|气温)/);
  const candidate = m?.[1]?.trim() ?? null;
  if (!candidate) return null;
  if (genericPlaceholders.has(candidate)) return null;
  return candidate;
}

function buildClothingSuggestion(tempC: number | null, weatherCode: number | null, windSpeed: number | null) {
  if (tempC === null) {
    return "建议按体感分层穿搭：薄外套 + 可增减内搭，出门前留意实时温度变化。";
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

async function queryWeather(city: string) {
  const geoRes = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`,
  );
  if (!geoRes.ok) return null;
  type GeoResp = { results?: Array<{ latitude: number; longitude: number; name?: string; country?: string }> };
  const geoData = (await geoRes.json().catch(() => null)) as GeoResp | null;
  const top = geoData?.results?.[0];
  if (!top) return null;

  const weatherRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${top.latitude}&longitude=${top.longitude}&current=temperature_2m,weather_code,wind_speed_10m&timezone=Asia%2FShanghai`,
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

  const weatherCode = typeof current.weather_code === "number" ? current.weather_code : null;
  const tempC = typeof current.temperature_2m === "number" ? current.temperature_2m : null;
  const windKmh = typeof current.wind_speed_10m === "number" ? current.wind_speed_10m : null;
  const weatherText = weatherCodeToText(weatherCode ?? -1);
  const temp = typeof tempC === "number" ? `${tempC}°C` : "未知";
  const wind = typeof current.wind_speed_10m === "number" ? `${current.wind_speed_10m} km/h` : "未知";
  const cityName = top.name || city;
  const clothing = buildClothingSuggestion(tempC, weatherCode, windKmh);

  return `当前${cityName}天气：${weatherText}，气温约 ${temp}，风速约 ${wind}。${clothing}`;
}

async function queryWeatherByCoords(location: LocationContext) {
  const weatherRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,weather_code,wind_speed_10m&timezone=Asia%2FShanghai`,
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

  let cityName = "你所在位置";
  try {
    const reverseRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${location.latitude}&longitude=${location.longitude}&language=zh&format=json`,
    );
    if (reverseRes.ok) {
      type ReverseResp = { results?: Array<{ name?: string; admin1?: string }> };
      const reverseData = (await reverseRes.json().catch(() => null)) as ReverseResp | null;
      const top = reverseData?.results?.[0];
      if (top?.name) {
        cityName = top.admin1 ? `${top.admin1}${top.name}` : top.name;
      }
    }
  } catch {
    // ignore reverse geocoding failure
  }

  const weatherCode = typeof current.weather_code === "number" ? current.weather_code : null;
  const tempC = typeof current.temperature_2m === "number" ? current.temperature_2m : null;
  const windKmh = typeof current.wind_speed_10m === "number" ? current.wind_speed_10m : null;
  const weatherText = weatherCodeToText(weatherCode ?? -1);
  const temp = typeof tempC === "number" ? `${tempC}°C` : "未知";
  const wind = typeof windKmh === "number" ? `${windKmh} km/h` : "未知";
  const clothing = buildClothingSuggestion(tempC, weatherCode, windKmh);

  return `当前${cityName}天气：${weatherText}，气温约 ${temp}，风速约 ${wind}。${clothing}`;
}

async function tryBuiltinAnswer(messages: InMessage[], location?: LocationContext | null): Promise<BuiltinAnswer | null> {
  const lastUser = [...messages].reverse().find((m) => m.role === "user" && typeof m.text === "string")?.text?.trim();
  if (!lastUser) return null;

  // 时间
  if (/(几点|现在时间|当前时间|日期|今天几号|星期几|北京时间)/.test(lastUser)) {
    return {
      reply: `现在是北京时间 ${formatBeijingNow()}。`,
      emotion: "calm",
    };
  }

  // 天气
  if (/(天气|气温|温度|下雨|几度|会不会下雨)/.test(lastUser)) {
    const city = pickCityFromText(lastUser);
    try {
      const weather = city
        ? await queryWeather(city)
        : location
          ? await queryWeatherByCoords(location)
          : null;
      if (!weather) {
        return {
          reply: city
            ? `我暂时没有查到${city}的天气数据，请稍后重试，或换一个城市名试试。`
            : "我还没有拿到你的位置信息。请开启定位权限，或直接告诉我城市名（例如：北京天气）。",
          emotion: "worried",
        };
      }
      return {
        reply: weather,
        emotion: "happy",
      };
    } catch {
      return {
        reply: city
          ? `天气服务暂时不可用，我没能查到${city}的实时天气，请稍后再试。`
          : "天气服务暂时不可用，我没能查到你当前位置的实时天气，请稍后再试。",
        emotion: "worried",
      };
    }
  }

  // 地点类基础问答
  if (/(我在哪|我的位置|当前位置|我现在在哪|定位|地点)/.test(lastUser)) {
    return {
      reply: location
        ? `我拿到的定位大致是纬度 ${location.latitude.toFixed(4)}、经度 ${location.longitude.toFixed(4)}。如需更准确地点描述，可以再告诉我城市或区域名。`
        : "我还没有拿到你的定位权限。你可以允许浏览器定位，或直接告诉我城市名，我就能继续回答天气和生活建议。",
      emotion: "calm",
    };
  }

  return null;
}

function createBuiltinSseResponse(answer: BuiltinAnswer) {
  const encoder = new TextEncoder();
  const replyWithEmotion = `${answer.reply}\n[[EMOTION:${answer.emotion}]]`;
  const payload = JSON.stringify({ choices: [{ delta: { content: replyWithEmotion } }] });
  const meta = JSON.stringify({ __meta__: true, emotion: answer.emotion });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      controller.enqueue(encoder.encode(`data: ${meta}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ─── 系统提示 ──────────────────────────────────────────────────────────────────
const SYSTEM_VOICE_POLISH: InMessage = {
  role: "system",
  text: "你是中文语音转文字的后处理助手。请对用户的口述文本进行断句、添加标点、纠正常见同音错字，必要时补全主语但不要编造事实。只输出润色后的文本，不要解释，不要加引号，不要加前后缀。",
};

const SYSTEM_TODO_EXTRACT: InMessage = {
  role: "system",
  text: '你是待办提醒解析器。请从用户输入中提取一个待办提醒（如果有）。只输出严格 JSON，不要输出多余文字。JSON 结构：{"title": string, "remindAt": string|null, "recurrence": "none"|"daily"|"weekly"|"monthly"}，remindAt 必须是 ISO8601 日期时间（含时区）或 null。recurrence 用于表示重复规则。若没有提醒意图，输出：{"title":"", "remindAt": null, "recurrence": "none"}。当前时间以用户本地时间为准。',
};

const SYSTEM_NOTICE_EXTRACT: InMessage = {
  role: "system",
  text: '你是校园通知与截图解析助手。请从用户上传的通知、课程截图、群公告中提取一个最重要的待办事项。只输出严格 JSON，不要输出多余文字。JSON 结构：{"title": string, "remindAt": string|null, "location": string, "details": string}。title 要简洁明确；remindAt 必须是 ISO8601 日期时间（含时区）或 null；location 没有就输出空字符串；details 用一句话概括通知内容。若无法识别明确事项，输出：{"title":"", "remindAt": null, "location":"", "details":""}。',
};

function buildScheduleExtractSystem(): InMessage {
  const todayStr = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(new Date());
  return {
    role: "system",
    text: `你是课表截图解析助手。当前服务器日期：${todayStr}。\n\n任务：从用户上传的一周课表截图中提取所有课程，只输出严格 JSON，不要输出任何多余文字。\n\nJSON 结构：{"grid_analysis":"简要分析截图行列结构与日期、时间轴的对应关系","courses":[{"date":"YYYY-MM-DD","weekday":number,"title":"课程名","classroom":"教室","startTime":"HH:mm","endTime":"HH:mm"}]}\n\n规则：\n1. 请先在 grid_analysis 输出你的思维链，包括表头日期识别、每列对应的星期，以及时间轴的推算。\n2. 优先识别每列对应的精确日期并填写 date（YYYY-MM-DD），不要只给 weekday。\n3. 课表顶部通常包含星期和日期数字（例如 23/24/25），请结合用户消息给出的“当前日期、本周一日期”推断完整年月日。\n4. 课程归属列必须按课程块“水平中心点”所在列判断。即使当前日期列被高亮/加粗，也不能把相邻列课程误判到当前列。\n5. weekday 必须与 date 一致，取值为周一=1，...，周日=7。\n6. startTime 和 endTime 必须来自同一课程块的上下边界：startTime 取课程块上边界对应时间，endTime 取课程块下边界对应时间，格式均为 HH:mm（24 小时制）。\n7. 严禁把上下空白区域或相邻课程块并入当前课程块。endTime 只能落在该课程块真实下边界对应时间。\n8. 同名课程在不同日期可重复出现，必须分别独立识别，不得借用其他日期同名课程的 endTime。\n9. 课程时间必须覆盖课程块完整高度，不能只取首节课时间。示例：3月23日“写作与沟通”为 10:00-11:45；3月23日“工程训练（制造工艺实习）B”为 13:45-17:30；3月25日“系统与控制”为 13:45-15:30。\n10. classroom 无法识别时填空字符串。\n11. 不得编造课程。若未识别到课程，输出 {"grid_analysis":"未发现课程","courses":[]}.`,
  };
}

function buildScheduleNextSystem(): InMessage {
  const now = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).format(new Date());
  return {
    role: "system",
    text: `你是课表截图解析助手。当前时间：${now}。请直接从用户上传的一周课表截图中找出“当前时间之后最近的一门课”。\n\n只输出严格 JSON：{"nextCourse":{"date":"YYYY-MM-DD","weekday":number,"title":"课程名","classroom":"教室","startTime":"HH:mm"}}\n如果无法识别，输出：{"nextCourse":null}\n\n要求：\n1. 依据截图顶部日期与星期，给出精确 date。\n2. startTime 取课程块上边界对应时间，而不是仅按节次序号猜测。\n3. 返回的课程必须是“当前时间之后最近的一门”。\n4. weekday: 周一=1 ... 周日=7。`,
  };
}

function buildChatSystem(personaPrompt?: string): InMessage {
  const base =
    personaPrompt ||
    "你是一位温柔、贴心的生活助手，名字叫做\"伴你左右\"。你擅长聊天、提醒、建议，语气自然友好。";
  return {
    role: "system",
    text: `${base}\n\n重要要求：在每次回复的**最末尾**，必须另起一行，只输出如下格式的情绪标签（不要有多余文字）：\n[[EMOTION:happy]] 或 [[EMOTION:calm]] 或 [[EMOTION:worried]] 或 [[EMOTION:surprised]] 或 [[EMOTION:neutral]]\n请根据对话内容判断用户/场景的整体情绪倾向来选择一个。`,
  };
}

export async function POST(req: Request) {
  const key = getDashScopeKey();
  type RequestBody = {
    purpose?: string;
    messages?: InMessage[];
    model?: string;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    personaPrompt?: string;
    location?: LocationContext | null;
  };
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messages: InMessage[] = Array.isArray(body?.messages)
    ? body.messages
      .filter((item): item is InMessage => {
        if (!item || typeof item !== "object") return false;
        if (item.role !== "user" && item.role !== "assistant" && item.role !== "system") return false;
        return typeof item.text === "string";
      })
      .map((item) => ({ role: item.role, text: item.text, imageDataUrl: item.imageDataUrl }))
    : [];

  if (messages.length === 0) {
    return Response.json({ error: "messages is required" }, { status: 400 });
  }

  const purpose = body?.purpose || "chat";
  const location = body?.location && Number.isFinite(body.location.latitude) && Number.isFinite(body.location.longitude)
    ? {
      latitude: body.location.latitude,
      longitude: body.location.longitude,
      accuracy: body.location.accuracy,
      updatedAt: body.location.updatedAt,
    }
    : null;

  if (!key) {
    if (purpose === "voice_polish") {
      const fallback = messages[messages.length - 1]?.text?.trim() || "";
      return Response.json({ reply: fallback, emotion: "neutral" });
    }
    if (purpose === "todo_extract") {
      return Response.json({ reply: '{"title":"","remindAt":null,"recurrence":"none"}', emotion: "neutral" });
    }
    if (purpose === "notice_extract") {
      return Response.json({ reply: '{"title":"","remindAt":null,"location":"","details":""}', emotion: "neutral" });
    }
    if (purpose === "schedule_extract") {
      return Response.json({ reply: '{"courses":[]}', emotion: "neutral" });
    }
    if (purpose === "schedule_next") {
      return Response.json({ reply: '{"nextCourse":null}', emotion: "neutral" });
    }
    return Response.json(
      {
        reply: "暂时无法连接大模型（未配置 API Key）。请在 .env.local 中设置 DASHSCOPE_API_KEY 或 ALIBABA_API_KEY。",
        emotion: "worried",
      },
      { status: 200 },
    );
  }

  const hasImage = messages.some((m) => Boolean(m.imageDataUrl));
  const defaultTextModel = process.env.DASHSCOPE_MODEL || "qwen-plus";
  const defaultVisionModel = process.env.DASHSCOPE_VL_MODEL || "qwen-vl-plus";
  const model: string = body?.model || (hasImage ? defaultVisionModel : defaultTextModel);

  const endpoint = getEndpoint(hasImage);
  const wantStream = purpose === "chat" && body?.stream === true;

  // 聊天场景优先走基础问答能力（时间/天气/地点）
  if (purpose === "chat") {
    const builtin = await tryBuiltinAnswer(messages, location);
    if (builtin) {
      if (wantStream) {
        return createBuiltinSseResponse(builtin);
      }
      return Response.json({
        reply: builtin.reply,
        emotion: builtin.emotion,
      });
    }
  }

  // 构建上游消息列表与 temperature
  let upstreamMessages: InMessage[];
  let temperature: number;
  if (purpose === "voice_polish") {
    upstreamMessages = [SYSTEM_VOICE_POLISH, ...messages];
    temperature = typeof body?.temperature === "number" ? body.temperature : 0.2;
  } else if (purpose === "todo_extract") {
    upstreamMessages = [SYSTEM_TODO_EXTRACT, ...messages];
    temperature = typeof body?.temperature === "number" ? body.temperature : 0;
  } else if (purpose === "notice_extract") {
    upstreamMessages = [SYSTEM_NOTICE_EXTRACT, ...messages];
    temperature = typeof body?.temperature === "number" ? body.temperature : 0;
  } else if (purpose === "schedule_extract") {
    upstreamMessages = [buildScheduleExtractSystem(), ...messages];
    temperature = typeof body?.temperature === "number" ? body.temperature : 0;
  } else if (purpose === "schedule_next") {
    upstreamMessages = [buildScheduleNextSystem(), ...messages];
    temperature = typeof body?.temperature === "number" ? body.temperature : 0;
  } else {
    upstreamMessages = [buildChatSystem(body?.personaPrompt), ...messages];
    temperature = typeof body?.temperature === "number" ? body.temperature : 0.7;
  }


  // ─── 流式响应 ─────────────────────────────────────────────────────────────────
  if (wantStream) {
    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: upstreamMessages.map(toOpenAIMessage),
          temperature,
          max_tokens: typeof body?.max_tokens === "number" ? body.max_tokens : 1024,
          stream: true,
        }),
      });
    } catch (error) {
      return Response.json(
        { error: "Upstream request failed", details: error instanceof Error ? error.message : "network error" },
        { status: 502 },
      );
    }

    if (!upstreamRes.ok || !upstreamRes.body) {
      const errText = await upstreamRes.text().catch(() => "");
      return Response.json(
        { error: "Upstream stream error", status: upstreamRes.status, details: errText.slice(0, 1000) },
        { status: 502 },
      );
    }

    // TransformStream：透传 SSE 块，流结束后附加情绪 meta 事件
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let accumulatedContent = "";

    (async () => {
      const reader = upstreamRes.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
          const chunkText = decoder.decode(value, { stream: true });
          for (const line of chunkText.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const jsonStr = line.slice(5).trim();
            if (jsonStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(jsonStr) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              accumulatedContent += parsed.choices?.[0]?.delta?.content ?? "";
            } catch { /* ignore */ }
          }
        }
        // 流结束后注入情绪 meta 事件
        const emotionMatch = accumulatedContent.match(
          /\[\[EMOTION:(happy|calm|worried|surprised|neutral)\]\]/,
        );
        const emotion = emotionMatch ? emotionMatch[1] : "neutral";
        await writer.write(
          encoder.encode(`data: ${JSON.stringify({ __meta__: true, emotion })}\n\n`),
        );
      } catch { /* ignore */ } finally {
        await writer.close().catch(() => {});
      }
    })();

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // ─── 非流式响应 ───────────────────────────────────────────────────────────────
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: upstreamMessages.map(toOpenAIMessage),
        temperature,
        max_tokens: typeof body?.max_tokens === "number" ? body.max_tokens : 1024,
        stream: false,
      }),
    });
  } catch (error) {
    return Response.json(
      { error: "Upstream request failed", details: error instanceof Error ? error.message : "network error" },
      { status: 502 },
    );
  }

  const text = await upstreamRes.text();
  if (!upstreamRes.ok) {
    return Response.json(
      { error: "Upstream error", status: upstreamRes.status, details: text.slice(0, 2000) },
      { status: 502 },
    );
  }

  type UpstreamResponse = { choices?: Array<{ message?: { content?: string } }> };
  let data: UpstreamResponse;
  try {
    data = JSON.parse(text) as UpstreamResponse;
  } catch {
    return Response.json({ error: "Upstream returned non-JSON", details: text.slice(0, 2000) }, { status: 502 });
  }

  const rawReply: string = data?.choices?.[0]?.message?.content ?? "";

  if (purpose === "voice_polish" || purpose === "todo_extract" || purpose === "notice_extract" || purpose === "schedule_extract" || purpose === "schedule_next") {
    return Response.json({
      reply: typeof rawReply === "string" ? rawReply.trim() : "",
      emotion: "neutral",
      raw: process.env.RETURN_UPSTREAM_RAW === "1" ? data : undefined,
    });
  }
  // 提取并移除情绪标签
  const emotionMatch = rawReply.match(
    /\[\[EMOTION:(happy|calm|worried|surprised|neutral)\]\]/,
  );
  const emotion = emotionMatch ? emotionMatch[1] : "neutral";
  const reply = rawReply
    .replace(/\n?\[\[EMOTION:(happy|calm|worried|surprised|neutral)\]\]\s*$/, "")
    .trim();

  return Response.json({
    reply: typeof reply === "string" ? reply : "",
    emotion,
    raw: process.env.RETURN_UPSTREAM_RAW === "1" ? data : undefined,
  });
}

