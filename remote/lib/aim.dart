import 'dart:async';
import 'dart:math';

import 'package:sensors_plus/sensors_plus.dart';

/// Превращает наклон и повороты телефона в движение курсора («лазерная указка»).
///
/// Телефон держат экраном вверх (или под наклоном), верхним краем в сторону телевизора.
/// Поворот вокруг вертикали (влево/вправо) двигает курсор по горизонтали, подъём и опускание
/// верхнего края — по вертикали. Гироскоп даёт угловую скорость, поэтому курсор не «уплывает» к краю,
/// а двигается ровно настолько, насколько вы повернули телефон.
class Aim {
  Aim({required this.onMove});

  final void Function(double dx, double dy) onMove;

  /// Включено, пока палец лежит на площадке (как «сцепление»): без касания курсор стоит на месте.
  bool active = false;

  /// Множитель скорости (1 — обычная).
  double sensitivity = 1.0;
  bool invertX = false;
  bool invertY = false;

  // Пикселей экрана 1080p на радиан поворота. Пол-экрана примерно на 20° (0,35 рад).
  static const double _pxPerRad = 2600;
  static const double _dead = 0.012; // рад/с: ниже этого считаем шумом датчика

  StreamSubscription<GyroscopeEvent>? _gyro;
  StreamSubscription<AccelerometerEvent>? _acc;
  Timer? _flush;

  // Направление «вверх» в системе координат телефона (из силы тяжести), сглаженное.
  double _gx = 0, _gy = 0, _gz = 1;
  DateTime? _last;
  double _accX = 0, _accY = 0;

  void start() {
    _acc = accelerometerEventStream(samplingPeriod: SensorInterval.gameInterval).listen((e) {
      final n = sqrt(e.x * e.x + e.y * e.y + e.z * e.z);
      if (n < 1) return;
      const a = 0.08; // чем меньше, тем плавнее и медленнее реагирует направление «вверх»
      _gx += ((e.x / n) - _gx) * a;
      _gy += ((e.y / n) - _gy) * a;
      _gz += ((e.z / n) - _gz) * a;
    });
    _gyro = gyroscopeEventStream(samplingPeriod: SensorInterval.gameInterval).listen((e) {
      final now = DateTime.now();
      final dt = _last == null ? 0.0 : now.difference(_last!).inMicroseconds / 1e6;
      _last = now;
      if (!active || dt <= 0 || dt > 0.1) return;

      final gl = sqrt(_gx * _gx + _gy * _gy + _gz * _gz);
      if (gl < 0.5) return;
      // Скорость поворота вокруг вертикали (против часовой, если смотреть сверху — влево)
      final yaw = (e.x * _gx + e.y * _gy + e.z * _gz) / gl;
      // Подъём верхнего края — вращение вокруг оси X телефона
      final pitch = e.x;

      double dx = 0, dy = 0;
      if (yaw.abs() > _dead) dx = -yaw * dt * _pxPerRad * sensitivity;
      if (pitch.abs() > _dead) dy = -pitch * dt * _pxPerRad * sensitivity;
      if (invertX) dx = -dx;
      if (invertY) dy = -dy;
      _accX += dx;
      _accY += dy;
    });
    // Отправляем накопленное сдвигом примерно 60 раз в секунду, а не на каждый отсчёт датчика
    _flush = Timer.periodic(const Duration(milliseconds: 16), (_) {
      if (_accX.abs() < 0.2 && _accY.abs() < 0.2) return;
      onMove(_accX, _accY);
      _accX = 0;
      _accY = 0;
    });
  }

  void stop() {
    _gyro?.cancel();
    _acc?.cancel();
    _flush?.cancel();
  }
}
