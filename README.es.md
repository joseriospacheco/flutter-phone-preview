# Flutter Phone Preview

> **Idioma:** Español | [English](README.md)

Previsualiza tu app Flutter dentro de VS Code con un marco de iPhone, teléfono Android o tableta. Cambia de dispositivo, rota la pantalla, ajusta el zoom y prueba campos de texto sin salir del editor.

## Capturas

### Vista previa

![Vista previa en tema oscuro](images/preview-dark.png)

![Vista previa en tema claro](images/preview-light.png)

### Teclado virtual

![Teclado virtual de texto](images/keyboard-text.png)

![Teclado virtual numérico](images/keyboard-number.png)

## Iniciar la vista previa

1. Abre tu proyecto Flutter en VS Code.
2. Presiona **Ctrl + Shift + P** (o **Cmd + Shift + P** en macOS).
3. Busca y selecciona **Flutter: Iniciar vista previa en teléfono**.
4. Espera a que Flutter compile tu app. La primera compilación puede tardar un poco más.
5. La vista previa se abre en un panel lateral con tu app dentro del marco del dispositivo seleccionado.

## Requisitos

- La extensión **Flutter Phone Preview** debe estar instalada.
- Flutter debe estar instalado y el comando `flutter` debe estar disponible en tu terminal.
- Abre un proyecto Flutter compatible con web.

La vista previa ejecuta la versión web de tu app. No reemplaza las pruebas en un dispositivo físico o emulador.

## Controles de la vista previa

- **Dispositivo:** elige un iPhone, teléfono Android o iPad desde el selector.
- **Zoom:** acerca, aleja o restablece el tamaño de la vista previa.
- **Rotar:** cambia entre orientación vertical y horizontal.
- **Ajustar:** ajusta el dispositivo al espacio disponible del panel.
- **Recargar:** recarga la app en la vista previa.

## Teclado virtual

Haz clic en un campo de texto dentro del marco del dispositivo para abrir el teclado virtual automáticamente. El teclado se adapta al `TextInputType` de Flutter usado por el campo.

- **Texto:** letras, mayúsculas, espacios y símbolos.
- **Números y decimales:** teclas numéricas y separadores decimales.
- **Teléfono:** números más `+`, `*` y `#`.
- **Correo y URL:** acceso rápido a `@`, `.` y `/`.
- **Multilínea:** admite saltos de línea.

Usa **Borrar** para eliminar caracteres y **Listo**, **Buscar** o **Enviar** para la acción del campo. Usa la flecha hacia abajo para ocultar el teclado. La app tiene menos espacio vertical mientras el teclado está abierto.

Los campos de solo lectura y los configurados con `TextInputType.none` no abren el teclado virtual. Algunos tipos de entrada menos comunes de Flutter pueden usar el diseño de texto porque Flutter Web no expone un modo de entrada distinto para ellos.

## APIs REST en la vista previa

El soporte REST está activado por defecto. Usa la **URL absoluta HTTP o HTTPS** habitual de tu API en Flutter, por ejemplo `http://localhost:8080/api/products` o `https://api.example.com/products`. Las solicitudes de los clientes `fetch` y `XMLHttpRequest` del navegador, incluidos los clientes web estándar usados por `http` y Dio, pasan por el proxy local de la extensión. Tu código Flutter no necesita cambios.

El proxy admite métodos HTTP como GET, POST, PUT, PATCH, DELETE, HEAD y OPTIONS; JSON, subidas multipart, respuestas binarias y encabezados de autenticación explícitos como `Authorization: Bearer ...`. Conserva los códigos de estado de la API, incluidos errores como 401 o 422. La API no necesita encabezados CORS para estas solicitudes de vista previa.

> ⚠️ **Advertencia CORS — permite esta conexión en tu backend:** el bypass anterior aplica *solo* mientras el proxy esté activado (por defecto). De lo contrario el navegador aplica CORS y tu backend **debe** permitir el origen que llama:
>
> - **El puerto `5001` no lo fija Flutter** — es el valor por defecto de esta extensión (`flutterPhonePreview.port`; Flutter por sí solo usa `8080`). Puedes cambiarlo en Ajustes; el valor se pasa como `flutter run -d web-server --web-port <puerto>`.
> - **Con el proxy activado:** no necesitas cambios CORS en el backend. Las solicitudes llegan a tu API con el origen del servidor Flutter (`http://localhost:<puerto>`) y el navegador nunca las bloquea. La autenticación debe usar encabezados explícitos (las cookies no se reenvían).
> - **Con el proxy desactivado (vista previa):** la app corre desde `http://127.0.0.1:<puerto-aleatorio>` — un **puerto distinto en cada arranque** — así que el backend debe permitir ese patrón (reflejar el encabezado `Origin` o permitir `http://127.0.0.1:*`), incluidas respuestas preflight `OPTIONS` para encabezados no seguros como `Authorization`.
> - **En producción:** permite el dominio donde esté desplegada la app Flutter Web.

- La API debe ser alcanzable desde la máquina donde corre la extensión. Para un backend local, usa su puerto localhost real; direcciones de emulador Android como `10.0.2.2` no apuntan a tu equipo en esta vista previa web.
- Los certificados HTTPS se validan con normalidad. Un backend no disponible o un certificado inválido devuelven un error del proxy (502); una solicitud que supere 120 segundos devuelve 504.
- El proxy no reenvía cookies del navegador ni guarda cookies de la API. Usa encabezados de autenticación explícitos, o desactiva el proxy para probar la autenticación con cookies con la configuración CORS de tu backend.
- Las URLs relativas siguen apuntando al servidor web de Flutter. Las solicitudes dentro de Web Workers y los WebSockets de API no se interceptan.
- Las redirecciones se siguen hasta 10 veces, y Authorization se elimina cuando cambia el origen de destino. Las subidas mayores a 8 MiB funcionan, pero no pueden reenviarse si una redirección exige enviar el mismo cuerpo otra vez.
- Este ajuste aplica a vistas previas de desarrollo. Prueba tu app Flutter Web desplegada con la configuración CORS real del backend.

Para usar el comportamiento de red normal del navegador, desactiva **Flutter Phone Preview: Enable Rest Proxy** en Ajustes:

```json
{
  "flutterPhonePreview.enableRestProxy": false
}
```

Detén e inicia la vista previa tras cambiar este ajuste.

## Actualizar la app mientras trabajas

Por defecto, guardar un archivo `.dart` solicita una actualización de Flutter y recarga la vista previa cuando termina la recompilación.

También puedes abrir la paleta de comandos con **Ctrl + Shift + P** y ejecutar:

- **Flutter: Hot reload (vista previa en teléfono)** para actualizar la app.
- **Flutter: Hot restart (vista previa en teléfono)** para reiniciar el estado de la app por completo.

La actualización puede restablecer el estado de la app en la vista previa web.

## Detener la vista previa

Presiona **Ctrl + Shift + P** y selecciona **Flutter: Detener vista previa en teléfono**. Esto detiene Flutter y cierra el panel.

## Ajustes

Abre los Ajustes de VS Code y busca **Flutter Phone Preview**. Puedes cambiar:

- **Puerto:** el puerto usado para ejecutar la app. Por defecto es `5001`.
- **Dispositivo:** el dispositivo mostrado al abrir la vista previa.
- **Enable Rest Proxy:** permite llamadas REST mediante el proxy local de vista previa (activado por defecto).
- **Persist Preferences:** conserva los valores de `shared_preferences` de la app entre reinicios de la vista previa, guardados por proyecto (activado por defecto).
- **Auto Reload On Save:** activa o desactiva las recargas al guardar archivos `.dart`.
- **Idioma:** `auto` sigue el idioma de VS Code (por defecto), o fuerza `es` / `en`. Recarga la ventana tras cambiarlo.

Los títulos de comandos, mensajes, ajustes y el panel de vista previa siguen el mismo idioma.

## Preferencias persistentes

El proxy de vista previa escucha en un puerto aleatorio en cada arranque, así que el `localStorage` del navegador usado por el paquete `shared_preferences` aparecería vacío en cada reinicio. La extensión replica esos valores y los restaura antes de que arranque tu app, sin cambios en tu código Flutter. Usa **Flutter: Borrar preferencias guardadas (vista previa en teléfono)** desde la paleta de comandos para borrarlas y empezar limpio.

## Si la app no aparece

- Espera a que termine la primera compilación de Flutter.
- Abre **Ver > Salida** y selecciona **Flutter Phone Preview** para ver el progreso y los errores.
- Comprueba que tu proyecto pueda ejecutarse en web.
- Si la compilación terminó pero la pantalla está en blanco, haz clic en **Recargar** en el panel.
- Si el puerto está ocupado, cambia el **Puerto** en Ajustes e inicia la vista previa de nuevo.

## Seguir mejorando

Flutter Phone Preview está en desarrollo activo. Con el tiempo se agregarán más dispositivos, controles de vista previa y mejoras de Flutter Web.
