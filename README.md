# Robot Modular — Programación por bloques

Aplicación web para programar con bloques (Blockly) el robot educativo modular,
ver qué módulos tiene conectados y ejecutar programas, para niños de 10 a 14 años.

## Uso

```bash
npm install
npm run dev        # http://localhost:5173  (usar Chrome o Edge para USB)
```

- **🔌 Conectar robot (USB):** abre el selector de puertos serie del navegador (Web Serial, 115200 baudios).
- **📶 Conectar por Wi‑Fi:** carga `firmware/modulo1_wifi/modulo1_wifi.ino` en el ESP32 del
  Módulo 1, conecta el PC a la red `RobotModular` (clave `robot1234`) y pulsa el botón
  (dirección por defecto `192.168.4.1`).
- **🧪 Usar simulador:** robot virtual para trabajar sin hardware. Se muestra siempre la
  franja «MODO SIMULADOR» y el panel «Robot virtual» con la etiqueta SIMULADO.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Chequeo de tipos + compilación de producción en `dist/` |
| `npm run typecheck` | TypeScript estricto |
| `npm run lint` | ESLint (prohíbe `eval`/`Function`) |
| `npm test` | Pruebas (Vitest + Testing Library) |
| `npm run check` | Todo lo anterior |

## Documentación

- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) — capas, decisiones, política de seguridad e identificación de módulos.
- [`docs/PROTOCOLO.md`](docs/PROTOCOLO.md) — protocolo App ⇄ Módulo 1 (v1.0).

## Estado

**Funciona:** detección y estado de módulos según el robot, caja de bloques que cambia
con los módulos, edición/validación de programas, ejecución paso a paso con confirmación,
detener (botón o Esc), reiniciar, errores comprensibles, proyectos guardados/exportados,
simulador con inyección de fallos.

**Pendiente para el robot físico:**
1. Firmware del Módulo 1 que implemente `docs/PROTOCOLO.md` (todavía no existe).
2. Asignación eléctrica definitiva de los pogo pins (VCC, GND, SDA, SCL, ID, INT) con electrónica.
3. Firmware I²C de los ESP32‑C3 (registro de identidad propuesto en `ARQUITECTURA.md`).
4. Calibración de servos (ángulos de pinza abierta/cerrada) y rango de velocidades reales.
5. Prueba de extremo a extremo con hardware (latencias reales para ajustar los plazos).
6. Transporte Wi‑Fi (WebSocket) si se necesita; basta implementar la interfaz `Transport`.
