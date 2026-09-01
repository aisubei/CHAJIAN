// DSH后台搜索控制面板 - 客户端UI
console.log("[dsh-bg-search] client.js loaded!");

window.__ModuleLoader__.load({ id: "dsh-bg-search", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

// Panel state
var panelOpen = false;
var panelListeners = new Set();
function emitPanel() { panelListeners.forEach(function(fn) { fn(); }); }

// API caller - 调用后端HTTP路由
function apiGet(path) {
  return fetch("/bg-search/" + path, {
    signal: AbortSignal.timeout(60000)
  }).then(function(r) { return r.json(); }).then(function(j) {
    if (!j.ok) throw new Error(j.error || "request failed");
    return j.value;
  });
}
function apiPost(path, body) {
  return fetch("/bg-search/" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(60000)
  }).then(function(r) { return r.json(); }).then(function(j) {
    if (!j.ok) throw new Error(j.error || "request failed");
    return j.value;
  });
}

var inject = ["slots"];
function apply(ctx) {
  try {
    var slots = ctx.get("slots");
    if (!slots) return;

    // Sidebar button
    slots.inject("sidebar.footer.action", function() {
      return slots.register({
        name: "sidebar.footer.action",
        id: "bg-search",
        order: 20,
        label: function() { return "🔍 后台搜索"; },
        inject: function() { return {}; }
      }, function() {
        var R = require("react");
        var ref = R.useState(panelOpen);
        var isOpen = ref[0], setIsOpen = ref[1];
        R.useEffect(function() {
          var h = function() { setIsOpen(panelOpen); };
          panelListeners.add(h);
          return function() { panelListeners.delete(h); };
        }, []);
        return R.createElement("button", {
          onClick: function() { panelOpen = !panelOpen; emitPanel(); },
          style: {
            flex: "none", display: "flex", alignItems: "center", gap: 8,
            width: "calc(100% + 8px)", height: 34, margin: "4px -4px 4px",
            padding: "6px 2px 6px 10px", boxSizing: "border-box",
            border: "none", borderRadius: 12, cursor: "pointer",
            overflow: "hidden", fontFamily: "inherit", fontSize: 14,
            textAlign: "left", lineHeight: 22,
            background: isOpen ? "rgba(59,110,246,0.1)" : "transparent",
            color: isOpen ? "var(--dsw-alias-brand-primary, #3b6ef6)" : "var(--dsw-alias-label-primary)"
          }
        }, "🔍 后台搜索");
      });
    });

    // Overlay panel
    slots.inject("shell.overlay", function() {
      return slots.register({
        name: "shell.overlay",
        id: "bg-search",
        order: 20,
        inject: function() { return {}; }
      }, function() {
        var R = require("react");
        var ref1 = R.useState(panelOpen);
        var isOpen = ref1[0], setIsOpen = ref1[1];
        var ref2 = R.useState(null);
        var status = ref2[0], setStatus = ref2[1];
        var ref3 = R.useState(false);
        var loading = ref3[0], setLoading = ref3[1];
        var ref4 = R.useState("");
        var msg = ref4[0], setMsg = ref4[1];

        R.useEffect(function() {
          var h = function() { setIsOpen(panelOpen); };
          panelListeners.add(h);
          return function() { panelListeners.delete(h); };
        }, []);

        R.useEffect(function() {
          if (!isOpen) return;
          setLoading(true);
          apiGet("status").then(function(r) {
            setStatus(r); setLoading(false);
          }).catch(function() { setLoading(false); });
        }, [isOpen]);

        if (!isOpen) return null;

        function doQuick(action) {
          setLoading(true); setMsg("");
          apiPost("quick-config", { action: action }).then(function(r) {
            setMsg(r.message || JSON.stringify(r));
            setLoading(false);
          }).catch(function(e) { setMsg("❌ " + e.message); setLoading(false); });
        }

        var h = R.createElement;
        return h("div", { style: {
          position: "fixed", inset: 0, zIndex: 300, display: "flex",
          flexDirection: "column", background: "var(--dsw-alias-bg-base, #f6f7f9)",
          color: "var(--dsw-alias-label-primary)"
        }},
          // Header
          h("div", { style: {
            display: "flex", alignItems: "center", justifyContent: "space-between",
            height: 52, padding: "0 16px",
            borderBottom: "1px solid var(--dsw-alias-border-l1)",
            background: "var(--dsw-alias-bg-layer-1)", flexShrink: 0
          }},
            h("span", { style: { fontSize: 15, fontWeight: 600 } }, "🔍 后台搜索"),
            h("button", {
              onClick: function() { panelOpen = false; emitPanel(); },
              style: { width: 30, height: 30, border: "none", borderRadius: 8,
                       background: "transparent", cursor: "pointer", fontSize: 16,
                       color: "var(--dsw-alias-label-secondary)" }
            }, "✕")
          ),
          // Body
          h("div", { style: { flex: 1, padding: 18, overflowY: "auto", display: "flex",
                              flexDirection: "column", gap: 14 } },
            // Status card
            h("div", { style: {
              border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 12,
              background: "var(--dsw-alias-bg-layer-1)", padding: 14
            }},
              h("h3", { style: { margin: "0 0 10px", fontSize: 14, fontWeight: 600 } }, "📊 系统状态"),
              loading
                ? h("div", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 13 } }, "加载中…")
                : h("pre", { style: { fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap",
                     wordBreak: "break-all", background: "var(--dsw-alias-bg-layer-2)", padding: 10,
                     borderRadius: 8, maxHeight: 240, overflowY: "auto" } },
                     status ? JSON.stringify(status, null, 2) : "暂无状态")
            ),
            // Quick actions card
            h("div", { style: {
              border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 12,
              background: "var(--dsw-alias-bg-layer-1)", padding: 14
            }},
              h("h3", { style: { margin: "0 0 10px", fontSize: 14, fontWeight: 600 } }, "⚡ 快捷操作"),
              h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 } },
                h("button", {
                  onClick: function() { doQuick("login"); },
                  style: { display: "inline-flex", alignItems: "center", gap: 5,
                           border: "1px solid transparent", borderRadius: 8,
                           padding: "6px 14px", background: "var(--dsw-alias-brand-primary, #3b6ef6)",
                           color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }
                }, "🔑 登录模式"),
                h("button", {
                  onClick: function() { doQuick("normal"); },
                  style: { display: "inline-flex", alignItems: "center", gap: 5,
                           border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 8,
                           padding: "6px 12px", background: "var(--dsw-alias-bg-layer-1)",
                           color: "var(--dsw-alias-label-primary)", cursor: "pointer", fontSize: 13 }
                }, "🚀 正常模式"),
                h("button", {
                  onClick: function() { doQuick("status"); },
                  style: { display: "inline-flex", alignItems: "center", gap: 5,
                           border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 8,
                           padding: "6px 12px", background: "var(--dsw-alias-bg-layer-1)",
                           color: "var(--dsw-alias-label-primary)", cursor: "pointer", fontSize: 13 }
                }, "🔄 刷新状态"),
                h("button", {
                  onClick: function() { doQuick("start"); },
                  style: { display: "inline-flex", alignItems: "center", gap: 5,
                           border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 8,
                           padding: "6px 12px", background: "var(--dsw-alias-bg-layer-1)",
                           color: "var(--dsw-alias-label-primary)", cursor: "pointer", fontSize: 13 }
                }, "🌐 启动Edge")
              ),
              msg ? h("pre", { style: { fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap",
                       wordBreak: "break-all", background: "var(--dsw-alias-bg-layer-2)", padding: 10,
                       borderRadius: 8, maxHeight: 200, overflowY: "auto" } }, msg) : null
            ),
            // Help card
            h("div", { style: {
              border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 12,
              background: "var(--dsw-alias-bg-layer-1)", padding: 14
            }},
              h("h3", { style: { margin: "0 0 10px", fontSize: 14, fontWeight: 600 } }, "💡 使用说明"),
              h("div", { style: { fontSize: 13, color: "var(--dsw-alias-label-secondary)", lineHeight: 1.8 } },
                h("p", null, "1️⃣ 首次使用 → 点击「登录模式」自动弹出Edge窗口"),
                h("p", null, "2️⃣ 在弹出的 Edge 分身中登录 DeepSeek / 豆包"),
                h("p", null, "3️⃣ 登录完成后 → 点击「正常模式」开启静默搜索"),
                h("p", null, "4️⃣ 如果Edge未启动 → 点击「启动Edge」")
              )
            )
          )
        );
      });
    });

    console.log("[dsh-bg-search] UI registered OK");
  } catch(e) {
    console.error("[dsh-bg-search] apply error:", e);
  }
}

exports.apply = apply;
exports.inject = inject;
return module.exports;
} });
