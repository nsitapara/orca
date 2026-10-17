import { createElement } from 'react'

// details.js STYLE + review.js STYLE, ported from the console. Light tokens sit on .glr; dark tokens
// under `.dark .glr` (Pilot's theme class) replace the console's media query and data-theme selectors.
const DARK =
  '--g-bg:#18171d;--g-head:#232228;--g-line:#3a383f;--g-ink:#ececef;--g-sub:#a4a3a8;--g-link:#63a6e9;--g-add:#1b3527;--g-add-ln:#1f4430;--g-del:#43252a;--g-del-ln:#522b31;--g-plus:#52b87a;--g-minus:#f57f6c;--g-avatar:#3a3159;--g-avatar-fg:#c9bdf7;--g-code:#2e2d33'

export const DETAILS_CSS = `
.glr{--g-bg:#fff;--g-head:#fbfafd;--g-line:#dcdcde;--g-ink:#333238;--g-sub:#737278;--g-link:#1f75cb;--g-add:#ecfdf0;--g-add-ln:#d7f4df;--g-del:#fbe9eb;--g-del-ln:#f6d4d8;--g-plus:#108548;--g-minus:#dd2b0e;--g-avatar:#e1d8f9;--g-avatar-fg:#5943b6;--g-code:#ececef;
  display:grid;gap:12px;color:var(--g-ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;min-width:0}
.dark .glr{${DARK}}
.glr-file{border:1px solid var(--g-line);border-radius:6px;background:var(--g-bg);overflow:hidden;min-width:0}
.glr-file-h{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;padding:8px 12px;background:var(--g-head);border-bottom:1px solid var(--g-line)}
.glr-path{font:600 12.5px ui-monospace,"SF Mono",Menlo,monospace;overflow-wrap:anywhere;min-width:0}
.glr-count{font-size:12px;color:var(--g-sub)}
.glr-scroll{overflow-x:auto;max-width:100%}
.glr-diff{border-collapse:collapse;width:100%;font:12.5px/1.6 ui-monospace,"SF Mono",Menlo,monospace}
.glr-diff td{padding:0 10px;border:0;vertical-align:top}
.glr-diff td.ln{width:1%;min-width:40px;text-align:right;color:var(--g-sub);user-select:none}
.glr-diff td.code{white-space:pre}
.glr-diff tr.add td{background:var(--g-add)} .glr-diff tr.add td.ln{background:var(--g-add-ln)}
.glr-diff tr.del td{background:var(--g-del)} .glr-diff tr.del td.ln{background:var(--g-del-ln)}
.glr-diff tr.anchor td.ln{box-shadow:inset 3px 0 0 var(--g-link)}
.glr-diff tr.gap td{color:var(--g-sub);background:var(--g-head);text-align:center}
.glr-body{display:grid;gap:8px;min-width:0;overflow-wrap:anywhere}
.glr-body p,.glr-body ul{margin:0}
.glr-body ul{padding-left:20px}
.glr-body a,.dt a{color:var(--g-link)}
.glr-body code,.dt code{font:12.5px ui-monospace,"SF Mono",Menlo,monospace;background:var(--g-code);border-radius:4px;padding:1px 4px}
.glr-body pre{margin:0;padding:8px 10px;border-radius:6px;background:var(--g-code);overflow-x:auto;max-width:100%}
.glr-body pre code{background:none;padding:0}
.glr-error{color:var(--g-minus);font-size:13px}
.dt-body{margin-top:8px;min-width:0}
.dt-section{display:grid;gap:8px;min-width:0}
.dt-title{margin:0;font-size:13px;font-weight:600}
.dt-facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 12px;margin:0}
.dt-facts dt{color:var(--g-sub)} .dt-facts dd{margin:0;overflow-wrap:anywhere;min-width:0}
.dt-checks{margin:0;padding-left:20px;font-size:12.5px;color:var(--g-sub)}
.dt-pairs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.dt-shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.dt figure{margin:0;display:grid;gap:4px;min-width:0}
.dt figcaption,.dt-meta{font-size:12px;color:var(--g-sub);margin:0}
.dt-shot img{display:block;max-width:100%;height:auto;border:1px solid var(--g-line);border-radius:6px}
.dt-zoom-btn{display:block;padding:0;border:0;background:none;cursor:zoom-in;text-align:left}
.dt-zoom{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.82);cursor:zoom-out}
.dt-zoom img{max-width:100%;max-height:100%;object-fit:contain}
.dt-missing{margin:0;font-size:13px;font-style:italic;color:var(--g-sub)}
.glr-omitted{padding:8px 12px}
.dt-note{display:grid;gap:4px;padding:8px 0;border-top:1px solid var(--g-line)}
.dt-note:first-of-type{border-top:0}
.dt-error{color:var(--g-minus);font-size:13px;margin:0}
.dt-report-row{display:flex;align-items:center;justify-content:space-between;gap:8px 12px;flex-wrap:wrap;padding:8px 12px;border:1px solid var(--g-line);border-radius:6px;background:var(--g-head);min-width:0}
@media (max-width:600px){.dt-pairs{grid-template-columns:minmax(0,1fr)}}
.glr-mr{display:grid;gap:2px}
.glr-mr a{color:var(--g-link);text-decoration:none;font-size:13px}
.glr-mr a:hover{text-decoration:underline}
.glr-mr p{margin:0;font-size:13px;color:var(--g-sub)}
.glr-thread{border-top:1px solid var(--g-line);padding:10px 12px;display:grid;gap:8px}
.glr-thread.off .glr-note{opacity:.45}
.glr-note{display:grid;grid-template-columns:22px 28px minmax(0,1fr);gap:10px;align-items:start}
.glr-num{font:600 11px/22px ui-monospace,"SF Mono",Menlo,monospace;text-align:center;border-radius:50%;border:1px solid var(--g-line);color:var(--g-sub)}
.glr-avatar{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:600;line-height:1;background:var(--g-avatar);color:var(--g-avatar-fg)}
.glr-meta{margin:0;font-size:13px;color:var(--g-sub)}
.glr-meta b{color:var(--g-ink)}
.glr-ctl{padding-left:70px}
@media (max-width:600px){.glr-note{grid-template-columns:22px minmax(0,1fr)}.glr-avatar{display:none}.glr-ctl{padding-left:32px}}
`

export function DetailsStyle(): React.JSX.Element {
  return createElement('style', { 'data-pilot-details': '' }, DETAILS_CSS)
}
