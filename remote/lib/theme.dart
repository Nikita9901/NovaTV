import 'package:flutter/material.dart';

/// Цвета Nova TV: тёмный фон и сине-фиолетовый акцент, как в приложении на компьютере.
class Palette {
  static const bg = Color(0xFF0A0C14);
  static const bgTop = Color(0xFF121735);
  static const card = Color(0xFF181D36);
  static const cardHi = Color(0xFF232A52);
  static const line = Color(0x1FFFFFFF);
  static const accent = Color(0xFF6E9BFF);
  static const accent2 = Color(0xFFA24CF0);
  static const good = Color(0xFF4CD37B);
  static const warn = Color(0xFFFFC83D);
  static const muted = Color(0xFF9BA3BF);

  static const gradient = LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [accent, accent2]);
}

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: Palette.accent, brightness: Brightness.dark).copyWith(
    surface: Palette.card,
    primary: Palette.accent,
  );
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: scheme,
    scaffoldBackgroundColor: Palette.bg,
    splashFactory: InkRipple.splashFactory,
    sliderTheme: const SliderThemeData(trackHeight: 6, thumbShape: RoundSliderThumbShape(enabledThumbRadius: 11)),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)), padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20)),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)), padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20)),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: Palette.card,
      showDragHandle: true,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
    ),
    dialogTheme: DialogThemeData(backgroundColor: Palette.card, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24))),
  );
}

/// Фон экрана: плавный градиент сверху вниз.
class Backdrop extends StatelessWidget {
  const Backdrop({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Palette.bgTop, Palette.bg], stops: [0, 0.55]),
      ),
      child: child,
    );
  }
}
