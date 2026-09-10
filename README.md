# Flutter Phone Preview

Preview your Flutter app inside VS Code with an iPhone, Android phone, or tablet frame. Switch devices, rotate the screen, adjust the zoom, and test text fields without leaving the editor.

## Screenshots

### Preview

![Preview in dark theme](images/preview-dark.png)

![Preview in light theme](images/preview-light.png)

### Virtual keyboard

![Text virtual keyboard](images/keyboard-text.png)

![Numeric virtual keyboard](images/keyboard-number.png)

## Start the preview

1. Open your Flutter project folder in VS Code.
2. Press **Ctrl + Shift + P** (or **Cmd + Shift + P** on macOS).
3. Search for and select **Flutter: Start Phone Preview**.
4. Wait for Flutter to compile your app. The first build may take a little longer.
5. The preview opens in a side panel with your app inside the selected device frame.

## Requirements

- The **Flutter Phone Preview** extension must be installed.
- Flutter must be installed and the `flutter` command must be available in your terminal.
- Open a Flutter project that supports the web.

The preview runs the web version of your app. It does not replace testing on a physical device or emulator.

## Preview controls

- **Device:** choose an iPhone, Android phone, or iPad from the selector.
- **Zoom:** zoom in, zoom out, or reset the preview size.
- **Rotate:** switch between portrait and landscape orientation.
- **Fit:** fit the device to the available panel space.
- **Reload:** reload the app in the preview.

## Virtual keyboard

Click a text field inside the device frame to open the virtual keyboard automatically. The keyboard adapts to the Flutter `TextInputType` used by the field.

- **Text:** letters, uppercase characters, spaces, and symbols.
- **Numbers and decimals:** numeric keys and decimal separators.
- **Phone:** numbers plus `+`, `*`, and `#`.
- **Email and URL:** quick access to `@`, `.`, and `/`.
- **Multiline:** supports line breaks.

Use **Backspace** to delete characters and **Done**, **Search**, or **Send** for the field action. Use the down arrow to hide the keyboard. The app has less vertical space while the keyboard is open.

Read-only fields and fields configured with `TextInputType.none` do not open the virtual keyboard. Some less common Flutter input types may use the text layout because Flutter Web does not expose a distinct browser input mode for them.

## Update the app while working

By default, saving a `.dart` file requests a Flutter update and reloads the preview when recompilation finishes.

You can also open the Command Palette with **Ctrl + Shift + P** and run:

- **Flutter: Hot reload (phone preview)** to update the app.
- **Flutter: Hot restart (phone preview)** to restart the app state completely.

The update may reset the app state in the web preview.

## Stop the preview

Press **Ctrl + Shift + P** and select **Flutter: Stop Phone Preview**. This stops Flutter and closes the panel.

## Settings

Open VS Code Settings and search for **Flutter Phone Preview**. You can change:

- **Port:** the port used to run the app. The default is `5001`.
- **Device:** the device shown when the preview opens.
- **Auto Reload On Save:** enable or disable reloads when `.dart` files are saved.

## If the app does not appear

- Wait for the first Flutter build to finish.
- Open **View > Output** and select **Flutter Phone Preview** to see progress and errors.
- Check that your project can run on the web.
- If compilation has finished but the screen is blank, click **Reload** in the panel.
- If the port is busy, change **Port** in Settings and start the preview again.

## Continue improving

Flutter Phone Preview is under active development. More devices, preview controls, and Flutter Web improvements will be added over time.
