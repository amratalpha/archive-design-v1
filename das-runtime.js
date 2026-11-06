/* DAS prototype runtime — renders the design boards offline (holes, sc-for, sc-if, dc-import, events, state). */
(function () {
  'use strict';
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
  var RAW = { style: 1, script: 1, textarea: 0 };
  var BOOL = { checked: 1, disabled: 1, readonly: 1, selected: 1, hidden: 1, required: 1, multiple: 1, autofocus: 1, open: 1 };

  /* ---------- parser ---------- */
  function parse(src) {
    var i = 0, n = src.length, root = { tag: '#root', attrs: [], children: [] }, stack = [root];
    function top() { return stack[stack.length - 1]; }
    while (i < n) {
      if (src.startsWith('<!--', i)) { var e = src.indexOf('-->', i); i = e < 0 ? n : e + 3; continue; }
      if (src[i] === '<' && src[i + 1] === '/') {
        var c = src.indexOf('>', i); var name = src.slice(i + 2, c).trim().toLowerCase(); i = c + 1;
        for (var k = stack.length - 1; k > 0; k--) { if (stack[k].tag === name) { stack.length = k; break; } }
        continue;
      }
      if (src[i] === '<' && /[A-Za-z!]/.test(src[i + 1] || '')) {
        if (src[i + 1] === '!') { var d = src.indexOf('>', i); i = d + 1; continue; }
        var j = i + 1; while (j < n && /[A-Za-z0-9\-]/.test(src[j])) j++;
        var tag = src.slice(i + 1, j).toLowerCase(), attrs = [], selfClose = false;
        while (j < n) {
          while (/\s/.test(src[j])) j++;
          if (src[j] === '>') { j++; break; }
          if (src[j] === '/' && src[j + 1] === '>') { selfClose = true; j += 2; break; }
          var s = j; while (j < n && !/[\s=>]/.test(src[j]) && !(src[j] === '/' && src[j + 1] === '>')) j++;
          var an = src.slice(s, j), av = null;
          while (/\s/.test(src[j])) j++;
          if (src[j] === '=') {
            j++; while (/\s/.test(src[j])) j++;
            var q = src[j];
            if (q === '"' || q === "'") { var e2 = src.indexOf(q, j + 1); av = src.slice(j + 1, e2); j = e2 + 1; }
            else { var s2 = j; while (j < n && !/[\s>]/.test(src[j])) j++; av = src.slice(s2, j); }
          }
          if (an) attrs.push([an, av === null ? '' : decode(av)]);
        }
        var node = { tag: tag, attrs: attrs, children: [] };
        top().children.push(node);
        i = j;
        if (RAW[tag]) {
          var close = src.toLowerCase().indexOf('</' + tag, i);
          node.children.push({ text: src.slice(i, close), raw: true });
          i = src.indexOf('>', close) + 1;
        } else if (!VOID[tag] && !selfClose) stack.push(node);
        continue;
      }
      var t = src.indexOf('<', i); if (t < 0) t = n;
      top().children.push({ text: src.slice(i, t) });
      i = t;
    }
    return root;
  }
  function decode(s) { return s.indexOf('&') < 0 ? s : s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

  /* ---------- evaluation ---------- */
  function lookup(expr, scope) {
    expr = expr.trim();
    if (expr === 'true') return true; if (expr === 'false') return false; if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    if (/^(['"]).*\1$/.test(expr)) return expr.slice(1, -1);
    var parts = expr.split('.'), head = parts[0], v;
    for (var k = scope.length - 1; k >= 0; k--) { if (scope[k] && Object.prototype.hasOwnProperty.call(scope[k], head)) { v = scope[k][head]; break; } }
    for (var p = 1; p < parts.length; p++) { if (v == null) return undefined; v = v[parts[p]]; }
    return v;
  }
  var WHOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;
  function evalAttr(v, scope) {
    if (v.indexOf('{{') < 0) return v;
    var m = v.match(WHOLE); if (m) return lookup(m[1], scope);
    return v.replace(/\{\{\s*([^}]+?)\s*\}\}/g, function (_, e) { var r = lookup(e, scope); return r == null ? '' : String(r); });
  }
  function interp(text, scope) {
    if (text.indexOf('{{') < 0) return esc(decodeText(text));
    return text.replace(/\{\{\s*([^}]+?)\s*\}\}|([^{]+|\{)/g, function (all, e, plain) {
      if (e !== undefined) { var r = lookup(e, scope); return r == null ? '' : esc(r); }
      return esc(decodeText(plain));
    });
  }
  function decodeText(s) { return s.indexOf('&') < 0 ? s : s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
  function camel(s) { return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

  /* ---------- components ---------- */
  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (u, cb) {
    var patch = typeof u === 'function' ? u(this.state, this.props) : u;
    this.state = Object.assign({}, this.state, patch || {});
    schedule(); if (cb) setTimeout(cb, 0);
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };
  DCLogic.prototype.renderVals = function () { return {}; };

  var DEFS = {}, compiled = {}, instances = {}, handlers = [], mounted = [], headDone = {};
  function def(name) {
    if (compiled[name]) return compiled[name];
    var d = DEFS[name]; if (!d) throw new Error('Unknown component ' + name);
    var cls = new Function('DCLogic', d.logic + '\n;return Component;')(DCLogic);
    var tree = parse(d.template);
    compiled[name] = { cls: cls, tree: tree, defaults: d.props || {} };
    return compiled[name];
  }
  function helmet(name, tree) {
    if (headDone[name]) return; headDone[name] = true;
    (function walk(nodes) {
      nodes.forEach(function (nd) {
        if (nd.tag === 'helmet') {
          nd.children.forEach(function (h) {
            if (h.tag === 'link') {
              var el = document.createElement('link'); h.attrs.forEach(function (a) { el.setAttribute(a[0], a[1]); });
              if (!document.querySelector('link[href="' + el.getAttribute('href') + '"]')) document.head.appendChild(el);
            } else if (h.tag === 'style') {
              var st = document.createElement('style'); st.textContent = h.children.map(function (c) { return c.text || ''; }).join(''); document.head.appendChild(st);
            }
          });
        } else if (nd.children) walk(nd.children);
      });
    })(tree.children);
  }
  function instance(key, name, props) {
    var c = def(name), inst = instances[key];
    if (!inst || inst.__name !== name) {
      inst = new c.cls(props); if (!inst.state) inst.state = {};
      inst.__name = name; inst.__mounted = false; instances[key] = inst; mounted.push(inst);
    }
    inst.props = props;
    return inst;
  }
  function renderComponent(key, name, props) {
    var c = def(name); helmet(name, c.tree);
    var inst = instance(key, name, props);
    var vals = inst.renderVals() || {};
    var ctx = { key: key, n: 0 };
    return renderNodes(c.tree.children, [vals], ctx);
  }

  var EVENTS = { onclick: 'click', onchange: 'change', oninput: 'input', onsubmit: 'submit', onkeydown: 'keydown', onblur: 'blur', onfocus: 'focus' };
  function renderNodes(nodes, scope, ctx) {
    var out = '';
    for (var i = 0; i < nodes.length; i++) out += renderNode(nodes[i], scope, ctx);
    return out;
  }
  function attr(nd, name) { for (var i = 0; i < nd.attrs.length; i++) if (nd.attrs[i][0] === name) return nd.attrs[i][1]; return null; }
  function renderNode(nd, scope, ctx) {
    if (nd.text !== undefined) return nd.raw ? nd.text : interp(nd.text, scope);
    var tag = nd.tag;
    if (tag === 'helmet') return '';
    if (tag === 'sc-for') {
      var list = evalAttr(attr(nd, 'list') || '', scope) || [], as = attr(nd, 'as') || 'item', out = '';
      for (var i = 0; i < list.length; i++) { var fr = {}; fr[as] = list[i]; fr.$index = i; out += renderNodes(nd.children, scope.concat([fr]), ctx); }
      return out;
    }
    if (tag === 'sc-if') { return evalAttr(attr(nd, 'value') || '', scope) ? renderNodes(nd.children, scope, ctx) : ''; }
    if (tag === 'dc-import') {
      var name = attr(nd, 'name'), props = {};
      nd.attrs.forEach(function (a) { if (a[0] !== 'name' && a[0].indexOf('hint-') !== 0) props[camel(a[0])] = evalAttr(a[1], scope); });
      var key = ctx.key + '/' + name + ':' + (ctx.n++);
      return '<div style="display: contents">' + renderComponent(key, name, props) + '</div>';
    }
    var s = '<' + tag, field = tag === 'input' || tag === 'textarea' || tag === 'select';
    for (var k = 0; k < nd.attrs.length; k++) {
      var an = nd.attrs[k][0], av = nd.attrs[k][1], low = an.toLowerCase();
      if (low.indexOf('hint-') === 0) continue;
      var v = evalAttr(av, scope);
      if (EVENTS[low]) {
        if (typeof v === 'function') {
          var ev = EVENTS[low];
          if (low === 'onchange' && field) { var ty = (attr(nd, 'type') || '').toLowerCase(); ev = (tag === 'select' || ty === 'checkbox' || ty === 'radio') ? 'change' : 'input'; }
          handlers.push(v); s += ' data-dc-' + ev + '="' + (handlers.length - 1) + '"';
        }
        continue;
      }
      if (low === 'classname') an = 'class';
      if (low === 'htmlfor') an = 'for';
      if (BOOL[low]) { if (v === false || v === null || v === undefined || v === 'false') continue; s += ' ' + an; continue; }
      if (v === null || v === undefined || v === false) continue;
      if (typeof v === 'function') continue;
      if (low === 'href' && typeof v === 'string') v = v.replace(/\.dc\.html(?=$|[?#])/, '.html');
      s += ' ' + an + '="' + escAttr(v) + '"';
    }
    s += '>';
    if (VOID[tag]) return s;
    return s + renderNodes(nd.children, scope, ctx) + '</' + tag + '>';
  }

  /* ---------- page loop ---------- */
  var rootEl, pageName, pageProps, pending = false;
  function schedule() { if (pending) return; pending = true; Promise.resolve().then(render); }
  function render() {
    pending = false; handlers = [];
    var act = document.activeElement, focusId = act && act.id, selS = null, selE = null;
    try { if (focusId && act.selectionStart != null) { selS = act.selectionStart; selE = act.selectionEnd; } } catch (e) {}
    var y = window.scrollY;
    rootEl.innerHTML = renderComponent('root', pageName, pageProps);
    if (focusId) { var f = document.getElementById(focusId); if (f) { f.focus(); try { if (selS != null) f.setSelectionRange(selS, selE); } catch (e) {} } }
    window.scrollTo(0, y);
    var todo = mounted; mounted = [];
    todo.forEach(function (inst) { if (!inst.__mounted) { inst.__mounted = true; if (inst.componentDidMount) inst.componentDidMount(); } });
  }
  function bind(ev) {
    rootEl.addEventListener(ev, function (e) {
      var t = e.target.closest ? e.target.closest('[data-dc-' + ev + ']') : null;
      if (!t || !rootEl.contains(t)) { if (ev === 'submit') e.preventDefault(); return; }
      var h = handlers[+t.getAttribute('data-dc-' + ev)];
      if (ev === 'submit') e.preventDefault();
      if (ev === 'click' && t.tagName === 'A' && (!t.getAttribute('href') || t.getAttribute('href') === '#')) e.preventDefault();
      if (h) h(e);
    }, ev === 'focus' || ev === 'blur');
  }
  window.DCRun = function (defs, page) {
    DEFS = defs; pageName = page.name; DEFS[page.name] = page;
    var c = def(page.name), props = {};
    Object.keys(c.defaults).forEach(function (k) { if (k[0] !== '$' && c.defaults[k] && 'default' in c.defaults[k]) props[k] = c.defaults[k]['default']; });
    pageProps = props;
    rootEl = document.getElementById('dc-root');
    ['click', 'input', 'change', 'submit', 'keydown', 'focus', 'blur'].forEach(bind);
    rootEl.addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a[href="#"]'); if (a) e.preventDefault(); });
    render();
  };
})();
