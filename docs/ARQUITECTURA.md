# Arquitectura

## Visión general

```
┌────────────────────── Aplicación web (navegador) ───────────────────────┐
│  UI React  ──►  Editor Blockly  ──►  Compilador  ──►  IR (datos)         │
│     ▲                                              │                     │
│     │ estado                                       ▼                     │
│  RobotSession ◄── RobotClient ◄──────────  Motor de ejecución            │
│  (módulos, capacidades)  (protocolo JSON, ack/done, plazos, latido)      │
│                          │                                               │
│                    Transport  ── WebSerial (USB)  |  Simulador  | (Wi‑Fi)│
└──────────────────────────┼───────────────────────────────────────────────┘
                           ▼  USB serie, JSON por líneas (docs/PROTOCOLO.md)
                ESP32 · Módulo 1 (coordinador)
                           ▼  I²C (SDA/SCL) + INT, pogo pins
              ESP32‑C3 · Módulo 2          ESP32‑C3 · Módulo 3
```

## Decisiones

| Decisión | Motivo |
|---|---|
| **App web (Vite + React + TypeScript estricto)** en lugar de Electron | El repositorio estaba vacío. La Web Serial API (Chrome/Edge) da acceso USB sin instalar nada; se puede empaquetar con Electron/Tauri más adelante sin tocar el núcleo. |
| **Blockly 13** (solo `blockly/core`) con bloques propios | Estándar educativo; los bloques propios permiten validar cada parámetro y ocultar los que dependen de módulos ausentes. |
| **Compilador a IR** en vez de generar JavaScript | No se usa `eval` ni `new Function` (ESLint lo prohíbe). La IR es un árbol de datos validado que se puede mostrar («Instrucciones»), probar y, en el futuro, enviar entera al robot. |
| **Motor en la app**, una orden cada vez con confirmación | Permite resaltar el bloque activo, parar al instante y gestionar errores con mensajes claros. Las duraciones las controla el firmware (más seguro si se corta el enlace). |
| **Capacidades informadas por el firmware** | La caja de herramientas se construye solo con lo que el robot dice tener operativo. Sin conexión, ningún módulo aparece como detectado. |
| Sin dependencias de estado o validación externas | Validadores escritos a mano y pequeños; `useSyncExternalStore` para el estado. |

## Estructura de `src/`

| Carpeta | Responsabilidad |
|---|---|
| `protocol/` | Tipos de mensajes, catálogo de comandos con rangos, codec JSON por líneas, versionado. |
| `transport/` | Interfaz `Transport` y transporte USB (`WebSerialTransport`). |
| `simulator/` | Robot virtual que habla el mismo protocolo + su transporte. |
| `robot/` | `RobotClient` (peticiones, plazos, latido, pérdida de enlace), `RobotSession` (estado de módulos y capacidades), mensajes de error. |
| `blocks/` | Definiciones visuales, caja de herramientas por capacidades, compilador bloques → IR, registro en Blockly. |
| `program/` | IR, listado legible, programa de ejemplo. |
| `engine/` | `ProgramRunner` (intérprete) y `ExecutionController` (política de seguridad). |
| `persistence/` | Proyectos en `localStorage`, autoguardado, exportar/importar `.robot.json`. |
| `ui/` | Componentes React y estilos. |

## Política de seguridad durante la ejecución

| Situación | Reacción |
|---|---|
| Usuario pulsa Detener / Esc | Se corta el programa (incluidas esperas) y se envía `STOP`. |
| Error de una orden o lectura inválida | Programa detenido, `STOP`, mensaje y bloque señalado. |
| Se desconecta un módulo **que el programa usa** | Programa detenido, `STOP`, aviso «Se desconectó … El robot se detuvo por seguridad». |
| Se desconecta un módulo que el programa no usa | El programa sigue; sus bloques desaparecen de la caja. |
| Antes de cada orden | Si su módulo ya no está, no se envía. |
| Pérdida del enlace (sin mensajes 3,5 s o cable fuera) | Programa detenido, módulos «Sin conexión»; el firmware se detiene solo (vigilancia de 2 s). |

## Identificación de módulos (propuesta para electrónica y firmware)

> **Pendiente de validar con el responsable de electrónica.** La app ya funciona con
> cualquier estrategia física siempre que el Módulo 1 envíe los informes de `PROTOCOLO.md`.

1. **Identificación digital por I²C (obligatoria).** Cada ESP32‑C3 es esclavo I²C con una
   dirección fija por tipo (propuesta: Módulo 2 = `0x42`, Módulo 3 = `0x43`) y expone
   registros de identidad:

   | Registro | Contenido |
   |---|---|
   | `0x00` | Magic `0xB0` (descarta otros dispositivos en esa dirección) |
   | `0x01` | `typeId` (2 = sensores, 3 = interfaz) |
   | `0x02` | Versión de protocolo I²C |
   | `0x03‑0x05` | Firmware mayor.menor.parche |
   | `0x06` | Mapa de bits de capacidades operativas |
   | `0x07` | Estado (0 = ok, otro = código de error) |
   | `0x08` | CRC‑8 de `0x00‑0x07` |

   El Módulo 1 sondea cada ~500 ms. Un módulo se da por **detectado** solo si el magic,
   el tipo y el CRC son correctos (no basta con un ACK en el bus). Tras 2–3 fallos
   seguidos pasa a **ausente**; si responde con datos incoherentes, a **error**. Cada
   cambio se envía como evento `modules`.

2. **Línea INT (opcional).** Colector abierto compartido: un módulo la baja al conectarse
   o cuando tiene datos (p. ej. botón pulsado) para que el Módulo 1 sondee de inmediato.

3. **Pin ID.** Una resistencia en un único pin compartido **no** puede distinguir dos
   módulos conectados a la vez (las resistencias quedan en paralelo y las combinaciones
   son ambiguas con tolerancias reales). Si se usa, que sea solo como detección de
   presencia por conector (un pin ID por puerto del Módulo 1) y siempre confirmada por I²C.

4. Riesgos a revisar: direcciones I²C duplicadas si se apilan dos módulos del mismo
   tipo; conexión en caliente (proteger SDA/SCL y alimentación); resistencias pull‑up
   (una sola vez, en el Módulo 1); longitud del bus a través de los pogo pins.
