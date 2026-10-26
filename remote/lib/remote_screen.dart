import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import 'aim.dart';
import 'link.dart';

/// Главный экран: большая площадка-«указка», кнопки, крестовина и клавиатура телефона.
class RemoteScreen extends StatefulWidget {
  const RemoteScreen({super.key, required this.link});
  final Link link;

  @override
  State<RemoteScreen> createState() => _RemoteScreenState();
}

class _RemoteScreenState extends State<RemoteScreen> {
  late final Aim _aim;
  DateTime? _downAt;
  double _moved = 0;
  bool _aiming = false;
  double _sens = 1.0;
  bool _invertX = false;
  bool _invertY = false;

  Link get link => widget.link;

  @override
  void initState() {
    super.initState();
    WakelockPlus.enable(); // экран телефона не гаснет, пока пульт открыт
    _aim = Aim(onMove: link.move)..start();
    link.addListener(_onLink);
    if (!link.connected) link.connect();
    _loadPrefs();
  }

  @override
  void dispose() {
    link.removeListener(_onLink);
    _aim.stop();
    WakelockPlus.disable();
    super.dispose();
  }

  void _onLink() {
    if (mounted) setState(() {});
  }

  Future<void> _loadPrefs() async {
    final p = await SharedPreferences.getInstance();
    setState(() {
      _sens = p.getDouble('sens') ?? 1.0;
      _invertX = p.getBool('invX') ?? false;
      _invertY = p.getBool('invY') ?? false;
    });
    _applyAim();
  }

  void _applyAim() {
    _aim
      ..sensitivity = _sens
      ..invertX = _invertX
      ..invertY = _invertY;
  }

  Future<void> _savePrefs() async {
    final p = await SharedPreferences.getInstance();
    await p.setDouble('sens', _sens);
    await p.setBool('invX', _invertX);
    await p.setBool('invY', _invertY);
    _applyAim();
  }

  // ---- площадка-указка: пока палец на ней, курсор следует за наклоном; короткое касание — клик ----
  void _padDown(PointerDownEvent e) {
    _downAt = DateTime.now();
    _moved = 0;
    _aim.active = true;
    setState(() => _aiming = true);
    HapticFeedback.selectionClick();
  }

  void _padMove(PointerMoveEvent e) => _moved += e.delta.distance;

  void _padUp(PointerEvent e) {
    _aim.active = false;
    setState(() => _aiming = false);
    final quick = _downAt != null && DateTime.now().difference(_downAt!) < const Duration(milliseconds: 260);
    if (e is PointerUpEvent && quick && _moved < 14) {
      link.click();
      HapticFeedback.lightImpact();
    }
  }

  Future<void> _keyboard() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => _KeyboardSheet(link: link),
    );
  }

  Future<void> _settings() async {
    await showModalBottomSheet<void>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setSheet) => Padding(
          padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Настройки указки', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
              const SizedBox(height: 16),
              Text('Скорость курсора: ${_sens.toStringAsFixed(1)}×'),
              Slider(
                value: _sens,
                min: 0.3,
                max: 3.0,
                divisions: 27,
                onChanged: (v) {
                  setSheet(() => _sens = v);
                  setState(() {});
                  _savePrefs();
                },
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Инвертировать по горизонтали'),
                value: _invertX,
                onChanged: (v) {
                  setSheet(() => _invertX = v);
                  _savePrefs();
                },
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Инвертировать по вертикали'),
                value: _invertY,
                onChanged: (v) {
                  setSheet(() => _invertY = v);
                  _savePrefs();
                },
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () async {
                  Navigator.pop(context);
                  await link.forget();
                },
                icon: const Icon(Icons.link_off),
                label: const Text('Забыть этот компьютер'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _btn(IconData icon, String label, String key, {bool repeat = false}) {
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: FilledButton.tonal(
          style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
          onPressed: () {
            HapticFeedback.selectionClick();
            link.key(key);
          },
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [Icon(icon), const SizedBox(height: 2), Text(label, style: const TextStyle(fontSize: 12))],
          ),
        ),
      ),
    );
  }

  Widget _arrow(IconData icon, String key) {
    return SizedBox(
      width: 56,
      height: 56,
      child: IconButton.filledTonal(
        onPressed: () {
          HapticFeedback.selectionClick();
          link.key(key);
        },
        icon: Icon(icon, size: 28),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ok = link.connected;
    final status = ok
        ? 'Подключено: ${link.hostName.isEmpty ? link.host : link.hostName}'
        : link.state == LinkState.connecting
            ? 'Подключаемся…'
            : link.state == LinkState.denied
                ? 'Компьютер не принял этот телефон'
                : 'Нет связи, пробуем снова…';
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          child: Column(
            children: [
              Row(
                children: [
                  Icon(Icons.circle, size: 10, color: ok ? const Color(0xFF4CD37B) : const Color(0xFFFFC83D)),
                  const SizedBox(width: 8),
                  Expanded(child: Text(status, style: const TextStyle(color: Colors.white70))),
                  IconButton(onPressed: _settings, icon: const Icon(Icons.tune)),
                ],
              ),
              if (link.state == LinkState.denied)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: FilledButton(onPressed: link.forget, child: const Text('Подключить заново')),
                ),
              Expanded(
                child: Row(
                  children: [
                    Expanded(
                      child: Listener(
                        onPointerDown: _padDown,
                        onPointerMove: _padMove,
                        onPointerUp: _padUp,
                        onPointerCancel: _padUp,
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 120),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(28),
                            gradient: LinearGradient(
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                              colors: _aiming ? const [Color(0xFF6E9BFF), Color(0xFFA24CF0)] : const [Color(0xFF1B2140), Color(0xFF241B45)],
                            ),
                          ),
                          child: Center(
                            child: Padding(
                              padding: const EdgeInsets.all(24),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(_aiming ? Icons.my_location : Icons.touch_app, size: 56, color: Colors.white),
                                  const SizedBox(height: 12),
                                  Text(
                                    _aiming ? 'Наклоняйте телефон' : 'Приложите палец и наклоняйте телефон.\nБыстрое касание — клик.',
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(fontSize: 16, height: 1.4),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    // Полоса прокрутки: ведите пальцем вверх или вниз
                    GestureDetector(
                      onVerticalDragUpdate: (d) => link.scroll(-d.delta.dy * 3),
                      child: Container(
                        width: 56,
                        decoration: BoxDecoration(borderRadius: BorderRadius.circular(28), color: const Color(0xFF1B2140)),
                        child: const Column(
                          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                          children: [Icon(Icons.keyboard_arrow_up), RotatedBox(quarterTurns: 3, child: Text('прокрутка', style: TextStyle(color: Colors.white54))), Icon(Icons.keyboard_arrow_down)],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              // Крестовина: для экранов без указки (меню, плеер)
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Column(
                    children: [
                      _arrow(Icons.keyboard_arrow_up, 'up'),
                      Row(
                        children: [
                          _arrow(Icons.keyboard_arrow_left, 'left'),
                          const SizedBox(width: 4),
                          SizedBox(
                            width: 56,
                            height: 56,
                            child: IconButton.filled(
                              onPressed: () {
                                HapticFeedback.mediumImpact();
                                link.key('a');
                              },
                              icon: const Text('OK', style: TextStyle(fontWeight: FontWeight.w800)),
                            ),
                          ),
                          const SizedBox(width: 4),
                          _arrow(Icons.keyboard_arrow_right, 'right'),
                        ],
                      ),
                      _arrow(Icons.keyboard_arrow_down, 'down'),
                    ],
                  ),
                  SizedBox(
                    width: 150,
                    child: Column(
                      children: [
                        Row(children: [_btn(Icons.arrow_back, 'Назад', 'b'), _btn(Icons.home_outlined, 'Домой', 'home')]),
                        const SizedBox(height: 8),
                        Row(children: [_btn(Icons.menu, 'Меню', 'x'), _btn(Icons.search, 'Адрес', 'y')]),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: ok ? _keyboard : null,
                  icon: const Icon(Icons.keyboard),
                  label: const Text('Клавиатура'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Ввод текста с клавиатуры телефона: набранное сразу уходит на компьютер.
class _KeyboardSheet extends StatefulWidget {
  const _KeyboardSheet({required this.link});
  final Link link;

  @override
  State<_KeyboardSheet> createState() => _KeyboardSheetState();
}

class _KeyboardSheetState extends State<_KeyboardSheet> {
  final _c = TextEditingController(text: ' '); // пробел-«якорь»: так стирание ловится даже в пустом поле
  String _last = ' ';

  void _changed(String v) {
    if (v.isEmpty) {
      widget.link.backspace();
      _c.value = const TextEditingValue(text: ' ', selection: TextSelection.collapsed(offset: 1));
      _last = ' ';
      return;
    }
    if (v.length > _last.length && v.startsWith(_last)) {
      widget.link.text(v.substring(_last.length));
    } else if (v.length < _last.length && _last.startsWith(v)) {
      for (var i = 0; i < _last.length - v.length; i++) {
        widget.link.backspace();
      }
    } else {
      // вставили или заменили целиком: стираем старое и печатаем новое
      for (var i = 1; i < _last.length; i++) {
        widget.link.backspace();
      }
      widget.link.text(v.trim());
    }
    _last = v;
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _c,
            autofocus: true,
            autocorrect: false,
            enableSuggestions: false,
            textInputAction: TextInputAction.send,
            decoration: const InputDecoration(hintText: 'Печатайте: текст появится на компьютере', border: OutlineInputBorder()),
            onChanged: _changed,
            onSubmitted: (_) {
              widget.link.enter();
              Navigator.pop(context);
            },
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(child: OutlinedButton(onPressed: widget.link.enter, child: const Text('Enter'))),
              const SizedBox(width: 8),
              Expanded(child: FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Готово'))),
            ],
          ),
        ],
      ),
    );
  }
}
