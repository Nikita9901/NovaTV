import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'link.dart';
import 'theme.dart';

/// Первое подключение: находим компьютер в сети и вводим PIN с его экрана.
class PairScreen extends StatefulWidget {
  const PairScreen({super.key, required this.link});
  final Link link;

  @override
  State<PairScreen> createState() => _PairScreenState();
}

class _PairScreenState extends State<PairScreen> {
  List<Found>? _found;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    widget.link.addListener(_onLink);
    _scan();
  }

  @override
  void dispose() {
    widget.link.removeListener(_onLink);
    super.dispose();
  }

  void _onLink() {
    final l = widget.link;
    if (!mounted) return;
    if (l.state == LinkState.denied) {
      setState(() {
        _busy = false;
        _error = l.deniedWhy == 'many' ? 'Слишком много неверных кодов. Подождите минуту.' : 'Неверный код. Он показан в Nova TV: Настройки → Телефон-пульт.';
      });
    } else if (l.state == LinkState.idle && _busy) {
      setState(() {
        _busy = false;
        _error = 'Не удалось подключиться. Телефон и компьютер должны быть в одной сети Wi-Fi, а в Nova TV включён пульт.';
      });
    }
  }

  Future<void> _scan() async {
    setState(() => _found = null);
    final list = await Link.discover();
    if (mounted) setState(() => _found = list);
  }

  Future<void> _ask(String host, int port, String title) async {
    final pin = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (context) => _PinSheet(title: title),
    );
    if (pin == null || pin.length != 6) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    await widget.link.pair(host, port, pin);
  }

  Future<void> _manual() async {
    final c = TextEditingController();
    final addr = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Адрес компьютера'),
        content: TextField(
          controller: c,
          autofocus: true,
          keyboardType: TextInputType.url,
          decoration: const InputDecoration(hintText: '192.168.1.10'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Отмена')),
          FilledButton(onPressed: () => Navigator.pop(context, c.text), child: const Text('Дальше')),
        ],
      ),
    );
    if (addr == null || addr.trim().isEmpty) return;
    final parts = addr.trim().split(':');
    final port = parts.length > 1 ? int.tryParse(parts[1]) ?? kPort : kPort;
    if (!mounted) return;
    await _ask(parts[0], port, 'Подключение к ${parts[0]}');
  }

  @override
  Widget build(BuildContext context) {
    final found = _found;
    return Scaffold(
      body: Backdrop(
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(22),
                    gradient: Palette.gradient,
                    boxShadow: [BoxShadow(color: Palette.accent2.withValues(alpha: 0.45), blurRadius: 30, offset: const Offset(0, 10))],
                  ),
                  child: const Icon(Icons.play_arrow_rounded, size: 44, color: Colors.white),
                ),
                const SizedBox(height: 22),
                const Text('Nova TV Remote', style: TextStyle(fontSize: 32, fontWeight: FontWeight.w800, letterSpacing: -0.5)),
                const SizedBox(height: 8),
                const Text(
                  'Телефон станет указкой и пультом.\nВключите «Телефон-пульт» в настройках Nova TV на компьютере: телефон и компьютер должны быть в одной сети Wi-Fi.',
                  style: TextStyle(color: Palette.muted, height: 1.45),
                ),
                const SizedBox(height: 24),
                if (_error != null)
                  Container(
                    width: double.infinity,
                    margin: const EdgeInsets.only(bottom: 16),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: Palette.warn.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(16), border: Border.all(color: Palette.warn.withValues(alpha: 0.4))),
                    child: Text(_error!, style: const TextStyle(color: Palette.warn, height: 1.4)),
                  ),
                Row(
                  children: [
                    const Text('Компьютеры в сети', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                    const Spacer(),
                    IconButton(onPressed: _busy ? null : _scan, icon: const Icon(Icons.refresh_rounded)),
                  ],
                ),
                Expanded(
                  child: found == null
                      ? const Center(child: CircularProgressIndicator())
                      : found.isEmpty
                          ? const Center(
                              child: Text('Ничего не найдено.\nПроверьте Wi-Fi или введите адрес вручную.', textAlign: TextAlign.center, style: TextStyle(color: Palette.muted, height: 1.5)),
                            )
                          : ListView(
                              children: [
                                for (final f in found)
                                  Container(
                                    margin: const EdgeInsets.only(bottom: 10),
                                    decoration: BoxDecoration(color: Palette.card, borderRadius: BorderRadius.circular(20), border: Border.all(color: Palette.line)),
                                    child: ListTile(
                                      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                                      leading: Container(
                                        width: 46,
                                        height: 46,
                                        decoration: BoxDecoration(borderRadius: BorderRadius.circular(14), color: Palette.cardHi),
                                        child: const Icon(Icons.desktop_windows_rounded),
                                      ),
                                      title: Text(f.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                                      subtitle: Text('${f.host}:${f.port}', style: const TextStyle(color: Palette.muted)),
                                      trailing: const Icon(Icons.chevron_right_rounded),
                                      onTap: _busy ? null : () => _ask(f.host, f.port, f.name),
                                    ),
                                  ),
                              ],
                            ),
                ),
                if (_busy) const Padding(padding: EdgeInsets.only(bottom: 8), child: LinearProgressIndicator()),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(onPressed: _busy ? null : _manual, icon: const Icon(Icons.edit_rounded), label: const Text('Ввести адрес вручную')),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Ввод 6-значного кода: шесть ячеек и цифровая клавиатура.
class _PinSheet extends StatefulWidget {
  const _PinSheet({required this.title});
  final String title;

  @override
  State<_PinSheet> createState() => _PinSheetState();
}

class _PinSheetState extends State<_PinSheet> {
  final _c = TextEditingController();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final text = _c.text;
    return Padding(
      padding: EdgeInsets.fromLTRB(24, 0, 24, 24 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.title, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          const Text('Введите код с экрана компьютера:\nNova TV → Настройки → Телефон-пульт.', style: TextStyle(color: Palette.muted, height: 1.4)),
          const SizedBox(height: 20),
          Stack(
            alignment: Alignment.center,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  for (var i = 0; i < 6; i++)
                    Container(
                      width: 46,
                      height: 58,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: Palette.bg,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: i == text.length ? Palette.accent : Palette.line, width: i == text.length ? 2 : 1),
                      ),
                      child: Text(i < text.length ? text[i] : '', style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
                    ),
                ],
              ),
              // Настоящее поле ввода прозрачно и лежит поверх ячеек
              Opacity(
                opacity: 0.01,
                child: TextField(
                  controller: _c,
                  autofocus: true,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                  onChanged: (v) {
                    setState(() {});
                    if (v.length == 6) Navigator.pop(context, v);
                  },
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
