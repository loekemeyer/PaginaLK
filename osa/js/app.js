/* ============================================================
   StockRotativo · Interfaz y navegación (5 módulos)
   1 Stocks · 2 Movimientos · 3 Punto de pedido · 4 Entregas Loeke · 5 Ventas OSA
   ============================================================ */
(function () {
  'use strict';

  var S = window.Store;
  var APP_VERSION = window.APP_VERSION || '2.0.7'; // unificada con el sitio (version.js)
  // ----- Integración Loekemeyer -----
  // El pedido de OSA se envía como un pedido normal del sitio (submit_order_fast
  // + sheets-proxy + sheets-entregas-proxy) reusando la sesión del cliente OSA
  // que ya está logueado en la página principal (misma origin → misma sesión).
  var SUPABASE_URL = 'https://kwkclwhmoygunqmlegrg.supabase.co';
  // anon key (mismo que el sitio): permite reusar la sesión guardada y respeta RLS.
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3a2Nsd2htb3lndW5xbWxlZ3JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MjA2NzUsImV4cCI6MjA4NTA5NjY3NX0.soqPY5hfA3RkAJ9jmIms8UtEGUc4WpZztpEbmDijOgU';
  // Cliente supabase-js compartido con store.js (un solo cliente / una sola sesión).
  var sb = window.__osaSb ||
    ((window.supabase && window.supabase.createClient)
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      : null);
  var SHEETS_PROXY_URL = 'https://kwkclwhmoygunqmlegrg.functions.supabase.co/sheets-proxy';
  var SHEETS_ENTREGAS_PROXY_URL = 'https://kwkclwhmoygunqmlegrg.functions.supabase.co/sheets-entregas-proxy';
  var LK_CLIENTE = 2533;   // código de OSA en el sistema de Loekemeyer
  var LK_VEND = 7;         // vendedor
  // Forma de pago del pedido OSA: Contado -25% (decisión de Loekemeyer).
  var OSA_PAGO_TEXT = 'Pago Contado: 25% Dto';
  var OSA_PAGO_CODE = 8;
  var OSA_PAGO_DISCOUNT = 0.25;
  var LK_SUCURSALES = [
    { val: 'Zuviria 5352- Villa Lugano', lbl: 'Villa Lugano' }, // default
    { val: 'Puente del Inca 2450 - Ezeiza', lbl: 'Ezeiza' },
    { val: 'Retira', lbl: 'Retira' }
  ];

  /* ---------- Estado de UI ---------- */
  var ui = {
    view: 'stocks',
    busqueda: '',   // buscador de Stocks
    filtro: 'todos', // todos | reponer | ok
    qPunto: '',     // buscador de Punto de pedido
    expanded: {},   // artículos expandidos en Movimientos
    movDesde: '',   // filtro de período (detalle de Movimientos)
    movHasta: ''
  };
  var pendingExpand = null; // artículo a expandir al entrar a Movimientos

  var VIEWS = {
    stocks:      { title: 'Stocks', sub: 'Stock de hoy y pedido sugerido por artículo' },
    movimientos: { title: 'Movimientos', sub: 'Inicial + entregas − ventas = stock hoy. Tocá un artículo para ver el detalle.' },
    puntopedido: { title: 'Máximos por Código', sub: 'Máximo objetivo (en cajas) por artículo · pedido sugerido = máximo − stock actual' },
    entregas:    { title: 'Entregas Loeke', sub: 'Mercadería que Loeke entrega a OSA (entra al stock)' },
    ventas:      { title: 'Ventas OSA', sub: 'Ventas de OSA a sus clientes (salen del stock)' },
    cargas:      { title: 'Control de cargas', sub: 'Ventas de OSA por quincena: cargadas y pendientes' },
    config:      { title: 'Configuración', sub: 'Datos, respaldo y preferencias' }
  };

  /* ---------- Atajos DOM ---------- */
  var $ = function (s, ctx) { return (ctx || document).querySelector(s); };
  var $$ = function (s, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(s)); };
  var viewEl = $('#view');
  var app = $('#app');

  /* ---------- Formato ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // Números "planos", sin separadores ni decimales (redondeado).
  function fmtInt(n) { return String(Math.round(n || 0)); }

  /* ---------- Vista en cajas / unidades (solo display) ----------
     El stock se guarda en cajas; estos helpers lo muestran en la unidad activa. */
  function unidadVista() { return S.getUnidadVista(); }
  function unidadLbl() { return unidadVista() === 'unidades' ? 'unidades' : 'cajas'; }   // plural largo
  function unidadCorta() { return unidadVista() === 'unidades' ? 'u' : 'cajas'; }
  function qN(cajas, art) { return S.enVista(cajas, art); }            // número en la unidad activa
  function qf(cajas, art) { return fmtInt(S.enVista(cajas, art)); }    // texto en la unidad activa
  // Inverso de enVista: pasa un número escrito en la unidad activa a UNIDADES (canónico).
  function aUni(v, art) { return unidadVista() === 'cajas' ? Math.round((v || 0) * S.uxcDe(art)) : Math.round(v || 0); }
  // Suma una lista de {cajas, art} en la unidad activa (los totales no se pueden
  // multiplicar por una constante porque la uxc varía por artículo).
  function qSum(items) { return items.reduce(function (acc, it) { return acc + S.enVista(it.cajas, it.art); }, 0); }
  // Objeto/etiqueta de una quincena a partir de su clave 'AAAA-MM-Q1'/'Q2'.
  function qObj(key) { return key ? S.quincenaDe(key.slice(0, 8) + (key.slice(-1) === '1' ? '01' : '16')) : null; }
  function qLabel(key) { var q = qObj(key); return q ? q.label : (key || '—'); }
  function fmtMoney(n) {
    var m = S.getMeta().moneda || 'ARS';
    try { return new Intl.NumberFormat('es-AR', { style: 'currency', currency: m, maximumFractionDigits: 0 }).format(n || 0); }
    catch (e) { return '$' + fmtInt(n); }
  }
  function fmtFecha(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    if (p.length !== 3) return iso;
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  // La foto se escapa: puede venir de un respaldo importado y se interpola en src="...".
  // Imágenes reales de PaginaLK: storage público de Supabase por código (las mismas
  // fotos que el catálogo mayorista). Si no existe la del código, el <img> cae al
  // placeholder vía onerror (ver imgTag). Las fotos están pre-renderizadas 400x400 webp.
  var BASE_IMG = SUPABASE_URL + '/storage/v1/object/public/products-images/';
  var IMG_PARAMS = ''; // sin transform (igual que PaginaLK)
  function imgURL(cod) {
    return BASE_IMG + encodeURIComponent(String(cod || '').trim()) + '.webp' + IMG_PARAMS;
  }
  // URL a mostrar: una foto propia subida en la app (data-uri que NO es el placeholder
  // SVG del seed) tiene prioridad; si no, la foto real por código.
  function fotoDe(a) {
    var f = (a && a.foto) || '';
    if (f && f.indexOf('data:image/svg+xml') !== 0) return esc(f);
    if (a && a.codigo) return esc(imgURL(a.codigo));
    return esc(S.placeholder(a ? a.nombre : ''));
  }
  // <img> con cadena de fallback: código.webp → código alterno (toggle "E") → placeholder.
  function imgTag(a, attrs) {
    var ph = S.placeholder(a ? a.nombre : '');
    var f = (a && a.foto) || '';
    var extra = attrs ? ' ' + attrs : '';
    if (f && f.indexOf('data:image/svg+xml') !== 0) {
      return '<img src="' + esc(f) + '" alt="" loading="lazy" data-ph="' + esc(ph) +
        '" onerror="this.onerror=null;this.src=this.dataset.ph;"' + extra + '>';
    }
    var cod = String((a && a.codigo) || '').trim();
    if (!cod) return '<img src="' + esc(ph) + '" alt=""' + extra + '>';
    var altCod = /E$/i.test(cod) ? cod.replace(/E$/i, '') : cod + 'E';
    return '<img src="' + esc(imgURL(cod)) + '" alt="" loading="lazy" ' +
      'data-alt="' + esc(imgURL(altCod)) + '" data-ph="' + esc(ph) + '" ' +
      'onerror="if(this.dataset.alt){this.src=this.dataset.alt;this.removeAttribute(\'data-alt\');}else{this.onerror=null;this.src=this.dataset.ph;}"' +
      extra + '>';
  }

  /* ---------- Toast ---------- */
  var ICON = {
    ok: '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
    danger: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
    info: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>'
  };
  function toast(msg, type) {
    type = type || 'info';
    var box = $('#toasts');
    var t = document.createElement('div');
    t.className = 'toast toast--' + type;
    t.innerHTML = (ICON[type] || ICON.info) + '<span>' + esc(msg) + '</span>';
    box.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s, transform .3s';
      t.style.opacity = '0'; t.style.transform = 'translateX(24px)';
      setTimeout(function () { t.remove(); }, 320);
    }, 2800);
  }

  /* ---------- Modal ---------- */
  function openModal(title, bodyHTML) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHTML;
    $('#modal').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    $('#modal').hidden = true;
    $('#modalBody').innerHTML = '';
    document.body.style.overflow = '';
  }
  $('#modal').addEventListener('click', function (e) {
    if (e.target.hasAttribute('data-close')) closeModal();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  /* ---------- Navegación ---------- */
  function setView(v) {
    if (!VIEWS[v]) v = 'stocks';
    ui.view = v;
    $$('.nav__item').forEach(function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-view') === v);
    });
    $('#viewTitle').textContent = VIEWS[v].title;
    $('#viewSubtitle').textContent = VIEWS[v].sub;
    app.classList.remove('menu-open');
    render();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', function () {
    var v = (location.hash || '').replace('#/', '');
    if (v && v !== ui.view) setView(v);
  });
  $('#menuBtn').addEventListener('click', function () { app.classList.toggle('menu-open'); });
  $('#scrim').addEventListener('click', function () { app.classList.remove('menu-open'); });

  function updateBadge() {
    var n = S.pedidoSugerido().length;
    var b = $('#navBadge');
    b.textContent = n;
    b.hidden = n === 0;
  }
  function updateBrand() { $('#brandEmpresa').textContent = S.getMeta().empresa || 'Mi Empresa'; }
  // Mide el alto real del topbar y lo expone como --topbar-h (para fijar el header de tabla justo debajo).
  function medirTopbar() {
    var tb = document.querySelector('.topbar');
    if (tb) document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight + 'px');
  }

  /* ---------- Render principal ---------- */
  function render() {
    updateBadge();
    updateBrand();
    var actions = '';
    if (ui.view === 'stocks') actions = btn('nuevo-art', 'primary', iconPlus(), 'Nuevo artículo') + btn('enviar-loeke', 'ghost', iconSend(), 'Enviar a Loekemeyer') + btn('print-sugerido', 'ghost', iconPrint(), 'Imprimir sugerido');
    else if (ui.view === 'movimientos') actions = btn('nuevo-ajuste', 'ghost', iconPlus(), 'Ajuste manual');
    else if (ui.view === 'puntopedido') actions = btn('guardar-punto', 'primary', iconSave(), 'Guardar');
    else if (ui.view === 'entregas') actions = btn('importar-entregas', 'primary', iconUpload(), 'Importar Excel');
    else if (ui.view === 'ventas') actions = btn('importar-ventas', 'primary', iconUpload(), 'Importar informe');
    else if (ui.view === 'cargas') actions = btn('importar-ventas', 'primary', iconUpload(), 'Importar informe');
    $('#topbarActions').innerHTML = actions;
    renderUnitToggle();
    medirTopbar();

    var fn = ({
      stocks: renderStocks, movimientos: renderMovimientos, puntopedido: renderPunto,
      entregas: renderEntregas, ventas: renderVentas, cargas: renderControl, config: renderConfig
    })[ui.view];
    viewEl.innerHTML = fn ? fn() : '';
    if (afterRender[ui.view]) afterRender[ui.view]();
  }
  var afterRender = {};

  // Toggle Cajas/Unidades (estilo iOS). On = unidades (verde).
  function renderUnitToggle() {
    var on = unidadVista() === 'unidades';
    $('#unitToggle').innerHTML =
      '<button class="uswitch' + (on ? ' is-on' : '') + '" role="switch" aria-checked="' + on + '" ' +
      'data-action="toggle-unit" title="Mostrar cantidades en cajas o en unidades">' +
      '<span class="uswitch__lbl uswitch__lbl--off">Cajas</span>' +
      '<span class="uswitch__track"><span class="uswitch__knob"></span></span>' +
      '<span class="uswitch__lbl uswitch__lbl--on">Unidades</span></button>';
  }

  function btn(action, variant, icon, label, extra) {
    return '<button class="btn btn--' + variant + '" data-action="' + action + '" ' + (extra || '') + '>' +
      icon + '<span class="lbl">' + esc(label) + '</span></button>';
  }
  function iconPlus() { return '<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>'; }
  function iconSave() { return '<svg viewBox="0 0 24 24"><path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z"/></svg>'; }
  function iconPrint() { return '<svg viewBox="0 0 24 24"><path d="M19 8H5a3 3 0 0 0-3 3v6h4v4h12v-4h4v-6a3 3 0 0 0-3-3zm-3 11H8v-5h8v5zm3-7a1 1 0 1 1 0-2 1 1 0 0 1 0 2zM18 3H6v4h12V3z"/></svg>'; }
  function iconBox() { return '<svg viewBox="0 0 24 24"><path d="M12 2 3 7v10l9 5 9-5V7l-9-5zm0 2.3L18.5 8 12 11.7 5.5 8 12 4.3z"/></svg>'; }
  function iconLayers() { return '<svg viewBox="0 0 24 24"><path d="M12 2 2 7l10 5 10-5-10-5zm0 9L4.2 7 12 4.3 19.8 7 12 11zM2 12l10 5 10-5 2 1-12 6L0 13l2-1z"/></svg>'; }
  function iconBell() { return '<svg viewBox="0 0 24 24"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm6-6V11a6 6 0 0 0-5-5.9V4a1 1 0 1 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>'; }
  function iconCart() { return '<svg viewBox="0 0 24 24"><path d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6.2 4l.9 2H20a1 1 0 0 1 1 1.3l-2.4 8.3A2 2 0 0 1 16.6 17H8.5a2 2 0 0 1-1.9-1.5L4.3 6.5 3.6 4z"/></svg>'; }
  function iconUpload() { return '<svg viewBox="0 0 24 24"><path d="M12 4l5 5-1.4 1.4L13 7.8V16h-2V7.8L8.4 10.4 7 9l5-5zM5 18h14v2H5z"/></svg>'; }
  function iconCalendar() { return '<svg viewBox="0 0 24 24"><path d="M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm12 7v10H5V9h14zM7 11v2h2v-2H7zm4 0v2h2v-2h-2zm4 0v2h2v-2h-2z"/></svg>'; }
  function iconCheck() { return '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>'; }
  function iconSend() { return '<svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2v5z"/></svg>'; }

  function badgeEstado(e) {
    if (e === 'sin') return '<span class="badge badge--danger"><span class="dot"></span>Sin stock</span>';
    if (e === 'bajo') return '<span class="badge badge--warn"><span class="dot"></span>Para reponer</span>';
    return '<span class="badge badge--ok"><span class="dot"></span>En nivel</span>';
  }

  function emptyApp() {
    return '<div class="card"><div class="card__body"><div class="empty">' +
      '<div class="empty__ic">' + iconBox() + '</div>' +
      '<h3>No hay artículos cargados</h3>' +
      '<p>Creá tu primer artículo o cargá el catálogo de ejemplo (Loekemeyer · OSA) para empezar.</p>' +
      '<div class="row" style="justify-content:center;">' +
      btn('nuevo-art', 'primary', iconPlus(), 'Crear artículo') +
      btn('demo', 'ghost', '', 'Cargar catálogo de ejemplo') +
      '</div></div></div></div>';
  }

  function stat(tone, icon, label, value, hint) {
    return '<div class="stat tone-' + tone + '"><div class="stat__ic">' + icon + '</div>' +
      '<div class="stat__label">' + esc(label) + '</div>' +
      '<div class="stat__value">' + value + '</div>' +
      '<div class="stat__hint">' + esc(hint) + '</div></div>';
  }

  /* ============================================================
     MÓDULO 1 · STOCKS
     ============================================================ */
  function renderStocks() {
    var arts = S.getArticulos({ soloActivos: true });
    if (!arts.length) return emptyApp();
    var stocks = S.computeStocks();

    var totalStock = 0, valor = 0, sug = S.pedidoSugerido();
    arts.forEach(function (a) {
      var s = Math.max(0, stocks[a.id]);
      totalStock += qN(s, a); valor += s * (a.precio || 0);
    });
    var totalPedir = qSum(sug.map(function (x) { return { cajas: x.sugerido, art: x.articulo }; }));
    var uCap = unidadVista() === 'unidades' ? 'Unidades' : 'Cajas';
    var sucActual = S.getMeta().sucursalLK || LK_SUCURSALES[0].val;

    var html = '<div class="sucbar"><span class="sucbar__lbl">Sucursal de entrega</span><div class="sucbar__btns">' +
      LK_SUCURSALES.map(function (s) {
        return '<button type="button" class="sucbtn' + (sucActual === s.val ? ' is-active' : '') +
          '" data-action="set-sucursal" data-suc="' + esc(s.val) + '">' + esc(s.lbl) + '</button>';
      }).join('') + '</div></div>';
    html += '<div class="stats">';
    html += stat('primary', iconBox(), 'Artículos', fmtInt(arts.length), 'activos');
    html += stat('ok', iconLayers(), uCap + ' en stock', fmtInt(totalStock), valor > 0 ? fmtMoney(valor) : 'en el cliente');
    html += stat(sug.length ? 'warn' : 'ok', iconBell(), 'Para reponer', fmtInt(sug.length), sug.length ? 'artículos' : 'todo en nivel');
    html += stat(totalPedir ? 'danger' : 'primary', iconCart(), uCap + ' a pedir', fmtInt(totalPedir), 'pedido sugerido');
    html += '</div>';

    html += '<div class="toolbar">' +
      '<div class="search"><svg viewBox="0 0 24 24"><path d="M21 20l-5.6-5.6a7 7 0 1 0-1.4 1.4L20 21zM4 10a5 5 0 1 1 10 0 5 5 0 0 1-10 0z"/></svg>' +
      '<input id="buscar" type="text" placeholder="Buscar por nombre o código…" value="' + esc(ui.busqueda) + '"></div>' +
      '<div class="chips">' +
      chip('todos', 'Todos') + chip('reponer', 'Para reponer') + chip('ok', 'En nivel') +
      '</div></div>';

    html += '<div class="card"><div class="table-wrap"><table class="table"><thead><tr>' +
      '<th>Artículo</th><th class="num">Stock hoy <span class="muted">(' + unidadCorta() + ')</span></th><th class="num">Máximo</th>' +
      '<th class="num">Sugerido</th><th>Estado</th></tr></thead><tbody>';
    arts.forEach(function (a) {
      var s = stocks[a.id];
      var pp = S.puntoPedido(a);
      var sg = S.sugerido(a, s);
      var e = S.estado(a, s);
      var clase = sg > 0 ? 'reponer' : 'ok';
      html += '<tr data-art="' + a.id + '" data-clase="' + clase + '" ' +
        'data-search="' + esc((a.nombre + ' ' + (a.codigo || '')).toLowerCase()) + '" style="cursor:pointer;">' +
        '<td><div class="cell-art">' + imgTag(a) + '<div><div class="nm">' + esc(a.nombre) + '</div><div class="cd">' + esc(a.codigo || '') + '</div></div></div></td>' +
        '<td class="num"><strong>' + qf(s, a) + '</strong></td>' +
        '<td class="num muted">' + (a.stockMaximo != null ? qf(pp, a) : '—') + '</td>' +
        '<td class="num">' + (sg > 0 ? '<span class="badge badge--warn">+' + qf(sg, a) + '</span>' : '—') + '</td>' +
        '<td>' + badgeEstado(e) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }
  function chip(val, label) {
    return '<button class="chip ' + (ui.filtro === val ? 'is-active' : '') + '" data-chip="' + val + '">' + esc(label) + '</button>';
  }
  function aplicarFiltroStocks() {
    var q = (ui.busqueda || '').toLowerCase();
    $$('[data-art]').forEach(function (tr) {
      var okq = !q || tr.getAttribute('data-search').indexOf(q) >= 0;
      var okf = ui.filtro === 'todos' || tr.getAttribute('data-clase') === ui.filtro;
      tr.style.display = (okq && okf) ? '' : 'none';
    });
  }
  afterRender.stocks = function () {
    var inp = $('#buscar');
    if (inp) inp.addEventListener('input', function () { ui.busqueda = inp.value; aplicarFiltroStocks(); });
    $$('[data-chip]').forEach(function (c) {
      c.addEventListener('click', function () {
        ui.filtro = c.getAttribute('data-chip');
        $$('[data-chip]').forEach(function (x) { x.classList.toggle('is-active', x === c); });
        aplicarFiltroStocks();
      });
    });
    $$('[data-art]').forEach(function (tr) {
      tr.addEventListener('click', function () { openArticulo(tr.getAttribute('data-art')); });
    });
    aplicarFiltroStocks();
  };

  /* ============================================================
     MÓDULO 2 · MOVIMIENTOS  (inicial + entregas − ventas = stock hoy)
     ============================================================ */
  function tipoLabel(t) {
    return t === 'entrega' ? 'Entrega a depósito' : (t === 'venta' ? 'Venta a cliente' : 'Ajuste');
  }
  function renderMovimientos() {
    var arts = S.getArticulos({ soloActivos: true });
    if (!arts.length) return emptyApp();
    var stocks = S.computeStocks();

    var html = '<div class="callout"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>' +
      '<div><strong>Stock hoy</strong> = stock inicial + entregas de Loeke − ventas de OSA. ' +
      'Tocá <strong>Ver</strong> en un artículo para ver sus movimientos y el saldo después de cada uno. ' +
      'El período de abajo filtra ese detalle.</div></div>';

    html += '<div class="toolbar" style="margin-top:18px;">' +
      '<label class="label" style="margin:0;display:flex;align-items:center;gap:8px;">Desde' +
      '<input class="input" id="movDesde" type="date" value="' + esc(ui.movDesde) + '" style="width:auto;padding:8px 10px;"></label>' +
      '<label class="label" style="margin:0;display:flex;align-items:center;gap:8px;">Hasta' +
      '<input class="input" id="movHasta" type="date" value="' + esc(ui.movHasta) + '" style="width:auto;padding:8px 10px;"></label>' +
      (ui.movDesde || ui.movHasta ? btn('mov-limpiar', 'ghost btn--sm', '', 'Limpiar período') : '') +
      '</div>';

    html += '<div class="card"><div class="table-wrap"><table class="table"><thead><tr>' +
      '<th>Artículo</th><th class="num">Inicial</th><th class="num">Entregas</th><th class="num">Ventas</th>' +
      '<th class="num">Stock hoy</th><th class="right">Detalle</th></tr></thead><tbody>';
    arts.forEach(function (a) {
      var t = S.totales(a.id);
      var abierto = !!ui.expanded[a.id];
      html += '<tr data-artrow="' + a.id + '">' +
        '<td><div class="cell-art">' + imgTag(a) + '<div><div class="nm">' + esc(a.nombre) + '</div><div class="cd">' + esc(a.codigo || '') + '</div></div></div></td>' +
        '<td class="num muted">' + qf(a.stockInicial, a) + '</td>' +
        '<td class="num" style="color:var(--ok);">+' + qf(t.entregas, a) + '</td>' +
        '<td class="num" style="color:var(--primary);">−' + qf(t.ventas, a) + '</td>' +
        '<td class="num"><strong>' + qf(stocks[a.id], a) + '</strong></td>' +
        '<td class="right"><button class="btn btn--ghost btn--sm" data-vermov="' + a.id + '">' + (abierto ? 'Ocultar' : 'Ver') + '</button></td>' +
        '</tr>';
      html += '<tr class="mov-detail" data-detail="' + a.id + '"' + (abierto ? '' : ' hidden') + '>' +
        '<td colspan="6" style="background:var(--surface-2);">' + ledgerHTML(a.id) + '</td></tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }
  function ledgerHTML(id) {
    var a = S.getArticulo(id);
    var filas = S.movimientosConSaldo(id, { desde: ui.movDesde, hasta: ui.movHasta });
    if (!filas.length) {
      return '<p class="muted" style="padding:12px 4px;">Sin movimientos' + (ui.movDesde || ui.movHasta ? ' en el período' : '') + '. El saldo se mantiene en el stock inicial.</p>';
    }
    var html = '<table class="table" style="margin:4px 0;"><thead><tr>' +
      '<th>Fecha</th><th>Tipo</th><th class="num">Cantidad</th><th class="num">Saldo</th><th class="right"></th>' +
      '</tr></thead><tbody>';
    // Más reciente primero para leer cómodo
    filas.slice().reverse().forEach(function (f) {
      var m = f.mov;
      var signo = m.tipo === 'venta' ? '−' : (m.tipo === 'ajuste' && m.cantidad < 0 ? '−' : '+');
      var color = m.tipo === 'entrega' ? 'var(--ok)' : (m.tipo === 'venta' ? 'var(--primary)' : 'var(--warn)');
      html += '<tr>' +
        '<td>' + fmtFecha(m.fecha) + '</td>' +
        '<td>' + tipoLabel(m.tipo) + (m.nota ? ' <span class="muted">· ' + esc(m.nota) + '</span>' : '') + '</td>' +
        '<td class="num" style="color:' + color + ';font-weight:700;">' + signo + qf(Math.abs(m.cantidad), a) + '</td>' +
        '<td class="num"><strong>' + qf(f.saldo, a) + '</strong></td>' +
        '<td class="right"><button class="iconbtn" data-delmov="' + m.id + '" title="Eliminar"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2h4v2H2V6h4l1-2z"/></svg></button></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }
  afterRender.movimientos = function () {
    var d = $('#movDesde'), h = $('#movHasta');
    if (d) d.addEventListener('change', function () { ui.movDesde = d.value; render(); });
    if (h) h.addEventListener('change', function () { ui.movHasta = h.value; render(); });
    bindAction('mov-limpiar', function () { ui.movDesde = ''; ui.movHasta = ''; render(); });
    $$('[data-vermov]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-vermov');
        var det = $('[data-detail="' + id + '"]');
        var abrir = det.hidden;
        det.hidden = !abrir;
        ui.expanded[id] = abrir;
        b.textContent = abrir ? 'Ocultar' : 'Ver';
      });
    });
    $$('[data-delmov]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-delmov');
        confirmar('Eliminar movimiento', 'El stock se recalcula sin este movimiento. ¿Continuar?', function () {
          S.removeMovimiento(id); toast('Movimiento eliminado', 'ok'); render();
        });
      });
    });
    // Si venimos de "Ver movimientos" de un artículo, abrir y centrar
    if (pendingExpand) {
      var row = $('[data-detail="' + pendingExpand + '"]');
      var arow = $('[data-artrow="' + pendingExpand + '"]');
      pendingExpand = null;
      if (row && arow) { arow.scrollIntoView({ block: 'center' }); }
    }
  };

  /* ============================================================
     MÓDULO 3 · PUNTO DE PEDIDO
     ============================================================ */
  function renderPunto() {
    var arts = S.getArticulos({ soloActivos: true });
    if (!arts.length) return emptyApp();

    var html = '<div class="card"><div class="card__body" style="display:flex;align-items:center;">' +
      '<div class="callout" style="margin:0;"><svg viewBox="0 0 24 24"><path d="M3 13h2v7H3zM10 8h2v12h-2zM17 4h2v16h-2z"/></svg>' +
      '<div>El <strong>máximo</strong> es la cantidad objetivo que querés tener de cada artículo. ' +
      'El <strong>pedido sugerido</strong> = máximo − stock actual. Dejá el máximo <strong>en blanco</strong> ' +
      'para que ese artículo no se reponga. Tocá <strong>Guardar</strong> arriba para aplicar.</div></div>' +
      '</div></div>';

    html += '<div class="toolbar" style="margin-top:18px;">' +
      '<div class="search"><svg viewBox="0 0 24 24"><path d="M21 20l-5.6-5.6a7 7 0 1 0-1.4 1.4L20 21zM4 10a5 5 0 1 1 10 0 5 5 0 0 1-10 0z"/></svg>' +
      '<input id="buscarP" type="text" placeholder="Buscar artículo…" value="' + esc(ui.qPunto) + '"></div>' +
      '<span class="muted nowrap">' + arts.length + ' artículos</span></div>';

    var uc = unidadCorta();
    var stocks = S.computeStocks();
    html += '<div class="card"><div class="table-wrap"><table class="table"><thead><tr>' +
      '<th>Artículo</th><th class="num">Stock hoy <span class="muted">(' + uc + ')</span></th>' +
      '<th class="num">Máximo <span class="muted">(' + uc + ')</span></th>' +
      '<th class="num">Sugerido <span class="muted">(' + uc + ')</span></th></tr></thead><tbody>';
    arts.forEach(function (a) {
      var stock = stocks[a.id];
      var sg = S.sugerido(a, stock);
      var maxView = (a.stockMaximo != null) ? qN(a.stockMaximo, a) : '';
      html += '<tr data-rowp="' + a.id + '" data-search="' + esc((a.nombre + ' ' + (a.codigo || '')).toLowerCase()) + '">' +
        '<td><div class="cell-art">' + imgTag(a) + '<div><div class="nm">' + esc(a.nombre) + '</div><div class="cd">' + esc(a.codigo || '') + '</div></div></div></td>' +
        '<td class="num"><strong>' + qf(Math.max(0, stock), a) + '</strong></td>' +
        '<td class="num"><input class="qty-input" type="number" min="0" step="1" value="' + maxView + '" placeholder="—" data-max="' + a.id + '"></td>' +
        '<td class="num" data-sug="' + a.id + '">' + (sg > 0 ? '<span class="badge badge--warn">+' + qf(sg, a) + '</span>' : '—') + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }
  afterRender.puntopedido = function () {
    var b = $('#buscarP');
    if (b) b.addEventListener('input', function () {
      ui.qPunto = b.value; var q = b.value.toLowerCase();
      $$('[data-rowp]').forEach(function (tr) {
        tr.style.display = (!q || tr.getAttribute('data-search').indexOf(q) >= 0) ? '' : 'none';
      });
    });
    // Vista previa del pedido sugerido al editar el máximo (sin guardar)
    function preview(id) {
      var a = S.getArticulo(id); if (!a) return;
      var inp = $('[data-max="' + id + '"]');
      var stock = S.stockActual(id);
      var maxU = inp.value === '' ? null : aUni(parseFloat(inp.value) || 0, a);
      var sg = (maxU == null) ? 0 : Math.max(0, maxU - stock);
      var cell = $('[data-sug="' + id + '"]');
      if (cell) cell.innerHTML = sg > 0 ? '<span class="badge badge--warn">+' + qf(sg, a) + '</span>' : '—';
    }
    $$('[data-max]').forEach(function (i) { i.addEventListener('input', function () { preview(i.getAttribute('data-max')); }); });
  };
  function guardarPunto() {
    $$('[data-max]').forEach(function (i) {
      var id = i.getAttribute('data-max');
      var a = S.getArticulo(id); if (!a) return;
      S.updateArticulo(id, { stockMaximo: i.value === '' ? null : aUni(parseFloat(i.value) || 0, a) });
    });
    toast('Máximos actualizados', 'ok');
    render();
  }

  /* ============================================================
     MÓDULO 4 / 5 · ENTREGAS LOEKE  /  VENTAS OSA  (carga rápida)
     ============================================================ */
  function renderCarga(tipo) {
    var arts = S.getArticulos({ soloActivos: true });
    if (!arts.length) return emptyApp();
    var esVenta = tipo === 'venta';
    var explica = esVenta
      ? 'Cargá las cajas que OSA <strong>vendió</strong> a sus clientes. Salen del stock.'
      : 'Cargá las cajas que <strong>Loeke entregó</strong> a OSA. Entran al stock.';
    var fmtFut = esVenta
      ? 'Importá el informe de ventas (PDF o texto). Viene en <strong>unidades</strong>: lo paso a cajas solo. Elegís la quincena al confirmar y el módulo <strong>Cargas</strong> lleva el control.'
      : 'Importá el Excel de facturación (Loeke a OSA). Detecto solo si viene en cajas o en unidades.';

    var html = '<div class="callout"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg><div>' + explica + ' <span class="muted">' + fmtFut + '</span></div></div>';
    html += '<div class="row" style="margin-top:16px;">' +
      (esVenta ? btn('importar-ventas', 'primary', iconUpload(), 'Importar informe (PDF / texto)')
               : btn('importar-entregas', 'primary', iconUpload(), 'Importar Excel (Loeke → OSA)')) +
      (esVenta ? btn('ir-cargas', 'ghost', iconCalendar(), 'Ver control de cargas') : '') +
      '</div>';

    // Últimos movimientos del tipo, como referencia rápida de lo ya cargado.
    var movs = S.getMovimientos({ tipo: esVenta ? 'venta' : 'entrega' }).slice(0, 8);
    if (movs.length) {
      html += '<div class="card" style="margin-top:18px;"><div class="card__head"><h2>Últimos registros</h2></div>' +
        '<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Artículo</th>' +
        (esVenta ? '<th>Quincena</th>' : '') + '<th class="num">Cantidad</th></tr></thead><tbody>';
      movs.forEach(function (m) {
        var a = S.getArticulo(m.articuloId); if (!a) return;
        html += '<tr><td>' + fmtFecha(m.fecha) + '</td>' +
          '<td><span class="nm">' + esc(a.nombre) + '</span> <span class="muted">' + esc(a.codigo || '') + '</span></td>' +
          (esVenta ? '<td class="muted">' + esc(qLabel(m.quincena)) + '</td>' : '') +
          '<td class="num"><strong>' + qf(Math.abs(m.cantidad), a) + '</strong></td></tr>';
      });
      html += '</tbody></table></div></div>';
    }
    return html;
  }
  function renderVentas() { return renderCarga('venta'); }
  function renderEntregas() { return renderCarga('entrega'); }

  /* ============================================================
     MÓDULO 6 · CONTROL DE CARGAS (ventas por quincena)
     ============================================================ */
  function renderControl() {
    var cargas = S.cargasVentas();
    var hoy = S.hoyISO();
    var keys = Object.keys(cargas).sort();
    // Rango: desde la 1ª quincena cargada (o la del baseline 16/06/26) hasta hoy.
    var primera = keys.length ? qObj(keys[0]) : S.quincenaDe('2026-06-16');
    var desdeISO = primera ? primera.desde : '2026-06-16';
    var quincenas = S.listaQuincenas(desdeISO, hoy);
    // Incluir quincenas cargadas que caigan fuera del rango (por las dudas).
    keys.forEach(function (k) {
      if (!quincenas.some(function (q) { return q.key === k; })) { var o = qObj(k); if (o) quincenas.push(o); }
    });
    quincenas.sort(function (a, b) { return a.key < b.key ? -1 : 1; });

    var cargadas = quincenas.filter(function (q) { return cargas[q.key]; }).length;
    var pendientes = quincenas.length - cargadas;
    var uni = unidadVista() === 'unidades';

    var html = '<div class="callout"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>' +
      '<div>Cada quincena (1–15 y 16–fin de mes) se carga con el informe de ventas de OSA. Acá ves <strong>cuáles ya cargaste</strong> y <strong>cuáles faltan</strong>. Importás desde el botón de arriba o desde cada fila pendiente.</div></div>';

    html += '<div class="stats" style="margin-top:16px;">';
    html += stat('primary', iconCalendar(), 'Quincenas', fmtInt(quincenas.length), 'en el período');
    html += stat('ok', iconCheck(), 'Cargadas', fmtInt(cargadas), 'con ventas');
    html += stat(pendientes ? 'warn' : 'ok', iconBell(), 'Pendientes', fmtInt(pendientes), pendientes ? 'sin cargar' : 'al día');
    html += '</div>';

    html += '<div class="card" style="margin-top:18px;"><div class="table-wrap"><table class="table"><thead><tr>' +
      '<th>Quincena</th><th>Rango</th><th>Estado</th><th class="num">Ventas cargadas (' + unidadCorta() + ')</th><th class="right"></th>' +
      '</tr></thead><tbody>';
    quincenas.slice().reverse().forEach(function (q) {
      var c = cargas[q.key];
      var total = c ? (uni ? c.totalUnidades : c.totalCajas) : 0;
      html += '<tr>' +
        '<td><strong>' + esc(q.label) + '</strong>' + (c && c.fechaCarga ? '<div class="cd">cargada ' + fmtFecha(c.fechaCarga) + '</div>' : '') + '</td>' +
        '<td class="muted">' + fmtFecha(q.desde) + ' a ' + fmtFecha(q.hasta) + '</td>' +
        '<td>' + (c ? '<span class="badge badge--ok"><span class="dot"></span>Cargada</span>' : '<span class="badge badge--warn"><span class="dot"></span>Pendiente</span>') + '</td>' +
        '<td class="num">' + (c ? '<strong>' + fmtInt(total) + '</strong> <span class="muted">(' + c.count + ' art.)</span>' : '—') + '</td>' +
        '<td class="right">' + (c ? '' : btn('importar-ventas', 'ghost btn--sm', iconUpload(), 'Importar', 'data-quincena="' + q.key + '"')) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }

  /* ---------- Importar Ventas OSA (PDF con texto / texto pegado) ---------- */
  function cargarScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
  }
  // Extrae el texto de un PDF usando pdf.js (se carga bajo demanda desde CDN).
  function pdfATexto(file) {
    var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
    return (window.pdfjsLib ? Promise.resolve() :
      cargarScript(PDFJS + 'pdf.min.js').then(function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
      })
    ).then(function () { return file.arrayBuffer(); })
      .then(function (buf) { return window.pdfjsLib.getDocument({ data: buf }).promise; })
      .then(function (pdf) {
        var pages = [];
        for (var i = 1; i <= pdf.numPages; i++) pages.push(i);
        return pages.reduce(function (acc, n) {
          return acc.then(function (txt) {
            return pdf.getPage(n).then(function (p) { return p.getTextContent(); }).then(function (tc) {
              var rows = {};
              tc.items.forEach(function (it) {
                var y = Math.round(it.transform[5]);
                (rows[y] = rows[y] || []).push(it);
              });
              var lns = Object.keys(rows).sort(function (a, b) { return b - a; }).map(function (y) {
                return rows[y].sort(function (a, b) { return a.transform[4] - b.transform[4]; })
                  .map(function (it) { return it.str; }).join(' ');
              });
              return txt + lns.join('\n') + '\n';
            });
          });
        }, Promise.resolve(''));
      });
  }
  function openImportVentas(quincenaPref) {
    var body = '<div class="form">' +
      '<div class="imgdrop" id="impDrop" style="cursor:pointer;">' +
      '<div class="imgdrop__text"><strong>Subir PDF del informe</strong><span id="impFileName">PDF con texto seleccionable (no foto escaneada).</span></div>' +
      '<input type="file" id="impFile" accept="application/pdf" hidden>' +
      '</div>' +
      field('O pegá el texto del informe', '<textarea class="textarea" id="impText" style="min-height:120px;font-family:monospace;font-size:12px;" placeholder="Desde 5/06/26 hasta 30/06/26&#10;:L031  FILTRO P/CAFE  12&#10;..."></textarea>', true) +
      '<div class="hint">Se cruza con tu catálogo por código (L031 = 031, L529 = 529E…). Vas a poder revisarlo antes de confirmar.</div>' +
      '<div class="form-actions"><button type="button" class="btn btn--ghost" data-close>Cancelar</button>' +
      '<button type="button" class="btn btn--primary" id="impAnalizar">Analizar</button></div>' +
      '</div>';
    openModal('Importar ventas OSA', body);
    $('#impDrop').addEventListener('click', function () { $('#impFile').click(); });
    $('#impFile').addEventListener('change', function (e) {
      var f = e.target.files[0]; $('#impFileName').textContent = f ? f.name : '';
    });
    $('#impAnalizar').addEventListener('click', function () {
      var f = $('#impFile').files[0];
      var pegado = $('#impText').value;
      if (f && /pdf/i.test((f.type || '') + ' ' + f.name)) {
        toast('Leyendo PDF…', 'info');
        pdfATexto(f).then(function (txt) { previewImport(txt, quincenaPref); })
          .catch(function () { toast('No se pudo leer el PDF. Pegá el texto del informe.', 'danger'); });
      } else if (pegado.trim()) {
        previewImport(pegado, quincenaPref);
      } else if (f) {
        toast('Por ahora subí un PDF con texto, o pegá el texto. Las fotos necesitan OCR.', 'warn');
      } else {
        toast('Subí el PDF o pegá el texto', 'warn');
      }
    });
  }
  function previewImport(text, quincenaPref) {
    var r = S.parseReporteVentas(text);
    if (!r.filas.length) { toast('No reconocí filas en el informe. Revisá el texto.', 'danger'); return; }
    var hoy = S.hoyISO();
    var fechaRep = r.periodo.hasta || hoy;
    var notaPeriodo = r.periodo.desde ? (fmtFecha(r.periodo.desde) + ' a ' + fmtFecha(r.periodo.hasta)) : fmtFecha(fechaRep);
    var nota = 'Ventas OSA ' + notaPeriodo;
    var coincide = r.totalInforme != null && r.totalInforme === r.totalParseado;

    // El informe de OSA viene en UNIDADES (canónico). La caja es solo referencia (÷ uxc).
    var totalCajas = 0, sinUxc = 0;
    var detalle = r.filas.map(function (f) {
      var art = f.articuloId ? S.getArticulo(f.articuloId) : null;
      var uxc = art ? S.uxcDe(art) : 1;
      var cajas = Math.round((f.ventas || 0) / uxc);
      if (art) { totalCajas += cajas; if (uxc <= 1) sinUxc++; }
      return { f: f, art: art, uxc: uxc, cajas: cajas };
    });

    var rows = detalle.map(function (d) {
      var ok = !!d.art;
      return '<tr style="' + (ok ? '' : 'opacity:.55;') + '">' +
        '<td>' + esc(d.f.codigoReporte) + '</td>' +
        '<td>' + (ok ? esc(d.art.nombre) : '<span class="muted">' + esc(d.f.desc || '—') + ' · no está en el catálogo</span>') + '</td>' +
        '<td class="num muted">' + fmtInt(d.f.ventas) + '</td>' +
        '<td class="num"><strong>' + (ok ? fmtInt(d.cajas) : '—') + '</strong></td></tr>';
    }).join('');

    // Quincena a la que se imputa (default: la pasada desde Cargas, o la del fin del informe).
    var qDef = (quincenaPref && qObj(quincenaPref)) || S.quincenaDe(fechaRep) || S.quincenaDe(hoy);
    var quincenas = S.listaQuincenas(r.periodo.desde || fechaRep, hoy > fechaRep ? hoy : fechaRep);
    if (!quincenas.some(function (q) { return q.key === qDef.key; })) quincenas.push(qDef);
    quincenas.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    var optsQ = quincenas.map(function (q) {
      return '<option value="' + q.key + '"' + (q.key === qDef.key ? ' selected' : '') + '>' +
        esc(q.label) + (S.quincenaCargada(q.key) ? ' — ya cargada' : '') + '</option>';
    }).join('');

    var resumen = '<div class="callout" style="margin-bottom:14px;"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg><div>' +
      'Informe <strong>' + esc(notaPeriodo) + '</strong> · ' + r.matchCount + ' de ' + r.filas.length + ' reconocidos' +
      (r.noEncontrados.length ? ' · <span style="color:var(--warn)">' + r.noEncontrados.length + ' sin coincidencia</span>' : '') +
      '<br>Total informe (u): <strong>' + (r.totalInforme != null ? fmtInt(r.totalInforme) : '—') + '</strong> · ' +
      'Suma leída (u): <strong style="color:' + (coincide ? 'var(--ok)' : 'var(--warn)') + '">' + fmtInt(r.totalParseado) + '</strong>' +
      (r.totalInforme != null && !coincide ? ' — no coinciden, revisá' : '') +
      '<br>A descontar del stock: <strong>' + fmtInt(r.totalParseado) + '</strong> unidades (' + fmtInt(totalCajas) + ' cajas)' +
      (sinUxc ? '<br><span style="color:var(--warn)">' + sinUxc + ' artículo(s) sin Uni×Caja conocida: en cajas se cuentan 1 u = 1 caja.</span>' : '') +
      '</div></div>';

    var body = resumen +
      '<div class="row" style="gap:12px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">' +
      '<label class="label" style="margin:0;display:flex;align-items:center;gap:8px;">Imputar a la quincena' +
      '<select class="select" id="impQuincena" style="width:auto;">' + optsQ + '</select></label></div>' +
      '<div id="impQAviso" style="margin-bottom:10px;"></div>' +
      '<div class="table-wrap" style="max-height:300px;overflow:auto;"><table class="table"><thead><tr><th>Código</th><th>Artículo</th><th class="num">Ventas (u)</th><th class="num">Cajas</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="form-actions"><button type="button" class="btn btn--ghost" data-close>Cancelar</button>' +
      '<button type="button" class="btn btn--primary" id="impConfirm">Confirmar importación</button></div>';
    openModal('Revisar ventas a importar', body);

    function chkQ() {
      var c = S.quincenaCargada($('#impQuincena').value);
      $('#impQAviso').innerHTML = c
        ? '<div class="callout" style="margin:0;border-color:var(--warn);"><svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg><div><strong style="color:var(--warn)">Esa quincena ya tiene ' + c.count + ' ventas cargadas (' + fmtInt(c.totalUnidades) + ' u).</strong> Si confirmás, se suman de nuevo (doble carga).</div></div>'
        : '';
    }
    $('#impQuincena').addEventListener('change', chkQ); chkQ();

    $('#impConfirm').addEventListener('click', function () {
      var qk = $('#impQuincena').value;
      var qObj = S.quincenaDe(qk.slice(0, 8) + (qk.slice(-1) === '1' ? '01' : '16'));
      var fech = qObj ? qObj.hasta : fechaRep;
      var batch = detalle.filter(function (d) { return d.art && d.f.ventas > 0; })
        .map(function (d) { return { articuloId: d.art.id, tipo: 'venta', cantidad: d.f.ventas, fecha: fech, nota: nota, quincena: qk }; });
      if (!batch.length) { toast('No hay ventas para importar', 'warn'); return; }
      // addMovimientosBatch persiste cada venta en Supabase (osa_ventas).
      S.addMovimientosBatch(batch);
      closeModal();
      toast('Importadas ' + batch.length + ' ventas (' + fmtInt(r.totalParseado) + ' u / ' + fmtInt(totalCajas) + ' cajas)', 'ok');
      var pend = S.pedidoSugerido().length;
      render();
      if (pend) setTimeout(function () { toast(pend + ' artículo(s) necesitan reposición', 'warn'); }, 700);
    });
  }

  /* ---------- Importar Entregas Loeke (Excel .xls / .xlsx) ---------- */
  // Lee el Excel con SheetJS (se carga bajo demanda desde CDN) -> filas (array 2D).
  function xlsxAFilas(file) {
    var SJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    return (window.XLSX ? Promise.resolve() : cargarScript(SJS))
      .then(function () { return file.arrayBuffer(); })
      .then(function (buf) {
        var wb = window.XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
        var ws = wb.Sheets[wb.SheetNames[0]];
        return window.XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
      });
  }
  function openImportEntregas() {
    var body = '<div class="form">' +
      '<div class="imgdrop" id="entDrop" style="cursor:pointer;">' +
      '<div class="imgdrop__text"><strong>Subir Excel de facturación</strong><span id="entFileName">Archivo .xls o .xlsx (Loeke a OSA).</span></div>' +
      '<input type="file" id="entFile" accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>' +
      '</div>' +
      '<div class="hint">Detecta solo la columna de código (cruza con tu catálogo) y la cantidad. Cada fila es una entrega que <strong>suma</strong> al stock. Vas a poder revisar antes de confirmar.</div>' +
      '<div class="form-actions"><button type="button" class="btn btn--ghost" data-close>Cancelar</button>' +
      '<button type="button" class="btn btn--primary" id="entAnalizar">Analizar</button></div>' +
      '</div>';
    openModal('Importar entregas Loeke', body);
    $('#entDrop').addEventListener('click', function () { $('#entFile').click(); });
    $('#entFile').addEventListener('change', function (e) {
      var f = e.target.files[0]; $('#entFileName').textContent = f ? f.name : '';
    });
    $('#entAnalizar').addEventListener('click', function () {
      var f = $('#entFile').files[0];
      if (!f) { toast('Elegí el archivo Excel', 'warn'); return; }
      toast('Leyendo Excel…', 'info');
      xlsxAFilas(f).then(function (rows) { previewEntregas(rows); })
        .catch(function () { toast('No se pudo leer el Excel. Probá guardarlo como .xlsx.', 'danger'); });
    });
  }
  function previewEntregas(rows) {
    var r = S.parseEntregas(rows);
    if (!r.filas.length) { toast('No reconocí filas de entrega en el Excel.', 'danger'); return; }
    var periodoTxt = r.fechas.length ? r.fechas.map(fmtFecha).join(', ') : 'sin fecha';
    var nota = 'Entrega Loeke (Excel)';
    var enCajas = r.formato === 'cajas';
    var yaImportado = S.getMovimientos({ tipo: 'entrega' }).filter(function (m) {
      return m.nota === nota && r.fechas.indexOf(m.fecha) >= 0;
    }).length;

    var listado = r.filas.map(function (f) {
      var ok = !!f.articuloId;
      return '<tr style="' + (ok ? '' : 'opacity:.55;') + '">' +
        '<td>' + esc(f.codigo) + '</td>' +
        '<td>' + (ok ? esc(f.nombre) : '<span class="muted">' + esc(f.descripcion || '—') + ' · no está en el catálogo</span>') + '</td>' +
        '<td>' + esc(fmtFecha(f.fecha)) + '</td>' +
        '<td class="num"><strong>' + fmtInt(f.unidades) + '</strong></td>' +
        '<td class="num muted">' + fmtInt(f.cajas) + '</td></tr>';
    }).join('');

    var badge = '<span class="badge badge--' + (enCajas ? 'ok' : 'warn') + '">Detectado: archivo en ' + (enCajas ? 'CAJAS' : 'UNIDADES') + '</span>';
    var resumen = '<div class="callout" style="margin-bottom:14px;"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg><div>' +
      badge + ' &nbsp; Fecha(s) <strong>' + esc(periodoTxt) + '</strong> · ' + r.matchCount + ' de ' + r.filas.length + ' reconocidos' +
      (r.noEncontrados.length ? ' · <span style="color:var(--warn)">' + r.noEncontrados.length + ' sin coincidencia</span>' : '') +
      '<br>A registrar (suma al stock): <strong>' + fmtInt(r.totalUnidades) + '</strong> unidades · <strong>' + fmtInt(r.totalCajas) + '</strong> cajas' +
      (enCajas
        ? '<br><span class="muted">Detecté las Uni×Caja del archivo (las actualizo en el catálogo) y lo paso a unidades.</span>'
        : '<br><span class="muted">El archivo vino en unidades: se guardan directo.</span>') +
      (yaImportado ? '<br><strong style="color:var(--warn)">⚠ Ya importaste entregas en esa(s) fecha(s) (' + yaImportado + ' movimientos). Si confirmás, se suman de nuevo.</strong>' : '') +
      '</div></div>';

    var body = resumen +
      '<div class="table-wrap" style="max-height:320px;overflow:auto;"><table class="table"><thead><tr><th>Código</th><th>Artículo</th><th>Fecha</th><th class="num">Unidades</th><th class="num">Cajas</th></tr></thead><tbody>' + listado + '</tbody></table></div>' +
      '<div class="form-actions"><button type="button" class="btn btn--ghost" data-close>Cancelar</button>' +
      '<button type="button" class="btn btn--primary" id="entConfirm">Confirmar entregas</button></div>';
    openModal('Revisar entregas a registrar', body);

    $('#entConfirm').addEventListener('click', function () {
      if (enCajas && r.uxcDerivado) S.actualizarUxcDesde(r.uxcDerivado); // mantener Uni×Caja al día
      var batch = r.filas.filter(function (f) { return f.articuloId && f.unidades > 0; })
        .map(function (f) { return { articuloId: f.articuloId, tipo: 'entrega', cantidad: f.unidades, fecha: f.fecha || S.hoyISO(), nota: nota, formato: r.formato }; });
      if (!batch.length) { toast('No hay entregas para registrar', 'warn'); return; }
      // addMovimientosBatch persiste cada entrega en Supabase (osa_entregas).
      S.addMovimientosBatch(batch);
      closeModal();
      toast('Registradas ' + batch.length + ' entregas (' + fmtInt(r.totalUnidades) + ' u / ' + fmtInt(r.totalCajas) + ' cajas)', 'ok');
      render();
    });
  }

  function openAjuste() {
    var arts = S.getArticulos({ soloActivos: true });
    if (!arts.length) { toast('Primero creá un artículo', 'warn'); return; }
    var opts = arts.map(function (a) { return '<option value="' + a.id + '">' + esc(a.nombre) + (a.codigo ? ' (' + esc(a.codigo) + ')' : '') + '</option>'; }).join('');
    var body = '<form class="form" id="ajForm">' +
      field('Artículo', '<select class="select" id="ajArt">' + opts + '</select>', true) +
      '<div class="form-grid">' +
      field('Cantidad', '<input class="input" id="ajCant" type="number" step="1" value="0" placeholder="Negativo para descontar">') +
      field('Fecha', '<input class="input" id="ajFecha" type="date" value="' + S.hoyISO() + '">') +
      '</div>' +
      field('Nota <span class="opt">(opcional)</span>', '<input class="input" id="ajNota" placeholder="Ej: rotura, faltante, recuento">', true) +
      '<div class="hint">Un ajuste suma o resta cajas directamente (roturas, vencimientos, recuentos). Usá número negativo para descontar.</div>' +
      '<div class="form-actions"><button type="button" class="btn btn--ghost" data-close>Cancelar</button>' +
      '<button type="submit" class="btn btn--primary">Guardar ajuste</button></div></form>';
    openModal('Ajuste manual de stock', body);
    $('#ajForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var c = Math.round(parseFloat($('#ajCant').value) || 0);
      if (!c) { toast('Ingresá una cantidad distinta de 0', 'warn'); return; }
      S.addMovimiento({ articuloId: $('#ajArt').value, tipo: 'ajuste', cantidad: c, fecha: $('#ajFecha').value, nota: $('#ajNota').value });
      closeModal(); toast('Ajuste registrado', 'ok'); render();
    });
  }

  /* ============================================================
     ARTÍCULO · detalle + edición (desde Stocks)
     ============================================================ */
  function openArticulo(id) {
    var a = id ? S.getArticulo(id) : null;
    var foto = a ? a.foto : '';
    var stock = a ? S.stockActual(id) : 0;
    var resumen = '';
    if (a) {
      var e = S.estado(a, stock);
      resumen = '<div class="stats" style="margin-bottom:16px;">' +
        miniStat('Stock hoy (' + unidadCorta() + ')', e === 'sin' ? '0' : qf(stock, a)) +
        miniStat('Máximo', a.stockMaximo != null ? qf(S.puntoPedido(a), a) : '—') +
        miniStat('Sugerido', qf(S.sugerido(a, stock), a)) +
        miniStat('Prom. mensual', qf(S.promedioMensual(a), a)) +
        '</div>';
    }
    var body = '' +
      (a ? resumen : '') +
      '<form class="form" id="artForm">' +
      '<div class="imgdrop" id="imgdrop">' +
      '<img class="imgdrop__preview" id="imgPreview" src="' + (a ? fotoDe(a) : esc(S.placeholder('Nuevo'))) + '" alt="" data-ph="' + esc(S.placeholder(a ? a.nombre : 'Nuevo')) + '" onerror="this.onerror=null;this.src=this.dataset.ph;">' +
      '<div class="imgdrop__text"><strong>Foto del artículo</strong><span>Tocá para subir una imagen (JPG/PNG). Se optimiza sola.</span></div>' +
      '<input type="file" id="imgInput" accept="image/*" hidden>' +
      '</div>' +
      '<input type="hidden" id="fFoto" value="' + esc(foto) + '">' +
      '<div class="form-grid">' +
      field('Nombre', '<input class="input" id="fNombre" value="' + esc(a ? a.nombre : '') + '" placeholder="Ej: Pelador mango plástico" required>', true) +
      field('Código / SKU <span class="opt">(opcional)</span>', '<input class="input" id="fCodigo" value="' + esc(a ? a.codigo : '') + '" placeholder="Ej: 505">') +
      field('Stock inicial', '<input class="input" id="fInicial" type="number" min="0" step="1" value="' + (a ? a.stockInicial : 0) + '">') +
      field('Descripción <span class="opt">(opcional)</span>', '<textarea class="textarea" id="fDesc" placeholder="Detalle…">' + esc(a ? a.descripcion : '') + '</textarea>', true) +
      field('Máximo en ' + unidadCorta() + ' <span class="opt">(en blanco = no repone)</span>', '<input class="input" id="fMax" type="number" min="0" step="1" value="' + (a && a.stockMaximo != null ? qN(a.stockMaximo, a) : '') + '" placeholder="—">') +
      field('Precio unitario <span class="opt">(opcional)</span>', '<div class="input-prefix"><span>$</span><input class="input" id="fPrecio" type="number" min="0" step="0.01" value="' + (a ? a.precio : 0) + '"></div>') +
      '</div>' +
      '<div class="hint">El <strong>pedido sugerido</strong> es <strong>máximo − stock</strong>. Dejá el máximo en blanco para que este artículo no se reponga.</div>' +
      '<div class="form-actions">' +
      (a ? '<button type="button" class="btn btn--ghost" id="fVerMov">Ver movimientos</button>' : '') +
      (a ? '<button type="button" class="btn btn--danger" id="fEliminar">Eliminar</button>' : '') +
      '<div style="flex:1"></div>' +
      '<button type="button" class="btn btn--ghost" data-close>Cancelar</button>' +
      '<button type="submit" class="btn btn--primary">' + iconSave() + '<span>Guardar</span></button>' +
      '</div></form>';
    openModal(a ? 'Artículo' : 'Nuevo artículo', body);

    var preview = $('#imgPreview'), fFoto = $('#fFoto'), fNombre = $('#fNombre');
    $('#imgdrop').addEventListener('click', function () { $('#imgInput').click(); });
    $('#imgInput').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      comprimirImagen(file, function (dataUrl) { fFoto.value = dataUrl; preview.src = dataUrl; });
    });
    if (!foto) fNombre.addEventListener('input', function () { if (!fFoto.value) preview.src = S.placeholder(fNombre.value || 'Nuevo'); });

    if (a) $('#fVerMov').addEventListener('click', function () {
      closeModal(); ui.expanded[a.id] = true; pendingExpand = a.id; location.hash = '#/movimientos'; setView('movimientos');
    });
    if (a) $('#fEliminar').addEventListener('click', function () {
      confirmar('Eliminar artículo', '¿Eliminar «' + a.nombre + '» y todos sus movimientos? Esta acción no se puede deshacer.', function () {
        S.removeArticulo(a.id); closeModal(); toast('Artículo eliminado', 'ok'); render();
      });
    });
    $('#artForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {
        nombre: fNombre.value, codigo: $('#fCodigo').value, descripcion: $('#fDesc').value,
        foto: fFoto.value, precio: $('#fPrecio').value, stockInicial: $('#fInicial').value,
        stockMaximo: $('#fMax').value === '' ? null : aUni(parseFloat($('#fMax').value) || 0, a)
      };
      if (!data.nombre.trim()) { toast('Poné un nombre al artículo', 'warn'); return; }
      if (a) { S.updateArticulo(a.id, data); toast('Artículo actualizado', 'ok'); }
      else { S.addArticulo(data); toast('Artículo creado', 'ok'); }
      closeModal(); render();
    });
  }
  function miniStat(label, value) {
    return '<div class="stat tone-primary" style="padding:14px;"><div class="stat__label">' + esc(label) + '</div><div class="stat__value" style="font-size:22px;">' + value + '</div></div>';
  }

  /* ---------- Impresión del pedido sugerido ---------- */
  function imprimirSugerido() {
    var sug = S.pedidoSugerido();
    if (!sug.length) { toast('No hay nada para reponer', 'info'); return; }
    var meta = S.getMeta();
    var totalU = qSum(sug.map(function (x) { return { cajas: x.sugerido, art: x.articulo }; }));
    var rows = sug.map(function (x) {
      var a = x.articulo;
      return '<tr><td class="cod">' + esc(a.codigo || '') + '</td><td class="art">' + esc(a.nombre) + '</td>' +
        '<td class="num">' + qf(x.stock, a) + '</td>' +
        '<td class="num">' + qf(x.punto, a) + '</td>' +
        '<td class="num"><strong>' + qf(x.sugerido, a) + '</strong></td></tr>';
    }).join('');
    var html = '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Pedido sugerido</title>' +
      '<style>' +
      '@page{size:A4 portrait;margin:14mm;}' +
      '*{box-sizing:border-box;}' +
      'body{font-family:Inter,Arial,sans-serif;color:#1c2233;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
      'h1{font-size:20px;margin:0 0 2px;}' +
      '.muted{color:#6b7390;}' +
      '.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #b00020;padding-bottom:12px;}' +
      '.brand{font-size:12px;color:#b00020;font-weight:700;}' +
      'table{border-collapse:collapse;width:100%;margin-top:14px;}' +
      'thead{display:table-header-group;}' +              // repite el encabezado en cada hoja
      'th,td{padding:6px 10px;border-bottom:1px solid #e3e6f0;font-size:12px;text-align:left;}' +
      'th:first-child,td:first-child{padding-left:0;}th:last-child,td:last-child{padding-right:0;}' +
      'th{background:#f5f6fb;text-transform:uppercase;font-size:10px;letter-spacing:.04em;color:#6b7390;}' +
      '.cod{color:#6b7390;white-space:nowrap;}.num{text-align:right;white-space:nowrap;}.art{white-space:normal;}' +
      'tr{page-break-inside:avoid;}' +                    // no parte una fila entre hojas
      '.tot{margin-top:12px;text-align:right;font-size:14px;font-weight:700;}' +
      '.foot{margin-top:18px;font-size:11px;color:#6b7390;}' +
      '</style></head><body>' +
      '<div class="head"><div><div class="brand">PEDIDO SUGERIDO</div><h1>' + esc(meta.empresa || 'Mi Empresa') + '</h1>' +
      (meta.cliente ? '<div class="muted">Cliente: ' + esc(meta.cliente) + '</div>' : '') + '</div>' +
      '<div class="muted" style="text-align:right">Fecha: ' + fmtFecha(S.hoyISO()) + '</div></div>' +
      '<table><thead><tr><th class="cod">Código</th><th class="art">Artículo</th><th class="num">Stock hoy</th>' +
      '<th class="num">Máximo</th><th class="num">A pedir</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="tot">Total ' + unidadLbl() + ' a pedir: ' + fmtInt(totalU) + '</div>' +
      '<p class="foot">Generado con StockRotativo · ' + fmtFecha(S.hoyISO()) + '</p>' +
      '</body></html>';
    var w = window.open('', '_blank');
    if (!w) { toast('Permití las ventanas emergentes para imprimir', 'warn'); return; }
    w.document.write(html); w.document.close();
    setTimeout(function () { w.focus(); w.print(); }, 350);
  }

  /* ---------- Enviar pedido a Loekemeyer (pedido normal del sitio) ----------
     Flujo: el botón abre un POP-UP donde el usuario revisa/ajusta las cajas de
     cada artículo (+/−); al confirmar se crea un pedido normal vía
     submit_order_fast (orders/order_items) + sheets-proxy + sheets-entregas-proxy
     (igual que el catálogo mayorista). El pedido va SIEMPRE en cajas cerradas. */

  // Items sugeridos (en cajas cerradas) listos para revisar/editar.
  function itemsSugeridosLK() {
    return S.pedidoSugerido().map(function (x) {
      var a = x.articulo, f = S.uxcDe(a);
      return {
        cod: a.codigo || '', nombre: a.nombre, uxc: f,
        cajas: Math.round(x.sugerido / f),
        stockCajas: Math.round((x.stock || 0) / f),  // stock actual en cajas
        maxCajas: Math.round((x.punto || 0) / f)      // máximo objetivo en cajas
      };
    }).filter(function (it) { return it.cajas > 0; });
  }

  // Arma el payload del pedido a partir de una lista de items {cod,nombre,uxc,cajas}.
  function pedidoDesdeItems(items) {
    var m = S.getMeta();
    var lim = items.filter(function (it) { return it.cajas > 0; }).map(function (it) {
      return { cod: it.cod, nombre: it.nombre, cajas: it.cajas, unidades: it.cajas * it.uxc };
    });
    var iso = S.hoyISO().split('-'); // yyyy-mm-dd -> dd/MM/yyyy
    return {
      fecha: iso[2] + '/' + iso[1] + '/' + iso[0],
      cliente: LK_CLIENTE, vend: LK_VEND,
      sucursal: m.sucursalLK || LK_SUCURSALES[0].val,
      items: lim,
      totalCajas: lim.reduce(function (s, it) { return s + it.cajas; }, 0),
      totalUnidades: lim.reduce(function (s, it) { return s + it.unidades; }, 0)
    };
  }

  // Paso 1: pop-up para revisar/ajustar las cajas antes de enviar.
  function enviarLoeke() {
    var items = itemsSugeridosLK();
    if (!items.length) { toast('No hay nada para reponer', 'info'); return; }
    var rows = items.map(function (it, i) {
      return '<div class="pedrow">' +
        '<div class="pedrow__info"><span class="pedrow__cod">' + esc(it.cod) + '</span>' +
        '<span class="pedrow__name">' + esc(it.nombre) + '</span>' +
        '<span class="pedrow__meta">Stock <strong>' + it.stockCajas + '</strong> · Máx <strong>' + it.maxCajas + '</strong> cajas</span></div>' +
        '<div class="stepper">' +
          '<button type="button" class="stepper__btn" data-step="-1" data-i="' + i + '">−</button>' +
          '<input class="stepper__inp" type="number" min="0" step="1" inputmode="numeric" value="' + it.cajas + '" data-i="' + i + '" aria-label="Cajas de ' + esc(it.cod) + '">' +
          '<button type="button" class="stepper__btn" data-step="1" data-i="' + i + '">+</button>' +
        '</div>' +
        '<button type="button" class="pedrow__del" data-i="' + i + '" title="Sacar del pedido" aria-label="Sacar ' + esc(it.cod) + '">×</button>' +
        '</div>';
    }).join('');
    var totIni = items.reduce(function (s, it) { return s + it.cajas; }, 0);
    var body = '<div class="pedlist">' + rows + '</div>' +
      '<div class="pedtot">Total: <strong id="pedTotal">' + totIni + '</strong> cajas</div>' +
      '<div class="hint">Ajustá las cajas con − / + (o tocá la <strong>✕</strong> para sacar el artículo). Las unidades se calculan solas. Sucursal: <strong>' + esc(S.getMeta().sucursalLK || LK_SUCURSALES[0].val) + '</strong>.</div>' +
      '<div class="form-actions"><button type="button" class="btn btn--ghost" data-close>Cancelar</button>' +
      '<button type="button" class="btn btn--primary" id="pedConfirm">Confirmar y enviar</button></div>';
    openModal('Revisar pedido a Loekemeyer', body);

    var list = document.getElementById('modalBody').querySelector('.pedlist');
    function recalc() {
      var t = 0;
      list.querySelectorAll('.stepper__inp').forEach(function (inp) { t += Math.max(0, parseInt(inp.value, 10) || 0); });
      document.getElementById('pedTotal').textContent = t;
    }
    list.addEventListener('click', function (e) {
      var del = e.target.closest('.pedrow__del');
      if (del) { var row = del.closest('.pedrow'); if (row) row.parentNode.removeChild(row); recalc(); return; }
      var b = e.target.closest('.stepper__btn');
      if (!b) return;
      var inp = list.querySelector('.stepper__inp[data-i="' + b.getAttribute('data-i') + '"]');
      inp.value = Math.max(0, (parseInt(inp.value, 10) || 0) + parseInt(b.getAttribute('data-step'), 10));
      recalc();
    });
    list.addEventListener('input', function (e) {
      if (e.target.classList.contains('stepper__inp')) recalc();
    });
    document.getElementById('pedConfirm').addEventListener('click', function () {
      var edit = items.map(function (it, i) {
        var inp = list.querySelector('.stepper__inp[data-i="' + i + '"]');
        return { cod: it.cod, nombre: it.nombre, uxc: it.uxc, cajas: inp ? Math.max(0, parseInt(inp.value, 10) || 0) : 0 };
      }).filter(function (it) { return it.cajas > 0; });
      if (!edit.length) { toast('Poné cantidad en al menos un artículo', 'warn'); return; }
      closeModal();
      confirmarEnvioLoeke(pedidoDesdeItems(edit));
    });
  }

  // Paso 2: manda el pedido como un pedido NORMAL del sitio:
  // submit_order_fast (orders/order_items) + sheets-proxy + sheets-entregas-proxy,
  // reusando la sesión del cliente OSA logueado en la página principal.
  async function confirmarEnvioLoeke(pedido) {
    if (!pedido.items.length) { toast('No hay nada para reponer', 'info'); return; }
    if (!sb) { toast('No se pudo cargar Supabase. Recargá la página.', 'danger'); return; }
    toast('Enviando pedido a Loekemeyer…', 'info');
    try {
      // 1) Sesión: reusa el login del sitio (misma origin). Si no hay, mandar a loguear.
      var sess = (await sb.auth.getSession()).data.session;
      if (!sess) {
        toast('Iniciá sesión en la página principal para enviar el pedido.', 'warn');
        setTimeout(function () { window.location.href = '../mayorista.html'; }, 1600);
        return;
      }
      var authUserId = sess.user.id;

      // 2) Perfil del cliente (OSA).
      var prof = (await sb.from('customers')
        .select('id,business_name,cod_cliente,cuit,vend,dto_vol,debt,credit_limit,payment_term')
        .eq('auth_user_id', authUserId).maybeSingle()).data;
      if (!prof) { toast('No encontré tu perfil de cliente. Reingresá en la página.', 'danger'); return; }

      // 3) Mapear códigos del pedido → productos del catálogo (id, uxb, precio).
      var prodMap = await osaResolveProducts(pedido.items.map(function (it) { return it.cod; }));

      // 4) Items + totales (Contado -25% + descuento web + dto x volumen).
      var dtoVol = Number(prof.dto_vol || 0);
      var webDisc = await osaWebDiscount();
      var rpcItems = [], sheetItems = [], subtotal = 0, noMap = [];
      pedido.items.forEach(function (it) {
        var p = prodMap[String(it.cod || '').trim().toUpperCase()];
        if (!p) { noMap.push(it.cod); return; }
        var uxb = Number(p.uxb || 0);
        var cajas = Math.max(0, Math.round(Number(it.cajas || 0)));
        if (cajas <= 0) return;
        var yourUnit = Number(p.list_price || 0) * (1 - dtoVol);
        subtotal += yourUnit * cajas * uxb;
        rpcItems.push({ product_id: p.id, cajas: cajas, uxb: uxb, is_loke: false });
        sheetItems.push({ cod_art: String(p.cod || '').trim(), cajas: cajas, uxb: uxb, description: p.description || '' });
      });
      if (!rpcItems.length) {
        toast('No pude mapear ningún artículo a un producto del catálogo.', 'danger');
        return;
      }
      var finalTotal = subtotal * (1 - webDisc) * (1 - OSA_PAGO_DISCOUNT);

      // 5) Crear el pedido (mismo RPC que el sitio).
      var rpc = await sb.rpc('submit_order_fast', {
        p_auth_user_id: authUserId,
        p_customer_id: prof.id,
        p_status: 'pendiente',
        p_payment_method: OSA_PAGO_TEXT,
        p_payment_discount: OSA_PAGO_DISCOUNT,
        p_web_discount: webDisc,
        p_subtotal: subtotal,
        p_total: finalTotal,
        p_items: rpcItems
      });
      if (rpc.error || !rpc.data) {
        throw new Error((rpc.error && (rpc.error.message || rpc.error.details)) || 'submit_order_fast falló');
      }
      var orderId = rpc.data;

      // 6) Sheets (mismos payloads que el sitio).
      var debt = Number(prof.debt || 0);
      var creditLimit = prof.credit_limit == null ? null : Number(prof.credit_limit);
      var lcStatus = (creditLimit != null && (debt + finalTotal) > creditLimit) ? 'X' : 'OK';
      var dStatus = debt > 0 ? 'X' : 'OK';
      var ppStatus = prof.payment_term == null ? 'Null' : String(Number(prof.payment_term));
      var suc = pedido.sucursal || (S.getMeta().sucursalLK || LK_SUCURSALES[0].val);

      var sheetsPayload = {
        order_number: String(orderId).trim(),
        cod_cliente: String(prof.cod_cliente || '').trim(),
        vend: String(prof.vend || '').trim(),
        condicion_pago: OSA_PAGO_TEXT,
        condicion_pago_code: OSA_PAGO_CODE,
        sucursal_entrega: suc,
        cliente_nuevo: '',
        is_promo: false,
        extra_discount: 0,
        deuda: debt,
        credit_limit: creditLimit,
        payment_term: prof.payment_term == null ? null : Number(prof.payment_term),
        lc: lcStatus, d: dStatus, pp: ppStatus,
        order_total: finalTotal,
        source: 'Web',
        mode: 'new',
        items: sheetItems.map(function (it) { return { cod_art: it.cod_art, cajas: it.cajas, uxb: it.uxb }; })
      };

      sb.from('orders').update({ sheets_payload: sheetsPayload, is_promo: false, extra_discount: 0 })
        .eq('id', orderId).then(function () {});
      osaSendSheets(sess.access_token, sheetsPayload)
        .then(function () { sb.from('orders').update({ sheets_sent: true }).eq('id', orderId).then(function () {}); })
        .catch(function (e) { console.warn('Sheets error (order ' + orderId + '):', e); });

      var entregasPayload = {
        order_number: orderId,
        fecha: new Date().toLocaleDateString('es-AR'),
        cod_cliente: prof.cod_cliente,
        cliente: prof.business_name,
        vendedor: prof.vend || '',
        direccion_entrega: suc,
        barrio_entrega: '',
        empresa: 'LK',
        is_promo: false,
        extra_discount: 0,
        mode: 'new',
        items: sheetItems.map(function (it) { return { cod_art: it.cod_art, description: it.description || '', cajas: it.cajas, uxb: it.uxb }; })
      };
      osaSendEntregasSheet(sess.access_token, entregasPayload);

      toast('Pedido N° ' + orderId + ' enviado (' + rpcItems.length + ' artículos)', 'ok');
      if (noMap.length) {
        setTimeout(function () {
          toast(noMap.length + ' código(s) sin producto, no enviados: ' + noMap.join(', '), 'warn');
        }, 900);
      }
    } catch (err) {
      toast('No se pudo enviar: ' + (err && err.message ? err.message : err), 'danger');
    }
  }

  // Lee el descuento web (app_settings.web_order_discount, fallback 0.02).
  function osaWebDiscount() {
    return sb.from('app_settings').select('value').eq('key', 'web_order_discount').single()
      .then(function (r) { return (r.data && Number(r.data.value)) || 0.02; })
      .catch(function () { return 0.02; });
  }

  // Mapa CÓDIGO(MAYÚSCULAS) → producto, tolerando la variante con/sin "E".
  function osaResolveProducts(codes) {
    var wanted = [];
    codes.forEach(function (c) {
      var u = String(c || '').trim().toUpperCase();
      if (!u) return;
      wanted.push(u);
      wanted.push(/E$/.test(u) ? u.replace(/E$/, '') : u + 'E');
    });
    wanted = wanted.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    if (!wanted.length) return Promise.resolve({});
    return sb.from('products').select('id,cod,uxb,list_price,description').in('cod', wanted)
      .then(function (r) {
        var byCod = {};
        (r.data || []).forEach(function (p) { byCod[String(p.cod || '').trim().toUpperCase()] = p; });
        var map = {};
        codes.forEach(function (c) {
          var u = String(c || '').trim().toUpperCase();
          map[u] = byCod[u] || byCod[u.replace(/E$/, '')] || byCod[u + 'E'] || null;
        });
        return map;
      });
  }

  // sheets-proxy (pedidos). Authorization: Bearer access_token; hasta 3 intentos.
  function osaSendSheets(token, payload, attempt) {
    attempt = attempt || 1;
    return fetch(SHEETS_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload)
    }).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (data) {
        if (!resp.ok || (data && data.ok === false)) {
          throw new Error((data && data.error) || ('Proxy error ' + resp.status));
        }
        return { ok: true };
      });
    }).catch(function (e) {
      if (attempt < 3) {
        return new Promise(function (res) { setTimeout(res, 1200); })
          .then(function () { return osaSendSheets(token, payload, attempt + 1); });
      }
      throw e;
    });
  }

  // sheets-entregas-proxy (Base Picking). Bearer access_token + apikey anon. Best-effort.
  function osaSendEntregasSheet(token, payload) {
    return fetch(SHEETS_ENTREGAS_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY),
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify(payload)
    }).catch(function (e) { console.warn('Entregas sheet error:', e); });
  }

  /* ============================================================
     MÓDULO · CONFIGURACIÓN
     ============================================================ */
  function renderConfig() {
    var m = S.getMeta();
    var html = '<div class="grid-2">';
    html += '<div class="card"><div class="card__head"><h2>Datos del negocio</h2></div><div class="card__body">' +
      '<form class="form" id="cfgForm">' +
      field('Nombre de tu empresa', '<input class="input" id="cEmpresa" value="' + esc(m.empresa) + '">', true) +
      field('Cliente (consignatario)', '<input class="input" id="cCliente" value="' + esc(m.cliente) + '" placeholder="Ej: Osa Distribuidora SRL">', true) +
      '<div class="form-grid">' +
      field('Moneda', '<select class="select" id="cMoneda">' +
        ['ARS', 'USD', 'EUR', 'CLP', 'MXN', 'UYU', 'COP', 'PEN', 'BRL'].map(function (x) {
          return '<option value="' + x + '"' + (m.moneda === x ? ' selected' : '') + '>' + x + '</option>';
        }).join('') + '</select>') +
      field('Meses del historial de ventas', '<input class="input" id="cPeriodo" type="number" min="1" step="1" value="' + esc(m.periodoMeses) + '">') +
      '</div>' +
      '<div class="hint">«Meses del historial» es el período que abarcan las ventas conocidas de cada artículo; se usa para el promedio mensual automático.</div>' +
      '<div class="form-actions"><button type="submit" class="btn btn--primary">Guardar cambios</button></div>' +
      '</form></div></div>';
    html += '<div class="card"><div class="card__head"><h2>Datos y respaldo</h2></div><div class="card__body">' +
      '<p class="muted" style="margin-bottom:14px;line-height:1.5;">Tus datos se guardan en este navegador. Descargá un respaldo periódicamente o pasalo a otra computadora.</p>' +
      '<div class="row" style="gap:10px;">' +
      btn('export', 'ghost', '<svg viewBox="0 0 24 24"><path d="M12 16 7 11l1.4-1.4L11 12.2V4h2v8.2l2.6-2.6L17 11l-5 5zm-7 2h14v2H5z"/></svg>', 'Descargar respaldo') +
      btn('import', 'ghost', '<svg viewBox="0 0 24 24"><path d="M12 4l5 5-1.4 1.4L13 7.8V16h-2V7.8L8.4 10.4 7 9l5-5zM5 18h14v2H5z"/></svg>', 'Importar respaldo') +
      '<input type="file" id="importFile" accept="application/json,.json" hidden>' +
      '</div>' +
      '<div style="height:1px;background:var(--line);margin:18px 0;"></div>' +
      '<div class="row" style="gap:10px;">' +
      btn('demo', 'ghost', '', 'Cargar catálogo de ejemplo') +
      btn('reset', 'danger', '', 'Borrar todo') +
      '</div></div></div>';
    html += '</div>';

    html += '<div class="card" style="margin-top:18px;"><div class="card__head"><h2>Integración Loekemeyer (envío del pedido)</h2></div><div class="card__body">' +
      '<div class="hint">El botón <strong>«Enviar a Loekemeyer»</strong> (en Stocks) crea un <strong>pedido normal</strong> en el sistema de Loekemeyer (igual que el catálogo mayorista): queda en tus pedidos y se envía a las planillas de Pedidos y de Entregas. La forma de pago es <strong>Contado (-25%)</strong> y la <strong>sucursal de entrega</strong> se elige arriba, en la pantalla de Stocks. Para enviar tenés que estar logueado en la página principal como OSA.</div>' +
      '</div></div>';

    html += '<div class="card" style="margin-top:18px;"><div class="card__head"><h2>¿Cómo funciona?</h2></div><div class="card__body">' +
      '<ol style="margin:0;padding-left:20px;line-height:1.9;color:var(--muted);">' +
      '<li><strong style="color:var(--text)">Stocks</strong>: ves el stock de hoy, el máximo y el pedido sugerido de cada artículo.</li>' +
      '<li><strong style="color:var(--text)">Movimientos</strong>: inicial + entregas de Loeke − ventas de OSA = stock hoy. Tocá un artículo para ver su saldo.</li>' +
      '<li><strong style="color:var(--text)">Punto de pedido</strong>: el máximo objetivo por artículo (en cajas). El pedido sugerido es máximo − stock.</li>' +
      '<li><strong style="color:var(--text)">Entregas Loeke</strong> y <strong style="color:var(--text)">Ventas OSA</strong>: cargás el movimiento y el stock se actualiza solo.</li>' +
      '</ol></div></div>';

    html += '<p class="muted text-c" style="margin-top:20px;font-size:12px;">StockRotativo · versión ' + APP_VERSION + '</p>';
    return html;
  }
  afterRender.config = function () {
    $('#cfgForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var meses = Math.max(1, Math.round(parseFloat($('#cPeriodo').value) || 17));
      S.setMeta({ empresa: $('#cEmpresa').value, cliente: $('#cCliente').value, moneda: $('#cMoneda').value, periodoMeses: meses });
      toast('Configuración guardada', 'ok'); updateBrand(); render();
    });
    bindAction('export', exportar);
    bindAction('import', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', importar);
    bindAction('reset', function () {
      confirmar('Borrar todo', 'Se eliminarán TODOS los artículos y movimientos de OSA en Supabase y se vuelve a sembrar el catálogo. ¿Seguro?', async function () {
        toast('Borrando…', 'info');
        await S.resetAll(); toast('Datos reiniciados', 'ok'); location.hash = '#/stocks'; setView('stocks');
      });
    });
  };
  function exportar() {
    var blob = new Blob([S.exportData()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'stockrotativo-respaldo-' + S.hoyISO() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('Respaldo descargado', 'ok');
  }
  function importar(e) {
    var file = e.target.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = async function () {
      try { toast('Importando…', 'info'); await S.importData(reader.result); toast('Respaldo importado', 'ok'); updateBrand(); render(); }
      catch (err) { toast('El archivo no es válido o no se pudo importar', 'danger'); }
    };
    reader.readAsText(file);
  }
  function cargarDemo() {
    confirmar('Cargar ejemplo', 'Vuelve a sembrar el catálogo de ejemplo (Loekemeyer · OSA) en Supabase. No borra los movimientos. ¿Continuar?', async function () {
      toast('Cargando…', 'info');
      await S.loadDemo(); toast('Catálogo de ejemplo cargado', 'ok'); updateBrand(); location.hash = '#/stocks'; setView('stocks');
    });
  }

  /* ============================================================
     Helpers compartidos
     ============================================================ */
  function field(label, control, full) {
    return '<div class="field' + (full ? ' field--full' : '') + '"><label class="label">' + label + '</label>' + control + '</div>';
  }
  function bindAction(action, fn) {
    $$('[data-action="' + action + '"]').forEach(function (b) { b.addEventListener('click', fn); });
  }
  function confirmar(titulo, mensaje, onYes) {
    var body = '<p style="line-height:1.55;color:var(--muted);margin-bottom:20px;">' + esc(mensaje) + '</p>' +
      '<div class="form-actions"><button class="btn btn--ghost" data-close>Cancelar</button>' +
      '<button class="btn btn--primary" id="confirmYes">Confirmar</button></div>';
    openModal(titulo, body);
    $('#confirmYes').addEventListener('click', function () { closeModal(); onYes(); });
  }
  // Compresión de imagen en el navegador (redimensiona a máx 760px y exporta JPEG)
  function comprimirImagen(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 760;
        var w = img.width, h = img.height;
        if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
        else if (h > max) { w = Math.round(w * max / h); h = max; }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        try { cb(canvas.toDataURL('image/jpeg', 0.8)); }
        catch (e) { cb(reader.result); }
      };
      img.onerror = function () { cb(reader.result); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /* ---------- Delegación global para acciones de topbar / vacíos ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-action]');
    if (!t) return;
    var act = t.getAttribute('data-action');
    if (act === 'nuevo-art') openArticulo(null);
    else if (act === 'print-sugerido') imprimirSugerido();
    else if (act === 'enviar-loeke') enviarLoeke();
    else if (act === 'guardar-punto') guardarPunto();
    else if (act === 'nuevo-ajuste') openAjuste();
    else if (act === 'importar-ventas') openImportVentas(t.getAttribute('data-quincena') || null);
    else if (act === 'importar-entregas') openImportEntregas();
    else if (act === 'ir-cargas') setView('cargas');
    else if (act === 'toggle-unit') {
      S.setUnidadVista(unidadVista() === 'unidades' ? 'cajas' : 'unidades');
      render();
    }
    else if (act === 'set-sucursal') { S.setMeta({ sucursalLK: t.getAttribute('data-suc') }); render(); }
    else if (act === 'demo') cargarDemo();
  });

  /* ---------- Init ---------- */
  // Pantalla de carga / login mientras se resuelve la sesión y se trae todo.
  function pantalla(titulo, msg, btnHtml) {
    $('#viewTitle').textContent = titulo;
    $('#viewSubtitle').textContent = '';
    viewEl.innerHTML =
      '<div class="card"><div class="card__body"><div class="empty">' +
      '<div class="empty__ic">' + iconBox() + '</div>' +
      '<h3>' + esc(titulo) + '</h3><p>' + esc(msg) + '</p>' +
      (btnHtml ? '<div class="row" style="justify-content:center;">' + btnHtml + '</div>' : '') +
      '</div></div></div>';
  }

  async function init() {
    var vEl = $('#appVersion');
    if (vEl) vEl.textContent = 'v' + APP_VERSION;
    window.addEventListener('resize', medirTopbar);
    // Aviso si falla una escritura a Supabase (con throttle).
    var ultErr = 0;
    S.setSaveErrorHandler(function () {
      var ahora = Date.now();
      if (ahora - ultErr < 3000) return;
      ultErr = ahora;
      toast('No se pudo guardar en Supabase. Revisá tu conexión / sesión.', 'danger');
    });

    try {
      await S.init(); // hidrata el estado (requiere sesión OSA); carga en silencio
    } catch (e) {
      if (e && e.message === 'no-session') {
        pantalla('Iniciá sesión',
          'El Formato OSA trabaja con tu cuenta de Loekemeyer. Ingresá en la página principal y volvé a entrar.',
          '<a class="btn btn--primary" href="../mayorista.html">Ir a iniciar sesión</a>');
      } else {
        pantalla('No se pudo cargar',
          'Hubo un problema trayendo los datos: ' + ((e && e.message) || e) + '. Reintentá recargando.',
          '<button class="btn btn--primary" onclick="location.reload()">Reintentar</button>');
      }
      return;
    }
    updateBrand();
    var v = (location.hash || '').replace('#/', '');
    setView(v || 'stocks');
  }
  init();
})();
