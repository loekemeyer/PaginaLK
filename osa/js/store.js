/* ============================================================
   StockRotativo · Capa de datos y lógica de negocio
   Persistencia local (localStorage) con respaldo exportable.
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'stockrotativo.v1';
  // Versión del catálogo/seed precargado. Al subirla, el catálogo nuevo se
  // fusiona (merge) en los navegadores existentes: actualiza nombres, totales y
  // máximos y agrega artículos nuevos, SIN borrar movimientos, pedidos ni el
  // stock real ya cargado (ver mergeSeed).
  var SEED_VERSION = 12;
  // Versión del "stock inicial" precargado (columna Existencia). Al subirla, el
  // stock inicial real se reaplica una vez aunque ya haya movimientos (corrección
  // de baseline). Después vuelve a protegerse. Ver mergeSeed.
  var STOCK_BASELINE = 1;
  // Versión de la Uni×Caja autoritativa (sheet "Cotizador Loekemeyer"). Al subirla,
  // la Uni×Caja del seed se reaplica una vez a todos los artículos (corrige valores
  // viejos), y después se respeta la que cargue un import. Ver mergeSeed.
  var UXC_BASELINE = 1;
  // Artículos duplicados (mismo producto con código base y +E) que deben quedar
  // como uno solo: [idDuplicado, idCanónico]. Al fusionar se mueven los
  // movimientos y se suma el stock inicial al canónico. Ver mergeSeed.
  var FUSIONAR = [['a_580', 'a_580E'], ['a_525', 'a_525E']];
  // Artículos discontinuados: se quitan del catálogo y de los datos del usuario.
  var DISCONTINUADOS = ['388E'];
  // Handler opcional que registra la capa de UI para avisar si falla un guardado
  // (p. ej. localStorage lleno). Ver setSaveErrorHandler.
  var onSaveError = null;

  /* ---------- Estado base ---------- */
  function blank() {
    return {
      meta: {
        empresa: 'Mi Empresa',
        cliente: '',
        moneda: 'ARS',
        periodoMeses: 17,       // meses que abarca el total de ventas conocidas (base del promedio mensual)
        mesesPedidoDefault: 2,  // meses de cobertura deseados por defecto (punto de pedido = promedio x meses)
        unidadVista: 'cajas',   // unidad para MOSTRAR cantidades: 'cajas' | 'unidades' (solo display)
        appsScriptUrl: '',      // URL .../exec del Apps Script que escribe en el Sheet "Pedidos LK"
        sucursalLK: 'Zuviria 5352- Villa Lugano', // sucursal de entrega default del pedido a Loekemeyer
        creado: Date.now()
      },
      // Artículo: promedioManual y mesesPedido son overrides opcionales (null = usar el automático/global).
      // stockMaximo (unidades) = nivel objetivo; pedido sugerido = stockMaximo − stock. null = sin máximo (no repone).
      articulos: [], // {id,codigo,nombre,descripcion,foto,precio,stockInicial,totalHistorico,uxc,stockMaximo,promedioManual,mesesPedido,activo}
      movimientos: [], // {id,articuloId,tipo,cantidad,fecha,nota}
      pedidos: [] // {id,fecha,estado,nota,items:[{articuloId,codigo,nombre,cantidad}]}
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return seedReal(); // primera vez: catálogo real precargado
      var p = JSON.parse(raw);
      var base = blank();
      base.meta = Object.assign(base.meta, p.meta || {});
      base.articulos = Array.isArray(p.articulos) ? p.articulos : [];
      base.movimientos = Array.isArray(p.movimientos) ? p.movimientos : [];
      base.pedidos = Array.isArray(p.pedidos) ? p.pedidos : [];
      return base;
    } catch (e) {
      console.error('No se pudo leer el almacenamiento:', e);
      return blank();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('No se pudo guardar:', e);
      if (typeof onSaveError === 'function') {
        try { onSaveError(e); } catch (_) {}
      }
      return false;
    }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function num(v, def) {
    var n = parseFloat(v);
    if (isNaN(n)) return def === undefined ? 0 : def;
    return n;
  }
  // Override opcional: '' / null / no-numérico => null (usar el valor automático/global).
  function optNum(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = parseFloat(v);
    if (isNaN(n)) return null;
    return Math.max(0, n);
  }

  /* ---------- Meta ---------- */
  function getMeta() { return Object.assign({}, state.meta); }
  function setMeta(patch) { state.meta = Object.assign(state.meta, patch); save(); }

  /* ---------- Unidades de visualización (cajas / unidades) ---------- */
  // El stock se guarda siempre en UNIDADES (canónico: el stock inicial, las
  // entregas y las ventas vienen en unidades). Esto solo cambia cómo se MUESTRA.
  function getUnidadVista() { return state.meta.unidadVista === 'unidades' ? 'unidades' : 'cajas'; }
  function setUnidadVista(v) {
    state.meta.unidadVista = (v === 'unidades') ? 'unidades' : 'cajas';
    save(); return state.meta.unidadVista;
  }
  // Unidades por caja de un artículo (id u objeto). 1 si no se conoce.
  function uxcDe(idOrArt) {
    var a = (idOrArt && typeof idOrArt === 'object') ? idOrArt : getArticulo(idOrArt);
    var u = a && a.uxc;
    return (u && u > 0) ? u : 1;
  }
  // Convierte una cantidad canónica (UNIDADES) a la unidad de vista activa.
  function enVista(unidades, idOrArt) {
    return getUnidadVista() === 'cajas'
      ? Math.round((unidades || 0) / uxcDe(idOrArt))
      : Math.round(unidades || 0);
  }
  // Actualiza las Uni×Caja de varios artículos desde un import en cajas. Devuelve cuántas cambió.
  function actualizarUxcDesde(map) {
    var idx = idxCatalogo(), n = 0;
    Object.keys(map || {}).forEach(function (code) {
      var a = matchCodigo(code, idx), u = Math.round(map[code]);
      if (a && u > 0 && a.uxc !== u) { a.uxc = u; n++; }
    });
    if (n) save();
    return n;
  }

  /* ---------- Artículos ---------- */
  function getArticulos(opts) {
    opts = opts || {};
    var list = state.articulos.slice();
    if (opts.soloActivos) list = list.filter(function (a) { return a.activo !== false; });
    list.sort(function (a, b) { return (a.nombre || '').localeCompare(b.nombre || '', 'es'); });
    return list;
  }
  function getArticulo(id) {
    for (var i = 0; i < state.articulos.length; i++) {
      if (state.articulos[i].id === id) return state.articulos[i];
    }
    return null;
  }
  function addArticulo(data) {
    var a = {
      id: uid(),
      codigo: (data.codigo || '').trim(),
      nombre: (data.nombre || '').trim() || 'Sin nombre',
      descripcion: (data.descripcion || '').trim(),
      foto: data.foto || '',
      precio: num(data.precio, 0),
      stockInicial: Math.max(0, Math.round(num(data.stockInicial, 0))),
      totalHistorico: Math.max(0, Math.round(num(data.totalHistorico, 0))),
      uxc: Math.max(1, Math.round(num(data.uxc, 1))),
      stockMaximo: optNum(data.stockMaximo),        // nivel objetivo (unidades); null = sin máximo
      promedioManual: optNum(data.promedioManual), // override del promedio mensual (null = automático)
      mesesPedido: optNum(data.mesesPedido),        // override de meses de cobertura (null = global)
      activo: data.activo !== false
    };
    state.articulos.push(a);
    save();
    return a;
  }
  function updateArticulo(id, data) {
    var a = getArticulo(id);
    if (!a) return null;
    if (data.codigo !== undefined) a.codigo = (data.codigo || '').trim();
    if (data.nombre !== undefined) a.nombre = (data.nombre || '').trim() || 'Sin nombre';
    if (data.descripcion !== undefined) a.descripcion = (data.descripcion || '').trim();
    if (data.foto !== undefined) a.foto = data.foto;
    if (data.precio !== undefined) a.precio = num(data.precio, 0);
    if (data.stockInicial !== undefined) a.stockInicial = Math.max(0, Math.round(num(data.stockInicial, 0)));
    if (data.totalHistorico !== undefined) a.totalHistorico = Math.max(0, Math.round(num(data.totalHistorico, 0)));
    if (data.uxc !== undefined) a.uxc = Math.max(1, Math.round(num(data.uxc, 1)));
    if (data.stockMaximo !== undefined) a.stockMaximo = optNum(data.stockMaximo);
    if (data.promedioManual !== undefined) a.promedioManual = optNum(data.promedioManual);
    if (data.mesesPedido !== undefined) a.mesesPedido = optNum(data.mesesPedido);
    if (data.activo !== undefined) a.activo = !!data.activo;
    save();
    return a;
  }
  function removeArticulo(id) {
    state.articulos = state.articulos.filter(function (a) { return a.id !== id; });
    state.movimientos = state.movimientos.filter(function (m) { return m.articuloId !== id; });
    save();
  }

  /* ---------- Movimientos ---------- */
  // tipo: 'entrega' (suma) | 'venta' (resta) | 'ajuste' (suma, puede ser negativo)
  function addMovimiento(m) {
    var mov = {
      id: uid(),
      articuloId: m.articuloId,
      tipo: m.tipo,
      cantidad: Math.round(num(m.cantidad, 0)),
      fecha: m.fecha || hoyISO(),
      nota: (m.nota || '').trim(),
      quincena: m.quincena || null   // ventas: quincena (1–15 / 16–fin) a la que pertenece la carga
    };
    state.movimientos.push(mov);
    save();
    return mov;
  }
  function addMovimientosBatch(arr) {
    var creados = [];
    for (var i = 0; i < arr.length; i++) {
      var c = Math.round(num(arr[i].cantidad, 0));
      if (c === 0) continue;
      var mov = {
        id: uid(),
        articuloId: arr[i].articuloId,
        tipo: arr[i].tipo,
        cantidad: c,
        fecha: arr[i].fecha || hoyISO(),
        nota: (arr[i].nota || '').trim(),
        quincena: arr[i].quincena || null
      };
      state.movimientos.push(mov);
      creados.push(mov);
    }
    if (creados.length) save(); // un solo guardado para todo el lote
    return creados;
  }
  function getMovimientos(filter) {
    filter = filter || {};
    var list = state.movimientos.slice();
    if (filter.articuloId) list = list.filter(function (m) { return m.articuloId === filter.articuloId; });
    if (filter.tipo) list = list.filter(function (m) { return m.tipo === filter.tipo; });
    list.sort(function (a, b) {
      if (a.fecha === b.fecha) return b.id < a.id ? -1 : 1;
      return a.fecha < b.fecha ? 1 : -1;
    });
    return list;
  }
  function removeMovimiento(id) {
    state.movimientos = state.movimientos.filter(function (m) { return m.id !== id; });
    save();
  }

  /* ---------- Lógica de stock ---------- */
  function computeStocks() {
    var map = {};
    state.articulos.forEach(function (a) { map[a.id] = a.stockInicial || 0; });
    state.movimientos.forEach(function (m) {
      if (!(m.articuloId in map)) return;
      if (m.tipo === 'venta') map[m.articuloId] -= m.cantidad;
      else map[m.articuloId] += m.cantidad; // entrega o ajuste
    });
    return map;
  }
  function stockActual(id) {
    var s = computeStocks();
    return s[id] || 0;
  }
  function totales(id) {
    var t = { entregas: 0, ventas: 0, ajustes: 0 };
    state.movimientos.forEach(function (m) {
      if (m.articuloId !== id) return;
      if (m.tipo === 'entrega') t.entregas += m.cantidad;
      else if (m.tipo === 'venta') t.ventas += m.cantidad;
      else t.ajustes += m.cantidad;
    });
    return t;
  }
  /* ---------- Punto de pedido y reposición (Módulos 1 y 3) ----------
     Punto de pedido = stockMaximo: el nivel objetivo (en unidades) que OSA quiere
     tener de cada artículo. Pedido sugerido = punto de pedido − stock hoy (top-up,
     cuando da positivo). Sin máximo => no se repone.
     El promedio mensual (totalHistorico / periodoMeses) se conserva solo como
     referencia de consumo; ya no determina el punto de pedido. */
  function promedioMensualAuto(a) {
    return (a.totalHistorico || 0) / Math.max(1, state.meta.periodoMeses || 1);
  }
  function promedioMensual(a) {
    return (a.promedioManual != null) ? a.promedioManual : promedioMensualAuto(a);
  }
  function mesesPedido(a) {
    return (a.mesesPedido != null) ? a.mesesPedido : (state.meta.mesesPedidoDefault || 0);
  }
  // Punto de pedido = nivel objetivo de stock (stockMaximo, en unidades). Si el
  // artículo no tiene máximo definido, no se repone (0). El pedido sugerido hace
  // top-up hasta este nivel: sugerido = max(0, puntoPedido − stock).
  function puntoPedido(a) {
    return (a.stockMaximo != null) ? Math.max(0, Math.round(a.stockMaximo)) : 0;
  }
  // Pedido sugerido en UNIDADES, redondeado SIEMPRE a cajas cerradas: se compra
  // en cajas enteras, de modo que (cajas a pedir) × (Uni×Caja) = (unidades a pedir).
  // cajas a pedir = ceil(faltante / Uni×Caja); unidades = cajas × Uni×Caja.
  function sugerido(a, stock) {
    if (stock === undefined) stock = stockActual(a.id);
    var faltante = puntoPedido(a) - stock;
    if (faltante <= 0) return 0;
    var f = uxcDe(a);
    return Math.ceil(faltante / f) * f;
  }
  function necesitaPedido(a, stock) {
    return sugerido(a, stock) > 0;
  }
  // 'sin' (stock <= 0) | 'bajo' (por debajo del punto de pedido) | 'ok'
  function estado(a, stock) {
    if (stock === undefined) stock = stockActual(a.id);
    if (stock <= 0) return 'sin';
    if (stock < puntoPedido(a)) return 'bajo';
    return 'ok';
  }
  // Lista de reposición sugerida (artículos activos con sugerido > 0)
  function pedidoSugerido() {
    var stocks = computeStocks();
    return getArticulos({ soloActivos: true })
      .filter(function (a) { return necesitaPedido(a, stocks[a.id]); })
      .map(function (a) {
        return { articulo: a, stock: stocks[a.id], punto: puntoPedido(a), sugerido: sugerido(a, stocks[a.id]) };
      });
  }

  /* ---------- Movimientos con saldo corrido (Módulo 2) ----------
     Movimientos del artículo en orden cronológico, con el saldo resultante
     después de cada uno (arrancando del stock inicial). opts.desde / opts.hasta
     (ISO) filtran SOLO la ventana mostrada; el saldo se acumula desde el inicio. */
  function movimientosConSaldo(articuloId, opts) {
    opts = opts || {};
    var a = getArticulo(articuloId);
    var saldo = a ? (a.stockInicial || 0) : 0;
    var movs = state.movimientos
      .filter(function (m) { return m.articuloId === articuloId; })
      .sort(function (x, y) {
        if (x.fecha === y.fecha) return x.id < y.id ? -1 : 1;
        return x.fecha < y.fecha ? -1 : 1;
      });
    var out = [];
    movs.forEach(function (m) {
      saldo += (m.tipo === 'venta') ? -m.cantidad : m.cantidad;
      if (opts.desde && m.fecha < opts.desde) return;
      if (opts.hasta && m.fecha > opts.hasta) return;
      out.push({ mov: m, saldo: saldo });
    });
    return out;
  }

  /* ---------- Importación de Ventas OSA (Módulo 5) ----------
     Parser del informe "Ventas por artículo" (texto extraído de un PDF). Formato:
       Desde 5/06/26 hasta 30/06/26
       :L031   FILTRO P/CAFE LOEKEMEYER        12
       ...
                                               695     (total al pie)
     Los códigos del informe son "L" + código. El informe suele quitar la "E"
     final (L529 = 529E). Cruce: exacto y, si no, agregando "E". */
  function ddmmaaISO(s) {
    var p = (s || '').split('/');
    if (p.length !== 3) return null;
    var d = parseInt(p[0], 10), mo = parseInt(p[1], 10), y = parseInt(p[2], 10);
    if (isNaN(d) || isNaN(mo) || isNaN(y)) return null;
    if (y < 100) y += 2000;
    return y + '-' + pad(mo) + '-' + pad(d);
  }
  // Índice del catálogo por código (mayúsculas).
  function idxCatalogo() {
    var idx = {};
    state.articulos.forEach(function (a) { if (a.codigo) idx[String(a.codigo).toUpperCase()] = a; });
    return idx;
  }
  // Cruce de código tolerante: exacto, con "E" agregada (OSA quita la E: L529=529E)
  // y con la "E" quitada (Loeke usa 946E donde el catálogo tiene 946).
  function matchCodigo(c, idx) {
    c = String(c).toUpperCase();
    return idx[c] || idx[c + 'E'] || idx[c.replace(/E$/, '')] || null;
  }
  // Celda de fecha de Excel: Date, número de serie (1900) o texto -> ISO.
  function celdaAFecha(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
    if (typeof v === 'number') {
      var d = new Date(Math.round((v - 25569) * 86400000));
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
    var s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return ddmmaaISO(s);
  }
  function parseReporteVentas(text) {
    text = String(text || '');
    var lines = text.split(/\r?\n/);
    var idx = idxCatalogo();

    var periodo = { desde: null, hasta: null };
    var mp = text.match(/Desde\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+hasta\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if (mp) { periodo.desde = ddmmaaISO(mp[1]); periodo.hasta = ddmmaaISO(mp[2]); }

    var filas = [], totalParseado = 0, totalInforme = null, noEncontrados = [], matchCount = 0;
    lines.forEach(function (ln) {
      var line = ln.trim();
      if (!line) return;
      var ft = line.match(/^(\d{1,7})$/);     // total al pie: línea con solo un número
      if (ft) { totalInforme = parseInt(ft[1], 10); return; }
      var m = line.match(/^:?\s*L\s*([0-9A-Za-z]+)\b(.*)$/); // fila: (:)L + código + ...
      if (!m) return;
      var codigoReporte = m[1].toUpperCase();
      var rest = (m[2] || '').trim();
      var vm = rest.match(/(\d+)\s*$/);        // las ventas son el número al final
      var ventas = vm ? parseInt(vm[1], 10) : 0;
      var desc = vm ? rest.slice(0, vm.index).trim() : rest;
      var art = matchCodigo(codigoReporte, idx);
      if (art) matchCount++; else noEncontrados.push(codigoReporte);
      totalParseado += ventas;
      filas.push({
        codigoReporte: codigoReporte, desc: desc, ventas: ventas,
        articuloId: art ? art.id : null, codigo: art ? art.codigo : null, nombre: art ? art.nombre : null
      });
    });
    return {
      periodo: periodo, filas: filas, totalParseado: totalParseado,
      totalInforme: totalInforme, noEncontrados: noEncontrados, matchCount: matchCount
    };
  }

  /* ---------- Importación de Entregas Loeke (Módulo 4) ----------
     Recibe las filas (array 2D) de un Excel de detalle de facturación (Loeke a
     OSA). Detecta la columna de "Cód. Artículo" (la que más cruza con el
     catálogo); a su derecha van Cantidad (I), Precio (J) y Total (K).

     El reporte puede venir en UNIDADES o en CAJAS. Detección por fila:
       - en unidades: I × J = K  (cantidad × precio unitario = importe)
       - en cajas:    I × J ≠ K, y K ÷ (I×J) = unidades por caja (uxc)
     El stock se guarda siempre en CAJAS (canónico):
       - archivo en cajas    -> la cantidad ya está en cajas; además se actualiza la uxc
       - archivo en unidades -> cajas = unidades ÷ uxc (uxc del catálogo) */
  function parseEntregas(rows) {
    rows = rows || [];
    var idx = idxCatalogo();
    var ncols = 0;
    rows.forEach(function (r) { if (r && r.length > ncols) ncols = r.length; });
    // Columna de código = la que más celdas cruza con el catálogo.
    var codCol = 0, best = -1;
    for (var c = 0; c < ncols; c++) {
      var cnt = 0;
      rows.forEach(function (r) {
        var v = (r && r[c] != null) ? String(r[c]).trim() : '';
        if (/^\d{2,4}[A-Za-z]?$/.test(v) && matchCodigo(v, idx)) cnt++;
      });
      if (cnt > best) { best = cnt; codCol = c; }
    }
    var cantCol = codCol + 3, precCol = codCol + 4, totCol = codCol + 5;
    function esFila(r) { return r && /^\d{2,4}[A-Za-z]?$/.test(String(r[codCol] != null ? r[codCol] : '').trim()); }

    // Detección de formato: ¿I×J coincide con K en la mayoría de las filas?
    var ratios = [];
    rows.forEach(function (r) {
      if (!esFila(r)) return;
      var I = num(r[cantCol]), J = num(r[precCol]), K = num(r[totCol]);
      if (I > 0 && J > 0 && K > 0) ratios.push(K / (I * J));
    });
    var enUni = ratios.filter(function (x) { return Math.abs(x - 1) < 0.02; }).length;
    var formato = (ratios.length && enUni >= ratios.length / 2) ? 'unidades' : 'cajas';

    var filas = [], totalCajas = 0, totalUnidades = 0, fechas = {}, noEncontrados = [], matchCount = 0, uxcDerivado = {};
    rows.forEach(function (r) {
      if (!esFila(r)) return;
      var codRaw = String(r[codCol]).trim();
      var cantOrig = Math.round(num(r[cantCol], 0));
      if (cantOrig <= 0) return;
      var I = num(r[cantCol]), J = num(r[precCol]), K = num(r[totCol]);
      var uxcFila = (I > 0 && J > 0 && K > 0) ? Math.round(K / (I * J)) : null;
      var fecha = celdaAFecha(r[0]);
      var art = matchCodigo(codRaw, idx);
      if (art) matchCount++; else noEncontrados.push(codRaw);
      if (formato === 'cajas' && uxcFila && uxcFila > 1) uxcDerivado[codRaw] = uxcFila;

      var u = (uxcFila && uxcFila > 1) ? uxcFila : (art ? uxcDe(art) : 1);
      var unidades, cajas;
      if (formato === 'cajas') {                 // viene en cajas -> a unidades (canónico)
        unidades = cantOrig * u;
        cajas = cantOrig;
      } else {                                   // ya viene en unidades (canónico)
        unidades = cantOrig;
        cajas = u > 1 ? Math.round(cantOrig / u) : cantOrig;
      }
      if (fecha) fechas[fecha] = true;
      totalUnidades += unidades;
      totalCajas += cajas;
      filas.push({
        codigo: codRaw, unidades: unidades, cajas: cajas,
        cantidadOriginal: cantOrig, uxc: u, fecha: fecha,
        descripcion: (r[codCol + 1] != null ? String(r[codCol + 1]).trim() : ''),
        articuloId: art ? art.id : null, nombre: art ? art.nombre : null
      });
    });
    return {
      formato: formato, filas: filas, totalCajas: totalCajas, totalUnidades: totalUnidades,
      fechas: Object.keys(fechas).sort(), noEncontrados: noEncontrados,
      matchCount: matchCount, uxcDerivado: uxcDerivado
    };
  }

  /* ---------- Quincenas de ventas (control de cargas) ----------
     Cada mes tiene 2 quincenas: 1ª = días 1–15, 2ª = 16–fin de mes. Las ventas de
     OSA se cargan por quincena; el módulo de control muestra cuáles están cargadas
     y cuáles pendientes. La clave es 'AAAA-MM-Q1'/'AAAA-MM-Q2' (ordena alfabéticamente). */
  var MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function ultimoDiaMes(anio, mes) { return new Date(anio, mes, 0).getDate(); } // mes 1–12
  function quincenaDe(iso) {
    if (!iso) return null;
    var p = String(iso).slice(0, 10).split('-');
    var anio = parseInt(p[0], 10), mes = parseInt(p[1], 10), dia = parseInt(p[2], 10);
    if (!anio || !mes || !dia) return null;
    var mitad = dia <= 15 ? 1 : 2;
    return {
      key: anio + '-' + pad(mes) + '-Q' + mitad,
      anio: anio, mes: mes, mitad: mitad,
      desde: anio + '-' + pad(mes) + '-' + (mitad === 1 ? '01' : '16'),
      hasta: anio + '-' + pad(mes) + '-' + pad(mitad === 1 ? 15 : ultimoDiaMes(anio, mes)),
      label: (mitad === 1 ? '1ª' : '2ª') + ' quincena de ' + MESES_ES[mes - 1] + ' ' + anio
    };
  }
  function quincenaSiguiente(q) {
    if (q.mitad === 1) return quincenaDe(q.anio + '-' + pad(q.mes) + '-16');
    var nm = q.mes === 12 ? 1 : q.mes + 1, na = q.mes === 12 ? q.anio + 1 : q.anio;
    return quincenaDe(na + '-' + pad(nm) + '-01');
  }
  // Lista de quincenas entre dos fechas (inclusive), ordenada.
  function listaQuincenas(desdeISO, hastaISO) {
    var a = quincenaDe(desdeISO), b = quincenaDe(hastaISO);
    if (!a || !b || a.key > b.key) return a && !b ? [a] : [];
    var out = [], cur = a, guard = 0;
    while (cur.key <= b.key && guard++ < 600) { out.push(cur); cur = quincenaSiguiente(cur); }
    return out;
  }
  // Ventas cargadas agrupadas por quincena: key -> {key, totalCajas, count, fechaCarga}.
  function cargasVentas() {
    var map = {};
    state.movimientos.forEach(function (m) {
      if (m.tipo !== 'venta') return;
      var k = m.quincena || ((quincenaDe(m.fecha) || {}).key);
      if (!k) return;
      if (!map[k]) map[k] = { key: k, totalCajas: 0, totalUnidades: 0, count: 0, fechaCarga: null };
      map[k].totalUnidades += m.cantidad;
      map[k].totalCajas += Math.round(m.cantidad / uxcDe(m.articuloId));
      map[k].count++;
      if (!map[k].fechaCarga || m.fecha > map[k].fechaCarga) map[k].fechaCarga = m.fecha;
    });
    return map;
  }
  function quincenaCargada(key) {
    var c = cargasVentas()[key];
    return (c && c.count > 0) ? c : null;
  }

  /* ---------- Pedidos ---------- */
  function crearPedido(items, nota) {
    var clean = items
      .map(function (it) {
        var a = getArticulo(it.articuloId);
        return {
          articuloId: it.articuloId,
          codigo: a ? a.codigo : '',
          nombre: a ? a.nombre : '(artículo)',
          cantidad: Math.round(num(it.cantidad, 0))
        };
      })
      .filter(function (it) { return it.cantidad > 0; });
    if (!clean.length) return null;
    var p = { id: uid(), fecha: hoyISO(), estado: 'pendiente', nota: (nota || '').trim(), items: clean };
    state.pedidos.unshift(p);
    save();
    return p;
  }
  function getPedidos() { return state.pedidos.slice(); }
  function getPedido(id) {
    for (var i = 0; i < state.pedidos.length; i++) if (state.pedidos[i].id === id) return state.pedidos[i];
    return null;
  }
  // Marcar entregado: genera movimientos de 'entrega' (repone stock en el cliente)
  function marcarPedidoEntregado(id) {
    var p = getPedido(id);
    if (!p || p.estado === 'entregado') return null;
    p.items.forEach(function (it) {
      if (getArticulo(it.articuloId)) {
        addMovimiento({
          articuloId: it.articuloId,
          tipo: 'entrega',
          cantidad: it.cantidad,
          fecha: hoyISO(),
          nota: 'Reposición pedido #' + p.id.slice(-5).toUpperCase()
        });
      }
    });
    p.estado = 'entregado';
    p.entregadoEl = hoyISO();
    save();
    return p;
  }
  function eliminarPedido(id) {
    state.pedidos = state.pedidos.filter(function (p) { return p.id !== id; });
    save();
  }

  /* ---------- Respaldo / datos ---------- */
  function exportData() { return JSON.stringify(state, null, 2); }
  function importData(json) {
    var p = typeof json === 'string' ? JSON.parse(json) : json;
    var base = blank();
    base.meta = Object.assign(base.meta, p.meta || {});
    base.articulos = Array.isArray(p.articulos) ? p.articulos : [];
    base.movimientos = Array.isArray(p.movimientos) ? p.movimientos : [];
    base.pedidos = Array.isArray(p.pedidos) ? p.pedidos : [];
    state = base;
    save();
  }
  function resetAll() { state = blank(); save(); }

  /* ---------- Catálogo real (Loekemeyer · cliente Osa Distribuidora SRL) ----------
     [codigo, nombre, ventasRanking]  ·  ordenado por total (mayor a menor).
     OJO: el ranking viene EN CAJAS (informe de ventas de OSA). En el seed se
     convierte a UNIDADES (× Uni×Caja) para que el promedio mensual quede en la
     unidad canónica. El total abarca ~periodoMeses meses (ver meta.periodoMeses). */
  var CATALOGO = [
    ['505', 'Pelador mango plástico', 6365],
    ['513', 'Pelador mango metálico', 4075],
    ['506', 'Abrelatas uña rojo', 3627],
    ['504', 'Afila cuchillos', 2190],
    ['501', 'Abrelatas a manija', 2184],
    ['502', 'Abrelatas mariposa cromado', 1404],
    ['546', 'Corta queso blandos mango Loeke', 760],
    ['031', 'Filtro de café 10cm', 745],
    ['544', 'Batidor pera alambre', 605],
    ['520', 'Sacacorcho tipo mozo cromado', 397],
    ['512', 'Abrelatas mariposa capuchón rojo', 390],
    ['523', 'Sacacorcho doble aleta', 380],
    ['529E', 'Sacacorcho doble impulso acero', 319],
    ['315', 'Pisa papas acero inox', 307],
    ['530', 'Sacacorcho tipo mozo color', 284],
    ['521', 'Sacacorcho combinado cromado', 278],
    ['519', 'Cuchillo untar mango madera x2', 266],
    ['508', 'Sacafuentes articulado', 246],
    ['579', 'Tapón de vino/cerveza x1 color', 239],
    ['507', 'Rompenueces', 212],
    ['587', 'Pelador metálico corte láser', 210],
    ['562', 'Corta pizza 6cm mango Loeke', 194],
    ['395', 'Descorazonador de manzana', 193],
    ['577', 'Tapón de vino/cerveza x1 premium', 179],
    ['559', 'Corta ravioles c/mango Loeke', 176],
    ['531', 'Sacacorcho combinado color', 166],
    ['057', 'Destapa corona x1 cromado', 160],
    ['518', 'Sacafuente pizzero', 159],
    ['575', 'Tapón de vino/cerveza x1 negro', 158],
    ['510', 'Abrelata uña cromado', 150],
    ['551', 'Cuchillo de untar mango plástico x2', 110],
    ['560', 'Pinza corta alambre 21cm', 106],
    ['589E', 'Pelador mango acrílico', 100],
    ['598E', 'Pelador negro dentado', 100],
    ['246', 'Prensa matambre', 81],
    ['511', 'Abrelatas uña 3 en 1', 80],
    ['564', 'Corta pizza 8cm mango madera', 78],
    ['525E', 'Sacacorcho cabo de madera', 130], // 525 y 525E son el mismo artículo (75 + 55)
    ['542', 'Ahueca papas', 69],
    ['580E', 'Batidor mini', 131], // 580 y 580E son el mismo artículo: se fusionan (68 + 63)
    ['280', 'Manga repostera + 4 boquillas', 60],
    ['811E', 'Corta pizza mango ergonómico Ø9cm', 50],
    ['543', 'Ahueca frutas', 42],
    ['935E', 'Espátula calada nylon mango madera', 40],
    ['538E', 'Sacacorcho azul', 40],
    ['509', 'Pala batidora', 38],
    ['515', 'Batidor resorte', 38],
    ['934E', 'Cuchara fideos nylon mango madera', 35],
    ['548', 'Pincel pastelero', 34],
    ['361E', 'Rallador 4 lados acero inox', 31],
    ['566E', 'Aceitera 100 ml', 30],
    ['937E', 'Batidor pera nylon mango madera', 30],
    ['583E', 'Especiero tapa bamboo', 30],
    ['396', 'Enrulador de manteca', 25],
    ['478E', 'Sacacorcho doble impulso', 25],
    ['570', 'Pala de canelones', 23],
    ['561', 'Pinza grande alambre', 22],
    ['596', 'Pinza de ensalada mango plástico 23cm', 22],
    ['229', 'Ñoquera madera', 20],
    ['581', 'Sacacorcho mango ergonómico', 20],
    ['931E', 'Espátula lisa nylon mango madera', 20],
    ['936E', 'Espumadera nylon mango madera', 20],
    ['932E', 'Cuchara nylon mango madera', 20],
    ['540E', 'Sacacorcho premium', 20],
    ['539E', 'Sacacorcho negro', 20],
    ['536E', 'Sacacorcho full black', 20],
    ['222', 'Bate bife madera', 16],
    ['595', 'Pinza de fiambre mango plástico 23cm', 16],
    ['948E', 'Espumadera acero inox', 16],
    ['325', 'Espátula repostera plástico 1 pza', 15],
    ['522E', 'Sacacorcho doble aleta premium', 15],
    ['943E', 'Cucharón acero inox', 15],
    ['574E', 'Artículo 574E', 15],
    ['585E', 'Sacacorcho doble aleta fundición', 15],
    ['809E', 'Corta pizza mango ergonómico 6cm', 15],
    ['569', 'Pelanaranjas x1 display', 14],
    ['554', 'Cucharita matera', 13],
    ['945E', 'Espátula calada acero inox', 11],
    ['563', 'Pinza hamburguesa', 10],
    ['586', 'Pelapapas mango ergonómico', 10],
    ['591', 'Despolvillador de yerba', 10],
    ['933E', 'Cucharón nylon mango madera', 10],
    ['941E', 'Espátula lisa acero inox', 10],
    ['942E', 'Cuchara acero inox', 10],
    ['944E', 'Cuchara fideos acero inox', 10],
    ['817E', 'Rallador c/mango ergonómico', 10],
    ['364E', 'Rallador gourmet grano medio', 10],
    ['328E', 'Rallador plano 3 usos acero inox', 8],
    ['360E', 'Rallador 4 lados a/l mango plástico', 6],
    ['594', 'Pinza de fideos mango plástico 25cm', 3],
    ['355', 'Pisa papas nylon con mango', 2],
    ['524', 'Sacacorcho de espumantes', 2],
    // Sin historial de ventas (no figuran en el ranking), pero OSA tiene stock
    // de ellos en el informe de Existencias: se agregan con total 0.
    ['517', 'Pinza gastronómica de acero', 0],
    ['946', 'Cuchara calada acero inoxidable', 0],
    // Productos nuevos del Cotizador Loekemeyer (con máximo objetivo, sin historial).
    ['816E', 'Pelador V mango ergonómico', 0],
    ['584E', 'Aceitera 400 ml', 0]
  ];

  // Stock inicial real del cliente (OSA) · informe "Existencias" del 23/06/26,
  // columna "Existencia" (stock físico). Total del informe: 30.388 cajas.
  // Códigos del informe = "L" + mi código (suele quitar la "E" final: L529 = 529E).
  // 525 y 580 se consolidan en su variante E. Lo que figura en blanco queda en 0.
  // 517 y 946 se agregaron al catálogo (no tenían historial de ventas).
  var STOCK_INICIAL = {
    '031': 2112, '222': 32, '315': 18, '395': 144, '396': 6, '478E': 13, '501': 1020,
    '502': 780, '504': 1343, '505': 6108, '506': 2268, '507': 24, '508': 100, '510': 1044,
    '511': 11, '512': 2, '513': 5364, '515': 48, '518': 474, '519': 1220, '520': 150,
    '521': 336, '522E': 4, '523': 218, '525E': 149, '529E': 88, '530': 252, '531': 360,
    '536E': 18, '540E': 17, '542': 185, '543': 84, '544': 677, '546': 660, '548': 23,
    '551': 2, '559': 96, '560': 4, '561': 4, '562': 276, '564': 9, '566E': 386, '569': 12,
    '570': 14, '574E': 60, '577': 3, '579': 19, '580E': 12, '583E': 16, '587': 491,
    '589E': 1627, '594': 20, '598E': 161, '931E': 240, '932E': 226, '933E': 108,
    '934E': 241, '935E': 239, '936E': 314, '937E': 144, '941E': 120, '942E': 45, '944E': 5,
    '948E': 10, '517': 12, '946': 120
  };

  // Unidades por caja (Uni×Caja) por código, derivadas del informe en cajas
  // (K ÷ (I×J)). Sirven para convertir entre cajas y unidades en la vista y para
  // normalizar imports en unidades. Se mantienen al vuelo con cada import en cajas.
  var UXC_SEED = {
    '031': 24, '246': 6, '280': 12, '315': 12, '355': 24, '395': 12, '396': 12,
    '501': 6, '502': 12, '504': 6, '505': 12, '506': 12, '507': 12, '508': 6,
    '509': 12, '510': 12, '513': 12, '515': 12, '518': 12, '519': 12, '520': 12,
    '521': 12, '523': 12, '525E': 24, '529E': 12, '530': 12, '531': 12, '542': 12,
    '543': 12, '544': 12, '546': 12, '548': 24, '551': 12, '559': 12, '562': 12,
    '564': 12, '566E': 6, '575': 12, '577': 12, '579': 12, '580E': 12, '583E': 15,
    '931E': 12, '932E': 12, '933E': 12, '934E': 12, '935E': 12, '936E': 12,
    '937E': 12, '941E': 12, '942E': 12, '945E': 12, '946E': 12, '948E': 12,
    // Uni×Caja según el Cotizador de Loekemeyer (las que faltaban; casi todas 12,
    // salvo 589E/325/570 = 24, corregidas con la fuente autoritativa).
    '512': 12, '587': 12, '057': 12, '560': 12, '589E': 24, '598E': 12, '511': 12,
    '811E': 12, '538E': 12, '361E': 12, '478E': 12, '570': 24, '561': 12, '596': 12,
    '229': 12, '581': 12, '540E': 12, '539E': 12, '536E': 12, '222': 12, '595': 12,
    '325': 24, '522E': 12, '943E': 12, '574E': 12, '585E': 12, '809E': 12, '569': 12,
    '554': 12, '563': 12, '586': 12, '591': 12, '944E': 12, '817E': 12, '364E': 12,
    '328E': 12, '360E': 12, '594': 12, '524': 12, '517': 12,
    // Productos nuevos del Cotizador (con máximo, sin historial).
    '816E': 12, '584E': 6
  };
  // uxc del catálogo: exacto, +E y -E (catálogo 946 <-> informe 946E). 1 si no se conoce.
  function uxcSeed(code) {
    code = String(code).toUpperCase();
    return UXC_SEED[code] || UXC_SEED[code + 'E'] || UXC_SEED[code.replace(/E$/, '')] || 1;
  }

  // Stock máximo objetivo por artículo, EN CAJAS (sheet "Cotizador Loekemeyer",
  // columna "Pedido en Cajas"). En el seed se convierte a unidades (× Uni×Caja).
  // Lo que no figura acá no tiene máximo => no se repone.
  var MAX_CAJAS = {
    '246': 1, '280': 10, '315': 15, '355': 5, '395': 10, '501': 20, '502': 20, '504': 30,
    '505': 100, '506': 50, '507': 5, '508': 20, '510': 10, '511': 5, '512': 20, '513': 50,
    '515': 10, '518': 10, '519': 10, '520': 10, '521': 10, '523': 15, '530': 10, '531': 10,
    '542': 10, '543': 10, '544': 20, '546': 30, '551': 10, '559': 15, '560': 5, '561': 5,
    '562': 15, '564': 15, '569': 4, '570': 3, '575': 20, '577': 20, '579': 20, '594': 5,
    '595': 5, '596': 5, '589E': 10, '598E': 10, '529E': 10, '538E': 10, '539E': 10,
    '540E': 10, '585E': 10, '525E': 10, '811E': 10, '057': 5, '942E': 10, '943E': 10,
    '944E': 10, '945E': 10, '948E': 10, '932E': 10, '933E': 10, '934E': 10, '935E': 10,
    '936E': 10, '937E': 10, '583E': 15, '031': 10, '580E': 10,
    '816E': 10, '584E': 20
  };

  // Construye el estado inicial con el catálogo real precargado.
  function seedReal() {
    var st = blank();
    st.meta.empresa = 'Loekemeyer';
    st.meta.cliente = 'Osa Distribuidora SRL';
    st.meta.moneda = 'ARS';
    st.meta.periodoMeses = 17;
    st.meta.mesesPedidoDefault = 2;
    st.meta.seedVersion = SEED_VERSION;
    st.meta.stockBaseline = STOCK_BASELINE;
    CATALOGO.forEach(function (row) {
      var codigo = row[0], nombre = row[1], totalCajas = row[2];
      var uxc = uxcSeed(codigo);    // unidades por caja (Uni×Caja)
      var maxCajas = MAX_CAJAS[codigo];
      st.articulos.push({
        id: 'a_' + codigo, codigo: codigo, nombre: nombre, descripcion: '',
        foto: placeholder(nombre), precio: 0,
        stockInicial: STOCK_INICIAL[codigo] || 0, // stock real del cliente EN UNIDADES (Existencia, informe 23/06/26)
        totalHistorico: totalCajas * uxc, // ventas conocidas EN UNIDADES (el ranking viene EN CAJAS → × Uni×Caja)
        uxc: uxc,                     // unidades por caja (para mostrar en cajas / normalizar imports)
        stockMaximo: (maxCajas != null) ? maxCajas * uxc : null, // nivel objetivo EN UNIDADES (máx. cajas × Uni×Caja)
        promedioManual: null,         // sin override: usa el promedio automático
        mesesPedido: null,            // sin override: usa meta.mesesPedidoDefault
        activo: true
      });
    });
    return st;
  }

  // Botón "Cargar datos de ejemplo" = restaurar el catálogo real.
  function loadDemo() { state = seedReal(); save(); }

  // Aplica un catálogo precargado nuevo SIN destruir los datos del usuario.
  // - Actualiza los campos "del catálogo" (nombre, total de ventas conocidas).
  // - Agrega los artículos nuevos que tenga el catálogo.
  // - Conserva siempre movimientos, pedidos y los campos que toca el usuario
  //   (descripción, foto, precio, activo y los overrides promedioManual/mesesPedido).
  // - El stock inicial solo se pisa si todavía no hay nada que proteger: ni stock
  //   real cargado (meta.datosReales) ni movimientos/pedidos registrados. Si ya
  //   hay historial, pisarlo descuadraría el saldo, así que se respeta.
  function mergeSeed() {
    var fresh = seedReal();
    var protegerInicial = !!state.meta.datosReales ||
      state.movimientos.length > 0 || state.pedidos.length > 0;
    // Si cambió el baseline de stock inicial, se reaplica una vez aunque haya
    // historial (corrección puntual del punto de partida).
    var baselineNuevo = (state.meta.stockBaseline || 0) < STOCK_BASELINE;
    var aplicarInicial = baselineNuevo || !protegerInicial;
    var uxcNuevo = (state.meta.uxcBaseline || 0) < UXC_BASELINE; // reaplica Uni×Caja autoritativa una vez
    var byCode = {};
    state.articulos.forEach(function (a) { if (a.codigo) byCode[a.codigo] = a; });
    fresh.articulos.forEach(function (na) {
      var ex = na.codigo ? byCode[na.codigo] : null;
      if (!ex) { state.articulos.push(na); return; } // artículo nuevo del catálogo
      ex.nombre = na.nombre;
      ex.totalHistorico = na.totalHistorico;
      // Uni×Caja autoritativa (Cotizador Loekemeyer): al subir UXC_BASELINE se reaplica
      // una vez a todos; si no, solo se setea cuando falta o está en el default 1.
      // Después se respeta la que cargue un import.
      if (uxcNuevo && na.uxc > 0) ex.uxc = na.uxc;
      else if (!ex.uxc || (ex.uxc === 1 && na.uxc > 1)) ex.uxc = na.uxc;
      // Stock máximo objetivo: se aplica el del seed solo la primera vez (cuando el
      // artículo todavía no tiene el campo). Después se respeta lo que edite el usuario.
      if (ex.stockMaximo === undefined) ex.stockMaximo = na.stockMaximo;
      if (ex.promedioManual === undefined) ex.promedioManual = null;
      if (ex.mesesPedido === undefined) ex.mesesPedido = null;
      if (aplicarInicial) ex.stockInicial = na.stockInicial;
    });
    state.meta.stockBaseline = STOCK_BASELINE;
    state.meta.uxcBaseline = UXC_BASELINE;
    // Fusionar duplicados (ej. a_580 → a_580E): mover movimientos, sumar stock
    // inicial al canónico y eliminar el duplicado.
    FUSIONAR.forEach(function (par) {
      var from = getArticulo(par[0]), to = getArticulo(par[1]);
      if (!from || !to) return;
      state.movimientos.forEach(function (m) { if (m.articuloId === from.id) m.articuloId = to.id; });
      to.stockInicial = (to.stockInicial || 0) + (from.stockInicial || 0);
      state.articulos = state.articulos.filter(function (a) { return a.id !== from.id; });
    });
    // Artículos discontinuados: quitar el artículo y limpiar sus movimientos y
    // los renglones de pedidos que lo referencian.
    DISCONTINUADOS.forEach(function (code) {
      var ids = state.articulos.filter(function (a) { return a.codigo === code; })
        .map(function (a) { return a.id; });
      if (!ids.length) return;
      var borrado = function (ref) { return ids.indexOf(ref) >= 0; };
      state.movimientos = state.movimientos.filter(function (m) { return !borrado(m.articuloId); });
      state.pedidos.forEach(function (p) {
        if (p.items) p.items = p.items.filter(function (it) { return !borrado(it.articuloId); });
      });
      state.articulos = state.articulos.filter(function (a) { return a.codigo !== code; });
    });
    if (state.meta.mesesPedidoDefault === undefined) state.meta.mesesPedidoDefault = 2;
    state.meta.seedVersion = SEED_VERSION;
    save();
  }

  /* ---------- Utilidades ---------- */
  function hoyISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  // Imagen placeholder (SVG data-uri) con iniciales y color por nombre
  function placeholder(nombre, color) {
    var palette = ['#6366f1', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6'];
    nombre = nombre || '?';
    var initials = nombre.split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase();
    var c = color;
    if (!c) {
      var h = 0;
      for (var i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) % palette.length;
      c = palette[h];
    }
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + c + '"/>' +
      '<stop offset="1" stop-color="' + shade(c, -28) + '"/></linearGradient></defs>' +
      '<rect width="400" height="260" fill="url(#g)"/>' +
      '<text x="200" y="148" font-family="Inter,Arial,sans-serif" font-size="92" font-weight="800" ' +
      'fill="#ffffff" fill-opacity="0.92" text-anchor="middle">' + initials + '</text></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }
  function shade(hex, amt) {
    var c = hex.replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    var r = clamp(parseInt(c.slice(0, 2), 16) + amt);
    var g = clamp(parseInt(c.slice(2, 4), 16) + amt);
    var b = clamp(parseInt(c.slice(4, 6), 16) + amt);
    return '#' + hx(r) + hx(g) + hx(b);
  }
  function clamp(v) { return Math.max(0, Math.min(255, v)); }
  function hx(v) { var s = v.toString(16); return s.length === 1 ? '0' + s : s; }

  // Inicializa el estado (luego de definir catálogo, ventas y seed)
  var state = load();
  // Migración por versión de seed: si el catálogo precargado cambió, se fusiona
  // de forma NO destructiva (ver mergeSeed). Nunca borra movimientos, pedidos ni
  // el stock real ya cargado.
  (function ensureSeed() {
    if (state.meta.seedVersion === SEED_VERSION) return;
    mergeSeed();
  })();

  /* ---------- API pública ---------- */
  window.Store = {
    getMeta: getMeta, setMeta: setMeta,
    getUnidadVista: getUnidadVista, setUnidadVista: setUnidadVista,
    uxcDe: uxcDe, enVista: enVista, actualizarUxcDesde: actualizarUxcDesde,
    getArticulos: getArticulos, getArticulo: getArticulo,
    addArticulo: addArticulo, updateArticulo: updateArticulo, removeArticulo: removeArticulo,
    addMovimiento: addMovimiento, addMovimientosBatch: addMovimientosBatch,
    getMovimientos: getMovimientos, removeMovimiento: removeMovimiento,
    computeStocks: computeStocks, stockActual: stockActual, totales: totales,
    movimientosConSaldo: movimientosConSaldo,
    parseReporteVentas: parseReporteVentas, parseEntregas: parseEntregas,
    quincenaDe: quincenaDe, listaQuincenas: listaQuincenas,
    cargasVentas: cargasVentas, quincenaCargada: quincenaCargada,
    estado: estado, sugerido: sugerido, necesitaPedido: necesitaPedido, pedidoSugerido: pedidoSugerido,
    promedioMensual: promedioMensual, promedioMensualAuto: promedioMensualAuto,
    mesesPedido: mesesPedido, puntoPedido: puntoPedido,
    crearPedido: crearPedido, getPedidos: getPedidos, getPedido: getPedido,
    marcarPedidoEntregado: marcarPedidoEntregado, eliminarPedido: eliminarPedido,
    exportData: exportData, importData: importData, resetAll: resetAll, loadDemo: loadDemo,
    setSaveErrorHandler: function (fn) { onSaveError = fn; },
    placeholder: placeholder, hoyISO: hoyISO
  };
})();
