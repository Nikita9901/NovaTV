import 'dart:async';
import 'dart:math';

import 'package:sensors_plus/sensors_plus.dart';

/// Превращает наклон и повороты телефона в движение курсора («лазерная указка»).
///
/// Телефон держат экраном вверх (или под наклоном), верхним краем в сторону телевизора.
/// Поворот вокруг вертикали (влево/вправо) двигает курсор по горизонтали, подъём и опускание
/// верхнего края — по вертикали. Гироскоп даёт угловую скорость, поэтому курсор не «уплывает» к краю,
/// а двигается ровно настолько, насколько вы повернули телефон.
///
/// Чтобы курсор было удобно вести:
///  * дрейф гироскопа вычитается (пока палец не на площадке, запоминаем, что показывает неподвижный датчик);
///  * движение слегка сглаживается, чтобы убрать дрожь руки;
///  * медленные повороты чуть замедляются (точное наведение), быстрые ускоряются (перелёт через экран).
class Aim {
  Aim({required this.onMove});

  final void Function(double dx, double dy) onMove;

  /// Включено, пока палец лежит на площадке (как «сцепление»): без касания курсор стоит на месте.
  bool active = false;
  DateTime _since = DateTime.fromMillisecondsSinceEpoch(0);

  /// Палец опустился на площадку. Первые доли секунды курсор не двигаем: касание само встряхивает телефон,
  /// и без этой паузы курсор «подпрыгивал» бы перед кликом.
  void begin() {
    active = true;
    _since = DateTime.now();
    _smX = 0;
    _smY = 0;
  }

  /// Множитель скорости (1 — обычная).
  double sensitivity = 1.0;
  bool invertX = false;
  bool invertY = false;

  // Пикселей экрана 1080p на радиан поворота. Пол-экрана примерно на 20° (0,35 рад).
  static const double _pxPerRad = 2600;
  static const double _dead = 0.035; // рад/с: ниже этого считаем дрожью руки и шумом датчика (≈2°/с)

  StreamSubscription<GyroscopeEvent>? _gyro;
  StreamSubscription<AccelerometerEvent>? _acc;
  Timer? _flush;

  // Направление «вверх» в системе координат телефона (из силы тяжести), сглаженное.
  double _gx = 0, _gy = 0, _gz = 1;
  // Показания неподвижного гироскопа (его «ноль»)
  double _bx = 0, _by = 0, _bz = 0;
  DateTime? _last;
  double _accX = 0, _accY = 0;
  double _smX = 0, _smY = 0;

  void start() {
    _acc = accelerometerEventStream(samplingPeriod: SensorInterval.gameInterval).listen((e) {
      final n = sqrt(e.x * e.x + e.y * e.y + e.z * e.z);
      if (n < 1) return;
      const a = 0.08; // чем меньше, тем плавнее и медленнее реагирует направление «вверх»
      _gx += ((e.x / n) - _gx) * a;
      _gy += ((e.y / n) - _gy) * a;
      _gz += ((e.z / n) - _gz) * a;
    });
    _gyro = gyroscopeEventStream(samplingPeriod: SensorInterval.gameInterval).listen(_onGyro);
    // Отправляем накопленное сдвигом примерно 60 раз в секунду, а не на каждый отсчёт датчика
    _flush = Timer.periodic(const Duration(milliseconds: 16), (_) {
      // Отправляем целые пиксели, а дробный остаток оставляем на следующий раз: мелкая дрожь не накапливается в рывки
      final sx = _accX.truncateToDouble();
      final sy = _accY.truncateToDouble();
      if (sx == 0 && sy == 0) return;
      onMove(sx, sy);
      _accX -= sx;
      _accY -= sy;
    });
  }

  void _onGyro(GyroscopeEvent e) {
    final now = DateTime.now();
    final dt = _last == null ? 0.0 : now.difference(_last!).inMicroseconds / 1e6;
    _last = now;
    if (dt <= 0 || dt > 0.1) return;

    if (!active) {
      // Палец не на площадке: если телефон почти неподвижен, подстраиваем «ноль» гироскопа
      if (e.x.abs() < 0.05 && e.y.abs() < 0.05 && e.z.abs() < 0.05) {
        const k = 0.02;
        _bx += (e.x - _bx) * k;
        _by += (e.y - _by) * k;
        _bz += (e.z - _bz) * k;
      }
      _smX = 0;
      _smY = 0;
      return;
    }

    if (now.difference(_since).inMilliseconds < 140) return; // см. begin()

    final wx = e.x - _bx;
    final wy = e.y - _by;
    final wz = e.z - _bz;
    final gl = sqrt(_gx * _gx + _gy * _gy + _gz * _gz);
    if (gl < 0.5) return;
    // Скорость поворота вокруг вертикали (против часовой, если смотреть сверху — влево)
    final yaw = (wx * _gx + wy * _gy + wz * _gz) / gl;
    // Подъём верхнего края — вращение вокруг оси X телефона
    final pitch = wx;

    final speed = sqrt(yaw * yaw + pitch * pitch);
    // Ускорение: от 0,7× при медленном повороте до 1,5× при быстром
    final gain = 0.7 + 0.8 * min(speed / 2.0, 1.0);

    // «Мягкая» мёртвая зона: из скорости вычитается порог, поэтому курсор трогается плавно, без скачка
    double soft(double v) => v.abs() <= _dead ? 0.0 : (v.abs() - _dead) * (v < 0 ? -1.0 : 1.0);
    var dx = -soft(yaw) * dt * _pxPerRad * sensitivity * gain;
    var dy = -soft(pitch) * dt * _pxPerRad * sensitivity * gain;
    if (invertX) dx = -dx;
    if (invertY) dy = -dy;

    // Сглаживание зависит от скорости: на малых скоростях сильное (дрожь не видна), на быстрых почти нет (нет «тягучести»)
    final alpha = 0.18 + 0.82 * min(speed / 0.9, 1.0);
    _smX += (dx - _smX) * alpha;
    _smY += (dy - _smY) * alpha;
    _accX += _smX;
    _accY += _smY;
  }

  void stop() {
    _gyro?.cancel();
    _acc?.cancel();
    _flush?.cancel();
  }
}
