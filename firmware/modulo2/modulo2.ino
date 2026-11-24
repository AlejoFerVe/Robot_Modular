// Módulo 2 — ESP32‑C3 Super Mini
// Placa: "ESP32C3 Dev Module" con "USB CDC On Boot: Enabled"
// (si no, Serial usa GPIO20/21 y choca con el LED del pin 21).
// Nota: el C3 Super Mini NO trae LED RGB; su LED azul está en GPIO8 (activo en LOW).
// rgbLedWrite(21, ...) solo enciende algo si hay un WS2812 externo en GPIO21.
#include <Arduino.h>

// CAMBIAR ANTES DE CARGAR: 1 o 2
#define ID_ESCLAVO 1

#define PIN_RX       5    // <- TX del maestro
#define PIN_TX       6    // -> RX del maestro
#define PIN_LED_RGB  21

const uint32_t BAUDIOS            = 115200;
const uint32_t PERIODO_HELLO_MS   = 250;
const uint32_t TIMEOUT_MAESTRO_MS = 3500;
const uint32_t DURACION_FLASH_MS  = 50;

bool vinculado = false;
uint32_t tUltimoMsgMaestro = 0, tHello = 0, tFlash = 0;
bool flashActivo = false;
String buffer = "";

void ledEstado() {
  if (flashActivo) return;
  if (vinculado) rgbLedWrite(PIN_LED_RGB, 0, 0, 0);
  else           rgbLedWrite(PIN_LED_RGB, 0, 0, 30);   // azul: buscando maestro
}

void procesarMensaje(String msg) {
  msg.trim();

  if (msg.startsWith("PING,")) {
    String n = msg.substring(5);
    Serial1.printf("PONG,%d,%s\n", ID_ESCLAVO, n.c_str());
    tUltimoMsgMaestro = millis();
    rgbLedWrite(PIN_LED_RGB, 0, 40, 0);   // destello verde
    tFlash = millis();
    flashActivo = true;
  }
  else if (msg.startsWith("WELCOME,")) {
    if (msg.substring(8).toInt() == ID_ESCLAVO) {
      vinculado = true;
      tUltimoMsgMaestro = millis();
      Serial.printf("Esclavo %d: VINCULADO con el maestro\n", ID_ESCLAVO);
    }
  }
}

void setup() {
  Serial.begin(115200);
  Serial1.begin(BAUDIOS, SERIAL_8N1, PIN_RX, PIN_TX);
  rgbLedWrite(PIN_LED_RGB, 0, 0, 0);
  delay(200);
  Serial.printf("ESCLAVO %d listo. Anunciándose al maestro...\n", ID_ESCLAVO);
}

void loop() {
  while (Serial1.available()) {
    char c = Serial1.read();
    if (c == '\n') { procesarMensaje(buffer); buffer = ""; }
    else if (c != '\r') {
      buffer += c;
      if (buffer.length() > 64) buffer = "";
    }
  }

  // Anunciarse mientras no esté vinculado
  if (!vinculado && millis() - tHello >= PERIODO_HELLO_MS) {
    tHello = millis();
    Serial1.printf("HELLO,%d\n", ID_ESCLAVO);
  }

  // Si el maestro deja de hablar, volver a anunciarse
  if (vinculado && millis() - tUltimoMsgMaestro > TIMEOUT_MAESTRO_MS) {
    vinculado = false;
    Serial.printf("Esclavo %d: maestro perdido, volviendo a anunciarse\n", ID_ESCLAVO);
  }

  if (flashActivo && millis() - tFlash > DURACION_FLASH_MS) flashActivo = false;
  ledEstado();
}
