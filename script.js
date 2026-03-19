// ================= SUPABASE =================
const SUPABASE_URL = "https://kwkclwhmoygunqmlegrg.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3a2Nsd2htb3lndW5xbWxlZ3JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MjA2NzUsImV4cCI6MjA4NTA5NjY3NX0.soqPY5hfA3RkAJ9jmIms8UtEGUc4WpZztpEbmDijOgU";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ================= IMÁGENES =================
const BASE_IMG = `${SUPABASE_URL}/storage/v1/object/public/products-images/`;
const IMG_VERSION = "1";

function imgUrlByCod(cod) {
  const c = String(cod || "").trim();
  if (!c) return "img/no-image.jpg";
  return `${BASE_IMG}${encodeURIComponent(c)}.jpg?v=${encodeURIComponent(IMG_VERSION)}`;
}

// helpers
const $ = (id) => document.getElementById(id);
const statusBox = $("status");
const tabla = $("tabla");
const thead = $("thead");
const tbody = $("tbody");

function setStatus(msg) {
  statusBox.style.display = "block";
  statusBox.innerText = msg;
  tabla.style.display = "none";
}

async function getSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) {
    console.error("getSession error:", error);
    setStatus("Error de sesión.");
    return null;
  }

  if (!data?.session) {
    setStatus("No hay sesión iniciada. Volviendo a Mayorista…");
    setTimeout(() => (location.href = "./mayorista.html"), 800);
    return null;
  }

  return data.session;
}

async function getCliente(session) {
  const { data, error } = await sb
    .from("customers")
    .select("cod_cliente, business_name")
    .eq("auth_user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("getCliente error:", error);
    setStatus("No se pudo cargar el cliente (RLS o datos).");
    return null;
  }
  if (!data) {
    setStatus(
      "No se encontró tu cliente asociado. (falta vincular auth_user_id)",
    );
    return null;
  }
  return data;
}

/**
 * IMPORTANTE:
 * Esta vista debe existir:
 *   public.v_customer_item_month
 * con columnas: customer_code, ym (YYYY-MM), item_code, description, boxes
 *
 * FIX CLAVE:
 * Filtramos por customer_code acá para evitar que una view que NO respeta RLS
 * mezcle clientes y te infle totales.
 */
async function getHistory(codCliente) {
  const cc = String(codCliente).trim();

  const { data, error } = await sb
    .from("v_customer_item_month")
    .select("customer_code, ym, item_code, description, boxes")
    .eq("customer_code", cc) // ✅ evita mezcla de clientes
    .order("ym", { ascending: false });

  if (error) {
    console.error("getHistory error:", error);
    setStatus("Error cargando historial.");
    return [];
  }

  return data || [];
}

function renderTabla(rows) {
  if (!rows || !rows.length) {
    setStatus("Sin datos");
    return;
  }

  // 1) Meses presentes (ym ya viene como 'YYYY-MM')
  const mesesSet = new Set();
  for (const r of rows) {
    const ym = (r.ym || "").trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    mesesSet.add(ym);
  }

  // Orden: más reciente a la izquierda (DESC)
  const meses = Array.from(mesesSet).sort((a, b) =>
    a < b ? 1 : a > b ? -1 : 0,
  );
  const meses60 = meses.slice(0, 60);

  // 2) Agrupar por item_code y sumar cajas por mes
  const map = {};
  for (const r of rows) {
    const item = (r.item_code || "").trim();
    if (!item) continue;

    const key = (r.ym || "").trim();
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    if (!meses60.includes(key)) continue;

    const boxes = Number(r.boxes) || 0;

    if (!map[item]) {
      map[item] = {
        desc: (r.description || "").trim() || item,
        total: 0,
        meses: {},
      };
    }

    map[item].total += boxes;
    map[item].meses[key] = (map[item].meses[key] || 0) + boxes;
  }

  const arr = Object.entries(map)
    .map(([cod, v]) => ({ cod, ...v }))
    .sort((a, b) => b.total - a.total);

  // 3) Header
  thead.innerHTML = "";
  const trh = document.createElement("tr");

  ["Cod", "Descripción", "Total", "Pedido"].forEach((t) => {
    const th = document.createElement("th");
    th.innerText = t;
    trh.appendChild(th);
  });

  // formato mmm-yy
  meses60.forEach((ym) => {
    const y = Number(ym.slice(0, 4));
    const m = Number(ym.slice(5, 7));
    const fecha = new Date(y, m - 1, 1);

    const nombre = fecha
      .toLocaleString("es-AR", { month: "short" })
      .replace(".", "")
      .toLowerCase();

    const th = document.createElement("th");
    th.innerText = `${nombre}-${String(y).slice(2)}`;
    trh.appendChild(th);
  });

  thead.appendChild(trh);

  // 4) Body
  tbody.innerHTML = "";

  for (const p of arr) {
    const tr = document.createElement("tr");

    const tdCod = document.createElement("td");
    tdCod.innerText = p.cod;
    tr.appendChild(tdCod);

    const tdDesc = document.createElement("td");
    tdDesc.innerText = p.desc;
    tdDesc.className = "desc";
    tr.appendChild(tdDesc);

    const tdTotal = document.createElement("td");
    tdTotal.innerText = p.total;
    tr.appendChild(tdTotal);

    // ✅ Pedido (usa COD, no productId)
    const cod = String(p.cod);
    const tdPedido = document.createElement("td");
    tdPedido.className = "pedido-td";
    tdPedido.innerHTML = `
      <div class="h-action">
        <div class="h-stepper">
          <button type="button" class="h-step-btn" onclick="hDec('${cod}')">−</button>
          <input id="hqty-${cod}" class="h-step-in" type="number" min="0" value="0" />
          <button type="button" class="h-step-btn" onclick="hInc('${cod}')">+</button>
        </div>
        <button type="button" class="h-add-btn" id="hadd-${cod}" onclick="hAdd('${cod}')">
          Agregar
        </button>
      </div>
    `;
    tr.appendChild(tdPedido);

    meses60.forEach((ym) => {
      const td = document.createElement("td");
      td.innerText = p.meses[ym] ? String(p.meses[ym]) : "";
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  }

  // 5) Mostrar y habilitar scroll horizontal
  statusBox.style.display = "none";
  tabla.style.display = "table";
  tabla.style.width = "max-content";
  tabla.style.minWidth = "100%";

  const scrollParent = tabla.parentElement || document.body;
  scrollParent.style.overflowX = "auto";
}

async function init() {
  try {
    setStatus("Cargando...");
    const session = await getSession();
    if (!session) return;

    const cliente = await getCliente(session);
    if (!cliente) return;

    $("cliente").innerText =
      `Cliente: ${cliente.business_name} (${cliente.cod_cliente})`;

    const rows = await getHistory(cliente.cod_cliente); // ✅ pasa codCliente
    await renderTabla(rows);
  } catch (e) {
    console.error("Init crash:", e);
    setStatus("Error inesperado cargando historial. Ver consola.");
  }
}
// ====== Cola de agregados desde Historial (por COD) ======
const HISTORY_PENDING_KEY = "lk_pending_adds_cod_v1";

function readPendingAdds() {
  try {
    const raw = localStorage.getItem(HISTORY_PENDING_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writePendingAdds(arr) {
  try {
    localStorage.setItem(HISTORY_PENDING_KEY, JSON.stringify(arr));
  } catch {}
}

window.hDec = function (cod) {
  const el = document.getElementById(`hqty-${cod}`);
  if (!el) return;
  el.value = Math.max(0, (parseInt(el.value, 10) || 0) - 1);
};

window.hInc = function (cod) {
  const el = document.getElementById(`hqty-${cod}`);
  if (!el) return;
  el.value = Math.max(0, (parseInt(el.value, 10) || 0) + 1);
};

window.hAdd = function (cod) {
  const el = document.getElementById(`hqty-${cod}`);
  const qty = el ? Math.max(0, parseInt(el.value, 10) || 0) : 0;

  // ✅ si está en 0, no hace nada
  if (qty <= 0) return;

  const list = readPendingAdds();
  const found = list.find((x) => String(x.cod) === String(cod));

  if (found) found.qty = (parseInt(found.qty, 10) || 0) + qty;
  else list.push({ cod: String(cod), qty });

  writePendingAdds(list);

  const btn = document.getElementById(`hadd-${cod}`);
  if (btn) {
    const prev = btn.textContent;
    btn.textContent = "Agregado ✓";
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = prev;
      btn.disabled = false;
    }, 900);
  }
};

document.addEventListener("DOMContentLoaded", init);
