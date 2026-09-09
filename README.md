# Flutter Phone Preview

Extensión de VS Code que ejecuta tu app **Flutter Web** (`flutter run -d web-server`)
y la muestra dentro de un panel con marco de teléfono (iPhone o Android),
directamente en un panel lateral del editor.

## Requisitos

- Flutter SDK instalado y en el `PATH` (comando `flutter` disponible en la terminal).
- Un proyecto Flutter abierto como carpeta de trabajo en VS Code.
- Node.js 18+ para compilar la extensión.

## Instalación y prueba local

1. Descomprime este proyecto y ábrelo en VS Code.
2. Instala dependencias y compila:
   ```bash
   npm install
   npm run compile
   ```
3. Presiona `F5` (o "Ejecutar extensión" en el panel de depuración). Esto abre
   una segunda ventana de VS Code ("Extension Development Host") con la
   extensión ya cargada.
4. En esa segunda ventana, abre tu proyecto Flutter (`File > Open Folder`).
5. Abre la paleta de comandos (`Ctrl+Shift+P` / `Cmd+Shift+P`) y ejecuta:
   **"Flutter: Iniciar vista previa en teléfono"**.
6. Espera a que Flutter compile; el panel con el teléfono se abrirá solo,
   mostrando tu app dentro del marco.

## Comandos disponibles

| Comando | Descripción |
|---|---|
| `Flutter: Iniciar vista previa en teléfono` | Lanza `flutter run -d web-server` y abre el panel con el marco de teléfono. |
| `Flutter: Hot reload (vista previa en teléfono)` | Envía `r` a Flutter y, al terminar de recompilar, refresca el panel automáticamente. |
| `Flutter: Hot restart (vista previa en teléfono)` | Envía `R` (reinicio completo del estado) y refresca el panel al terminar. |
| `Flutter: Detener vista previa en teléfono` | Detiene el proceso de Flutter y cierra el panel. |

### Sobre el hot reload

`flutter run -d web-server` no abre un navegador con depurador conectado, así
que el "hot reload" incremental de Dart no puede aplicarse en vivo dentro del
panel (esto es una limitación de Flutter Web, no de esta extensión — el
propio Flutter avisa: *"requires the Dart Debug Chrome extension for
debugging"*). Para evitar ese problema, la extensión:

1. Envía el comando de reload/restart a Flutter.
2. Detecta en la salida cuándo terminó de recompilar.
3. Recarga automáticamente el `iframe` del panel (con un parámetro anti-caché),
   mostrando siempre el código más reciente.

Además, con `flutterPhonePreview.autoReloadOnSave` (activado por defecto),
cada vez que guardas un archivo `.dart` se dispara este mismo flujo
automáticamente — funciona como un live-reload.

## Configuración

En `settings.json` (o desde la configuración de VS Code):

```json
{
  "flutterPhonePreview.port": 5001,
  "flutterPhonePreview.device": "iphone15",
  "flutterPhonePreview.autoReloadOnSave": true
}
```

- `flutterPhonePreview.port`: puerto usado por `flutter run -d web-server`.
- `flutterPhonePreview.device`: modelo mostrado **al abrir** el panel. Valores:
  `iphone15`, `iphone_se`, `pixel7`, `galaxy_s22`, `ipad_mini`.
- `flutterPhonePreview.autoReloadOnSave`: si está activo, guardar cualquier
  archivo `.dart` dispara un hot reload y refresca el panel automáticamente.

## Controles dentro del panel

El panel incluye una barra superior con:

- **Selector de modelo**: cambia entre iPhone 15 Pro, iPhone SE, Google Pixel 7,
  Samsung Galaxy S22 e iPad Mini, sin recargar la app.
- **Zoom (−/+/Reset)**: acerca o aleja el marco del teléfono (30%–250%).
  También puedes hacer zoom con `Ctrl` + rueda del mouse sobre el panel.
- **Rotar**: cambia el marco entre orientación vertical y horizontal.
- **Recargar**: refresca el `iframe` sin reiniciar el proceso de Flutter.

## Empaquetar como .vsix (para instalar permanentemente)

```bash
npm install -g @vscode/vsce
npm run compile
vsce package
```

Esto genera un archivo `.vsix` que puedes instalar con:
`Extensions > ... > Install from VSIX...` en VS Code.

## Notas

- La primera compilación de Flutter puede tardar un poco; si el panel no se
  abre solo, revisa el canal de salida **"Flutter Phone Preview"** para ver
  el progreso, o espera — hay un respaldo de 15s que abre el panel de todas
  formas.
- El botón "↻ Recargar" en el panel simplemente refresca el `iframe` (útil si
  el hot reload de Flutter no repinta visualmente por sí solo).
