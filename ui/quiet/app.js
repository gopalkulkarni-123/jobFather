/* CV Tailor: quiet UI over `opencode serve`.
 *
 * OpenCode still does all the work (slash commands /tailor and /score, the
 * career-architect agent, its tools and its `question` prompts). This page only
 * decides what to show:
 *   - agent text messages, rendered as markdown
 *   - tool calls folded into one-line steps ("Read the job posting")
 *   - question and permission requests as cards
 *   - generated files in the right panel
 * Reasoning, tool inputs and tool outputs are hidden unless "Details" is on.
 */

const LS = {
  session: "cvt.session",
  labels: "cvt.labels",
  model: "cvt.model",
  details: "cvt.details",
};

const state = {
  sessionId: localStorage.getItem(LS.session) || null,
  ours: new Map(), // sessionID -> true/false (main session or one of its subagent sessions)
  messages: new Map(), // msgID -> { info, parts: Map(partID -> part) }
  dirty: new Set(),
  openSteps: new Set(),
  labels: JSON.parse(localStorage.getItem(LS.labels) || "{}"), // user msgID -> short label
  pendingLabel: null,
  questions: new Map(), // requestID -> { req, idx, sel: Set[], custom: string[] }
  perms: new Map(), // requestID -> req
  errors: [], // { at, text }
  busy: false,
  activity: "",
  details: localStorage.getItem(LS.details) === "1",
  inputs: [],
  outputs: [],
  knownBundles: null,
  activeBundle: null,
  kind: "cv",
  file: null,
  content: "",
  sessionScores: { before: null, after: null },
  liPaste: false,
  jobPaste: false,
  sse: null,
};

const $ = (id) => document.getElementById(id);

// ---------- helpers ----------
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function trunc(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function baseName(p) {
  return String(p || "").split(/[\\/]/).pop();
}
function host(u) {
  try {
    return new URL(u).host;
  } catch (_) {
    return trunc(u, 40);
  }
}
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.add("hidden"), 2600);
}
async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || data.error || data.message || `HTTP ${res.status}`);
  return data;
}
function post(url, body) {
  return api(url, { method: "POST", body: JSON.stringify(body || {}) });
}

function md(src) {
  if (!src) return "";
  const blocks = [];
  let text = String(src).replace(/```[\w-]*\n([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre><code>${esc(code.replace(/\n$/, ""))}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = [];
  let list = null;
  let table = false;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const closeTable = () => {
    if (table) out.push("</tbody></table>");
    table = false;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const blk = line.match(/^\u0000(\d+)\u0000$/);
    if (blk) {
      closeList();
      closeTable();
      out.push(blocks[+blk[1]]);
      continue;
    }
    if (line.startsWith("|") && line.endsWith("|")) {
      closeList();
      const cells = line.slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      if (!table) {
        out.push("<table><thead><tr>" + cells.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>");
        table = true;
      } else out.push("<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
      continue;
    }
    closeTable();
    if (!line) {
      closeList();
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      closeList();
      out.push("<hr>");
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      closeList();
      const n = Math.min(h[1].length + 1, 4);
      out.push(`<h${n}>${inline(h[2])}</h${n}>`);
      continue;
    }
    const ul = line.match(/^[-*•]\s+(.+)$/);
    const ol = line.match(/^\d+[.)]\s+(.+)$/);
    if (ul || ol) {
      const want = ul ? "ul" : "ol";
      if (list !== want) {
        closeList();
        out.push(`<${want}>`);
        list = want;
      }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  closeTable();
  return out.join("\n");
}

// ---------- session ownership ----------
async function isOurs(sid) {
  if (!sid || !state.sessionId) return false;
  if (sid === state.sessionId) return true;
  if (state.ours.has(sid)) return state.ours.get(sid);
  try {
    const s = await api(`/api/oc/session/${encodeURIComponent(sid)}`);
    const ok = !!s.parentID && (await isOurs(s.parentID));
    state.ours.set(sid, ok);
    return ok;
  } catch (_) {
    return false;
  }
}

// ---------- message store ----------
function upsertInfo(info) {
  let m = state.messages.get(info.id);
  if (!m) {
    m = { info, parts: new Map() };
    state.messages.set(info.id, m);
    if (info.role === "user" && state.pendingLabel && !state.labels[info.id]) {
      state.labels[info.id] = state.pendingLabel;
      state.pendingLabel = null;
      saveLabels();
    }
  } else m.info = info;
  markDirty(info.id);
}
function upsertPart(part) {
  let m = state.messages.get(part.messageID);
  if (!m) {
    m = { info: { id: part.messageID, sessionID: part.sessionID, role: "assistant", time: { created: Date.now() } }, parts: new Map() };
    state.messages.set(part.messageID, m);
  }
  m.parts.set(part.id, part);
  markDirty(part.messageID);
}
function applyDelta(p) {
  const m = state.messages.get(p.messageID);
  const part = m?.parts.get(p.partID);
  if (!part) return;
  part[p.field] = (part[p.field] || "") + p.delta;
  markDirty(p.messageID);
}
function saveLabels() {
  const keys = Object.keys(state.labels);
  if (keys.length > 300) keys.slice(0, keys.length - 300).forEach((k) => delete state.labels[k]);
  localStorage.setItem(LS.labels, JSON.stringify(state.labels));
}

// ---------- tool step labels ----------
function toolLabel(part) {
  const s = part.state || {};
  const i = s.input || {};
  switch (part.tool) {
    case "parse_inputs": return "Read your input files";
    case "github_profile": return `Checked GitHub${i.username || i.user ? " " + (i.username || i.user) : ""}`;
    case "job_posting": return "Read the job posting";
    case "ats_check": return `Ran ATS check${i.cvPath || i.path ? " on " + baseName(i.cvPath || i.path) : ""}`;
    case "webfetch": return `Fetched ${host(i.url)}`;
    case "websearch": return `Searched the web: ${trunc(i.query, 50)}`;
    case "read": return `Read ${baseName(i.filePath)}`;
    case "write": return `Wrote ${baseName(i.filePath)}`;
    case "edit": return `Edited ${baseName(i.filePath)}`;
    case "glob":
    case "grep":
    case "list": return "Looked through files";
    case "bash": return `Ran ${trunc(i.command, 60)}`;
    case "task": return `Asked @${i.subagent_type || "subagent"}${i.description ? ": " + trunc(i.description, 50) : ""}`;
    case "skill": return `Loaded skill ${i.name || ""}`;
    case "todowrite":
    case "todoread": return "Updated plan";
    default: return s.title || part.tool;
  }
}
const HIDDEN_TOOLS = new Set(["todowrite", "todoread"]);

// ---------- rendering ----------
function markDirty(id) {
  state.dirty.add(id);
  scheduleRender();
}
function scheduleRender() {
  if (scheduleRender.q) return;
  scheduleRender.q = requestAnimationFrame(() => {
    scheduleRender.q = null;
    render();
  });
}

function sortedMessages() {
  return [...state.messages.values()]
    .filter((m) => m.info.sessionID === state.sessionId)
    .sort((a, b) => (a.info.time?.created || 0) - (b.info.time?.created || 0) || (a.info.id < b.info.id ? -1 : 1));
}

function render() {
  const feed = $("feed");
  const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;

  let msgsEl = $("msgs");
  if (!msgsEl) {
    feed.innerHTML = `<div id="msgs"></div><div id="errs"></div><div id="pending"></div>`;
    msgsEl = $("msgs");
  }
  const list = sortedMessages();
  $("emptyState")?.remove();
  if (!list.length && !state.questions.size && !state.errors.length) {
    if (!feed.querySelector(".empty")) {
      feed.insertAdjacentHTML(
        "afterbegin",
        `<div class="empty" id="emptyState"><h2>Add your inputs and press Start tailoring</h2><p class="muted">OpenCode runs in the background. You only see its messages, short progress steps and its questions.</p></div>`
      );
    }
  }

  // re-render only dirty messages, keep DOM order in sync
  let prev = null;
  for (const m of list) {
    let el = msgsEl.querySelector(`[data-mid="${m.info.id}"]`);
    if (!el || state.dirty.has(m.info.id)) {
      const html = renderMessage(m);
      const fresh = document.createElement("div");
      fresh.dataset.mid = m.info.id;
      fresh.className = "msg";
      fresh.innerHTML = html;
      if (el) el.replaceWith(fresh);
      el = fresh;
    }
    const want = prev ? prev.nextSibling : msgsEl.firstChild;
    if (want !== el) msgsEl.insertBefore(el, want);
    prev = el;
  }
  // drop stale
  [...msgsEl.children].forEach((c) => {
    if (!state.messages.has(c.dataset.mid) || state.messages.get(c.dataset.mid).info.sessionID !== state.sessionId) c.remove();
  });
  state.dirty.clear();

  $("errs").innerHTML = state.errors.map((e) => `<div class="card err-card">${esc(e.text)}</div>`).join("");

  renderStatus();
  updateScores();
  if (nearBottom) feed.scrollTop = feed.scrollHeight;
}

function renderMessage(m) {
  const { info } = m;
  const parts = [...m.parts.values()];
  if (info.role === "user") {
    const texts = parts.filter((p) => p.type === "text" && !p.synthetic && !p.ignored).map((p) => p.text);
    const files = parts.filter((p) => p.type === "file").map((p) => p.filename || "file");
    const full = texts.join("\n").trim();
    const label = state.labels[info.id];
    if (!full && !files.length) return "";
    if (label || full.length > 400) {
      const shown = label || trunc(full.split("\n")[0], 120);
      const det = state.details ? `<details class="steps"><summary>full prompt</summary><pre class="detail-box">${esc(full)}</pre></details>` : "";
      return `<div class="msg-user cmd">${esc(shown)}</div>${det}`;
    }
    return `<div class="msg-user">${esc(full)}${files.map((f) => `<div class="small muted">📎 ${esc(f)}</div>`).join("")}</div>`;
  }

  // assistant
  const out = [];
  let group = [];
  const flush = () => {
    if (group.length) out.push(renderSteps(group[0].id, group));
    group = [];
  };
  for (const p of parts) {
    if (p.type === "text") {
      if (p.synthetic || p.ignored || !p.text?.trim()) continue;
      flush();
      out.push(`<div class="text">${md(p.text)}</div>`);
    } else if (p.type === "reasoning") {
      if (state.details && p.text?.trim()) {
        flush();
        out.push(`<div class="reasoning">${esc(p.text)}</div>`);
      }
    } else if (p.type === "tool") {
      if (p.tool === "question") {
        const qa = renderAnswered(p);
        if (qa) {
          flush();
          out.push(qa);
        }
        continue;
      }
      if (HIDDEN_TOOLS.has(p.tool) && !state.details) continue;
      group.push(p);
    } else if (p.type === "subtask" || p.type === "agent") {
      group.push({ ...p, tool: "task", state: { status: "completed", input: { subagent_type: p.agent || p.name, description: p.description } } });
    } else if (p.type === "compaction") {
      group.push({ id: p.id, tool: "compaction", state: { status: "completed", title: "Compacted context" } });
    }
  }
  flush();
  if (info.error && info.error.name !== "MessageAbortedError") {
    out.push(`<div class="card err-card">${esc(info.error.data?.message || info.error.name)}</div>`);
  } else if (info.error) {
    out.push(`<div class="small muted">Stopped.</div>`);
  }
  return out.length ? `<div class="msg-ai">${out.join("")}</div>` : "";
}

function stepIcon(st) {
  if (st === "completed") return `<span class="st-ok">✓</span>`;
  if (st === "error") return `<span class="st-err">✗</span>`;
  return `<span class="st-run">…</span>`;
}

function renderSteps(key, tools) {
  const running = tools.find((t) => t.state?.status === "running" || t.state?.status === "pending");
  const failed = tools.filter((t) => t.state?.status === "error").length;
  const labels = tools.map(toolLabel);
  let summary;
  if (running) summary = `${stepIcon("running")} ${esc(toolLabel(running))}`;
  else if (tools.length === 1) summary = `${stepIcon(tools[0].state?.status)} ${esc(labels[0])}`;
  else summary = `${stepIcon(failed ? "error" : "completed")} ${tools.length} steps <span class="muted">· ${esc(trunc(labels.slice(-2).join(", "), 80))}</span>`;
  if (failed && !running) summary += ` <span class="st-err">(${failed} failed)</span>`;
  if (tools.length === 1 && !state.details) {
    const err = tools[0].state?.status === "error" ? ` <span class="st-err">${esc(trunc(tools[0].state.error, 160))}</span>` : "";
    return `<div class="steps">${summary}${err}</div>`;
  }

  const items = tools
    .map((t) => {
      const s = t.state || {};
      let extra = "";
      if (s.status === "error") extra = ` <span class="st-err">${esc(trunc(s.error, 160))}</span>`;
      let det = "";
      if (state.details) {
        const inp = JSON.stringify(s.input || {}, null, 2);
        const outp = s.output || s.error || "";
        det = `<pre class="detail-box">${esc(trunc(inp, 3000))}${outp ? "\n\n--- output ---\n" + esc(trunc(outp, 6000)) : ""}</pre>`;
      }
      return `<li>${stepIcon(s.status)} ${esc(toolLabel(t))}${extra}${det}</li>`;
    })
    .join("");
  const open = state.openSteps.has(key) ? " open" : "";
  return `<details class="steps" data-key="${esc(key)}"${open}><summary>${summary}</summary><ul>${items}</ul></details>`;
}

function renderAnswered(p) {
  const s = p.state || {};
  if (s.status !== "completed" && s.status !== "error") return "";
  const qs = s.input?.questions || [];
  const ans = s.metadata?.answers;
  if (s.status === "error") return `<div class="qa-done"><span class="h">Questions skipped</span></div>`;
  return qs
    .map((q, i) => {
      const a = Array.isArray(ans?.[i]) ? ans[i].join(", ") : "";
      return `<div class="qa-done"><div class="h">${esc(q.header || "Question")}: ${esc(trunc(q.question, 140))}</div><div>${esc(a || "(answered)")}</div></div>`;
    })
    .join("");
}

function answeredCount() {
  let n = 0;
  for (const m of state.messages.values()) {
    if (m.info.sessionID !== state.sessionId) continue;
    for (const p of m.parts.values()) {
      if (p.type === "tool" && p.tool === "question" && p.state?.status === "completed") n += (p.state.input?.questions || []).length;
    }
  }
  return n;
}

// pending question / permission cards (separate so typing is not lost on message updates)
function renderPending() {
  const box = $("pending");
  if (!box) {
    render();
    return renderPending();
  }
  const html = [];
  for (const [id, r] of state.perms) {
    const what = [r.permission, ...(r.patterns || [])].filter(Boolean).join(" ");
    html.push(`<div class="card ask" data-perm="${esc(id)}">
      <div class="q-meta"><span>Permission</span></div>
      <div class="q-text">OpenCode wants to run: <code>${esc(trunc(what, 300))}</code></div>
      <div class="actions"><span></span><div class="row gap">
        <button class="btn" data-pr="reject" type="button">Deny</button>
        <button class="btn" data-pr="always" type="button">Always allow</button>
        <button class="btn primary" data-pr="once" type="button">Allow once</button>
      </div></div></div>`);
  }
  const first = [...state.questions.values()][0];
  if (first) {
    const { req, idx } = first;
    const q = req.questions[idx];
    const num = answeredCount() + idx + 1;
    const last = idx === req.questions.length - 1;
    const choices = (q.options || [])
      .map(
        (o, i) =>
          `<button type="button" class="choice${first.sel[idx].has(o.label) ? " sel" : ""}" data-ci="${i}"><div>${esc(o.label)}</div>${
            o.description ? `<div class="d">${esc(o.description)}</div>` : ""
          }</button>`
      )
      .join("");
    html.push(`<div class="card ask" id="qCard">
      <div class="q-meta"><span>Question ${num}${q.header ? " · " + esc(q.header) : ""}${q.multiple ? " · pick any" : ""}</span>
      <span>${req.questions.length > 1 ? `${idx + 1} of ${req.questions.length} in this round` : ""}</span></div>
      <div class="q-text">${esc(q.question)}</div>
      <div class="choices">${choices}</div>
      ${q.custom === false ? "" : `<textarea id="qCustom" rows="2" placeholder="Or type your own answer">${esc(first.custom[idx])}</textarea>`}
      <div class="actions">
        <div>${idx > 0 ? `<button class="btn" id="qBack" type="button">Back</button>` : `<button class="btn ghost" id="qSkip" type="button">Skip</button>`}</div>
        <button class="btn primary" id="qNext" type="button">${last ? "Send answers" : "Next"}</button>
      </div></div>`);
  }
  box.innerHTML = html.join("");
  $("emptyState")?.remove();

  box.querySelectorAll("[data-perm]").forEach((card) => {
    card.querySelectorAll("[data-pr]").forEach((b) => {
      b.onclick = async () => {
        const id = card.dataset.perm;
        try {
          await post(`/api/oc/permission/${encodeURIComponent(id)}/reply`, { reply: b.dataset.pr });
          state.perms.delete(id);
          renderPending();
        } catch (e) {
          addError(e.message);
        }
      };
    });
  });
  if (first) wireQuestion(first);
  renderStatus();
  const feed = $("feed");
  feed.scrollTop = feed.scrollHeight;
}

function wireQuestion(entry) {
  const { req } = entry;
  const q = req.questions[entry.idx];
  $("qCard").querySelectorAll(".choice").forEach((b) => {
    b.onclick = () => {
      const label = q.options[+b.dataset.ci].label;
      const set = entry.sel[entry.idx];
      if (!q.multiple) {
        const had = set.has(label);
        set.clear();
        if (!had) set.add(label);
      } else if (set.has(label)) set.delete(label);
      else set.add(label);
      $("qCard").querySelectorAll(".choice").forEach((c) => c.classList.toggle("sel", set.has(q.options[+c.dataset.ci].label)));
    };
  });
  const ta = $("qCustom");
  if (ta) {
    ta.oninput = () => (entry.custom[entry.idx] = ta.value);
    ta.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        $("qNext").click();
      }
    };
  }
  if ($("qBack"))
    $("qBack").onclick = () => {
      entry.idx--;
      renderPending();
    };
  if ($("qSkip"))
    $("qSkip").onclick = async () => {
      try {
        await post(`/api/oc/question/${encodeURIComponent(req.id)}/reject`);
        state.questions.delete(req.id);
        renderPending();
      } catch (e) {
        addError(e.message);
      }
    };
  $("qNext").onclick = async () => {
    const i = entry.idx;
    if (!entry.sel[i].size && !(entry.custom[i] || "").trim()) {
      toast("Pick an option or type an answer");
      return;
    }
    if (i < req.questions.length - 1) {
      entry.idx++;
      renderPending();
      return;
    }
    const answers = req.questions.map((_, k) => {
      const a = [...entry.sel[k]];
      const c = (entry.custom[k] || "").trim();
      if (c) a.push(c);
      return a;
    });
    $("qNext").disabled = true;
    try {
      await post(`/api/oc/question/${encodeURIComponent(req.id)}/reply`, { answers });
      state.questions.delete(req.id);
      state.activity = "Thinking about your answers";
      renderPending();
    } catch (e) {
      $("qNext").disabled = false;
      addError(e.message);
    }
  };
}

function addQuestion(req) {
  if (state.questions.has(req.id) || !req.questions?.length) return;
  state.questions.set(req.id, { req, idx: 0, sel: req.questions.map(() => new Set()), custom: req.questions.map(() => "") });
  renderPending();
}

function addError(text) {
  state.errors.push({ at: Date.now(), text });
  scheduleRender();
}

function renderStatus() {
  const waiting = state.questions.size || state.perms.size;
  const show = state.busy && !waiting;
  $("statusLine").classList.toggle("hidden", !show);
  $("statusText").textContent = state.activity ? state.activity + "..." : "Working...";
  const dot = $("engineDot");
  if (!dot.classList.contains("offline")) dot.className = "dot " + (state.busy ? "busy" : "online");
  $("tailorBtn").disabled = state.busy;
  $("scoreBtn").disabled = state.busy;
}

// ---------- events ----------
function connectEvents() {
  if (state.sse) state.sse.close();
  const es = new EventSource("/api/oc/events");
  state.sse = es;
  let first = true;
  es.onopen = () => {
    $("engineDot").classList.remove("offline");
    $("engineText").textContent = "";
    if (!first) loadSession(); // catch up on anything missed while disconnected
    first = false;
  };
  es.onmessage = (e) => {
    if (!e.data) return;
    try {
      const raw = JSON.parse(e.data);
      onEvent(raw.payload || raw);
    } catch (_) {}
  };
  es.onerror = () => {
    $("engineDot").className = "dot offline";
    $("engineText").textContent = "reconnecting...";
  };
}

async function onEvent(ev) {
  const t = ev.type;
  const p = ev.properties || {};
  const sid = p.sessionID || p.part?.sessionID || p.info?.sessionID;

  if (t === "session.created" || t === "session.updated") {
    const info = p.info || {};
    if (info.parentID && (await isOurs(info.parentID))) state.ours.set(info.id, true);
    return;
  }
  if ((t === "file.edited" || t === "file.watcher.updated") && /[\\/]outputs[\\/]/.test(p.file || "")) {
    refreshOutputsSoon(p.file);
    return;
  }
  if (!sid || !state.sessionId) return;
  const main = sid === state.sessionId;
  if (!main && !(await isOurs(sid))) return;

  switch (t) {
    case "message.updated":
      if (main) upsertInfo(p.info);
      break;
    case "message.removed":
      if (main) {
        state.messages.delete(p.messageID);
        scheduleRender();
      }
      break;
    case "message.part.updated": {
      const part = p.part;
      if (part.type === "tool" && (part.state?.status === "running" || part.state?.status === "pending")) {
        state.activity = (main ? "" : "Subagent: ") + toolLabel(part);
        renderStatus();
      } else if (part.type === "text" && main) {
        state.activity = "Writing";
      }
      if (part.type === "tool" && part.state?.status === "completed" && ["write", "edit"].includes(part.tool)) refreshOutputsSoon(part.state.input?.filePath);
      if (main) {
        upsertPart(part);
        if (part.type === "text" && part.text) parseScores(part.text);
      }
      break;
    }
    case "message.part.removed":
      if (main) {
        state.messages.get(p.messageID)?.parts.delete(p.partID);
        markDirty(p.messageID);
      }
      break;
    case "message.part.delta":
      if (main) applyDelta(p);
      break;
    case "session.status":
      if (main) {
        const st = p.status || {};
        state.busy = st.type !== "idle";
        if (st.type === "retry") state.activity = `Retrying (attempt ${st.attempt}): ${trunc(st.message, 80)}`;
        renderStatus();
      }
      break;
    case "session.idle":
      if (main) {
        state.busy = false;
        state.activity = "";
        renderStatus();
        refreshOutputs();
      }
      break;
    case "session.error": {
      const err = p.error || {};
      if (err.name !== "MessageAbortedError") addError(err.data?.message || err.message || err.name || "Unknown error");
      if (main) {
        state.busy = false;
        renderStatus();
      }
      break;
    }
    case "question.asked":
      addQuestion(p);
      break;
    case "question.replied":
    case "question.rejected":
      if (state.questions.delete(p.requestID)) renderPending();
      break;
    case "permission.asked":
      state.perms.set(p.id, p);
      renderPending();
      break;
    case "permission.replied":
      if (state.perms.delete(p.requestID)) renderPending();
      break;
  }
}

function parseScores(text) {
  const b = text.match(/(?:baseline|before|initial)[^\n\d]{0,40}?(\d{1,3})\s*\/\s*100/i);
  const a = text.match(/(?:tailored|after|post-tailoring|final)[^\n\d]{0,40}?(\d{1,3})\s*\/\s*100/i);
  if (b) state.sessionScores.before = Math.min(100, +b[1]);
  if (a) state.sessionScores.after = Math.min(100, +a[1]);
}

// ---------- session lifecycle ----------
function resetFeed() {
  state.messages.clear();
  state.ours.clear();
  state.questions.clear();
  state.perms.clear();
  state.errors = [];
  state.dirty.clear();
  state.openSteps.clear();
  state.sessionScores = { before: null, after: null };
  state.busy = false;
  state.activity = "";
  $("feed").innerHTML = "";
  render();
  renderPending();
}

function setSession(id) {
  state.sessionId = id;
  if (id) localStorage.setItem(LS.session, id);
  else localStorage.removeItem(LS.session);
}

async function loadSession() {
  if (!state.sessionId) {
    render();
    return;
  }
  try {
    await api(`/api/oc/session/${encodeURIComponent(state.sessionId)}`);
  } catch (_) {
    setSession(null);
    resetFeed();
    return;
  }
  try {
    const msgs = await api(`/api/oc/session/${encodeURIComponent(state.sessionId)}/messages`);
    for (const { info, parts } of msgs || []) {
      upsertInfo(info);
      for (const part of parts || []) {
        upsertPart(part);
        if (part.type === "text" && info.role === "assistant") parseScores(part.text || "");
      }
    }
    const status = await api("/api/oc/session-status").catch(() => ({}));
    const st = status[state.sessionId];
    state.busy = !!st && st.type !== "idle";
    const qs = await api("/api/oc/questions").catch(() => []);
    for (const q of qs || []) if (await isOurs(q.sessionID)) addQuestion(q);
    const ps = await api("/api/oc/permissions").catch(() => []);
    for (const pr of ps || []) if (await isOurs(pr.sessionID)) state.perms.set(pr.id, pr);
  } catch (e) {
    addError("Could not load session: " + e.message);
  }
  render();
  renderPending();
}

async function ensureSession(title) {
  if (state.sessionId) return state.sessionId;
  const s = await post("/api/oc/session", { title, agent: "career-architect" });
  setSession(s.id);
  return s.id;
}

async function newSession(title) {
  setSession(null);
  resetFeed();
  return ensureSession(title);
}

function modelString() {
  return $("modelSelect").value || "";
}
function modelObj() {
  const v = modelString();
  const i = v.indexOf("/");
  return i > 0 ? { providerID: v.slice(0, i), modelID: v.slice(i + 1) } : undefined;
}

// ---------- start / score / chat ----------
async function saveInputs() {
  if (state.liPaste && $("liText").value.trim()) {
    await post("/api/upload", { category: "linkedin", filename: "linkedin.txt", text: $("liText").value.trim() });
  }
  if (state.jobPaste && $("jobText").value.trim()) {
    await post("/api/upload", { category: "job", filename: "job.txt", text: $("jobText").value.trim() });
  }
  await post("/api/profile", { github: $("githubInput").value.trim(), preferred_typeset_format: $("formatSelect").value });
}

async function runCommand(command) {
  const jobUrl = $("jobUrl").value.trim();
  if (!state.jobPaste && !jobUrl && !state.inputs.some((f) => f.filename.startsWith("job."))) {
    toast("Add a job URL or paste the job description");
    return;
  }
  if (state.jobPaste && !$("jobText").value.trim()) {
    toast("Paste the job description first");
    return;
  }
  try {
    await saveInputs();
    await loadWorkspace();
    const github = $("githubInput").value.trim();
    const fmt = { both: "Markdown + LaTeX + Typst", latex: "Markdown + LaTeX", typst: "Markdown + Typst" }[$("formatSelect").value];
    const job = state.jobPaste || !jobUrl ? "job description is in inputs/job.txt" : jobUrl;
    const args = [job, github ? `GitHub: ${github}` : "", command === "tailor" ? `Output formats: ${fmt}` : ""].filter(Boolean).join(" | ");

    const sid = await newSession(command === "tailor" ? "CV Tailor" : "CV Score");
    state.knownBundles = new Set(state.outputs.map((o) => o.name));
    let shortJob = "(pasted job description)";
    if (!state.jobPaste && jobUrl) {
      try {
        const u = new URL(jobUrl);
        shortJob = u.host + trunc(u.pathname, 40);
      } catch (_) {
        shortJob = trunc(jobUrl, 60);
      }
    }
    state.pendingLabel = `/${command}  ${shortJob}`;
    state.busy = true;
    state.activity = "Starting";
    renderStatus();
    const body = { command, arguments: args, agent: "career-architect" };
    if (modelString()) body.model = modelString();
    await post(`/api/oc/session/${encodeURIComponent(sid)}/command`, body);
  } catch (e) {
    state.busy = false;
    renderStatus();
    addError(e.message);
  }
}

async function sendMessage(text) {
  try {
    const sid = await ensureSession("CV Tailor");
    if (state.activeBundle && !state.messages.size) {
      text = `Working folder: outputs/${state.activeBundle.name}\n\n${text}`;
    }
    state.busy = true;
    state.activity = "Thinking";
    renderStatus();
    const body = { text, agent: "career-architect" };
    const m = modelObj();
    if (m) body.model = m;
    await post(`/api/oc/session/${encodeURIComponent(sid)}/prompt`, body);
  } catch (e) {
    state.busy = false;
    renderStatus();
    addError(e.message);
  }
}

// ---------- inputs ----------
async function loadWorkspace() {
  try {
    const ws = await api("/api/workspace");
    state.inputs = ws.inputs || [];
    if (!$("githubInput").dataset.dirty && ws.profile?.github) $("githubInput").value = ws.profile.github;
    if (!$("formatSelect").dataset.dirty && ws.profile?.preferred_typeset_format) $("formatSelect").value = ws.profile.preferred_typeset_format;
    $("engineText").textContent = ws.engine?.healthy ? "" : "OpenCode offline: " + (ws.engine?.error || "");
    if (!ws.engine?.healthy) $("engineDot").className = "dot offline";
    renderInputs();
    setOutputs(ws.outputs || []);
  } catch (e) {
    $("engineDot").className = "dot offline";
    $("engineText").textContent = "UI server unreachable";
  }
}

function renderInputs() {
  const cv = state.inputs.find((f) => f.filename.startsWith("cv."));
  const li = state.inputs.find((f) => f.filename.startsWith("linkedin."));
  const job = state.inputs.find((f) => f.filename.startsWith("job."));
  const tag = (el, f, opt) => {
    el.textContent = f ? "ok" : opt ? "optional" : "missing";
    el.className = "tag" + (f ? " done" : opt ? " opt" : "");
  };
  tag($("cvTag"), cv);
  tag($("liTag"), li);
  $("cvDrop").classList.toggle("loaded", !!cv);
  $("liDrop").classList.toggle("loaded", !!li);
  $("cvLabel").textContent = cv ? `${cv.filename} · ${cv.word_count} words` : "Drop or choose CV file";
  $("liLabel").textContent = li ? `${li.filename} · ${li.word_count} words` : "Drop LinkedIn PDF export";
  if (job && !$("jobText").value) $("jobText").placeholder = `Saved: ${job.filename} (${job.word_count} words). Paste to replace.`;
}

async function upload(category, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  try {
    const res = await post("/api/upload", { category, filename: file.name, contentBase64: btoa(bin) });
    state.inputs = res.inputs || [];
    renderInputs();
    toast(`Saved ${res.saved_as}`);
  } catch (e) {
    toast("Upload failed: " + e.message);
  }
}

function dropzone(box, input, category) {
  input.onchange = () => input.files[0] && upload(category, input.files[0]);
  box.ondragover = (e) => {
    e.preventDefault();
    box.classList.add("over");
  };
  box.ondragleave = () => box.classList.remove("over");
  box.ondrop = (e) => {
    e.preventDefault();
    box.classList.remove("over");
    if (e.dataTransfer.files[0]) upload(category, e.dataTransfer.files[0]);
  };
}

// ---------- models ----------
async function loadModels() {
  try {
    const data = await api("/api/oc/providers");
    const connected = new Set(data.connected || []);
    const opts = [];
    for (const p of data.all || []) {
      if (!connected.has(p.id)) continue;
      for (const m of Object.values(p.models || {})) opts.push({ v: `${p.id}/${m.id}`, l: `${p.name || p.id} · ${m.name || m.id}` });
    }
    opts.sort((a, b) => a.l.localeCompare(b.l));
    const sel = $("modelSelect");
    sel.innerHTML = `<option value="">Default model</option>` + opts.map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join("");
    const saved = localStorage.getItem(LS.model);
    if (saved && opts.some((o) => o.v === saved)) sel.value = saved;
  } catch (_) {}
}

// ---------- outputs / documents ----------
function setOutputs(outputs) {
  const before = new Map(state.outputs.map((o) => [o.name, o.files.join("|")]));
  state.outputs = outputs;
  if (state.knownBundles === null) state.knownBundles = new Set(outputs.map((o) => o.name));

  const fresh = outputs.find((o) => !state.knownBundles.has(o.name));
  if (fresh) {
    state.knownBundles.add(fresh.name);
    toast(`New files in outputs/${fresh.name}`);
    openBundle(fresh);
  } else if (state.activeBundle) {
    const cur = outputs.find((o) => o.name === state.activeBundle.name);
    if (cur) {
      const changed = before.get(cur.name) !== cur.files.join("|");
      state.activeBundle = cur;
      if (changed) showKind(state.kind, true);
    }
  } else if (outputs.length) {
    openBundle(outputs[0]);
  }
  renderBundles();
  updateScores();
}

function renderBundles() {
  const ul = $("bundleList");
  if (!state.outputs.length) {
    ul.innerHTML = `<li class="muted small">None yet</li>`;
    return;
  }
  ul.innerHTML = state.outputs
    .map((o) => {
      const f = o.fitness;
      const sc = f && (f.baseline != null || f.after != null) ? `${f.baseline ?? "?"} → ${f.after ?? "?"}` : "";
      const act = state.activeBundle?.name === o.name ? " active" : "";
      return `<li><button type="button" class="${act}" data-b="${esc(o.name)}">${esc(o.name)}<span class="sc">${esc(sc)}</span></button></li>`;
    })
    .join("");
  ul.querySelectorAll("button").forEach((b) => (b.onclick = () => openBundle(state.outputs.find((o) => o.name === b.dataset.b))));
}

async function refreshOutputs() {
  try {
    const d = await api("/api/outputs");
    setOutputs(d.outputs || []);
  } catch (_) {}
}
function refreshOutputsSoon(changedPath) {
  clearTimeout(refreshOutputsSoon.t);
  refreshOutputsSoon.t = setTimeout(async () => {
    await refreshOutputs();
    if (changedPath && state.file && state.activeBundle && changedPath.endsWith(`${state.activeBundle.name}/${state.file}`)) showFile(state.file);
  }, 700);
}

function openBundle(b) {
  if (!b) return;
  state.activeBundle = b;
  $("zipBtn").href = `/api/outputs/zip?bundle=${encodeURIComponent(b.name)}`;
  renderBundles();
  updateScores();
  showKind(state.kind);
}

function filesFor(kind) {
  const files = state.activeBundle?.files || [];
  const lc = (f) => f.toLowerCase();
  if (kind === "cv") return files.filter((f) => /cv|resume/.test(lc(f)) && !/cover/.test(lc(f)));
  if (kind === "cover") return files.filter((f) => /cover/.test(lc(f)));
  return files.filter((f) => /fitness|report/.test(lc(f)));
}

async function showKind(kind, keepFile) {
  state.kind = kind;
  document.querySelectorAll("#docTabs button").forEach((b) => b.classList.toggle("active", b.dataset.kind === kind));
  const files = filesFor(kind);
  const sel = $("fileSelect");
  const label = (f) => ({ md: "Markdown", tex: "LaTeX", typ: "Typst", pdf: "PDF" })[f.split(".").pop()] || f;
  sel.innerHTML = files.map((f) => `<option value="${esc(f)}">${esc(label(f))} · ${esc(f)}</option>`).join("");
  sel.classList.toggle("hidden", files.length < 2);
  $("atsResult").classList.add("hidden");
  if (!files.length) {
    state.file = null;
    state.content = "";
    $("docView").innerHTML = `<p class="muted">${state.activeBundle ? "Not generated yet." : "Generated files appear here."}</p>`;
    return;
  }
  const pick = keepFile && files.includes(state.file) ? state.file : files.find((f) => f.endsWith(".md")) || files[0];
  sel.value = pick;
  await showFile(pick);
}

async function showFile(name) {
  if (!state.activeBundle || !name) return;
  if (name.endsWith(".pdf")) {
    state.file = name;
    state.content = "";
    $("docView").innerHTML = `<p class="muted">PDF file. Use Zip to download it.</p>`;
    return;
  }
  try {
    const r = await api(`/api/outputs/file?bundle=${encodeURIComponent(state.activeBundle.name)}&file=${encodeURIComponent(name)}`);
    state.file = name;
    state.content = r.content || "";
    $("docView").innerHTML = name.endsWith(".md") ? md(state.content) : `<pre><code>${esc(state.content)}</code></pre>`;
  } catch (e) {
    $("docView").innerHTML = `<p class="st-err">${esc(e.message)}</p>`;
  }
}

function updateScores() {
  const f = state.activeBundle?.fitness || {};
  const before = f.baseline ?? state.sessionScores.before;
  const after = f.after ?? state.sessionScores.after;
  $("scoreBefore").textContent = before ?? "-";
  $("scoreAfter").textContent = after ?? "-";
}

async function runAts() {
  if (!state.activeBundle || !state.file) return toast("Open a CV file first");
  if (state.kind !== "cv") return toast("ATS check runs on CV files");
  const box = $("atsResult");
  box.classList.remove("hidden");
  box.textContent = "Checking...";
  try {
    const r = await post("/api/ats-lint", { bundle: state.activeBundle.name, filename: state.file });
    const bm = r.bullet_metrics || {};
    const list = (arr, cls) => (arr?.length ? `<ul>${arr.map((x) => `<li class="${cls}">${esc(x)}</li>`).join("")}</ul>` : "");
    box.innerHTML = `<b class="${r.ats_compliant ? "st-ok" : "st-err"}">${r.ats_compliant ? "ATS compliant" : "ATS issues found"}</b>
      <div class="muted">${r.word_count} words · ${bm.quantified_bullets ?? 0}/${bm.total_bullets ?? 0} bullets with numbers · sections: ${esc((r.sections_detected || []).join(", "))}</div>
      ${list(r.errors, "st-err")}${list(r.warnings, "")}`;
  } catch (e) {
    box.innerHTML = `<span class="st-err">${esc(e.message)}</span>`;
  }
}

// ---------- wiring ----------
function init() {
  dropzone($("cvDrop"), $("cvFile"), "cv");
  dropzone($("liDrop"), $("liFile"), "linkedin");

  $("liModeBtn").onclick = () => {
    state.liPaste = !state.liPaste;
    $("liDrop").classList.toggle("hidden", state.liPaste);
    $("liText").classList.toggle("hidden", !state.liPaste);
    $("liModeBtn").textContent = state.liPaste ? "upload file" : "paste text";
  };
  $("jobModeBtn").onclick = () => {
    state.jobPaste = !state.jobPaste;
    $("jobUrl").classList.toggle("hidden", state.jobPaste);
    $("jobText").classList.toggle("hidden", !state.jobPaste);
    $("jobModeBtn").textContent = state.jobPaste ? "use URL" : "paste text";
  };
  $("githubInput").oninput = () => ($("githubInput").dataset.dirty = "1");
  $("formatSelect").onchange = () => ($("formatSelect").dataset.dirty = "1");
  $("modelSelect").onchange = () => localStorage.setItem(LS.model, $("modelSelect").value);

  $("detailsToggle").checked = state.details;
  $("detailsToggle").onchange = () => {
    state.details = $("detailsToggle").checked;
    localStorage.setItem(LS.details, state.details ? "1" : "0");
    state.messages.forEach((_, id) => state.dirty.add(id));
    render();
  };

  // remember which step groups are expanded across re-renders
  $("feed").addEventListener(
    "toggle",
    (e) => {
      const k = e.target.dataset?.key;
      if (!k) return;
      if (e.target.open) state.openSteps.add(k);
      else state.openSteps.delete(k);
    },
    true
  );

  $("tailorBtn").onclick = () => runCommand("tailor");
  $("scoreBtn").onclick = () => runCommand("score");
  $("stopBtn").onclick = async () => {
    if (!state.sessionId) return;
    try {
      await post(`/api/oc/session/${encodeURIComponent(state.sessionId)}/abort`);
    } catch (e) {
      addError(e.message);
    }
  };
  $("newSessionBtn").onclick = () => {
    if (state.busy && !confirm("The agent is still working. Start a new session anyway?")) return;
    setSession(null);
    resetFeed();
  };

  const input = $("composerInput");
  input.oninput = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
  };
  input.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("composer").requestSubmit();
    }
  };
  $("composer").onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    input.style.height = "auto";
    sendMessage(text);
  };

  document.querySelectorAll("#docTabs button").forEach((b) => (b.onclick = () => showKind(b.dataset.kind)));
  $("fileSelect").onchange = (e) => showFile(e.target.value);
  $("copyBtn").onclick = async () => {
    await navigator.clipboard.writeText(state.content || "");
    toast("Copied");
  };
  $("downloadBtn").onclick = () => {
    if (!state.file) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([state.content], { type: "text/plain;charset=utf-8" }));
    a.download = state.file;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $("atsBtn").onclick = runAts;

  loadWorkspace();
  loadModels();
  connectEvents();
  loadSession();
  setInterval(refreshOutputs, 8000);
}

document.addEventListener("DOMContentLoaded", init);
