// Flomfy link cutting: Shift + drag on empty canvas draws a red knife line. Links it
// crosses turn red; let go of the mouse to cut them (one undo step, Ctrl+Z).
// Shift + drag on a node is left alone (it still snaps to grid).
//
// Classic (canvas) node rendering only.
const { app } = window.comfyAPI.app;

const SETTING = "Flomfy.LinkCut.Enabled";
const KNIFE = "#ff3b3b";
const STEP = 4;  // graph units between hit-test samples along the knife

const cut = {
    start: null,   // [x, y] in graph space
    end: null,
    hits: new Set(),  // rendered segments (links or reroutes) the knife crosses
    pointerId: null,
};

function enabled() {
    const store = app.extensionManager?.setting;
    const v = store?.get ? store.get(SETTING) : app.ui?.settings?.getSettingValue?.(SETTING);
    return v ?? true;
}

function canvas() {
    return app.canvas;
}

function toGraph(c, e) {
    const rect = c.canvas.getBoundingClientRect();
    const { scale, offset } = c.ds;
    return [(e.clientX - rect.left) / scale - offset[0], (e.clientY - rect.top) / scale - offset[1]];
}

function onEmptyCanvas(c, x, y) {
    const g = c.graph;
    if (!g) return false;
    if (g.getNodeOnPos?.(x, y, c.visible_nodes)) return false;
    if (g.getGroupOnPos?.(x, y)) {
        // Inside a group is fine, only its title bar is a drag handle.
        const group = g.getGroupOnPos(x, y);
        const title = group.titleHeight ?? window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30;
        if (y - group.pos[1] < title) return false;
    }
    return true;
}

// Segments the knife crosses, sampled along it with the same stroke test LiteGraph
// uses for clicking a link. Paths are in graph space, so test with an identity transform.
function findHits(c) {
    const hits = new Set();
    const ctx = c.ctx;
    if (!ctx || !c.renderedPaths || !cut.start || !cut.end) return hits;
    const [x0, y0] = cut.start;
    const [x1, y1] = cut.end;
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / STEP));
    ctx.save();
    try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.lineWidth = (c.connections_width ?? 3) + 4;
        for (const seg of c.renderedPaths) {
            if (!seg.path) continue;
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                if (ctx.isPointInStroke(seg.path, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) {
                    hits.add(seg);
                    break;
                }
            }
        }
    } finally {
        ctx.restore();
    }
    return hits;
}

// A reroute segment carries every link that passes through it.
function linkIds(seg) {
    if (seg.linkIds instanceof Set || Array.isArray(seg.linkIds)) return [...seg.linkIds];
    return seg.id != null && seg.target_id != null ? [seg.id] : [];
}

function getLink(graph, id) {
    return graph.links?.get ? graph.links.get(id) : graph.links?.[id];
}

function cutLinks(c, segments) {
    const graph = c.graph;
    const ids = new Set();
    for (const seg of segments) for (const id of linkIds(seg)) ids.add(id);
    if (!ids.size) return 0;
    let n = 0;
    c.emitBeforeChange?.();
    try {
        for (const id of ids) {
            const link = getLink(graph, id);
            if (!link) continue;
            const target = graph.getNodeById(link.target_id);
            if (target && target.inputs?.[link.target_slot]?.link === id) {
                target.disconnectInput(link.target_slot);
            } else {
                graph.removeLink(id);
            }
            n++;
        }
    } finally {
        c.emitAfterChange?.();
    }
    c.setDirty(true, true);
    return n;
}

function reset() {
    cut.start = null;
    cut.end = null;
    cut.hits = new Set();
    cut.pointerId = null;
}

function draw(ctx) {
    if (!cut.start || !cut.end) return;
    const c = canvas();
    const scale = c?.ds?.scale || 1;
    ctx.save();
    ctx.strokeStyle = KNIFE;
    ctx.lineCap = "round";
    ctx.lineWidth = (c?.connections_width ?? 3) + 2;
    for (const seg of cut.hits) if (seg.path) ctx.stroke(seg.path);
    ctx.lineWidth = 2 / scale;
    ctx.setLineDash([8 / scale, 5 / scale]);
    ctx.beginPath();
    ctx.moveTo(cut.start[0], cut.start[1]);
    ctx.lineTo(cut.end[0], cut.end[1]);
    ctx.stroke();
    ctx.restore();
}

function onPointerDown(e) {
    const c = canvas();
    if (!c || e.button !== 0 || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target !== c.canvas || !enabled() || c.read_only || window.LiteGraph?.vueNodesMode) return;
    const p = toGraph(c, e);
    if (!onEmptyCanvas(c, p[0], p[1])) return;
    // Ours: keep LiteGraph from starting a pan or a selection box.
    e.preventDefault();
    e.stopImmediatePropagation();
    cut.start = p;
    cut.end = p;
    cut.hits = new Set();
    cut.pointerId = e.pointerId;
    c.canvas.setPointerCapture?.(e.pointerId);
    c.setDirty(true, false);
}

function onPointerMove(e) {
    if (!cut.start || e.pointerId !== cut.pointerId) return;
    const c = canvas();
    cut.end = toGraph(c, e);
    cut.hits = findHits(c);
    e.stopImmediatePropagation();
    c.setDirty(true, false);
}

function onPointerUp(e) {
    if (!cut.start || e.pointerId !== cut.pointerId) return;
    const c = canvas();
    cut.end = toGraph(c, e);
    const hits = findHits(c);
    reset();
    e.preventDefault();
    e.stopImmediatePropagation();
    c.canvas.releasePointerCapture?.(e.pointerId);
    if (hits.size) cutLinks(c, hits);
    else c.setDirty(true, false);
}

function cancel() {
    if (!cut.start) return;
    reset();
    canvas()?.setDirty(true, false);
}

app.registerExtension({
    name: "Flomfy.LinkCut",
    settings: [
        {
            id: SETTING,
            category: ["Flomfy", "Link cutting", "Enabled"],
            name: "Link cutting (Shift + drag on empty canvas)",
            type: "boolean",
            defaultValue: true,
        },
    ],
    setup() {
        const c = canvas();
        if (!c) return;
        const previous = c.onDrawForeground;
        c.onDrawForeground = function (ctx) {
            const r = previous?.apply(this, arguments);
            draw(ctx);
            return r;
        };
        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("pointermove", onPointerMove, true);
        window.addEventListener("pointerup", onPointerUp, true);
        window.addEventListener("pointercancel", cancel, true);
        window.addEventListener("keydown", (e) => { if (e.key === "Escape") cancel(); }, true);
        window.addEventListener("blur", cancel);
        window.__flomfyCut = cut;  // for debugging in the browser console
        console.log("[Flomfy] link cutting ready: Shift + drag on empty canvas");
    },
});
