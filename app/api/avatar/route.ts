export const runtime = "nodejs";

type AvatarRequestBody = {
  imageDataUrl?: string;
  requestToken?: string;
};

type FeatureChoice = "none" | "glasses" | "headset";
type HairChoice = "bob" | "long" | "bun";
type FaceChoice = "soft" | "round" | "heart";
type BangsChoice = "none" | "air" | "full" | "side";
type AccessoryChoice = "bow" | "star" | "leaf";
type EyeChoice = "round" | "sparkle" | "wink";
type GenderChoice = "female" | "male";

type AvatarProfile = {
  nickname: string;
  vibes: string[];
  appearanceSummary: string;
  illustrationPrompt: string;
  hairShape: HairChoice;
  faceShape: FaceChoice;
  bangs: BangsChoice;
  feature: FeatureChoice;
  accessory: AccessoryChoice;
  eyeMood: EyeChoice;
  gender: GenderChoice;
};

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type WanxCreateResponse = {
  output?: {
    task_id?: string;
    task_status?: string;
  };
  code?: string;
  message?: string;
};

type WanxTaskResponse = {
  output?: {
    task_status?: string;
    task_id?: string;
    code?: string;
    message?: string;
    submit_time?: string;
    results?: Array<{
      url?: string;
    }>;
  };
  code?: string;
  message?: string;
};

const defaultProfile: AvatarProfile = {
  nickname: "小庆团子",
  vibes: ["奶呼呼", "元气系", "会陪伴"],
  appearanceSummary: "发型自然、五官清晰、整体气质温柔，服装配色简洁。",
  illustrationPrompt:
    "日系二次元头像风格，基于照片真实特征：保持人物脸型与五官比例、发型结构、服装轮廓与主色调。若原图无眼镜/耳机/发饰则不得添加。上半身居中立绘，线条干净细腻，柔和明暗，米白色纯净背景，高品质插画，单人无边框。",
  hairShape: "long",
  faceShape: "soft",
  bangs: "air",
  feature: "none",
  accessory: "bow",
  eyeMood: "sparkle",
  gender: "female",
};

function getDashScopeKey() {
  return process.env.ALIBABA_API_KEY || process.env.DASHSCOPE_API_KEY;
}

function buildVisionMessages(imageDataUrl: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "你是数字人形象设计助手。请严格输出 JSON，不要输出任何解释或 Markdown。根据用户上传的真人照片，提取适合二次元头像风格的人脸与发型特征，输出字段：nickname(string), vibes(string[] 长度3), appearanceSummary(string), illustrationPrompt(string), hairShape(只能是 bob|long|bun), faceShape(只能是 soft|round|heart), bangs(只能是 none|air|full|side), feature(只能是 none|glasses|headset), accessory(只能是 bow|star|leaf), eyeMood(只能是 round|sparkle|wink), gender(只能是 female|male，根据照片中人物性别判断)。要求：保留人物可辨识度与关键特征，尤其是脸型比例、五官位置、发型长短与刘海、服装轮廓与主配色、是否佩戴眼镜/耳机等；生成 illustrationPrompt 时必须明确“有则保留、无则不加”，禁止凭空添加眼镜、耳机、发饰。",
    },
    {
      role: "user",
      content: [
        { type: "text", text: "请分析这张照片并输出用于智能体形象设计的 JSON。" },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];
}

function extractJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("模型未返回有效 JSON");
  }
  return text.slice(start, end + 1);
}

function normalizeProfile(input: Partial<AvatarProfile>): AvatarProfile {
  const hairShape: HairChoice[] = ["bob", "long", "bun"];
  const faceShape: FaceChoice[] = ["soft", "round", "heart"];
  const bangs: BangsChoice[] = ["none", "air", "full", "side"];
  const feature: FeatureChoice[] = ["none", "glasses", "headset"];
  const accessory: AccessoryChoice[] = ["bow", "star", "leaf"];
  const eyeMood: EyeChoice[] = ["round", "sparkle", "wink"];
  const genderChoices: GenderChoice[] = ["female", "male"];

  return {
    nickname: (input.nickname || defaultProfile.nickname).slice(0, 16),
    vibes:
      Array.isArray(input.vibes) && input.vibes.length > 0
        ? input.vibes.map((item) => String(item)).slice(0, 3)
        : defaultProfile.vibes,
    appearanceSummary: input.appearanceSummary || defaultProfile.appearanceSummary,
    illustrationPrompt: input.illustrationPrompt || defaultProfile.illustrationPrompt,
    hairShape: hairShape.includes(input.hairShape as HairChoice)
      ? (input.hairShape as HairChoice)
      : defaultProfile.hairShape,
    faceShape: faceShape.includes(input.faceShape as FaceChoice)
      ? (input.faceShape as FaceChoice)
      : defaultProfile.faceShape,
    bangs: bangs.includes(input.bangs as BangsChoice)
      ? (input.bangs as BangsChoice)
      : defaultProfile.bangs,
    feature: feature.includes(input.feature as FeatureChoice)
      ? (input.feature as FeatureChoice)
      : defaultProfile.feature,
    accessory: accessory.includes(input.accessory as AccessoryChoice)
      ? (input.accessory as AccessoryChoice)
      : defaultProfile.accessory,
    eyeMood: eyeMood.includes(input.eyeMood as EyeChoice)
      ? (input.eyeMood as EyeChoice)
      : defaultProfile.eyeMood,
    gender: genderChoices.includes(input.gender as GenderChoice)
      ? (input.gender as GenderChoice)
      : defaultProfile.gender,
  };
}

async function callVisionModel(imageDataUrl: string, key: string) {
  const endpoint =
    process.env.DASHSCOPE_BASE_URL ||
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
  const model = process.env.DASHSCOPE_VL_MODEL || "qwen-vl-plus";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: buildVisionMessages(imageDataUrl),
      temperature: 0.2,
      max_tokens: 1200,
      stream: false,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`视觉分析失败：HTTP ${response.status} ${text.slice(0, 300)}`);
  }

  const data = JSON.parse(text) as ChatCompletionResponse;
  const rawContent = data.choices?.[0]?.message?.content || "";
  const profile = JSON.parse(extractJsonObject(rawContent)) as Partial<AvatarProfile>;
  return normalizeProfile(profile);
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getAnimeConversionPrompt() {
  return [
    "将输入照片中的同一人物转换为日系动漫形象。",
    "要求 1:1 保持原图的人物比例与构图，不改变拍摄角度与头部朝向。",
    "严格保留：脸型、五官位置与比例、发型长度与分缝、刘海、眼镜、耳机、服装轮廓与配色。",
    "禁止：新增原图没有的元素（发饰、辫子、首饰、夸张妆容、改变发色、改变脸型）。",
    "输出：单人上半身动漫图，干净浅色背景，高细节，无文字，无水印。",
  ].join(" ");
}

async function createAsyncTask(
  endpoint: string,
  key: string,
  body: Record<string, unknown>,
) {
  const createRes = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify(body),
  });

  const createText = await createRes.text();
  if (!createRes.ok) {
    throw new Error(`创建出图任务失败：HTTP ${createRes.status} ${createText.slice(0, 300)}`);
  }

  const createData = JSON.parse(createText) as WanxCreateResponse;
  const taskId = createData.output?.task_id;
  if (!taskId) {
    throw new Error(createData.message || "未获取到出图任务 ID");
  }

  return taskId;
}

async function pollTaskResult(taskId: string, key: string) {
  const taskEndpoint =
    process.env.DASHSCOPE_TASK_API_ENDPOINT || "https://dashscope.aliyuncs.com/api/v1/tasks";

  for (let index = 0; index < 30; index += 1) {
    await wait(2000);
    const pollRes = await fetch(`${taskEndpoint}/${taskId}`, {
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });
    const pollText = await pollRes.text();
    if (!pollRes.ok) {
      throw new Error(`轮询出图任务失败：HTTP ${pollRes.status} ${pollText.slice(0, 300)}`);
    }

    const pollData = JSON.parse(pollText) as WanxTaskResponse;
    const status = pollData.output?.task_status;
    if (status === "SUCCEEDED") {
      const url = pollData.output?.results?.[0]?.url;
      if (!url) {
        throw new Error("出图完成但未返回图片地址");
      }
      return url;
    }

    if (status === "FAILED" || status === "CANCELED") {
      const errMsg =
        pollData.output?.message ||
        pollData.output?.code ||
        pollData.message ||
        `出图任务状态异常：${status}`;
      throw new Error(errMsg);
    }
  }

  throw new Error("出图超时，请稍后重试");
}

async function generateIllustrationFromReference(imageDataUrl: string, key: string) {
  const endpoint =
    process.env.DASHSCOPE_IMAGE2IMAGE_API_ENDPOINT ||
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis";
  const model = process.env.DASHSCOPE_IMAGE2IMAGE_MODEL || "wanx2.1-imageedit";

  // DashScope imageedit 需要纯 base64（去掉 data:image/...;base64, 前缀）
  const rawBase64 = imageDataUrl.replace(/^data:[^;]+;base64,/, "");

  const taskId = await createAsyncTask(endpoint, key, {
    model,
    input: {
      function: "image_style_repaint",
      base_image: rawBase64,
      prompt: getAnimeConversionPrompt(),
    },
    parameters: {
      n: 1,
    },
  });

  return pollTaskResult(taskId, key);
}

async function generateIllustration(prompt: string, key: string) {
  const endpoint =
    process.env.DASHSCOPE_IMAGE_API_ENDPOINT ||
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis";
  const model = process.env.DASHSCOPE_IMAGE_MODEL || "wanx2.1-t2i-turbo";

  const taskId = await createAsyncTask(endpoint, key, {
    model,
    input: { prompt },
    parameters: { size: "1024*1024", n: 1 },
  });
  return pollTaskResult(taskId, key);
}

function hashSeedFromText(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  // DashScope 常见 seed 范围使用正整数，这里限制在 1..2147483646
  return (hash % 2147483646) + 1;
}

async function generateIllustrationWithSeed(prompt: string, key: string, seed: number) {
  const endpoint =
    process.env.DASHSCOPE_IMAGE_API_ENDPOINT ||
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis";
  const model = process.env.DASHSCOPE_IMAGE_MODEL || "wanx2.1-t2i-turbo";

  const taskId = await createAsyncTask(endpoint, key, {
    model,
    input: { prompt },
    parameters: { size: "1024*1024", n: 1, seed },
  });
  return pollTaskResult(taskId, key);
}

export async function POST(req: Request) {
  const key = getDashScopeKey();
  if (!key) {
    return Response.json(
      { error: "Missing API key. Set ALIBABA_API_KEY (or DASHSCOPE_API_KEY) in .env.local." },
      { status: 500 },
    );
  }

  let body: AvatarRequestBody;
  try {
    body = (await req.json()) as AvatarRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.imageDataUrl) {
    return Response.json({ error: "imageDataUrl is required" }, { status: 400 });
  }

  const requestToken = typeof body.requestToken === "string" ? body.requestToken : "";

  try {
    const profile = await callVisionModel(body.imageDataUrl, key);
    const deterministicSeed = hashSeedFromText(body.imageDataUrl);
    const illustrationPrompt = [
      "请基于上传照片进行高相似度二次元头像复刻。",
      profile.illustrationPrompt,
      `人物特征清单：${profile.appearanceSummary}`,
      "要求：保持与照片一致的人脸结构（脸型、五官相对位置、眼型、鼻口比例、下颌线）、发型结构（长度、分缝、刘海、卷直程度）、眼镜与耳机等配饰。",
      "硬约束：如果原图没有耳机或眼镜，输出中绝对不能新增耳机或眼镜。",
      "禁止：添加照片中不存在的元素（如额外发饰、双马尾/辫子、夸张首饰、改变发色、改变脸型）。",
      "风格：日系清新动漫头像，上半身立绘，干净米白背景，单人，无文字，无水印，高细节。",
    ].join(" ");

    let illustrationUrl = "";
    let illustrationError = "";
    try {
      illustrationUrl = await generateIllustrationWithSeed(illustrationPrompt, key, deterministicSeed);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "生成失败";
      illustrationError = `出图失败：${msg}`;
    }

    return Response.json({
      requestToken,
      profile,
      illustrationPrompt,
      illustrationUrl,
      illustrationError,
    });
  } catch (error) {
    return Response.json(
      { requestToken, error: error instanceof Error ? error.message : "头像生成失败" },
      { status: 502 },
    );
  }
}
