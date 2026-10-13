# ioBroker Graphite Logger – Prototyp

- Graphite Host/Port (Carbon plaintext TCP, normalerweise 2003) und Standard-Präfix in der Instanzkonfiguration.
- Pro Objekt im ioBroker-Objekt-Tab: Logging aktivieren, Modus wählen, Intervall setzen.
- Boolean wird standardmäßig als false=0 / true=1 gesendet (optional 0/100).
- Zahlen und numerische Strings werden übertragen; Text/JSON/null werden übersprungen.
- Bei Wertänderung werden Ereignisse gesendet; im Intervallmodus wird der aktuelle Zustand periodisch abgefragt.
- Bei Verbindungsabbruch werden Daten begrenzt zwischengespeichert und nach Wiederverbindung gesendet.

## Testinstallation
1. ZIP entpacken und das Verzeichnis `iobroker.graphite` in eine ioBroker-Entwicklungsumgebung kopieren.
2. Im Verzeichnis `npm install` ausführen.
3. Lokal installieren/verlinken und `iobroker upload graphite` verwenden.
4. Instanz anlegen, Graphite-Host, Port und Präfix konfigurieren.
5. Im Objekt-Tab ein State-Objekt öffnen und unter benutzerdefinierter Konfiguration für `graphite` das Logging aktivieren.

## Beispiel
`iobroker.hm-rpc_0.sensor_temperature 21.5 1791878400`

## Hinweis
Dies ist ein erster Prototyp, kein bereits veröffentlichter oder durch CI getesteter ioBroker-Adapter. Vor produktivem Einsatz bitte mit der eigenen ioBroker-/Admin-Version testen und den Adapter-Checker ausführen. Die Unterstützung der JSON-Custom-Konfiguration hängt von der installierten Admin-Version ab.
