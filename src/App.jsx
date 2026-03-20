import { useState, useRef, useEffect } from "react";

const MODELS = {
  anthropic: {
    label: "Claude (Anthropic)",
    url: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-sonnet-4-20250514",
    format: "anthropic",
  },
  deepseek: {
    label: "DeepSeek",
    url: "https://api.deepseek.com/chat/completions",
    defaultModel: "deepseek-chat",
    format: "openai",
  },
  openai: {
    label: "GPT (OpenAI)",
    url: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o",
    format: "openai",
  },
  gemini: {
    label: "Gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    defaultModel: "gemini-2.0-flash",
    format: "openai",
  },
};

const buildSystem = (s) => `
你是一个文字RPG游戏的叙事者（GM），负责推进剧情、扮演NPC、描写世界。

## 世界观
${s.world || "（未填写）"}

## 主角设定（玩家扮演）
${s.protagonist || "（未填写）"}

## 重要角色
${s.chars || "（未填写）"}

## 叙事规则
- 用第二人称"你……"叙述
- 文笔细腻，像文学小说
- 每轮结尾必须开启新事件或新进展，禁止用环境描写收尾
- 所有关系循序渐进，禁止角色对主角莫名好感
- NPC有自己的动机，世界自己在运转
- 提供2-4个选项，格式：每行一个，前面加 ▶ 符号

## 上下文自查（每轮必须执行）
生成前内部核查：当前在场人物、上一重要事件、主角状态/位置、未解悬念。发现不一致优先以最近几轮为准自然修正。

## 状态输出
每次回复末尾用---分隔，输出：
---
📍 位置：
👥 在场人物：
🕐 节点：
📌 悬念：
`;

const parseReply = (text) => {
  const parts = text.split("---");
  const body = parts[0].trim();
  const statusRaw = (parts[1] || "").trim();
  const lines = body.split("\n");
  const story = [], opts = [];
  for (const l of lines) {
    if (l.trim().startsWith("▶")) opts.push(l.trim().replace(/^▶\s*/, ""));
    else story.push(l);
  }
  return { story: story.join("\n").trim(), opts, status: statusRaw.split("\n").filter(Boolean) };
};

const callModel = async ({ provider, apiKey, messages, systemPrompt }) => {
  const cfg = MODELS[provider];

  if (cfg.format === "anthropic") {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: cfg.defaultModel,
        max_tokens: 1000,
        system: systemPrompt,
        messages,
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return (data.content || []).map((b) => b.text || "").join("");
  }

  if (cfg.format === "openai") {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.defaultModel,
        max_tokens: 1000,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices?.[0]?.message?.content || "";
  }
};

export default function App() {
  const [tab, setTab] = useState("settings");
  const [provider, setProvider] = useState("deepseek");
  const [apiKey, setApiKey] = useState("");
  const [world, setWorld] = useState("");
  const [protagonist, setProtagonist] = useState("");
  const [chars, setChars] = useState("");
  const [messages, setMessages] = useState([]);
  const [contextLog, setContextLog] = useState([]);
  const [storyText, setStoryText] = useState("");
  const [options, setOptions] = useState([]);
  const [statusLines, setStatusLines] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState("");
  const storyRef = useRef(null);

  useEffect(() => {
    if (storyRef.current) storyRef.current.scrollTop = storyRef.current.scrollHeight;
  }, [storyText]);

  const call = async (userMsg, currentMessages) => {
    const newMsgs = [...currentMessages, { role: "user", content: userMsg }];
    setMessages(newMsgs);
    setLoading(true);
    setStoryText("……");
    setOptions([]);
    setError("");

    try {
      const raw = await callModel({
        provider,
        apiKey,
        messages: newMsgs,
        systemPrompt: buildSystem({ world, protagonist, chars }),
      });
      const parsed = parseReply(raw);
      setMessages([...newMsgs, { role: "assistant", content: raw }]);
      setStoryText(parsed.story);
      setOptions(parsed.opts);
      setStatusLines(parsed.status);
      setContextLog((prev) => [
        { turn: newMsgs.length, input: userMsg, status: parsed.status },
        ...prev.slice(0, 19),
      ]);
    } catch (e) {
      setError(e.message || "请求失败，请检查API key或网络。");
      setStoryText("");
    } finally {
      setLoading(false);
    }
  };

  const handleStart = () => {
    if (!apiKey) return alert("请先填入API key");
    setStarted(true);
    setTab("game");
    call("游戏开始，请描述开场场景。", []);
  };

  const handleSend = (text) => {
    const val = text
