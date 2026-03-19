<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>Historial de Compras · Loekemeyer SRL</title>

    <!-- Supabase UMD (SOLO UNA VEZ) -->
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
    <link rel="stylesheet" href="css/historial.css" />
    <link rel="icon" type="image/jpeg" href="img/favicon.png" />
    <link rel="icon" href="img/favicon.png" />
    <link rel="shortcut icon" href="img/favicon.png" />
  </head>

  <body>
    <div class="card">
      <button
        class="back-btn"
        type="button"
        onclick="window.location.href = 'mayorista.html'"
      >
        ← Volver a productos
      </button>

      <h1>Historial de compras</h1>
      <div id="cliente"></div>
      <div id="status">Cargando...</div>

      <table id="tabla" style="display: none">
        <thead id="thead"></thead>
        <tbody id="tbody"></tbody>
      </table>
    </div>

    <!-- Tu lógica del historial -->
    <script src="historial.js"></script>
  </body>
</html>
