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

const buildSystem = (s, attrs) => `
你是一个文字RPG游戏的叙事者（GM），负责推进剧情、扮演NPC、描写世界。

## 世界观
${s.world || "（未填写）"}

## 主角设定
${s.protagonist || "（未填写）"}

## 重要角色
${s.chars || "（未填写）"}

## 当前角色属性
${attrs.length > 0 ? attrs.map(a => `${a.name}：${a.value}`).join("、") : "（未设定）"}

## 叙事规则
- 用第二人称"你……"叙述
- 文笔细腻，像文学小说
- 每轮结尾必须开启新事件或新进展，禁止用环境描写收尾
- 所有关系循序渐进，禁止角色对主角莫名好感
- NPC有自己的动机，世界自己在运转
- 提供2-4个选项，格式：每行一个，前面加 ▶ 符号

## 检定规则
当玩家的行动需要检定时，在叙事中插入以下格式触发骰子：
[检定:技能名:DC数字]
例如：[检定:欺骗:15] 或 [检定:心境:12]
技能名必须和角色属性里的名字完全一致。
检定结果由系统自动计算（角色技能值 + D20），你需要在检定标记后继续写两种可能的结果：
成功：……
失败：……
系统会根据roll结果选择对应叙事继续推进。

## NPC好感度
当好感度发生变化时，在回复末尾的状态块里更新对应NPC的好感值。

## 上下文自查（每轮必须执行）
生成前内部核查：当前在场人物、上一重要事件、主角状态/位置、未解悬念。

## 状态输出
每次回复末尾用---分隔：
---
📍 位置：
👥 在场人物：
🕐 节点：
📌 悬念：
❤️ 好感：
`;

const parseAttrs = (raw) => {
  if (!raw.trim()) return [];
  return raw.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
    const [name, value] = l.split(":").map(s => s.trim());
    return { name, value: parseInt(value) || 0 };
  }).filter(a => a.name);
};

const parseReply = (text) => {
  const parts = text.split("---");
  const body = parts[0].trim();
  const statusRaw = (parts[1] || "").trim();
  const lines = body.split("\n");
  const story = [], opts = [];
  let checkMatch = null;
  let successText = "";
  let failText = "";

  const checkRegex = /\[检定:(.+?):(\d+)\]/;
  for (const l of lines) {
    if (l.trim().startsWith("▶")) {
      opts.push(l.trim().replace(/^▶\s*/, ""));
    } else if (checkRegex.test(l) && !checkMatch) {
      checkMatch = l.match(checkRegex);
    } else if (checkMatch && l.startsWith("成功：")) {
      successText = l.replace("成功：", "").trim();
    } else if (checkMatch && l.startsWith("失败：")) {
      failText = l.replace("失败：", "").trim();
    } else {
      story.push(l);
    }
  }

  return {
    story: story.join("\n").trim(),
    opts,
    status: statusRaw.split("\n").filter(Boolean),
    check: checkMatch ? { skill: checkMatch[1], dc: parseInt(checkMatch[2]), successText, failText } : null,
  };
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
      body: JSON.stringify({ model: cfg.defaultModel, max_tokens: 1000, system: systemPrompt, messages }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return (data.content || []).map(b => b.text || "").join("");
  }
  if (cfg.format === "openai") {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: cfg.defaultModel, max_tokens: 1000,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices?.[0]?.message?.content || "";
  }
};

const DiceModal = ({ check, attrs, onResult }) => {
  const [rolling, setRolling] = useState(false);
  const [rolled, setRolled] = useState(null);
  const [display, setDisplay] = useState(null);

  const skillAttr = attrs.find(a => a.name === check.skill);
  const skillVal = skillAttr?.value || 0;

  const roll = () => {
    setRolling(true);
    let count = 0;
    const interval = setInterval(() => {
      setDisplay(Math.floor(Math.random() * 20) + 1);
      count++;
      if (count > 15) {
        clearInterval(interval);
        const final = Math.floor(Math.random() * 20) + 1;
        setRolled(final);
        setDisplay(final);
        setRolling(false);
      }
    }, 60);
  };

  const total = rolled !== null ? rolled + skillVal : null;
  const success = total !== null ? total >= check.dc : null;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(90,62,43,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
    }}>
      <div style={{
        background: "#fffaf4", border: "1px solid rgba(180,140,100,0.3)",
        borderRadius: 12, padding: "32px 40px", textAlign: "center",
        fontFamily: "'Ma Shan Zheng', Georgia, serif", minWidth: 300,
      }}>
        <div style={{ fontSize: 13, color: "#b89880", marginBottom: 6, letterSpacing: "0.1em" }}>技能检定</div>
        <div style={{ fontSize: 20, color: "#5a3e2b", marginBottom: 4, fontWeight: 500 }}>{check.skill}</div>
        <div style={{ fontSize: 12, color: "#b89880", marginBottom: 24 }}>
          技能值 {skillVal} · 目标 DC {check.dc}
        </div>

        <div style={{
          width: 80, height: 80, margin: "0 auto 24px",
          border: "2px solid #c47c5a", borderRadius: 12,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 36, color: "#c47c5a", fontWeight: 500,
          transition: "all 0.05s",
          background: rolling ? "rgba(196,124,90,0.08)" : "transparent",
        }}>
          {display || "?"}
        </div>

        {total !== null && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: "#b89880", marginBottom: 4 }}>
              {rolled} + {skillVal} = <span style={{ fontSize: 16, color: "#5a3e2b", fontWeight: 500 }}>{total}</span>
            </div>
            <div style={{
              fontSize: 15, fontWeight: 500,
              color: success ? "#6a9e6a" : "#c47c5a",
              marginTop: 4,
            }}>
              {success ? "✦ 检定成功" : "✧ 检定失败"}
            </div>
          </div>
        )}

        {rolled === null ? (
          <button onClick={roll} disabled={rolling} style={{
            background: "#c47c5a", border: "none", borderRadius: 6,
            color: "#fffaf4", fontFamily: "inherit", fontSize: 13,
            padding: "10px 28px", cursor: rolling ? "not-allowed" : "pointer",
            letterSpacing: "0.1em", opacity: rolling ? 0.7 : 1,
          }}>
            {rolling ? "投掷中……" : "投掷骰子"}
          </button>
        ) : (
          <button onClick={() => onResult(success)} style={{
            background: "#c47c5a", border: "none", borderRadius: 6,
            color: "#fffaf4", fontFamily: "inherit", fontSize: 13,
            padding: "10px 28px", cursor: "pointer", letterSpacing: "0.1em",
          }}>
            继续
          </button>
        )}
      </div>
    </div>
  );
};

export default function App() {
  const [tab, setTab] = useState("settings");
  const [provider, setProvider] = useState("deepseek");
  const [apiKey, setApiKey] = useState("");
  const [world, setWorld] = useState("");
  const [protagonist, setProtagonist] = useState("");
  const [chars, setChars] = useState("");
  const [attrsRaw, setAttrsRaw] = useState("");
  const [messages, setMessages] = useState([]);
  const [contextLog, setContextLog] = useState([]);
  const [storyText, setStoryText] = useState("");
  const [options, setOptions] = useState([]);
  const [statusLines, setStatusLines] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState("");
  const [pendingCheck, setPendingCheck] = useState(null);
  const [pendingSuccess, setPendingSuccess] = useState("");
  const [pendingFail, setPendingFail] = useState("");
  const [pendingMsgs, setPendingMsgs] = useState([]);
  const storyRef = useRef(null);

  const attrs = parseAttrs(attrsRaw);
  const npcAttrs = attrs.filter(a => a.name.startsWith("好感_"));
  const charAttrs = attrs.filter(a => !a.name.startsWith("好感_"));

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
        provider, apiKey, messages: newMsgs,
        systemPrompt: buildSystem({ world, protagonist, chars }, attrs),
      });
      const parsed = parseReply(raw);
      const finalMsgs = [...newMsgs, { role: "assistant", content: raw }];

      if (parsed.check) {
        setPendingCheck(parsed.check);
        setPendingSuccess(parsed.check.successText);
        setPendingFail(parsed.check.failText);
        setPendingMsgs(finalMsgs);
        setStoryText(parsed.story);
      } else {
        setMessages(finalMsgs);
        setStoryText(parsed.story);
        setOptions(parsed.opts);
        setStatusLines(parsed.status);
        setContextLog(prev => [{ turn: newMsgs.length, input: userMsg, status: parsed.status }, ...prev.slice(0, 19)]);
      }
    } catch (e) {
      setError(e.message || "请求失败，请检查API key或网络。");
      setStoryText("");
    } finally {
      setLoading(false);
    }
  };

  const handleCheckResult = (success) => {
    const resultText = success ? pendingSuccess : pendingFail;
    setMessages(pendingMsgs);
    setStoryText(prev => prev + "\n\n" + resultText);
    setPendingCheck(null);
  };

  const handleStart = () => {
    if (!apiKey) return alert("请先填入API key");
    setStarted(true);
    setTab("game");
    call("游戏开始，请描述开场场景。", []);
  };

  const handleSend = (text) => {
    const val = text || input.trim();
    if (!val || loading) return;
    setInput("");
    call(val, messages);
  };

  const c = {
    bg: "#fdf6ee", side: "#faeede", panel: "#fffaf4",
    border: "rgba(180,140,100,0.2)", accent: "#c47c5a",
    text: "#5a3e2b", muted: "#b89880", story: "#3d2b1f",
  };

  const ta = {
    width: "100%", background: "rgba(255,255,255,0.6)",
    border: `1px solid ${c.border}`, borderRadius: 6,
    color: c.text, fontFamily: "'Ma Shan Zheng', Georgia, serif",
    fontSize: 12, lineHeight: 1.8, padding: "8px 10px",
    resize: "vertical", outline: "none", boxSizing: "border-box", marginBottom: 12,
  };

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&display=swap');`}</style>
      {pendingCheck && (
        <DiceModal check={pendingCheck} attrs={attrs} onResult={handleCheckResult} />
      )}
      <div style={{ display: "flex", height: "100vh", background: c.bg, color: c.text, fontFamily: "'Ma Shan Zheng', Georgia, serif" }}>
        <div style={{ width: 260, background: c.side, borderRight: `1px solid ${c.border}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ padding: "18px 16px 0", borderBottom: `1px solid ${c.border}` }}>
            <div style={{ fontSize: 15, color: c.accent, letterSpacing: "0.2em", marginBottom: 2 }}>叙事引擎</div>
            <div style={{ fontSize: 10, color: c.muted, marginBottom: 12, letterSpacing: "0.15em" }}>NARRATIVE ENGINE</div>
            <div style={{ display: "flex" }}>
              {[["settings", "设定"], ["attrs", "属性"], ["context", "自查"]].map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)} style={{ background: "none", border: "none", borderBottom: tab === id ? `2px solid ${c.accent}` : "2px solid transparent", color: tab === id ? c.accent : c.muted, fontFamily: "inherit", fontSize: 12, padding: "8px 10px", cursor: "pointer", letterSpacing: "0.08em" }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {started && statusLines.length > 0 && (
            <div style={{ margin: "12px 14px 0", padding: 10, background: "rgba(196,124,90,0.06)", border: `1px solid rgba(196,124,90,0.2)`, borderRadius: 6, fontSize: 11, lineHeight: 2, color: c.text }}>
              {statusLines.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
            {tab === "settings" && (
              <>
                <div style={{ fontSize: 10, letterSpacing: "0.12em", color: c.muted, marginBottom: 5, textTransform: "uppercase" }}>模型</div>
                <select value={provider} onChange={e => setProvider(e.target.value)} style={{ ...ta, resize: "none" }}>
                  {Object.entries(MODELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                {[
                  { label: "API KEY", val: apiKey, set: setApiKey, ph: "粘贴你的API key", rows: 2 },
                  { label: "世界观", val: world, set: setWorld, ph: "故事背景、世界规则……", rows: 4 },
                  { label: "主角设定", val: protagonist, set: setProtagonist, ph: "你的姓名、性格、背景……", rows: 3 },
                  { label: "重要角色", val: chars, set: setChars, ph: "其他NPC简要设定……", rows: 3 },
                ].map(({ label, val, set, ph, rows }) => (
                  <div key={label}>
                    <div style={{ fontSize: 10, letterSpacing: "0.12em", color: c.muted, marginBottom: 5, textTransform: "uppercase" }}>{label}</div>
                    <textarea value={val} onChange={e => set(e.target.value)} placeholder={ph} rows={rows} style={ta} />
                  </div>
                ))}
                <div style={{ fontSize: 10, letterSpacing: "0.12em", color: c.muted, marginBottom: 5, textTransform: "uppercase" }}>角色属性</div>
                <div style={{ fontSize: 10, color: c.muted, marginBottom: 6, lineHeight: 1.7 }}>格式：技能名:数值，一行一个。NPC好感度用 好感_名字:数值</div>
                <textarea value={attrsRaw} onChange={e => setAttrsRaw(e.target.value)} placeholder={"欺骗:12\n说服:8\n心境:15\n好感_师兄:30"} rows={6} style={ta} />
                <button onClick={handleStart} style={{ width: "100%", padding: 10, background: c.accent, border: "none", borderRadius: 6, color: "#fffaf4", fontFamily: "inherit", fontSize: 12, letterSpacing: "0.12em", cursor: "pointer" }}>
                  开始游戏
                </button>
              </>
            )}

            {tab === "attrs" && (
              <div>
                {charAttrs.length > 0 && (
                  <>
                    <div style={{ fontSize: 10, color: c.accent, marginBottom: 10, letterSpacing: "0.1em" }}>角色属性</div>
                    {charAttrs.map((a, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${c.border}`, fontSize: 13 }}>
                        <span style={{ color: c.text }}>{a.name}</span>
                        <span style={{ color: c.accent, fontWeight: 500 }}>{a.value}</span>
                      </div>
                    ))}
                  </>
                )}
                {npcAttrs.length > 0 && (
                  <>
                    <div style={{ fontSize: 10, color: c.accent, margin: "16px 0 10px", letterSpacing: "0.1em" }}>NPC 好感度</div>
                    {npcAttrs.map((a, i) => (
                      <div key={i} style={{ marginBottom: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4, color: c.text }}>
                          <span>{a.name.replace("好感_", "")}</span>
                          <span style={{ color: c.accent }}>{a.value}</span>
                        </div>
                        <div style={{ height: 4, background: "rgba(196,124,90,0.15)", borderRadius: 2 }}>
                          <div style={{ height: "100%", width: `${Math.min(a.value, 100)}%`, background: c.accent, borderRadius: 2, transition: "width 0.3s" }} />
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {charAttrs.length === 0 && npcAttrs.length === 0 && (
                  <div style={{ fontSize: 11, color: c.muted }}>在设定页填写角色属性后显示</div>
                )}
              </div>
            )}

            {tab === "context" && (
              <div>
                <div style={{ fontSize: 10, color: c.accent, marginBottom: 10, letterSpacing: "0.1em" }}>上下文自查日志</div>
                {contextLog.length === 0
                  ? <div style={{ fontSize: 11, color: c.muted }}>游戏开始后记录</div>
                  : contextLog.map((snap, i) => (
                    <div key={i} style={{ marginBottom: 10, padding: 10, background: "rgba(255,255,255,0.5)", border: `1px solid ${c.border}`, borderRadius: 6, fontSize: 11, lineHeight: 1.8 }}>
                      <div style={{ color: c.accent, marginBottom: 3 }}>第 {snap.turn} 轮</div>
                      <div style={{ color: c.muted, marginBottom: 4 }}>▷ {snap.input}</div>
                      {snap.status.map((s, j) => <div key={j} style={{ color: c.text }}>{s}</div>)}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: c.panel }}>
          <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${c.accent}, transparent)`, opacity: 0.3 }} />
          <div ref={storyRef} style={{ flex: 1, overflowY: "auto", padding: "36px 44px 20px", display: "flex", flexDirection: "column", justifyContent: started ? "flex-start" : "center", alignItems: "center" }}>
            {!started ? (
              <div style={{ textAlign: "center", color: c.muted }}>
                <div style={{ fontSize: 28, color: "rgba(196,124,90,0.25)", marginBottom: 12 }}>◈</div>
                <div style={{ fontSize: 12, letterSpacing: "0.2em" }}>在左侧填写设定后开始游戏</div>
              </div>
            ) : (
              <div style={{ maxWidth: 660, width: "100%" }}>
                {error && (
                  <div style={{ color: "#c47c5a", fontSize: 13, marginBottom: 16, padding: "10px 14px", border: "1px solid rgba(196,124,90,0.3)", borderRadius: 6 }}>
                    {error}
                  </div>
                )}
                <div style={{ fontSize: 15, lineHeight: 2.2, color: c.story, whiteSpace: "pre-wrap", fontWeight: 300, letterSpacing: "0.04em", marginBottom: 24 }}>{storyText}</div>
                {options.length > 0 && !loading && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <div style={{ fontSize: 10, color: c.muted, letterSpacing: "0.18em", marginBottom: 3 }}>— 选择行动 —</div>
                    {options.map((opt, i) => (
                      <button key={i} onClick={() => handleSend(opt)} style={{ background: "rgba(196,124,90,0.06)", border: `1px solid rgba(196,124,90,0.2)`, borderRadius: 4, color: c.text, fontFamily: "inherit", fontSize: 13, padding: "9px 14px", textAlign: "left", cursor: "pointer", letterSpacing: "0.03em", lineHeight: 1.6 }}>
                        ▶ {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {started && (
            <>
              <div style={{ margin: "0 44px", height: 1, background: `linear-gradient(90deg, transparent, ${c.border}, transparent)` }} />
              <div style={{ padding: "12px 44px 20px", display: "flex", gap: 10, alignItems: "flex-end" }}>
                <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder="自由输入行动……（Enter发送，Shift+Enter换行）" rows={2} disabled={loading} style={{ ...ta, flex: 1, marginBottom: 0, fontSize: 13 }} />
                <button onClick={() => handleSend()} disabled={loading || !input.trim()} style={{ height: 40, padding: "0 18px", background: c.accent, border: "none", borderRadius: 6, color: "#fffaf4", fontFamily: "inherit", fontSize: 12, cursor: "pointer", flexShrink: 0, opacity: loading || !input.trim() ? 0.4 : 1 }}>
                  {loading ? "……" : "发送"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
