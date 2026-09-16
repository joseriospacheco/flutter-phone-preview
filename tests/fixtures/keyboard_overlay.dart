import 'dart:js_interop';
import 'dart:math' as math;
import 'package:flutter/material.dart';

@JS('window.focusOverlayField')
external set focusField(JSFunction callback);
@JS('window.overlayFixtureReady')
external set ready(JSBoolean value);
@JS('window.overlayFixtureValue')
external set fieldValue(JSString value);
@JS('window.overlayFixtureErrors')
external set errors(JSArray<JSString> value);

void main() {
  final reports = <JSString>[];
  errors = reports.toJS;
  FlutterError.onError = (details) {
    reports.add(details.exceptionAsString().toJS);
    errors = reports.toJS;
    FlutterError.presentError(details);
  };
  runApp(const MaterialApp(home: OverlayFixture()));
}

class OverlayFixture extends StatefulWidget {
  const OverlayFixture({super.key});
  @override
  State<OverlayFixture> createState() => _OverlayFixtureState();
}

class _OverlayFixtureState extends State<OverlayFixture> {
  final upper = FocusNode();
  final lower = FocusNode();
  double? spacer;

  @override
  void initState() {
    super.initState();
    focusField = ((JSString field) {
      (field.toDart == 'lower' ? lower : upper).requestFocus();
    }).toJS;
    WidgetsBinding.instance.addPostFrameCallback((_) => ready = true.toJS);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Fixed Column regression')),
    body: Padding(
      padding: const EdgeInsets.all(20),
      child: LayoutBuilder(builder: (context, constraints) {
        // Deliberately non-scrollable: fits before focus, but cannot accommodate
        // the old preview implementation removing keyboard height from the body.
        spacer ??= math.max(0, constraints.maxHeight - 180);
        return Column(children: [
          TextField(focusNode: upper, decoration: const InputDecoration(labelText: 'Upper field')),
          SizedBox(height: spacer),
          TextField(
            focusNode: lower,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'Lower field'),
            onChanged: (value) => fieldValue = value.toJS,
          ),
          const SizedBox(height: 12),
          const Text('The layout must remain stable when typing'),
        ]);
      }),
    ),
  );

  @override
  void dispose() {
    upper.dispose();
    lower.dispose();
    super.dispose();
  }
}
