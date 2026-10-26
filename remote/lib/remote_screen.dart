import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import 'aim.dart';
import 'link.dart';
import 'theme.dart';
import 'widgets.dart';

enum PadMode { aim, touch, keys }

/// Главный экран пульта: три режима управления и всегда доступные «Назад», «Домой», «Меню» и клавиатура.
class RemoteScreen extends StatefulWidget {
  const RemoteScreen({super.key, required this.link});
  final Link link;

  @override
  State<RemoteScreen> createState() => _RemoteScreenState();
}

class _RemoteScreenState extends State<RemoteScreen> with WidgetsBindingObserver {
  late final Aim _aim;
  PadMode _mode = PadMode.aim;
  double _sens = 1.0;
  double _touchSens = 1.0;
  bool _invertX = false;
  bool _invertY = false;
  bool _haptics = true;

  // «Указка»
  DateTime? _downAt;
  double _moved = 0;
  bool _aiming = false;

  // «Тачпад»
  final Map<int, Offset> _fingers = {};
  double _tx = 0, _ty = 0, _ts = 0;
  Timer? _touchFlush;

  Link get link => widget.link;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WakelockPlus.enable().catchError((_) {}); // экран телефона не гаснет, пока пульт открыт
    _aim = Aim(onMove: link.move)..start();
    link.addListener(_onLink);
    if (!link.connected) link.connect();
    _loadPrefs();
    _touchFlush = Timer.periodic(const Duration(milliseconds: 16), (_) {
      if (_tx.abs() > 0.2 || _ty.abs() > 0.2) {
        link.move(_tx, _ty);
        _tx = 0;
        _ty = 0;
      }
      if (_ts.abs() > 0.5) {
        link.scroll(_ts);
        _ts = 0;
      }
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    link.removeListener(_onLink);
    _touchFlush?.cancel();
    _aim.stop();
    WakelockPlus.disable().catchError((_) {});
    super.dispose();
  }

  // Вернулись в приложение (или телефон проснулся) — сразу подключаемся заново
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && !link.connected && link.paired && link.state != LinkState.denied) link.connect();
  }

  void _onLink() {
    if (mounted) setState(() {});
  }

  void _tap([bool strong = false]) {
    if (!_haptics) return;
    strong ? HapticFeedback.mediumImpact() : HapticFeedback.selectionClick();
  }

  Future<void> _loadPrefs() async {
    final p = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      _sens = p.getDouble('sens') ?? 1.0;
      _touchSens = p.getDouble('touchSens') ?? 1.0;
      _invertX = p.getBool('invX') ?? false;
      _invertY = p.getBool('invY') ?? false;
      _haptics = p.getBool('haptics') ?? true;
      _mode = PadMode.values[(p.getInt('mode') ?? 0).clamp(0, PadMode.values.length - 1)];
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
    await p.setDouble('touchSens', _touchSens);
    await p.setBool('invX', _invertX);
    await p.setBool('invY', _invertY);
    await p.setBool('haptics', _haptics);
    await p.setInt('mode', _mode.index);
    _applyAim();
  }

  // ---- «Указка»: пока палец на площадке, курсор следует за наклоном; короткое касание — клик ----
  void _aimDown(PointerDownEvent e) {
    _downAt = DateTime.now();
    _moved = 0;
    _aim.begin();
    setState(() => _aiming = true);
    _tap();
  }

  void _aimMove(PointerMoveEvent e) => _moved += e.delta.distance;

  void _aimUp(PointerEvent e) {
    _aim.active = false;
    setState(() => _aiming = false);
    final quick = _downAt != null && DateTime.now().difference(_downAt!) < const Duration(milliseconds: 260);
    if (e is PointerUpEvent && quick && _moved < 14) {
      link.click();
      _tap(true);
    }
  }

  // ---- «Тачпад»: один палец водит курсор, касание — клик, два пальца — прокрутка ----
  void _touchDown(PointerDownEvent e) {
    _fingers[e.pointer] = e.position;
    if (_fingers.length == 1) {
      _downAt = DateTime.now();
      _moved = 0;
    }
  }

  void _touchMove(PointerMoveEvent e) {
    if (!_fingers.containsKey(e.pointer)) return;
    _fingers[e.pointer] = e.position;
    _moved += e.delta.distance;
    if (_fingers.length >= 2) {
      _ts += -e.delta.dy * 3.2 / _fingers.length;
    } else {
      // Небольшое ускорение: быстрые движения пальца уводят курсор дальше
      final v = e.delta.distance;
      final gain = _touchSens * (1.6 + (v > 6 ? (v - 6) * 0.08 : 0));
      _tx += e.delta.dx * gain * (_invertX ? -1 : 1);
      _ty += e.delta.dy * gain * (_invertY ? -1 : 1);
    }
  }

  void _touchUp(PointerEvent e) {
    final single = _fingers.length == 1;
    _fingers.remove(e.pointer);
    final quick = _downAt != null && DateTime.now().difference(_downAt!) < const Duration(milliseconds: 240);
    if (e is PointerUpEvent && single && quick && _moved < 10) {
      link.click();
      _tap(true);
    }
  }

  Future<void> _keyboard() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => _KeyboardSheet(link: link, haptic: _tap),
    );
  }

  Future<void> _settings() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setSheet) {
          void update(VoidCallback fn) {
            setSheet(fn);
            setState(() {});
            _savePrefs();
          }

          return SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Настройки', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 16),
                  Text('Скорость указки: ${_sens.toStringAsFixed(1)}×', style: const TextStyle(fontWeight: FontWeight.w600)),
                  Slider(value: _sens, min: 0.3, max: 3.0, divisions: 27, onChanged: (v) => update(() => _sens = v)),
                  Text('Скорость тачпада: ${_touchSens.toStringAsFixed(1)}×', style: const TextStyle(fontWeight: FontWeight.w600)),
                  Slider(value: _touchSens, min: 0.3, max: 3.0, divisions: 27, onChanged: (v) => update(() => _touchSens = v)),
                  SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Зеркально по горизонтали'), subtitle: const Text('Если курсор едет не в ту сторону'), value: _invertX, onChanged: (v) => update(() => _invertX = v)),
                  SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Зеркально по вертикали'), value: _invertY, onChanged: (v) => update(() => _invertY = v)),
                  SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Вибрация кнопок'), value: _haptics, onChanged: (v) => update(() => _haptics = v)),
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
          );
        },
      ),
    );
  }

  // ---------- Интерфейс ----------
  Widget _aimPad() {
    return Row(
      children: [
        Expanded(
          child: Listener(
            onPointerDown: _aimDown,
            onPointerMove: _aimMove,
            onPointerUp: _aimUp,
            onPointerCancel: _aimUp,
            child: _PadSurface(
              active: _aiming,
              icon: _aiming ? Icons.my_location_rounded : Icons.touch_app_rounded,
              title: _aiming ? 'Наклоняйте телефон' : 'Удерживайте и наклоняйте',
              hint: _aiming ? 'Отпустите палец, чтобы остановить курсор' : 'Палец на площадке: курсор следует за наклоном.\nБыстрое касание — клик.',
            ),
          ),
        ),
        const SizedBox(width: 10),
        ScrollStrip(onScroll: link.scroll),
      ],
    );
  }

  Widget _touchPad() {
    return Listener(
      onPointerDown: _touchDown,
      onPointerMove: _touchMove,
      onPointerUp: _touchUp,
      onPointerCancel: _touchUp,
      child: const _PadSurface(
        active: false,
        icon: Icons.mouse_rounded,
        title: 'Тачпад',
        hint: 'Ведите пальцем — курсор следует за ним.\nКасание — клик, два пальца — прокрутка.',
      ),
    );
  }

  Widget _keysPad() {
    return Column(
      children: [
        Expanded(child: Center(child: DPad(onKey: link.key, size: 260))),
        // Управление плеером Nova TV
        Container(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
          decoration: BoxDecoration(color: Palette.card, borderRadius: BorderRadius.circular(24), border: Border.all(color: Palette.line)),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              RoundAction(icon: Icons.replay_10_rounded, label: '−10 с', onTap: () => link.key('left')),
              RoundAction(icon: Icons.play_arrow_rounded, label: 'Пауза', onTap: () => link.key('a'), primary: true),
              RoundAction(icon: Icons.forward_10_rounded, label: '+10 с', onTap: () => link.key('right')),
              RoundAction(icon: Icons.graphic_eq_rounded, label: 'Звук', onTap: () => link.key('x')),
              RoundAction(icon: Icons.skip_next_rounded, label: 'Пропуск', onTap: () => link.key('y')),
            ],
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final ok = link.connected;
    final name = link.hostName.isEmpty ? (link.host ?? '') : link.hostName;
    final connecting = link.state == LinkState.connecting;
    final status = ok
        ? name
        : connecting
            ? 'Подключаемся…'
            : link.state == LinkState.denied
                ? 'Компьютер не принял телефон'
                : 'Нет связи: пробуем снова';
    return Scaffold(
      body: Backdrop(
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 14),
            child: Column(
              children: [
                Row(
                  children: [
                    Container(
                      width: 38,
                      height: 38,
                      decoration: BoxDecoration(borderRadius: BorderRadius.circular(11), gradient: Palette.gradient),
                      child: const Icon(Icons.play_arrow_rounded, color: Colors.white),
                    ),
                    const SizedBox(width: 12),
                    Expanded(child: Align(alignment: Alignment.centerLeft, child: StatusPill(text: status, ok: ok, busy: connecting))),
                    IconButton(onPressed: _settings, icon: const Icon(Icons.tune_rounded)),
                  ],
                ),
                if (!ok && !connecting)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: SizedBox(
                      width: double.infinity,
                      child: link.state == LinkState.denied
                          ? FilledButton(onPressed: link.forget, child: const Text('Подключить заново'))
                          : OutlinedButton.icon(onPressed: link.connect, icon: const Icon(Icons.refresh), label: const Text('Повторить подключение')),
                    ),
                  ),
                const SizedBox(height: 12),
                ModeTabs<PadMode>(
                  value: _mode,
                  onChanged: (m) {
                    setState(() => _mode = m);
                    _savePrefs();
                  },
                  items: const [
                    (PadMode.aim, Icons.my_location_rounded, 'Указка'),
                    (PadMode.touch, Icons.touch_app_rounded, 'Тачпад'),
                    (PadMode.keys, Icons.gamepad_rounded, 'Кнопки'),
                  ],
                ),
                const SizedBox(height: 12),
                Expanded(
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 180),
                    child: KeyedSubtree(
                      key: ValueKey(_mode),
                      child: switch (_mode) {
                        PadMode.aim => _aimPad(),
                        PadMode.touch => Row(children: [Expanded(child: _touchPad()), const SizedBox(width: 10), ScrollStrip(onScroll: link.scroll)]),
                        PadMode.keys => _keysPad(),
                      },
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    RoundAction(icon: Icons.arrow_back_rounded, label: 'Назад', onTap: () => link.key('b')),
                    RoundAction(icon: Icons.home_rounded, label: 'Домой', onTap: () => link.key('home')),
                    RoundAction(icon: Icons.menu_rounded, label: 'Меню', onTap: () => link.key('x')),
                    RoundAction(icon: Icons.search_rounded, label: 'Адрес', onTap: () => link.key('y')),
                    RoundAction(icon: Icons.keyboard_rounded, label: 'Ввод', onTap: _keyboard, primary: true, enabled: ok),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Большая площадка для указки и тачпада.
class _PadSurface extends StatelessWidget {
  const _PadSurface({required this.active, required this.icon, required this.title, required this.hint});

  final bool active;
  final IconData icon;
  final String title;
  final String hint;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(32),
        gradient: active
            ? Palette.gradient
            : const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF1B2145), Color(0xFF241B48)]),
        border: Border.all(color: active ? Colors.white.withValues(alpha: 0.5) : Palette.line, width: active ? 2 : 1),
        boxShadow: [BoxShadow(color: Palette.accent.withValues(alpha: active ? 0.45 : 0.14), blurRadius: active ? 50 : 30, spreadRadius: active ? 2 : 0)],
      ),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AnimatedScale(
                scale: active ? 1.15 : 1,
                duration: const Duration(milliseconds: 160),
                child: Container(
                  width: 92,
                  height: 92,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white.withValues(alpha: active ? 0.22 : 0.08)),
                  child: Icon(icon, size: 46, color: Colors.white),
                ),
              ),
              const SizedBox(height: 20),
              Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              Text(hint, textAlign: TextAlign.center, style: TextStyle(fontSize: 14, height: 1.45, color: Colors.white.withValues(alpha: 0.7))),
            ],
          ),
        ),
      ),
    );
  }
}

/// Ввод текста с клавиатуры телефона: набранное сразу уходит на компьютер.
class _KeyboardSheet extends StatefulWidget {
  const _KeyboardSheet({required this.link, required this.haptic});
  final Link link;
  final void Function([bool strong]) haptic;

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

  Future<void> _paste() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text?.trim();
    if (text == null || text.isEmpty) return;
    widget.link.text(text.length > 200 ? text.substring(0, 200) : text);
    widget.haptic();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Ввод текста', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          const Text('Текст появляется на компьютере по мере набора. Подходит и голосовой ввод.', style: TextStyle(color: Palette.muted, fontSize: 13)),
          const SizedBox(height: 12),
          TextField(
            controller: _c,
            autofocus: true,
            autocorrect: false,
            enableSuggestions: false,
            textInputAction: TextInputAction.send,
            decoration: InputDecoration(
              hintText: 'Печатайте здесь',
              filled: true,
              fillColor: Palette.bg,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
            ),
            onChanged: _changed,
            onSubmitted: (_) {
              widget.link.enter();
              Navigator.pop(context);
            },
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: OutlinedButton.icon(onPressed: _paste, icon: const Icon(Icons.content_paste_rounded, size: 18), label: const Text('Вставить'))),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () {
                    widget.link.enter();
                    widget.haptic();
                  },
                  icon: const Icon(Icons.keyboard_return_rounded, size: 18),
                  label: const Text('Enter'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(child: FilledButton(onPressed: () => Navigator.pop(context), child: const Text('Готово'))),
            ],
          ),
        ],
      ),
    );
  }
}
