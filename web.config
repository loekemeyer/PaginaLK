"use strict";

/***********************
 * SUPABASE CONFIG
 ***********************/
const SUPABASE_URL = "https://kwkclwhmoygunqmlegrg.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3a2Nsd2htb3lndW5xbWxlZ3JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1MjA2NzUsImV4cCI6MjA4NTA5NjY3NX0.soqPY5hfA3RkAJ9jmIms8UtEGUc4WpZztpEbmDijOgU";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
);

/***********************
 * GOOGLE SHEETS (PROXY)
 ***********************/
const SHEETS_PROXY_URL =
  "https://kwkclwhmoygunqmlegrg.functions.supabase.co/sheets-proxy";

/***********************
 * UI CONSTANTS
 ***********************/
let WEB_ORDER_DISCOUNT = 0.02; // default fallback
const BASE_IMG = `${SUPABASE_URL}/storage/v1/object/public/products-images/`;
const IMG_VERSION = "9999-12-31-2"; // cambiá esto cuando actualices imágenes

/***********************
 * ORDEN FIJO (como pediste)
 ***********************/
const CATEGORY_ORDER = [
  "Abrelatas",
  "Peladores",
  "Sacacorchos",
  "Cortadores",
  "Ralladores",
  "Coladores",
  "Afiladores",
  "Utensilios",
  "Pinzas",
  "Destapadores",
  "Tapon Vino",
  "Repostería",
  "Madera",
  "Mate",
  "Accesorios",
  "Vidrio",
  "Cuchillos de untar",
  "Contenedores",
];

const UTENSILIOS_SUB_ORDER = [
  "Madera",
  "Silicona",
  "Nylon Premium",
  "Inoxidable",
  "Nylon",
];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

async function getWebOrderDiscount() {
  try {
    const { data, error } = await supabaseClient
      .from("app_settings")
      .select("value")
      .eq("key", "web_order_discount")
      .single();

    if (error) throw error;
    return Number(data?.value) || 0;
  } catch (e) {
    console.warn("No se pudo leer web_order_discount, usando default 0.02", e);
    return 0.02;
  }
}

/***********************
 * STATE
 ***********************/
let products = []; // productos cargados
let currentSession = null; // sesión supabase
let isAdmin = false; // admin flag
let customerProfile = null; // {id, business_name, dto_vol, ...}

const cart = []; // [{ productId: uuidString, qtyCajas }]

// Entrega desde DB (slots 1..25)
let deliveryChoice = { slot: "", label: "" };

let sortMode = "category"; // category | bestsellers | price_desc | price_asc

// Filtros UI (DESKTOP / estado aplicado)
let filterAll = true; // "Todos" ON por default
let filterCats = new Set(); // acumulativo
let searchTerm = ""; // buscador
let filterNewOnly = false; // ✅ NUEVOS (desktop + mobile)
let filterMyAssortment = false; // ✅ MI SURTIDO (18 meses)
let myAssortmentIds = null; // Set<string> de product_id

// ===== Mobile Filters (pendientes) =====
let pendingFilterAll = true;
let pendingFilterCats = new Set();
let pendingFilterNewOnly = false; // ✅ NUEVOS (overlay mobile)

/***********************
 * DOM HELPERS
 ***********************/
function $(id) {
  return document.getElementById(id);
}

function formatMoney(n) {
  return Math.round(Number(n || 0)).toLocaleString("es-AR");
}

function headerTwoLine(text) {
  const parts = String(text || "")
    .trim()
    .split(/\s+/);
  if (parts.length >= 2) {
    return `<span class="split-2line">${parts[0]}<br>${parts
      .slice(1)
      .join(" ")}</span>`;
  }
  return String(text || "");
}

function splitTwoWords(text) {
  const parts = String(text || "")
    .trim()
    .split(/\s+/);
  if (parts.length === 2) {
    return `<span class="split-2line">${parts[0]}<br>${parts[1]}</span>`;
  }
  return String(text || "");
}

function setOrderStatus(message, type = "") {
  const el = $("orderStatus");
  if (!el) return;

  el.classList.remove("ok", "err");
  if (type) el.classList.add(type);
  el.textContent = message || "";
}

/***********************
 * MOBILE MENU
 ***********************/
function toggleMobileMenu(forceOpen) {
  const menu = $("mobileMenu");
  const btn = $("hamburgerBtn");
  if (!menu || !btn) return;

  const willOpen =
    typeof forceOpen === "boolean"
      ? forceOpen
      : !menu.classList.contains("open");

  menu.classList.toggle("open", willOpen);
  menu.setAttribute("aria-hidden", willOpen ? "false" : "true");
  btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
}

function closeMobileMenu() {
  toggleMobileMenu(false);
}

function closeMobileUserMenu() {
  const m = $("mobileUserMenu");
  if (!m) return;

  m.classList.remove("open");
  m.setAttribute("aria-hidden", "true");
}

function toggleMobileUserMenu() {
  const m = $("mobileUserMenu");
  if (!m) return;

  const willOpen = !m.classList.contains("open");
  m.classList.toggle("open", willOpen);
  m.setAttribute("aria-hidden", willOpen ? "false" : "true");
}

window.closeMobileUserMenu = closeMobileUserMenu;

/***********************
 * SECTIONS
 ***********************/
function showSection(id) {
  document
    .querySelectorAll(".section")
    .forEach((s) => s.classList.remove("active"));

  const el = $(id);
  if (el) el.classList.add("active");

  closeCategoriesMenu();
  closeUserMenu();
  closeMobileMenu();
  closeFiltersOverlay();
  closeMobileUserMenu();
}

function goToProductsTop() {
  showSection("productos");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/***********************
 * CUIT -> EMAIL INTERNO
 ***********************/
function normalizeCUIT(cuit) {
  return String(cuit || "")
    .trim()
    .replace(/\s+/g, "");
}

function cuitDigits(cuit) {
  return normalizeCUIT(cuit).replace(/\D/g, "");
}

function cuitToInternalEmail(cuit) {
  const digits = cuitDigits(cuit);
  if (!digits) return "";
  return `${digits}@cuit.loekemeyer`;
}

/***********************
 * LOGIN MODAL
 ***********************/
function openLogin() {
  setOrderStatus("");

  const err = $("loginError");
  if (err) {
    err.style.display = "none";
    err.innerText = "";
  }

  $("loginModal")?.classList.add("open");
  $("loginModal")?.setAttribute("aria-hidden", "false");
}

function closeLogin() {
  $("loginModal")?.classList.remove("open");
  $("loginModal")?.setAttribute("aria-hidden", "true");
}

async function login() {
  const cuit = ($("cuitInput")?.value || "").trim();
  const password = ($("passInput")?.value || "").trim();

  if (!cuit || !password) {
    const err = $("loginError");
    if (err) {
      err.innerText = "Completá CUIT y contraseña.";
      err.style.display = "block";
    }
    return;
  }

  const email = cuitToInternalEmail(cuit);
  if (!email) {
    const err = $("loginError");
    if (err) {
      err.innerText = "CUIT inválido.";
      err.style.display = "block";
    }
    return;
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    const err = $("loginError");
    if (err) {
      err.innerText = "CUIT o contraseña incorrectos.";
      err.style.display = "block";
    }
    return;
  }

  currentSession = data.session || null;

  // ✅ marca que hubo login
  localStorage.setItem("is_logged", "1");

  closeLogin();

  // limpiar búsqueda
  searchTerm = "";
  const ns = $("navSearch");
  if (ns) ns.value = "";

  await refreshAuthState();
  await loadProductsFromDB();

  renderCategoriesMenu();
  renderCategoriesSidebar();
  renderProducts();
  updateCart();
  syncPaymentButtons();
}

/***********************
 * LOGOUT
 ***********************/
async function logout() {
  if (window.__isLoggingOut) return;
  window.__isLoggingOut = true;

  try {
    const signOutPromise = supabaseClient.auth.signOut().catch(() => {});
    await Promise.race([
      signOutPromise,
      new Promise((r) => setTimeout(r, 1200)),
    ]);

    Object.keys(localStorage)
      .filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))
      .forEach((k) => localStorage.removeItem(k));

    Object.keys(sessionStorage)
      .filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))
      .forEach((k) => sessionStorage.removeItem(k));

    currentSession = null;
    isAdmin = false;
    customerProfile = null;
    deliveryChoice = { slot: "", label: "" };
    localStorage.removeItem("is_logged");

    if ($("customerNote")) $("customerNote").innerText = "";
    if ($("helloNavText")) $("helloNavText").innerText = "";
    if ($("loginBtn")) $("loginBtn").style.display = "inline";
    if ($("userBox")) $("userBox").style.display = "none";

    closeUserMenu();
    resetShippingSelect();

    // reset filtros
    filterAll = true;
    filterCats.clear();
    searchTerm = "";
    setSearchInputValue("");

    renderCategoriesMenu();
    renderCategoriesSidebar();
    renderProducts();
    updateCart();

    showSection("productos");

    setTimeout(() => location.reload(), 50);
  } catch (e) {
    console.error("logout error:", e);
    setOrderStatus(
      "No se pudo cerrar sesión. Probá recargando la página.",
      "err",
    );
    window.__isLoggingOut = false;
  }
}

/***********************
 * AUTH/PROFILE HELPERS
 ***********************/
async function refreshAuthState() {
  const { data } = await supabaseClient.auth.getSession();
  currentSession = data.session || null;

  if (!currentSession) {
    isAdmin = false;
    customerProfile = null;
    deliveryChoice = { slot: "", label: "" };
    const clienteNuevoRow = $("clienteNuevoRow");
    const clienteNuevoInput = $("clienteNuevoInput");
    if (clienteNuevoRow) clienteNuevoRow.style.display = "none";
    if (clienteNuevoInput) clienteNuevoInput.value = "";
    
    syncAdminCheckoutUI();

    if ($("loginBtn")) $("loginBtn").style.display = "inline";
    if ($("userBox")) $("userBox").style.display = "none";
    if ($("ctaCliente")) $("ctaCliente").style.display = "inline-flex";
    if ($("helloNavBtn")) $("helloNavBtn").innerText = "";
    if ($("customerNote")) $("customerNote").innerText = "";
    if ($("menuMyOrders")) $("menuMyOrders").style.display = "none";

    resetShippingSelect();
    return;
  }

  const { data: adminRow, error: adminErr } = await supabaseClient
    .from("admins")
    .select("auth_user_id")
    .eq("auth_user_id", currentSession.user.id)
    .maybeSingle();

  isAdmin = !!adminRow && !adminErr;
    const clienteNuevoRow = $("clienteNuevoRow");
  const clienteNuevoInput = $("clienteNuevoInput");

  if (clienteNuevoRow) {
    clienteNuevoRow.style.display = isAdmin ? "block" : "none";
  }

  if (clienteNuevoInput && !isAdmin) {
    clienteNuevoInput.value = "";
  }
  syncAdminCheckoutUI();

  const { data: custRow } = await supabaseClient
    .from("customers")
    .select(
      "id,business_name,dto_vol,cod_cliente,cuit,direccion_fiscal,localidad,vend,mail",
    )
    .eq("auth_user_id", currentSession.user.id)
    .maybeSingle();

  customerProfile = custRow || null;

  if ($("loginBtn")) $("loginBtn").style.display = "none";
  if ($("userBox")) $("userBox").style.display = "inline-flex";
  if ($("ctaCliente")) $("ctaCliente").style.display = "none";

  const name = (customerProfile?.business_name || "").trim();
  if ($("helloNavText"))
    $("helloNavText").innerText = name ? `Hola, ${name} !` : "Hola!";

  if ($("menuMyOrders"))
  $("menuMyOrders").style.display = "block";

  const note = $("customerNote");
  if (note) {
    const dto = Number(customerProfile?.dto_vol || 0);
  
    if (!currentSession) {
      note.innerText = "";
    } else if (isAdmin) {
      note.innerText = "Modo Administrador";
    } else if (dto > 0) {
      note.innerText = "Ya está aplicado tu Dto x Volumen";
    } else {
      note.innerText = "";
    }
  }

  await loadDeliveryOptions();
}

function getDtoVol() {
  if (isAdmin) return 0;
  return Number(customerProfile?.dto_vol || 0);
}

function unitYourPrice(listPrice) {
  const dto = getDtoVol();
  return Number(listPrice || 0) * (1 - dto);
}

/***********************
 * MÉTODO DE PAGO
 ***********************/
function getPaymentDiscount() {
  if (isAdmin) return 0;

  const sel = $("paymentSelect");
  if (!sel) return 0;

  const v = parseFloat(sel.value);
  return isNaN(v) ? 0 : v;
}

function getPaymentMethodText() {
  if (isAdmin) return "Contado";

  const sel = $("paymentSelect");
  if (!sel) return "";

  const opt = sel.options[sel.selectedIndex];
  return opt?.textContent ? opt.textContent.trim() : "";
}

function getPaymentMethodCode() {
  if (isAdmin) return 8;
  const txt = String(getPaymentMethodText() || "").toLowerCase();
  
  if (txt.includes("contado")) return 8;
  if (txt.includes("15") || txt.includes("30")) return 9;
  if (txt.includes("31") || txt.includes("45")) return 10;
  if (txt.includes("46") || txt.includes("60")) return 11;
  if (txt.includes("90")) return 12;
  if (txt.includes("120")) return 13;
  if (txt.includes("prefiero no decidir") || txt.includes("no decidir ahora"))
    return 18;

  return 0; // desconocido
}

function setPaymentByValue(val) {
  const sel = $("paymentSelect");
  if (!sel) return;

  sel.value = String(val);
  syncPaymentButtons();
  updateCart();
  refreshSubmitEnabled();
}

function syncPaymentButtons() {
  const sel = $("paymentSelect");
  const wrap = $("paymentButtons");
  if (!sel || !wrap) return;

  const current = String(sel.value);
  wrap.querySelectorAll(".pay-btn").forEach((btn) => {
    btn.classList.toggle("active", String(btn.dataset.value) === current);
  });
}

function syncAdminCheckoutUI() {
  const paymentRow = $("paymentRow");
  const webNoteBox = $("webNoteBox");
  const webDiscountLine = $("webDiscountLine");
  const paymentDiscountLine = $("paymentDiscountLine");
  const totalNoDiscountLine = $("totalNoDiscountLine");
  const totalDiscountsLine = $("totalDiscountsLine");

  if (paymentRow) paymentRow.style.display = isAdmin ? "none" : "";
  if (webNoteBox) webNoteBox.style.display = isAdmin ? "none" : "";
  if (webDiscountLine) webDiscountLine.style.display = isAdmin ? "none" : "";
  if (paymentDiscountLine) paymentDiscountLine.style.display = isAdmin ? "none" : "";
  if (totalNoDiscountLine) totalNoDiscountLine.style.display = isAdmin ? "none" : "";
  if (totalDiscountsLine) totalDiscountsLine.style.display = isAdmin ? "none" : "";
}

/***********************
 * PRODUCTS (DB/RPC)
 ***********************/
async function loadProductsFromDB() {
  const logged = !!currentSession;

  if (!logged) {
    // Público: intenta RPC
    const { data, error } = await supabaseClient.rpc(
      "get_products_public_sorted",
      { sort_mode: sortMode },
    );

    if (!error && Array.isArray(data) && data.length) {
      products = data.map((p) => ({
        id: p.id,
        cod: p.cod,
        category: p.category || "Sin categoría",
        subcategory: p.subcategory,
        ranking:
          p.ranking == null || p.ranking === "" ? null : Number(p.ranking),
        orden_catalogo:
          p.orden_catalogo == null || p.orden_catalogo === ""
            ? null
            : Number(p.orden_catalogo),
        description: p.description,
        list_price: p.list_price,
        uxb: p.uxb,
        images: Array.isArray(p.images) ? p.images : [],
        // ✅ Nuevo parámetro (si el RPC todavía no lo devuelve, queda null)
        badge_status: p.badge_status
          ? String(p.badge_status).trim().toUpperCase()
          : null,
      }));
      return;
    }

    // ✅ Fallback: consulta directa (requiere policy SELECT para anon)
    if (error)
      console.warn("Public RPC failed, fallback to direct select:", error);

    const { data: rows, error: err2 } = await supabaseClient
      .from("products")
      .select(
        "id,cod,category,subcategory,ranking,orden_catalogo,description,list_price,uxb,images,badge_status",
      )
      .eq("active", true);

    if (err2) {
      console.error("Public select failed:", err2);
      products = [];
      return;
    }

    products = (rows || []).map((p) => ({
      id: p.id,
      cod: p.cod,
      category: p.category || "Sin categoría",
      subcategory: p.subcategory,
      ranking: p.ranking == null || p.ranking === "" ? null : Number(p.ranking),
      orden_catalogo:
        p.orden_catalogo == null || p.orden_catalogo === ""
          ? null
          : Number(p.orden_catalogo),
      description: p.description,
      list_price: p.list_price,
      uxb: p.uxb,
      images: Array.isArray(p.images) ? p.images : [],
      // ✅ Nuevo parámetro
      badge_status: p.badge_status
        ? String(p.badge_status).trim().toUpperCase()
        : null,
    }));

    return;
  }

  // ✅ LOGUEADO: orden también según sortMode
  let q = supabaseClient
    .from("products")
    .select(
      "id,cod,category,subcategory,ranking,orden_catalogo,description,list_price,uxb,images,badge_status,active",
    )
    .eq("active", true);

  if (sortMode === "bestsellers") {
    q = q.order("ranking", { ascending: true, nullsFirst: false });
  } else if (sortMode === "price_desc") {
    q = q.order("category", { ascending: true });
    q = q.order("list_price", { ascending: false, nullsFirst: false });
    q = q.order("orden_catalogo", { ascending: true, nullsFirst: false });
  } else if (sortMode === "price_asc") {
    q = q.order("category", { ascending: true });
    q = q.order("list_price", { ascending: true, nullsFirst: false });
    q = q.order("orden_catalogo", { ascending: true, nullsFirst: false });
  } else {
    q = q.order("category", { ascending: true });
    q = q.order("orden_catalogo", { ascending: true, nullsFirst: false });
    q = q.order("description", { ascending: true });
  }

  const { data, error } = await q;

  if (error) {
    console.error("Error loading products:", error);
    products = [];
    return;
  }

  products = (data || []).map((p) => ({
    id: p.id,
    cod: p.cod,
    category: p.category || "Sin categoría",
    subcategory:
      p.subcategory && String(p.subcategory).trim()
        ? String(p.subcategory).trim()
        : null,
    ranking:
      p.ranking === null || p.ranking === undefined || p.ranking === ""
        ? null
        : Number(p.ranking),
    orden_catalogo:
      p.orden_catalogo === null ||
      p.orden_catalogo === undefined ||
      p.orden_catalogo === ""
        ? null
        : Number(p.orden_catalogo),
    description: p.description,
    list_price: p.list_price,
    uxb: p.uxb,
    images: Array.isArray(p.images) ? p.images : [],
    // ✅ Nuevo parámetro
    badge_status: p.badge_status
      ? String(p.badge_status).trim().toUpperCase()
      : null,
    active: !!p.active,
  }));
}

/***********************
 * CATEGORÍAS HELPERS (orden fijo + fallback)
 ***********************/
function getOrderedCategoriesFrom(list) {
  const presentCats = new Set(
    (list || []).map((p) => String(p.category || "").trim()).filter(Boolean),
  );

  const inOrder = CATEGORY_ORDER.filter((cat) => presentCats.has(cat));

  const extras = Array.from(presentCats)
    .filter((cat) => !CATEGORY_ORDER.includes(cat))
    .sort((a, b) => a.localeCompare(b, "es"));

  // devuelve un array plano, en el orden correcto
  return [...inOrder, ...extras];
}

function slugifyCategory(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]/g, "");
}

function normalizeText(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getSortComparator() {
  return (a, b) => {
    const aOrd =
      a.orden_catalogo === null || a.orden_catalogo === undefined
        ? 999999
        : Number(a.orden_catalogo);
    const bOrd =
      b.orden_catalogo === null || b.orden_catalogo === undefined
        ? 999999
        : Number(b.orden_catalogo);

    const aRank =
      a.ranking === null || a.ranking === undefined
        ? 999999
        : Number(a.ranking);
    const bRank =
      b.ranking === null || b.ranking === undefined
        ? 999999
        : Number(b.ranking);

    const aPrice =
      a.list_price === null || a.list_price === undefined
        ? -1
        : Number(a.list_price);
    const bPrice =
      b.list_price === null || b.list_price === undefined
        ? -1
        : Number(b.list_price);

    if (sortMode === "bestsellers") {
      return (
        aRank - bRank ||
        aOrd - bOrd ||
        String(a.description || "").localeCompare(
          String(b.description || ""),
          "es",
        )
      );
    }

    if (sortMode === "price_desc") {
      return (
        bPrice - aPrice ||
        aOrd - bOrd ||
        String(a.description || "").localeCompare(
          String(b.description || ""),
          "es",
        )
      );
    }

    if (sortMode === "price_asc") {
      const aP = aPrice < 0 ? 999999999 : aPrice;
      const bP = bPrice < 0 ? 999999999 : bPrice;

      return (
        aP - bP ||
        aOrd - bOrd ||
        String(a.description || "").localeCompare(
          String(b.description || ""),
          "es",
        )
      );
    }

    return (
      aOrd - bOrd ||
      String(a.description || "").localeCompare(
        String(b.description || ""),
        "es",
      )
    );
  };
}

function renderCategoriesMenu() {
  const menu = $("categoriesMenu");
  if (!menu) return;

  const ordered = getOrderedCategoriesFrom(products);

  menu.innerHTML = `
    <div>
      <label class="dd-toggle-row dd-chip">
        <span>Todos los artículos</span>
        <input type="checkbox" id="ddToggleAll" ${filterAll ? "checked" : ""}>
      </label>

      <div class="dd-sep"></div>

      <div class="dd-cats-grid">
        ${ordered
          .map(
            (cat) => `
              <label class="dd-chip">
                <span>${cat}</span>
                <input
                  type="checkbox"
                  class="dd-toggle-cat"
                  data-cat="${cat}"
                  ${filterCats.has(cat) ? "checked" : ""}
                >
              </label>
            `,
          )
          .join("")}
      </div>
    </div>
  `;

  const ddAll = $("ddToggleAll");
  if (ddAll) {
    ddAll.addEventListener("", () => {
      filterAll = ddAll.checked;
      if (filterAll) filterCats.clear();
      if (!filterAll && filterCats.size === 0) filterAll = true;

      renderCategoriesMenu();
      renderCategoriesSidebar();
      renderProducts();
    });
  }

  menu.querySelectorAll(".dd-toggle-cat").forEach((inp) => {
    inp.addEventListener("", () => {
      const cat = inp.dataset.cat;
      if (inp.checked) filterCats.add(cat);
      else filterCats.delete(cat);

      if (filterCats.size > 0) filterAll = false;
      if (filterCats.size === 0) filterAll = true;

      renderCategoriesMenu();
      renderCategoriesSidebar();
      renderProducts();
    });
  });
}

/***********************
 * SIDEBAR CATEGORÍAS (desktop)
 ***********************/
function renderCategoriesSidebar() {
  const list = $("categoriesSidebarList");
  if (!list) return;

  const ordered = getOrderedCategoriesFrom(products);

  list.innerHTML = `
    <label class="toggle-row ${filterAll ? "active" : ""}">
      <span class="toggle-text">Todos los artículos</span>
      <input type="checkbox" id="toggleAll" ${filterAll ? "checked" : ""}>
      <span class="toggle-ui"></span>
    </label>

    <div class="toggle-sep"></div>

    ${ordered
      .map(
        (cat) => `
          <label class="toggle-row ${filterCats.has(cat) ? "active" : ""}">
            <span class="toggle-text">${cat}</span>
            <input
              type="checkbox"
              class="toggle-cat"
              data-cat="${cat}"
              ${filterCats.has(cat) ? "checked" : ""}
            >
            <span class="toggle-ui"></span>
          </label>
        `,
      )
      .join("")}
  `;

  const all = $("toggleAll");
  if (all) {
    all.addEventListener("change", () => {
      filterAll = all.checked;
      if (filterAll) filterCats.clear();
      if (!filterAll && filterCats.size === 0) filterAll = true;

      renderCategoriesSidebar();
      renderCategoriesMenu?.();
      renderProducts();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  list.querySelectorAll(".toggle-cat").forEach((inp) => {
    inp.addEventListener("change", () => {
      const cat = inp.dataset.cat;
      if (inp.checked) filterCats.add(cat);
      else filterCats.delete(cat);

      if (filterCats.size > 0) filterAll = false;
      if (filterCats.size === 0) filterAll = true;

      renderCategoriesSidebar();
      renderCategoriesMenu?.();
      renderProducts();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

/***********************
 * USER MENU
 ***********************/
function closeUserMenu() {
  const menu = $("userMenu");
  if (!menu) return;
  menu.classList.remove("open");
  menu.setAttribute("aria-hidden", "true");
}

function toggleUserMenu() {
  const menu = $("userMenu");
  if (!menu) return;

  const open = menu.classList.contains("open");
  closeCategoriesMenu();
  menu.classList.toggle("open", !open);
  menu.setAttribute("aria-hidden", !open ? "false" : "true");

  const btn = $("helloNavBtn");
  if (btn) btn.setAttribute("aria-expanded", !open ? "true" : "false");
}

/***********************
 * PERFIL (UI)
 ***********************/
function waLink(msg) {
  const text = encodeURIComponent(String(msg || "").trim());
  return `https://wa.me/5491131181021?text=${text}`;
}

async function loadMyOrdersUI() {
  const box = $("myOrdersBox");
  const toggleBtn = $("btnOrdersToggle");

  if (!box) return;

  if (!currentSession || !customerProfile?.id) {
    box.textContent = "Iniciá sesión para ver tus pedidos.";
    return;
  }

  box.textContent = "Cargando…";

  try {
    const { data, error } = await supabaseClient
      .from("orders")
      .select("id, created_at, total")
      .eq("customer_id", customerProfile.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (!data || !data.length) {
      box.textContent = "No hay pedidos.";
      return;
    }

    let showAll = false;

    function render() {
      const list = showAll ? data : data.slice(0, 3);

      box.innerHTML = list
        .map((order) => {
          const fecha = new Date(order.created_at);
          const fechaStr = fecha.toLocaleDateString("es-AR");
          const totalStr = Math.round(Number(order.total || 0)).toLocaleString(
            "es-AR",
          );

          return `
  <div class="order-row">
    <div class="order-col order-date">${fechaStr}</div>
    <div class="order-col order-total">$ ${totalStr}</div>
    <div class="order-col order-action">
      <button class="profile-btn small" data-repeat="${order.id}">
        Repetir Pedido
      </button>
    </div>
  </div>
`;
        })
        .join("");
    }

    render();

    if (toggleBtn) {
      toggleBtn.style.display = data.length > 3 ? "inline-block" : "none";
      toggleBtn.textContent = "Ver Más";

      toggleBtn.onclick = () => {
        showAll = !showAll;
        toggleBtn.textContent = showAll ? "Ver Menos" : "Ver Más";
        render();
      };
    }

    // Evento repetir pedido
    box.addEventListener("click", async (e) => {
      const id = e.target.dataset.repeat;
      if (!id) return;
      await repeatOrder(id);
    });
  } catch (err) {
    box.textContent = "Error cargando pedidos.";
    console.error(err);
  }
}

async function repeatOrder(orderId) {
  try {
    // Pedimos varias posibles columnas de cantidad para cubrir tu esquema real
    const { data, error } = await supabaseClient
      .from("order_items")
      .select("product_id, cajas")
      .eq("order_id", orderId);

    if (error) throw error;
    if (!data || !data.length) {
      alert("Ese pedido no tiene items para repetir.");
      return;
    }

    // Vaciar carrito actual
    cart.splice(0, cart.length);

    // Agregar productos al carrito
    data.forEach((it) => {
      const cajas = Number(
        it.cajas ??
          it.qtyCajas ??
          it.qty_cajas ??
          it.cantidad ??
          it.qty ??
          it.cajas_pedidas ??
          0,
      );

      if (!it.product_id || !cajas) return;

      cart.push({
        productId: it.product_id,
        qtyCajas: Math.max(1, Math.round(cajas)),
      });
    });

    // Refrescar UI
    updateCart();
    renderProducts();

    // Ir al carrito
    showSection("carrito");
  } catch (err) {
    console.error("repeatOrder error:", err);
    alert("No se pudo repetir el pedido.");
  }
}

async function loadMyAddressesUI() {
  const box = $("myAddressesBox");
  if (!box) return;

  if (!currentSession || !customerProfile?.id) {
    box.innerHTML = "Iniciá sesión para ver tus sucursales.";
    return;
  }

  box.innerHTML = "Cargando…";

  const { data, error } = await supabaseClient
    .from("customer_delivery_addresses")
    .select("slot,label")
    .eq("customer_id", customerProfile.id)
    .order("slot", { ascending: true });

  if (error) {
    box.innerHTML = "No se pudieron cargar las sucursales.";
    return;
  }

  const rows = data || [];
  if (!rows.length) {
    box.innerHTML = "No tenés sucursales cargadas.";
    return;
  }

  box.innerHTML = `
    <div style="display:grid; gap:8px;">
      ${rows
        .map(
          (r) => `
        <div style="border:1px solid #eee; border-radius:10px; padding:10px;">
          <strong>${r.slot}:</strong> ${r.label || ""}
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

async function changePasswordUI() {
  if (window.__changingPass) return;
  window.__changingPass = true;
  const statusEl = document.getElementById("passStatus");
  const btn = document.getElementById("btnChangePass");

  const p1 = String(document.getElementById("newPass1")?.value || "").trim();
  const p2 = String(document.getElementById("newPass2")?.value || "").trim();

  const setStatus = (t) => {
    if (statusEl) statusEl.textContent = t;
  };

  // Validaciones
  if (!currentSession) {
    setStatus("Tenés que iniciar sesión.");
    return;
  }
  if (!p1 || !p2) {
    setStatus("Completá ambos campos.");
    return;
  }
  if (!/^\d+$/.test(p1) || !/^\d+$/.test(p2)) {
    setStatus("La contraseña debe ser solo numérica.");
    return;
  }
  if (p1.length < 6) {
    setStatus("La contraseña debe tener al menos 6 números.");
    return;
  }
  if (p1 !== p2) {
    setStatus("Las contraseñas no coinciden.");
    return;
  }

  btn && (btn.disabled = true);
  setStatus("Guardando…");

  try {
    // 1) Obtener sesión fresca (token)
    const { data: sessData, error: sessErr } =
      await supabaseClient.auth.getSession();
    if (sessErr) throw sessErr;

    let session = sessData?.session;

    // si por alguna razón no hay session, pedimos re-login
    if (!session?.access_token) {
      setStatus(
        "⚠️ Tu sesión no está disponible. Cerrá sesión e iniciá sesión de nuevo.",
      );
      return;
    }

    // 2) Llamada directa a Supabase Auth (PUT /auth/v1/user)
    const controller = new AbortController();
    const TIMEOUT_MS = 15000;
    const t = setTimeout(() => controller.abort(), TIMEOUT_MS);

    // Si tenés el PIN actual guardado en customerProfile, evitamos setear el mismo
    const pinActual = String(customerProfile?.pin ?? "").trim();
    if (pinActual && String(p1) === pinActual) {
      setStatus("❌ El PIN nuevo no puede ser igual al actual.");
      btn && (btn.disabled = false);
      return;
    }

    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "PUT",
      signal: controller.signal,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: p1 }),
    });

    clearTimeout(t);

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Auth ${resp.status}: ${txt || resp.statusText}`);
    }

    setStatus("✅ Contraseña actualizada.");

    // ✅ Actualizar PIN en customers (por auth_user_id) + confirmar resultado
    try {
      const newPin = Number(p1); // pin es int8 => mandamos número

      const { data: upRow, error: upErr } = await supabaseClient
        .from("customers")
        .update({ pin: newPin })
        .eq("auth_user_id", currentSession.user.id) // ✅ clave para RLS
        .select("pin")
        .single();

      if (upErr) throw upErr;

      // refrescar cache local (así la próxima validación "mismo pin" funciona)
      if (customerProfile) customerProfile.pin = upRow?.pin;

      // opcional: dejar un OK explícito
      // setStatus('✅ Contraseña actualizada y PIN guardado.');
    } catch (e) {
      console.warn("PIN no se pudo actualizar en customers:", e);
      setStatus(
        "✅ Contraseña actualizada. ⚠️ No se pudo guardar el PIN en customers (RLS).",
      );
    }

    document.getElementById("newPass1").value = "";
    document.getElementById("newPass2").value = "";
  } catch (err) {
    if (String(err?.name) === "AbortError") {
      setStatus("❌ Timeout al actualizar contraseña (red/bloqueo).");
    } else {
      setStatus(`❌ ${String(err?.message || err)}`);
    }
  } finally {
    btn && (btn.disabled = false);
    window.__changingPass = false;
  }
}

function fillProfileSummaryUI() {
  // Si no existe el HTML nuevo, no hacemos nada
  if (!$("pfRazonSocial")) return;

  // Si no hay sesión/perfil, mostramos guiones
  if (!currentSession || !customerProfile) {
    $("pfRazonSocial").textContent = "—";
    $("pfCodCliente").textContent = "—";
    $("pfCuit").textContent = "—";
    $("pfCorreo").textContent = "—";
    $("pfDtoVol").textContent = "—";
    return;
  }

  const razon = String(customerProfile.business_name || "").trim();
  const cod = String(customerProfile.cod_cliente || "").trim();
  const cuit = String(customerProfile.cuit || "").trim();
  const mail = String(customerProfile.mail || "").trim();
  const dto = Number(customerProfile.dto_vol || 0); // en tu DB parece venir como 0.15, 0.20, etc.

  $("pfRazonSocial").textContent = razon || "—";
  $("pfCodCliente").textContent = cod || "—";
  $("pfCuit").textContent = cuit || "—";
  $("pfCorreo").textContent = mail || "—";

  // Mostrar % (si dto_vol es 0.15 => 15)
  const dtoEl = $("pfDtoVol");
  const dtoContainer = dtoEl?.parentElement;
  
  if (Number.isFinite(dto) && dto > 0) {
    dtoEl.textContent = Math.round(dto * 100);
    if (dtoContainer) dtoContainer.style.display = "";
  } else {
    if (dtoContainer) dtoContainer.style.display = "none";
  }
}

async function openProfile() {
  if (!currentSession) {
    openLogin();
    return;
  }
  showSection("perfil");
  fillProfileSummaryUI(); // ✅ ESTA LÍNEA
  await loadMyOrdersUI();
  await loadMyAddressesUI();
}

window.openProfile = openProfile;

/***********************
 * BUSCADOR
 ***********************/
function setSearchInputValue(val) {
  const inp = $("productsSearch");
  if (inp) inp.value = val || "";
}

function getFilteredProducts() {
  let list = products.slice();

  // Categorías
  if (!filterAll) {
    list = list.filter((p) => filterCats.has(String(p.category || "").trim()));
  }

  // NUEVOS
  if (filterNewOnly) {
    list = list.filter(
      (p) => String(p.badge_status || "").trim().toUpperCase() === "NUEVO",
    );
  }

  // MI SURTIDO
  if (filterMyAssortment) {
    if (myAssortmentIds instanceof Set) {
      list = list.filter((p) => myAssortmentIds.has(String(p.id)));
    }
  }

  // Buscador
  if (searchTerm && String(searchTerm).trim()) {
    const term = normalizeText(searchTerm);
    list = list.filter((p) => {
      const hay = [p.cod, p.description].map(normalizeText).join(" ");
      return hay.includes(term);
    });
  }

  return list;
}

async function loadMyAssortmentIds() {
  if (!currentSession) return new Set();
  if (!customerProfile?.cod_cliente) return new Set();

  const { data, error } = await supabaseClient.rpc("get_my_assortment_18m", {
    p_customer: String(customerProfile.cod_cliente),
  });

  if (error) {
    console.error("RPC get_my_assortment_18m error:", error);
    return new Set();
  }

  return new Set((data || []).map((r) => String(r.product_id)));
}

/***********************
 * RENDER PRODUCTS  ✅ (FIX SORT REAL)
 ***********************/
function renderProducts() {
  const container = $("productsContainer");
  if (!container) return;

  container.innerHTML = "";

  const logged = !!currentSession;
  const list =
    typeof getFilteredProducts === "function"
      ? getFilteredProducts()
      : products;

  if (!list.length) {
    container.innerHTML = `
      <div style="padding:24px 40px; color:#666; font-size:14px;">
        Sin resultados${
          typeof searchTerm === "string" && searchTerm.trim()
            ? ` para "${String(searchTerm).trim()}"`
            : ""
        }.
      </div>
    `;
    return;
  }

  const buildCard = (p) => {
    const pid = String(p.id);
    const codSafe = String(p.cod || "").trim();

    const imgSrc = `${BASE_IMG}${encodeURIComponent(codSafe)}.jpg?v=${encodeURIComponent(
      IMG_VERSION,
    )}`;
    const imgFallback = "img/no-image.jpg";

    // ✅ Tu precio normal (se sigue usando para carrito / subtotal, no se muestra en card)
    const tuPrecio = logged ? unitYourPrice(p.list_price) : 0;
    const dtoVol = Number(customerProfile?.dto_vol || 0);
    const showListPriceOnly = isAdmin ;

    const tuPrecioContado = logged
      ? showListPriceOnly
      ? Number(p.list_price || 0)
      : tuPrecio * (1 - WEB_ORDER_DISCOUNT) * (1 - 0.25)
      : 0;

    const badge = String(p.badge_status || "")
      .trim()
      .toUpperCase();

    let badgeHtml = "";

    if (badge === "NUEVO") {
      badgeHtml = '<div class="badge-nuevo">NUEVO</div>';
    } else if (badge === "LIQUIDACION" || badge === "LIQUIDACIÓN") {
      badgeHtml = '<div class="badge-liquidacion">LIQUIDACIÓN</div>';
    } else if (badge === "SIN STOCK") {
      badgeHtml = '<div class="badge-sinstock">SIN STOCK</div>';
    }

    const inCart = cart.find((i) => String(i.productId) === String(pid));
    const qty = inCart ? Number(inCart.qtyCajas || 0) : 0;
    const totalUni = qty * Number(p.uxb || 0);

    return `
      <div class="product-card" id="card-${pid}">
      ${badgeHtml}
        <img
          id="img-${pid}"
          src="${imgSrc}"
          alt="${String(p.description || "")}"
          onerror="this.onerror=null;this.src='${imgFallback}'"
        >

        <div class="card-top">
          <div class="card-row">
            <div class="card-cod">Cod: <span>${codSafe}</span></div>
            <div class="card-uxb">UxB: <span>${p.uxb}</span></div>
          </div>

          <div class="card-desc">${String(p.description || "")}</div>

          <div class="${logged ? "" : "price-hidden"} card-prices">
  <div class="card-price-line">
    Precio Lista: <strong>$${formatMoney(p.list_price)} + IVA</strong>
  </div>

  ${
    showListPriceOnly
      ? ""
      : `
    <div class="card-price-line">
      Tu Precio Contado: <strong>$${formatMoney(tuPrecioContado)} + IVA</strong>
    </div>
  `
  }
</div>

          <div class="${logged ? "price-hidden" : ""} card-prices">
            <div class="price-locked">Inicia sesión para ver precios</div>
          </div>
        </div>

        ${
          badge === "SIN STOCK"
            ? `
      <button class="add-btn disabled" disabled>
        Sin stock
      </button>
    `
            : !logged
              ? `
        <button class="add-btn add-login-btn" onclick="openLogin()">
          Iniciar sesión para ver precios
        </button>
      `
              : qty <= 0
                ? `
          <button class="add-btn" id="add-${pid}" onclick="addFirstBox('${pid}')">
            Agregar al pedido
          </button>
        `
                : `
          <div class="card-cartbar" id="qty-${pid}">
          <div class="cartbar-top">
            <div class="cartbar-label">Subtotal</div>
            <div class="cartbar-subtotal">
              <strong class="cartbar-subv">
                $${formatMoney(
                  logged
                    ? unitYourPrice(p.list_price) * (qty * Number(p.uxb || 0))
                    : 0,
                )}
              </strong>
              <span class="cartbar-iva">+ IVA</span>
            </div>
          </div>
                <div class="cartbar-controls">
                  <div class="cartbar-left">
                    <div class="cartbar-stepper">
                      <button type="button" class="step-btn" onclick="changeQty('${pid}', -1)">−</button>
                      <input
                        class="step-input"
                        type="number"
                        min="1"
                        step="1"
                        value="${qty}"
                        inputmode="numeric"
                        onchange="manualQty('${pid}', this.value)"
                      >
                      <button type="button" class="step-btn" onclick="changeQty('${pid}', 1)">+</button>
                    </div>

                    <button type="button" class="chip chip-5" onclick="changeQty('${pid}', 5)">+5</button>
                  </div>
                </div>

                <div class="cartbar-units">
                  Unidades: <strong>${formatMoney(totalUni)}</strong>
                </div>

                <button type="button" class="remove-btn remove-compact" onclick="removeItem('${pid}')">
                  Quitar
                </button>
              </div>
            `
        }
      </div>
    `;
  };

  // ✅ SOLO bestsellers en grilla global (opcional)
  if (sortMode === "bestsellers") {
    let items = [...list];
    items.sort(getSortComparator());

    container.innerHTML = `
      <div class="products-grid">
        ${items.map(buildCard).join("")}
      </div>
    `;
    return;
  }

  // ✅ Modo category (bloques por categoría)
  const cats = getOrderedCategoriesFrom(list);

  cats.forEach((category) => {
    const block = document.createElement("div");
    block.className = "category-block";

    const catId = `cat-${slugifyCategory(category)}`;

    let items = list.filter(
      (p) => String(p.category || "").trim() === String(category).trim(),
    );

    // category: ordenar dentro de cada categoría
    items = items.sort(getSortComparator());

    if (!items.length) return;

    let cardsHtml = "";

    if (String(category).trim().toLowerCase() === "utensilios") {
      const groups = new Map();

      items.forEach((p) => {
        const key =
          p.subcategory && String(p.subcategory).trim()
            ? String(p.subcategory).trim()
            : "Otros";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
      });

      const present = Array.from(groups.keys());
      const fixed = UTENSILIOS_SUB_ORDER.filter((s) => present.includes(s));

      const extras = present
        .filter((s) => s !== "Otros" && !UTENSILIOS_SUB_ORDER.includes(s))
        .sort((a, b) => a.localeCompare(b, "es"));

      const hasOtros = present.includes("Otros");
      const subcatsOrdered = [
        ...fixed,
        ...extras,
        ...(hasOtros ? ["Otros"] : []),
      ];

      cardsHtml = subcatsOrdered
        .map((sub) => {
          const prods = groups.get(sub) || [];
          prods.sort(getSortComparator());

          const subtitle = `
            <div style="
              grid-column: 1 / -1;
              font-size: 26px;
              font-weight: bold;
              margin: 40px 40px 20px;
              border-bottom: 1px solid #ddd;
              padding-bottom: 6px;
              background: #fff;
            ">${sub}</div>
          `;

          const cards = prods.map(buildCard).join("");
          return subtitle + cards;
        })
        .join("");
    } else {
      cardsHtml = items.map(buildCard).join("");
    }

    block.innerHTML = `
      <h2 class="category-title" id="${catId}">${category}</h2>
      <div class="products-grid">
        ${cardsHtml}
      </div>
    `;

    container.appendChild(block);
  });

  if (!container.children.length) {
    container.innerHTML = `
      <div style="padding:24px 40px; color:#666; font-size:14px;">
        Sin resultados${
          typeof searchTerm === "string" && searchTerm.trim()
            ? ` para "${String(searchTerm).trim()}"`
            : ""
        }.
      </div>
    `;
  }
}

/***********************
 * MOBILE FILTERS OVERLAY
 ***********************/
function openFiltersOverlay() {
  const ov = $("filtersOverlay");
  if (!ov) return;

  pendingFilterAll = filterAll;
  pendingFilterCats = new Set(filterCats);
  pendingFilterNewOnly = filterNewOnly;

  renderFiltersOverlayUI();

  ov.classList.add("open");
  ov.setAttribute("aria-hidden", "false");
}

function closeFiltersOverlay() {
  const ov = $("filtersOverlay");
  if (!ov) return;

  ov.classList.remove("open");
  ov.setAttribute("aria-hidden", "true");
}

function applyPendingFilters() {
  filterAll = !!pendingFilterAll;
  filterCats = new Set(Array.from(pendingFilterCats || []));
  filterNewOnly = !!pendingFilterNewOnly;

  // UI sync del botón NUEVOS desktop (si existe)
  const b = $("btnFilterNew");
  if (b) b.classList.toggle("on", !!filterNewOnly);

  closeFiltersOverlay();
  renderProducts();
}

function cancelPendingFilters() {
  closeFiltersOverlay();
}

function renderFiltersOverlayUI() {
  const grid = $("filtersGrid");
  if (!grid) return;

  const ordered = getOrderedCategoriesFrom(products);
  const isOn = (cat) => pendingFilterCats.has(cat);

  grid.innerHTML = `
    <button type="button" class="mf-btn ${pendingFilterAll ? "on" : ""}" data-all="1">
      Todos los artículos
    </button>

    <button type="button" class="mf-btn mf-btn2 ${pendingFilterNewOnly ? "on" : ""}" data-new="1">
    NUEVOS
  </button>

    ${ordered
      .map(
        (cat) => `
          <button type="button" class="mf-btn ${isOn(cat) ? "on" : ""}" data-cat="${cat}">
            ${cat}
          </button>
        `,
      )
      .join("")}
  `;

  grid.querySelectorAll(".mf-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const isAll = btn.dataset.all === "1";
      const cat = btn.dataset.cat;
      const isNew = btn.dataset.new === "1";

      if (isNew) {
        pendingFilterNewOnly = !pendingFilterNewOnly;
        renderFiltersOverlayUI();
        return;
      }

      if (isAll) {
        pendingFilterAll = true;
        pendingFilterCats.clear();
      } else {
        pendingFilterAll = false;

        if (pendingFilterCats.has(cat)) pendingFilterCats.delete(cat);
        else pendingFilterCats.add(cat);

        if (pendingFilterCats.size === 0) {
          pendingFilterAll = true;
        }
      }

      renderFiltersOverlayUI();
    });
  });
}

/***********************
 * DELIVERY OPTIONS (DB)
 ***********************/
function resetShippingSelect() {
  const sel = $("shippingSelect");
  if (!sel) return;

  sel.innerHTML = `<option value="" selected>Elegir</option>`;
  deliveryChoice = { slot: "", label: "" };
}

async function loadDeliveryOptions() {
  const sel = $("shippingSelect");
  if (!sel) return;

  resetShippingSelect();

  if (!currentSession || !customerProfile?.id) return;

  const { data, error } = await supabaseClient
    .from("customer_delivery_addresses")
    .select("slot,label")
    .eq("customer_id", customerProfile.id)
    .order("slot", { ascending: true });

  if (error) {
    console.error("delivery options error:", error);
    return;
  }

  (data || []).forEach((row) => {
    const opt = document.createElement("option");
    opt.value = String(row.slot);
    opt.textContent = `${row.slot}: ${row.label}`;
    opt.dataset.label = row.label || "";
    sel.appendChild(opt);
  });

  updateCart();
}

// =============================
// UX: fly-to-cart + toast "Ver pedido"
// =============================
let __viewOrderShowTimer = null;
let __viewOrderHideTimer = null;

function getVisibleCartIconEl() {
  // Desktop icon
  const desktop = document.getElementById("cartIcon");
  if (desktop && desktop.offsetParent !== null) return desktop;

  // Mobile icon (dentro del botón)
  const mobileBtn = document.getElementById("mobileCartBtn");
  if (mobileBtn && mobileBtn.offsetParent !== null) {
    const img = mobileBtn.querySelector("img");
    return img || mobileBtn;
  }

  // fallback: link del carrito
  const link = document.getElementById("cartLink");
  if (link && link.offsetParent !== null) return link;

  return null;
}

function flyProductImageToCart(productId) {
  const img = document.getElementById(`img-${productId}`);
  const target = getVisibleCartIconEl();
  if (!img || !target) return;

  const r1 = img.getBoundingClientRect();
  const r2 = target.getBoundingClientRect();
  if (!r1.width || !r1.height || !r2.width || !r2.height) return;

  const clone = img.cloneNode(true);
  clone.className = "fly-to-cart";
  clone.style.left = `${r1.left}px`;
  clone.style.top = `${r1.top}px`;
  clone.style.width = `${r1.width}px`;
  clone.style.height = `${r1.height}px`;
  clone.style.opacity = "1";
  clone.style.transform = "translate3d(0,0,0) scale(1)";

  document.body.appendChild(clone);

  const dx = r2.left + r2.width / 2 - (r1.left + r1.width / 2);
  const dy = r2.top + r2.height / 2 - (r1.top + r1.height / 2);

  // start anim next frame
  requestAnimationFrame(() => {
    clone.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(0.15)`;
    clone.style.opacity = "0";
  });

  clone.addEventListener("transitionend", () => clone.remove(), { once: true });
}

function hideViewOrderToast() {
  const t = document.getElementById("viewOrderToast");
  if (!t) return;
  t.classList.remove("show");
  t.setAttribute("aria-hidden", "true");
}

function positionViewOrderToastBelowHeader() {
  const header =
    document.querySelector("header") || document.querySelector(".header");
  const toast = document.getElementById("viewOrderToast");
  if (!header || !toast) return;

  const headerRect = header.getBoundingClientRect();
  const offset = Math.max(0, headerRect.bottom + 10); // 10px de aire

  toast.style.top = `${offset}px`;
}

function showViewOrderToast() {
  const t = document.getElementById("viewOrderToast");
  if (!t) return;

  positionViewOrderToastBelowHeader();

  t.classList.add("show");
  t.setAttribute("aria-hidden", "false");
}

function scheduleViewOrderToastAfterAdd() {
  // no acumulativo: si agregás otra vez, resetea el “3s visible”
  clearTimeout(__viewOrderShowTimer);
  clearTimeout(__viewOrderHideTimer);

  // aparece rápido (80ms) para que se sienta “instantáneo”
  __viewOrderShowTimer = setTimeout(() => {
    showViewOrderToast();

    // y se oculta 3s después de aparecer
    clearTimeout(__viewOrderHideTimer);
    __viewOrderHideTimer = setTimeout(() => hideViewOrderToast(), 3000);
  }, 80);
}

/***********************
 * CART
 ***********************/
// ==============================
// CART (persistencia entre páginas)
// ==============================
const CART_LS_KEY = "lk_mayorista_cart_v1";

function loadCartFromLS() {
  try {
    const raw = localStorage.getItem(CART_LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // normaliza
    return arr
      .map((x) => ({
        productId: String(x.productId),
        qtyCajas: Math.max(1, parseInt(x.qtyCajas, 10) || 1),
      }))
      .filter((x) => x.productId);
  } catch {
    return [];
  }
}

function saveCartToLS() {
  try {
    // guardamos SOLO lo mínimo
    const payload = cart.map((x) => ({
      productId: String(x.productId),
      qtyCajas: Math.max(1, parseInt(x.qtyCajas, 10) || 1),
    }));
    localStorage.setItem(CART_LS_KEY, JSON.stringify(payload));
  } catch {}
}

function addFirstBox(productId) {
  if (!currentSession) {
    openLogin();
    return;
  }

  const existing = cart.find((i) => i.productId === productId);

  if (existing) {
    existing.qtyCajas += 1;
  } else {
    // ✅ SOLO la primera vez que se agrega ese producto: animación “viaja al carrito”
    flyProductImageToCart(productId);

    cart.push({ productId, qtyCajas: 1 });
    toggleControls(productId, true);
  }

  // ✅ Toast: 3s después del último “agregar” (no acumulativo)
  scheduleViewOrderToastAfterAdd();

  updateCart();
  renderProducts();
}

function changeQty(productId, delta) {
  const item = cart.find((i) => i.productId === productId);
  if (!item) return;

  item.qtyCajas += delta;

  if (item.qtyCajas <= 0) {
    removeItem(productId);
    return;
  }

  const input = document.querySelector(`#qty-${CSS.escape(productId)} input`);
  if (input) input.value = item.qtyCajas;

  updateCart();
  renderProducts();
}

function manualQty(productId, value) {
  const qty = Math.max(0, parseInt(value, 10) || 0);

  const item = cart.find((i) => i.productId === productId);
  if (!item) return;

  if (qty <= 0) {
    removeItem(productId);
    return;
  }

  item.qtyCajas = qty;
  updateCart();
  renderProducts();
}

function removeItem(productId) {
  const idx = cart.findIndex((i) => i.productId === productId);
  if (idx >= 0) cart.splice(idx, 1);

  toggleControls(productId, false);
  updateCart();
  renderProducts();
}

function toggleControls(productId, show) {
  const addBtn = $(`add-${productId}`);
  const qtyWrap = $(`qty-${productId}`);

  if (addBtn) addBtn.style.display = show ? "none" : "inline-block";
  if (qtyWrap) qtyWrap.style.display = show ? "block" : "none";
}

function calcTotals() {
  const logged = !!currentSession;
  const paymentDiscount = getPaymentDiscount();
  const webDiscountRate = isAdmin ? 0 : WEB_ORDER_DISCOUNT;

  let subtotal = 0;

  if (logged) {
    cart.forEach((item) => {
      const p = products.find((x) => String(x.id) === String(item.productId));
      if (!p) return;

      const totalUni = item.qtyCajas * Number(p.uxb || 0);
      subtotal += unitYourPrice(p.list_price) * totalUni;
    });
  }

  let totalNoDiscount = 0;
  cart.forEach((item) => {
    const p = products.find((x) => String(x.id) === String(item.productId));
    if (!p) return;

    const totalUni = item.qtyCajas * Number(p.uxb || 0);
    totalNoDiscount += Number(p.list_price || 0) * totalUni;
  });

  const webDiscountValue = subtotal * webDiscountRate;
  const afterWeb = subtotal - webDiscountValue;

  const paymentDiscountValue = afterWeb * paymentDiscount;
  const finalTotal = afterWeb - paymentDiscountValue;

  const totalDiscounts = Math.max(0, totalNoDiscount - finalTotal);

    return {
    logged,
    paymentDiscount,
    webDiscountRate,
    subtotal,
    totalNoDiscount,
    webDiscountValue,
    paymentDiscountValue,
    finalTotal,
    totalDiscounts,
  };
}

function updateCart() {
  const cartDiv = $("cart");
  if (!cartDiv) return;

  const submitBtn = document.getElementById("submitOrderBtn");

  const hasShipping = !!deliveryChoice?.slot;
  const hasPayment = isAdmin
  ? true
  : !!document.getElementById("paymentSelect")?.value;
  const hasItems = cart.length > 0;

  submitBtn.disabled = !(hasShipping && hasPayment && hasItems);

  const t = calcTotals();

  if (!cart.length) {
    cartDiv.innerHTML = `<div style="padding:14px; text-align:center; color:#666;">Carrito vacío</div>`;
  } else {
    let rows = "";

    cart.forEach((item) => {
      const p = products.find((x) => String(x.id) === String(item.productId));
      if (!p) return;

      const totalCajas = item.qtyCajas;
      const totalUni = totalCajas * Number(p.uxb || 0);

      const tuPrecioUnit = t.logged ? unitYourPrice(p.list_price) : 0;
      const lineTotal = t.logged ? tuPrecioUnit * totalUni : 0;

      rows += `
        <tr>
          <td><strong>${String(p.cod || "")}</strong></td>
          <td class="desc">${splitTwoWords(p.description)}</td>
          <td>${formatMoney(totalCajas)}</td>
          <td>${formatMoney(totalUni)}</td>
          <td>${t.logged ? "$" + formatMoney(tuPrecioUnit) + " + IVA" : "—"}</td>
          <td><strong>${t.logged ? "$" + formatMoney(lineTotal) + " + IVA" : "—"}</strong></td>
        </tr>
      `;
    });

    cartDiv.innerHTML = `
      <table class="cart-table">
        <colgroup>
          <col class="cod">
          <col class="desc">
          <col class="cajas">
          <col class="uni">
          <col class="tp">
          <col class="total">
        </colgroup>

        <thead>
          <tr>
            <th>${headerTwoLine("Cod")}</th>
            <th>${headerTwoLine("Descripción")}</th>
            <th>${headerTwoLine("Total Cajas")}</th>
            <th>${headerTwoLine("Total Uni")}</th>
            <th>${headerTwoLine(isAdmin ? "Precio Lista" : "Tu Precio")}</th>
            <th>${headerTwoLine("Total $")}</th>
          </tr>
        </thead>

        <tbody>${rows}</tbody>
      </table>
    `;
  }

  $("subtotal") && ($("subtotal").innerText = formatMoney(t.subtotal));
  $("webDiscountValue") &&
    ($("webDiscountValue").innerText = formatMoney(t.webDiscountValue));
  $("paymentDiscountValue") &&
    ($("paymentDiscountValue").innerText = formatMoney(t.paymentDiscountValue));
  $("total") && ($("total").innerText = formatMoney(t.finalTotal));

  if ($("pedidoTotalHeader"))
    $("pedidoTotalHeader").innerText = formatMoney(t.finalTotal);

  if ($("paymentDiscountPercent")) {
    $("paymentDiscountPercent").innerText =
      (t.paymentDiscount * 100).toFixed(0) + "%";
  }

  $("totalNoDiscount") &&
    ($("totalNoDiscount").innerText = formatMoney(t.totalNoDiscount));
  $("totalDiscounts") &&
    ($("totalDiscounts").innerText = formatMoney(t.totalDiscounts));

  let count = 0;
  cart.forEach((i) => (count += i.qtyCajas));
  $("cartCount") && ($("cartCount").innerText = count);
  $("mobileCartCount") && ($("mobileCartCount").innerText = count);

  const btn = $("submitOrderBtn");
  if (btn) {
    const mustChooseDelivery = !deliveryChoice.slot;
    const canConfirm =
      !!currentSession && cart.length > 0 && !mustChooseDelivery;

    btn.disabled = !canConfirm;

    if (!!currentSession && cart.length > 0 && mustChooseDelivery) {
      setOrderStatus(
        "Elegí una opción de Entrega para poder confirmar el pedido.",
        "err",
      );
    } else if (btn.disabled === false) {
      setOrderStatus("");
    }
  }
  syncAdminCheckoutUI();
  // ✅ persiste carrito para otras páginas (sugerencias, historial, etc.)
  saveCartToLS();
}

/***********************
 * SEND TO SHEETS + SUBMIT ORDER
 ***********************/
async function sendOrderToSheets({
  orderNumber,
  codCliente,
  vend,
  condicionPago,
  condicionPagoCode,
  sucursalEntrega,
  clienteNuevo,
  items,
}) {
  if (!SHEETS_PROXY_URL) {
    throw new Error("Sheets proxy config missing");
  }

  if (!currentSession?.access_token) {
    throw new Error("Not logged in");
  }

    const payload = {
    order_number: String(orderNumber || "").trim(),
    condicion_pago_code: Number(condicionPagoCode || 0),

    cod_cliente: String(codCliente || "").trim(),
    vend: String(vend || "").trim(),
    condicion_pago: String(condicionPago || "").trim(),
    sucursal_entrega: String(sucursalEntrega || "").trim(),
    cliente_nuevo: String(clienteNuevo || "").trim(),

    items: (items || []).map((it) => ({
      cod_art: String(it.cod_art || "").trim(),
      cajas: Number(it.cajas || 0),
      uxb: Number(it.uxb || 0),
    })),
  };

  const resp = await fetch(SHEETS_PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentSession.access_token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok || data?.ok === false) {
    throw new Error(data?.error || `Proxy error ${resp.status}`);
  }

  return { ok: true };
}

async function withTimeout(promise, ms, label = "timeout") {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(
      () => reject(new Error(`Timeout (${ms}ms) en ${label}`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t);
  }
}

function debugStep(txt) {
  console.log("[ORDER]", txt);
  setOrderStatus(txt, "");
}

async function submitOrder() {
  const btn = $("submitOrderBtn");
    const clienteNuevoValue = isAdmin
    ? String($("clienteNuevoInput")?.value || "").trim()
    : "";
  try {
    setOrderStatus("");

    if (window.__submittingOrder) return;
    window.__submittingOrder = true;
    if (btn) btn.disabled = true;

    if (!currentSession) {
      openLogin();
      return;
    }
    if (!customerProfile?.id) {
      setOrderStatus("No se encontró el perfil del cliente.", "err");
      return;
    }
    if (!cart.length) {
      setOrderStatus("Carrito vacío.", "err");
      return;
    }
    if (!deliveryChoice?.slot) {
      setOrderStatus("Debés seleccionar una sucursal de entrega.", "err");
      return;
    }

    const paySel = document.getElementById("paymentSelect");
if (!isAdmin && (!paySel || !String(paySel.value || "").trim())) {
  setOrderStatus("Debés seleccionar un método de pago.", "err");
  return;
}

    const t = calcTotals();

    const orderPayload = {
      auth_user_id: currentSession.user.id,
      customer_id: customerProfile.id,
      status: "pendiente",
      payment_method: getPaymentMethodText(),
      payment_discount: Number(t.paymentDiscount || 0),
      web_discount: isAdmin ? 0 : WEB_ORDER_DISCOUNT,
      subtotal: Number(t.subtotal || 0),
      total: Number(t.finalTotal || 0),
    };

    debugStep("Confirmando pedido…");

    const resHead = await withTimeout(
      supabaseClient.from("orders").insert(orderPayload).select("id").single(),
      60000,
      "Supabase insert orders",
    );

    const orderRow = resHead.data;
    const orderErr = resHead.error;

    if (orderErr || !orderRow?.id) {
      const msg =
        orderErr?.message ||
        orderErr?.details ||
        orderErr?.hint ||
        JSON.stringify(orderErr || {});
      setOrderStatus(`No se pudo confirmar el pedido: ${msg}`, "err");
      return;
    }

    const orderId = orderRow.id;

    // ---- items payload (tu lógica original) ----
    const itemsPayload = cart
      .map((item) => {
        const p = products.find((x) => String(x.id) === String(item.productId));
        if (!p) return null;

        const qtyCajas = Number(item.qtyCajas || 0);
        const uxb = Number(p.uxb || 0);
        const totalUni = qtyCajas * uxb;

        return {
          order_id: orderId,
          product_id: p.id,
          cod_art: String(p.cod || "").trim(),
          cajas: qtyCajas,
          uxb,
          unidades: totalUni,
          unit_price: Number(unitYourPrice(p.list_price) || 0),
          list_price: Number(p.list_price || 0),
          description: String(p.description || ""),
        };
      })
      .filter(Boolean);

    debugStep("Confirmando pedido… (items)");

    // 🔥 SOLO columnas que existen en order_items
    const itemsForDb = itemsPayload.map((it) => ({
      order_id: it.order_id,
      product_id: it.product_id,
      cajas: it.cajas,
      uxb: it.uxb,
    }));

    const resItems = await withTimeout(
      supabaseClient.from("order_items").insert(itemsForDb),
      60000,
      "Supabase insert order_items",
    );

    if (resItems.error) {
      const msg = resItems.error.message || JSON.stringify(resItems.error);
      setOrderStatus(
        `Pedido creado, pero falló la carga de items: ${msg}`,
        "err",
      );
      return;
    }

    // ---- envío a Sheets (no bloqueante “total”) ----
    debugStep("Enviando…");

    try {
            await sendOrderToSheets({
        orderNumber: orderId,
        codCliente: customerProfile.cod_cliente,
        vend: customerProfile.vend,
        condicionPago: getPaymentMethodText(),
        condicionPagoCode: getPaymentMethodCode(),
        sucursalEntrega: deliveryChoice.label || deliveryChoice.slot,
        clienteNuevo: clienteNuevoValue,
        items: itemsPayload.map((it) => ({
          cod_art: it.cod_art,
          cajas: it.cajas,
          uxb: it.uxb,
        })),
      });
    } catch (e) {
      console.warn("Sheets error:", e);
      setOrderStatus(
        `✅ Pedido confirmado (Supabase). ⚠️ No se pudo enviar a Sheets: ${e.message || e}`,
        "err",
      );
      return;
    }

    setOrderStatus("✅ Pedido confirmado.", "ok");
    cart.length = 0;
    updateCart();
    renderProducts();
    showSection("productos");
  } catch (e) {
    console.error("submitOrder error:", e);
    setOrderStatus(`Error confirmando pedido: ${e.message || e}`, "err");
  } finally {
    window.__submittingOrder = false;
    if (btn) btn.disabled = false;
  }
}

function refreshSubmitEnabled() {
  const btn = document.getElementById("submitOrderBtn");
  if (!btn) return;

  const shipSel = document.getElementById("shippingSelect");
  const paySel = document.getElementById("paymentSelect");

  const hasShipping = !!(shipSel && String(shipSel.value || "").trim());
  const hasPayment = isAdmin ? true : !!(paySel && String(paySel.value || "").trim());

  btn.disabled = !(hasShipping && hasPayment);

  // (opcional) feedback visual simple
  btn.classList.toggle("is-disabled", btn.disabled);
}

async function openMyOrders() {
  await openProfile();
}
window.openMyOrders = openMyOrders;

function openChangePassword() {
  if (!currentSession) {
    openLogin();
    return;
  }

  showSection("perfil");
  closeUserMenu?.();

  // ✅ abrir usando la función global del modal (la del PASO 1)
  // Esperamos 1 tick para asegurar que el DOM del perfil esté visible
  setTimeout(() => {
    if (typeof window.openPassModal === "function") {
      window.openPassModal();
    } else {
      // fallback por si algo falló
      const passModal = document.getElementById("passModal");
      if (passModal) {
        passModal.classList.remove("hidden");
        passModal.setAttribute("aria-hidden", "false");
        document.getElementById("newPass1")?.focus();
      }
    }
  }, 0);
}
window.openChangePassword = openChangePassword;

function openPassModal() {
  const passModal = document.getElementById("passModal");
  if (!passModal) return;

  passModal.classList.add("open"); // ✅ clave
  passModal.classList.remove("hidden"); // por si existe
  passModal.setAttribute("aria-hidden", "false");

  document.getElementById("newPass1")?.focus();
}

function closePassModal() {
  const passModal = document.getElementById("passModal");
  if (!passModal) return;

  passModal.classList.remove("open"); // ✅ clave
  passModal.classList.add("hidden");
  passModal.setAttribute("aria-hidden", "true");
}

function togglePassword(inputId, el) {
  const input = document.getElementById(inputId);
  if (!input) return;

  if (input.type === "password") {
    input.type = "text";
    el.textContent = "🙈";
  } else {
    input.type = "password";
    el.textContent = "👁";
  }
}

function togglePassword(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input || !btnEl) return;

  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";
  btnEl.setAttribute("data-show", isHidden ? "1" : "0");
}

/***********************
 * INIT (arranque de la web) — CORREGIDO ✅
 ***********************/
document.addEventListener("DOMContentLoaded", async () => {

  WEB_ORDER_DISCOUNT = await getWebOrderDiscount();
  // ===== LOADER CONTROL (solo 1ra vez por página) =====
  (function () {
    const loader = document.getElementById("pageLoader");
    if (!loader) return;

    const key = `lk_loader_seen_v1:${location.pathname.split("/").pop()}`;

    if (localStorage.getItem(key) === "1") {
      loader.remove();
      return;
    }

    const delay = 5000 + Math.random() * 5000; // 5 a 10s

    setTimeout(() => {
      loader.style.transition = "opacity 0.5s ease";
      loader.style.opacity = "0";
      setTimeout(() => {
        try {
          localStorage.setItem(key, "1");
        } catch {}
        loader.remove();
      }, 500);
    }, delay);
  })();
  // Exponer funciones al HTML (onclick)
  // ✅ recuperar carrito guardado (si venís de sugerencias, etc.)
  const saved = loadCartFromLS();
  if (saved.length) {
    cart.splice(0, cart.length, ...saved);
  }
  window.showSection = showSection;
  window.goToProductsTop = goToProductsTop;
  window.openLogin = openLogin;
  window.closeLogin = closeLogin;
  window.login = login;
  window.logout = logout;

  window.addFirstBox = addFirstBox;
  window.changeQty = changeQty;
  window.manualQty = manualQty;
  window.removeItem = removeItem;
  window.updateCart = updateCart;
  window.submitOrder = submitOrder;
  window.openProfile = openProfile;
  // ✅ Sacar "Cambiar contraseña" del menú aunque no tenga id
  function removeChangePassItems() {
    document
      .querySelectorAll(
        "#userMenu .user-menu-item, #userMenu button, #userMenu a, #userMenu div, #userMenu span",
      )
      .forEach((el) => {
        const t = (el.textContent || "").trim().toLowerCase();
        if (t === "cambiar contraseña" || t.includes("cambiar contraseña")) {
          el.remove();
        }
      });

    // mobile (por si también existe)
    document
      .querySelectorAll(
        "#mobileUserMenu .user-menu-item, #mobileUserMenu button, #mobileUserMenu a, #mobileUserMenu div, #mobileUserMenu span",
      )
      .forEach((el) => {
        const t = (el.textContent || "").trim().toLowerCase();
        if (t === "cambiar contraseña" || t.includes("cambiar contraseña")) {
          el.remove();
        }
      });
  }

  // correr al cargar y también después (por si se renderiza tarde)
  removeChangePassItems();
  setTimeout(removeChangePassItems, 300);
  setTimeout(removeChangePassItems, 1000);

  // =============================
  // SORT (desktop botones + selects + mobile) ✅ ÚNICO BLOQUE
  // =============================
  function applySortUI() {
    const wrap = $("desktopSortButtons");
    if (wrap) {
      wrap.querySelectorAll(".ds-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.sort === sortMode);
      });
    }

    const s1 = $("sortSelect");
    if (s1) s1.value = sortMode;

    const s2 = $("mobileSortSelect");
    if (s2) s2.value = sortMode;
  }

  function syncNewFilterBtn() {
    const b = $("btnFilterNew");
    if (b) b.classList.toggle("on", !!filterNewOnly);
  }

  $("btnFilterNew")?.addEventListener("click", () => {
    filterNewOnly = !filterNewOnly;
    syncNewFilterBtn();
    renderProducts();
  });

  function syncMyAssortmentBtn() {
  const b = $("btnFilterAssortment");
  if (b) b.classList.toggle("on", !!filterMyAssortment);
}

// estado inicial
syncMyAssortmentBtn();

$("btnFilterAssortment")?.addEventListener("click", async () => {
  if (!currentSession) return openLogin();

  if (!customerProfile?.cod_cliente) {
    await refreshAuthState();
  }

  filterMyAssortment = !filterMyAssortment;
  syncMyAssortmentBtn();

  if (filterMyAssortment) {
    myAssortmentIds = await loadMyAssortmentIds();

    console.log("MI SURTIDO cod_cliente:", customerProfile?.cod_cliente);
    console.log("MI SURTIDO ids size:", myAssortmentIds?.size);
    console.log(
      "MI SURTIDO sample ids:",
      Array.from(myAssortmentIds || []).slice(0, 10),
    );
    console.log(
      "PRODUCTS loaded:",
      products?.length,
      "sample product ids:",
      (products || []).slice(0, 10).map((p) => String(p.id)),
    );
  } else {
    myAssortmentIds = null;
  }

  const banner = document.getElementById("assortmentBanner");
  if (banner) {
    banner.style.display = filterMyAssortment ? "block" : "none";
  }

  renderProducts();
});

  // TOAST VER PEDIDOS
  window.addEventListener("resize", positionViewOrderToastBelowHeader);

  // al iniciar
  syncNewFilterBtn();

  async function setSortMode(next) {
  sortMode = String(next || "category");
  applySortUI();

  renderProducts();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

  $("desktopSortButtons")?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".ds-btn");
  if (!btn) return;

  const nextSort = String(btn.dataset.sort || "").trim();
  if (!nextSort) return;

  // NO tocar filtros activos
  await setSortMode(nextSort);

  // volver a renderizar respetando filtros actuales
  renderProducts();
});

  $("sortSelect")?.addEventListener("change", async (e) => {
    await setSortMode(e.target.value);
  });

  $("mobileSortSelect")?.addEventListener("change", async (e) => {
    await setSortMode(e.target.value);
  });

  applySortUI();

  // =============================
  // CUIT live format
  // =============================
  function formatCUITLive(value) {
    const d = String(value || "")
      .replace(/\D/g, "")
      .slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
  }

  const cuitEl = $("cuitInput");
  if (cuitEl) {
    cuitEl.addEventListener("input", (e) => {
      const el = e.target;
      const start = el.selectionStart;
      const before = el.value;

      el.value = formatCUITLive(el.value);

      const diff = el.value.length - before.length;
      const next = (start ?? el.value.length) + diff;
      el.setSelectionRange(next, next);
    });
  }

  // =============================
  // CATEGORÍAS (UNA SOLA IMPLEMENTACIÓN)
  // =============================
  function closeCategoriesMenuFixed() {
    const menu = $("categoriesMenu");
    if (!menu) return;
    menu.classList.remove("open");
    menu.style.opacity = "0";
    menu.style.visibility = "hidden";
    menu.style.pointerEvents = "none";
    menu.style.transform = "translateY(6px)";
  }

  function toggleCategoriesMenuFixed() {
    const menu = $("categoriesMenu");
    if (!menu) return;

    const willOpen = !menu.classList.contains("open");
    closeUserMenu?.();

    menu.classList.toggle("open", willOpen);

    if (willOpen) {
      menu.style.opacity = "1";
      menu.style.visibility = "visible";
      menu.style.pointerEvents = "auto";
      menu.style.transform = "translateY(0)";
    } else {
      closeCategoriesMenuFixed();
    }
  }

  // si ya tenías funciones globales, las unificamos acá
  window.closeCategoriesMenu = closeCategoriesMenuFixed;
  window.toggleCategoriesMenu = toggleCategoriesMenuFixed;

  // estado inicial cerrado
  closeCategoriesMenuFixed();

  $("categoriesBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleCategoriesMenuFixed();
  });

  // Ver Pedido animacion
  document.getElementById("viewOrderBtn")?.addEventListener("click", () => {
    hideViewOrderToast();
    showSection("carrito");
  });

  // Botón dentro del perfil
  document
    .getElementById("btnOpenPassModal")
    ?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPassModal();
    });

  // Cierres
  document
    .getElementById("btnClosePassModal")
    ?.addEventListener("click", closePassModal);
  document
    .getElementById("passModalBackdrop")
    ?.addEventListener("click", closePassModal);
  document
    .getElementById("btnChangePass")
    ?.addEventListener("click", changePasswordUI);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePassModal();
  });

  // =============================
  // USER MENU DESKTOP (BOTÓN ÚNICO userToggleBtn)
  // =============================
  const userBtn = $("userToggleBtn");
  const userMenu = $("userMenu");

  function openUserMenuFixed() {
    if (!userMenu) return;
    userMenu.classList.add("open");
    userMenu.setAttribute("aria-hidden", "false");
    userBtn?.setAttribute("aria-expanded", "true");
  }

  function closeUserMenuFixed() {
    if (!userMenu) return;
    userMenu.classList.remove("open");
    userMenu.setAttribute("aria-hidden", "true");
    userBtn?.setAttribute("aria-expanded", "false");
  }

  function toggleUserMenuFixed() {
    if (!userMenu) return;
    const isOpen = userMenu.classList.contains("open");
    if (isOpen) closeUserMenuFixed();
    else openUserMenuFixed();
  }

  // forzar que tus otras partes usen estas funciones
  window.closeUserMenu = closeUserMenuFixed;
  window.toggleUserMenu = toggleUserMenuFixed;

  // estado inicial cerrado
  closeUserMenuFixed();

  if (userBtn) {
    userBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleUserMenuFixed();
    });
  }

  if (userMenu) {
    userMenu.addEventListener("click", (e) => e.stopPropagation());
  }

  // =============================
  // PAGO (botones)
  // =============================
  $("paymentButtons")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".pay-btn");
    if (!btn) return;

    // ✅ Si clickea "Prefiero no decidir ahora", lo tratamos como método válido
    if (btn.id === "payLaterBtn") {
      const ps = $("paymentSelect");
      if (ps) ps.value = "LATER";

      document
        .querySelectorAll("#paymentButtons .pay-btn")
        .forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");

      updateCart();
      refreshSubmitEnabled();
      return;
    }

    // ✅ Resto de botones normales (con descuento)
    setPaymentByValue(btn.dataset.value);

    document
      .querySelectorAll("#paymentButtons .pay-btn")
      .forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    $("payLaterBtn")?.classList.remove("selected");

    updateCart();
    refreshSubmitEnabled();
  });

  $("payLaterBtn")?.addEventListener("click", () => {
    // ✅ Igual que arriba: setea una opción real
    const ps = $("paymentSelect");
    if (ps) ps.value = "LATER";

    document
      .querySelectorAll("#paymentButtons .pay-btn")
      .forEach((b) => b.classList.remove("selected"));
    $("payLaterBtn")?.classList.add("selected");

    updateCart();
    refreshSubmitEnabled();
  });

  // Pago (select)
  $("paymentSelect")?.addEventListener("change", () => {
    syncPaymentButtons();
    updateCart();
    refreshSubmitEnabled();
  });

  // Mobile: carrito -> Pedido
  $("mobileCartBtn")?.addEventListener("click", () => showSection("carrito"));

  // Mobile: avatar -> dropdown (si no logueado => login)
  $("mobileProfileBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentSession) return openLogin();
    toggleMobileUserMenu();
  });

  // PERFIL: WhatsApp + password
  $("btnAddAddress")?.addEventListener("click", () => {
    const name = (customerProfile?.business_name || "").trim();
    const cod = (customerProfile?.cod_cliente || "").trim();
    const msg = `Hola! Soy ${name}${cod ? ` (Cod Cliente ${cod})` : ""}. Quiero agregar una sucursal de entrega.`;
    window.open(waLink(msg), "_blank", "noopener");
  });

  $("btnReportError")?.addEventListener("click", () => {
    const name = (customerProfile?.business_name || "").trim();
    const cod = (customerProfile?.cod_cliente || "").trim();
    const msg = `Hola! Soy ${name}${cod ? ` (Cod Cliente ${cod})` : ""}. Quiero avisar que hay un error en la web mayorista.`;
    window.open(waLink(msg), "_blank", "noopener");
  });

  $("btnChangePass")?.addEventListener("click", () => changePasswordUI());

  // =============================
  // PERFIL - Modal contraseña (UNA SOLA VEZ)
  // =============================

  // Entregas
  const shipSel = $("shippingSelect");
  if (shipSel) {
    deliveryChoice = { slot: shipSel.value || "", label: "" };

    shipSel.addEventListener("change", () => {
      const opt = shipSel.options[shipSel.selectedIndex];
      deliveryChoice.slot = shipSel.value || "";
      deliveryChoice.label = opt?.dataset?.label || opt?.textContent || "";
      updateCart();
      refreshSubmitEnabled();
    });
  }

  // =============================
  // Click afuera: cerrar menús (UNA SOLA VEZ)
  // =============================
  document.addEventListener("click", (e) => {
    // categorías
    const catBtn = $("categoriesBtn");
    const catMenu = $("categoriesMenu");
    const insideCat =
      (catBtn && catBtn.contains(e.target)) ||
      (catMenu && catMenu.contains(e.target));
    if (!insideCat) closeCategoriesMenuFixed();

    // user desktop
    const insideUser =
      (userBtn && userBtn.contains(e.target)) ||
      (userMenu && userMenu.contains(e.target));
    if (!insideUser) closeUserMenuFixed();

    // user mobile
    const mMenu = $("mobileUserMenu");
    const mBtn = $("mobileProfileBtn");
    if (mMenu && mBtn) {
      const insideM = mMenu.contains(e.target) || mBtn.contains(e.target);
      if (!insideM) closeMobileUserMenu();
    }
  });

  // Buscador NAV
  const navSearch = $("navSearch");
  if (navSearch) {
    navSearch.addEventListener("input", () => {
      searchTerm = String(navSearch.value || "").trim();
      renderProducts();
    });
  }

  // Buscador Mobile
  const mobileSearch = $("mobileSearch");
  if (mobileSearch) {
    mobileSearch.addEventListener("input", () => {
      searchTerm = String(mobileSearch.value || "").trim();
      renderProducts();
    });
  }

  // Mobile filtros overlay
  $("openFiltersBtn")?.addEventListener("click", () => openFiltersOverlay());
  $("filtersCancelBtn")?.addEventListener("click", () =>
    cancelPendingFilters(),
  );
  $("filtersApplyBtn")?.addEventListener("click", () => applyPendingFilters());

  $("filtersOverlay")?.addEventListener("click", (e) => {
    if (e.target.id === "filtersOverlay") closeFiltersOverlay();
  });

  // =============================
  // Cargar sesión inicial y productos
  // =============================
  const { data } = await supabaseClient.auth.getSession();
  currentSession = data.session || null;

  await refreshAuthState();

  // ===== TEST HISTORIAL RLS =====
  if (currentSession) {
    const { data: histData, error: histError } = await supabaseClient
      .from("v_customer_history")
      .select("*")
      .order("invoice_date", { ascending: false })
      .limit(20);

    console.log("HISTORIAL TEST:", {
      error: histError,
      rows: histData?.length,
      sample: histData?.[0],
      keys: histData?.[0] ? Object.keys(histData[0]) : [],
    });
    window.__histSample = histData?.[0] || null;
  }
  await loadProductsFromDB();

  await loadProductsFromDB();

  // =============================
  // ✅ Importar agregados desde HISTORIAL
  // =============================
  (function importFromHistoryIfAny() {
    const HISTORY_PENDING_KEY = "lk_pending_adds_cod_v1";
    try {
      const raw = localStorage.getItem(HISTORY_PENDING_KEY);
      if (!raw) return;

      const list = JSON.parse(raw);
      if (!Array.isArray(list) || !list.length) return;

      list.forEach(({ cod, qty }) => {
        const c = String(cod || "").trim();
        const q = Math.max(1, parseInt(qty, 10) || 1);
        if (!c) return;

        const prod = products.find((p) => String(p.cod) === c);
        if (!prod) return;

        const found = cart.find(
          (ci) => String(ci.productId) === String(prod.id),
        );

        if (found) found.qtyCajas += q;
        else cart.push({ productId: String(prod.id), qtyCajas: q });
      });

      localStorage.removeItem(HISTORY_PENDING_KEY);
    } catch (e) {
      console.warn("Import history failed:", e);
    }
  })();

  renderCategoriesMenu();
  renderCategoriesSidebar();
  renderProducts();
  updateCart();
  syncPaymentButtons();

  // Reactividad login/logout
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentSession = session;

    // reset surtido al cambiar sesión
  filterMyAssortment = false;
  myAssortmentIds = null;
  syncMyAssortmentBtn?.();  

    searchTerm = "";
    const ns = $("navSearch");
    if (ns) ns.value = "";

    await refreshAuthState();
    await loadProductsFromDB();

    renderCategoriesMenu();
    closeCategoriesMenuFixed();

    renderCategoriesSidebar();
    renderProducts();
    updateCart();

    syncPaymentButtons();
  });

  document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible") return;

  try {
    await refreshAuthState();

    if (filterMyAssortment && currentSession && customerProfile?.cod_cliente) {
      myAssortmentIds = await loadMyAssortmentIds();
    }

    renderProducts();
    updateCart();
    syncPaymentButtons();
  } catch (e) {
    console.warn("Error al reactivar pestaña:", e);
  }
});

window.addEventListener("pageshow", async () => {
  try {
    await refreshAuthState();

    if (filterMyAssortment && currentSession && customerProfile?.cod_cliente) {
      myAssortmentIds = await loadMyAssortmentIds();
    }

    renderProducts();
    updateCart();
    syncPaymentButtons();
  } catch (e) {
    console.warn("Error en pageshow:", e);
  }
});

});

function getCodClienteForHistorial() {
  const dom = (
    document.getElementById("pfCodCliente")?.textContent || ""
  ).trim();

  const ls =
    localStorage.getItem("cod_cliente") ||
    localStorage.getItem("codCliente") ||
    localStorage.getItem("cliente") ||
    localStorage.getItem("customer") ||
    localStorage.getItem("customer_id") ||
    "";

  const v = (dom && dom !== "—" ? dom : ls || "").trim();
  return v && v !== "—" ? v : "";
}

function openHistorialFromMenu(v) {
  const vista = v || "hist"; // default seguro
  window.location.href = `./historial.html?v=${encodeURIComponent(vista)}`;
}

// ====== HISTORIAL / SUGERENCIAS / NOVEDADES DESDE EL MENÚ ======

function getCodClienteFromProfileOrStorage() {
  // 1) Si ya está pintado en el perfil:
  const dom = (
    document.getElementById("pfCodCliente")?.textContent || ""
  ).trim();
  if (dom && dom !== "—") return dom;

  // 2) Si lo guardaste en storage (probamos varias keys típicas)
  const ls =
    localStorage.getItem("cod_cliente") ||
    localStorage.getItem("codCliente") ||
    localStorage.getItem("cliente") ||
    localStorage.getItem("customer") ||
    localStorage.getItem("customer_id") ||
    "";

  return (ls || "").trim();
}

// ===== HISTORIAL / SUGERENCIAS / NOVEDADES =====

function getCodClienteFromProfileOrStorage() {
  const dom = (
    document.getElementById("pfCodCliente")?.textContent || ""
  ).trim();
  if (dom && dom !== "—") return dom;

  const ls =
    localStorage.getItem("cod_cliente") ||
    localStorage.getItem("codCliente") ||
    localStorage.getItem("cliente") ||
    localStorage.getItem("customer") ||
    localStorage.getItem("customer_id") ||
    "";

  return (ls || "").trim();
}

function abrirHistorial() {
  const path = window.location.pathname;
  const base = path.includes("/productos-main/")
    ? "/productos-main/"
    : path.includes("/productos/")
      ? "/productos/"
      : "/";

  window.location.href = base + "historial.html";
}
