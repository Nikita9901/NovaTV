import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

const int kPort = 47800;
const int kDiscoveryPort = 47801;

/// Компьютер, найденный в сети.
class Found {
  Found(this.name, this.host, this.port);
  final String name;
  final String host;
  final int port;
}

enum LinkState { idle, connecting, connected, denied }

/// Связь с Nova TV на компьютере: поиск, сопряжение по PIN, запоминание и переподключение.
class Link extends ChangeNotifier {
  LinkState state = LinkState.idle;
  String? deniedWhy; // pin | many | token
  String hostName = '';

  String? _host;
  int _port = kPort;
  String? _token;
  String _deviceName = '';
  WebSocketChannel? _ch;
  Timer? _retry;
  Timer? _ping;
  bool _wantConnected = false;
  String? _pendingPin;

  String? get host => _host;
  bool get paired => _token != null && _host != null;
  bool get connected => state == LinkState.connected;

  Future<void> load() async {
    final p = await SharedPreferences.getInstance();
    _host = p.getString('host');
    _port = p.getInt('port') ?? kPort;
    _token = p.getString('token');
    hostName = p.getString('hostName') ?? '';
    _deviceName = p.getString('deviceName') ?? 'Android-${100 + Random().nextInt(900)}';
    await p.setString('deviceName', _deviceName);
  }

  Future<void> _save() async {
    final p = await SharedPreferences.getInstance();
    if (_host != null) await p.setString('host', _host!);
    await p.setInt('port', _port);
    if (_token != null) await p.setString('token', _token!);
    await p.setString('hostName', hostName);
  }

  /// Забыть этот компьютер (потом нужно сопрягаться заново).
  Future<void> forget() async {
    disconnect();
    _token = null;
    _host = null;
    final p = await SharedPreferences.getInstance();
    await p.remove('token');
    await p.remove('host');
    notifyListeners();
  }

  /// Ищем компьютеры с Nova TV: рассылка «NOVATV?» по локальной сети.
  static Future<List<Found>> discover({Duration timeout = const Duration(seconds: 2)}) async {
    final found = <String, Found>{};
    RawDatagramSocket? socket;
    try {
      socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      socket.broadcastEnabled = true;
      socket.listen((event) {
        if (event != RawSocketEvent.read) return;
        final d = socket!.receive();
        if (d == null) return;
        try {
          final j = jsonDecode(utf8.decode(d.data)) as Map<String, dynamic>;
          found[d.address.address] = Found(j['name'] as String? ?? d.address.address, d.address.address, (j['port'] as num?)?.toInt() ?? kPort);
        } catch (_) {}
      });
      final msg = utf8.encode('NOVATV?');
      socket.send(msg, InternetAddress('255.255.255.255'), kDiscoveryPort);
      // Рассылка есть не во всех сетях (роутеры её режут), поэтому ещё и обходим свою подсеть /24 по одному адресу
      try {
        for (final iface in await NetworkInterface.list(type: InternetAddressType.IPv4)) {
          for (final a in iface.addresses) {
            final p = a.address.split('.');
            if (p.length != 4) continue;
            for (var i = 1; i < 255; i++) {
              socket.send(msg, InternetAddress('${p[0]}.${p[1]}.${p[2]}.$i'), kDiscoveryPort);
            }
          }
        }
      } catch (_) {}
      await Future<void>.delayed(const Duration(milliseconds: 600));
      socket.send(msg, InternetAddress('255.255.255.255'), kDiscoveryPort); // второй раз: UDP может потеряться
      await Future<void>.delayed(timeout);
    } catch (_) {
      // нет сети или запрещена рассылка — покажем пустой список и ручной ввод
    } finally {
      socket?.close();
    }
    return found.values.toList();
  }

  /// Первое подключение: адрес и PIN с экрана компьютера.
  Future<void> pair(String host, int port, String pin) async {
    _host = host;
    _port = port;
    _pendingPin = pin;
    _wantConnected = true;
    await _open();
  }

  /// Подключение к уже сопряжённому компьютеру.
  Future<void> connect() async {
    if (!paired) return;
    _wantConnected = true;
    await _open();
  }

  void disconnect() {
    _wantConnected = false;
    _retry?.cancel();
    _ping?.cancel();
    _ch?.sink.close();
    _ch = null;
    state = LinkState.idle;
    notifyListeners();
  }

  Future<void> _open() async {
    _retry?.cancel();
    _ping?.cancel();
    _ch?.sink.close();
    state = LinkState.connecting;
    deniedWhy = null;
    notifyListeners();
    try {
      final ch = WebSocketChannel.connect(Uri.parse('ws://$_host:$_port'));
      _ch = ch;
      await ch.ready.timeout(const Duration(seconds: 5));
      ch.stream.listen(_onMessage, onDone: () => _onClosed(ch), onError: (_) => _onClosed(ch));
      if (_pendingPin != null) {
        _send({'t': 'pair', 'pin': _pendingPin, 'name': _deviceName});
      } else {
        _send({'t': 'hello', 'token': _token, 'name': _deviceName});
      }
      _ping = Timer.periodic(const Duration(seconds: 8), (_) => _send({'t': 'ping'}));
    } catch (_) {
      _onClosed(_ch);
    }
  }

  void _onMessage(dynamic raw) {
    Map<String, dynamic> m;
    try {
      m = jsonDecode(raw as String) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    switch (m['t']) {
      case 'paired':
        _token = m['token'] as String?;
        hostName = m['host'] as String? ?? '';
        _pendingPin = null;
        state = LinkState.connected;
        _save();
        notifyListeners();
        break;
      case 'ready':
        hostName = m['host'] as String? ?? hostName;
        state = LinkState.connected;
        _save();
        notifyListeners();
        break;
      case 'denied':
        deniedWhy = m['why'] as String?;
        _wantConnected = false; // повторять бесполезно
        _pendingPin = null;
        if (deniedWhy == 'token') _token = null; // компьютер нас забыл: нужно сопрягаться заново
        state = LinkState.denied;
        notifyListeners();
        break;
    }
  }

  void _onClosed(WebSocketChannel? ch) {
    if (ch != _ch) return; // это уже старое соединение
    _ping?.cancel();
    _ch = null;
    if (state != LinkState.denied) state = LinkState.idle;
    notifyListeners();
    if (_wantConnected && state != LinkState.denied) {
      _retry = Timer(const Duration(seconds: 2), _open); // компьютер перезапустился или пропал Wi-Fi: пробуем снова
    }
  }

  void _send(Map<String, dynamic> m) {
    try {
      _ch?.sink.add(jsonEncode(m));
    } catch (_) {}
  }

  // ---- команды для компьютера ----
  void send(Map<String, dynamic> m) {
    if (connected) _send(m);
  }

  void move(double dx, double dy) => send({'t': 'm', 'dx': double.parse(dx.toStringAsFixed(1)), 'dy': double.parse(dy.toStringAsFixed(1))});
  void click() => send({'t': 'c'});
  void scroll(double dy, [double dx = 0]) => send({'t': 's', 'dx': dx, 'dy': dy});
  void key(String k) => send({'t': 'k', 'k': k});
  void text(String s) => send({'t': 't', 's': s});
  void backspace() => send({'t': 'bs'});
  void enter() => send({'t': 'en'});
}
