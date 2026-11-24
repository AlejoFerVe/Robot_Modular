# Protocolo de aplicación App ⇄ Módulo 1 — versión 1.0

> Estado: **provisional**. Implementado en la app (`src/protocol/`) y en el simulador
> (`src/simulator/SimulatedRobot.ts`). **El firmware del ESP32 todavía no lo implementa.**

Este protocolo une la aplicación con el **ESP32 del Módulo 1**. No es el protocolo I²C
entre el Módulo 1 y los módulos 2 y 3 (ver `ARQUITECTURA.md`).

## 1. Transporte y formato

| Aspecto | Valor |
|---|---|
| Transporte del prototipo | USB serie (CDC), **115200 baudios**, 8N1 |
| Transporte Wi‑Fi | WebSocket `ws://192.168.4.1:81/` (el ESP32 crea la red `RobotModular`); mismo formato, un mensaje de texto por objeto JSON. Implementado en `firmware/modulo1_wifi/` y `src/transport/WebSocketTransport.ts` |
| Codificación | UTF‑8, **un objeto JSON por línea**, terminado en `\n` (se tolera `\r\n`) |
| Longitud máxima de línea | 2048 bytes (las más largas se descartan completas) |
| Campo de versión | `"v": 1` en todos los mensajes (versión **mayor** del protocolo) |

El firmware no debe escribir en el puerto serie nada que no sea JSON del protocolo
(trazas de depuración → otro UART o desactivadas). La app ignora y registra las líneas
ilegibles, pero **nunca** las toma como confirmación.

## 2. Mensajes

### Petición (App → Robot)
```json
{"v":1,"type":"req","id":12,"cmd":"MOVE_FORWARD","args":{"speed":50,"duration_ms":2000}}
```
`id` es un entero ≥ 0 único por conexión, generado por la app.

### Respuestas (Robot → App)
| `type` | Cuándo | Ejemplo |
|---|---|---|
| `ack` | La orden es válida y **empieza** a ejecutarse | `{"v":1,"type":"ack","id":12}` |
| `done` | La orden **terminó** correctamente (con resultado opcional) | `{"v":1,"type":"done","id":12,"result":{}}` |
| `err` | La orden se rechazó o falló | `{"v":1,"type":"err","id":12,"code":"BUSY","msg":"..."}` |

Secuencia normal: `req → ack → done`. Un `err` puede llegar en lugar del `ack`
(rechazo) o después del `ack` (fallo o aborto). Un `done` sin `ack` previo se acepta.
`err` con `"id": null` = error no asociable a una petición (p. ej. JSON ilegible).

### Eventos espontáneos (Robot → App)
```json
{"v":1,"type":"evt","evt":"modules","modules":[ ...informe de módulos... ]}
{"v":1,"type":"evt","evt":"status","busy":false,"uptime_ms":123456}
```
- `modules`: se envía **cada vez que cambia** el estado de un módulo.
- `status`: latido periódico (recomendado cada 1 s).

## 3. Tiempos y detección de desconexión

| Regla | Valor actual (app) |
|---|---|
| Plazo para recibir `ack` | 1000 ms |
| Plazo para recibir `done` tras `ack` | duración esperada de la orden + 1500 ms |
| App → Robot: `PING` | cada 1000 ms |
| Robot sin recibir nada → enlace perdido | 3500 ms (app) |
| **Vigilancia en el firmware** | si no recibe ningún mensaje en **2000 ms**, detiene motores, servos y buzzer |

Si un plazo vence, la orden falla con `TIMEOUT`; si el enlace se pierde, el programa se
detiene y la interfaz deja de mostrar los módulos como detectados.

## 4. Comandos

Fuente única de verdad: `src/protocol/commands.ts`. El firmware debe validar los mismos rangos.

| Comando | Capacidad | Parámetros | Resultado en `done` |
|---|---|---|---|
| `HELLO` | — | `app_protocol`: texto (p. ej. `"1.0"`) | ver §5 |
| `PING` | — | — | `{}` |
| `GET_MODULES` | — | — | `{"modules":[...]}` |
| `STOP` | — | — | `{}` (ver §6) |
| `MOVE_FORWARD` / `MOVE_BACKWARD` | `motion` | `speed` 0‑100 (%), `duration_ms` 0‑30000 | `{}` al terminar el movimiento |
| `TURN_LEFT` / `TURN_RIGHT` | `motion` | `speed` 0‑100, `duration_ms` 0‑30000 | `{}` |
| `STOP_MOTORS` | `motion` | — | `{}` |
| `SET_SERVO` | `arms` | `servo` ∈ `shoulder_left`, `shoulder_right`, `gripper_left`, `gripper_right`; `angle` 0‑180 | `{}` |
| `GRIPPER` | `arms` | `side` ∈ `left`,`right`; `action` ∈ `open`,`close` | `{}` (ángulos de abrir/cerrar los calibra el firmware) |
| `READ_COLOR` | `color_sensor` | — | `{"color":"red"}` (`red`, `green`, `blue`, `yellow`, `black`, `white`, `unknown`) |
| `READ_DISTANCE` | `distance` | — | `{"cm":23.5}` (0‑1000) |
| `SET_LED` | `leds` | `led` 0‑4 (0 = todos), `on` booleano | `{}` |
| `TOGGLE_LED` | `leds` | `led` 0‑4 | `{}` |
| `BEEP` | `buzzer` | `duration_ms` 10‑5000 | `{}` al terminar el sonido |
| `PLAY_TONE` | `buzzer` | `freq_hz` 100‑5000, `duration_ms` 10‑5000 | `{}` |
| `DISPLAY_TEXT` | `display` | `text` ≤ 32 caracteres | `{}` |
| `DISPLAY_CLEAR` | `display` | — | `{}` |
| `READ_BUTTON` | `buttons` | `button` ∈ `A`,`B` | `{"pressed":true}` |

Los movimientos los temporiza **el firmware**: si se corta la comunicación a mitad, el
robot se detiene solo al acabar la duración (o antes, por la vigilancia de §3).

## 5. Saludo y versionado

Respuesta a `HELLO`:
```json
{"v":1,"type":"done","id":1,"result":{
  "protocol":"1.0","robot":"robot-modular","firmware":"0.1.0",
  "modules":[
    {"type":"base","typeId":1,"firmware":"0.1.0","capabilities":["motion","arms","color_sensor"],"state":"ok"},
    {"type":"sensors","typeId":2,"firmware":"0.1.0","capabilities":["distance","leds","buzzer"],"state":"ok"},
    {"type":"interface","typeId":3,"firmware":"","capabilities":[],"state":"absent"}
  ]}}
```
- **Mayor** (`v` y primer número de `protocol`): cambios incompatibles. Si no coincide, la app se niega a conectar (`INCOMPATIBLE`) y el firmware responde `VERSION_MISMATCH`.
- **Menor**: añadidos compatibles (nuevos comandos o capacidades). La app ignora capacidades desconocidas y solo ofrece bloques de las capacidades que conoce **y** que el robot informa.

### Informe de módulo
| Campo | Tipo | Notas |
|---|---|---|
| `type` | `base` \| `sensors` \| `interface` | |
| `typeId` | entero | identificador leído del registro I²C del módulo |
| `firmware` | texto semver | vacío si ausente |
| `capabilities` | lista | **solo lo implementado y operativo** en ese firmware |
| `state` | `ok` \| `error` \| `absent` | `error` = responde mal o falla la verificación |
| `error` | texto opcional | código del fallo |

**Regla importante:** el firmware solo debe anunciar capacidades que ya funcionen. Así la
app nunca muestra bloques sin implementación real.

## 6. Parada (STOP) y concurrencia

- El robot ejecuta **una orden de actuador a la vez**. Otra mientras tanto → `err BUSY`.
- `STOP` se atiende siempre, incluso con una orden en curso: aborta esa orden (que
  termina con `err ABORTED`), detiene motores y buzzer, y responde `ack` + `done`.
- La app envía `STOP` cuando el usuario pulsa Detener o Esc, cuando el programa falla y
  cuando se desconecta un módulo que el programa usa.

## 7. Códigos de error

`BAD_REQUEST`, `UNKNOWN_COMMAND`, `INVALID_ARGS`, `MODULE_UNAVAILABLE`, `NOT_IMPLEMENTED`,
`BUSY`, `ABORTED`, `HARDWARE_ERROR`, `I2C_ERROR`, `VERSION_MISMATCH`.
La app los traduce a mensajes para niños en `src/robot/errors.ts`.
