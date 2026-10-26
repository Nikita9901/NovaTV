import 'package:flutter/material.dart';

import 'link.dart';

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
    if (l.state == LinkState.denied && mounted) {
      setState(() {
        _busy = false;
        _error = l.deniedWhy == 'many' ? 'Слишком много неверных кодов. Подождите минуту.' : 'Неверный код. Посмотрите его в Nova TV: Настройки → Телефон-пульт.';
      });
    } else if (l.state == LinkState.idle && _busy && mounted) {
      setState(() {
        _busy = false;
        _error = 'Не удалось подключиться. Проверьте, что телефон и компьютер в одной сети Wi-Fi, а в Nova TV включён пульт.';
      });
    }
  }

  Future<void> _scan() async {
    setState(() => _found = null);
    final list = await Link.discover();
    if (mounted) setState(() => _found = list);
  }

  Future<void> _ask(String host, int port, String title) async {
    final pin = await showDialog<String>(
      context: context,
      builder: (context) {
        final c = TextEditingController();
        return AlertDialog(
          title: Text(title),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Введите код, который показан на компьютере: Nova TV → Настройки → Телефон-пульт.'),
              const SizedBox(height: 16),
              TextField(
                controller: c,
                autofocus: true,
                keyboardType: TextInputType.number,
                maxLength: 6,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 32, letterSpacing: 8, fontWeight: FontWeight.bold),
                decoration: const InputDecoration(counterText: '', hintText: '000000'),
                onSubmitted: (v) => Navigator.pop(context, v),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Отмена')),
            FilledButton(onPressed: () => Navigator.pop(context, c.text), child: const Text('Подключить')),
          ],
        );
      },
    );
    if (pin == null || pin.trim().length != 6) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    await widget.link.pair(host, port, pin.trim());
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
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 16),
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(18),
                  gradient: const LinearGradient(colors: [Color(0xFF6E9BFF), Color(0xFFA24CF0)]),
                ),
                child: const Icon(Icons.play_arrow_rounded, size: 40, color: Colors.white),
              ),
              const SizedBox(height: 24),
              const Text('Nova TV Remote', style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              const Text(
                'Включите «Телефон-пульт» в настройках Nova TV на компьютере. Телефон и компьютер должны быть в одной сети Wi-Fi.',
                style: TextStyle(color: Colors.white70, height: 1.4),
              ),
              const SizedBox(height: 24),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(_error!, style: const TextStyle(color: Color(0xFFFFD873))),
                ),
              Row(
                children: [
                  const Text('Компьютеры в сети', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                  const Spacer(),
                  IconButton(onPressed: _busy ? null : _scan, icon: const Icon(Icons.refresh)),
                ],
              ),
              Expanded(
                child: found == null
                    ? const Center(child: CircularProgressIndicator())
                    : found.isEmpty
                        ? const Center(
                            child: Text('Ничего не найдено.\nПроверьте Wi-Fi или введите адрес вручную.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white54)),
                          )
                        : ListView(
                            children: [
                              for (final f in found)
                                Card(
                                  child: ListTile(
                                    leading: const Icon(Icons.desktop_windows_rounded),
                                    title: Text(f.name),
                                    subtitle: Text('${f.host}:${f.port}'),
                                    trailing: const Icon(Icons.chevron_right),
                                    onTap: _busy ? null : () => _ask(f.host, f.port, f.name),
                                  ),
                                ),
                            ],
                          ),
              ),
              if (_busy) const LinearProgressIndicator(),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : _manual,
                  icon: const Icon(Icons.edit),
                  label: const Text('Ввести адрес вручную'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
