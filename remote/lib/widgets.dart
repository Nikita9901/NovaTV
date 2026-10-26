import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'theme.dart';

/// Кнопка, которая повторяет действие, пока её держат (стрелки в списках, перемотка).
class HoldButton extends StatefulWidget {
  const HoldButton({super.key, required this.onTick, required this.builder, this.repeat = true});

  final VoidCallback onTick;
  final bool repeat;
  final Widget Function(BuildContext context, bool pressed) builder;

  @override
  State<HoldButton> createState() => _HoldButtonState();
}

class _HoldButtonState extends State<HoldButton> {
  Timer? _delay;
  Timer? _timer;
  bool _down = false;

  void _start() {
    setState(() => _down = true);
    HapticFeedback.selectionClick();
    widget.onTick();
    if (!widget.repeat) return;
    _delay = Timer(const Duration(milliseconds: 380), () {
      _timer = Timer.periodic(const Duration(milliseconds: 110), (_) => widget.onTick());
    });
  }

  void _stop() {
    _delay?.cancel();
    _timer?.cancel();
    if (_down && mounted) setState(() => _down = false);
  }

  @override
  void dispose() {
    _delay?.cancel();
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      onPointerDown: (_) => _start(),
      onPointerUp: (_) => _stop(),
      onPointerCancel: (_) => _stop(),
      child: widget.builder(context, _down),
    );
  }
}

/// Круглая или скруглённая кнопка с подписью.
class RoundAction extends StatelessWidget {
  const RoundAction({super.key, required this.icon, required this.label, required this.onTap, this.primary = false, this.enabled = true});

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool primary;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: enabled ? 1 : 0.4,
      child: HoldButton(
        repeat: false,
        onTick: () {
          if (enabled) onTap();
        },
        builder: (context, pressed) => AnimatedScale(
          scale: pressed ? 0.92 : 1,
          duration: const Duration(milliseconds: 90),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 58,
                height: 58,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: primary ? Palette.gradient : null,
                  color: primary ? null : (pressed ? Palette.cardHi : Palette.card),
                  border: Border.all(color: Palette.line),
                ),
                child: Icon(icon, size: 26, color: Colors.white),
              ),
              const SizedBox(height: 6),
              Text(label, style: const TextStyle(fontSize: 12, color: Palette.muted, fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Переключатель режимов: Указка / Тачпад / Кнопки.
class ModeTabs<T> extends StatelessWidget {
  const ModeTabs({super.key, required this.value, required this.items, required this.onChanged});

  final T value;
  final List<(T, IconData, String)> items;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(color: Palette.card, borderRadius: BorderRadius.circular(18), border: Border.all(color: Palette.line)),
      child: Row(
        children: [
          for (final (v, icon, label) in items)
            Expanded(
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () {
                  HapticFeedback.selectionClick();
                  onChanged(v);
                },
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  decoration: BoxDecoration(borderRadius: BorderRadius.circular(14), gradient: v == value ? Palette.gradient : null),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(icon, size: 18, color: v == value ? Colors.white : Palette.muted),
                      const SizedBox(width: 6),
                      Text(label, style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: v == value ? Colors.white : Palette.muted)),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Строка состояния соединения.
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.text, required this.ok, this.busy = false});

  final String text;
  final bool ok;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final color = ok ? Palette.good : Palette.warn;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(99), border: Border.all(color: color.withValues(alpha: 0.35))),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          busy
              ? SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2, color: color))
              : Icon(Icons.circle, size: 10, color: color),
          const SizedBox(width: 8),
          Flexible(child: Text(text, overflow: TextOverflow.ellipsis, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 13))),
        ],
      ),
    );
  }
}

/// Крестовина с кнопкой OK в центре.
class DPad extends StatelessWidget {
  const DPad({super.key, required this.onKey, this.size = 250});

  final void Function(String key) onKey;
  final double size;

  @override
  Widget build(BuildContext context) {
    final arm = size * 0.30;
    Widget arrow(IconData icon, String key, Alignment at) => Align(
          alignment: at,
          child: HoldButton(
            onTick: () => onKey(key),
            builder: (context, pressed) => AnimatedContainer(
              duration: const Duration(milliseconds: 80),
              width: arm * 1.15,
              height: arm * 1.15,
              decoration: BoxDecoration(shape: BoxShape.circle, color: pressed ? Palette.accent.withValues(alpha: 0.35) : Colors.transparent),
              child: Icon(icon, size: arm * 0.75, color: Colors.white),
            ),
          ),
        );
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        children: [
          Container(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: Palette.card,
              border: Border.all(color: Palette.line),
              boxShadow: [BoxShadow(color: Palette.accent.withValues(alpha: 0.12), blurRadius: 40)],
            ),
          ),
          arrow(Icons.keyboard_arrow_up_rounded, 'up', Alignment.topCenter),
          arrow(Icons.keyboard_arrow_down_rounded, 'down', Alignment.bottomCenter),
          arrow(Icons.keyboard_arrow_left_rounded, 'left', Alignment.centerLeft),
          arrow(Icons.keyboard_arrow_right_rounded, 'right', Alignment.centerRight),
          Center(
            child: HoldButton(
              repeat: false,
              onTick: () {
                HapticFeedback.mediumImpact();
                onKey('a');
              },
              builder: (context, pressed) => AnimatedScale(
                scale: pressed ? 0.92 : 1,
                duration: const Duration(milliseconds: 90),
                child: Container(
                  width: size * 0.36,
                  height: size * 0.36,
                  decoration: const BoxDecoration(shape: BoxShape.circle, gradient: Palette.gradient),
                  alignment: Alignment.center,
                  child: const Text('OK', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Colors.white)),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Узкая полоса прокрутки: проведите пальцем вверх или вниз.
class ScrollStrip extends StatelessWidget {
  const ScrollStrip({super.key, required this.onScroll});

  final void Function(double dy) onScroll;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onVerticalDragUpdate: (d) => onScroll(-d.delta.dy * 3.2),
      child: Container(
        width: 58,
        decoration: BoxDecoration(color: Palette.card, borderRadius: BorderRadius.circular(29), border: Border.all(color: Palette.line)),
        child: const Column(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            Icon(Icons.keyboard_double_arrow_up_rounded, color: Palette.muted),
            RotatedBox(quarterTurns: 3, child: Text('прокрутка', style: TextStyle(color: Palette.muted, fontSize: 12, fontWeight: FontWeight.w600))),
            Icon(Icons.keyboard_double_arrow_down_rounded, color: Palette.muted),
          ],
        ),
      ),
    );
  }
}
