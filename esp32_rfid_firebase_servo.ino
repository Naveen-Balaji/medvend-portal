#include <WiFi.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ESP32Servo.h>

// Firebase by Mobizt
#include <Firebase_ESP_Client.h>

// Optional helper addons from Firebase_ESP_Client examples
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// -------------------------
// WiFi credentials
// -------------------------
const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// -------------------------
// Firebase credentials
// -------------------------
#define API_KEY "YOUR_FIREBASE_API_KEY"
#define DATABASE_URL "https://your-project-id-default-rtdb.firebaseio.com/"

// -------------------------
// MFRC522 wiring (ESP32 hardware SPI)
// -------------------------
static const uint8_t PIN_SCK = 18;
static const uint8_t PIN_MISO = 19;
static const uint8_t PIN_MOSI = 23;
static const uint8_t PIN_SS = 5;
static const uint8_t PIN_RST = 22;

// -------------------------
// Servo placeholders / config
// -------------------------
static const uint8_t SERVO_PIN = 14; // Servo motor control pin
static const int SERVO_LOCK_ANGLE = 0;
static const int SERVO_UNLOCK_ANGLE = 90;
// TODO: Add advanced servo timing/safety logic here later.

// Firebase paths
const String PATH_CURRENT_SCAN = "/currentScan";
const String PATH_DISPENSE_UID = "/dispenseUID";

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

MFRC522 rfid(PIN_SS, PIN_RST);
Servo dispenserServo;

String lastScannedUID = "";
unsigned long lastUidPostMillis = 0;
const unsigned long UID_DEBOUNCE_MS = 1200;

// Convert RFID UID bytes to uppercase hex string (e.g., "A1B2C3D4")
String uidToString(const MFRC522::Uid &uid)
{
  String uidStr = "";
  for (byte i = 0; i < uid.size; i++)
  {
    if (uid.uidByte[i] < 0x10)
    {
      uidStr += "0";
    }
    uidStr += String(uid.uidByte[i], HEX);
  }
  uidStr.toUpperCase();
  return uidStr;
}

void connectWiFi()
{
  Serial.print("Connecting to WiFi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int retries = 0;
  const int maxRetries = 40; // ~20s with 500ms delay
  while (WiFi.status() != WL_CONNECTED && retries < maxRetries)
  {
    delay(500);
    Serial.print(".");
    retries++;
  }

  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.println();
    Serial.println("WiFi connected");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
  }
  else
  {
    Serial.println();
    Serial.println("WiFi connection timeout. Retrying...");
  }
}

void ensureWiFiConnected()
{
  if (WiFi.status() == WL_CONNECTED)
  {
    return;
  }

  Serial.println("WiFi disconnected. Reconnecting...");
  connectWiFi();
}

void initFirebase()
{
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;

  // Anonymous sign-in (sufficient for many RTDB setups with proper rules)
  if (Firebase.signUp(&config, &auth, "", ""))
  {
    Serial.println("Firebase signup OK");
  }
  else
  {
    Serial.printf("Firebase signup failed: %s\n", config.signer.signupError.message.c_str());
  }

  config.token_status_callback = tokenStatusCallback;

  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  Serial.println("Firebase initialized");
}

bool writeCurrentScanToFirebase(const String &uid)
{
  Serial.printf("Writing UID '%s' to %s ...\n", uid.c_str(), PATH_CURRENT_SCAN.c_str());

  if (Firebase.RTDB.setString(&fbdo, PATH_CURRENT_SCAN, uid))
  {
    Serial.println("Firebase write success");
    return true;
  }

  // Fallback logic: retry once after a short delay and ensure WiFi is up.
  Serial.printf("Firebase write failed: %s\n", fbdo.errorReason().c_str());
  Serial.println("Retrying write once...");

  ensureWiFiConnected();
  delay(300);

  if (Firebase.RTDB.setString(&fbdo, PATH_CURRENT_SCAN, uid))
  {
    Serial.println("Firebase write success on retry");
    return true;
  }

  Serial.printf("Retry failed: %s\n", fbdo.errorReason().c_str());
  return false;
}

void activateServoForDispense()
{
  Serial.println("Dispense command matched UID. Activating servo...");

  dispenserServo.write(SERVO_UNLOCK_ANGLE);
  delay(900);
  dispenserServo.write(SERVO_LOCK_ANGLE);

  Serial.println("Servo cycle complete");
}

void checkDispenseCommand()
{
  if (lastScannedUID.length() == 0)
  {
    return;
  }

  if (!Firebase.ready())
  {
    return;
  }

  if (Firebase.RTDB.getString(&fbdo, PATH_DISPENSE_UID))
  {
    String dispenseUid = fbdo.stringData();
    dispenseUid.trim();
    dispenseUid.toUpperCase();

    if (dispenseUid.length() > 0)
    {
      Serial.printf("dispenseUID from Firebase: %s\n", dispenseUid.c_str());
    }

    if (dispenseUid == lastScannedUID)
    {
      activateServoForDispense();

      // Optional reset so the same command is not re-triggered endlessly.
      if (!Firebase.RTDB.setString(&fbdo, PATH_DISPENSE_UID, ""))
      {
        Serial.printf("Failed to clear %s: %s\n", PATH_DISPENSE_UID.c_str(), fbdo.errorReason().c_str());
      }
    }
  }
  else
  {
    Serial.printf("Failed reading %s: %s\n", PATH_DISPENSE_UID.c_str(), fbdo.errorReason().c_str());
  }
}

void setup()
{
  Serial.begin(115200);
  delay(300);

  // Initialize SPI with explicit hardware pins
  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_SS);
  rfid.PCD_Init();

  // Servo setup
  dispenserServo.setPeriodHertz(50); // Standard 50Hz servo signal
  dispenserServo.attach(SERVO_PIN, 500, 2400);
  dispenserServo.write(SERVO_LOCK_ANGLE);

  connectWiFi();
  while (WiFi.status() != WL_CONNECTED)
  {
    connectWiFi();
    delay(1200);
  }

  initFirebase();

  Serial.println("System ready. Tap RFID card...");
}

void loop()
{
  ensureWiFiConnected();

  // Check for new RFID card
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial())
  {
    checkDispenseCommand();
    delay(100);
    return;
  }

  String uid = uidToString(rfid.uid);

  // Debounce repeated reads of same card in quick succession
  if (uid == lastScannedUID && millis() - lastUidPostMillis < UID_DEBOUNCE_MS)
  {
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    checkDispenseCommand();
    return;
  }

  Serial.print("Card detected. UID: ");
  Serial.println(uid);

  if (Firebase.ready())
  {
    bool ok = writeCurrentScanToFirebase(uid);
    if (ok)
    {
      lastScannedUID = uid;
      lastUidPostMillis = millis();
    }
  }
  else
  {
    Serial.println("Firebase is not ready yet.");
  }

  // Stop encryption on PCD
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  // Listen for dispense command after processing scan
  checkDispenseCommand();

  delay(120);
}
