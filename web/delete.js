// Flomfy D-click delete: hold D and click a node to delete it (one undo step, Ctrl+Z).
// While D is held, the node under the mouse gets a red outline.
//
// Classic (canvas) node rendering only.
const { app } = window.comfyAPI.app;

const SETTING = "Flomfy.DClickDelete.Enabled";
const RED = "#ff3b3b";

let dHeld = false;

function enabled() {
    const store = app.extensionManager?.setting;
    const v = store?.get ? store.get(SETTING) : app.ui?.settings?.getSettingValue?.(SETTING);
    return v ?? true;
}

function canvas() {
    return app.canvas;
}

function typing(e) {
    const t = e.target;
    return t instanceof Element && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.localName));
}

function nodeAt(c, x, y) {
    return c.graph?.getNodeOnPos?.(x, y, c.visible_nodes) ?? null;
}

function toGraph(c, e) {
    const rect = c.canvas.getBoundingClientRect();
    const { scale, offset } = c.ds;
    return [(e.clientX - rect.left) / scale - offset[0], (e.clientY - rect.top) / scale - offset[1]];
}

function setHeld(v) {
    if (dHeld === v) return;
    dHeld = v;
    canvas()?.setDirty(true, false);
}

function draw(ctx) {
    if (!dHeld || !enabled()) return;
    const c = canvas();
    const [x, y] = c.graph_mouse ?? [];
    if (x === undefined) return;
    const node = nodeAt(c, x, y);
    if (!node) return;
    const title = node.constructor?.title_mode === window.LiteGraph?.NO_TITLE
        ? 0 : (window.LiteGraph?.NODE_TITLE_HEIGHT ?? 30);
    const [nx, ny] = node.pos;
    const [w, h] = node.flags?.collapsed ? [node._collapsed_width ?? node.size[0], 0] : node.size;
    const scale = c.ds?.scale || 1;
    ctx.save();
    ctx.strokeStyle = RED;
    ctx.lineWidth = 3 / scale;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(nx - 4, ny - title - 4, w + 8, h + title + 8, 10);
    else ctx.rect(nx - 4, ny - title - 4, w + 8, h + title + 8);
    ctx.stroke();
    ctx.restore();
}

function onKeyDown(e) {
    if (e.code !== "KeyD" || e.ctrlKey || e.altKey || e.metaKey || typing(e)) return;
    setHeld(true);
}

function onKeyUp(e) {
    if (e.code === "KeyD") setHeld(false);
}

function onPointerDown(e) {
    if (!dHeld || e.button !== 0 || !enabled()) return;
    const c = canvas();
    if (!c || e.target !== c.canvas || c.read_only || window.LiteGraph?.vueNodesMode) return;
    const [x, y] = toGraph(c, e);
    const node = nodeAt(c, x, y);
    if (!node || node.removable === false) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    c.emitBeforeChange?.();
    try {
        node.graph.remove(node);
    } finally {
        c.emitAfterChange?.();
    }
    c.setDirty(true, true);
}

app.registerExtension({
    name: "Flomfy.DClickDelete",
    settings: [
        {
            id: SETTING,
            category: ["Flomfy", "D-click delete", "Enabled"],
            name: "Delete a node by holding D and clicking it",
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
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("blur", () => setHeld(false));
        console.log("[Flomfy] D-click delete ready: hold D and click a node");
    },
});
