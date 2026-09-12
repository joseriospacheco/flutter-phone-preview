# Flutter Phone Preview

> **Idioma:** [English](README.md) | Español

Vista previa de tu app Flutter dentro de VS Code con un marco de iPhone, Android o tablet. Cambia de dispositivo, rota la pantalla, ajusta el zoom y prueba campos de texto sin salir del editor.

## Capturas de pantalla

### Vista previa

![Vista previa en tema oscuro](images/preview-dark.png)

![Vista previa en tema claro](images/preview-light.png)

### Teclado virtual

![Teclado virtual de texto](images/keyboard-text.png)

![Teclado virtual numérico](images/keyboard-number.png)

## Iniciar la vista previa

1. Abre tu carpeta de proyecto Flutter en VS Code.
2. Pulsa **Ctrl + Shift + P** (o **Cmd + Shift + P** en macOS).
3. Busca y selecciona **Flutter: Iniciar vista previa en teléfono**.
4. Espera a que Flutter compile tu app. La primera compilación puede tardar algo más.
5. La vista previa se abre en un panel lateral con tu app dentro del marco del dispositivo seleccionado.

## Requisitos

- La extensión **Flutter Phone Preview** debe estar instalada.
- Flutter debe estar instalado y el comando `flutter` debe estar disponible en tu terminal.
- Abre un proyecto Flutter que admita la web.

La vista previa ejecuta la versión web de tu app. No sustituye las pruebas en un dispositivo físico o emulador.

## Controles de la vista previa

- **Dispositivo:** elige un iPhone, Android o iPad en el selector.
- **Zoom:** acercar, alejar o restablecer el tamaño de la vista previa.
- **Rotar:** cambiar entre orientación vertical y horizontal.
- **Ajustar:** ajusta el dispositivo al espacio disponible del panel.
- **Recargar:** recarga la app en la vista previa.
- **Pellizco del trackpad:** el pellizco sobre la app se neutraliza a propósito — Flutter Web lo convierte en un evento `PointerPanZoom` con kind de trackpad y el framework lo rechaza con un assertion. Usa los botones de zoom (o Ctrl + rueda fuera del marco del teléfono).

## Teclado virtual

Haz clic en un campo de texto dentro del marco del dispositivo para abrir el teclado virtual automáticamente. El teclado se adapta al `TextInputType` de Flutter que usa el campo.

- **Texto:** letras, mayúsculas, espacios y símbolos.
- **Números y decimales:** teclas numéricas y separadores decimales.
- **Teléfono:** números más `+`, `*` y `#`.
- **Correo y URL:** acceso rápido a `@`, `.` y `/`.
- **Multilínea:** admite saltos de línea.

Usa **Retroceso** para borrar caracteres y **Listo**, **Buscar** o **Enviar** para la acción del campo. Usa la flecha hacia abajo para ocultar el teclado. La app tiene menos espacio vertical mientras el teclado está abierto.

Los campos de solo lectura y los configurados con `TextInputType.none` no abren el teclado virtual. Algunos tipos de entrada menos comunes de Flutter pueden usar la disposición de texto porque Flutter Web no expone un modo de entrada de navegador distinto para ellos.

## APIs REST en la vista previa

El soporte REST está habilitado por defecto. Usa la **URL absoluta HTTP o HTTPS** habitual de tu API en Flutter, por ejemplo `http://localhost:8080/api/products` o `https://api.example.com/products`. Las solicitudes de los clientes `fetch` y `XMLHttpRequest`, incluidos los clientes web estándar usados por `http` y Dio, pasan por el proxy local de la extensión. Tu código Flutter no necesita cambios.

El proxy soporta métodos HTTP como GET, POST, PUT, PATCH, DELETE, HEAD y OPTIONS; JSON, subidas multipart, respuestas binarias y cabeceras de autenticación explícitas como `Authorization: Bearer ...`. Conserva los códigos de estado de la API, incluidos errores como 401 o 422. La API no necesita cabeceras CORS para estas solicitudes de vista previa.

> ⚠️ **Aviso CORS — permite esta conexión en tu backend:** la omisión anterior aplica *solo* mientras el proxy está habilitado (por defecto). De lo contrario, el navegador impone CORS y tu backend **debe** permitir el origen llamante:
>
> - **El puerto `5001` no lo fija Flutter** — es el predeterminado de esta extensión (`flutterPhonePreview.port`; Flutter solo usa `8080`). Puedes cambiarlo en Configuración; el valor se pasa como `flutter run -d web-server --web-port <port>`.
> - **Con el proxy activado:** no se necesita ningún cambio CORS en el backend. Las solicitudes llegan a tu API con el origen del servidor Flutter (`http://localhost:<port>`) y el navegador nunca las bloquea. La autenticación debe usar cabeceras explícitas (las cookies no se reenvían).
> - **Con el proxy desactivado (vista previa):** la app se ejecuta desde `http://127.0.0.1:<puerto-aleatorio>` — un **puerto distinto en cada inicio** — así que el backend debe permitir ese patrón (reflejar la cabecera `Origin` o permitir `http://127.0.0.1:*`), incluida la respuesta de preflight `OPTIONS` para cabeceras no seguras como `Authorization`.
> - **En producción:** permite el dominio donde esté desplegada tu app Flutter Web.

- La API debe ser alcanzable desde la máquina donde corre la extensión. Para un backend local usa su puerto real de localhost; direcciones de emulador Android como `10.0.2.2` no se refieren a tu equipo en esta vista previa web.
- Los certificados HTTPS se validan normalmente. Un backend no disponible o un certificado inválido devuelve un error del proxy (502); una solicitud que exceda 120 segundos devuelve 504.
- El proxy no reenvía cookies del navegador ni guarda cookies de la API. Usa cabeceras de autenticación explícitas o desactiva el proxy para probar la autenticación por cookies con la configuración CORS de tu backend.
- Las URL relativas siguen refiriéndose al servidor web de Flutter. Las solicitudes hechas en Web Workers y los WebSockets de la API no se interceptan.
- Las redirecciones se siguen hasta 10 veces, y se elimina `Authorization` cuando cambia el origen de destino. Se admiten subidas de más de 8 MiB, pero no se pueden reenviar si una redirección exige mandar el mismo cuerpo otra vez.
- Este ajuste aplica a las vistas previas de desarrollo. Prueba tu app Flutter Web desplegada con la configuración CORS real del backend.

Para usar el comportamiento de red normal del navegador, desactiva **Flutter Phone Preview: Habilitar proxy REST** en Configuración:

```json
{
  "flutterPhonePreview.enableRestProxy": false
}
```

Detén y vuelve a iniciar la vista previa después de cambiar este ajuste.

## Actualizar la app mientras trabajas

Por defecto, guardar un archivo `.dart` pide una actualización a Flutter y recarga la vista previa cuando termina la recompilación.

También puedes abrir la paleta de comandos con **Ctrl + Shift + P** y ejecutar:

- **Flutter: Hot reload (vista previa en teléfono)** para actualizar la app.
- **Flutter: Hot restart (vista previa en teléfono)** para reiniciar por completo el estado de la app.

La actualización puede restablecer el estado de la app en la vista previa web.

## Detener la vista previa

Pulsa **Ctrl + Shift + P** y selecciona **Flutter: Detener vista previa en teléfono**. Esto detiene Flutter y cierra el panel.

## Configuración

Abre la Configuración de VS Code y busca **Flutter Phone Preview**. Puedes cambiar:

- **Port:** el puerto usado para ejecutar la app. El predeterminado es `5001`.
- **Device:** el dispositivo que se muestra al abrir la vista previa.
- **Enable Rest Proxy:** permitir llamadas REST a través del proxy local de la vista previa (habilitado por defecto).
- **Persist Preferences:** conservar los valores de `shared_preferences` de la app entre reinicios de la vista previa, guardados por proyecto (habilitado por defecto).
- **Auto Reload On Save:** habilitar o deshabilitar las recargas al guardar archivos `.dart`.
- **Language:** `auto` sigue el idioma de VS Code (predeterminado), o fuerza `es` / `en`. Recarga la ventana después de cambiarlo.

Los títulos de los comandos, los mensajes, la configuración y el panel de la vista previa siguen el mismo idioma.

## Preferencias persistentes

El proxy de la vista previa escucha en un puerto aleatorio en cada inicio, así que el `localStorage` del navegador usado por el paquete `shared_preferences` parecería vacío en cada reinicio. La extensión espeja esos valores y los restaura antes de que tu app arranque, sin necesidad de cambiar tu código Flutter. Usa **Flutter: Borrar preferencias guardadas** desde la paleta de comandos para limpiarlas y empezar de cero.

## Si la app no aparece

- Espera a que termine la primera compilación de Flutter.
- Abre **Ver > Salida** y selecciona **Flutter Phone Preview** para ver el progreso y los errores.
- Comprueba que tu proyecto puede ejecutarse en la web.
- Si la compilación ha terminado pero la pantalla está en blanco, pulsa **Recargar** en el panel.
- Si el puerto está ocupado, cambia **Port** en Configuración y vuelve a iniciar la vista previa.

## Sigue mejorando

Flutter Phone Preview está en desarrollo activo. Con el tiempo se añadirán más dispositivos, controles de vista previa y mejoras de Flutter Web.