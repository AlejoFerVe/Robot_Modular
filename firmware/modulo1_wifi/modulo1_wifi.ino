// =====================================================================
//  MÓDULO 1 (maestro) — Wi‑Fi + programación por bloques
//
//  El ESP32 crea su propia red Wi‑Fi. El PC se conecta a esa red y la app
//  web (Robot Modular) se comunica por WebSocket en ws://192.168.4.1:81
//  usando el protocolo de docs/PROTOCOLO.md (un JSON por mensaje).
//
//  Se conservan los pines, la conexión con los esclavos (HELLO / PING /
//  PONG / WELCOME) y la configuración del PCA9685 y del TCS3200.
//
//  Librerías (Gestor de librerías del IDE de Arduino):
//    - Adafruit PWM Servo Driver Library  (Adafruit)
//    - WebSockets                          (Markus Sattler / Links2004)
//    - ArduinoJson  v7                     (Benoit Blanchon)
//  Placa: ESP32 DevKit de 30 pines → "ESP32 Dev Module" (núcleo Espressif 3.x)
//  Esclavos (Módulo 2): ESP32‑C3 Super Mini, ver firmware/modulo2/
// =====================================================================

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <Adafruit_PWMServoDriver.h>

// ==========================================
// Wi‑Fi (punto de acceso propio del robot)
// ==========================================
const char*    WIFI_SSID     = "RobotModular";
const char*    WIFI_PASSWORD = "robot1234";     // mínimo 8 caracteres
const uint16_t WS_PUERTO     = 81;
// IP fija del robot. Debe coincidir con DEFAULT_WIFI_HOST de la app
// (src/transport/WebSocketTransport.ts).
const IPAddress IP_ROBOT(192, 168, 4, 1);
const IPAddress MASCARA_RED(255, 255, 255, 0);
const char*    FIRMWARE_VERSION = "0.2.0";

// 1 = comportamiento de la prueba anterior (avanza solo + servos tipo reloj).
// 0 = el robot solo se mueve con las órdenes de los bloques.
#define MODO_DEMO 0

// ==========================================
// Motores TB6612FNG
// ==========================================
#define PWM_A  25
#define AIN_2  26
#define AIN_1  27
#define STB_Y  32
#define BIN_1  33
#define BIN_2  2
#define PWM_B  4

// Qué motor es cada lado. Si al girar a la izquierda gira a la derecha,
// cambia MOTOR_IZQUIERDO_ES_A. Si un motor va al revés, invierte su sentido.
#define MOTOR_IZQUIERDO_ES_A 1
#define INVERTIR_MOTOR_A     0
#define INVERTIR_MOTOR_B     0

// ==========================================
// UART hacia los ESP32-C3 Super Mini (esclavos)
// ==========================================
#define Rx_S3_1 14
#define Tx_S3_1 13
#define Rx_S3_2 35   // Solo entrada: pull-up externa de 10k a 3.3V obligatoria
#define Tx_S3_2 23

// ==========================================
// Sensor de color TCS3200
// ==========================================
#define TCS_OUT 34
#define TCS_S2  18
#define TCS_S3  19
#define TCS_S1  16
#define TCS_S0  17

// 1 = se ofrecen los bloques del sensor de color.
#define SENSOR_COLOR_ACTIVO 1

// Umbrales de clasificación (POR CALIBRAR con tus colores reales: mira
// en el monitor serie los valores "[Color]" de cada lectura).
const uint32_t TCS_TIMEOUT_US   = 50000;
const float    UMBRAL_NEGRO     = 2.0;    // "brillo" (clear) por debajo → negro
const float    UMBRAL_BLANCO    = 25.0;   // "brillo" por encima y equilibrado → blanco
const float    DOMINANCIA_COLOR = 0.40;   // proporción mínima de R, G o B

// ==========================================
// PCA9685 (I2C)
// ==========================================
#define I2C_SDA        21
#define I2C_SCL        22
#define PCA_DIRECCION  0x40

const int VELOCIDAD_MOTORES = 200;

// ==========================================
// Servos tipo manecillas de reloj
// ==========================================
const int NUM_SERVOS = 5;
const uint8_t  CANALES_SERVO[NUM_SERVOS]  = {0, 1, 2, 3, 4};
const uint32_t PERIODO_TIC_MS[NUM_SERVOS] = {500, 1000, 1500, 2000, 2500};
const int SERVO_US_MIN = 500;    // pulso para 0°
const int SERVO_US_MAX = 2500;   // pulso para 180°
const int ANGULO_MIN   = 0;
const int ANGULO_MAX   = 180;
const int PASO_GRADOS  = 6;      // avance por tic (como el segundero)

// Servos que ve la app (índices dentro de CANALES_SERVO).
const int SERVO_HOMBRO_IZQ = 0;
const int SERVO_HOMBRO_DER = 1;
const int SERVO_PINZA_IZQ  = 2;
const int SERVO_PINZA_DER  = 3;
// El servo 4 (canal 4) no lo usa la app por ahora.

// Ángulos de la pinza (POR CALIBRAR).
const int PINZA_ABIERTA = 90;
const int PINZA_CERRADA = 20;
const uint32_t TIEMPO_SERVO_MS = 400;   // tiempo que se da al servo para llegar

Adafruit_PWMServoDriver pca(PCA_DIRECCION);
int anguloServo[NUM_SERVOS];
uint32_t tTic[NUM_SERVOS];
bool pcaOk = false;

// ==========================================
// Comunicación con esclavos
// ==========================================
const uint32_t BAUDIOS                  = 115200;
const uint32_t PERIODO_HEARTBEAT_MS     = 1000;
const int      FALLOS_PARA_DESCONEXION  = 3;
const int      PINGS_VERIFICACION       = 5;
const uint32_t TIMEOUT_VERIFICACION_MS  = 100;
const uint32_t ESPERA_ESTABILIZACION_MS = 300;
const uint32_t ENFRIAMIENTO_FALLO_MS    = 3000;

struct Esclavo {
  int id;
  HardwareSerial* puerto;
  String buffer;
  bool conectado;
  bool pingPendiente;
  uint32_t seq;
  int fallos;
  uint32_t tBloqueoHasta;
  bool solicitudVerificacion;
};

Esclavo esclavos[2] = {
  {1, &Serial1, "", false, false, 0, 0, 0, false},
  {2, &Serial2, "", false, false, 0, 0, 0, false}
};

// ==========================================
// Protocolo con la app (WebSocket)
// ==========================================
const uint32_t VIGILANCIA_APP_MS = 2000;   // sin mensajes de la app → parar
const uint32_t PERIODO_STATUS_MS = 1000;
const size_t   MAX_LINEA         = 2048;

WebSocketsServer ws(WS_PUERTO);
int clienteActivo = -1;
String rxLinea = "";
uint32_t tUltimoRx = 0;
bool vigilanciaDisparada = false;

enum Direccion { DIR_ADELANTE, DIR_ATRAS, DIR_IZQUIERDA, DIR_DERECHA };
enum TipoOrden { ORDEN_MOVER, ORDEN_SERVO };

struct Orden {
  bool activa;
  long id;
  TipoOrden tipo;
  uint32_t fin;
  Direccion dir;
  int pwm;
};
Orden orden = {false, 0, ORDEN_MOVER, 0, DIR_ADELANTE, 0};

// ==========================================
// Motores
// ==========================================
void moverAdelante(int velocidad) {
  digitalWrite(STB_Y, HIGH);
  digitalWrite(AIN_1, HIGH);
  digitalWrite(AIN_2, LOW);
  analogWrite(PWM_A, velocidad);
  digitalWrite(BIN_1, HIGH);
  digitalWrite(BIN_2, LOW);
  analogWrite(PWM_B, velocidad);
}

void detenerMotores() {
  digitalWrite(AIN_1, LOW);
  digitalWrite(AIN_2, LOW);
  analogWrite(PWM_A, 0);
  digitalWrite(BIN_1, LOW);
  digitalWrite(BIN_2, LOW);
  analogWrite(PWM_B, 0);
  digitalWrite(STB_Y, LOW);
}

// adelante = mismo sentido que moverAdelante()
void motorA(bool adelante, int pwm) {
  if (INVERTIR_MOTOR_A) adelante = !adelante;
  digitalWrite(AIN_1, adelante ? HIGH : LOW);
  digitalWrite(AIN_2, adelante ? LOW : HIGH);
  analogWrite(PWM_A, pwm);
}

void motorB(bool adelante, int pwm) {
  if (INVERTIR_MOTOR_B) adelante = !adelante;
  digitalWrite(BIN_1, adelante ? HIGH : LOW);
  digitalWrite(BIN_2, adelante ? LOW : HIGH);
  analogWrite(PWM_B, pwm);
}

void aplicarMovimiento(Direccion dir, int pwm) {
  bool izq = true, der = true;
  switch (dir) {
    case DIR_ADELANTE:  izq = true;  der = true;  break;
    case DIR_ATRAS:     izq = false; der = false; break;
    case DIR_IZQUIERDA: izq = false; der = true;  break;
    case DIR_DERECHA:   izq = true;  der = false; break;
  }
  digitalWrite(STB_Y, HIGH);
  if (MOTOR_IZQUIERDO_ES_A) { motorA(izq, pwm); motorB(der, pwm); }
  else                      { motorA(der, pwm); motorB(izq, pwm); }
}

// ==========================================
// Servos
// ==========================================
void escribirServo(int i, int angulo) {
  int us = map(angulo, ANGULO_MIN, ANGULO_MAX, SERVO_US_MIN, SERVO_US_MAX);
  pca.writeMicroseconds(CANALES_SERVO[i], us);
}

void reiniciarTics() {
  uint32_t ahora = millis();
  for (int i = 0; i < NUM_SERVOS; i++) tTic[i] = ahora;
}

void actualizarServos() {
  uint32_t ahora = millis();
  for (int i = 0; i < NUM_SERVOS; i++) {
    if (ahora - tTic[i] >= PERIODO_TIC_MS[i]) {
      tTic[i] = ahora;
      anguloServo[i] += PASO_GRADOS;
      if (anguloServo[i] > ANGULO_MAX) anguloServo[i] = ANGULO_MIN;  // vuelta completa
      escribirServo(i, anguloServo[i]);
    }
  }
}

void moverServo(int i, int angulo) {
  anguloServo[i] = constrain(angulo, ANGULO_MIN, ANGULO_MAX);
  escribirServo(i, anguloServo[i]);
}

// ==========================================
// Sensor de color TCS3200
// ==========================================
uint32_t leerPeriodoTCS(uint8_t s2, uint8_t s3) {
  digitalWrite(TCS_S2, s2);
  digitalWrite(TCS_S3, s3);
  delayMicroseconds(300);
  return pulseIn(TCS_OUT, LOW, TCS_TIMEOUT_US);   // 0 = sin pulso
}

// Devuelve "red", "green", "blue", "yellow", "black", "white" o "unknown".
const char* leerColor(float& r, float& g, float& b, float& c) {
  uint32_t pR = leerPeriodoTCS(LOW,  LOW);
  uint32_t pB = leerPeriodoTCS(LOW,  HIGH);
  uint32_t pG = leerPeriodoTCS(HIGH, HIGH);
  uint32_t pC = leerPeriodoTCS(HIGH, LOW);

  // Intensidad ~ frecuencia (1000 / periodo en µs → kHz aprox.)
  r = pR ? 1000.0f / pR : 0;
  g = pG ? 1000.0f / pG : 0;
  b = pB ? 1000.0f / pB : 0;
  c = pC ? 1000.0f / pC : 0;

  Serial.printf("[Color] R=%.2f G=%.2f B=%.2f C=%.2f\n", r, g, b, c);

  if (c < UMBRAL_NEGRO) return "black";
  float suma = r + g + b;
  if (suma <= 0) return "unknown";
  float rn = r / suma, gn = g / suma, bn = b / suma;

  if (c > UMBRAL_BLANCO && rn < DOMINANCIA_COLOR && gn < DOMINANCIA_COLOR && bn < DOMINANCIA_COLOR) return "white";
  if (rn > 0.33f && gn > 0.33f && bn < 0.26f) return "yellow";
  if (rn >= DOMINANCIA_COLOR && rn > gn && rn > bn) return "red";
  if (gn >= DOMINANCIA_COLOR && gn > rn && gn > bn) return "green";
  if (bn >= DOMINANCIA_COLOR && bn > rn && bn > gn) return "blue";
  return "unknown";
}

// ==========================================
// Envío de mensajes a la app
// ==========================================
void enviar(JsonDocument& doc) {
  if (clienteActivo < 0) return;
  String s;
  serializeJson(doc, s);
  s += '\n';
  ws.sendTXT((uint8_t)clienteActivo, s);
}

void enviarAck(long id) {
  JsonDocument d;
  d["v"] = 1; d["type"] = "ack"; d["id"] = id;
  enviar(d);
}

void enviarDone(long id) {
  JsonDocument d;
  d["v"] = 1; d["type"] = "done"; d["id"] = id;
  d["result"].to<JsonObject>();
  enviar(d);
}

void enviarErr(long id, bool conId, const char* code, const char* msg) {
  JsonDocument d;
  d["v"] = 1; d["type"] = "err";
  if (conId) d["id"] = id; else d["id"] = nullptr;
  d["code"] = code; d["msg"] = msg;
  enviar(d);
}

void agregarModulos(JsonArray arr) {
  JsonObject base = arr.add<JsonObject>();
  base["type"] = "base"; base["typeId"] = 1; base["firmware"] = FIRMWARE_VERSION; base["state"] = "ok";
  JsonArray caps = base["capabilities"].to<JsonArray>();
  caps.add("motion");
  if (pcaOk) caps.add("arms");
  if (SENSOR_COLOR_ACTIVO) caps.add("color_sensor");

  // Esclavo 1 → Módulo 2 ("sensors"), Esclavo 2 → Módulo 3 ("interface").
  const char* tipos[2] = {"sensors", "interface"};
  for (int i = 0; i < 2; i++) {
    JsonObject m = arr.add<JsonObject>();
    m["type"] = tipos[i];
    m["typeId"] = i + 2;
    m["firmware"] = esclavos[i].conectado ? "0.1.0" : "";
    m["capabilities"].to<JsonArray>();   // todavía sin bloques propios
    m["state"] = esclavos[i].conectado ? "ok" : "absent";
  }
}

void enviarEventoModulos() {
  JsonDocument d;
  d["v"] = 1; d["type"] = "evt"; d["evt"] = "modules";
  agregarModulos(d["modules"].to<JsonArray>());
  enviar(d);
}

void enviarEstado() {
  JsonDocument d;
  d["v"] = 1; d["type"] = "evt"; d["evt"] = "status";
  d["busy"] = orden.activa;
  d["uptime_ms"] = millis();
  enviar(d);
}

// ==========================================
// Órdenes
// ==========================================
void abortarOrden(const char* code, const char* msg) {
  if (!orden.activa) return;
  if (orden.tipo == ORDEN_MOVER) detenerMotores();
  enviarErr(orden.id, true, code, msg);
  orden.activa = false;
}

bool argEntero(JsonObject args, const char* clave, long minimo, long maximo, long& salida) {
  JsonVariant v = args[clave];
  if (!v.is<long>()) return false;
  salida = v.as<long>();
  return salida >= minimo && salida <= maximo;
}

bool argTexto(JsonObject args, const char* clave, String& salida) {
  JsonVariant v = args[clave];
  if (!v.is<const char*>()) return false;
  salida = v.as<const char*>();
  return true;
}

void iniciarMovimiento(long id, Direccion dir, JsonObject args) {
  long speed, dur;
  if (!argEntero(args, "speed", 0, 100, speed) || !argEntero(args, "duration_ms", 0, 30000, dur)) {
    enviarErr(id, true, "INVALID_ARGS", "speed 0-100, duration_ms 0-30000");
    return;
  }
  if (orden.activa) { enviarErr(id, true, "BUSY", "el robot está ocupado"); return; }
  int pwm = map(speed, 0, 100, 0, 255);
  enviarAck(id);
  aplicarMovimiento(dir, pwm);
  orden = {true, id, ORDEN_MOVER, millis() + (uint32_t)dur, dir, pwm};
}

void iniciarServo(long id, int indice, int angulo) {
  if (!pcaOk) { enviarErr(id, true, "HARDWARE_ERROR", "PCA9685 no responde"); return; }
  if (orden.activa) { enviarErr(id, true, "BUSY", "el robot está ocupado"); return; }
  enviarAck(id);
  moverServo(indice, angulo);
  orden = {true, id, ORDEN_SERVO, millis() + TIEMPO_SERVO_MS, DIR_ADELANTE, 0};
}

void procesarOrden(const String& linea) {
  JsonDocument doc;
  if (deserializeJson(doc, linea)) { enviarErr(0, false, "BAD_REQUEST", "JSON no válido"); return; }
  if (!doc["id"].is<long>()) { enviarErr(0, false, "BAD_REQUEST", "falta id"); return; }
  long id = doc["id"].as<long>();
  if (doc["v"].as<int>() != 1) { enviarErr(id, true, "VERSION_MISMATCH", "versión no soportada"); return; }
  if (strcmp(doc["type"] | "", "req") != 0 || !doc["cmd"].is<const char*>()) {
    enviarErr(id, true, "BAD_REQUEST", "petición no válida");
    return;
  }
  String cmd = doc["cmd"].as<const char*>();
  JsonObject args = doc["args"].as<JsonObject>();

  // ── Sistema ──
  if (cmd == "HELLO") {
    String ver;
    if (argTexto(args, "app_protocol", ver) && ver.toInt() != 1) {
      enviarErr(id, true, "VERSION_MISMATCH", "el robot usa el protocolo 1.0");
      return;
    }
    enviarAck(id);
    JsonDocument d;
    d["v"] = 1; d["type"] = "done"; d["id"] = id;
    JsonObject r = d["result"].to<JsonObject>();
    r["protocol"] = "1.0"; r["robot"] = "robot-modular"; r["firmware"] = FIRMWARE_VERSION;
    agregarModulos(r["modules"].to<JsonArray>());
    enviar(d);
    return;
  }
  if (cmd == "PING") { enviarAck(id); enviarDone(id); return; }
  if (cmd == "GET_MODULES") {
    enviarAck(id);
    JsonDocument d;
    d["v"] = 1; d["type"] = "done"; d["id"] = id;
    agregarModulos(d["result"]["modules"].to<JsonArray>());
    enviar(d);
    return;
  }
  if (cmd == "STOP") {
    abortarOrden("ABORTED", "detenido");
    detenerMotores();
    enviarAck(id); enviarDone(id);
    return;
  }

  // ── Movimiento ──
  if (cmd == "MOVE_FORWARD")  { iniciarMovimiento(id, DIR_ADELANTE, args);  return; }
  if (cmd == "MOVE_BACKWARD") { iniciarMovimiento(id, DIR_ATRAS, args);     return; }
  if (cmd == "TURN_LEFT")     { iniciarMovimiento(id, DIR_IZQUIERDA, args); return; }
  if (cmd == "TURN_RIGHT")    { iniciarMovimiento(id, DIR_DERECHA, args);   return; }
  if (cmd == "STOP_MOTORS") {
    if (orden.activa) { enviarErr(id, true, "BUSY", "el robot está ocupado"); return; }
    detenerMotores();
    enviarAck(id); enviarDone(id);
    return;
  }

  // ── Brazos ──
  if (cmd == "SET_SERVO") {
    String servo; long angulo;
    if (!argTexto(args, "servo", servo) || !argEntero(args, "angle", 0, 180, angulo)) {
      enviarErr(id, true, "INVALID_ARGS", "servo y angle 0-180");
      return;
    }
    int indice = -1;
    if (servo == "shoulder_left")  indice = SERVO_HOMBRO_IZQ;
    if (servo == "shoulder_right") indice = SERVO_HOMBRO_DER;
    if (servo == "gripper_left")   indice = SERVO_PINZA_IZQ;
    if (servo == "gripper_right")  indice = SERVO_PINZA_DER;
    if (indice < 0) { enviarErr(id, true, "INVALID_ARGS", "servo desconocido"); return; }
    iniciarServo(id, indice, (int)angulo);
    return;
  }
  if (cmd == "GRIPPER") {
    String side, action;
    if (!argTexto(args, "side", side) || !argTexto(args, "action", action) ||
        (side != "left" && side != "right") || (action != "open" && action != "close")) {
      enviarErr(id, true, "INVALID_ARGS", "side left/right, action open/close");
      return;
    }
    iniciarServo(id, side == "left" ? SERVO_PINZA_IZQ : SERVO_PINZA_DER,
                 action == "open" ? PINZA_ABIERTA : PINZA_CERRADA);
    return;
  }

  // ── Sensor de color ──
  if (cmd == "READ_COLOR") {
    if (!SENSOR_COLOR_ACTIVO) { enviarErr(id, true, "MODULE_UNAVAILABLE", "sensor de color desactivado"); return; }
    enviarAck(id);
    float r, g, b, c;
    const char* color = leerColor(r, g, b, c);
    JsonDocument d;
    d["v"] = 1; d["type"] = "done"; d["id"] = id;
    JsonObject res = d["result"].to<JsonObject>();
    res["color"] = color;
    JsonObject raw = res["raw"].to<JsonObject>();
    raw["r"] = r; raw["g"] = g; raw["b"] = b; raw["c"] = c;
    enviar(d);
    return;
  }

  // ── Capacidades de otros módulos que todavía no existen ──
  if (cmd == "READ_DISTANCE" || cmd == "SET_LED" || cmd == "TOGGLE_LED" || cmd == "BEEP" ||
      cmd == "PLAY_TONE" || cmd == "DISPLAY_TEXT" || cmd == "DISPLAY_CLEAR" || cmd == "READ_BUTTON") {
    enviarErr(id, true, "MODULE_UNAVAILABLE", "ese módulo todavía no tiene esta función");
    return;
  }

  enviarErr(id, true, "UNKNOWN_COMMAND", cmd.c_str());
}

void actualizarOrden() {
  if (!orden.activa) return;
  if ((int32_t)(millis() - orden.fin) < 0) return;
  if (orden.tipo == ORDEN_MOVER) detenerMotores();
  orden.activa = false;
  enviarDone(orden.id);
}

// ==========================================
// WebSocket
// ==========================================
void eventoWebSocket(uint8_t num, WStype_t tipo, uint8_t* payload, size_t largo) {
  switch (tipo) {
    case WStype_CONNECTED:
      if (clienteActivo >= 0 && clienteActivo != num) {
        // Solo una app a la vez: la nueva conexión reemplaza a la anterior.
        uint8_t anterior = (uint8_t)clienteActivo;
        clienteActivo = -1;
        ws.disconnect(anterior);
      }
      clienteActivo = num;
      rxLinea = "";
      tUltimoRx = millis();
      vigilanciaDisparada = false;
      Serial.printf(">> App conectada por Wi‑Fi (cliente %u, %s)\n", num, ws.remoteIP(num).toString().c_str());
      break;

    case WStype_DISCONNECTED:
      if (num == clienteActivo) {
        clienteActivo = -1;
        abortarOrden("ABORTED", "app desconectada");
        detenerMotores();
        Serial.println(">> App desconectada. Robot detenido.");
      }
      break;

    case WStype_TEXT:
      if (num != clienteActivo) return;
      tUltimoRx = millis();
      vigilanciaDisparada = false;
      for (size_t i = 0; i < largo; i++) {
        char c = (char)payload[i];
        if (c == '\n') {
          rxLinea.trim();
          if (rxLinea.length() > 0) procesarOrden(rxLinea);
          rxLinea = "";
        } else if (c != '\r') {
          rxLinea += c;
          if (rxLinea.length() > MAX_LINEA) rxLinea = "";
        }
      }
      // Un mensaje sin salto de línea final también es una orden completa.
      rxLinea.trim();
      if (rxLinea.length() > 0) { procesarOrden(rxLinea); rxLinea = ""; }
      break;

    default:
      break;
  }
}

// ==========================================
// Comunicación con esclavos
// ==========================================
void procesarLinea(Esclavo& e, String linea) {
  linea.trim();

  if (linea.startsWith("HELLO,")) {
    int id = linea.substring(6).toInt();
    if (id != e.id) {
      Serial.printf("ADVERTENCIA: el puerto del esclavo %d recibió HELLO del esclavo %d (¿cables cruzados?)\n", e.id, id);
      return;
    }
    if ((int32_t)(millis() - e.tBloqueoHasta) < 0) return;  // en enfriamiento tras un fallo
    e.solicitudVerificacion = true;  // nuevo o reiniciado: verificar
  }
  else if (linea.startsWith("PONG,")) {
    int id; unsigned long n;
    if (sscanf(linea.c_str(), "PONG,%d,%lu", &id, &n) == 2 &&
        id == e.id && e.pingPendiente && n == e.seq) {
      e.pingPendiente = false;
      e.fallos = 0;
    }
  }
}

void leerPuerto(Esclavo& e) {
  HardwareSerial& p = *e.puerto;
  while (p.available()) {
    char c = p.read();
    if (c == '\n') { procesarLinea(e, e.buffer); e.buffer = ""; }
    else if (c != '\r') {
      e.buffer += c;
      if (e.buffer.length() > 64) e.buffer = "";  // basura / ruido
    }
  }
}

String esperarRespuesta(HardwareSerial& p, const char* prefijo, uint32_t timeoutMs) {
  uint32_t t0 = millis();
  String linea = "";
  while (millis() - t0 < timeoutMs) {
    while (p.available()) {
      char c = p.read();
      if (c == '\n') {
        linea.trim();
        if (linea.startsWith(prefijo)) return linea;
        linea = "";  // ignora HELLO u otras líneas
      } else if (c != '\r') {
        linea += c;
        if (linea.length() > 64) linea = "";
      }
    }
    yield();
  }
  return "";
}

bool verificarConexion(Esclavo& e) {
  Serial.printf("\n>> Esclavo %d detectado. PAUSANDO sistema para verificar...\n", e.id);
  detenerMotores();                      // los servos mantienen su posición
  delay(ESPERA_ESTABILIZACION_MS);       // estabilización del contacto

  HardwareSerial& p = *e.puerto;
  while (p.available()) p.read();
  e.buffer = "";

  int exitos = 0;
  uint32_t sumaLatencia = 0;

  for (int i = 0; i < PINGS_VERIFICACION; i++) {
    e.seq++;
    uint32_t t0 = micros();
    p.printf("PING,%lu\n", (unsigned long)e.seq);
    String r = esperarRespuesta(p, "PONG,", TIMEOUT_VERIFICACION_MS);
    uint32_t dt = micros() - t0;

    int id; unsigned long n;
    if (r.length() > 0 && sscanf(r.c_str(), "PONG,%d,%lu", &id, &n) == 2 &&
        id == e.id && n == e.seq) {
      exitos++;
      sumaLatencia += dt;
      Serial.printf("   Ping %d/%d: OK (%lu us)\n", i + 1, PINGS_VERIFICACION, (unsigned long)dt);
    } else {
      Serial.printf("   Ping %d/%d: FALLO <- '%s'\n", i + 1, PINGS_VERIFICACION, r.c_str());
    }
  }

  bool ok = (exitos == PINGS_VERIFICACION);
  if (ok) {
    p.printf("WELCOME,%d\n", e.id);
    e.conectado = true;
    e.fallos = 0;
    e.pingPendiente = false;
    Serial.printf(">> Esclavo %d VERIFICADO (latencia media %lu us). Reanudando...\n",
                  e.id, (unsigned long)(sumaLatencia / exitos));
  } else {
    e.conectado = false;
    e.tBloqueoHasta = millis() + ENFRIAMIENTO_FALLO_MS;
    Serial.printf(">> Esclavo %d FALLÓ la verificación (%d/%d). Reanudando, se reintentará en %lu s\n",
                  e.id, exitos, PINGS_VERIFICACION, (unsigned long)(ENFRIAMIENTO_FALLO_MS / 1000));
  }
  return ok;
}

void heartbeat(Esclavo& e) {
  if (!e.conectado) return;

  if (e.pingPendiente) {
    e.fallos++;
    if (e.fallos >= FALLOS_PARA_DESCONEXION) {
      e.conectado = false;
      e.pingPendiente = false;
      Serial.printf(">> Esclavo %d DESCONECTADO (sin respuesta)\n", e.id);
      return;
    }
  }
  e.seq++;
  e.puerto->printf("PING,%lu\n", (unsigned long)e.seq);
  e.pingPendiente = true;
}

void reanudarSistema() {
#if MODO_DEMO
  reiniciarTics();
  moverAdelante(VELOCIDAD_MOTORES);
#else
  // Si una orden de movimiento seguía en curso, se retoma tras la pausa.
  if (orden.activa && orden.tipo == ORDEN_MOVER) aplicarMovimiento(orden.dir, orden.pwm);
#endif
}

// ==========================================
// Setup
// ==========================================
void setup() {
  Serial.begin(115200);

  // Motores
  pinMode(PWM_A, OUTPUT); pinMode(AIN_1, OUTPUT); pinMode(AIN_2, OUTPUT);
  pinMode(PWM_B, OUTPUT); pinMode(BIN_1, OUTPUT); pinMode(BIN_2, OUTPUT);
  pinMode(STB_Y, OUTPUT);
  detenerMotores();

  // TCS3200 (escala 20 %)
  pinMode(TCS_S0, OUTPUT); pinMode(TCS_S1, OUTPUT);
  pinMode(TCS_S2, OUTPUT); pinMode(TCS_S3, OUTPUT);
  pinMode(TCS_OUT, INPUT);
  digitalWrite(TCS_S0, HIGH);
  digitalWrite(TCS_S1, LOW);

  // UART esclavos
  Serial1.begin(BAUDIOS, SERIAL_8N1, Rx_S3_1, Tx_S3_1);
  Serial2.begin(BAUDIOS, SERIAL_8N1, Rx_S3_2, Tx_S3_2);

  // PCA9685
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.beginTransmission(PCA_DIRECCION);
  if (Wire.endTransmission() != 0) {
    Serial.println("ERROR: PCA9685 no responde en 0x40. Revisa SDA/SCL/VCC.");
    pcaOk = false;
  } else {
    pcaOk = true;
  }
  pca.begin();
  pca.setOscillatorFrequency(27000000);
  pca.setPWMFreq(50);
  delay(10);

  for (int i = 0; i < NUM_SERVOS; i++) {
    anguloServo[i] = ANGULO_MIN;
    escribirServo(i, anguloServo[i]);
  }

  // Wi‑Fi: punto de acceso propio con IP fija
  WiFi.mode(WIFI_AP);
  WiFi.softAP(WIFI_SSID, WIFI_PASSWORD);
  WiFi.softAPConfig(IP_ROBOT, IP_ROBOT, MASCARA_RED);
  WiFi.setSleep(false);   // menos latencia
  ws.begin();
  ws.onEvent(eventoWebSocket);

  delay(500);
  Serial.println("==========================================");
  Serial.println("  MAESTRO: Motores + 5 Servos + UART S3 + Wi‑Fi");
  Serial.println("  Esclavo 1: RX=14 TX=13 | Esclavo 2: RX=35 TX=23");
  Serial.printf ("  Red Wi‑Fi: %s  (clave: %s)\n", WIFI_SSID, WIFI_PASSWORD);
  Serial.printf ("  App: ws://%s:%u\n", WiFi.softAPIP().toString().c_str(), WS_PUERTO);
  Serial.println("==========================================");

  reanudarSistema();
}

// ==========================================
// Loop
// ==========================================
void loop() {
  // 0. Mensajes de la app
  ws.loop();

  // 1. Leer ambos puertos
  for (int i = 0; i < 2; i++) leerPuerto(esclavos[i]);

  // 2. Si un esclavo se anunció, pausar y verificar
  for (int i = 0; i < 2; i++) {
    if (esclavos[i].solicitudVerificacion) {
      esclavos[i].solicitudVerificacion = false;
      verificarConexion(esclavos[i]);
      reanudarSistema();
    }
  }

  // 3. Heartbeat de esclavos conectados
  static uint32_t tHeartbeat = 0;
  if (millis() - tHeartbeat >= PERIODO_HEARTBEAT_MS) {
    tHeartbeat = millis();
    for (int i = 0; i < 2; i++) heartbeat(esclavos[i]);
  }

  // 4. Avisar a la app si un esclavo se conectó o desconectó
  static bool conectadoAntes[2] = {false, false};
  bool cambio = false;
  for (int i = 0; i < 2; i++) {
    if (esclavos[i].conectado != conectadoAntes[i]) { conectadoAntes[i] = esclavos[i].conectado; cambio = true; }
  }
  if (cambio) enviarEventoModulos();

#if MODO_DEMO
  // 5. Servos tipo reloj (solo en modo demo)
  actualizarServos();
#endif

  // 6. Órdenes en curso (fin de movimiento / servo)
  actualizarOrden();

  // 7. Vigilancia: sin noticias de la app en 2 s → parar
  if (clienteActivo >= 0 && !vigilanciaDisparada && millis() - tUltimoRx > VIGILANCIA_APP_MS) {
    vigilanciaDisparada = true;
    abortarOrden("ABORTED", "sin comunicación con la app");
    detenerMotores();
    Serial.println(">> Vigilancia: la app no responde. Robot detenido.");
  }

  // 8. Latido hacia la app
  static uint32_t tStatus = 0;
  if (millis() - tStatus >= PERIODO_STATUS_MS) {
    tStatus = millis();
    enviarEstado();
  }

  // 9. Estado general (monitor serie)
  static uint32_t tEstado = 0;
  if (millis() - tEstado >= 2000) {
    tEstado = millis();
    Serial.printf("[Estado] E1: %s | E2: %s | App: %s | Servos: %d° %d° %d° %d° %d°\n",
                  esclavos[0].conectado ? "CONECTADO" : "---",
                  esclavos[1].conectado ? "CONECTADO" : "---",
                  clienteActivo >= 0 ? "CONECTADA" : "---",
                  anguloServo[0], anguloServo[1], anguloServo[2], anguloServo[3], anguloServo[4]);
  }
}
